const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const db = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const spreadsheetCache = require('./spreadsheet').cache;

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
// メモ欄（description）から「ゲスト氏名」を抽出
// 例:
//   「ゲスト氏名 : 阿野 楽土」
//   「ゲスト氏名: 山田太郎」
// ============================================================
function extractNameFromDescription(description) {
  if (!description) return null;
  // 「ゲスト氏名 :」または「ゲスト氏名:」の後ろの値を取得
  const m = description.match(/ゲスト氏名\s*[：::]\s*([^\n\r]+)/);
  if (!m) return null;
  const name = m[1].trim();
  return name || null;
}

// ============================================================
// メモ欄（description）から「ゲストメールアドレス」を抽出
// 例:
//   「ゲストメールアドレス : keiji.sg.fps0530@gmail.com」
// ============================================================
function extractEmailFromDescription(description) {
  if (!description) return null;
  const m = description.match(/ゲストメールアドレス\s*[：::]\s*([^\n\r\s]+)/);
  if (!m) return null;
  const email = m[1].trim();
  return email || null;
}

// ============================================================
// スケジュールタイトルから氏名を抽出（descriptionで取れない場合のフォールバック）
// 例:
//   🔸大久保弘晃さん: VTuberプロダクション「アススタ」面接予約
//   ⚠️小笠原圭悟さん: 【明日まで】...面接予約
//   🔴【一言】井畑匡人さん: ...面接予約
//   【学】🔸田辺雅人さん: ...面接予約
//   八尋 伊央利さん（スペース区切りの姓名）
//   社団医療法人 啓愛会 孝仁病院 黒木 瞳花さん（法人名混入）
//   （転職案内成功した方）🔸藤本樹さん: ...（全角カッコ前置き）
//   ⭐️荷宮礁さん: ...（⭐️ = U+2B50 + U+FE0F バリアント）
// ============================================================
function extractNameFromSummary(summary) {
  if (!summary) return null;

  // ① 「さんの後ろのコロン」より前だけを対象（会社名・会場名を除外）
  //    ※ 単純な split(/[:：]/) は【18:00まで】内のコロンでも誤分割するため使用不可
  //    「さん:」「さん：」が現れる位置でカットし、なければ全体を対象にする
  const sanColonIdx = summary.search(/さん\s*[:：]/);
  const beforeColon = sanColonIdx >= 0 ? summary.slice(0, sanColonIdx + 3) : summary;
  let s = beforeColon.trim();

  // ② 先頭の【...】・（...）タグ・絵文字・記号を繰り返し除去
  //    ※ \u{24C2}-\u{1F251} のような広範囲は漢字・ひらがなも含むため使用不可
  let prev = null;
  while (prev !== s) {
    prev = s;
    // 【...】タグ（時刻・メモ付き）
    s = s.replace(/^【[^】]*】\s*/, '');
    // （...）全角丸括弧タグ
    s = s.replace(/^（[^）]*）\s*/, '');
    // サロゲートペア絵文字（U+1F000〜U+1FFFF）― 漢字を含まない安全な範囲
    s = s.replace(/^[\u{1F000}-\u{1FFFF}]+/gu, '');
    // 一般記号・装飾記号（U+2600〜U+27BF）― 日本語文字を含まない安全な範囲
    s = s.replace(/^[\u2600-\u26FF\u2700-\u27BF]+/, '');
    // よく使われる絵文字・記号の直接指定（⭐ U+2B50 も追加）
    s = s.replace(/^[⚠️🔸🔴⭕❌✅🟥🟡🟢🔵🟠🔶🔷🔹🔺🔻⭐★☆◆◇▶▷►▸●○■□♦♠♣♥♤♡♢♧✦✧※→←↑↓]+/u, '');
    // 異体字セレクタ・バリアント（U+FE00〜U+FE0F）
    s = s.replace(/^[\uFE00-\uFE0F]+/, '');
    s = s.trim();
  }

  // ③ 「さん」の直前までを名前として取得
  //    姓名間のスペース（半角・全角）も名前の一部として許容する
  const sanMatch = s.match(/^(.+?)さん/);
  if (!sanMatch) return null;

  let name = sanMatch[1].trim();

  // ④ 法人名が混入している場合（スペース区切りで3語以上）は末尾2語だけ使う
  //    例: "社団医療法人 啓愛会 孝仁病院 黒木 瞳花" → "黒木 瞳花"
  //    ※ ただし外国人名（小川 ラファエル タカシ等）は末尾1語だけ使う
  const parts = name.split(/[\s\u3000]+/).filter(Boolean);
  if (parts.length >= 3) {
    // 末尾2語が片方カタカナ・片方漢字なら外国人名として末尾2語を採用
    // それ以外（全員漢字等）も末尾2語を採用（法人名ケース）
    name = parts.slice(-2).join(' ');
  }

  return name || null;
}

// ============================================================
// イベントから氏名を取得（description優先、なければsummaryから抽出）
// ============================================================
function extractGuestName(summary, description) {
  // メモ欄の「ゲスト氏名」が最も確実
  const fromDesc = extractNameFromDescription(description);
  if (fromDesc) return fromDesc;
  // フォールバック: タイトルから抽出
  return extractNameFromSummary(summary);
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
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
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
              userId:      user.id,
              userName:    user.name,
              eventId:     ev.id,
              summary:     ev.summary,
              description: ev.description || '',
              startDt:     ev.start?.dateTime || ev.start?.date,
              guestName:   extractGuestName(ev.summary, ev.description),
              nameSource:  extractNameFromDescription(ev.description) ? 'description' : 'summary',
            });
          }
          pageToken = resp.data.nextPageToken;
        } while (pageToken);

      } catch (calErr) {
        console.error(`Calendar sync error for ${user.name}:`, calErr.message);
      }
    }

    // ============================================================
    // 照合用データ: スプレッドシートキャッシュ（優先）
    // スプレッドシートに5000件超の応募者データが存在するため
    // sales_reports（営業報告未入力の場合0件）ではなくキャッシュを使う
    // ============================================================
    const sheetApplicants = (spreadsheetCache && spreadsheetCache.data)
      ? spreadsheetCache.data.applicants
      : [];

    // メール→キーのマップ（高速照合用）
    const emailToKey = new Map();
    for (const ap of sheetApplicants) {
      if (ap.email) emailToKey.set(ap.email.toLowerCase().trim(), ap.email.trim());
    }

    // 既存の面接日レコードキー一覧
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
      if (!ev.startDt) continue;
      const guestName  = ev.guestName;
      const guestEmail = extractEmailFromDescription(ev.description);

      let matched = null;
      let matchMethod = null;

      // ① メールアドレスで照合（最優先・最確実）
      if (guestEmail) {
        const key = emailToKey.get(guestEmail.toLowerCase().trim());
        if (key) { matched = { key }; matchMethod = 'email'; }
      }

      // ② 氏名で照合（スプレッドシートキャッシュ）
      if (!matched && guestName) {
        const normGuest = normalizeName(guestName);
        for (const ap of sheetApplicants) {
          if (ap.full_name && normalizeName(ap.full_name) === normGuest) {
            matched = { key: ap.email?.trim() || ap.full_name };
            matchMethod = 'name_sheet';
            break;
          }
        }
      }

      // ③ 既存 applicant_interview_dates キーで照合
      if (!matched && guestName) {
        const normGuest = normalizeName(guestName);
        for (const key of allDateKeys) {
          if (normalizeName(key) === normGuest) {
            matched = { key };
            matchMethod = 'name_existing';
            break;
          }
        }
      }

      if (!matched) {
        matchResults.push({
          guestName: guestName || '(氏名なし)',
          guestEmail,
          startDt: ev.startDt,
          matched: false,
        });
        continue;
      }

      upsert.run(matched.key, ev.startDt.substring(0, 10));
      matchResults.push({
        guestName, guestEmail,
        applicantKey: matched.key,
        matchMethod,
        startDt: ev.startDt,
        interviewDate: ev.startDt.substring(0, 10),
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
            summary:     ev.summary,
            startDt:     ev.start?.dateTime || ev.start?.date,
            fromDesc:    extractNameFromDescription(ev.description),
            fromSummary: extractNameFromSummary(ev.summary),
            extracted:   extractGuestName(ev.summary, ev.description),
            nameSource:  extractNameFromDescription(ev.description) ? 'description' : 'summary',
            descSnippet: (ev.description || '').slice(0, 200),
          })),
        });

        // 照合状況もデバッグ出力
        const knownApplicants = db.prepare(
          'SELECT DISTINCT applicant_full_name AS full_name, applicant_email AS email FROM sales_reports'
        ).all();
        const matchDebug = items2.slice(0, 5).map(ev => {
          const guestName = extractGuestName(ev.summary, ev.description);
          const normGuest = normalizeName(guestName || '');
          const hit = knownApplicants.find(ap => ap.full_name && normalizeName(ap.full_name) === normGuest);
          return {
            guestName,
            normGuest,
            matched: !!hit,
            matchedKey: hit ? (hit.email || hit.full_name) : null,
            sampleKnown: knownApplicants.slice(0, 3).map(ap => ({
              full_name: ap.full_name,
              norm: normalizeName(ap.full_name),
            })),
          };
        });
        log.push({ step: `match_debug_${u.name}`, matchDebug, totalKnown: knownApplicants.length });
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
