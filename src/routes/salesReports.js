const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/sales-reports - 営業報告一覧
router.get('/', authenticateToken, (req, res) => {
  const reports = db.prepare(`
    SELECT sr.*, u.name as interviewer_user_name
    FROM sales_reports sr
    LEFT JOIN users u ON sr.interviewer_id = u.id
    ORDER BY sr.created_at DESC
  `).all();
  res.json(reports);
});

// GET /api/sales-reports/:id - 特定の営業報告
router.get('/:id', authenticateToken, (req, res) => {
  const report = db.prepare(`
    SELECT sr.*, u.name as interviewer_user_name
    FROM sales_reports sr
    LEFT JOIN users u ON sr.interviewer_id = u.id
    WHERE sr.id = ?
  `).get(req.params.id);

  if (!report) {
    return res.status(404).json({ error: '営業報告が見つかりません' });
  }
  res.json(report);
});

// POST /api/sales-reports - 営業報告作成
router.post('/', authenticateToken, (req, res) => {
  const {
    interviewer_id,
    interviewer_name,
    applicant_full_name,
    applicant_last_name,
    applicant_first_name,
    applicant_email,
    student_number,
    interview_date,
    interview_time,
    result,
    contract_plan,
    payment_method,
    notion_url,
    lesson_start_date,
    character_rights,
    details
  } = req.body;

  if (!interviewer_id || !applicant_full_name) {
    return res.status(400).json({ error: '面接担当者と氏名は必須です' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO sales_reports (
        interviewer_id, interviewer_name, applicant_full_name,
        applicant_last_name, applicant_first_name, applicant_email,
        student_number, interview_date, interview_time, result, contract_plan,
        payment_method, notion_url, lesson_start_date,
        character_rights, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result_db = stmt.run(
      interviewer_id, interviewer_name, applicant_full_name,
      applicant_last_name, applicant_first_name, applicant_email,
      student_number, interview_date || null, interview_time, result, contract_plan,
      payment_method, notion_url, lesson_start_date,
      character_rights, details
    );

    const report = db.prepare('SELECT * FROM sales_reports WHERE id = ?').get(result_db.lastInsertRowid);
    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ error: '営業報告の保存に失敗しました: ' + err.message });
  }
});

// PUT /api/sales-reports/:id - 営業報告更新
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const report = db.prepare('SELECT * FROM sales_reports WHERE id = ?').get(id);

  if (!report) {
    return res.status(404).json({ error: '営業報告が見つかりません' });
  }

  const {
    interviewer_id, interviewer_name, applicant_full_name,
    applicant_last_name, applicant_first_name, applicant_email,
    student_number, interview_date, interview_time, result, contract_plan,
    payment_method, notion_url, lesson_start_date,
    character_rights, details
  } = req.body;

  db.prepare(`
    UPDATE sales_reports SET
      interviewer_id = ?, interviewer_name = ?, applicant_full_name = ?,
      applicant_last_name = ?, applicant_first_name = ?, applicant_email = ?,
      student_number = ?, interview_date = ?, interview_time = ?, result = ?, contract_plan = ?,
      payment_method = ?, notion_url = ?, lesson_start_date = ?,
      character_rights = ?, details = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    interviewer_id, interviewer_name, applicant_full_name,
    applicant_last_name, applicant_first_name, applicant_email,
    student_number, interview_date || null, interview_time, result, contract_plan,
    payment_method, notion_url, lesson_start_date,
    character_rights, details, id
  );

  const updated = db.prepare('SELECT * FROM sales_reports WHERE id = ?').get(id);
  res.json(updated);
});

// DELETE /api/sales-reports/:id - 営業報告削除
router.delete('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const report = db.prepare('SELECT * FROM sales_reports WHERE id = ?').get(id);

  if (!report) {
    return res.status(404).json({ error: '営業報告が見つかりません' });
  }

  db.prepare('DELETE FROM sales_reports WHERE id = ?').run(id);
  res.json({ message: '削除しました' });
});

// GET /api/sales-reports/stats/cvr - CVR集計
router.get('/stats/cvr', authenticateToken, (req, res) => {
  const { period, value } = req.query;
  // period: 'week' | 'month'
  // value: 'YYYY-WXX' for week, 'YYYY-MM' for month

  let dateFilter = '';
  let params = [];

  if (period === 'week' && value) {
    // Filter by week (strftime('%Y-W%W', created_at) = value)
    dateFilter = "WHERE strftime('%Y-W%W', created_at) = ?";
    params = [value];
  } else if (period === 'month' && value) {
    dateFilter = "WHERE strftime('%Y-%m', created_at) = ?";
    params = [value];
  }

  // 面接実施数（全レコード数）
  const totalInterviews = db.prepare(`
    SELECT COUNT(*) as count FROM sales_reports ${dateFilter}
  `).get(...params);

  // 契約数（resultが「契約」を含む）
  const contractCondition = dateFilter
    ? dateFilter + " AND (result LIKE '%契約%' OR result = '契約')"
    : "WHERE (result LIKE '%契約%' OR result = '契約')";

  const totalContracts = db.prepare(`
    SELECT COUNT(*) as count FROM sales_reports ${contractCondition}
  `).get(...params);

  res.json({
    total_interviews: totalInterviews.count,
    total_contracts: totalContracts.count,
    cvr_interview: totalInterviews.count > 0
      ? ((totalContracts.count / totalInterviews.count) * 100).toFixed(1)
      : '0.0',
  });
});

// GET /api/sales-reports/stats/weekly - 週次サマリー一覧
router.get('/stats/weekly', authenticateToken, (req, res) => {
  const weeks = db.prepare(`
    SELECT
      strftime('%Y-W%W', created_at) as week,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN result LIKE '%契約%' OR result = '契約' THEN 1 ELSE 0 END) as total_contracts
    FROM sales_reports
    GROUP BY week
    ORDER BY week DESC
    LIMIT 12
  `).all();
  res.json(weeks);
});

// GET /api/sales-reports/stats/monthly - 月次サマリー一覧
router.get('/stats/monthly', authenticateToken, (req, res) => {
  const months = db.prepare(`
    SELECT
      strftime('%Y-%m', created_at) as month,
      COUNT(*) as total_interviews,
      SUM(CASE WHEN result LIKE '%契約%' OR result = '契約' THEN 1 ELSE 0 END) as total_contracts
    FROM sales_reports
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();
  res.json(months);
});

module.exports = router;
