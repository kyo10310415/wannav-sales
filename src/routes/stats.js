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

// ============================================================
// 重複除外サブクエリ（氏名+メール複合キー、フォールバックあり）
// ============================================================
const DEDUP_SUBQUERY = `(
  SELECT * FROM sales_reports
  WHERE id IN (
    SELECT MAX(id) FROM sales_reports
    GROUP BY COALESCE(NULLIF(applicant_name_email,''), applicant_full_name)
  )
) AS sr`;

// ============================================================
// フィルター用ヘルパー
//   クエリパラメータ: interviewer / gender / age_group /
//                    income_level / job_type / streaming_exp
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
  if (query.income_level) {
    conditions.push(`np.monthly_income = ?`);
    params.push(query.income_level);
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
  return !!(query.gender || query.age_group || query.income_level ||
            query.job_type || query.streaming_exp);
}

// ============================================================
// 共通: sales_reports + notion_profiles JOIN付きベースSQL生成
//   periodFilter : 'WHERE sr.xxx = ?' 相当の文字列（'WHERE'付き）
//   filterConds  : buildFilterSQL()の conditions 配列
//   withJoin     : Notion JOINが必要か
// ============================================================
function buildBaseSQL(periodFilter, filterConds, withJoin) {
  const joinClause = withJoin
    ? `LEFT JOIN notion_profiles np ON np.student_number = sr.student_number`
    : '';

  // 重複除外サブクエリ（period filter はサブクエリ外に適用）
  const dedup = `(
    SELECT * FROM sales_reports
    WHERE id IN (
      SELECT MAX(id) FROM sales_reports
      GROUP BY COALESCE(NULLIF(applicant_name_email,''), applicant_full_name)
    )
  ) AS sr`;

  const allConds = [];
  if (periodFilter) allConds.push(periodFilter.replace(/^WHERE\s+/i, ''));
  allConds.push(...filterConds);

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

  const incomes = db.prepare(
    `SELECT DISTINCT monthly_income FROM notion_profiles
     WHERE monthly_income IS NOT NULL AND monthly_income != ''
     ORDER BY monthly_income`
  ).all().map(r => r.monthly_income);

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
    age_groups: ['10代', '20代', '30代', '40代', '50代以上'],
    income_levels: incomes,
    job_types:     jobTypes,
    streaming_exps: streamingExps,
  });
});

// ============================================================
// GET /api/stats/weekly
// ============================================================
router.get('/weekly', authenticateToken, (req, res) => {
  const { conditions, params } = buildFilterSQL(req.query);
  const withJoin = needsNotionJoin(req.query);
  const baseSQL  = buildBaseSQL('', conditions, withJoin);

  const data = db.prepare(`
    SELECT
      strftime('%Y-W%W', sr.created_at) as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION}   THEN 1 ELSE 0 END) as total_contracts,
      SUM(CASE WHEN ${COOLINGOFF_CONDITION} THEN 1 ELSE 0 END) as total_coolingoff
    ${baseSQL}
    GROUP BY period
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
  const baseSQL  = buildBaseSQL('', conditions, withJoin);

  const data = db.prepare(`
    SELECT
      strftime('%Y-%m', sr.created_at) as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION}   THEN 1 ELSE 0 END) as total_contracts,
      SUM(CASE WHEN ${COOLINGOFF_CONDITION} THEN 1 ELSE 0 END) as total_coolingoff
    ${baseSQL}
    GROUP BY period
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
//     interview_count          — スプレッドシート面接実施数（ファネル表示用）
//     interviewer, gender, age_group, income_level, job_type, streaming_exp
//                              — フィルター
//
//   CV = 営業報告の契約結果のみカウント（スプレッドシートのCV列は不使用）
// ============================================================
router.get('/summary', authenticateToken, (req, res) => {
  const { period, value, applicant_count, interview_count } = req.query;

  // 期間フィルター
  let periodCond = '';
  let periodParams = [];
  if (period === 'week' && value) {
    periodCond   = `strftime('%Y-W%W', sr.created_at) = ?`;
    periodParams = [value];
  } else if (period === 'month' && value) {
    periodCond   = `strftime('%Y-%m', sr.created_at) = ?`;
    periodParams = [value];
  }

  // 担当者・Notionフィルター
  const { conditions: filterConds, params: filterParams } = buildFilterSQL(req.query);
  const withJoin = needsNotionJoin(req.query);

  // 全条件を結合
  const allConds = [];
  if (periodCond)        allConds.push(periodCond);
  allConds.push(...filterConds);

  const dedup = `(
    SELECT * FROM sales_reports
    WHERE id IN (
      SELECT MAX(id) FROM sales_reports
      GROUP BY COALESCE(NULLIF(applicant_name_email,''), applicant_full_name)
    )
  ) AS sr`;
  const joinClause = withJoin
    ? `LEFT JOIN notion_profiles np ON np.student_number = sr.student_number`
    : '';
  const whereClause = allConds.length
    ? `WHERE ${allConds.join(' AND ')}`
    : '';
  const allParams = [...periodParams, ...filterParams];

  const baseSQL = `FROM ${dedup} ${joinClause} ${whereClause}`;

  // 総面接数
  const totalInterviewsRow = db.prepare(
    `SELECT COUNT(*) as count ${baseSQL}`
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

  // 面接実施数: シートから渡された値 > 0 なら優先、なければ営業報告件数
  const interviewFromSheet = parseInt(interview_count) || 0;
  const totalInterviews = interviewFromSheet > 0
    ? interviewFromSheet
    : totalInterviewsRow.count;

  const totalContracts  = totalContractsRow.count;
  const totalCoolingoff = totalCoolingoffRow.count;
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
    total_interviews:     totalInterviews,
    interview_from_sheet: interviewFromSheet,
    interview_from_db:    totalInterviewsRow.count,
    total_contracts:      totalContracts,
    total_coolingoff:     totalCoolingoff,
    coolingoff_rate:      coolingoffRate,
    applicant_count:      appCount,
    cvr_interview:        cvrInterview,
    cvr_applicant:        cvrApplicant,
    plan_breakdown:       planBreakdown,
  });
});

// ============================================================
// GET /api/stats/all-periods
// ============================================================
router.get('/all-periods', authenticateToken, (req, res) => {
  const { type } = req.query;
  const { conditions, params } = buildFilterSQL(req.query);
  const withJoin = needsNotionJoin(req.query);
  const baseSQL  = buildBaseSQL('', conditions, withJoin);

  const fmt   = type === 'week' ? `strftime('%Y-W%W', sr.created_at)` : `strftime('%Y-%m', sr.created_at)`;
  const limit = type === 'week' ? 52 : 24;

  const data = db.prepare(`
    SELECT
      ${fmt} as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION}   THEN 1 ELSE 0 END) as total_contracts,
      SUM(CASE WHEN ${COOLINGOFF_CONDITION} THEN 1 ELSE 0 END) as total_coolingoff
    ${baseSQL}
    GROUP BY period
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

module.exports = router;
