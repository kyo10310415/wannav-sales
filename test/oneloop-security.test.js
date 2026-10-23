const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const express = require('express');
const https = require('https');
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.ONE_LOOP_TOKEN = 'test-only-one-loop-credential';
const { generateToken } = require('../src/middleware/auth');
const sent = [];
const originalRequest = https.request;
https.request = (_options, callback) => {
  const request = new EventEmitter();
  let body;
  request.write = data => { body = JSON.parse(data); };
  request.end = () => {
    sent.push(body);
    const response = new EventEmitter();
    response.statusCode = 200;
    callback(response);
    queueMicrotask(() => {
      response.emit('data', Buffer.from(JSON.stringify({ data: { applicants: {
        pageInfo: { hasNextPage: false, endCursor: null }, edges: [{ node: { id: 'fixture', source: 'test' } }]
      } } })));
      response.emit('end');
    });
  };
  return request;
};
const app = express();
app.use(express.json());
app.use('/oneloop', require('../src/routes/oneloop'));
let server, origin;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  https.request = originalRequest;
  await new Promise(resolve => server.close(resolve));
});
const headers = role => ({ Authorization: `Bearer ${generateToken({ id: 1, role })}`, 'Content-Type': 'application/json' });

test('anonymous requests cannot read applicants or use the retired proxy', async () => {
  sent.length = 0;
  assert.equal((await fetch(origin + '/oneloop/applicants')).status, 401);
  assert.equal((await fetch(origin + '/oneloop/graphql', { method: 'POST' })).status, 401);
  assert.equal(sent.length, 0);
});
test('admin and normal users cannot forward arbitrary operations, variables or mutations', async () => {
  sent.length = 0;
  for (const role of ['admin', 'staff']) for (const query of ['mutation { deleteApplicant(id: "fixture") }', '{ __schema { types { name } } }', '{ applicants(first: 100000) { edges { node { id } } } }']) {
    const response = await fetch(origin + '/oneloop/graphql', { method: 'POST', headers: headers(role), body: JSON.stringify({ query, variables: { first: 100000 } }) });
    assert.equal(response.status, 410);
  }
  assert.equal(sent.length, 0);
});
test('existing applicant listing remains available with server-owned query and fixed page size', async () => {
  sent.length = 0;
  const response = await fetch(origin + '/oneloop/applicants?all=false&after=cursor&first=100000', { headers: headers('staff') });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 1);
  assert.deepEqual(sent[0].variables, { first: 20, after: 'cursor' });
  assert.match(sent[0].query, /query GetApplicants/);
  assert.doesNotMatch(sent[0].query, /mutation|__schema/);
});
test('invalid cursor/filter shapes cannot reach the upstream service', async () => {
  sent.length = 0;
  for (const suffix of ['?all=invalid', '?after[x]=y', '?source[x]=y', '?after='+'x'.repeat(2049), '?source='+'x'.repeat(257)]) {
    const response = await fetch(origin + '/oneloop/applicants'+suffix, { headers: headers('admin') });
    assert.equal(response.status, 400);
  }
  assert.equal(sent.length, 0);
});

test('missing integration credential returns 503 without contacting upstream', async () => {
  const old = process.env.ONE_LOOP_TOKEN;
  try {
    sent.length = 0;
    delete process.env.ONE_LOOP_TOKEN;
    const response = await fetch(origin + '/oneloop/applicants', { headers: headers('admin') });
    assert.equal(response.status, 503);
    assert.equal(sent.length, 0);
    assert.equal((await response.text()).includes('test-only'), false);
  } finally { process.env.ONE_LOOP_TOKEN = old; }
});

test('malformed integration credential fails closed before HTTPS request', async () => {
  const old = process.env.ONE_LOOP_TOKEN;
  try {
    sent.length = 0;
    process.env.ONE_LOOP_TOKEN = 'test-only\ninvalid';
    assert.equal((await fetch(origin + '/oneloop/applicants', { headers: headers('admin') })).status, 503);
    assert.equal(sent.length, 0);
  } finally { process.env.ONE_LOOP_TOKEN = old; }
});
