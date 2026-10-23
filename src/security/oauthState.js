const { randomBytes, timingSafeEqual } = require('node:crypto');

const COOKIE = 'calendar_oauth_session';
const TTL = 10 * 60 * 1000;
const pending = new Map();

function cookieValue(header = '') {
  const value = header.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}

function issue(req, res, userId, secure, now = Date.now()) {
  for (const [state, item] of pending) {
    if (item.expires <= now) pending.delete(state);
  }
  // Bound pending authorizations even when authenticated callers repeatedly start OAuth.
  if (pending.size >= 1000) throw new Error('Too many pending authorizations');
  const session = cookieValue(req.headers.cookie) || randomBytes(32).toString('hex');
  const state = randomBytes(32).toString('hex');
  pending.set(state, { userId, session, expires: now + TTL });
  res.cookie(COOKIE, session, { httpOnly: true, secure, sameSite: 'lax',
    path: '/api/calendar', maxAge: TTL });
  return state;
}

function consume(req, now = Date.now()) {
  const state = req.query.state;
  const session = cookieValue(req.headers.cookie);
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || !session) return null;
  const item = pending.get(state);
  if (!item || item.expires <= now) {
    pending.delete(state);
    return null;
  }
  if (!timingSafeEqual(Buffer.from(session), Buffer.from(item.session))) return null;
  pending.delete(state); // Consume before exchanging a code, including failed exchanges.
  return item.userId;
}

module.exports = { issue, consume };
