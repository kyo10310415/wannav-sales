'use strict';
/**
 * calendarSync.js
 * ─────────────────────────────────────────────────────────────
 * Googleカレンダーから「面接予約」イベントを取得し、
 * applicant_interview_dates テーブルに自動保存するバックグラウンドジョブ。
 *
 * 使い方（server.js から呼ぶ）:
 *   const calendarSync = require('./src/jobs/calendarSync');
 *   calendarSync.start();   // 起動時に1回実行 + 30分ごとに定期実行
 *   calendarSync.runOnce(); // 任意タイミングで1回だけ実行
 */

const { google }          = require('googleapis');
const db                  = require('../database');
const spreadsheetRoute    = require('../routes/spreadsheet');
const spreadsheetCache    = spreadsheetRoute.cache;
const { syncCalendarEvents } = require('../services/calendarInterviewSync');

// ── 状態管理（外部から参照可能） ─────────────────────────────
const state = {
  lastRunAt:     null,   // 最後に実行した日時 (Date)
  lastResult:    null,   // 最後の実行結果オブジェクト
  lastError:     null,   // 最後のエラーメッセージ (string | null)
  running:       false,  // 現在実行中かどうか
  intervalMs:    30 * 60 * 1000,  // 30分
};

// ── OAuth2 クライアント生成 ───────────────────────────────────
function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  =
    process.env.GOOGLE_REDIRECT_URI ||
    (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api/calendar/callback`
      : 'http://localhost:3000/api/calendar/callback');

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が設定されていません');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── 文字列正規化（スペース除去・全角→半角・小文字） ───────────
function normalizeName(name) {
  if (!name) return '';
  return name
    .replace(/[\s\u3000　]+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

// ── descriptionから「ゲスト氏名」抽出 ────────────────────────
function extractNameFromDescription(description) {
  if (!description) return null;
  const m = description.match(/ゲスト氏名\s*[：::]\s*([^\n\r]+)/);
  if (!m) return null;
  return m[1].trim() || null;
}

// ── descriptionから「ゲストメールアドレス」抽出 ───────────────
function extractEmailFromDescription(description) {
  if (!description) return null;
  const m = description.match(/ゲストメールアドレス\s*[：::]\s*([^\n\r\s]+)/);
  if (!m) return null;
  return m[1].trim() || null;
}

// ── summaryからの氏名抽出（フォールバック） ───────────────────
function extractNameFromSummary(summary) {
  if (!summary) return null;

  const sanColonIdx = summary.search(/さん\s*[:：]/);
  const beforeColon = sanColonIdx >= 0 ? summary.slice(0, sanColonIdx + 3) : summary;
  let s = beforeColon.trim();

  let prev = null;
  while (prev !== s) {
    prev = s;
    s = s.replace(/^【[^】]*】\s*/, '');
    s = s.replace(/^（[^）]*）\s*/, '');
    s = s.replace(/^[\u{1F000}-\u{1FFFF}]+/gu, '');
    s = s.replace(/^[\u2600-\u26FF\u2700-\u27BF]+/, '');
    s = s.replace(/^[⚠️🔸🔴⭕❌✅🟥🟡🟢🔵🟠🔶🔷🔹🔺🔻⭐★☆◆◇▶▷►▸●○■□♦♠♣♥♤♡♢♧✦✧※→←↑↓]+/u, '');
    s = s.replace(/^[\uFE00-\uFE0F]+/, '');
    s = s.trim();
  }

  const sanMatch = s.match(/^(.+?)さん/);
  if (!sanMatch) return null;

  let name = sanMatch[1].trim();
  const parts = name.split(/[\s\u3000]+/).filter(Boolean);
  if (parts.length >= 3) {
    name = parts.slice(-2).join(' ');
  }
  return name || null;
}

function extractGuestName(summary, description) {
  const fromDesc = extractNameFromDescription(description);
  if (fromDesc) return fromDesc;
  return extractNameFromSummary(summary);
}

// ── メイン同期処理 ────────────────────────────────────────────
async function runOnce() {
  if (state.running) {
    console.log('[calendarSync] 前回の同期がまだ実行中のためスキップします');
    return null;
  }

  // Google連携ユーザーが存在するか事前チェック
  const linkedUsers = db.prepare(`
    SELECT id FROM users
    WHERE calendar_id IS NOT NULL AND calendar_id != ''
      AND google_refresh_token IS NOT NULL
  `).all();

  if (linkedUsers.length === 0) {
    // 連携ユーザーが居なければ静かにスキップ（ログ過多防止）
    return null;
  }

  state.running   = true;
  state.lastRunAt = new Date();
  state.lastError = null;

  try {
    // Google連携 & calendar_id 設定済みユーザーを全取得
    const users = db.prepare(`
      SELECT id, name, calendar_id, google_refresh_token
      FROM users
      WHERE calendar_id IS NOT NULL AND calendar_id != ''
        AND google_refresh_token IS NOT NULL
    `).all();

    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 90);
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 180);

    const allEvents = [];

    for (const user of users) {
      try {
        const oauth2 = getOAuth2Client();
        oauth2.setCredentials({ refresh_token: user.google_refresh_token });
        const calendar = google.calendar({ version: 'v3', auth: oauth2 });

        let pageToken;
        do {
          const resp = await calendar.events.list({
            calendarId:    user.calendar_id,
            q:             '面接予約',
            timeMin:       timeMin.toISOString(),
            timeMax:       timeMax.toISOString(),
            singleEvents:  true,
            orderBy:       'startTime',
            maxResults:    250,
            pageToken,
          });

          for (const ev of (resp.data.items || [])) {
            if (!(ev.summary || '').includes('面接予約')) continue;
            allEvents.push({
              summary:     ev.summary,
              description: ev.description || '',
              startDt:     ev.start?.dateTime || ev.start?.date,
              guestName:   extractGuestName(ev.summary, ev.description),
              guestEmail:  extractEmailFromDescription(ev.description),
            });
          }
          pageToken = resp.data.nextPageToken;
        } while (pageToken);

      } catch (calErr) {
        console.error(`[calendarSync] ${user.name} のカレンダー取得エラー:`, calErr.message);
      }
    }

    // ── 照合 ──────────────────────────────────────────────────
    const sheetApplicants = (spreadsheetCache && spreadsheetCache.data)
      ? spreadsheetCache.data.applicants
      : [];

    const { results } = syncCalendarEvents(db, allEvents, sheetApplicants);
    const matchedCount = results.filter(r => r.matched).length;
    const unmatchedCount = results.filter(r => !r.matched).length;
    const protectedCount = results.filter(r => r.protected).length;
    const ambiguousCount = results.filter(r => r.ambiguous).length;

    const result = {
      at:          state.lastRunAt.toISOString(),
      totalEvents: allEvents.length,
      matched:     matchedCount,
      unmatched:   unmatchedCount,
      protected:   protectedCount,
      ambiguous:   ambiguousCount,
    };
    state.lastResult = result;

    console.log(
      `[calendarSync] 完了 — イベント:${allEvents.length}件 ` +
      `照合成功:${matchedCount}件 未照合:${unmatchedCount}件`
    );
    return result;

  } catch (err) {
    state.lastError = err.message;
    console.error('[calendarSync] 同期エラー:', err.message);
    return null;
  } finally {
    state.running = false;
  }
}

// ── 定期実行開始 ──────────────────────────────────────────────
function start(intervalMs) {
  if (intervalMs) state.intervalMs = intervalMs;

  // 起動時に少し遅らせて1回実行（DBやキャッシュの初期化を待つ）
  setTimeout(() => {
    runOnce().catch(err => console.error('[calendarSync] 初回同期エラー:', err.message));
  }, 10 * 1000); // 10秒後

  // 以降は定期実行
  setInterval(() => {
    runOnce().catch(err => console.error('[calendarSync] 定期同期エラー:', err.message));
  }, state.intervalMs);

  console.log(
    `[calendarSync] 定期同期を開始しました（間隔: ${state.intervalMs / 60000}分）`
  );
}

module.exports = { start, runOnce, state };
