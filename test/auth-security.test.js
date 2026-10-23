const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://sales.example/api/calendar/callback';

let exchanges = 0;
let saved = [];
let failExchange = false;
const poison = "</script><script>alert('x')</script>\u2028";
function mockModule(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mockModule('../src/database', { prepare: sql => ({
  get: id => ({ id }),
  run: (...values) => { saved.push(values); return { changes: 1 }; },
}) });
mockModule('../src/routes/spreadsheet', { cache: {} });
mockModule('../src/services/calendarInterviewSync', { syncCalendarEvents() { throw Error('not called'); } });
mockModule('googleapis', { google: {
  auth: { OAuth2: class {
    generateAuthUrl(options) { return `https://accounts.example/authorize?state=${options.state}`; }
    async getToken() { exchanges++; if (failExchange) throw Error(poison); return { tokens: { refresh_token: 'test-refresh' } }; }
    setCredentials() {}
  } },
  oauth2: () => ({ userinfo: { get: async () => ({ data: { email: poison } }) } }),
} });
const { generateToken } = require('../src/middleware/auth');
const { issue, consume } = require('../src/security/oauthState');
const { responsePage } = require('../src/security/oauthResponse');
const app = express();
app.use('/api/calendar', require('../src/routes/calendar'));
let server, origin;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); origin = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r => server.close(r)); });
async function start(userId = 42) {
  const res = await fetch(`${origin}/api/calendar/auth-url`, { headers: { Authorization: `Bearer ${generateToken({ id: userId, role: 'admin' })}` } });
  assert.equal(res.status, 200);
  const { url } = await res.json();
  return { state: new URL(url).searchParams.get('state'), cookie: res.headers.get('set-cookie') };
}
async function callback(flow, suffix = '&code=test-code', cookie = flow.cookie) {
  return fetch(`${origin}/api/calendar/callback?state=${flow.state}${suffix}`, { headers: cookie ? { Cookie: cookie.split(';')[0] } : {} });
}
test('missing, short, default and placeholder JWT keys fail before startup', () => {
  for (const key of ['', 'short', 'wannav-sales-secret-key-2024', 'your-super-secret-jwt-key-change-this']) {
    const child = spawnSync(process.execPath, ['-e', "require('./src/middleware/auth')"], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, JWT_SECRET: key }, encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /JWT_SECRET must/);
  }
});
test('auth URL rejects anonymous and non-HS256 tokens', async () => {
  assert.equal((await fetch(`${origin}/api/calendar/auth-url`)).status, 401);
  const token = jwt.sign({ id: 42 }, process.env.JWT_SECRET, { algorithm: 'HS384' });
  assert.equal((await fetch(`${origin}/api/calendar/auth-url`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
});
test('state is unpredictable and browser cookie is secure and HttpOnly', async () => {
  const a = await start(); const b = await start();
  assert.match(a.state, /^[a-f0-9]{64}$/); assert.notEqual(a.state, b.state);
  assert.match(a.cookie, /HttpOnly/); assert.match(a.cookie, /Secure/); assert.match(a.cookie, /SameSite=Lax/);
});
test('missing, forged, cross-browser, numeric and duplicate-query state cannot exchange a code or save', async () => {
  const a = await start(); const b = await start(); const before = exchanges;
  assert.equal((await callback(a, '&code=x', null)).status, 400);
  assert.equal((await callback(a, '&code=x', b.cookie)).status, 400);
  assert.equal((await callback({ ...a, state: '42' })).status, 400);
  assert.equal((await callback({ ...a, state: '0'.repeat(64) })).status, 400);
  assert.equal((await callback(a, `&state=${b.state}&code=x`)).status, 400);
  assert.equal(exchanges, before);
});
test('valid callback saves only initiating user and consumes state once', async () => {
  const a = await start(73); const before = exchanges;
  const res = await callback(a); const html = await res.text();
  assert.equal(res.status, 200); assert.equal(saved.at(-1)[2], 73);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(!html.includes(poison)); assert.match(html, /\\u003c\/script\\u003e/);
  assert.ok(html.includes('https://sales.example')); assert.ok(!html.includes("}, '*')"));
  assert.equal((await callback(a)).status, 400); assert.equal(exchanges, before + 1);
});
test('provider error requires state, uses fixed response, and consumes it', async () => {
  const a = await start(); const before = exchanges;
  const res = await callback(a, `&error=${encodeURIComponent(poison)}`);
  assert.equal(res.status, 200); assert.ok(!(await res.text()).includes(poison));
  assert.equal((await callback(a)).status, 400); assert.equal(exchanges, before);
});
test('failed token exchange cannot replay and exception text is not reflected', async () => {
  const a = await start(); failExchange = true;
  try { const res = await callback(a); assert.ok(!(await res.text()).includes(poison)); }
  finally { failExchange = false; }
  assert.equal((await callback(a)).status, 400);
});
test('state expires after ten minutes', () => {
  let cookie;
  const state = issue({ headers: {} }, { cookie: (name, value) => { cookie = `${name}=${value}`; } }, 42, false, 100);
  assert.equal(consume({ headers: { cookie }, query: { state } }, 600101), null);
});
test('callback response serializes all script breakout characters', () => {
  const html = responsePage({ error: poison + '<>&\u2029' }, 'https://sales.example');
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.ok(!html.includes(poison)); assert.match(html, /\\u2028/); assert.match(html, /\\u2029/);
});

test('popup receiver rejects foreign origin/source and escapes accepted notification data', async () => {
  const vm = require('node:vm');
  const popup = { closed: false }; let handler; const notifications = [];
  const context = vm.createContext({
    document: { getElementById: () => null, addEventListener() {} },
    window: { location: { origin: 'https://sales.example' }, open: () => popup,
      addEventListener: (_type, fn) => { handler = fn; }, removeEventListener() {} },
    API: { calendar: { authUrl: async () => ({ url: 'https://accounts.example' }) } },
    Utils: { escHtml: text => String(text).replace(/</g, '&lt;'), notify: value => notifications.push(value) },
    setInterval() {}, clearInterval() {},
  });
  vm.runInContext(require('node:fs').readFileSync(require.resolve('../public/js/app.js'), 'utf8'), context);
  const App = vm.runInContext('App', context); App._mountGoogleBtn = () => {};
  await App._openGoogleAuth();
  await handler({ origin: 'https://attacker.example', source: popup, data: { type: 'GOOGLE_AUTH_SUCCESS', email: poison } });
  await handler({ origin: 'https://sales.example', source: {}, data: { type: 'GOOGLE_AUTH_SUCCESS', email: poison } });
  assert.equal(notifications.length, 0);
  await handler({ origin: 'https://sales.example', source: popup, data: { type: 'GOOGLE_AUTH_SUCCESS', email: poison } });
  assert.equal(notifications.length, 1); assert.ok(!notifications[0].includes('<script>'));
});
