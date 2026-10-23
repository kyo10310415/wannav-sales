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
test('all One Loop routes stop before upstream for every authenticated role', async () => {
  sent.length = 0;
  for (const role of ['admin', 'staff']) for (const path of ['/applicants', '/graphql', '/unknown']) {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(origin + '/oneloop' + path, { method, headers: headers(role) });
      assert.equal(response.status, 410);
    }
  }
  assert.equal(sent.length, 0);
});