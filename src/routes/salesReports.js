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
    interview_content,
    result,
    stay_count,
    no_count,
    contract_plan,
    payment_method,
    notion_url,
    lesson_start_date,
    character_rights,
    join_reasons,
    decline_reasons,
    phone_number,
    details
  } = req.body;

  if (!interviewer_id || !applicant_full_name) {
    return res.status(400).json({ error: '面接担当者と氏名は必須です' });
  }

  // 氏名+メールの複合キー生成
  const nameEmailKey = makeNameEmailKey(applicant_full_name, applicant_email);

  try {
    const stmt = db.prepare(`
      INSERT INTO sales_reports (
        interviewer_id, interviewer_name, applicant_full_name,
        applicant_last_name, applicant_first_name, applicant_email,
        student_number, interview_date, interview_content, result,
        stay_count, no_count, contract_plan,
        payment_method, notion_url, lesson_start_date,
        character_rights, join_reasons, decline_reasons, phone_number, details,
        applicant_name_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result_db = stmt.run(
      interviewer_id, interviewer_name, applicant_full_name,
      applicant_last_name, applicant_first_name, applicant_email,
      student_number, interview_date || null, interview_content,
      result, stay_count ?? 0, no_count ?? 0, contract_plan,
      payment_method, notion_url, lesson_start_date,
      character_rights,
      Array.isArray(join_reasons) ? join_reasons.join(',') : (join_reasons || ''),
      Array.isArray(decline_reasons) ? decline_reasons.join(',') : (decline_reasons || ''),
      phone_number, details,
      nameEmailKey
    );

    const report = db.prepare('SELECT * FROM sales_reports WHERE id = ?').get(result_db.lastInsertRowid);
    res.status(201).json(report);
  } catch (err) {
    res.status(500).json({ error: '営業報告の保存に失敗しました: ' + err.message });
  }
});

// PUT /api/sales-reports/:id - 営業報告追記（元レコードは保持し、新規レコードをINSERT）
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const original = db.prepare('SELECT * FROM sales_reports WHERE id = ?').get(id);

  if (!original) {
    return res.status(404).json({ error: '営業報告が見つかりません' });
  }

  const {
    interviewer_id, interviewer_name, applicant_full_name,
    applicant_last_name, applicant_first_name, applicant_email,
    student_number, interview_date, interview_content, result,
    stay_count, no_count, contract_plan,
    payment_method, notion_url, lesson_start_date,
    character_rights, join_reasons, decline_reasons, phone_number, details
  } = req.body;

  // 複合キーを生成（新しい氏名・メールで再生成）
  const nameEmailKey = makeNameEmailKey(
    applicant_full_name || original.applicant_full_name,
    applicant_email     !== undefined ? applicant_email : original.applicant_email
  );

  // 元レコードの parent_id（=祖先の初回報告ID）を引き継ぎ、なければ元レコードのidを使う
  const rootId = original.parent_id || original.id;

  try {
    const stmt = db.prepare(`
      INSERT INTO sales_reports (
        interviewer_id, interviewer_name, applicant_full_name,
        applicant_last_name, applicant_first_name, applicant_email,
        student_number, interview_date, interview_content, result,
        stay_count, no_count, contract_plan,
        payment_method, notion_url, lesson_start_date,
        character_rights, join_reasons, decline_reasons, phone_number, details,
        applicant_name_email, parent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result_db = stmt.run(
      interviewer_id    ?? original.interviewer_id,
      interviewer_name  ?? original.interviewer_name,
      applicant_full_name || original.applicant_full_name,
      applicant_last_name  ?? original.applicant_last_name,
      applicant_first_name ?? original.applicant_first_name,
      applicant_email      !== undefined ? applicant_email : original.applicant_email,
      student_number    ?? original.student_number,
      interview_date    !== undefined ? (interview_date || null) : original.interview_date,
      interview_content ?? original.interview_content,
      result            ?? original.result,
      stay_count        ?? original.stay_count ?? 0,
      no_count          ?? original.no_count ?? 0,
      contract_plan     ?? original.contract_plan,
      payment_method    ?? original.payment_method,
      notion_url        ?? original.notion_url,
      lesson_start_date !== undefined ? (lesson_start_date || null) : original.lesson_start_date,
      character_rights  ?? original.character_rights,
      Array.isArray(join_reasons)     ? join_reasons.join(',')     : (join_reasons     ?? original.join_reasons     ?? ''),
      Array.isArray(decline_reasons)  ? decline_reasons.join(',')  : (decline_reasons  ?? original.decline_reasons  ?? ''),
      phone_number ?? original.phone_number,
      details      ?? original.details,
      nameEmailKey,
      rootId
    );

    const newReport = db.prepare('SELECT * FROM sales_reports WHERE id = ?').get(result_db.lastInsertRowid);
    res.json(newReport);
  } catch (err) {
    return res.status(500).json({ error: '営業報告の追記に失敗しました: ' + err.message });
  }
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

// ============================================================
// 契約判定・重複除外（stats.js と共通ロジック）
// ============================================================
const SR_CONTRACT_CONDITION = `result IN ('契約', '契約＆職業案内', '契約＆職業案内（CP）')`;
// 氏名+メールアドレスの複合キーで重複除外（同姓同名対応）
// applicant_name_email が NULL の旧レコードは applicant_full_name にフォールバック
// 全件集計（追記報告も含む全行を対象）
const SR_DEDUP_SUBQUERY = `sales_reports AS sr`;

// 氏名・メールアドレスを正規化して複合キーを生成するヘルパー
function makeNameEmailKey(fullName, email) {
  const normalName  = (fullName || '').replace(/[\s\u3000]/g, '').toLowerCase();
  const normalEmail = (email   || '').toLowerCase().trim();
  return `${normalName}::${normalEmail}`;
}

// GET /api/sales-reports/stats/cvr - CVR集計
router.get('/stats/cvr', authenticateToken, (req, res) => {
  const { period, value } = req.query;

  let dateFilter = '';
  let params = [];

  if (period === 'week' && value) {
    dateFilter = "WHERE strftime('%Y-W%W', created_at) = ?";
    params = [value];
  } else if (period === 'month' && value) {
    dateFilter = "WHERE strftime('%Y-%m', created_at) = ?";
    params = [value];
  }

  const dedupBase = `FROM ${SR_DEDUP_SUBQUERY}`;

  const totalInterviews = db.prepare(`
    SELECT COUNT(*) as count ${dedupBase} WHERE sr.parent_id IS NULL ${dateFilter ? 'AND ' + dateFilter.replace(/^WHERE\s+/i,'') : ''}
  `).get(...params);

  const contractFilter = dateFilter
    ? `${dedupBase} ${dateFilter} AND ${SR_CONTRACT_CONDITION}`
    : `${dedupBase} WHERE ${SR_CONTRACT_CONDITION}`;

  const totalContracts = db.prepare(`
    SELECT COUNT(*) as count ${contractFilter}
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
      COUNT(CASE WHEN parent_id IS NULL THEN 1 END) as total_interviews,
      SUM(CASE WHEN ${SR_CONTRACT_CONDITION} THEN 1 ELSE 0 END) as total_contracts
    FROM ${SR_DEDUP_SUBQUERY}
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
      COUNT(CASE WHEN parent_id IS NULL THEN 1 END) as total_interviews,
      SUM(CASE WHEN ${SR_CONTRACT_CONDITION} THEN 1 ELSE 0 END) as total_contracts
    FROM ${SR_DEDUP_SUBQUERY}
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();
  res.json(months);
});

module.exports = router;
