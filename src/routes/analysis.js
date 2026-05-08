'use strict';
/**
 * analysis.js
 * POST /api/analysis/run
 *   body: { question, date_from, date_to }
 *   → 営業報告DBデータ + スプレッドシートキャッシュを集計してGeminiに渡し
 *     結果・解説・ネクストアクションを返す
 */

const express = require('express');
const router  = express.Router();
const https   = require('https');
const db      = require('../database');
const { authenticateToken } = require('../middleware/auth');
const spreadsheetRoute = require('./spreadsheet');
const spreadsheetCache = spreadsheetRoute.cache;

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
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('Gemini JSONパース失敗: ' + data.slice(0, 300))); }
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
      sr.created_at
    FROM sales_reports sr
    WHERE (sr.interview_date BETWEEN ? AND ?)
       OR (sr.interview_date IS NULL AND DATE(sr.created_at) BETWEEN ? AND ?)
    ORDER BY sr.interview_date DESC, sr.created_at DESC
  `).all(from, to, from, to);

  // ── ③ 集計データを生成 ───────────────────────────────────
  const totalReports   = reports.length;
  const contractReports = reports.filter(r => CONTRACT_RESULTS.has(r.result));
  const contractCount  = contractReports.length;
  const cvrPct         = totalReports > 0
    ? Math.round(contractCount / totalReports * 1000) / 10 : 0;

  // 担当者別集計
  const byInterviewer = {};
  for (const r of reports) {
    const name = r.interviewer_name || '不明';
    if (!byInterviewer[name]) {
      byInterviewer[name] = { total: 0, contract: 0, results: {} };
    }
    byInterviewer[name].total++;
    if (CONTRACT_RESULTS.has(r.result)) byInterviewer[name].contract++;
    const res_ = r.result || '未記入';
    byInterviewer[name].results[res_] = (byInterviewer[name].results[res_] || 0) + 1;
  }

  // 結果別集計
  const byResult = {};
  for (const r of reports) {
    const res_ = r.result || '未記入';
    byResult[res_] = (byResult[res_] || 0) + 1;
  }

  // 面接内容別集計
  const byContent = {};
  for (const r of reports) {
    const c = r.interview_content || '未記入';
    if (!byContent[c]) byContent[c] = { total: 0, contract: 0 };
    byContent[c].total++;
    if (CONTRACT_RESULTS.has(r.result)) byContent[c].contract++;
  }

  // 支払い方法別集計
  const byPayment = {};
  for (const r of reports) {
    const p = r.payment_method || '未記入';
    byPayment[p] = (byPayment[p] || 0) + 1;
  }

  // STAY/NO 平均
  const avgStay = totalReports > 0
    ? Math.round(reports.reduce((s, r) => s + (r.stay_count || 0), 0) / totalReports * 10) / 10 : 0;
  const avgNo = totalReports > 0
    ? Math.round(reports.reduce((s, r) => s + (r.no_count || 0), 0) / totalReports * 10) / 10 : 0;

  // 入会理由 / 辞退理由 集計
  const joinReasonCount = {};
  const declineReasonCount = {};
  for (const r of reports) {
    (r.join_reasons || '').split(',').map(s => s.trim()).filter(Boolean).forEach(reason => {
      joinReasonCount[reason] = (joinReasonCount[reason] || 0) + 1;
    });
    (r.decline_reasons || '').split(',').map(s => s.trim()).filter(Boolean).forEach(reason => {
      declineReasonCount[reason] = (declineReasonCount[reason] || 0) + 1;
    });
  }

  // スプレッドシートキャッシュからファネル数取得
  const sheetApplicants = (spreadsheetCache && spreadsheetCache.data)
    ? spreadsheetCache.data.applicants : [];

  // 期間内の応募者数（シート）
  const sheetInPeriod = sheetApplicants.filter(a => {
    if (!a.date_parsed) return false;
    const d = a.date_parsed.toISOString().slice(0, 10);
    return d >= from && d <= to;
  });
  const sheetTotal       = sheetInPeriod.length;
  const sheetDocPass     = sheetInPeriod.filter(a => a.is_doc_pass).length;
  const sheetIntervResv  = sheetInPeriod.filter(a => a.is_interview_resv).length;
  const sheetInterview   = sheetInPeriod.filter(a => a.is_interview).length;
  const sheetCV          = sheetInPeriod.filter(a => a.is_cv).length;

  // ── ④ Geminiへ渡すデータ文字列を構築 ─────────────────────
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

  // 個別レコード（直近50件。詳細分析用）
  const recentRecords = reports.slice(0, 50).map(r =>
    `[${r.interview_date || r.created_at?.slice(0,10)}] 担当:${r.interviewer_name || '-'} ` +
    `応募者:${r.applicant_full_name || '-'} 内容:${r.interview_content || '-'} ` +
    `結果:${r.result || '-'} STAY:${r.stay_count ?? '-'} NO:${r.no_count ?? '-'} ` +
    `支払:${r.payment_method || '-'} 権利:${r.character_rights || '-'} ` +
    (r.join_reasons   ? `入会理由:[${r.join_reasons}] ` : '') +
    (r.decline_reasons ? `辞退理由:[${r.decline_reasons}] ` : '') +
    (r.details ? `備考:${r.details.slice(0, 60)}` : '')
  ).join('\n');

  const dataText = `
【分析期間】${date_from || '全期間'} 〜 ${date_to || '現在'}

【ファネル（スプレッドシート）】
  応募者数: ${sheetTotal}人
  書類通過: ${sheetDocPass}人
  面接予約: ${sheetIntervResv}人
  面接実施: ${sheetInterview}人
  CV（面接予約済）: ${sheetCV}人

【営業報告サマリー】
  総面接件数: ${totalReports}件
  契約件数:   ${contractCount}件
  CVR（面接→契約）: ${cvrPct}%
  平均STAYの回数: ${avgStay}回
  平均NOの回数:   ${avgNo}回

【担当者別集計】
${interviewerSummary || '  データなし'}

【面接内容別集計】
${contentSummary || '  データなし'}

【結果別集計】
${resultSummary || '  データなし'}

【入会理由TOP（契約者）】
${joinTop || '  データなし'}

【辞退理由TOP】
${declineTop || '  データなし'}

【直近${Math.min(50, totalReports)}件の個別レコード】
${recentRecords || '  データなし'}
`.trim();

  // ── ⑤ Gemini呼び出し ──────────────────────────────────────
  const systemPrompt = `あなたはWannaVというVTuber養成スクールの営業データアナリストです。
提供された営業報告データを分析し、ユーザーの質問に答えてください。

【出力フォーマット — 厳守】
必ず以下のJSON形式のみで返答してください。前後に説明文・マークダウン・コードブロックを付けないこと。

{
  "title": "<分析タイトル（30文字以内）>",
  "summary": "<分析結果の要点（100〜200文字）>",
  "findings": [
    {
      "label": "<発見事項のラベル（20文字以内）>",
      "value": "<数値や割合など>",
      "detail": "<詳細説明（100文字以内）>",
      "type": "<good|bad|neutral>"
    }
  ],
  "explanation": "<詳細な解説（300〜600文字）>",
  "next_actions": [
    "<具体的なネクストアクション1（60文字以内）>",
    "<具体的なネクストアクション2（60文字以内）>",
    "<具体的なネクストアクション3（60文字以内）>"
  ],
  "caution": "<データの限界・注意点（100文字以内）>"
}

findingsは3〜6件が目安。typeはgood（良好）、bad（要改善）、neutralのいずれか。`;

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

    // メタ情報も返す
    res.json({
      ...parsed,
      meta: {
        date_from: date_from || null,
        date_to:   date_to   || null,
        total_reports:   totalReports,
        contract_count:  contractCount,
        cvr:             cvrPct,
      },
    });

  } catch (err) {
    console.error('[analysis] error:', err);
    res.status(500).json({ error: '分析中にエラーが発生しました: ' + err.message });
  }
});

module.exports = router;
