const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { generateToken, authenticateToken } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { login_id, password } = req.body;

  if (!login_id || !password) {
    return res.status(400).json({ error: 'IDとパスワードを入力してください' });
  }

  const user = db.prepare('SELECT * FROM users WHERE login_id = ?').get(login_id);

  if (!user) {
    return res.status(401).json({ error: 'IDまたはパスワードが間違っています' });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ error: 'IDまたはパスワードが間違っています' });
  }

  const token = generateToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      login_id: user.login_id,
      name: user.name,
      role: user.role,
      must_change_password: user.must_change_password
    }
  });
});

// POST /api/auth/change-password
router.post('/change-password', authenticateToken, (req, res) => {
  const { current_password, new_password } = req.body;

  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ error: '新しいパスワードは4文字以上で入力してください' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' });
  }

  // If not first-time change, verify current password
  if (!user.must_change_password) {
    if (!current_password) {
      return res.status(400).json({ error: '現在のパスワードを入力してください' });
    }
    const validPassword = bcrypt.compareSync(current_password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: '現在のパスワードが間違っています' });
    }
  }

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newHash, req.user.id);

  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = generateToken(updatedUser);

  res.json({ message: 'パスワードを変更しました', token });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, login_id, name, role, must_change_password FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' });
  }
  res.json(user);
});

module.exports = router;
