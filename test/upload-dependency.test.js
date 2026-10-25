'use strict';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = require('node:crypto').randomBytes(48).toString('hex');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/database');
let parsed = 0;
// Isolate multipart compatibility from the unchanged PDF parser implementation.
const parserId = require.resolve('pdf-parse');
require.cache[parserId] = { id: parserId, filename: parserId, loaded: true, exports: async buffer => {
  parsed++; assert.ok(buffer.length > 0); return { text: 'Synthetic upload fixture content', numpages: 1 };
} };
const app = express();
app.use('/api/sukuukun', require('../src/routes/sukuukun'));
app.use((error, req, res, next) => res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'invalid upload' }));
let server, origin;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); origin = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r => server.close(r)); db.close(); });
function upload(type = 'application/pdf', size = 20) {
  const form = new FormData(); form.append('title', 'Synthetic fixture');
  form.append('pdf', new Blob([new Uint8Array(size)], { type }), 'fixture.pdf'); return form;
}
const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
function request(body, authenticated = true) { return fetch(origin + '/api/sukuukun/sources/pdf', { method: 'POST', headers: authenticated ? { Authorization: 'Bearer ' + token } : {}, body }); }
test('anonymous upload is denied before parsing or saving', async () => {
  const before = parsed; assert.equal((await request(upload(), false)).status, 401); assert.equal(parsed, before);
});
test('authenticated multipart PDF reaches parser and in-memory storage', async () => {
  const response = await request(upload()); assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.content, 'Synthetic upload fixture content'); assert.equal(value.pages, 1);
});
test('non-PDF and oversized uploads are rejected without invoking parser', async () => {
  const before = parsed;
  assert.equal((await request(upload('text/plain'))).status, 400);
  assert.equal((await request(upload('application/pdf', 20 * 1024 * 1024 + 1))).status, 413);
  assert.equal(parsed, before);
});
