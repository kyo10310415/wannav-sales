'use strict';
/**
 * analysis.js
 * POST /api/analysis/run
 *   body: { question, date_from, date_to }
 *   → 営業報告DBデータ + スプレッドシートキャッシュを集計してGeminiに渡し
 *     結果・解説・ネクストアクションを返す
 * POST /api/analysis/export-sheet
 *   body: { result, rawData }
 *   → 分析結果と使用データをGoogleスプレッドシートの専用シートに書き出す
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { google } = require('googleapis');
const db      = require('../database');
const { authenticateToken } = require('../middleware/auth');
const spreadsheetRoute = require('./spreadsheet');
const spreadsheetCache = spreadsheetRoute.cache;
const surpriseCallRoute = require('./surpriseCall');
const surpriseCallCache = surpriseCallRoute.cache;

// ── スプレッドシート書き込み用クライアント ──────────────────
async function getWritableSheetsClient() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentials) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません');
  }
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ── シートが存在しなければ作成し、sheetIdを返す ─────────────
async function ensureSheet(sheets, spreadsheetId, sheetTitle) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(
    s => s.properties.title === sheetTitle
  );
  if (existing) return existing.properties.sheetId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: sheetTitle,
            gridProperties: { rowCount: 1000, columnCount: 20 },
          },
        },
      }],
    },
  });
  return addRes.data.replies[0].addSheet.properties.sheetId;
}

// ── A1記法ヘルパー ───────────────────────────────────────────
function colLetter(n) {
  // n: 0-indexed → 'A', 'B', ... 'Z', 'AA', ...
  let s = '';
  n++;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ── Gemini ヘルパー（sukuukun.js と同じパターン） ────────────
function callGemini(systemPrompt, userMessage, apiKey) {
  return new Promise((resolve, reject) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const url = new URL(endpoint);
    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 65536 },
    };
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (resp) => {
      const chunks = [];
      resp.on('data', chunk => { chunks.push(chunk); });
      resp.on('end', () => {
        try {
          const data = Buffer.concat(chunks).toString('utf8');
          resolve({ status: resp.statusCode, body: JSON.parse(data) });
        } catch (e) { reject(new Error('Gemini JSONパース失敗')); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── 契約判定 ────────────────────────────────────────────────
const CONTRACT_RESULTS = new Set(['契約', '契約＆職業案内', '契約＆職業案内（CP）']);

// ============================================================
// POST /api/analysis/run
// body: { question, date_from, date_to }
// ============================================================
router.post('/run', authenticateToken, async (req, res) => {
  const { question, date_from, date_to } = req.body;

  if (!question || question.trim().length < 3) {
    return res.status(400).json({ error: '分析内容を入力してください（3文字以上）' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません' });
  }

  // ── ① 期間フィルター ──────────────────────────────────────
  const from = date_from || '2000-01-01';
  const to   = date_to   || '2099-12-31';

  // ── ② 営業報告データ取得（期間フィルター込み） ─────────────
  const reports = db.prepare(`
    SELECT
      sr.id, sr.interviewer_name, sr.applicant_full_name,
      sr.interview_date, sr.interview_content, sr.result,
      sr.stay_count, sr.no_count,
      sr.contract_plan, sr.payment_method, sr.character_rights,
      sr.join_reasons, sr.decline_reasons, sr.details,
      sr.student_number,
      sr.created_at
    FROM sales_reports sr
    WHERE (sr.interview_date BETWEEN ? AND ?)
       OR (sr.interview_date IS NULL AND DATE(sr.created_at) BETWEEN ? AND ?)
    ORDER BY sr.interview_date DESC, sr.created_at DESC
  `).all(from, to, from, to);

  // ── ②' Notion プロファイル取得（学籍番号で紐付け） ──────────
  const notionProfiles = db.prepare(
    'SELECT * FROM notion_profiles'
  ).all();
  const notionByStudentNum = new Map(
    notionProfiles.map(p => [p.student_number, p])
  );

  // ── ②''' サプライズコールデータ取得（キャッシュから・期間フィルター）──
  const scAllRows = (surpriseCallCache && surpriseCallCache.rows) ? surpriseCallCache.rows : [];
  // タイムスタンプで期間フィルター（例: "2026/06/01 10:30:00" 形式）
  const scInPeriod = scAllRows.filter(r => {
    const ts = r['タイムスタンプ'] || '';
    if (!ts) return false;
    const dateStr = ts.slice(0, 10).replace(/\//g, '-');
    return dateStr >= from && dateStr <= to;
  });

  // 架電結果別集計
  const scByResult = {};
  for (const r of scInPeriod) {
    const res = r['架電結果'] || '未記入';
    scByResult[res] = (scByResult[res] || 0) + 1;
  }

  // ステータス別集計
  const scByStatus = {};
  for (const r of scInPeriod) {
    const s = r['ステータス'] || '未記入';
    scByStatus[s] = (scByStatus[s] || 0) + 1;
  }

  // 熱量（0〜10）統計
  const scHeatValues = scInPeriod
    .map(r => parseFloat(r['今の熱量を0~10点で教えてください'] || ''))
    .filter(v => !isNaN(v));
  const scAvgHeat = scHeatValues.length > 0
    ? Math.round(scHeatValues.reduce((s, v) => s + v, 0) / scHeatValues.length * 10) / 10
    : null;

  // 架電時間帯別集計
  const scByTimeSlot = {};
  for (const r of scInPeriod) {
    const t = r['架電時間帯'] || '未記入';
    scByTimeSlot[t] = (scByTimeSlot[t] || 0) + 1;
  }

  // ユニーク学籍番号数
  const scUniqueStudents = new Set(
    scInPeriod.map(r => (r['学籍番号'] || '').trim()).filter(Boolean)
  );
  const scUniqueCount = scUniqueStudents.size;

  // 繋がった件数（通話 or 繋がった）
  const scReached = scInPeriod.filter(r =>
    r['架電結果'] === '通話' || r['架電結果'] === '繋がった'
  );
  const scReachedUniqueStudents = new Set(
    scReached.map(r => (r['学籍番号'] || '').trim()).filter(Boolean)
  );
  const scReachRate = scUniqueCount > 0
    ? Math.round(scReachedUniqueStudents.size / scUniqueCount * 100) : 0;

  // CO件数・CO率
  const scCoRows = scInPeriod.filter(r => {
    const s = r['ステータス'] || '';
    return s === 'CO' || s === 'クーリングオフ';
  });
  const scCoRate = scUniqueCount > 0
    ? (scCoRows.length / scUniqueCount * 100).toFixed(1) : '0.0';

  // 口コミ共有済み
  const scSharedKuchikomi = scInPeriod.filter(r =>
    r['口コミ共有済み'] === '済' || r['口コミ共有済み'] === 'TRUE' || r['口コミ共有済み'] === '1'
  ).length;

  // 担当者信頼度評価
  const scTrustCount = {};
  for (const r of scInPeriod) {
    const trust = r['担当者は信頼できるか？'] || '未回答';
    scTrustCount[trust] = (scTrustCount[trust] || 0) + 1;
  }

  // 直近20件の個別レコード
  const scRecentRecords = scInPeriod.slice(0, 20).map(r =>
    `[${(r['タイムスタンプ'] || '').slice(0, 10)}] ` +
    `学籍:${r['学籍番号'] || '-'} ` +
    `時間帯:${r['架電時間帯'] || '-'} ` +
    `架電結果:${r['架電結果'] || '-'} ` +
    `熱量:${r['今の熱量を0~10点で教えてください'] || '-'} ` +
    `ステータス:${r['ステータス'] || '-'} ` +
    (r['担当者は信頼できるか？'] ? `信頼度:${r['担当者は信頼できるか？']} ` : '') +
    (r['口コミ共有済み'] ? `口コミ:${r['口コミ共有済み']} ` : '') +
    (r['お手続きの中で不安に感じた点'] ? `不安点:${r['お手続きの中で不安に感じた点'].slice(0, 40)}` : '')
  ).join('\n');

  // ── ②'' すくう君評価データ取得（期間フィルター込み） ──────────
  const sukuukunEvals = db.prepare(`
    SELECT
      se.applicant_name, se.applicant_key,
      se.evaluator_name, se.interviewer_name,
      se.interview_result, se.total_score,
      se.result_json,
      DATE(se.created_at) as eval_date
    FROM sukuukun_evaluations se
    WHERE DATE(se.created_at) BETWEEN ? AND ?
    ORDER BY se.created_at DESC
    LIMIT 100
  `).all(from, to);

  // すくう君サマリー集計（担当者別・スコア帯別）
  const sukuukunByInterviewer = {};
  for (const e of sukuukunEvals) {
    const name = e.interviewer_name || '不明';
    if (!sukuukunByInterviewer[name]) sukuukunByInterviewer[name] = { count: 0, totalScore: 0, results: {} };
    sukuukunByInterviewer[name].count++;
    sukuukunByInterviewer[name].totalScore += (e.total_score || 0);
    const res = e.interview_result || '不明';
    sukuukunByInterviewer[name].results[res] = (sukuukunByInterviewer[name].results[res] || 0) + 1;
  }
  const sukuukunAvgScore = sukuukunEvals.length > 0
    ? Math.round(sukuukunEvals.reduce((s, e) => s + (e.total_score || 0), 0) / sukuukunEvals.length * 10) / 10
    : null;

  // すくう君個別レコード（直近20件・result_jsonから主要評価を抽出）
  const sukuukunRecords = sukuukunEvals.slice(0, 20).map(e => {
    let evalSummary = '';
    try {
      const rj = typeof e.result_json === 'string' ? JSON.parse(e.result_json) : e.result_json;
      if (rj && typeof rj === 'object') {
        // スコアや評価コメントの主要項目を抽出
        const parts = [];
        if (rj.total_score != null) parts.push(`総合${rj.total_score}点`);
        if (rj.summary)  parts.push(`評価:${String(rj.summary).slice(0, 60)}`);
        if (rj.good_points)  parts.push(`良:${String(rj.good_points).slice(0, 40)}`);
        if (rj.bad_points)   parts.push(`課:${String(rj.bad_points).slice(0, 40)}`);
        evalSummary = parts.join(' / ');
      }
    } catch (_) { evalSummary = ''; }
    return `[${e.eval_date}] 応募者:${e.applicant_name || '-'} 担当:${e.interviewer_name || '-'} スコア:${e.total_score ?? '-'}点 結果:${e.interview_result || '-'}${evalSummary ? ` ${evalSummary}` : ''}`;
  }).join('\n');

  // ── ③ スプレッドシートキャッシュ取得・期間フィルター ────────
  const sheetApplicants = (spreadsheetCache && spreadsheetCache.data)
    ? spreadsheetCache.data.applicants : [];

  const sheetInPeriod = sheetApplicants.filter(a => {
    if (!a.date_parsed) return false;
    const d = a.date_parsed.toISOString().slice(0, 10);
    return d >= from && d <= to;
  });

  // ── ④ 名寄せ: 営業報告を優先してシートデータとマージ ───────
  // 氏名正規化（スペース除去・小文字化）
  const normalName = s => (s || '').replace(/[\s　]/g, '').toLowerCase();

  // シートデータをMap化
  const sheetByName = new Map();
  for (const a of sheetInPeriod) {
    const key = normalName(a.full_name);
    if (key) sheetByName.set(key, a);
  }

  // 営業報告に存在する名前セット
  const reportNames = new Set(reports.map(r => normalName(r.applicant_full_name)));

  // シートにのみ存在する応募者（営業報告未記入）
  const sheetOnlyApplicants = sheetInPeriod.filter(
    a => !reportNames.has(normalName(a.full_name))
  );

  // 営業報告レコードにシートデータ・Notionプロファイルを補完
  const mergedReports = reports.map(r => {
    const key    = normalName(r.applicant_full_name);
    const sheet  = sheetByName.get(key) || null;
    const notion = (r.student_number && notionByStudentNum.get(r.student_number)) || null;
    return {
      ...r,
      _gender:            sheet?.raw?.['性別']     || '',
      _birth:             sheet?.raw?.['生年月日'] || '',
      _ad_source:         sheet?.raw?.['広告媒体'] || '',
      _is_doc_pass:       sheet ? sheet.is_doc_pass        : null,
      _is_interview_resv: sheet ? sheet.is_interview_resv  : null,
      _sheet_matched:     !!sheet,
      // Notion由来フィールド
      _notion_final_education:   notion?.final_education          || '',
      _notion_prefecture:        notion?.prefecture               || '',
      _notion_monthly_income:    notion?.monthly_income           || '',
      _notion_sales_class:       notion?.sales_classification     || '',
      _notion_streaming_exp:     notion?.has_streaming_experience || '',
      _notion_vtuber_passion:    notion?.vtuber_passion           || '',
      _notion_motivation:        notion?.motivation               || '',
      _notion_medical:           notion?.medical_history          || '',
      _notion_matched:           !!notion,
    };
  });

  // ── ⑤ 集計データを生成 ───────────────────────────────────
  const totalReports    = mergedReports.length;
  const contractCount   = mergedReports.filter(r => CONTRACT_RESULTS.has(r.result)).length;
  const cvrPct          = totalReports > 0
    ? Math.round(contractCount / totalReports * 1000) / 10 : 0;

  // 担当者別集計
  const byInterviewer = {};
  for (const r of mergedReports) {
    const name = r.interviewer_name || '不明';
    if (!byInterviewer[name]) byInterviewer[name] = { total: 0, contract: 0, results: {} };
    byInterviewer[name].total++;
    if (CONTRACT_RESULTS.has(r.result)) byInterviewer[name].contract++;
    const res_ = r.result || '未記入';
    byInterviewer[name].results[res_] = (byInterviewer[name].results[res_] || 0) + 1;
  }

  // 結果別集計
  const byResult = {};
  for (const r of mergedReports) {
    const res_ = r.result || '未記入';
    byResult[res_] = (byResult[res_] || 0) + 1;
  }

  // 面接内容別集計
  const byContent = {};
  for (const r of mergedReports) {
    const c = r.interview_content || '未記入';
    if (!byContent[c]) byContent[c] = { total: 0, contract: 0 };
    byContent[c].total++;
    if (CONTRACT_RESULTS.has(r.result)) byContent[c].contract++;
  }

  // 支払い方法別集計
  const byPayment = {};
  for (const r of mergedReports) {
    const p = r.payment_method || '未記入';
    byPayment[p] = (byPayment[p] || 0) + 1;
  }

  // STAY/NO 平均
  const avgStay = totalReports > 0
    ? Math.round(mergedReports.reduce((s, r) => s + (r.stay_count || 0), 0) / totalReports * 10) / 10 : 0;
  const avgNo = totalReports > 0
    ? Math.round(mergedReports.reduce((s, r) => s + (r.no_count || 0), 0) / totalReports * 10) / 10 : 0;

  // 入会理由 / 辞退理由 集計
  const joinReasonCount = {};
  const declineReasonCount = {};
  for (const r of mergedReports) {
    (r.join_reasons || '').split(',').map(s => s.trim()).filter(Boolean).forEach(reason => {
      joinReasonCount[reason] = (joinReasonCount[reason] || 0) + 1;
    });
    (r.decline_reasons || '').split(',').map(s => s.trim()).filter(Boolean).forEach(reason => {
      declineReasonCount[reason] = (declineReasonCount[reason] || 0) + 1;
    });
  }

  // ── ⑤'' クーリングオフ専用集計 ──────────────────────────────
  const COOLINGOFF_RESULT = 'クーリングオフ';
  const coolingoffReports = mergedReports.filter(r => r.result === COOLINGOFF_RESULT);
  const coolingoffCount   = coolingoffReports.length;

  // 担当者別クーリングオフ数
  const coolingoffByInterviewer = {};
  for (const r of coolingoffReports) {
    const name = r.interviewer_name || '不明';
    coolingoffByInterviewer[name] = (coolingoffByInterviewer[name] || 0) + 1;
  }

  // 支払方法別クーリングオフ数
  const coolingoffByPayment = {};
  for (const r of coolingoffReports) {
    const p = r.payment_method || '未記入';
    coolingoffByPayment[p] = (coolingoffByPayment[p] || 0) + 1;
  }

  // 面接内容別クーリングオフ数
  const coolingoffByContent = {};
  for (const r of coolingoffReports) {
    const c = r.interview_content || '未記入';
    coolingoffByContent[c] = (coolingoffByContent[c] || 0) + 1;
  }

  // STAY数分布（クーリングオフのみ）
  const coolingoffByStay = {};
  for (const r of coolingoffReports) {
    const s = r.stay_count != null ? String(r.stay_count) : '未記入';
    coolingoffByStay[s] = (coolingoffByStay[s] || 0) + 1;
  }

  // 辞退理由集計（クーリングオフのみ）
  const coolingoffDeclineReasonCount = {};
  for (const r of coolingoffReports) {
    (r.decline_reasons || '').split(',').map(s => s.trim()).filter(Boolean).forEach(reason => {
      coolingoffDeclineReasonCount[reason] = (coolingoffDeclineReasonCount[reason] || 0) + 1;
    });
  }

  // Notion属性別クーリングオフ（都道府県・学歴・月収・Sales分類）
  const coolingoffByPref    = {};
  const coolingoffByEdu     = {};
  const coolingoffByIncome  = {};
  const coolingoffBySales   = {};
  for (const r of coolingoffReports) {
    if (r._notion_matched) {
      const pref   = r._notion_prefecture       || '不明';
      const edu    = r._notion_final_education  || '不明';
      const income = r._notion_monthly_income   || '不明';
      const sales  = r._notion_sales_class      || '不明';
      coolingoffByPref[pref]     = (coolingoffByPref[pref]     || 0) + 1;
      coolingoffByEdu[edu]       = (coolingoffByEdu[edu]       || 0) + 1;
      coolingoffByIncome[income] = (coolingoffByIncome[income] || 0) + 1;
      coolingoffBySales[sales]   = (coolingoffBySales[sales]   || 0) + 1;
    }
  }

  // クーリングオフ率（面接件数に対する割合）
  const coolingoffRatePct = totalReports > 0
    ? Math.round(coolingoffCount / totalReports * 1000) / 10 : 0;

  // ── ⑤' Notion由来の集計 ───────────────────────────────────
  const notionMatchedReports   = mergedReports.filter(r => r._notion_matched);
  const notionMatchCount       = notionMatchedReports.length;
  const notionContractReports  = notionMatchedReports.filter(r => CONTRACT_RESULTS.has(r.result));

  // 都道府県別集計（Notion一致レコード）
  const byPrefecture = {};
  for (const r of notionMatchedReports) {
    const pref = r._notion_prefecture || '不明';
    if (!byPrefecture[pref]) byPrefecture[pref] = { total: 0, contract: 0 };
    byPrefecture[pref].total++;
    if (CONTRACT_RESULTS.has(r.result)) byPrefecture[pref].contract++;
  }

  // 最終学歴別集計
  const byFinalEducation = {};
  for (const r of notionMatchedReports) {
    const edu = r._notion_final_education || '不明';
    if (!byFinalEducation[edu]) byFinalEducation[edu] = { total: 0, contract: 0 };
    byFinalEducation[edu].total++;
    if (CONTRACT_RESULTS.has(r.result)) byFinalEducation[edu].contract++;
  }

  // Sales3分類別集計
  const bySalesClass = {};
  for (const r of notionMatchedReports) {
    const cls = r._notion_sales_class || '不明';
    if (!bySalesClass[cls]) bySalesClass[cls] = { total: 0, contract: 0 };
    bySalesClass[cls].total++;
    if (CONTRACT_RESULTS.has(r.result)) bySalesClass[cls].contract++;
  }

  // 配信経験別集計
  const byStreamingExp = {};
  for (const r of notionMatchedReports) {
    const exp = r._notion_streaming_exp || '不明';
    if (!byStreamingExp[exp]) byStreamingExp[exp] = { total: 0, contract: 0 };
    byStreamingExp[exp].total++;
    if (CONTRACT_RESULTS.has(r.result)) byStreamingExp[exp].contract++;
  }

  // 月収帯別集計（契約者 vs 全体）
  const byIncome = {};
  for (const r of notionMatchedReports) {
    const income = r._notion_monthly_income || '不明';
    if (!byIncome[income]) byIncome[income] = { total: 0, contract: 0 };
    byIncome[income].total++;
    if (CONTRACT_RESULTS.has(r.result)) byIncome[income].contract++;
  }

  // ── シート固有集計 ────────────────────────────────────────
  const sheetTotal      = sheetInPeriod.length;
  const sheetDocPass    = sheetInPeriod.filter(a => a.is_doc_pass).length;
  const sheetIntervResv = sheetInPeriod.filter(a => a.is_interview_resv).length;
  const sheetInterview  = sheetInPeriod.filter(a => a.is_interview).length;
  const sheetCV         = sheetInPeriod.filter(a => a.is_cv).length;

  const docPassRate   = sheetTotal > 0 ? Math.round(sheetDocPass   / sheetTotal    * 1000) / 10 : 0;
  const interviewRate = sheetDocPass > 0 ? Math.round(sheetInterview / sheetDocPass * 1000) / 10 : 0;

  // 性別別集計（シートベース）
  const byGender = {};
  for (const a of sheetInPeriod) {
    const g = a.raw?.['性別'] || '不明';
    if (!byGender[g]) byGender[g] = { total: 0, interview: 0, cv: 0 };
    byGender[g].total++;
    if (a.is_interview) byGender[g].interview++;
    if (a.is_cv)        byGender[g].cv++;
  }

  // 広告媒体別集計（シートベース）
  const byAdSource = {};
  for (const a of sheetInPeriod) {
    const src = a.raw?.['広告媒体'] || '不明';
    byAdSource[src] = (byAdSource[src] || 0) + 1;
  }

  // シートのみ応募者サマリー
  const sheetOnlyTotal     = sheetOnlyApplicants.length;
  const sheetOnlyDocPass   = sheetOnlyApplicants.filter(a => a.is_doc_pass).length;
  const sheetOnlyInterview = sheetOnlyApplicants.filter(a => a.is_interview).length;
  const sheetOnlyCV        = sheetOnlyApplicants.filter(a => a.is_cv).length;

  // ── ⑥ Geminiへ渡すデータ文字列を構築 ─────────────────────
  const interviewerSummary = Object.entries(byInterviewer)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, d]) => {
      const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
      const resultBreakdown = Object.entries(d.results)
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${r}:${n}件`).join('、');
      return `  - ${name}: 面接${d.total}件 / 契約${d.contract}件 / CVR${cvr}% | 結果内訳[${resultBreakdown}]`;
    }).join('\n');

  const contentSummary = Object.entries(byContent)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([c, d]) => {
      const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
      return `  - ${c}: ${d.total}件 / 契約${d.contract}件 / CVR${cvr}%`;
    }).join('\n');

  const resultSummary = Object.entries(byResult)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `  - ${r}: ${n}件`).join('\n');

  const joinTop = Object.entries(joinReasonCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([r, n]) => `  - ${r}: ${n}件`).join('\n');

  const declineTop = Object.entries(declineReasonCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([r, n]) => `  - ${r}: ${n}件`).join('\n');

  const genderSummary = Object.entries(byGender)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([g, d]) => {
      const ivRate = d.total > 0 ? Math.round(d.interview / d.total * 1000) / 10 : 0;
      const cvRate = d.total > 0 ? Math.round(d.cv        / d.total * 1000) / 10 : 0;
      return `  - ${g}: 応募${d.total}人 / 面接${d.interview}人(${ivRate}%) / CV${d.cv}人(${cvRate}%)`;
    }).join('\n');

  const adSourceSummary = Object.entries(byAdSource)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([src, n]) => `  - ${src}: ${n}人`).join('\n');

  // Notion集計サマリー文字列
  const prefSummary = Object.entries(byPrefecture)
    .sort((a, b) => b[1].total - a[1].total).slice(0, 10)
    .map(([p, d]) => {
      const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
      return `  - ${p}: ${d.total}人 / 契約${d.contract}人 / CVR${cvr}%`;
    }).join('\n');

  const eduSummary = Object.entries(byFinalEducation)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([e, d]) => {
      const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
      return `  - ${e}: ${d.total}人 / 契約${d.contract}人 / CVR${cvr}%`;
    }).join('\n');

  const salesClassSummary = Object.entries(bySalesClass)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([c, d]) => {
      const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
      return `  - ${c}: ${d.total}人 / 契約${d.contract}人 / CVR${cvr}%`;
    }).join('\n');

  const streamingSummary = Object.entries(byStreamingExp)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([e, d]) => {
      const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
      return `  - ${e}: ${d.total}人 / 契約${d.contract}人 / CVR${cvr}%`;
    }).join('\n');

  const incomeSummary = Object.entries(byIncome)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([i, d]) => {
      const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
      return `  - ${i}: ${d.total}人 / 契約${d.contract}人 / CVR${cvr}%`;
    }).join('\n');

  // 個別レコード（マージ済み・直近50件）
  const recentRecords = mergedReports.slice(0, 50).map(r =>
    `[${r.interview_date || r.created_at?.slice(0, 10)}] 担当:${r.interviewer_name || '-'} ` +
    `応募者:${r.applicant_full_name || '-'} ` +
    (r._gender               ? `性別:${r._gender} `                        : '') +
    (r._ad_source            ? `媒体:${r._ad_source} `                     : '') +
    `内容:${r.interview_content || '-'} ` +
    `結果:${r.result || '-'} STAY:${r.stay_count ?? '-'} NO:${r.no_count ?? '-'} ` +
    `支払:${r.payment_method || '-'} 権利:${r.character_rights || '-'} ` +
    (r._notion_matched ? (
      (r._notion_prefecture     ? `都道府県:${r._notion_prefecture} `      : '') +
      (r._notion_final_education? `学歴:${r._notion_final_education} `     : '') +
      (r._notion_sales_class    ? `Sales分類:${r._notion_sales_class} `   : '') +
      (r._notion_streaming_exp  ? `配信経験:${r._notion_streaming_exp} `  : '') +
      (r._notion_monthly_income ? `月収:${r._notion_monthly_income} `     : '') +
      (r._notion_vtuber_passion ? `Vtuber熱量:${r._notion_vtuber_passion} ` : '')
    ) : '') +
    (r.join_reasons    ? `入会理由:[${r.join_reasons}] `    : '') +
    (r.decline_reasons ? `辞退理由:[${r.decline_reasons}] ` : '') +
    (r.details ? `備考:${r.details.slice(0, 60)}` : '')
  ).join('\n');

  // クーリングオフ全件個別レコード（制限なし）
  const formatRecord = r =>
    `[${r.interview_date || r.created_at?.slice(0, 10)}] 担当:${r.interviewer_name || '-'} ` +
    `応募者:${r.applicant_full_name || '-'} ` +
    (r._gender    ? `性別:${r._gender} `    : '') +
    (r._ad_source ? `媒体:${r._ad_source} ` : '') +
    `内容:${r.interview_content || '-'} ` +
    `STAY:${r.stay_count ?? '-'} NO:${r.no_count ?? '-'} ` +
    `支払:${r.payment_method || '-'} 権利:${r.character_rights || '-'} ` +
    (r._notion_matched ? (
      (r._notion_prefecture      ? `都道府県:${r._notion_prefecture} `      : '') +
      (r._notion_final_education ? `学歴:${r._notion_final_education} `     : '') +
      (r._notion_sales_class     ? `Sales分類:${r._notion_sales_class} `   : '') +
      (r._notion_monthly_income  ? `月収:${r._notion_monthly_income} `     : '')
    ) : '') +
    (r.decline_reasons ? `辞退理由:[${r.decline_reasons}] ` : '') +
    (r.details ? `備考:${r.details.slice(0, 80)}` : '');

  const coolingoffAllRecords = coolingoffReports.map(formatRecord).join('\n');

  // シートのみ応募者（直近20件）
  const sheetOnlyRecords = sheetOnlyApplicants.slice(0, 20).map(a =>
    `[${a.date_str}] 応募者:${a.full_name || '-'} ` +
    `性別:${a.raw?.['性別'] || '-'} 媒体:${a.raw?.['広告媒体'] || '-'} ` +
    `書類通過:${a.is_doc_pass ? '○' : '×'} 面接予約:${a.is_interview_resv ? '○' : '×'} ` +
    `面接実施:${a.is_interview ? '○' : '×'} CV:${a.is_cv ? '○' : '×'}`
  ).join('\n');

  const dataText = `
【分析期間】${date_from || '全期間'} 〜 ${date_to || '現在'}
【データ統合】営業報告DB ${totalReports}件 ＋ スプレッドシート ${sheetTotal}人（重複は営業報告を優先）＋ Notionプロファイル照合 ${notionMatchCount}件/${totalReports}件 ＋ すくう君評価 ${sukuukunEvals.length}件 ＋ サプライズコール ${scInPeriod.length}件（ユニーク${scUniqueCount}人）

【ファネル参考値（スプレッドシート）】※「面接予約→面接実施」の低転換は既知の構造的課題のため分析対象外
  応募者数:   ${sheetTotal}人
  書類通過:   ${sheetDocPass}人（書類通過率 ${docPassRate}%）
  面接予約:   ${sheetIntervResv}人
  面接実施:   ${sheetInterview}人
  CV:         ${sheetCV}人

【営業報告サマリー（面接実施ベース）※分析の主軸データ】
  総面接件数:              ${totalReports}件
  契約件数:                ${contractCount}件
  CVR（面接→契約）:        ${cvrPct}%
  クーリングオフ件数:      ${coolingoffCount}件（クーリングオフ率 ${coolingoffRatePct}%）
  平均STAYの回数:          ${avgStay}回
  平均NOの回数:            ${avgNo}回

【担当者別集計】
${interviewerSummary || '  データなし'}

【面接内容別集計】
${contentSummary || '  データなし'}

【結果別集計】
${resultSummary || '  データなし'}

【性別別集計（スプレッドシートベース）】
${genderSummary || '  データなし'}

【広告媒体別応募数TOP（スプレッドシートベース）】
${adSourceSummary || '  データなし'}

【入会理由TOP（契約者）】
${joinTop || '  データなし'}

【辞退理由TOP】
${declineTop || '  データなし'}

【Notion詳細データ統合（学籍番号一致: ${notionMatchCount}件 / 営業報告総数: ${totalReports}件）】
${notionMatchCount === 0 ? '  ※学籍番号が一致したレコードなし（Notion未連携または学籍番号未入力）' : ''}

【最終学歴別集計（Notionデータ）】
${eduSummary || '  データなし'}

【都道府県別集計TOP10（Notionデータ）】
${prefSummary || '  データなし'}

【Sales3分類別集計（Notionデータ）】
${salesClassSummary || '  データなし'}

【配信経験別集計（Notionデータ）】
${streamingSummary || '  データなし'}

【月収帯別集計（Notionデータ）】
${incomeSummary || '  データなし'}

【クーリングオフ詳細集計（全${coolingoffCount}件 / クーリングオフ率${coolingoffRatePct}%）】
${coolingoffCount === 0 ? '  データなし' : `  担当者別:
${Object.entries(coolingoffByInterviewer).sort((a,b)=>b[1]-a[1]).map(([n,c])=>`    - ${n}: ${c}件`).join('\n') || '    データなし'}
  支払方法別:
${Object.entries(coolingoffByPayment).sort((a,b)=>b[1]-a[1]).map(([p,c])=>`    - ${p}: ${c}件`).join('\n') || '    データなし'}
  面接内容別:
${Object.entries(coolingoffByContent).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`    - ${c}: ${n}件`).join('\n') || '    データなし'}
  STAY数分布:
${Object.entries(coolingoffByStay).sort((a,b)=>Number(a[0]||0)-Number(b[0]||0)).map(([s,c])=>`    - STAY${s}回: ${c}件`).join('\n') || '    データなし'}
  辞退理由:
${Object.entries(coolingoffDeclineReasonCount).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`    - ${r}: ${c}件`).join('\n') || '    データなし'}
  都道府県別（Notion照合分）:
${Object.entries(coolingoffByPref).sort((a,b)=>b[1]-a[1]).map(([p,c])=>`    - ${p}: ${c}件`).join('\n') || '    データなし（Notion未照合）'}
  学歴別（Notion照合分）:
${Object.entries(coolingoffByEdu).sort((a,b)=>b[1]-a[1]).map(([e,c])=>`    - ${e}: ${c}件`).join('\n') || '    データなし（Notion未照合）'}
  月収帯別（Notion照合分）:
${Object.entries(coolingoffByIncome).sort((a,b)=>b[1]-a[1]).map(([i,c])=>`    - ${i}: ${c}件`).join('\n') || '    データなし（Notion未照合）'}
  Sales分類別（Notion照合分）:
${Object.entries(coolingoffBySales).sort((a,b)=>b[1]-a[1]).map(([s,c])=>`    - ${s}: ${c}件`).join('\n') || '    データなし（Notion未照合）'}`}

【クーリングオフ全件個別レコード（${coolingoffCount}件・全件）】
${coolingoffAllRecords || '  データなし'}

【直近${Math.min(50, totalReports)}件の個別レコード（営業報告＋シート＋Notion統合）】
${recentRecords || '  データなし'}

【参考：直近${Math.min(20, sheetOnlyTotal)}件のシートのみ応募者（営業報告未記入・面接予約〜実施ボトルネックは分析対象外）】
${sheetOnlyRecords || '  データなし'}

【サプライズコールサマリー（期間内 ${scInPeriod.length}件 / ユニーク${scUniqueCount}人）】
${scInPeriod.length === 0 ? '  データなし（キャッシュ未取得または期間内データなし）' : `  架電到達率（ユニーク）: ${scReachRate}%（${scReachedUniqueStudents.size}人 / ${scUniqueCount}人）
  平均熱量: ${scAvgHeat !== null ? scAvgHeat + '点' : 'データなし'}
  CO件数: ${scCoRows.length}件 / CO率: ${scCoRate}%（${scCoRows.length}件 / ${scUniqueCount}人）
  口コミ共有済み: ${scSharedKuchikomi}件
  架電結果別:
${Object.entries(scByResult).sort((a,b)=>b[1]-a[1]).map(([r,n])=>`    - ${r}: ${n}件`).join('\n')}
  ステータス別:
${Object.entries(scByStatus).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`    - ${s}: ${n}件`).join('\n')}
  架電時間帯別:
${Object.entries(scByTimeSlot).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`    - ${t}: ${n}件`).join('\n')}
  担当者信頼度評価:
${Object.entries(scTrustCount).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`    - ${t}: ${n}件`).join('\n')}`}

【サプライズコール 直近${Math.min(20, scInPeriod.length)}件の個別レコード】
${scRecentRecords || '  データなし'}

【すくう君AI評価サマリー（期間内 ${sukuukunEvals.length}件）】
${sukuukunEvals.length === 0 ? '  データなし' : `  平均スコア: ${sukuukunAvgScore}点
  担当者別集計:
${Object.entries(sukuukunByInterviewer).sort((a,b)=>b[1].count-a[1].count).map(([name,d])=>{
  const avg = d.count > 0 ? Math.round(d.totalScore/d.count*10)/10 : 0;
  const resStr = Object.entries(d.results).sort((a,b)=>b[1]-a[1]).map(([r,n])=>`${r}:${n}件`).join('、');
  return `    - ${name}: ${d.count}件 / 平均${avg}点 | 結果[${resStr}]`;
}).join('\n')}`}

【すくう君AI評価 直近${Math.min(20, sukuukunEvals.length)}件の個別レコード】
${sukuukunRecords || '  データなし'}
`.trim();

  // ── ⑤ Gemini呼び出し ──────────────────────────────────────
  const systemPrompt = `あなたはWannaVというVTuber養成スクールの営業データアナリストです。
提供された集計済み営業データを用いて、**ユーザーの質問・依頼に直接答えること**を最優先に分析してください。

【分析の基本方針】
- ユーザーが質問した内容・テーマに集中して分析すること。データ全体の総括は求めていません。
- ユーザーが特定の期間・事象・指標を指定している場合は、その観点から深掘りしてください。
- すくう君AI評価データが提供されている場合、ユーザーが参照を求めたときは積極的に活用してください。
- 面接予約→面接実施のボトルネックは既知の構造的課題のため、特に言及を求められない限り触れないこと。

【使用すべき統計手法（質問に応じて適切に選択）】
- 記述統計: 平均・中央値・標準偏差・最大最小・分布の把握
- 比率差の検定（z検定相当）: 2グループ間のCVRや通過率の差が有意かどうかの評価
- t検定（相当）: 担当者間・グループ間の数値指標の平均差の評価（n数も考慮）
- カイ二乗検定（相当）: カテゴリ変数と結果の関連性検定
- 相関分析: 数値変数間の相関係数推定
- ロジスティック回帰分析（相当）: 契約に影響する要因の相対的寄与推定
- ファネル分析: 各ステップの離脱率・変換率（面接予約→実施は参考値のみ）
- コホート比較: 期間・担当者・媒体などのセグメント間KPI比較
- 時系列比較: 週次・月次などの期間をまたいだ変動・傾向の把握

※提供データは集計済みのため正確な検定統計量の算出は不可です。
  推定・解釈を行い「有意差があると推測される」「相関が示唆される」など適切な表現を使用してください。
  n数が少ない場合は必ずその旨を注記してください。

【出力フォーマット — 厳守】
必ず以下のJSON形式のみで返答してください。前後に説明文・マークダウン・コードブロックを付けないこと。

{
  "title": "<分析タイトル（30文字以内）>",
  "summary": "<分析結果の要点（150〜250文字）>",
  "statistical_methods": [
    {
      "name": "<統計手法名（例: t検定、カイ二乗検定、ロジスティック回帰分析など）>",
      "purpose": "<この手法で何を調べたか（60文字以内）>",
      "result": "<分析結果の要点（100文字以内）>",
      "reliability": "<high|medium|low>",
      "note": "<n数・データ制約などの注記（60文字以内、不要なら空文字）>"
    }
  ],
  "findings": [
    {
      "label": "<発見事項のラベル（20文字以内）>",
      "value": "<数値や割合など>",
      "detail": "<詳細説明（120文字以内）>",
      "type": "<good|bad|neutral>",
      "method": "<この発見に使用した統計手法名（20文字以内）>"
    }
  ],
  "explanation": "<詳細な解説（400〜700文字）>",
  "next_actions": [
    "<具体的なネクストアクション1（60文字以内）>",
    "<具体的なネクストアクション2（60文字以内）>",
    "<具体的なネクストアクション3（60文字以内）>"
  ],
  "caution": "<データの限界・注意点（150文字以内）>"
}

statistical_methodsは3〜6件。reliabilityはhigh（n数十分・推定精度高）、medium（n数中程度）、low（n数少・推定のみ）のいずれか。
findingsは4〜8件が目安。typeはgood（良好）、bad（要改善）、neutralのいずれか。
methodフィールドは必ず埋めること（例: "t検定"、"相関分析"、"ファネル分析"、"記述統計"など）。`;

  const userMessage = `【分析したい内容】\n${question.trim()}\n\n【データ】\n${dataText}`;

  try {
    const geminiRes = await callGemini(systemPrompt, userMessage, apiKey);

    if (geminiRes.status !== 200) {
      const errMsg = geminiRes.body?.error?.message || JSON.stringify(geminiRes.body).slice(0, 300);
      return res.status(502).json({ error: `Gemini APIエラー (${geminiRes.status}): ${errMsg}` });
    }

    const rawText = geminiRes.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let parsed;
    try {
      let cleaned = rawText.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '');
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('JSON not found');
      parsed = JSON.parse(cleaned.slice(s, e + 1));
    } catch (_) {
      return res.json({ raw: rawText, parseError: true });
    }

    // メタ情報 + 集計データ（export-sheet で再利用）も返す
    res.json({
      ...parsed,
      meta: {
        date_from: date_from || null,
        date_to:   date_to   || null,
        total_reports:   totalReports,
        contract_count:  contractCount,
        cvr:             cvrPct,
      },
      // export-sheet へそのまま渡すための生データ
      _rawData: {
        question,
        reports: mergedReports,
        aggregates: {
          byInterviewer,
          byResult,
          byContent,
          byPayment,
          joinReasonCount,
          declineReasonCount,
          avgStay,
          avgNo,
        },
      },
    });

  } catch (err) {
    console.error('[analysis] error:', err);
    res.status(500).json({ error: '分析中にエラーが発生しました: ' + err.message });
  }
});

// ============================================================
// POST /api/analysis/export-sheet
// body: { result, rawData }
//   result  : /run が返したJSONオブジェクト（title/summary/findings/…/meta）
//   rawData : { reports[], aggregates{} } — 使用データ詳細
// ============================================================
const EXPORT_SPREADSHEET_ID = '1H0CctpkCJ4PVZ5cf1YYI7_elNwUu0uIcHIHMNTHYHW4';
const EXPORT_SHEET_TITLE    = 'AI分析履歴';

router.post('/export-sheet', authenticateToken, async (req, res) => {
  const { result, rawData } = req.body;
  if (!result) {
    return res.status(400).json({ error: '書き出すデータがありません' });
  }

  try {
    const sheets = await getWritableSheetsClient();

    // ── シート確保 ─────────────────────────────────────────
    const sheetId = await ensureSheet(sheets, EXPORT_SPREADSHEET_ID, EXPORT_SHEET_TITLE);

    // ── 既存データの末尾行を取得 ───────────────────────────
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: EXPORT_SPREADSHEET_ID,
      range: `${EXPORT_SHEET_TITLE}!A:A`,
    });
    const existingRows = (existing.data.values || []).length;
    const isFirstWrite = existingRows === 0;

    // ── 書き込む行を構築 ──────────────────────────────────
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const meta = result.meta || {};
    const findings = (result.findings || [])
      .map(f => `[${f.type}] ${f.label} ${f.value || ''}: ${f.detail || ''}`)
      .join(' / ');
    const nextActions = (result.next_actions || []).join(' / ');

    // ─────────────────────────────────────────────────────────
    // セクション1: 分析結果サマリー行
    // ─────────────────────────────────────────────────────────

    // ヘッダー行（初回のみ）
    const headerRows = [];
    if (isFirstWrite) {
      headerRows.push([
        // ─ 分析結果セクション ─
        '書き出し日時',
        '分析期間(from)',
        '分析期間(to)',
        '質問内容',
        '分析タイトル',
        'サマリー',
        '発見事項',
        '詳細解説',
        'ネクストアクション',
        'データの注意点',
        // ─ メタ集計セクション ─
        '総面接件数',
        '契約件数',
        'CVR(%)',
        // ─ 使用データ: 担当者別 ─
        '担当者別集計',
        // ─ 使用データ: 結果別 ─
        '結果別集計',
        // ─ 使用データ: 面接内容別 ─
        '面接内容別集計',
        // ─ 使用データ: 入会理由TOP ─
        '入会理由TOP',
        // ─ 使用データ: 辞退理由TOP ─
        '辞退理由TOP',
        // ─ 使用データ: 個別レコード件数 ─
        '個別レコード件数',
      ]);
    }

    // ── rawData から集計文字列を生成 ─────────────────────
    const agg = rawData?.aggregates || {};

    const byInterviewerStr = Object.entries(agg.byInterviewer || {})
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => {
        const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
        return `${name}: ${d.total}件/契約${d.contract}件/CVR${cvr}%`;
      }).join(' | ');

    const byResultStr = Object.entries(agg.byResult || {})
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `${r}:${n}件`)
      .join(' | ');

    const byContentStr = Object.entries(agg.byContent || {})
      .sort((a, b) => b[1].total - a[1].total)
      .map(([c, d]) => {
        const cvr = d.total > 0 ? Math.round(d.contract / d.total * 1000) / 10 : 0;
        return `${c}: ${d.total}件/CVR${cvr}%`;
      }).join(' | ');

    const joinReasonsStr = Object.entries(agg.joinReasonCount || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([r, n]) => `${r}:${n}件`)
      .join(' | ');

    const declineReasonsStr = Object.entries(agg.declineReasonCount || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([r, n]) => `${r}:${n}件`)
      .join(' | ');

    const dataRow = [
      now,
      meta.date_from || '',
      meta.date_to   || '',
      rawData?.question || '',
      result.title   || '',
      result.summary || '',
      findings,
      result.explanation || '',
      nextActions,
      result.caution || '',
      meta.total_reports   ?? '',
      meta.contract_count  ?? '',
      meta.cvr             ?? '',
      byInterviewerStr,
      byResultStr,
      byContentStr,
      joinReasonsStr,
      declineReasonsStr,
      rawData?.reports?.length ?? '',
    ];

    // ── 個別レコードシート（分析で使用した生データ） ────────
    const RECORDS_SHEET_TITLE = 'AI分析_使用データ';
    await ensureSheet(sheets, EXPORT_SPREADSHEET_ID, RECORDS_SHEET_TITLE);

    // 既存の行数確認
    const recExisting = await sheets.spreadsheets.values.get({
      spreadsheetId: EXPORT_SPREADSHEET_ID,
      range: `${RECORDS_SHEET_TITLE}!A:A`,
    });
    const recExistingRows = (recExisting.data.values || []).length;
    const isRecFirstWrite = recExistingRows === 0;

    const reports = rawData?.reports || [];
    const recRows = [];

    if (isRecFirstWrite) {
      recRows.push([
        '書き出し日時', '分析タイトル', '期間(from)', '期間(to)',
        '面接日', '担当者', '応募者名', '面接内容', '結果',
        'STAY回数', 'NO回数', '支払方法', '権利', '入会理由', '辞退理由', '備考',
      ]);
    }

    for (const r of reports) {
      recRows.push([
        now,
        result.title || '',
        meta.date_from || '',
        meta.date_to   || '',
        r.interview_date || r.created_at?.slice(0, 10) || '',
        r.interviewer_name     || '',
        r.applicant_full_name  || '',
        r.interview_content    || '',
        r.result               || '',
        r.stay_count           ?? '',
        r.no_count             ?? '',
        r.payment_method       || '',
        r.character_rights     || '',
        r.join_reasons         || '',
        r.decline_reasons      || '',
        r.details              || '',
      ]);
    }

    // ── バッチ書き込み ────────────────────────────────────
    const writeRequests = [];

    // 分析結果シートへの書き込み
    const summaryRows = [...headerRows, dataRow];
    const summaryRange = `${EXPORT_SHEET_TITLE}!A${existingRows + 1}`;
    writeRequests.push({
      range:  summaryRange,
      values: summaryRows,
    });

    // 使用データシートへの書き込み
    if (recRows.length > 0) {
      const recStartRow = recExistingRows + 1;
      writeRequests.push({
        range:  `${RECORDS_SHEET_TITLE}!A${recStartRow}`,
        values: recRows,
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: EXPORT_SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: writeRequests,
      },
    });

    // ── ヘッダー行の書式設定（初回のみ） ─────────────────
    const formatRequests = [];
    if (isFirstWrite) {
      formatRequests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.055, green: 0.639, blue: 0.914 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      });
    }
    if (isRecFirstWrite) {
      const recSheetId = (await sheets.spreadsheets.get({ spreadsheetId: EXPORT_SPREADSHEET_ID }))
        .data.sheets.find(s => s.properties.title === RECORDS_SHEET_TITLE)?.properties.sheetId;
      if (recSheetId != null) {
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: recSheetId,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.118, green: 0.533, blue: 0.898 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        });
      }
    }

    if (formatRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: EXPORT_SPREADSHEET_ID,
        requestBody: { requests: formatRequests },
      });
    }

    res.json({
      ok: true,
      summarySheet: EXPORT_SHEET_TITLE,
      recordsSheet: RECORDS_SHEET_TITLE,
      recordsWritten: reports.length,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${EXPORT_SPREADSHEET_ID}`,
    });

  } catch (err) {
    console.error('[analysis/export-sheet] error:', err);
    res.status(500).json({ error: 'スプレッドシートへの書き出しに失敗しました: ' + err.message });
  }
});

module.exports = router;
