const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { authenticateToken } = require('../middleware/auth');

const SPREADSHEET_ID = '1H0CctpkCJ4PVZ5cf1YYI7_elNwUu0uIcHIHMNTHYHW4';
const SHEET_NAME = 'アススタ';
const RANGE = `${SHEET_NAME}!A1:AA`;

// ============================================================
// メモリキャッシュ（TTL: 5分）
// ============================================================
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

const cache = {
  data: null,         // 処理済みデータ
  rawRows: null,      // 生のrows（count用）
  rawHeaders: null,
  fetchedAt: null,    // 最終取得時刻
  fetching: false,    // 取得中フラグ（重複リクエスト防止）
  fetchPromise: null, // 進行中のfetchをまとめる

  isValid() {
    return this.data && this.fetchedAt && (Date.now() - this.fetchedAt < CACHE_TTL_MS);
  },

  set(data, rawRows, rawHeaders) {
    this.data = data;
    this.rawRows = rawRows;
    this.rawHeaders = rawHeaders;
    this.fetchedAt = Date.now();
    this.fetching = false;
    this.fetchPromise = null;
    console.log(`[Cache] Updated: ${data.applicants.length} applicants at ${new Date().toISOString()}`);
  },

  clear() {
    this.data = null;
    this.rawRows = null;
    this.rawHeaders = null;
    this.fetchedAt = null;
  },

  ageSeconds() {
    if (!this.fetchedAt) return null;
    return Math.floor((Date.now() - this.fetchedAt) / 1000);
  }
};

// ============================================================
// 非表示列（ヘッダー名完全一致）
// 実際のスプレッドシートのヘッダー行 (A～AA列) に合わせて定義:
//   A:タイムスタンプ B:応募日 C:応募月 D:姓 E:名 F:メールアドレス
//   G:性別 H:生年月日 I:ご希望のユニット J:現在のご職業 K:自己PR
//   L:一次面接担当 M:二次面接担当 N:書類通過 O:面接予約 P:一次面接実施
//   Q:AIレコメン実施 R:面接実施 S:飛び T:CV U:氏名（本名）
//   V:自動化処理済 W:一次面接面接連絡済 X:広告媒体 Y:リマインド送付時予約有無
//   Z:飛びリマインド送付 AA:ブラックリスト
// ============================================================
const HIDDEN_COLUMNS_EXACT = new Set([
  'タイムスタンプ',          // A列
  '姓',                      // D列
  '名',                      // E列
  'メールアドレス',          // F列
  'ご希望のユニット',        // I列
  '現在のご職業',            // J列
  '自己PR',                  // K列
  '氏名（本名）',            // U列（先頭に固定表示するため列データからは除外）
  '自動化処理済',            // V列
  '一次面接面接連絡済',      // W列
  'リマインド送付時予約有無',// Y列
  '飛びリマインド送付',      // Z列
]);

function isHiddenColumn(headerName) {
  if (!headerName) return false;
  const h = headerName.trim();
  return HIDDEN_COLUMNS_EXACT.has(h);
}

// ============================================================
// Google Sheets クライアント
// ============================================================
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
    throw new Error('Google認証情報が設定されていません');
  }
}

// ============================================================
// 日付パース・期間チェック
// ============================================================
function parseApplicantDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.replace(/\//g, '-'));
  return isNaN(d.getTime()) ? null : d;
}

function isInPeriod(dateStr, period, value) {
  if (!period || !value || !dateStr) return true;
  const d = parseApplicantDate(dateStr);
  if (!d) return true;

  if (period === 'month') {
    const [year, month] = value.split('-');
    return d.getFullYear() === parseInt(year) && (d.getMonth() + 1) === parseInt(month);
  } else if (period === 'week') {
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

// ============================================================
// スプレッドシート取得・加工（共通処理）
// ============================================================
async function fetchAndProcessSheet() {
  const sheets = await getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) {
    return {
      result: { applicants: [], headers: [], visibleHeaders: [], visibleColIndices: [], col_date_index: 0, col_date_header: '応募日', total: 0 },
      rawRows: rows || [],
      rawHeaders: rows?.[0] || [],
    };
  }

  const rawHeaders = rows[0];
  const dataRows = rows.slice(1);

  // 列インデックス特定（実際のヘッダー名に合わせて完全一致）
  // A:タイムスタンプ B:応募日 C:応募月 D:姓 E:名 F:メールアドレス
  // R:面接実施 T:CV U:氏名（本名）
  const COL_LAST_NAME  = rawHeaders.findIndex(h => h && h.trim() === '姓');           // D列
  const COL_FIRST_NAME = rawHeaders.findIndex(h => h && h.trim() === '名');           // E列
  const COL_EMAIL      = rawHeaders.findIndex(h => h && h.trim() === 'メールアドレス'); // F列
  const COL_INTERVIEW  = rawHeaders.findIndex(h => h && h.trim() === '面接実施');     // R列
  const COL_CV         = rawHeaders.findIndex(h => h && h.trim() === 'CV');            // T列
  const COL_FULL_NAME  = rawHeaders.findIndex(h => h && h.trim() === '氏名（本名）'); // U列
  // 応募日: B列「応募日」を優先、なければA列「タイムスタンプ」
  let   COL_DATE       = rawHeaders.findIndex(h => h && h.trim() === '応募日');
  if (COL_DATE === -1) COL_DATE = rawHeaders.findIndex(h => h && h.trim() === 'タイムスタンプ');
  if (COL_DATE === -1) COL_DATE = 0;

  // 表示列
  const visibleColIndices = rawHeaders.map((h, i) => i).filter(i => !isHiddenColumn(rawHeaders[i]));

  // 重複除外＆処理
  const seen = new Set();
  const uniqueApplicants = [];

  dataRows.forEach((row, rowIndex) => {
    while (row.length < rawHeaders.length) row.push('');

    const lastName   = COL_LAST_NAME >= 0  ? (row[COL_LAST_NAME] || '').trim()  : '';
    const firstName  = COL_FIRST_NAME >= 0 ? (row[COL_FIRST_NAME] || '').trim() : '';
    const email      = COL_EMAIL >= 0      ? (row[COL_EMAIL] || '').trim()      : '';
    const dateStr    = row[COL_DATE] || '';
    const cvValue       = COL_CV >= 0        ? (row[COL_CV]        || '').trim().toUpperCase() : '';
    const isCV          = cvValue === 'TRUE';
    const interviewValue = COL_INTERVIEW >= 0 ? (row[COL_INTERVIEW] || '').trim().toUpperCase() : '';
    const isInterview   = interviewValue === 'TRUE';
    // 氏名（本名）列を優先、なければ姓+名を結合
    const fullNameCol = COL_FULL_NAME >= 0 ? (row[COL_FULL_NAME] || '').trim() : '';
    const fullName   = fullNameCol || `${lastName}${firstName}`.trim();

    if (!lastName && !firstName && !email) return;

    const key = `${lastName}|${firstName}|${email}`;
    if (seen.has(key)) return;
    seen.add(key);

    const visibleData = visibleColIndices.map(i => ({
      header: rawHeaders[i] || '',
      value: row[i] || '',
      colIndex: i,
    }));

    uniqueApplicants.push({
      row_index: rowIndex + 2,
      last_name: lastName,
      first_name: firstName,
      full_name: fullName,
      email,
      date_str: dateStr,
      date_parsed: parseApplicantDate(dateStr),
      is_cv: isCV,
      is_interview: isInterview,
      visible_data: visibleData,
      raw: rawHeaders.reduce((acc, h, i) => { acc[h || `col_${i}`] = row[i] || ''; return acc; }, {}),
    });
  });

  // 応募日降順ソート
  uniqueApplicants.sort((a, b) => {
    const da = a.date_parsed ? a.date_parsed.getTime() : 0;
    const db_ = b.date_parsed ? b.date_parsed.getTime() : 0;
    return db_ - da;
  });

  const visibleHeaders = visibleColIndices.map(i => rawHeaders[i] || '');

  return {
    result: {
      applicants: uniqueApplicants,
      headers: rawHeaders,
      visibleHeaders,
      visibleColIndices,
      col_date_index: COL_DATE,
      col_date_header: rawHeaders[COL_DATE] || '応募日',
      col_cv_index: COL_CV,
      total: uniqueApplicants.length,
    },
    rawRows: rows,
    rawHeaders,
  };
}

// ============================================================
// キャッシュ付きデータ取得（重複リクエストをまとめる）
// ============================================================
async function getCachedData(forceRefresh = false) {
  if (!forceRefresh && cache.isValid()) {
    return cache.data;
  }

  // 既に取得中なら同じPromiseを返す（リクエスト合流）
  if (cache.fetching && cache.fetchPromise) {
    return cache.fetchPromise;
  }

  cache.fetching = true;
  cache.fetchPromise = fetchAndProcessSheet().then(({ result, rawRows, rawHeaders }) => {
    cache.set(result, rawRows, rawHeaders);
    return result;
  }).catch(err => {
    cache.fetching = false;
    cache.fetchPromise = null;
    throw err;
  });

  return cache.fetchPromise;
}

// サーバー起動直後にバックグラウンドで1回取得しておく（ウォームアップ）
setTimeout(() => {
  getCachedData().catch(err => {
    // 認証情報が未設定の場合は無視
    if (!err.message.includes('認証情報')) {
      console.warn('[Cache warmup] Failed:', err.message);
    }
  });
}, 3000);

// 5分おきにバックグラウンド更新
setInterval(() => {
  getCachedData(true).catch(err => {
    console.warn('[Cache refresh] Failed:', err.message);
  });
}, CACHE_TTL_MS);

// ============================================================
// GET /api/spreadsheet/applicants
// ============================================================
router.get('/applicants', authenticateToken, async (req, res) => {
  const { period, value, refresh } = req.query;
  const forceRefresh = refresh === '1';

  try {
    const data = await getCachedData(forceRefresh);

    // 期間フィルタが指定された場合のカウント
    let periodCount = null;
    if (period && value) {
      periodCount = data.applicants.filter(a => isInPeriod(a.date_str, period, value)).length;
    }

    // CV=TRUE の件数
    const cvCount = data.applicants.filter(a => a.is_cv).length;

    res.json({
      ...data,
      total: data.applicants.length,
      period_count: periodCount,
      cv_count: cvCount,
      cached: cache.isValid(),
      cache_age_seconds: cache.ageSeconds(),
    });
  } catch (err) {
    console.error('Spreadsheet error:', err);

    // キャッシュが古くても返せるなら返す（フォールバック）
    if (cache.data) {
      console.warn('[Cache] Returning stale cache due to error');
      return res.json({
        ...cache.data,
        total: cache.data.applicants.length,
        cached: true,
        cache_age_seconds: cache.ageSeconds(),
        stale: true,
        error_message: err.message,
      });
    }

    res.status(500).json({
      error: 'スプレッドシートの取得に失敗しました: ' + err.message,
    });
  }
});

// ============================================================
// GET /api/spreadsheet/applicants/count - 期間別応募数（キャッシュ活用）
// ============================================================
router.get('/applicants/count', authenticateToken, async (req, res) => {
  const { period, value } = req.query;

  try {
    const data = await getCachedData();

    const filtered = (period && value)
      ? data.applicants.filter(a => isInPeriod(a.date_str, period, value))
      : data.applicants;

    const count = filtered.length;

    // 期間内のCV=TRUE件数
    const cvCount = filtered.filter(a => a.is_cv).length;

    // 期間内の面接実施=TRUE件数
    const interviewCount = filtered.filter(a => a.is_interview).length;

    res.json({
      count,
      cv_count: cvCount,
      interview_count: interviewCount,
      period,
      value,
      cached: cache.isValid(),
      cache_age_seconds: cache.ageSeconds(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, count: 0, cv_count: 0 });
  }
});

// ============================================================
// GET /api/spreadsheet/cache-status - キャッシュ状態確認
// ============================================================
router.get('/cache-status', authenticateToken, (req, res) => {
  res.json({
    cached: cache.isValid(),
    fetched_at: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    cache_age_seconds: cache.ageSeconds(),
    ttl_seconds: CACHE_TTL_MS / 1000,
    total_applicants: cache.data?.applicants?.length ?? null,
  });
});

// ============================================================
// POST /api/spreadsheet/cache-clear - キャッシュ強制クリア
// ============================================================
router.post('/cache-clear', authenticateToken, async (req, res) => {
  cache.clear();
  try {
    const data = await getCachedData(true);
    res.json({
      message: 'キャッシュを更新しました',
      total: data.applicants.length,
      fetched_at: new Date(cache.fetchedAt).toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'キャッシュ更新に失敗しました: ' + err.message });
  }
});

module.exports = router;
