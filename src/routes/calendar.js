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
// メモ欄から「ゲスト氏名」を抽出
// 例: "ゲスト氏名：山田 太郎\n..."  → "山田 太郎"
// ============================================================
function extractGuestName(description) {
  if (!description) return null;
  // 「ゲスト氏名」に続く行を取得（：or: どちらも対応）
  const match = description.match(/ゲスト氏名[：:]\s*(.+)/);
  if (match) return match[1].trim();
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

            const guestName = extractGuestName(ev.description);
            const startDt = ev.start?.dateTime || ev.start?.date;

            allEvents.push({
              userId: user.id,
              userName: user.name,
              calendarId: user.calendar_id,
              eventId: ev.id,
              summary: ev.summary,
              startDt,
              guestName,
              description: ev.description || '',
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
        guestName: extractGuestName(ev.description),
        description: ev.description || '',
      }));

    res.json({ ok: true, events });
  } catch (err) {
    console.error('Calendar events fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
