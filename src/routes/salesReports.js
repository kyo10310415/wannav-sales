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

  // 同一応募者（氏名+メール一致）の既存レポートを確認
  const existing = db.prepare(
    'SELECT id, interview_date, result FROM sales_reports WHERE applicant_name_email = ? ORDER BY id DESC LIMIT 1'
  ).get(nameEmailKey);
  if (existing) {
    const dateStr = existing.interview_date || '（日付不明）';
    return res.status(409).json({
      error: `この応募者の営業報告（面接日: ${dateStr} / 結果: ${existing.result || '未記入'}）がすでに登録されています。編集する場合は既存の報告を開いてください。`,
      existingId: existing.id,
    });
  }

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
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'この応募者の営業報告はすでに登録されています（氏名・メールアドレスが一致）。' });
    }
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
    student_number, interview_date, interview_content, result,
    stay_count, no_count, contract_plan,
    payment_method, notion_url, lesson_start_date,
    character_rights, join_reasons, decline_reasons, phone_number, details
  } = req.body;

  // 氏名またはメールが変更された場合は複合キーを再生成
  const updatedKey = makeNameEmailKey(applicant_full_name, applicant_email);

  // 他のレコードと重複しないか確認（自分自身は除外）
  const conflicting = db.prepare(
    'SELECT id FROM sales_reports WHERE applicant_name_email = ? AND id != ?'
  ).get(updatedKey, id);
  if (conflicting) {
    return res.status(409).json({
      error: `この氏名・メールアドレスの組み合わせでは別の営業報告（ID: ${conflicting.id}）がすでに登録されています。`,
      existingId: conflicting.id,
    });
  }

  try {
    db.prepare(`
      UPDATE sales_reports SET
        interviewer_id = ?, interviewer_name = ?, applicant_full_name = ?,
        applicant_last_name = ?, applicant_first_name = ?, applicant_email = ?,
        student_number = ?, interview_date = ?, interview_content = ?, result = ?,
        stay_count = ?, no_count = ?, contract_plan = ?,
        payment_method = ?, notion_url = ?, lesson_start_date = ?,
        character_rights = ?, join_reasons = ?, decline_reasons = ?,
        phone_number = ?, details = ?, applicant_name_email = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      interviewer_id, interviewer_name, applicant_full_name,
      applicant_last_name, applicant_first_name, applicant_email,
      student_number, interview_date || null, interview_content, result,
      stay_count ?? 0, no_count ?? 0, contract_plan,
      payment_method, notion_url, lesson_start_date,
      character_rights,
      Array.isArray(join_reasons) ? join_reasons.join(',') : (join_reasons || ''),
      Array.isArray(decline_reasons) ? decline_reasons.join(',') : (decline_reasons || ''),
      phone_number, details, updatedKey, id
    );
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'この応募者の営業報告はすでに別のIDで登録されています。' });
    }
    return res.status(500).json({ error: '営業報告の更新に失敗しました: ' + err.message });
  }

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

// ============================================================
// 契約判定・重複除外（stats.js と共通ロジック）
// ============================================================
const SR_CONTRACT_CONDITION = `result IN ('契約', '契約＆職業案内', '契約＆職業案内（CP）')`;
// 氏名+メールアドレスの複合キーで重複除外（同姓同名対応）
// applicant_name_email が NULL の旧レコードは applicant_full_name にフォールバック
const SR_DEDUP_SUBQUERY = `(
  SELECT * FROM sales_reports
  WHERE id IN (
    SELECT MAX(id) FROM sales_reports
    GROUP BY COALESCE(NULLIF(applicant_name_email,''), applicant_full_name)
  )
) AS sr`;

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
    SELECT COUNT(*) as count ${dedupBase} ${dateFilter}
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
      COUNT(*) as total_interviews,
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
      COUNT(*) as total_interviews,
      SUM(CASE WHEN ${SR_CONTRACT_CONDITION} THEN 1 ELSE 0 END) as total_contracts
    FROM ${SR_DEDUP_SUBQUERY}
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();
  res.json(months);
});

module.exports = router;
