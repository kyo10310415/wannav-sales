'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { authenticateToken } = require('../middleware/auth');
const {
  CONTRACT_RESULTS,
  RESULT_NOSHOW,
  RESULT_COOLING_OFF,
  RESULT_AI_RECOMMEND,
  sqlMetricDate,
  sqlEventKey,
  sqlFirstNoShowDate,
  sqlNoShowEventKey,
} = require('../services/reportMetrics');

// ============================================================
// 契約判定SQL
// ============================================================
const CONTRACT_CONDITION   = `sr.result IN (${CONTRACT_RESULTS.map(r => `'${r}'`).join(', ')})`;
const COOLINGOFF_CONDITION = `sr.result = '${RESULT_COOLING_OFF}'`;
const NOSHOW_CONDITION     = `sr.result = '${RESULT_NOSHOW}'`;
const AI_RECOMMEND_CONDITION = `sr.result = '${RESULT_AI_RECOMMEND}'`;
const INTERVIEW_CONDITION  = `NOT (${NOSHOW_CONDITION}) AND NOT (${AI_RECOMMEND_CONDITION})`;
const EVENT_KEY            = sqlEventKey('sr');
const METRIC_DATE          = sqlMetricDate('sr');
const FIRST_NOSHOW_DATE    = sqlFirstNoShowDate('sr');
const NOSHOW_EVENT_KEY     = sqlNoShowEventKey('sr');
const FIRST_NOSHOW_CONDITION = `(${NOSHOW_CONDITION}) AND ${METRIC_DATE} = ${FIRST_NOSHOW_DATE}`;

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function periodCondition(query) {
  const { period, value, date_from, date_to } = query;
  if (period === 'custom') {
    if (!isIsoDate(date_from) || !isIsoDate(date_to) || date_from > date_to) {
      return { error: '開始日と終了日を正しい順序で指定してください' };
    }
    return { condition: `${METRIC_DATE} BETWEEN ? AND ?`, params: [date_from, date_to] };
  }
  if (period === 'week' && value) {
    return { condition: `${isoWeekPeriod(METRIC_DATE)} = ?`, params: [value] };
  }
  if (period === 'month' && value) {
    return { condition: `strftime('%Y-%m', ${METRIC_DATE}) = ?`, params: [value] };
  }
  return { condition: '', params: [] };
}

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
      COUNT(DISTINCT CASE WHEN ${INTERVIEW_CONDITION} THEN ${EVENT_KEY} END) as total_interviews,
      COUNT(DISTINCT CASE WHEN ${CONTRACT_CONDITION} THEN ${EVENT_KEY} END) as total_contracts,
      COUNT(DISTINCT CASE WHEN ${COOLINGOFF_CONDITION} THEN ${EVENT_KEY} END) as total_coolingoff,
      COUNT(DISTINCT CASE WHEN ${FIRST_NOSHOW_CONDITION} THEN ${NOSHOW_EVENT_KEY} END) as total_noshow,
      COUNT(DISTINCT CASE WHEN ${AI_RECOMMEND_CONDITION} THEN ${EVENT_KEY} END) as total_ai_recommend
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
      COUNT(DISTINCT CASE WHEN ${INTERVIEW_CONDITION} THEN ${EVENT_KEY} END) as total_interviews,
      COUNT(DISTINCT CASE WHEN ${CONTRACT_CONDITION} THEN ${EVENT_KEY} END) as total_contracts,
      COUNT(DISTINCT CASE WHEN ${COOLINGOFF_CONDITION} THEN ${EVENT_KEY} END) as total_coolingoff,
      COUNT(DISTINCT CASE WHEN ${FIRST_NOSHOW_CONDITION} THEN ${NOSHOW_EVENT_KEY} END) as total_noshow,
      COUNT(DISTINCT CASE WHEN ${AI_RECOMMEND_CONDITION} THEN ${EVENT_KEY} END) as total_ai_recommend
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
  const periodInfo = periodCondition(req.query);
  if (periodInfo.error) return res.status(400).json({ error: periodInfo.error });
  const periodCond = periodInfo.condition;
  const periodParams = periodInfo.params;

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

  // 同一人物・同一面接日は、同種指標内では1件として数える。
  // 別日の飛び→契約→クーリングオフはそれぞれ別イベントとして残る。
  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN ${INTERVIEW_CONDITION} THEN ${EVENT_KEY} END) AS total_interviews,
      COUNT(DISTINCT CASE WHEN ${CONTRACT_CONDITION} THEN ${EVENT_KEY} END) AS total_contracts,
      COUNT(DISTINCT CASE WHEN ${COOLINGOFF_CONDITION} THEN ${EVENT_KEY} END) AS total_coolingoff,
      COUNT(DISTINCT CASE WHEN ${FIRST_NOSHOW_CONDITION} THEN ${NOSHOW_EVENT_KEY} END) AS total_noshow,
      COUNT(DISTINCT CASE WHEN ${AI_RECOMMEND_CONDITION} THEN ${EVENT_KEY} END) AS total_ai_recommend,
      COUNT(DISTINCT CASE WHEN COALESCE(sr.result, '') != '${RESULT_COOLING_OFF}' THEN ${EVENT_KEY} END) AS sales_report_reservations
    ${baseSQL}
  `).get(...allParams);

  // プラン別契約数
  const contractWhere = `${whereClause ? 'AND' : 'WHERE'} ${CONTRACT_CONDITION}`;
  const planBreakdown = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(sr.contract_plan), ''), '未記入') AS plan,
      COUNT(DISTINCT ${EVENT_KEY}) AS count
    FROM ${dedup} ${joinClause} ${whereClause} ${contractWhere}
    GROUP BY plan
    ORDER BY count DESC
  `).all(...allParams);

  const totalInterviews = totals.total_interviews || 0;
  const totalContracts  = totals.total_contracts || 0;
  const totalCoolingoff = totals.total_coolingoff || 0;
  const totalNoshow     = totals.total_noshow || 0;
  const totalAiRecommend = totals.total_ai_recommend || 0;
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
    total_ai_recommend: totalAiRecommend,
    sales_report_reservations: totals.sales_report_reservations || 0,
    adjusted_reservation_count: appCount + totalAiRecommend,
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
      COUNT(DISTINCT CASE WHEN ${INTERVIEW_CONDITION} THEN ${EVENT_KEY} END) as total_interviews,
      COUNT(DISTINCT CASE WHEN ${CONTRACT_CONDITION} THEN ${EVENT_KEY} END) as total_contracts,
      COUNT(DISTINCT CASE WHEN ${COOLINGOFF_CONDITION} THEN ${EVENT_KEY} END) as total_coolingoff,
      COUNT(DISTINCT CASE WHEN ${FIRST_NOSHOW_CONDITION} THEN ${NOSHOW_EVENT_KEY} END) as total_noshow,
      COUNT(DISTINCT CASE WHEN ${AI_RECOMMEND_CONDITION} THEN ${EVENT_KEY} END) as total_ai_recommend
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
// GET /api/stats/by-interviewer
//   担当者間の比較用。同日・同一人物・同結果の重複報告は1件として集計。
// ============================================================
router.get('/by-interviewer', authenticateToken, (req, res) => {
  const periodInfo = periodCondition(req.query);
  if (periodInfo.error) return res.status(400).json({ error: periodInfo.error });

  // 比較画面では担当者自身のフィルターを外し、その他の属性フィルターは引き継ぐ。
  const comparisonQuery = { ...req.query, interviewer: '' };
  const { conditions, params } = buildFilterSQL(comparisonQuery);
  const withJoin = needsNotionJoin(comparisonQuery);
  const baseSQL = buildBaseSQL(
    periodInfo.condition,
    conditions,
    withJoin,
    req.query.sheet_type
  );
  const allParams = [...periodInfo.params, ...params];

  const data = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(sr.interviewer_name), ''), '不明') AS interviewer_name,
      COUNT(DISTINCT CASE WHEN ${INTERVIEW_CONDITION} THEN ${EVENT_KEY} END) AS total_interviews,
      COUNT(DISTINCT CASE WHEN ${CONTRACT_CONDITION} THEN ${EVENT_KEY} END) AS total_contracts,
      COUNT(DISTINCT CASE WHEN ${FIRST_NOSHOW_CONDITION} THEN ${NOSHOW_EVENT_KEY} END) AS total_noshow,
      COUNT(DISTINCT CASE WHEN ${COOLINGOFF_CONDITION} THEN ${EVENT_KEY} END) AS total_coolingoff,
      COUNT(DISTINCT CASE WHEN ${AI_RECOMMEND_CONDITION} THEN ${EVENT_KEY} END) AS total_ai_recommend
    ${baseSQL}
    GROUP BY interviewer_name
    ORDER BY total_contracts DESC, total_interviews DESC, interviewer_name ASC
  `).all(...allParams);

  res.json(data.map(row => ({
    ...row,
    cvr_interview: row.total_interviews > 0
      ? ((row.total_contracts / row.total_interviews) * 100).toFixed(1)
      : '0.0',
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

    // メールを最優先で小文字化、メールがない場合のみ氏名を空白除去して照合。
    // 氏名表記やメール大小文字の違いで集計対象から外れるのを防ぐ。
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
        ON (CASE
              WHEN INSTR(TRIM(aid.applicant_key), '@') > 0
                THEN 'email:' || LOWER(TRIM(aid.applicant_key))
              ELSE 'name:' || LOWER(REPLACE(REPLACE(TRIM(aid.applicant_key), ' ', ''), '　', ''))
            END)
         = (CASE
              WHEN NULLIF(TRIM(sr2.applicant_email), '') IS NOT NULL
                THEN 'email:' || LOWER(TRIM(sr2.applicant_email))
              ELSE 'name:' || LOWER(REPLACE(REPLACE(TRIM(sr2.applicant_full_name), ' ', ''), '　', ''))
            END)
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
