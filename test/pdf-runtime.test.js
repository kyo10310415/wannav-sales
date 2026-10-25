'use strict';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = require('node:crypto').randomBytes(48).toString('hex');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/database');
const app = express();
app.use('/api/sukuukun', require('../src/routes/sukuukun'));
let server, origin;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Self-contained synthetic PDF: no external files, fonts, URLs or personal data.
function pdf(texts) {
  const objects = [null, null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const text of texts) {
    const page = objects.length + 1;
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`);
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(document);
}
async function upload(buffer, authenticated = true) {
  const form = new FormData();
  form.append('title', 'Synthetic parser fixture');
  form.append('pdf', new Blob([buffer], { type: 'application/pdf' }), 'fixture.pdf');
  return fetch(origin + '/api/sukuukun/sources/pdf', {
    method: 'POST', headers: authenticated ? { Authorization: 'Bearer ' + token } : {}, body: form,
  });
}
const count = () => db.prepare('SELECT COUNT(*) AS count FROM sukuukun_sources').get().count;

test('real pdf-parse v2 extracts two pages and saves the expected content', async () => {
  const response = await upload(pdf(['Synthetic first page content.', 'Synthetic second page content.']));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pages, 2);
  assert.match(result.content, /Synthetic first page content/);
  assert.match(result.content, /Synthetic second page content/);
  assert.ok(!result.content.includes('-- 1 of'));
  assert.equal(result.char_count, result.content.length);
  assert.equal(db.prepare('SELECT content FROM sukuukun_sources WHERE id = ?').get(result.id).content, result.content);
});
test('real blank PDF returns 422 without saving page separator text', async () => {
  const before = count();
  assert.equal((await upload(pdf(['']))).status, 422);
  assert.equal(count(), before);
});
test('corrupt PDF fails without saving or exposing parser internals', async () => {
  const before = count();
  const response = await upload(Buffer.from('%PDF-1.4\nsynthetic-invalid-document'));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'PDFを解析できませんでした。ファイルを確認してください。' });
  assert.equal(count(), before);
});
test('anonymous real PDF upload is denied without saving', async () => {
  const before = count();
  assert.equal((await upload(pdf(['Synthetic denied content.']), false)).status, 401);
  assert.equal(count(), before);
});
