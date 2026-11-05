'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = require('node:crypto').randomBytes(48).toString('hex');
process.env.NODE_ENV = 'test';

const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { strFromU8, unzipSync } = require('fflate');
const jwt = require('jsonwebtoken');

const db = require('../src/database');
const sukuukunRouter = require('../src/routes/sukuukun');

const app = express();
app.use(express.json());
app.use('/api/sukuukun', sukuukunRouter);

let server;
let baseUrl;
const token = jwt.sign(
  { id: 1, login_id: 'admin', name: '管理者', role: 'admin' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
const headers = { Authorization: `Bearer ${token}` };

before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
});

beforeEach(() => {
  db.exec('DELETE FROM sukuukun_sources;');
});

function insertSources(longContent) {
  db.prepare(`
    INSERT INTO sukuukun_sources (
      title, content, source_type, file_name, char_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    '=先に登録した資料', '通常の参照ソース本文', 'text', null, 10,
    '2026-10-01 10:00:00', '2026-10-02 11:00:00'
  );
  db.prepare(`
    INSERT INTO sukuukun_sources (
      title, content, source_type, file_name, char_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    '長文PDF資料', longContent, 'pdf', 'sales-guide.pdf', longContent.length,
    '2026-10-03 10:00:00', '2026-10-04 11:00:00'
  );
}

function makeLongContent() {
  return '長'.repeat(29999) + '😀' + '終'.repeat(5);
}

test('現在の参照ソースを登録順・全文入りのテキストで出力する', async () => {
  const longContent = makeLongContent();
  insertSources(longContent);

  const response = await fetch(`${baseUrl}/api/sukuukun/sources/export?format=txt`, { headers });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder('utf-8').decode(bytes);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain; charset=utf-8/);
  assert.equal(response.headers.get('x-export-record-count'), '2');
  assert.match(response.headers.get('content-disposition'), /sukuukun_sources_\d{8}\.txt/);
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.ok(text.indexOf('=先に登録した資料') < text.indexOf('長文PDF資料'));
  assert.match(text, /種別: PDF/);
  assert.match(text, /元ファイル名: sales-guide\.pdf/);
  assert.ok(text.includes(longContent));
});

test('現在の参照ソースをExcelで出力し、セル上限を超える本文は欠落なく分割する', async () => {
  const longContent = makeLongContent();
  insertSources(longContent);

  const response = await fetch(`${baseUrl}/api/sukuukun/sources/export?format=xlsx`, { headers });
  const bytes = new Uint8Array(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  assert.equal(response.headers.get('x-export-record-count'), '2');
  assert.match(response.headers.get('content-disposition'), /sukuukun_sources_\d{8}\.xlsx/);
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4B]);

  const files = unzipSync(bytes);
  const workbookXml = strFromU8(files['xl/workbook.xml']);
  const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
  const sharedStringsXml = strFromU8(files['xl/sharedStrings.xml']);

  assert.match(workbookXml, /name="参照ソース"/);
  assert.match(sharedStringsXml, /<t>内容パート<\/t>/);
  assert.match(sharedStringsXml, /<t>1\/2<\/t>/);
  assert.match(sharedStringsXml, /<t>2\/2<\/t>/);
  assert.ok(sharedStringsXml.includes('長'.repeat(29999)));
  assert.ok(sharedStringsXml.includes('😀' + '終'.repeat(5)));
  assert.doesNotMatch(sheetXml, /<f(?:>| )/);
});

test('参照ソース出力は未対応の形式を拒否する', async () => {
  const response = await fetch(`${baseUrl}/api/sukuukun/sources/export?format=csv`, { headers });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: '出力形式は xlsx または txt を指定してください',
  });
});
