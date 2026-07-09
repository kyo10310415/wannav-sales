'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// 契約判定SQL
// ============================================================
const CONTRACT_CONDITION   = `result IN ('契約', '契約＆職業案内', '契約＆職業案内（CP）')`;
const COOLINGOFF_CONDITION = `result = 'クーリングオフ'`;
const NOSHOW_CONDITION     = `result = '飛び'`;

// ============================================================
// ISO 8601 週番号式（月曜始まり）
//   strftime('%W') は日曜始まりで FE の週番号と1週ずれるため
//   julianday + 木曜日基準 で ISO 週番号を計算する
//   col: 日付列の式（例: COALESCE(NULLIF(sr.interview_date,''), date(sr.first_created_at,'+9 hours'))）
// ============================================================
function isoWeekPeriod(col) {
  return `(
    strftime('%Y', date(${col}, (3 - (CAST(strftime('%w', ${col}) AS INTEGER) + 6) % 7) || ' days'))
    || '-W' ||
    printf('%02d', CAST(
      (julianday(date(${col}, (3 - (CAST(strftime('%w', ${col}) AS INTEGER) + 6) % 7) || ' days'))
       - julianday(
           date(
             strftime('%Y', date(${col}, (3 - (CAST(strftime('%w', ${col}) AS INTEGER) + 6) % 7) || ' days')) || '-01-04',
             (3 - (CAST(strftime('%w',
               strftime('%Y', date(${col}, (3 - (CAST(strftime('%w', ${col}) AS INTEGER) + 6) % 7) || ' days')) || '-01-04'
             ) AS INTEGER) + 6) % 7) || ' days'
           )
         )
      ) / 7 + 1 AS INTEGER)
    )
  )`;
}

// ============================================================
// 全件集計サブクエリ
//   ※ 追記（parent_id IS NOT NULL）も含めてすべての報告行を対象にする
//   interview_date フォールバック用に first_created_at を付与:
//     初回報告（parent_id IS NULL）は自身の created_at
//     追記報告（parent_id IS NOT NULL）は初回報告の created_at を引き継ぐ
// ============================================================
const DEDUP_SUBQUERY = `(
  SELECT sr.*,
         COALESCE(
           root.created_at,
           sr.created_at
         ) AS first_created_at
  FROM sales_reports sr
  LEFT JOIN sales_reports root ON root.id = sr.parent_id
) AS sr`;

// ============================================================
// 月収・可処分所得の範囲定義
//   monthly_income_range  : 'lt100k' | 'mid' | 'gte300k'
//   disposable_income_range: 'lt10k'  | 'mid' | 'gte50k'
// ============================================================
const MONTHLY_INCOME_RANGES = [
  { value: 'lt100k',  label: '100,000円未満',         sql: `CAST(NULLIF(np.monthly_income,'') AS REAL) < 100000` },
  { value: 'mid',     label: '100,000〜299,999円',     sql: `CAST(NULLIF(np.monthly_income,'') AS REAL) BETWEEN 100000 AND 299999` },
  { value: 'gte300k', label: '300,000円以上',          sql: `CAST(NULLIF(np.monthly_income,'') AS REAL) >= 300000` },
];
const DISPOSABLE_INCOME_RANGES = [
  { value: 'lt10k',  label: '10,000円未満',            sql: `CAST(NULLIF(np.disposable_income,'') AS REAL) < 10000` },
  { value: 'mid',    label: '10,000〜49,999円',        sql: `CAST(NULLIF(np.disposable_income,'') AS REAL) BETWEEN 10000 AND 49999` },
  { value: 'gte50k', label: '50,000円以上',            sql: `CAST(NULLIF(np.disposable_income,'') AS REAL) >= 50000` },
];

// ============================================================
// フィルター用ヘルパー
//   クエリパラメータ: interviewer / gender / age_group /
//                    monthly_income_range / disposable_income_range /
//                    job_type / streaming_exp
//   性別・年齢・所得層・職種・配信経験は notion_profiles を LEFT JOIN
// ============================================================
function buildFilterSQL(query) {
  const conditions = [];
  const params     = [];

  // 担当者（sales_reports.interviewer_name）
  if (query.interviewer) {
    conditions.push(`sr.interviewer_name = ?`);
    params.push(query.interviewer);
  }

  // Notionプロファイル由来フィルター（LEFT JOIN済み前提）
  if (query.gender) {
    conditions.push(`np.gender = ?`);
    params.push(query.gender);
  }
  if (query.age_group) {
    // birth_date は 'YYYY-MM-DD' 想定、年齢帯は '20代','30代' 等
    const ageMap = {
      '10代': [10, 19], '20代': [20, 29], '30代': [30, 39],
      '40代': [40, 49], '50代以上': [50, 99],
    };
    const range = ageMap[query.age_group];
    if (range) {
      conditions.push(`(
        CAST(strftime('%Y','now') AS INTEGER) - CAST(substr(np.birth_date,1,4) AS INTEGER)
        BETWEEN ? AND ?
      )`);
      params.push(range[0], range[1]);
    }
  }
  // 月収（数値範囲）
  if (query.monthly_income_range) {
    const def = MONTHLY_INCOME_RANGES.find(r => r.value === query.monthly_income_range);
    if (def) conditions.push(def.sql);
  }
  // 可処分所得（数値範囲）
  if (query.disposable_income_range) {
    const def = DISPOSABLE_INCOME_RANGES.find(r => r.value === query.disposable_income_range);
    if (def) conditions.push(def.sql);
  }
  if (query.job_type) {
    conditions.push(`np.job_type = ?`);
    params.push(query.job_type);
  }
  if (query.streaming_exp) {
    conditions.push(`np.has_streaming_experience = ?`);
    params.push(query.streaming_exp);
  }

  return { conditions, params };
}

// Notionが絡むフィルターがあるか判定
function needsNotionJoin(query) {
  return !!(query.gender || query.age_group ||
            query.monthly_income_range || query.disposable_income_range ||
            query.job_type || query.streaming_exp);
}

// ============================================================
// sheet_type フィルター用ヘルパー
//   sheet_type: 'as' | 'gh' | 'all'（デフォルト 'all'）
// ============================================================
function buildSheetTypeCondition(sheetType) {
  if (sheetType === 'as')  return `sr.sheet_type = 'as'`;
  if (sheetType === 'gh')  return `sr.sheet_type = 'gh'`;
  return null; // 'all' または未指定は条件なし
}

// ============================================================
// 共通: sales_reports + notion_profiles JOIN付きベースSQL生成
//   periodFilter : 'WHERE sr.xxx = ?' 相当の文字列（'WHERE'付き）
//   filterConds  : buildFilterSQL()の conditions 配列
//   withJoin     : Notion JOINが必要か
// ============================================================
function buildBaseSQL(periodFilter, filterConds, withJoin, sheetType) {
  const joinClause = withJoin
    ? `LEFT JOIN notion_profiles np ON np.student_number = sr.student_number`
    : '';

  // 全件集計サブクエリ（追記報告も含む全行を対象）
  // first_created_at: interview_date 空欄時のフォールバック用
  //   追記報告の場合は初回報告の created_at を使用（週・月が変わらないよう保証）
  const dedup = `(
    SELECT sr.*,
           COALESCE(
             root.created_at,
             sr.created_at
           ) AS first_created_at
    FROM sales_reports sr
    LEFT JOIN sales_reports root ON root.id = sr.parent_id
  ) AS sr`;

  const allConds = [];
  if (periodFilter) allConds.push(periodFilter.replace(/^WHERE\s+/i, ''));
  allConds.push(...filterConds);
  // sheet_type フィルター
  const stCond = buildSheetTypeCondition(sheetType);
  if (stCond) allConds.push(stCond);

  const whereClause = allConds.length
    ? `WHERE ${allConds.join(' AND ')}`
    : '';

  return `FROM ${dedup} ${joinClause} ${whereClause}`;
}

// ============================================================
// フィルター選択肢を返す: GET /api/stats/filter-options
// ============================================================
router.get('/filter-options', authenticateToken, (req, res) => {
  const interviewers = db.prepare(
    `SELECT DISTINCT interviewer_name FROM sales_reports
     WHERE interviewer_name IS NOT NULL AND interviewer_name != ''
     ORDER BY interviewer_name`
  ).all().map(r => r.interviewer_name);

  const genders = db.prepare(
    `SELECT DISTINCT gender FROM notion_profiles
     WHERE gender IS NOT NULL AND gender != ''
     ORDER BY gender`
  ).all().map(r => r.gender);

  const jobTypes = db.prepare(
    `SELECT DISTINCT job_type FROM notion_profiles
     WHERE job_type IS NOT NULL AND job_type != ''
     ORDER BY job_type`
  ).all().map(r => r.job_type);

  const streamingExps = db.prepare(
    `SELECT DISTINCT has_streaming_experience FROM notion_profiles
     WHERE has_streaming_experience IS NOT NULL AND has_streaming_experience != ''
     ORDER BY has_streaming_experience`
  ).all().map(r => r.has_streaming_experience);

  res.json({
    interviewers,
    genders,
    age_groups:              ['10代', '20代', '30代', '40代', '50代以上'],
    monthly_income_ranges:   MONTHLY_INCOME_RANGES.map(r => ({ value: r.value, label: r.label })),
    disposable_income_ranges: DISPOSABLE_INCOME_RANGES.map(r => ({ value: r.value, label: r.label })),
    job_types:               jobTypes,
    streaming_exps:          streamingExps,
  });
});

// ============================================================
// GET /api/stats/weekly
// ============================================================
router.get('/weekly', authenticateToken, (req, res) => {
  const { conditions, params } = buildFilterSQL(req.query);
  const withJoin = needsNotionJoin(req.query);
  const baseSQL  = buildBaseSQL('', conditions, withJoin, req.query.sheet_type);

  const weekFmt = isoWeekPeriod(`COALESCE(NULLIF(sr.interview_date,''), date(sr.first_created_at, '+9 hours'))`);

  const data = db.prepare(`
    SELECT
      ${weekFmt} as period,
      SUM(CASE WHEN sr.parent_id IS NULL AND NOT (${NOSHOW_CONDITION}) THEN 1 ELSE 0 END) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION}     THEN 1 ELSE 0 END) as total_contracts,
      SUM(CASE WHEN ${COOLINGOFF_CONDITION}   THEN 1 ELSE 0 END) as total_coolingoff,
      SUM(CASE WHEN sr.parent_id IS NULL AND (${NOSHOW_CONDITION}) THEN 1 ELSE 0 END) as total_noshow
    ${baseSQL}
    GROUP BY period
    HAVING period IS NOT NULL
    ORDER BY period DESC
    LIMIT 24
  `).all(...params);

  res.json(data.map(d => ({
    ...d,
    cvr_interview: d.total_interviews > 0
      ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1) : '0.0',
    coolingoff_rate: d.total_contracts > 0
      ? ((d.total_coolingoff / d.total_contracts) * 100).toFixed(1) : '0.0',
  })));
});

// ============================================================
// GET /api/stats/monthly
// ============================================================
router.get('/monthly', authenticateToken, (req, res) => {
  const { conditions, params } = buildFilterSQL(req.query);
  const withJoin = needsNotionJoin(req.query);
  const baseSQL  = buildBaseSQL('', conditions, withJoin, req.query.sheet_type);

  const data = db.prepare(`
    SELECT
      strftime('%Y-%m', COALESCE(NULLIF(sr.interview_date,''), date(sr.first_created_at, '+9 hours'))) as period,
      SUM(CASE WHEN sr.parent_id IS NULL AND NOT (${NOSHOW_CONDITION}) THEN 1 ELSE 0 END) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION}     THEN 1 ELSE 0 END) as total_contracts,
      SUM(CASE WHEN ${COOLINGOFF_CONDITION}   THEN 1 ELSE 0 END) as total_coolingoff,
      SUM(CASE WHEN sr.parent_id IS NULL AND (${NOSHOW_CONDITION}) THEN 1 ELSE 0 END) as total_noshow
    ${baseSQL}
    GROUP BY period
    HAVING period IS NOT NULL
    ORDER BY period DESC
    LIMIT 24
  `).all(...params);

  res.json(data.map(d => ({
    ...d,
    cvr_interview: d.total_interviews > 0
      ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1) : '0.0',
    coolingoff_rate: d.total_contracts > 0
      ? ((d.total_coolingoff / d.total_contracts) * 100).toFixed(1) : '0.0',
  })));
});

// ============================================================
// GET /api/stats/summary
//   クエリパラメータ:
//     period, value            — 期間絞り込み
//     applicant_count          — スプレッドシート応募数（ファネル表示用）
//     interviewer, gender, age_group,
//                    monthly_income_range, disposable_income_range,
//                    job_type, streaming_exp
//                              — フィルター
//
//   面接実施数 = 営業報告が上がっている件数のみ（シートの「面接実施」列は不使用）
//   CV        = 営業報告の契約結果のみカウント（スプレッドシートのCV列は不使用）
// ============================================================
router.get('/summary', authenticateToken, (req, res) => {
  const { period, value, applicant_count, sheet_type } = req.query;

  // 期間フィルター
  let periodCond = '';
  let periodParams = [];
  if (period === 'week' && value) {
    periodCond   = `${isoWeekPeriod(`COALESCE(NULLIF(sr.interview_date,''), date(sr.first_created_at, '+9 hours'))`)} = ?`;
    periodParams = [value];
  } else if (period === 'month' && value) {
    periodCond   = `strftime('%Y-%m', COALESCE(NULLIF(sr.interview_date,''), date(sr.first_created_at, '+9 hours'))) = ?`;
    periodParams = [value];
  }

  // 担当者・Notionフィルター
  const { conditions: filterConds, params: filterParams } = buildFilterSQL(req.query);
  const withJoin = needsNotionJoin(req.query);

  // 全条件を結合
  const allConds = [];
  if (periodCond)        allConds.push(periodCond);
  allConds.push(...filterConds);

  // sheet_type フィルター
  const stCond = buildSheetTypeCondition(sheet_type);
  if (stCond) allConds.push(stCond);

  // 全件集計サブクエリ（追記報告も含む全行を対象）
  const dedup = `(
    SELECT sr.*,
           COALESCE(
             root.created_at,
             sr.created_at
           ) AS first_created_at
    FROM sales_reports sr
    LEFT JOIN sales_reports root ON root.id = sr.parent_id
  ) AS sr`;
  const joinClause = withJoin
    ? `LEFT JOIN notion_profiles np ON np.student_number = sr.student_number`
    : '';
  const whereClause = allConds.length
    ? `WHERE ${allConds.join(' AND ')}`
    : '';
  const allParams = [...periodParams, ...filterParams];

  const baseSQL = `FROM ${dedup} ${joinClause} ${whereClause}`;

  // 面接実施数 = 初回報告（parent_id IS NULL）のうち「飛び」を除外
  const totalInterviewsRow = db.prepare(
    `SELECT SUM(CASE WHEN sr.parent_id IS NULL AND NOT (${NOSHOW_CONDITION}) THEN 1 ELSE 0 END) as count ${baseSQL}`
  ).get(...allParams);

  // 飛び件数 = 初回報告（parent_id IS NULL）のうち飛びのみ
  const noshowCond = allConds.length
    ? `${allConds.join(' AND ')} AND sr.parent_id IS NULL AND ${NOSHOW_CONDITION}`
    : `sr.parent_id IS NULL AND ${NOSHOW_CONDITION}`;
  const totalNoshowRow = db.prepare(
    `SELECT COUNT(*) as count FROM ${dedup} ${joinClause} WHERE ${noshowCond}`
  ).get(...allParams);

  // 契約数（CV = 営業報告の契約結果のみ）
  const contractCond = allConds.length
    ? `${allConds.join(' AND ')} AND ${CONTRACT_CONDITION}`
    : CONTRACT_CONDITION;
  const totalContractsRow = db.prepare(
    `SELECT COUNT(*) as count FROM ${dedup} ${joinClause} WHERE ${contractCond}`
  ).get(...allParams);

  // クーリングオフ数
  const coolingoffCond = allConds.length
    ? `${allConds.join(' AND ')} AND ${COOLINGOFF_CONDITION}`
    : COOLINGOFF_CONDITION;
  const totalCoolingoffRow = db.prepare(
    `SELECT COUNT(*) as count FROM ${dedup} ${joinClause} WHERE ${coolingoffCond}`
  ).get(...allParams);

  // プラン別契約数
  const contractBaseSQL = `FROM ${dedup} ${joinClause} WHERE ${contractCond}`;
  const planBreakdown = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(sr.contract_plan), ''), '未記入') AS plan,
      COUNT(*) AS count
    ${contractBaseSQL}
    GROUP BY plan
    ORDER BY count DESC
  `).all(...allParams);

  const totalInterviews = totalInterviewsRow.count || 0;
  const totalContracts  = totalContractsRow.count;
  const totalCoolingoff = totalCoolingoffRow.count;
  const totalNoshow     = totalNoshowRow.count;
  const appCount        = parseInt(applicant_count) || 0;

  const cvrInterview  = totalInterviews > 0
    ? ((totalContracts  / totalInterviews) * 100).toFixed(1) : '0.0';
  const cvrApplicant  = appCount > 0
    ? ((totalContracts  / appCount) * 100).toFixed(1) : '0.0';
  const coolingoffRate = totalContracts > 0
    ? ((totalCoolingoff / totalContracts) * 100).toFixed(1) : '0.0';

  res.json({
    period,
    value,
    total_interviews: totalInterviews,
    total_contracts:  totalContracts,
    total_coolingoff: totalCoolingoff,
    total_noshow:     totalNoshow,
    coolingoff_rate:  coolingoffRate,
    applicant_count:  appCount,
    cvr_interview:    cvrInterview,
    cvr_applicant:    cvrApplicant,
    plan_breakdown:   planBreakdown,
  });
});

// ============================================================
// GET /api/stats/all-periods
// ============================================================
router.get('/all-periods', authenticateToken, (req, res) => {
  const { type } = req.query;
  const { conditions, params } = buildFilterSQL(req.query);
  const withJoin = needsNotionJoin(req.query);
  const baseSQL  = buildBaseSQL('', conditions, withJoin, req.query.sheet_type);

  const fmt   = type === 'week'
    ? isoWeekPeriod(`COALESCE(NULLIF(sr.interview_date,''), date(sr.first_created_at, '+9 hours'))`)
    : `strftime('%Y-%m', COALESCE(NULLIF(sr.interview_date,''), date(sr.first_created_at, '+9 hours')))`;
  const limit = type === 'week' ? 52 : 24;

  const data = db.prepare(`
    SELECT
      ${fmt} as period,
      SUM(CASE WHEN sr.parent_id IS NULL AND NOT (${NOSHOW_CONDITION}) THEN 1 ELSE 0 END) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION}     THEN 1 ELSE 0 END) as total_contracts,
      SUM(CASE WHEN ${COOLINGOFF_CONDITION}   THEN 1 ELSE 0 END) as total_coolingoff,
      SUM(CASE WHEN sr.parent_id IS NULL AND (${NOSHOW_CONDITION}) THEN 1 ELSE 0 END) as total_noshow
    ${baseSQL}
    GROUP BY period
    HAVING period IS NOT NULL
    ORDER BY period DESC
    LIMIT ${limit}
  `).all(...params);

  res.json(data.map(d => ({
    ...d,
    cvr_interview: d.total_interviews > 0
      ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1) : '0.0',
    coolingoff_rate: d.total_contracts > 0
      ? ((d.total_coolingoff / d.total_contracts) * 100).toFixed(1) : '0.0',
  })));
});

// ============================================================
// GET /api/stats/interview-date-cvr
//   面接実施日（applicant_interview_dates.interview_date）ベースのCVR集計
//   面接した月・週に「その人が最終的に契約したか」を集計する
//   クエリパラメータ: type = 'month' | 'week'  (デフォルト: month)
//
//   結合ロジック:
//     applicant_interview_dates.applicant_key
//       = COALESCE(NULLIF(sr.email,''), sr.full_name)  （同じ形式）
//     面接日が登録されている人だけを集計対象とする
// ============================================================
router.get('/interview-date-cvr', authenticateToken, (req, res) => {
  try {
    const type  = req.query.type === 'week' ? 'week' : 'month';
    const limit = type === 'week' ? 52 : 24;

    // 面接実施日の期間フォーマット式
    const periodFmt = type === 'week'
      ? isoWeekPeriod(`aid.interview_date`)
      : `strftime('%Y-%m', aid.interview_date)`;

    // sheet_type フィルター条件
    const stCond = buildSheetTypeCondition(req.query.sheet_type);
    const srWhereClause = stCond ? `AND ${stCond.replace(/\bsr\b/g, 'sr2')}` : '';

    // applicant_key = COALESCE(NULLIF(applicant_email,''), applicant_full_name)
    //   ※ sales_reports のカラム名は applicant_email / applicant_full_name（email/full_name ではない）
    const data = db.prepare(`
      SELECT
        ${periodFmt} as period,
        COUNT(DISTINCT aid.applicant_key) as total_interviewed,
        COUNT(DISTINCT CASE
          WHEN sr2.result IN ('契約', '契約＆職業案内', '契約＆職業案内（CP）')
          THEN aid.applicant_key END) as total_contracts,
        COUNT(DISTINCT CASE
          WHEN sr2.result = 'クーリングオフ'
          THEN aid.applicant_key END) as total_coolingoff
      FROM applicant_interview_dates aid
      LEFT JOIN sales_reports sr2
        ON COALESCE(NULLIF(sr2.applicant_email,''), sr2.applicant_full_name) = aid.applicant_key
        ${srWhereClause}
      WHERE aid.interview_date IS NOT NULL
        AND aid.interview_date != ''
      GROUP BY period
      HAVING period IS NOT NULL
      ORDER BY period DESC
      LIMIT ${limit}
    `).all();

    res.json(data.map(d => ({
      ...d,
      cvr_interview:   d.total_interviewed > 0
        ? ((d.total_contracts  / d.total_interviewed) * 100).toFixed(1) : '0.0',
      coolingoff_rate: d.total_contracts > 0
        ? ((d.total_coolingoff / d.total_contracts)   * 100).toFixed(1) : '0.0',
    })));
  } catch (err) {
    console.error('[interview-date-cvr] error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
