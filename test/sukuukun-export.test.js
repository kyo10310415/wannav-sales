'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-only-jwt-secret';
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
  db.exec('DELETE FROM sukuukun_evaluations; DELETE FROM sukuukun_speech_analyses;');
});

function getSheetStrings(files, sheetPath) {
  const sharedStringsXml = strFromU8(files['xl/sharedStrings.xml']);
  const sharedStrings = [...sharedStringsXml.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)]
    .map(match => match[1]);
  const sheetXml = strFromU8(files[sheetPath]);
  return [...sheetXml.matchAll(/<c [^>]*t="s"[^>]*><v>(\d+)<\/v><\/c>/g)]
    .map(match => sharedStrings[Number(match[1])]);
}

test('指定した日本時間の日付に含まれる採点・発話比率履歴を別シートでExcel出力する', async () => {
  db.prepare(`
    INSERT INTO sukuukun_evaluations (
      applicant_name, applicant_key, evaluator_name, interviewer_name,
      interview_result, transcript_length, total_score, result_json,
      source_snapshot, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '=採点対象', 'eval@example.com', '評価者A', '営業A',
    '契約', 1200, 88,
    '{"total_score":88,"scores":{"rapport":{"score":18,"good":"会話が自然","improve":"質問を増やす"}},"summary":"良い面接でした","highlights":["印象的な発言"],"template_output":"提出用レポート"}',
    '[{"id":1,"title":"営業台本"},{"id":2,"title":"面接ガイド"}]',
    '2026-09-01 15:30:00'
  );

  db.prepare(`
    INSERT INTO sukuukun_speech_analyses (
      interviewer_name, applicant_name, applicant_key, analyzed_at,
      sales_ratio, applicant_ratio, advice, actions, transcript_length
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    '営業B', '発話対象', 'speech@example.com', '2026-09-02T03:00:00.000Z',
    60, 40, '改善案', '["質問を増やす","相手の回答を待つ"]', 1500
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

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  assert.equal(response.headers.get('x-export-record-count'), '2');
  assert.equal(response.headers.get('x-export-evaluation-count'), '1');
  assert.equal(response.headers.get('x-export-speech-count'), '1');
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4B]);

  const files = unzipSync(bytes);
  const workbookXml = strFromU8(files['xl/workbook.xml']);
  const evaluationSheetXml = strFromU8(files['xl/worksheets/sheet1.xml']);
  const evaluationStrings = getSheetStrings(files, 'xl/worksheets/sheet1.xml');
  const speechStrings = getSheetStrings(files, 'xl/worksheets/sheet2.xml');

  assert.match(workbookXml, /name="すくう君"/);
  assert.match(workbookXml, /name="発話比率"/);
  assert.ok(evaluationStrings.includes('=採点対象'));
  assert.ok(evaluationStrings.includes('2026-09-02 00:30:00'));
  assert.ok(!evaluationStrings.includes('期間外'));
  assert.ok(evaluationStrings.some(value => value.includes('総合スコア: 88/100')));
  assert.ok(evaluationStrings.some(value => value.includes('ラポール構築: 18/20')));
  assert.ok(evaluationStrings.some(value => value.includes('良かった点: 会話が自然')));
  assert.ok(evaluationStrings.some(value => value.includes('1. 営業台本（ID: 1）')));
  assert.ok(!evaluationStrings.some(value => value.includes('"total_score"')));
  assert.ok(speechStrings.includes('発話対象'));
  assert.ok(!speechStrings.includes('=採点対象'));
  assert.ok(speechStrings.some(value => value.includes('1. 質問を増やす\n2. 相手の回答を待つ')));
  assert.ok(!speechStrings.some(value => value.includes('["質問を増やす"')));
  assert.doesNotMatch(evaluationSheetXml, /<f(?:>| )/);
});

test('Excel出力は不正な期間を拒否する', async () => {
  const response = await fetch(
    `${baseUrl}/api/sukuukun/export?date_from=2026-09-03&date_to=2026-09-02`,
    { headers }
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: '開始日と終了日を正しい順序で指定してください',
  });
});
