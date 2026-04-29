const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// ユーティリティ：氏名を正規化（スペース除去・全角→半角）
// ============================================================
function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/[\s\u3000　]+/g, '') // スペース・全角スペースを除去
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) // 全角英数→半角
    .toLowerCase();
}

// ============================================================
// Google Calendar クライアント取得
// ============================================================
function getCalendarClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません');
  }
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return google.calendar({ version: 'v3', auth });
}

// ============================================================
// スケジュール名から氏名を抽出
//
// 対応パターン例:
//   🔸大久保弘晃さん: VTuberプロダクション「アススタ」面接予約
//   ⚠️小笠原圭悟さん: 【明日まで】Vtuberプロダクション「アススタ」面接予約
//   🔴【一言】井畑匡人さん: VTuberプロダクション「アススタ」面接予約
//   【学】🔸田辺雅人さん: VTuberプロダクション「アススタ」面接予約
//
// ロジック:
//   1) 先頭の絵文字・【...】タグ・空白を除去
//   2) 「〇〇さん」の形式で氏名を取り出す（「さん」の直前）
// ============================================================
function extractNameFromSummary(summary) {
  if (!summary) return null;

  // Step1: 先頭から「絵文字」「【...】」「空白」を繰り返し除去
  // 絵文字の範囲: U+1F000–U+1FFFF, U+2600–U+27BF, U+FE00–U+FEFF, etc.
  let s = summary;
  // 先頭の【...】ブロック・絵文字・スペースを除去（繰り返し）
  s = s.replace(/^[\s\u3000　\u200d\ufe0f\u20e3]*/, ''); // 先頭の空白・ZWJ等
  // 先頭にある「【...】」と絵文字を繰り返し除去
  // eslint-disable-next-line no-constant-condition
  let prev = null;
  while (prev !== s) {
    prev = s;
    // 【...】タグを除去
    s = s.replace(/^【[^】]*】/, '').trim();
    // 絵文字（サロゲートペアを含む広範な範囲）を除去
    s = s.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F300}-\u{1F9FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F004}\u{1F0CF}⚠️🔸🔴⭕❌✅🟥🟡🟢🔵🟠]+/u, '').trim();
    // 顔文字・記号類
    s = s.replace(/^[★☆◆◇▶▷►▸●○■□♦♠♣♥♤♡♢♧✦✧※→←↑↓]+/, '').trim();
  }

  // Step2: 「〇〇さん」を探して名前部分を返す
  // 「さん」の直前にある連続した日本語文字列（氏名）を取得
  // 氏名は漢字・ひらがな・カタカナ・スペース（姓名間のスペース含む）
  const match = s.match(/^([^\s:：【\n]+?)\s*さん/);
  if (match) {
    return match[1].trim();
  }

  return null;
}

// ============================================================
// POST /api/calendar/sync
// 全ユーザーのカレンダーから「面接予約」イベントを取得して
// 応募者一覧の氏名と照合し、面接日を一括保存する
// ============================================================
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const calendar = getCalendarClient();

    // calendar_id が設定されているユーザーを取得
    const users = db.prepare(`
      SELECT id, name, login_id, calendar_id
      FROM users
      WHERE calendar_id IS NOT NULL AND calendar_id != ''
    `).all();

    if (users.length === 0) {
      return res.json({
        ok: true,
        message: 'カレンダーIDが設定されているユーザーがいません',
        matched: 0,
        events: [],
      });
    }

    // 取得期間: 過去90日 〜 今後180日
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 180);

    const allEvents = [];

    for (const user of users) {
      try {
        let pageToken = undefined;
        do {
          const resp = await calendar.events.list({
            calendarId: user.calendar_id,
            q: '面接予約',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
            pageToken,
          });

          const items = resp.data.items || [];
          for (const ev of items) {
            // タイトルに「面接予約」を含むもののみ
            if (!(ev.summary || '').includes('面接予約')) continue;

            const guestName = extractNameFromSummary(ev.summary);
            const startDt = ev.start?.dateTime || ev.start?.date;

            allEvents.push({
              userId: user.id,
              userName: user.name,
              calendarId: user.calendar_id,
              eventId: ev.id,
              summary: ev.summary,
              startDt,
              guestName,
            });
          }
          pageToken = resp.data.nextPageToken;
        } while (pageToken);
      } catch (calErr) {
        console.error(`Calendar fetch error for user ${user.name} (${user.calendar_id}):`, calErr.message);
        // 個別ユーザーのエラーはスキップして続行
      }
    }

    // 現在の全 interview_dates を取得
    const existingDates = db.prepare('SELECT applicant_key FROM applicant_interview_dates').all()
      .map(r => r.applicant_key);

    // 応募者キーのリスト（applicant_interview_dates + スプレッドシートは直接読めないので
    // 既存の interview_dates と照合、加えてゲスト氏名の正規化で sales_reports も参照）
    // sales_reports から全応募者の full_name, email を取得
    const knownApplicants = db.prepare(`
      SELECT DISTINCT
        applicant_full_name AS full_name,
        applicant_email     AS email
      FROM sales_reports
    `).all();

    // applicant_interview_dates の全キーも対象
    const allInterviewDateKeys = db.prepare(`
      SELECT applicant_key FROM applicant_interview_dates
    `).all().map(r => r.applicant_key);

    const matchResults = [];
    const upsertStmt = db.prepare(`
      INSERT INTO applicant_interview_dates (applicant_key, interview_date, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(applicant_key) DO UPDATE SET
        interview_date = excluded.interview_date,
        updated_at     = CURRENT_TIMESTAMP
    `);

    for (const ev of allEvents) {
      if (!ev.guestName || !ev.startDt) continue;

      const normalizedGuest = normalizeName(ev.guestName);

      // 1) sales_reports の applicant_full_name と照合
      let matched = null;
      for (const ap of knownApplicants) {
        if (ap.full_name && normalizeName(ap.full_name) === normalizedGuest) {
          matched = { key: ap.email && ap.email.trim() ? ap.email.trim() : ap.full_name };
          break;
        }
      }

      // 2) applicant_interview_dates の既存キーと照合（email / full_name どちらも）
      if (!matched) {
        for (const key of allInterviewDateKeys) {
          if (normalizeName(key) === normalizedGuest) {
            matched = { key };
            break;
          }
        }
      }

      if (!matched) {
        matchResults.push({
          guestName: ev.guestName,
          startDt: ev.startDt,
          matched: false,
          reason: '氏名が一致する応募者が見つかりませんでした',
        });
        continue;
      }

      // 日付部分のみ抽出 (YYYY-MM-DD)
      const interviewDate = ev.startDt.substring(0, 10);

      upsertStmt.run(matched.key, interviewDate);

      matchResults.push({
        guestName: ev.guestName,
        applicantKey: matched.key,
        startDt: ev.startDt,
        interviewDate,
        matched: true,
      });
    }

    const matchedCount = matchResults.filter(r => r.matched).length;

    res.json({
      ok: true,
      message: `${allEvents.length}件のイベントを取得、${matchedCount}件を照合しました`,
      totalEvents: allEvents.length,
      matched: matchedCount,
      results: matchResults,
    });
  } catch (err) {
    console.error('Calendar sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/calendar/debug
// 診断用: カレンダー取得の全ステップを詳細ログとともに返す
// ============================================================
router.get('/debug', authenticateToken, async (req, res) => {
  const log = [];
  const result = { steps: log, users: [], events: [], matchResults: [] };

  try {
    // Step1: GOOGLE_SERVICE_ACCOUNT_JSON の確認
    const svcJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!svcJson) {
      log.push({ step: 1, status: 'ERROR', msg: 'GOOGLE_SERVICE_ACCOUNT_JSON が未設定' });
      return res.json(result);
    }
    let credentials;
    try {
      credentials = JSON.parse(svcJson);
      log.push({ step: 1, status: 'OK', msg: `サービスアカウント: ${credentials.client_email}` });
    } catch (e) {
      log.push({ step: 1, status: 'ERROR', msg: `JSON parse失敗: ${e.message}` });
      return res.json(result);
    }

    // Step2: calendar_id 設定済みユーザーの確認
    const users = db.prepare(`
      SELECT id, name, login_id, calendar_id
      FROM users WHERE calendar_id IS NOT NULL AND calendar_id != ''
    `).all();
    result.users = users.map(u => ({ name: u.name, calendar_id: u.calendar_id }));
    if (users.length === 0) {
      log.push({ step: 2, status: 'WARN', msg: 'カレンダーIDが設定されているユーザーが0人です' });
      return res.json(result);
    }
    log.push({ step: 2, status: 'OK', msg: `カレンダーID設定済みユーザー: ${users.map(u => u.name).join(', ')}` });

    // Step3: Calendar APIクライアント生成
    let calendar;
    try {
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
      calendar = google.calendar({ version: 'v3', auth });
      log.push({ step: 3, status: 'OK', msg: 'Calendar APIクライアント生成成功' });
    } catch (e) {
      log.push({ step: 3, status: 'ERROR', msg: `クライアント生成失敗: ${e.message}` });
      return res.json(result);
    }

    // Step4: 各ユーザーのカレンダーからイベント取得
    const timeMin = new Date(); timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date(); timeMax.setDate(timeMax.getDate() + 180);

    for (const user of users) {
      try {
        const resp = await calendar.events.list({
          calendarId: user.calendar_id,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 10,
        });
        const items = resp.data.items || [];
        log.push({
          step: 4,
          status: 'OK',
          msg: `${user.name} (${user.calendar_id}): ${items.length}件取得（クエリなし・先頭10件）`,
          sampleTitles: items.slice(0, 5).map(ev => ev.summary || '(タイトルなし)'),
        });

        // 「面接予約」絞り込み
        const resp2 = await calendar.events.list({
          calendarId: user.calendar_id,
          q: '面接予約',
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 50,
        });
        const items2 = (resp2.data.items || []).filter(ev => (ev.summary || '').includes('面接予約'));
        log.push({
          step: 4,
          status: 'OK',
          msg: `${user.name}: 「面接予約」フィルタ後 ${items2.length}件`,
          events: items2.map(ev => ({
            summary: ev.summary,
            startDt: ev.start?.dateTime || ev.start?.date,
            extractedName: extractNameFromSummary(ev.summary),
          })),
        });
        result.events.push(...items2.map(ev => ({
          user: user.name,
          summary: ev.summary,
          startDt: ev.start?.dateTime || ev.start?.date,
          extractedName: extractNameFromSummary(ev.summary),
        })));
      } catch (e) {
        log.push({ step: 4, status: 'ERROR', msg: `${user.name} (${user.calendar_id}): ${e.message}` });
      }
    }

    // Step5: 照合対象の応募者リスト
    const knownApplicants = db.prepare(`
      SELECT DISTINCT applicant_full_name AS full_name, applicant_email AS email
      FROM sales_reports
    `).all();
    log.push({ step: 5, status: 'OK', msg: `sales_reports から ${knownApplicants.length}人の応募者を取得` });

    // Step6: 氏名照合テスト
    for (const ev of result.events) {
      if (!ev.extractedName) {
        result.matchResults.push({ summary: ev.summary, extractedName: null, matched: false, reason: '氏名抽出失敗' });
        continue;
      }
      const norm = normalizeName(ev.extractedName);
      const found = knownApplicants.find(ap => ap.full_name && normalizeName(ap.full_name) === norm);
      result.matchResults.push({
        summary: ev.summary,
        extractedName: ev.extractedName,
        normalizedExtracted: norm,
        matched: !!found,
        matchedTo: found ? found.full_name : null,
        reason: found ? null : `sales_reports に「${ev.extractedName}」が見つからない`,
      });
    }
    log.push({ step: 6, status: 'OK', msg: `照合テスト完了: ${result.matchResults.filter(r => r.matched).length}件マッチ` });

  } catch (err) {
    log.push({ step: 99, status: 'ERROR', msg: `予期しないエラー: ${err.message}` });
  }

  res.json(result);
});

// ============================================================
// GET /api/calendar/events/:calendarId
// 特定カレンダーの「面接予約」イベント一覧を返す（プレビュー用）
// ============================================================
router.get('/events/:calendarId', authenticateToken, async (req, res) => {
  try {
    const calendar = getCalendarClient();
    const calendarId = decodeURIComponent(req.params.calendarId);

    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 180);

    const resp = await calendar.events.list({
      calendarId,
      q: '面接予約',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    });

    const events = (resp.data.items || [])
      .filter(ev => (ev.summary || '').includes('面接予約'))
      .map(ev => ({
        id: ev.id,
        summary: ev.summary,
        startDt: ev.start?.dateTime || ev.start?.date,
        guestName: extractNameFromSummary(ev.summary),
      }));

    res.json({ ok: true, events });
  } catch (err) {
    console.error('Calendar events fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
