'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-only-jwt-secret';
process.env.NODE_ENV = 'test';

const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
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
  db.exec('DELETE FROM sukuukun_evaluations; DELETE FROM sukuukun_speech_analyses;');
});

test('指定した日本時間の日付に含まれる採点・発話比率履歴を1つのCSVに出力する', async () => {
  db.prepare(`
    INSERT INTO sukuukun_evaluations (
      applicant_name, applicant_key, evaluator_name, interviewer_name,
      interview_result, transcript_length, total_score, result_json,
      source_snapshot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '=採点対象', 'eval@example.com', '評価者A', '営業A',
    '契約', 1200, 88, '{"total_score":88}', '[]', '2026-09-01 15:30:00'
  );

  db.prepare(`
    INSERT INTO sukuukun_speech_analyses (
      interviewer_name, applicant_name, applicant_key, analyzed_at,
      sales_ratio, applicant_ratio, advice, actions, transcript_length
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '営業B', '発話対象', 'speech@example.com', '2026-09-02T03:00:00.000Z',
    60, 40, '改善案', '["質問を増やす"]', 1500
  );

  db.prepare(`
    INSERT INTO sukuukun_evaluations (applicant_name, created_at)
    VALUES ('期間外', '2026-09-02 15:00:00')
  `).run();

  const response = await fetch(
    `${baseUrl}/api/sukuukun/export?date_from=2026-09-02&date_to=2026-09-02`,
    { headers }
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const csv = new TextDecoder().decode(bytes);

  assert.equal(response.status, 200, csv);
  assert.match(response.headers.get('content-type'), /^text\/csv/);
  assert.equal(response.headers.get('x-export-record-count'), '2');
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.match(csv, /すくう君採点/);
  assert.match(csv, /発話比率/);
  assert.match(csv, /2026-09-02 00:30:00/);
  assert.match(csv, /"'=採点対象"/);
  assert.doesNotMatch(csv, /期間外/);
});

test('CSV出力は不正な期間を拒否する', async () => {
  const response = await fetch(
    `${baseUrl}/api/sukuukun/export?date_from=2026-09-03&date_to=2026-09-02`,
    { headers }
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: '開始日と終了日を正しい順序で指定してください',
  });
});
