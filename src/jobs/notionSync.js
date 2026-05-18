'use strict';
/**
 * notionSync.js
 * ─────────────────────────────────────────────────────────────
 * Notionデータベースから応募者詳細プロファイルを毎日1回取得して
 * notion_profiles テーブルに保存するバックグラウンドジョブ。
 *
 * 使い方（server.js から呼ぶ）:
 *   const notionSync = require('./src/jobs/notionSync');
 *   notionSync.start();   // 起動時に1回実行 + 毎日午前3時に定期実行
 *   notionSync.runOnce(); // 任意タイミングで1回だけ実行
 */

const { syncNotionProfiles } = require('../routes/notion');

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24時間

const state = {
  lastRunAt:  null,
  lastResult: null,
  lastError:  null,
  running:    false,
  timer:      null,
};

async function runOnce() {
  if (state.running) return;
  state.running = true;
  state.lastError = null;
  try {
    const result = await syncNotionProfiles();
    state.lastResult = result;
    state.lastRunAt  = new Date();
    console.log(`[notionSync] 完了: ${result.saved}件保存`);
  } catch (err) {
    state.lastError = err.message;
    console.error('[notionSync] エラー:', err.message);
  } finally {
    state.running = false;
  }
}

function scheduleNext() {
  // 次の午前3時00分まで待つ
  const now  = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next - now;
  console.log(`[notionSync] 次回実行: ${next.toLocaleString('ja-JP')} (${Math.round(ms/3600000)}時間後)`);
  state.timer = setTimeout(async () => {
    await runOnce();
    scheduleNext();
  }, ms);
}

function start() {
  // 起動30秒後に初回実行（NOTION_API_KEY が未設定なら静かにスキップ）
  setTimeout(async () => {
    if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
      console.log('[notionSync] NOTION_API_KEY / NOTION_DATABASE_ID 未設定のためスキップ');
      return;
    }
    await runOnce();
    scheduleNext();
  }, 30 * 1000);
}

module.exports = { start, runOnce, state };
