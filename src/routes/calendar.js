const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const db = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// ============================================================
// OAuth2クライアント生成
// ============================================================
function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI ||
    (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api/calendar/callback`
      : 'http://localhost:3000/api/calendar/callback');

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が設定されていません');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ユーザーIDからOAuth2クライアント（トークン付き）を取得
function getAuthedClient(userId) {
  const user = db.prepare(
    'SELECT google_refresh_token, google_email FROM users WHERE id = ?'
  ).get(userId);

  if (!user || !user.google_refresh_token) {
    throw new Error('Googleアカウントが連携されていません');
  }

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: user.google_refresh_token });
  return oauth2;
}

// ============================================================
// 氏名を正規化（スペース除去・全角→半角・小文字）
// ============================================================
function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/[\s\u3000　]+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

// ============================================================
// スケジュール名から氏名を抽出
// 例:
//   🔸大久保弘晃さん: VTuberプロダクション「アススタ」面接予約
//   ⚠️小笠原圭悟さん: 【明日まで】...面接予約
//   🔴【一言】井畑匡人さん: ...面接予約
//   【学】🔸田辺雅人さん: ...面接予約
// ============================================================
function extractNameFromSummary(summary) {
  if (!summary) return null;

  let s = summary.replace(/^[\s\u3000　\u200d\ufe0f\u20e3]*/, '');

  let prev = null;
  while (prev !== s) {
    prev = s;
    s = s.replace(/^【[^】]*】/, '').trim();
    s = s.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F300}-\u{1F9FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F004}\u{1F0CF}⚠️🔸🔴⭕❌✅🟥🟡🟢🔵🟠]+/u, '').trim();
    s = s.replace(/^[★☆◆◇▶▷►▸●○■□♦♠♣♥♤♡♢♧✦✧※→←↑↓]+/, '').trim();
  }

  const match = s.match(/^([^\s:：【\n]+?)\s*さん/);
  if (match) return match[1].trim();
  return null;
}

// ============================================================
// GET /api/calendar/auth-url
// ログイン中のユーザー用のGoogle OAuth認証URLを返す
// ============================================================
router.get('/auth-url', authenticateToken, (req, res) => {
  try {
    const oauth2 = getOAuth2Client();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',         // 毎回リフレッシュトークンを取得
      scope: ['https://www.googleapis.com/auth/calendar.readonly'],
      state: String(req.user.id), // コールバックでユーザーIDを特定
    });
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/calendar/callback
// Google OAuth コールバック。認可コードをトークンに交換してDBに保存
// ============================================================
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`
      <script>
        window.opener && window.opener.postMessage(
          { type: 'GOOGLE_AUTH_ERROR', error: '${error}' }, '*'
        );
        window.close();
      </script>
    `);
  }

  if (!code || !state) {
    return res.status(400).send('パラメータが不正です');
  }

  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      return res.send(`
        <script>
          window.opener && window.opener.postMessage(
            { type: 'GOOGLE_AUTH_ERROR',
              error: 'リフレッシュトークンが取得できませんでした。もう一度試してください。' }, '*'
          );
          window.close();
        </script>
      `);
    }

    // Googleアカウントのメールアドレスを取得
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data: userInfo } = await oauth2Api.userinfo.get();
    const googleEmail = userInfo.email || '';

    // DBにリフレッシュトークンを保存
    const userId = parseInt(state, 10);
    db.prepare(`
      UPDATE users
      SET google_refresh_token = ?,
          google_email         = ?,
          updated_at           = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(tokens.refresh_token, googleEmail, userId);

    // ポップアップを閉じて親ウィンドウに成功を通知
    return res.send(`
      <html><head><meta charset="utf-8"></head><body>
      <p>連携が完了しました。このウィンドウは自動的に閉じます。</p>
      <script>
        window.opener && window.opener.postMessage(
          { type: 'GOOGLE_AUTH_SUCCESS', email: '${googleEmail}' }, '*'
        );
        setTimeout(() => window.close(), 1500);
      </script>
      </body></html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.send(`
      <script>
        window.opener && window.opener.postMessage(
          { type: 'GOOGLE_AUTH_ERROR', error: '${err.message}' }, '*'
        );
        window.close();
      </script>
    `);
  }
});

// ============================================================
// DELETE /api/calendar/token
// ログイン中のユーザーのOAuthトークンを削除（連携解除）
// ============================================================
router.delete('/token', authenticateToken, (req, res) => {
  db.prepare(`
    UPDATE users
    SET google_refresh_token = NULL,
        google_email         = NULL,
        updated_at           = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.user.id);
  res.json({ ok: true });
});

// ============================================================
// POST /api/calendar/sync
// calendar_id かつ google_refresh_token があるユーザーのカレンダーから
// 「面接予約」イベントを取得→氏名照合→面接日をUPSERT
// ============================================================
router.post('/sync', authenticateToken, async (req, res) => {
  try {
    // OAuthトークン保持 & calendar_id 設定済みユーザーを取得
    const users = db.prepare(`
      SELECT id, name, login_id, calendar_id, google_refresh_token, google_email
      FROM users
      WHERE calendar_id IS NOT NULL AND calendar_id != ''
        AND google_refresh_token IS NOT NULL
    `).all();

    if (users.length === 0) {
      return res.json({
        ok: true,
        message: 'Googleアカウントが連携されているユーザーがいません。ユーザー管理画面で連携してください。',
        totalEvents: 0,
        matched: 0,
        results: [],
      });
    }

    const timeMin = new Date(); timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date(); timeMax.setDate(timeMax.getDate() + 180);

    const allEvents = [];

    for (const user of users) {
      try {
        const oauth2 = getOAuth2Client();
        oauth2.setCredentials({ refresh_token: user.google_refresh_token });
        const calendar = google.calendar({ version: 'v3', auth: oauth2 });

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

          for (const ev of (resp.data.items || [])) {
            if (!(ev.summary || '').includes('面接予約')) continue;
            allEvents.push({
              userId:    user.id,
              userName:  user.name,
              eventId:   ev.id,
              summary:   ev.summary,
              startDt:   ev.start?.dateTime || ev.start?.date,
              guestName: extractNameFromSummary(ev.summary),
            });
          }
          pageToken = resp.data.nextPageToken;
        } while (pageToken);

      } catch (calErr) {
        console.error(`Calendar sync error for ${user.name}:`, calErr.message);
      }
    }

    // 照合用データ: sales_reports + applicant_interview_dates
    const knownApplicants = db.prepare(`
      SELECT DISTINCT applicant_full_name AS full_name, applicant_email AS email
      FROM sales_reports
    `).all();

    const allDateKeys = db.prepare(
      'SELECT applicant_key FROM applicant_interview_dates'
    ).all().map(r => r.applicant_key);

    const upsert = db.prepare(`
      INSERT INTO applicant_interview_dates (applicant_key, interview_date, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(applicant_key) DO UPDATE SET
        interview_date = excluded.interview_date,
        updated_at     = CURRENT_TIMESTAMP
    `);

    const matchResults = [];

    for (const ev of allEvents) {
      if (!ev.guestName || !ev.startDt) continue;

      const normGuest = normalizeName(ev.guestName);
      let matched = null;

      for (const ap of knownApplicants) {
        if (ap.full_name && normalizeName(ap.full_name) === normGuest) {
          matched = { key: ap.email?.trim() || ap.full_name };
          break;
        }
      }
      if (!matched) {
        for (const key of allDateKeys) {
          if (normalizeName(key) === normGuest) { matched = { key }; break; }
        }
      }

      if (!matched) {
        matchResults.push({ guestName: ev.guestName, startDt: ev.startDt, matched: false });
        continue;
      }

      upsert.run(matched.key, ev.startDt.substring(0, 10));
      matchResults.push({
        guestName: ev.guestName, applicantKey: matched.key,
        startDt: ev.startDt, interviewDate: ev.startDt.substring(0, 10), matched: true,
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
// GET /api/calendar/status
// ログイン中ユーザーの連携状態を返す
// ============================================================
router.get('/status', authenticateToken, (req, res) => {
  const user = db.prepare(
    'SELECT google_email, google_refresh_token FROM users WHERE id = ?'
  ).get(req.user.id);

  res.json({
    linked: !!(user?.google_refresh_token),
    email:  user?.google_email || null,
  });
});

// ============================================================
// GET /api/calendar/debug  （診断用、本番でも残しておく）
// ============================================================
router.get('/debug', authenticateToken, async (req, res) => {
  const log = [];
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    log.push({ step: 'env', GOOGLE_CLIENT_ID: clientId ? '設定済み' : '未設定',
      GOOGLE_CLIENT_SECRET: clientSecret ? '設定済み' : '未設定' });

    const users = db.prepare(`
      SELECT id, name, calendar_id,
             CASE WHEN google_refresh_token IS NOT NULL THEN 1 ELSE 0 END AS has_token,
             google_email
      FROM users
    `).all();
    log.push({ step: 'users', users });

    for (const u of users.filter(u => u.has_token && u.calendar_id)) {
      try {
        const oauth2 = getOAuth2Client();
        const dbUser = db.prepare('SELECT google_refresh_token FROM users WHERE id = ?').get(u.id);
        oauth2.setCredentials({ refresh_token: dbUser.google_refresh_token });
        const calendar = google.calendar({ version: 'v3', auth: oauth2 });

        const timeMin = new Date(); timeMin.setDate(timeMin.getDate() - 90);
        const timeMax = new Date(); timeMax.setDate(timeMax.getDate() + 180);

        const resp = await calendar.events.list({
          calendarId: u.calendar_id, timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(), singleEvents: true, maxResults: 5,
        });
        const items = resp.data.items || [];
        log.push({
          step: `fetch_${u.name}`, status: 'OK',
          total: items.length,
          sampleTitles: items.map(ev => ev.summary || '(タイトルなし)'),
        });

        const resp2 = await calendar.events.list({
          calendarId: u.calendar_id, q: '面接予約',
          timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
          singleEvents: true, maxResults: 20,
        });
        const items2 = (resp2.data.items || []).filter(ev => (ev.summary||'').includes('面接予約'));
        log.push({
          step: `filter_${u.name}`, status: 'OK',
          count: items2.length,
          events: items2.map(ev => ({
            summary: ev.summary,
            startDt: ev.start?.dateTime || ev.start?.date,
            extracted: extractNameFromSummary(ev.summary),
          })),
        });
      } catch (e) {
        log.push({ step: `fetch_${u.name}`, status: 'ERROR', msg: e.message });
      }
    }
  } catch (err) {
    log.push({ step: 'fatal', error: err.message });
  }
  res.json({ log });
});

module.exports = router;
