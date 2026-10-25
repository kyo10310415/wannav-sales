'use strict';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = require('node:crypto').randomBytes(48).toString('hex');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { google } = require('googleapis');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
// Database bootstrap logs are irrelevant to this in-memory fixture.
const originalLog = console.log;
let db;
try { console.log = () => {}; db = require('../src/database'); }
finally { console.log = originalLog; }
after(() => db.close());

function offline(t, client, respond) {
  for (const mod of [require('node:http'), require('node:https')]) {
    t.mock.method(mod, 'request', () => { throw Error('Unexpected external network'); });
    t.mock.method(mod, 'get', () => { throw Error('Unexpected external network'); });
  }
  t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected external fetch'); });
  const requests = [];
  client.transporter.defaults.fetchImplementation = async (url, options) => {
    const request = { url: new URL(url), method: options.method, body: options.body };
    requests.push(request);
    const { data = {}, status = 200 } = respond(request);
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  };
  return requests;
}
function oauth() {
  const client = new google.auth.OAuth2('fixture-client', 'fixture-client-secret', 'https://fixture.invalid/callback');
  client.setCredentials({ access_token: 'fixture-access', expiry_date: Date.now() + 3600000 });
  return client;
}
function sheetRouter(logs) {
  const filename = require.resolve('../src/routes/spreadsheet');
  const module = { exports: {} };
  // Prevent the application's startup warmup/interval; test only explicit requests.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename), module, exports: module.exports, process,
    setTimeout() {}, setInterval() {},
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  });
  return module.exports;
}
async function localApp(t, router) {
  const app = express();
  app.use('/sheet', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

test('real Sheets client preserves applicant parsing, empty responses and anonymous denial', async t => {
  const localFetch = globalThis.fetch;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'fixture@example.invalid', private_key: 'fixture-not-a-key' });
  t.after(() => delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  let empty = false;
  const client = oauth();
  const requests = offline(t, client, () => ({ data: empty ? {} : { values: [
    ['応募日', '姓', '名', 'メールアドレス', '一次面接担当', 'CV'],
    ['2026/10/01', 'Fixture', 'One', 'fixture@example.invalid', '', 'TRUE'],
    ['2026/10/01', 'Fixture', 'Duplicate', '', 'ダブり', 'FALSE'],
  ] } }));
  t.mock.method(google.auth.GoogleAuth.prototype, 'getClient', async () => client);
  const router = sheetRouter([]);
  const origin = await localApp(t, router);
  const headers = { Authorization: 'Bearer ' + jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET) };
  assert.equal((await localFetch(origin + '/sheet/applicants')).status, 401);
  assert.equal(requests.length, 0);
  const result = await (await localFetch(origin + '/sheet/applicants?refresh=1', { headers })).json();
  assert.equal(result.total, 1); assert.equal(result.cv_count, 1);
  assert.equal(result.applicants[0].email, 'fixture@example.invalid');
  assert.equal(requests[0].url.hostname, 'sheets.googleapis.com');
  assert.equal(requests[0].method, 'GET');
  empty = true;
  assert.equal((await (await localFetch(origin + '/sheet/applicants?refresh=1', { headers })).json()).total, 0);
});

test('Sheets failures preserve stale fallback without leaking provider details', async t => {
  const localFetch = globalThis.fetch;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
  t.after(() => delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const client = oauth();
  const marker = 'fixture-sensitive-provider-message';
  offline(t, client, () => ({ status: 400, data: { error: { message: marker } } }));
  t.mock.method(google.auth.GoogleAuth.prototype, 'getClient', async () => client);
  const logs = [], router = sheetRouter(logs), origin = await localApp(t, router);
  const headers = { Authorization: 'Bearer ' + jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET) };
  for (const route of ['/applicants', '/applicants/gh', '/applicants/count']) {
    const response = await localFetch(origin + '/sheet' + route + '?refresh=1', { headers });
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes(marker));
  }
  router.cache.set({ applicants: [], headers: [] }, [], []);
  const stale = await (await localFetch(origin + '/sheet/applicants?refresh=1', { headers })).json();
  assert.equal(stale.stale, true);
  assert.ok(!JSON.stringify(stale).includes(marker));
  assert.ok(!JSON.stringify(logs).includes(marker));
});

test('OAuth code exchange, refresh, userinfo and Calendar pagination retain SDK contracts offline', async t => {
  const client = oauth();
  const requests = offline(t, client, req => {
    if (req.url.hostname === 'oauth2.googleapis.com') return { data: { access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'Bearer' } };
    if (req.url.pathname.endsWith('/userinfo')) return { data: { email: 'fixture@example.invalid' } };
    return { data: { items: [{ id: 'fixture-event' }], nextPageToken: 'fixture-next' } };
  });
  const url = new URL(client.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/calendar.readonly'], state: 'fixture-state' }));
  assert.equal(url.searchParams.get('state'), 'fixture-state');
  const { tokens } = await client.getToken('fixture-code');
  assert.equal(tokens.refresh_token, 'fixture-refresh');
  assert.equal(new URLSearchParams(requests[0].body).get('grant_type'), 'authorization_code');
  client.setCredentials({ refresh_token: tokens.refresh_token });
  const refreshed = await client.getAccessToken();
  assert.equal(refreshed.token, 'fixture-access');
  assert.equal(new URLSearchParams(requests[1].body).get('grant_type'), 'refresh_token');
  assert.equal((await google.oauth2({ version: 'v2', auth: client }).userinfo.get()).data.email, 'fixture@example.invalid');
  const calendar = google.calendar({ version: 'v3', auth: client });
  const result = await calendar.events.list({ calendarId: 'primary', singleEvents: true, maxResults: 2500, pageToken: 'fixture-page', timeMin: '2026-10-01T00:00:00Z' });
  assert.equal(result.data.nextPageToken, 'fixture-next');
  const request = requests.at(-1);
  assert.equal(request.url.searchParams.get('pageToken'), 'fixture-page');
  assert.equal(request.url.searchParams.get('singleEvents'), 'true');
  assert.equal(request.url.searchParams.get('maxResults'), '2500');
});

test('API-key Sheets access retains query serialization without external I/O', async t => {
  offline(t, oauth(), () => ({ data: {} }));
  let request;
  const sheets = google.sheets({ version: 'v4', auth: 'fixture-api-key',
    fetchImplementation: async (url, options) => {
      request = { url: new URL(url), method: options.method };
      return new Response(JSON.stringify({ values: [['fixture']] }), { headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: 'fixture-sheet', range: 'Sheet1!A1' });
  assert.deepEqual(result.data.values, [['fixture']]);
  assert.equal(request.url.searchParams.get('key'), 'fixture-api-key');
  assert.equal(request.method, 'GET');
});
