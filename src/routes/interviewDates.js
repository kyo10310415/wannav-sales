const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================
// 応募者キー = email優先、なければ full_name
// ============================================================

// GET /api/interview-dates - 全件取得（Map形式で返す）
router.get('/', authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT applicant_key, interview_date, updated_at
    FROM applicant_interview_dates
  `).all();

  // { applicant_key: interview_date } のオブジェクトで返す
  const map = {};
  rows.forEach(r => { map[r.applicant_key] = r.interview_date || ''; });
  res.json(map);
});

// PUT /api/interview-dates/:key - 面接日をUPSERT（新規/更新）
// :key は encodeURIComponent されたapplicant_key
router.put('/:key', authenticateToken, (req, res) => {
  const applicantKey = decodeURIComponent(req.params.key);
  const { interview_date } = req.body;

  if (!applicantKey) {
    return res.status(400).json({ error: '応募者キーが必要です' });
  }

  db.prepare(`
    INSERT INTO applicant_interview_dates (applicant_key, interview_date, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(applicant_key) DO UPDATE SET
      interview_date = excluded.interview_date,
      updated_at = CURRENT_TIMESTAMP
  `).run(applicantKey, interview_date || null);

  res.json({ ok: true, applicant_key: applicantKey, interview_date: interview_date || null });
});

module.exports = router;
