'use strict';
/**
 * surpriseCall.js
 * GET /api/surprise-call
 *   → サプライズコールスプレッドシートの全データを返す
 * POST /api/surprise-call/refresh
 *   → キャッシュをクリアして再取得
 */

const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const { authenticateToken } = require('../middleware/auth');

// ── スプレッドシート設定 ──────────────────────────────────────
const SPREADSHEET_ID = '1bDLJJuSx9LK1pr00478iQooUagLtGzfv8h8V-p6Etvs';
const SHEET_NAME     = 'サプライズコール結果';
const RANGE          = `'${SHEET_NAME}'!A1:T5000`;

// ── キャッシュ（TTL: 10分）──────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = {
  rows:      null,
  headers:   null,
  fetchedAt: null,
  isValid() {
    return this.rows && this.fetchedAt && (Date.now() - this.fetchedAt < CACHE_TTL_MS);
  },
  set(headers, rows) {
    this.headers   = headers;
    this.rows      = rows;
    this.fetchedAt = Date.now();
  },
  clear() {
    this.rows = null; this.headers = null; this.fetchedAt = null;
  },
  ageSeconds() {
    return this.fetchedAt ? Math.floor((Date.now() - this.fetchedAt) / 1000) : null;
  },
};

// ── Google Sheets クライアント ───────────────────────────────
async function getClient() {
  const creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (creds) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(creds),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth });
  } else if (process.env.GOOGLE_API_KEY) {
    return google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
  }
  throw new Error('Google認証情報が設定されていません');
}

// ── データ取得・加工 ─────────────────────────────────────────
// 期待するヘッダー定義（左から順 A〜T列）
const EXPECTED_HEADERS = [
  'タイムスタンプ',
  'メールアドレス',
  '学籍番号',
  '架電時間帯',
  '架電結果',
  '入会の手続きの満足度',
  'お手続きの中で不安に感じた点',
  '一番気になるトピック',
  '担当者は信頼できるか？',
  '担当者に対する評価の理由',
  '今の熱量を0~10点で教えてください',
  'どんな景色を見たいと思っているか？',
  'ステータス',
  'CO開け日（目安）',
  '合計点',
  '口コミ共有済み',
  'ユニーク生徒数',
  '指定範囲のユニーク生徒数',
  'クーリングオフ数',
  '指定範囲内のクーリングオフ率',
];

async function fetchSheet() {
  const sheets   = await getClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const allRows = response.data.values || [];
  if (allRows.length === 0) return { headers: EXPECTED_HEADERS, rows: [] };

  // 1行目をヘッダーとして使用（実際のヘッダーが取れる場合はそれを優先）
  const headerRow = allRows[0];
  const headers   = EXPECTED_HEADERS; // 定義済みヘッダーを使用

  // 2行目以降をデータ行としてオブジェクト配列に変換
  const rows = allRows.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 }; // スプレッドシートの行番号（1-indexed, ヘッダー除く）
    headers.forEach((h, i) => {
      obj[h] = (row[i] !== undefined && row[i] !== null) ? String(row[i]).trim() : '';
    });
    return obj;
  }).filter(r => {
    // 完全に空の行を除外（タイムスタンプか学籍番号のどちらかがあれば有効）
    return r['タイムスタンプ'] || r['学籍番号'] || r['メールアドレス'];
  });

  return { headers, rows };
}

// ── GET /api/surprise-call ───────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (!cache.isValid()) {
      const { headers, rows } = await fetchSheet();
      cache.set(headers, rows);
    }
    res.json({
      headers:    cache.headers,
      rows:       cache.rows,
      total:      cache.rows.length,
      fetchedAt:  cache.fetchedAt,
      cacheAgeSeconds: cache.ageSeconds(),
    });
  } catch (err) {
    console.error('[SurpriseCall] fetch error:', err.message);
    res.status(500).json({ error: 'データの取得に失敗しました: ' + err.message });
  }
});

// ── POST /api/surprise-call/refresh ─────────────────────────
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    cache.clear();
    const { headers, rows } = await fetchSheet();
    cache.set(headers, rows);
    res.json({
      headers,
      rows,
      total: rows.length,
      fetchedAt: cache.fetchedAt,
      cacheAgeSeconds: 0,
    });
  } catch (err) {
    console.error('[SurpriseCall] refresh error:', err.message);
    res.status(500).json({ error: '更新に失敗しました: ' + err.message });
  }
});

module.exports = router;
