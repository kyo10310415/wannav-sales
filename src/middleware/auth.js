const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (typeof JWT_SECRET !== 'string' || Buffer.byteLength(JWT_SECRET.trim()) < 32 ||
    /^(?:wannav-sales-secret-key-2024|change[-_]?me|your[-_])/i.test(JWT_SECRET)) {
  throw new Error('JWT_SECRET must be a private random value of at least 32 bytes');
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'トークンが無効です' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '管理者権限が必要です' });
  }
  next();
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      login_id: user.login_id,
      name: user.name,
      role: user.role,
      must_change_password: user.must_change_password
    },
    JWT_SECRET,
    { expiresIn: '24h', algorithm: 'HS256' }
  );
}

module.exports = { authenticateToken, requireAdmin, generateToken, JWT_SECRET };
