const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// 契約判定SQL（営業報告の result に「契約」を含む）
// ============================================================
const CONTRACT_CONDITION = `(result LIKE '%契約%' OR result = '契約')`;

// ============================================================
// GET /api/stats/weekly
// ============================================================
router.get('/weekly', authenticateToken, (req, res) => {
  const data = db.prepare(`
    SELECT
      strftime('%Y-W%W', created_at) as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${CONTRACT_CONDITION} THEN 1 ELSE 0 END) as total_contracts
    FROM sales_reports
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
    FROM sales_reports
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
//   applicant_count: スプレッドシートからの応募数（期間内）
//   cv_contract_count: スプレッドシートのCV=TRUEの件数（期間内）
// ============================================================
router.get('/summary', authenticateToken, (req, res) => {
  const { period, value, applicant_count, cv_contract_count } = req.query;

  let dateFilter = '';
  let params = [];

  if (period === 'week' && value) {
    dateFilter = "WHERE strftime('%Y-W%W', created_at) = ?";
    params = [value];
  } else if (period === 'month' && value) {
    dateFilter = "WHERE strftime('%Y-%m', created_at) = ?";
    params = [value];
  }

  // 面接実施数（営業報告の総件数）
  const totalInterviews = db.prepare(`
    SELECT COUNT(*) as count FROM sales_reports ${dateFilter}
  `).get(...params);

  // 営業報告ベースの契約数
  const contractFilterSQL = dateFilter
    ? `${dateFilter} AND ${CONTRACT_CONDITION}`
    : `WHERE ${CONTRACT_CONDITION}`;

  const contractsFromReport = db.prepare(`
    SELECT COUNT(*) as count FROM sales_reports ${contractFilterSQL}
  `).get(...params);

  // CV=TRUEの件数（スプレッドシートから渡される）
  const cvContracts = parseInt(cv_contract_count) || 0;

  // 契約数 = 営業報告の契約数 + CV=TRUE件数（重複を避けるため最大値）
  // ※ 実際には営業報告のresultが「契約」 OR スプレッドシートのCVがTRUE
  // より大きい方を使う（ただし両方ある場合の重複に注意）
  // → ここでは「cv_contract_count」を優先（営業報告未入力でもTRUEなら契約）
  const totalContracts = Math.max(contractsFromReport.count, cvContracts);

  const appCount = parseInt(applicant_count) || 0;

  const cvrInterview = totalInterviews.count > 0
    ? ((totalContracts / totalInterviews.count) * 100).toFixed(1) : '0.0';
  const cvrApplicant = appCount > 0
    ? ((totalContracts / appCount) * 100).toFixed(1) : '0.0';

  res.json({
    period,
    value,
    total_interviews: totalInterviews.count,
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
    FROM sales_reports
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
