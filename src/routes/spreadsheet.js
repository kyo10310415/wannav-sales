const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');

const SPREADSHEET_ID = '1H0CctpkCJ4PVZ5cf1YYI7_elNwUu0uIcHIHMNTHYHW4';
const SHEET_NAME    = 'アススタ';
const RANGE         = `${SHEET_NAME}!A1:AA`;

// ゲーハイ（EP）シート
const GH_SHEET_NAME = 'ゲーハイ（EP）';
const GH_RANGE      = `${GH_SHEET_NAME}!A1:AA`;

// ============================================================
// メモリキャッシュ（TTL: 5分）
// ============================================================
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

function makeCache(label) {
  return {
    data: null,
    rawRows: null,
    rawHeaders: null,
    fetchedAt: null,
    fetching: false,
    fetchPromise: null,
    _label: label,

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
      console.log(`[Cache:${this._label}] Updated: ${data.applicants.length} applicants at ${new Date().toISOString()}`);
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
}

const cache   = makeCache('アススタ');
const cacheGh = makeCache('ゲーハイ');

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

// ISO 8601 週番号を返す（utils.js の _isoWeekStr と同実装）
// 月曜始まり・木曜日基準、stats.js の isoWeekPeriod() SQL式と一致
function _isoWeekStr(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const monBased = (date.getDay() + 6) % 7; // 月=0 ... 日=6
  const thu = new Date(date);
  thu.setDate(date.getDate() + 3 - monBased); // 当週の木曜日
  const year = thu.getFullYear();
  const jan4 = new Date(year, 0, 4, 12, 0, 0);
  const jan4MonBased = (jan4.getDay() + 6) % 7;
  const yearFirstThu = new Date(year, 0, 4 + (3 - jan4MonBased), 12, 0, 0);
  const week = Math.round((thu - yearFirstThu) / (7 * 86400000)) + 1;
  return year + '-W' + String(week).padStart(2, '0');
}

function isInPeriod(dateStr, period, value) {
  if (!period || !value || !dateStr) return true;
  const d = parseApplicantDate(dateStr);
  if (!d) return true;

  if (period === 'month') {
    const [year, month] = value.split('-');
    return d.getFullYear() === parseInt(year) && (d.getMonth() + 1) === parseInt(month);
  } else if (period === 'week') {
    // ISO 8601 準拠（月曜始まり・木曜日基準）で週番号を比較
    // 旧: Math.ceil(dayOfYear / 7) は日曜始まりのため stats.js の ISO 週番号と1日ずれる
    return _isoWeekStr(d) === value;
  }
  return true;
}

// ============================================================
// スプレッドシート取得・加工（共通処理）
// ============================================================
async function fetchAndProcessSheet(sheetRange) {
  const range = sheetRange || RANGE;
  const sheets = await getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
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
  const COL_LAST_NAME       = rawHeaders.findIndex(h => h && h.trim() === '姓');              // D列
  const COL_FIRST_NAME      = rawHeaders.findIndex(h => h && h.trim() === '名');              // E列
  const COL_EMAIL           = rawHeaders.findIndex(h => h && h.trim() === 'メールアドレス');  // F列
  const COL_FIRST_INTERVIEW = rawHeaders.findIndex(h => h && h.trim() === '一次面接担当');   // L列（重複キー）
  const COL_DOC_PASS        = rawHeaders.findIndex(h => h && h.trim() === '書類通過');         // N列
  const COL_INTERVIEW_RESV  = rawHeaders.findIndex(h => h && h.trim() === '面接予約');         // O列
  const COL_INTERVIEW       = rawHeaders.findIndex(h => h && h.trim() === '面接実施');        // R列
  const COL_CV              = rawHeaders.findIndex(h => h && h.trim() === 'CV');               // T列
  const COL_FULL_NAME       = rawHeaders.findIndex(h => h && h.trim() === '氏名（本名）');    // U列
  // 応募日: B列「応募日」を優先、なければA列「タイムスタンプ」
  let   COL_DATE       = rawHeaders.findIndex(h => h && h.trim() === '応募日');
  if (COL_DATE === -1) COL_DATE = rawHeaders.findIndex(h => h && h.trim() === 'タイムスタンプ');
  if (COL_DATE === -1) COL_DATE = 0;

  // 表示列
  const visibleColIndices = rawHeaders.map((h, i) => i).filter(i => !isHiddenColumn(rawHeaders[i]));

  // レコード処理（「一次面接担当」=「ダブり」を除外）
  const uniqueApplicants = [];

  dataRows.forEach((row, rowIndex) => {
    while (row.length < rawHeaders.length) row.push('');

    const lastName   = COL_LAST_NAME >= 0  ? (row[COL_LAST_NAME] || '').trim()  : '';
    const firstName  = COL_FIRST_NAME >= 0 ? (row[COL_FIRST_NAME] || '').trim() : '';
    const email      = COL_EMAIL >= 0      ? (row[COL_EMAIL] || '').trim()      : '';
    const dateStr    = row[COL_DATE] || '';
    const cvValue        = COL_CV >= 0             ? (row[COL_CV]             || '').trim().toUpperCase() : '';
    const isCV           = cvValue === 'TRUE';
    const interviewValue = COL_INTERVIEW >= 0      ? (row[COL_INTERVIEW]      || '').trim().toUpperCase() : '';
    const isInterview    = interviewValue === 'TRUE';
    const docPassValue   = COL_DOC_PASS >= 0       ? (row[COL_DOC_PASS]       || '').trim().toUpperCase() : '';
    const isDocPass      = docPassValue === 'TRUE';
    const interviewResvValue = COL_INTERVIEW_RESV >= 0 ? (row[COL_INTERVIEW_RESV] || '').trim().toUpperCase() : '';
    const isInterviewResv    = interviewResvValue === 'TRUE';
    // 氏名（本名）列を優先、なければ姓+名を結合
    const fullNameCol = COL_FULL_NAME >= 0 ? (row[COL_FULL_NAME] || '').trim() : '';
    const fullName   = fullNameCol || `${lastName}${firstName}`.trim();

    // 完全空行はスキップ
    if (!fullName && !email && !dateStr) return;

    // 「一次面接担当」列が「ダブり」のレコードを除外
    const firstInterviewVal = COL_FIRST_INTERVIEW >= 0
      ? (row[COL_FIRST_INTERVIEW] || '').trim()
      : '';
    if (firstInterviewVal === 'ダブり') return;

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
      is_doc_pass: isDocPass,
      is_interview_resv: isInterviewResv,
      is_interview: isInterview,
      is_cv: isCV,
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
async function getCachedData(forceRefresh = false, targetCache = cache, sheetRange = RANGE) {
  if (!forceRefresh && targetCache.isValid()) {
    return targetCache.data;
  }

  // 既に取得中なら同じPromiseを返す（リクエスト合流）
  if (targetCache.fetching && targetCache.fetchPromise) {
    return targetCache.fetchPromise;
  }

  targetCache.fetching = true;
  targetCache.fetchPromise = fetchAndProcessSheet(sheetRange).then(({ result, rawRows, rawHeaders }) => {
    targetCache.set(result, rawRows, rawHeaders);
    return result;
  }).catch(err => {
    targetCache.fetching = false;
    targetCache.fetchPromise = null;
    throw err;
  });

  return targetCache.fetchPromise;
}

// サーバー起動直後にバックグラウンドで1回取得しておく（ウォームアップ）
setTimeout(() => {
  getCachedData(false, cache, RANGE).catch(err => {
    if (!err.message.includes('認証情報')) {
      console.warn('[Cache warmup] アススタ Failed:', err.message);
    }
  });
  getCachedData(false, cacheGh, GH_RANGE).catch(err => {
    if (!err.message.includes('認証情報')) {
      console.warn('[Cache warmup] ゲーハイ Failed:', err.message);
    }
  });
}, 3000);

// 1時間おきにバックグラウンド更新
setInterval(() => {
  getCachedData(true, cache, RANGE).catch(err => {
    console.warn('[Cache refresh] アススタ Failed:', err.message);
  });
  getCachedData(true, cacheGh, GH_RANGE).catch(err => {
    console.warn('[Cache refresh] ゲーハイ Failed:', err.message);
  });
}, CACHE_TTL_MS);

// ============================================================
// GET /api/spreadsheet/applicants  （アススタシート）
// ============================================================
router.get('/applicants', authenticateToken, async (req, res) => {
  const { period, value, refresh } = req.query;
  const forceRefresh = refresh === '1';

  try {
    const data = await getCachedData(forceRefresh, cache, RANGE);

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
// GET /api/spreadsheet/applicants/gh  （ゲーハイシート）
// ============================================================
router.get('/applicants/gh', authenticateToken, async (req, res) => {
  const { period, value, refresh } = req.query;
  const forceRefresh = refresh === '1';

  try {
    const data = await getCachedData(forceRefresh, cacheGh, GH_RANGE);

    let periodCount = null;
    if (period && value) {
      periodCount = data.applicants.filter(a => isInPeriod(a.date_str, period, value)).length;
    }

    const cvCount = data.applicants.filter(a => a.is_cv).length;

    res.json({
      ...data,
      total: data.applicants.length,
      period_count: periodCount,
      cv_count: cvCount,
      cached: cacheGh.isValid(),
      cache_age_seconds: cacheGh.ageSeconds(),
    });
  } catch (err) {
    console.error('Spreadsheet GH error:', err);

    if (cacheGh.data) {
      console.warn('[Cache GH] Returning stale cache due to error');
      return res.json({
        ...cacheGh.data,
        total: cacheGh.data.applicants.length,
        cached: true,
        cache_age_seconds: cacheGh.ageSeconds(),
        stale: true,
        error_message: err.message,
      });
    }

    res.status(500).json({
      error: 'スプレッドシート（ゲーハイ）の取得に失敗しました: ' + err.message,
    });
  }
});

// ============================================================
// GET /api/spreadsheet/applicants/count - 期間別応募数（キャッシュ活用）
// ============================================================
router.get('/applicants/count', authenticateToken, async (req, res) => {
  const { period, value } = req.query;

  try {
    const data = await getCachedData(false, cache, RANGE);

    const filtered = (period && value)
      ? data.applicants.filter(a => isInPeriod(a.date_str, period, value))
      : data.applicants;

    const count = filtered.length;

    // 書類通過: 書類通過列 = TRUE
    const docPassCount = filtered.filter(a => a.is_doc_pass).length;

    // 面接予約数: applicant_interview_dates テーブルに面接日が入力されているレコード数
    // applicant_key = email 優先、なければ full_name
    const interviewDateMap = (() => {
      const rows = db.prepare(
        `SELECT applicant_key FROM applicant_interview_dates
         WHERE interview_date IS NOT NULL AND interview_date != ''`
      ).all();
      const set = new Set();
      rows.forEach(r => set.add(r.applicant_key));
      return set;
    })();
    const interviewResvCount = filtered.filter(a => {
      const key = (a.email && a.email.trim()) ? a.email.trim() : (a.full_name || '').trim();
      return key && interviewDateMap.has(key);
    }).length;

    // interviewCount は廃止（面接実施数 = 営業報告件数で代替するため返さない）
    const cvCount = filtered.filter(a => a.is_cv).length;

    res.json({
      count,
      doc_pass_count:       docPassCount,
      interview_resv_count: interviewResvCount,
      // interview_count は営業報告側（stats API）で管理するため省略
      cv_count: cvCount,
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
    gh_cached: cacheGh.isValid(),
    gh_fetched_at: cacheGh.fetchedAt ? new Date(cacheGh.fetchedAt).toISOString() : null,
    gh_total_applicants: cacheGh.data?.applicants?.length ?? null,
  });
});

// ============================================================
// POST /api/spreadsheet/cache-clear - キャッシュ強制クリア
// ============================================================
router.post('/cache-clear', authenticateToken, async (req, res) => {
  cache.clear();
  cacheGh.clear();
  try {
    const [data] = await Promise.all([
      getCachedData(true, cache, RANGE),
      getCachedData(true, cacheGh, GH_RANGE),
    ]);
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
module.exports.cache   = cache;
module.exports.cacheGh = cacheGh;
