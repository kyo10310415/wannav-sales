const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/users - 全ユーザー取得（管理者のみ）
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, login_id, name, role, must_change_password, created_at, updated_at
    FROM users
    ORDER BY created_at ASC
  `).all();
  res.json(users);
});

// GET /api/users/sales - セールス権限ユーザー一覧（営業報告フォーム用）
router.get('/sales', authenticateToken, (req, res) => {
  const users = db.prepare(`
    SELECT id, name FROM users WHERE role = 'sales' ORDER BY name ASC
  `).all();
  res.json(users);
});

// POST /api/users - ユーザー作成（管理者のみ）
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { login_id, name, role } = req.body;

  if (!login_id || !name || !role) {
    return res.status(400).json({ error: 'ID、名前、権限は必須です' });
  }

  if (!['admin', 'sales'].includes(role)) {
    return res.status(400).json({ error: '権限は "admin" または "sales" を指定してください' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE login_id = ?').get(login_id);
  if (existing) {
    return res.status(409).json({ error: 'このIDはすでに使用されています' });
  }

  const hash = bcrypt.hashSync('1111', 10);

  try {
    const result = db.prepare(`
      INSERT INTO users (login_id, name, role, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, 1)
    `).run(login_id, name, role, hash);

    const user = db.prepare(`
      SELECT id, login_id, name, role, must_change_password, created_at FROM users WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: 'ユーザー作成に失敗しました: ' + err.message });
  }
});

// PUT /api/users/:id - ユーザー更新（管理者のみ）
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, role, login_id } = req.body;

  if (!name || !role || !login_id) {
    return res.status(400).json({ error: 'ID、名前、権限は必須です' });
  }

  if (!['admin', 'sales'].includes(role)) {
    return res.status(400).json({ error: '権限は "admin" または "sales" を指定してください' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' });
  }

  // Check if login_id is taken by another user
  const existing = db.prepare('SELECT id FROM users WHERE login_id = ? AND id != ?').get(login_id, id);
  if (existing) {
    return res.status(409).json({ error: 'このIDはすでに使用されています' });
  }

  db.prepare(`
    UPDATE users SET login_id = ?, name = ?, role = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(login_id, name, role, id);

  const updated = db.prepare(`
    SELECT id, login_id, name, role, must_change_password, created_at, updated_at FROM users WHERE id = ?
  `).get(id);

  res.json(updated);
});

// POST /api/users/:id/reset-password - パスワードリセット（管理者のみ）
router.post('/:id/reset-password', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' });
  }

  const hash = bcrypt.hashSync('1111', 10);
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(hash, id);

  res.json({ message: 'パスワードをリセットしました（初期パスワード: 1111）' });
});

// DELETE /api/users/:id - ユーザー削除（管理者のみ）
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: '自分自身は削除できません' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'ユーザーを削除しました' });
});

module.exports = router;
