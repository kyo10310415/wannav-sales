const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Helper: get week string like YYYY-WXX
function getWeekString(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const weekNum = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

// GET /api/stats/weekly - 週次CVR一覧
router.get('/weekly', authenticateToken, (req, res) => {
  const weeks = db.prepare(`
    SELECT
      strftime('%Y-W%W', created_at) as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN result LIKE '%契約%' OR result = '契約' THEN 1 ELSE 0 END) as total_contracts
    FROM sales_reports
    GROUP BY period
    ORDER BY period DESC
    LIMIT 24
  `).all();

  const result = weeks.map(w => ({
    period: w.period,
    total_interviews: w.total_interviews,
    total_contracts: w.total_contracts,
    cvr_interview: w.total_interviews > 0
      ? ((w.total_contracts / w.total_interviews) * 100).toFixed(1)
      : '0.0',
  }));

  res.json(result);
});

// GET /api/stats/monthly - 月次CVR一覧
router.get('/monthly', authenticateToken, (req, res) => {
  const months = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) as period,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN result LIKE '%契約%' OR result = '契約' THEN 1 ELSE 0 END) as total_contracts
    FROM sales_reports
    GROUP BY period
    ORDER BY period DESC
    LIMIT 24
  `).all();

  const result = months.map(m => ({
    period: m.period,
    total_interviews: m.total_interviews,
    total_contracts: m.total_contracts,
    cvr_interview: m.total_interviews > 0
      ? ((m.total_contracts / m.total_interviews) * 100).toFixed(1)
      : '0.0',
  }));

  res.json(result);
});

// GET /api/stats/cvr-with-applicants - 応募数含むCVR
// applicant_count must be passed from spreadsheet data on frontend
router.get('/summary', authenticateToken, (req, res) => {
  const { period, value, applicant_count } = req.query;

  let dateFilter = '';
  let params = [];

  if (period === 'week' && value) {
    dateFilter = "WHERE strftime('%Y-W%W', created_at) = ?";
    params = [value];
  } else if (period === 'month' && value) {
    dateFilter = "WHERE strftime('%Y-%m', created_at) = ?";
    params = [value];
  }

  const totalInterviews = db.prepare(`
    SELECT COUNT(*) as count FROM sales_reports ${dateFilter}
  `).get(...params);

  const contractCondition = dateFilter
    ? `${dateFilter} AND (result LIKE '%契約%' OR result = '契約')`
    : "WHERE (result LIKE '%契約%' OR result = '契約')";

  const totalContracts = db.prepare(`
    SELECT COUNT(*) as count FROM sales_reports ${contractCondition}
  `).get(...params);

  const appCount = parseInt(applicant_count) || 0;

  const cvrInterview = totalInterviews.count > 0
    ? ((totalContracts.count / totalInterviews.count) * 100).toFixed(1)
    : '0.0';

  const cvrApplicant = appCount > 0
    ? ((totalContracts.count / appCount) * 100).toFixed(1)
    : '0.0';

  res.json({
    period,
    value,
    total_interviews: totalInterviews.count,
    total_contracts: totalContracts.count,
    applicant_count: appCount,
    cvr_interview: cvrInterview,
    cvr_applicant: cvrApplicant,
  });
});

// GET /api/stats/all-periods - 全期間サマリー
router.get('/all-periods', authenticateToken, (req, res) => {
  const { type } = req.query; // 'week' or 'month'

  if (type === 'week') {
    const data = db.prepare(`
      SELECT
        strftime('%Y-W%W', created_at) as period,
        COUNT(*) as total_interviews,
        SUM(CASE WHEN result LIKE '%契約%' OR result = '契約' THEN 1 ELSE 0 END) as total_contracts
      FROM sales_reports
      GROUP BY period
      ORDER BY period DESC
      LIMIT 52
    `).all();

    res.json(data.map(d => ({
      ...d,
      cvr_interview: d.total_interviews > 0
        ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1)
        : '0.0'
    })));
  } else {
    const data = db.prepare(`
      SELECT
        strftime('%Y-%m', created_at) as period,
        COUNT(*) as total_interviews,
        SUM(CASE WHEN result LIKE '%契約%' OR result = '契約' THEN 1 ELSE 0 END) as total_contracts
      FROM sales_reports
      GROUP BY period
      ORDER BY period DESC
      LIMIT 24
    `).all();

    res.json(data.map(d => ({
      ...d,
      cvr_interview: d.total_interviews > 0
        ? ((d.total_contracts / d.total_interviews) * 100).toFixed(1)
        : '0.0'
    })));
  }
});

module.exports = router;
