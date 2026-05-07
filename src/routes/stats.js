const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// 契約判定SQL
// 「契約」「契約＆職業案内」「契約＆職業案内（CP）」のみ TRUE
// ============================================================
const CONTRACT_CONDITION = `result IN ('契約', '契約＆職業案内', '契約＆職業案内（CP）')`;

// ============================================================
// 同一応募者の重複レコードを除いた最新1件ベースのサブクエリ
// applicant_full_name でグループ化し MAX(id) = 最新レコードのみ使用
// ============================================================
const DEDUP_SUBQUERY = `(
  SELECT * FROM sales_reports
  WHERE id IN (
    SELECT MAX(id) FROM sales_reports GROUP BY applicant_full_name
  )
) AS sr`;

// ============================================================
// GET /api/stats/weekly
// ============================================================
router.get('/weekly', authenticateToken, (req, res) => {
  const data = db.prepare(`
    SELECT
      strftime('%Y-W%W', created_at) as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION} THEN 1 ELSE 0 END) as total_contracts
    FROM ${DEDUP_SUBQUERY}
    GROUP BY period
    ORDER BY period DESC
    LIMIT 24
  `).all();

  res.json(data.map(d => ({
    ...d,
    cvr_interview: d.total_interviews > 0
      ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1) : '0.0',
  })));
});

// ============================================================
// GET /api/stats/monthly
// ============================================================
router.get('/monthly', authenticateToken, (req, res) => {
  const data = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION} THEN 1 ELSE 0 END) as total_contracts
    FROM ${DEDUP_SUBQUERY}
    GROUP BY period
    ORDER BY period DESC
    LIMIT 24
  `).all();

  res.json(data.map(d => ({
    ...d,
    cvr_interview: d.total_interviews > 0
      ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1) : '0.0',
  })));
});

// ============================================================
// GET /api/stats/summary
// クエリパラメータ:
//   period: 'week' | 'month'
//   value: 'YYYY-WXX' | 'YYYY-MM'
//   applicant_count:   スプレッドシートからの応募数（期間内・重複除外）
//   cv_contract_count: スプレッドシートのCV=TRUE件数（期間内）
//   interview_count:   スプレッドシートの面接実施=TRUE件数（期間内）
// ============================================================
router.get('/summary', authenticateToken, (req, res) => {
  const { period, value, applicant_count, cv_contract_count, interview_count } = req.query;

  let dateFilter = '';
  let params = [];

  if (period === 'week' && value) {
    dateFilter = "WHERE strftime('%Y-W%W', created_at) = ?";
    params = [value];
  } else if (period === 'month' && value) {
    dateFilter = "WHERE strftime('%Y-%m', created_at) = ?";
    params = [value];
  }

  // 重複除外後フィルタSQL（期間絞り込みをサブクエリの外側に適用）
  const dedupBase = `FROM ${DEDUP_SUBQUERY}`;
  const dedupWhere = dateFilter.replace('WHERE', 'WHERE');
  const dedupDateFilter = dateFilter ? dateFilter : '';
  const contractFilterSQL = dedupDateFilter
    ? `${dedupBase} ${dedupDateFilter} AND ${CONTRACT_CONDITION}`
    : `${dedupBase} WHERE ${CONTRACT_CONDITION}`;

  // 営業報告ベースの契約数（重複除外・正確な3値判定）
  const contractsFromReport = db.prepare(`
    SELECT COUNT(*) as count ${contractFilterSQL}
  `).get(...params);

  // 面接実施数: スプレッドシートの「面接実施」=TRUE件数を優先
  // 未設定（0）の場合は営業報告の件数（重複除外）をフォールバックとして使用
  const interviewFromSheet = parseInt(interview_count) || 0;
  const interviewFromDB = db.prepare(`
    SELECT COUNT(*) as count ${dedupBase} ${dedupDateFilter}
  `).get(...params);
  const totalInterviews = interviewFromSheet > 0 ? interviewFromSheet : interviewFromDB.count;

  // CV=TRUEの件数（スプレッドシートから渡される）
  const cvContracts = parseInt(cv_contract_count) || 0;

  // 契約数 = CV=TRUE件数を優先（営業報告の契約数もフォールバック）
  const totalContracts = Math.max(contractsFromReport.count, cvContracts);

  const appCount = parseInt(applicant_count) || 0;

  const cvrInterview = totalInterviews > 0
    ? ((totalContracts / totalInterviews) * 100).toFixed(1) : '0.0';
  const cvrApplicant = appCount > 0
    ? ((totalContracts / appCount) * 100).toFixed(1) : '0.0';

  res.json({
    period,
    value,
    total_interviews: totalInterviews,
    interview_from_sheet: interviewFromSheet,
    interview_from_db: interviewFromDB.count,
    total_contracts: totalContracts,
    contracts_from_report: contractsFromReport.count,
    contracts_from_cv: cvContracts,
    applicant_count: appCount,
    cvr_interview: cvrInterview,
    cvr_applicant: cvrApplicant,
  });
});

// ============================================================
// GET /api/stats/all-periods
// ============================================================
router.get('/all-periods', authenticateToken, (req, res) => {
  const { type } = req.query;

  const fmt = type === 'week' ? `strftime('%Y-W%W', created_at)` : `strftime('%Y-%m', created_at)`;
  const limit = type === 'week' ? 52 : 24;

  const data = db.prepare(`
    SELECT
      ${fmt} as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION} THEN 1 ELSE 0 END) as total_contracts
    FROM ${DEDUP_SUBQUERY}
    GROUP BY period
    ORDER BY period DESC
    LIMIT ${limit}
  `).all();

  res.json(data.map(d => ({
    ...d,
    cvr_interview: d.total_interviews > 0
      ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1) : '0.0',
  })));
});

module.exports = router;
