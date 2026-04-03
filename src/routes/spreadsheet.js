const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { authenticateToken } = require('../middleware/auth');

const SPREADSHEET_ID = '1H0CctpkCJ4PVZ5cf1YYI7_elNwUu0uIcHIHMNTHYHW4';
const SHEET_NAME = 'アススタ';
const RANGE = `${SHEET_NAME}!A1:AA`;

// 非表示にする列のヘッダー名（部分一致）
const HIDDEN_COLUMN_PATTERNS = [
  'タイムスタンプ',
  '性',       // 「性」単体（姓）
  '名',       // 「名」単体
  '自己PR',
  '自動化処理済',
  '一次面接面接連絡済',
  'リマインド送付時',
  '飛びリマインド',
];

// 列ヘッダーが非表示対象かチェック
function isHiddenColumn(headerName) {
  if (!headerName) return false;
  const h = headerName.trim();
  // 完全一致チェック（「性」「名」は完全一致のみ非表示）
  if (h === '性' || h === '名') return true;
  // 部分一致チェック
  return HIDDEN_COLUMN_PATTERNS.some(pattern => {
    if (pattern === '性' || pattern === '名') return false; // 上で処理済み
    return h.includes(pattern);
  });
}

async function getGoogleSheetsClient() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (credentials) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentials),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth });
  } else if (process.env.GOOGLE_API_KEY) {
    return google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
  } else {
    throw new Error('Google認証情報が設定されていません。環境変数 GOOGLE_SERVICE_ACCOUNT_JSON または GOOGLE_API_KEY を設定してください。');
  }
}

// 応募日文字列をDateオブジェクトに変換（日本語形式対応）
function parseApplicantDate(dateStr) {
  if (!dateStr) return null;
  // "2024/1/15 10:30:00" や "2024-01-15" など
  const d = new Date(dateStr.replace(/\//g, '-'));
  if (!isNaN(d.getTime())) return d;
  return null;
}

// 応募日が指定期間内かチェック
function isInPeriod(dateStr, period, value) {
  if (!period || !value || !dateStr) return true;
  const d = parseApplicantDate(dateStr);
  if (!d) return true;

  if (period === 'month') {
    // value: "YYYY-MM"
    const [year, month] = value.split('-');
    return d.getFullYear() === parseInt(year) && (d.getMonth() + 1) === parseInt(month);
  } else if (period === 'week') {
    // value: "YYYY-WXX"
    const [yearStr, weekStr] = value.split('-W');
    const targetYear = parseInt(yearStr);
    const targetWeek = parseInt(weekStr);

    const startOfYear = new Date(targetYear, 0, 1);
    const dayOfYear = Math.floor((d - startOfYear) / 86400000);
    const weekNum = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);

    return d.getFullYear() === targetYear && weekNum === targetWeek;
  }
  return true;
}

// GET /api/spreadsheet/applicants
router.get('/applicants', authenticateToken, async (req, res) => {
  const { period, value } = req.query; // 期間フィルタ（オプション）

  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.json({ applicants: [], headers: [], visibleHeaders: [], total: 0 });
    }

    const rawHeaders = rows[0];
    const dataRows = rows.slice(1);

    // 列のインデックスをヘッダー名で特定
    const COL_LAST_NAME = rawHeaders.findIndex(h => h && h.trim() === '性');
    const COL_FIRST_NAME = rawHeaders.findIndex(h => h && h.trim() === '名');
    const COL_EMAIL = rawHeaders.findIndex(h => h && h.trim().includes('メールアドレス'));

    // 応募日の列を特定（A列が応募日想定だが、ヘッダーでも探す）
    let COL_DATE = rawHeaders.findIndex(h => h && (h.trim().includes('応募日') || h.trim() === 'タイムスタンプ'));
    if (COL_DATE === -1) COL_DATE = 0; // fallback: A列

    // 表示する列を決定（非表示列を除外、ただし性・名は full_name として別扱い）
    const visibleColIndices = [];
    rawHeaders.forEach((h, i) => {
      if (!isHiddenColumn(h)) {
        visibleColIndices.push(i);
      }
    });

    // 重複除外（性・名・メール）
    const seen = new Set();
    const uniqueApplicants = [];

    dataRows.forEach((row, rowIndex) => {
      while (row.length < rawHeaders.length) row.push('');

      const lastName = COL_LAST_NAME >= 0 ? (row[COL_LAST_NAME] || '').trim() : '';
      const firstName = COL_FIRST_NAME >= 0 ? (row[COL_FIRST_NAME] || '').trim() : '';
      const email = COL_EMAIL >= 0 ? (row[COL_EMAIL] || '').trim() : '';
      const fullName = `${lastName}${firstName}`.trim();
      const dateStr = row[COL_DATE] || '';

      if (!lastName && !firstName && !email) return;

      const key = `${lastName}|${firstName}|${email}`;
      if (seen.has(key)) return;
      seen.add(key);

      // 表示用の列データ（非表示列を除外）
      const visibleData = visibleColIndices.map(i => ({
        header: rawHeaders[i] || '',
        value: row[i] || '',
        colIndex: i,
      }));

      uniqueApplicants.push({
        row_index: rowIndex + 2,
        last_name: lastName,
        first_name: firstName,
        full_name: fullName || `${lastName} ${firstName}`.trim(),
        email: email,
        date_str: dateStr,
        date_parsed: parseApplicantDate(dateStr),
        visible_data: visibleData,
        // 生の全列データ（営業報告モーダル用）
        raw: rawHeaders.reduce((acc, h, i) => {
          acc[h || `col_${i}`] = row[i] || '';
          return acc;
        }, {}),
      });
    });

    // 応募日降順ソート
    uniqueApplicants.sort((a, b) => {
      const da = a.date_parsed ? a.date_parsed.getTime() : 0;
      const db_ = b.date_parsed ? b.date_parsed.getTime() : 0;
      return db_ - da; // 降順
    });

    // 期間フィルタが指定された場合、その期間の応募者数を返す
    let periodCount = null;
    if (period && value) {
      periodCount = uniqueApplicants.filter(a => isInPeriod(a.date_str, period, value)).length;
    }

    // 表示用ヘッダー（非表示列除外）
    const visibleHeaders = visibleColIndices.map(i => rawHeaders[i] || '');

    res.json({
      applicants: uniqueApplicants,
      headers: rawHeaders,
      visibleHeaders: visibleHeaders,
      visibleColIndices: visibleColIndices,
      col_date_index: COL_DATE,
      col_date_header: rawHeaders[COL_DATE] || '応募日',
      total: uniqueApplicants.length,
      period_count: periodCount,
    });

  } catch (err) {
    console.error('Spreadsheet error:', err);
    res.status(500).json({
      error: 'スプレッドシートの取得に失敗しました: ' + err.message,
      details: err.toString()
    });
  }
});

// GET /api/spreadsheet/applicants/count - 期間別応募数取得
router.get('/applicants/count', authenticateToken, async (req, res) => {
  const { period, value } = req.query;

  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.json({ count: 0, period, value });
    }

    const rawHeaders = rows[0];
    const dataRows = rows.slice(1);

    const COL_LAST_NAME = rawHeaders.findIndex(h => h && h.trim() === '性');
    const COL_FIRST_NAME = rawHeaders.findIndex(h => h && h.trim() === '名');
    const COL_EMAIL = rawHeaders.findIndex(h => h && h.trim().includes('メールアドレス'));
    let COL_DATE = rawHeaders.findIndex(h => h && (h.trim().includes('応募日') || h.trim() === 'タイムスタンプ'));
    if (COL_DATE === -1) COL_DATE = 0;

    const seen = new Set();
    let count = 0;

    dataRows.forEach(row => {
      while (row.length < rawHeaders.length) row.push('');
      const lastName = COL_LAST_NAME >= 0 ? (row[COL_LAST_NAME] || '').trim() : '';
      const firstName = COL_FIRST_NAME >= 0 ? (row[COL_FIRST_NAME] || '').trim() : '';
      const email = COL_EMAIL >= 0 ? (row[COL_EMAIL] || '').trim() : '';
      const dateStr = row[COL_DATE] || '';

      if (!lastName && !firstName && !email) return;
      const key = `${lastName}|${firstName}|${email}`;
      if (seen.has(key)) return;
      seen.add(key);

      if (isInPeriod(dateStr, period, value)) {
        count++;
      }
    });

    res.json({ count, period, value });
  } catch (err) {
    res.status(500).json({ error: err.message, count: 0 });
  }
});

module.exports = router;
