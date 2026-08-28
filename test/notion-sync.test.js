'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-only-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.NOTION_API_KEY = 'test-notion-key';
process.env.NOTION_DATABASE_ID = 'test-notion-database';

const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../src/database');
const notionRouter = require('../src/routes/notion');
const { syncNotionProfiles, syncExecutionState } = notionRouter;

const originalFetch = global.fetch;
const app = express();
app.use(express.json());
app.use('/api/notion', notionRouter);

let server;
let baseUrl;
const token = jwt.sign(
  { id: 1, login_id: 'admin', name: '管理者', role: 'admin' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  global.fetch = originalFetch;
  await new Promise(resolve => server.close(resolve));
  db.close();
});

beforeEach(() => {
  assert.equal(syncExecutionState.running, false);
  db.exec('DELETE FROM notion_profiles');
});

function notionText(value) {
  return {
    type: 'rich_text',
    rich_text: value ? [{ plain_text: value }] : [],
  };
}

function notionPage({ id, studentNumber = '', monthlyIncome = null, savings = null }) {
  return {
    id,
    properties: {
      '学籍番号': notionText(studentNumber),
      '月収（全桁記入）': { type: 'number', number: monthlyIncome },
      '貯蓄（全桁記入）': { type: 'number', number: savings },
    },
  };
}

function mockNotionPages(pages) {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ results: pages, has_more: false }),
  });
}

test('notion_profilesは学籍番号なし・NotionページIDありのレコードを保存できる', () => {
  const columns = db.prepare('PRAGMA table_info(notion_profiles)').all();
  const studentNumber = columns.find(column => column.name === 'student_number');
  assert.equal(studentNumber.notnull, 0);

  const notionPageIdIsUnique = db.prepare("PRAGMA index_list('notion_profiles')").all()
    .filter(index => index.unique)
    .some(index => db.prepare(`PRAGMA index_info('${index.name}')`).all()
      .some(column => column.name === 'notion_page_id'));
  assert.equal(notionPageIdIsUnique, true);
});

test('学籍番号がないNotionページもページIDと金融情報を同期する', async () => {
  const pageId = '12345678-90ab-cdef-1234-567890abcdef';
  mockNotionPages([
    notionPage({ id: pageId, monthlyIncome: 300000, savings: 1000000 }),
  ]);

  const result = await syncNotionProfiles();
  const saved = db.prepare('SELECT * FROM notion_profiles WHERE notion_page_id = ?').get(pageId);

  assert.deepEqual(result, { total: 1, saved: 1 });
  assert.equal(saved.student_number, null);
  assert.equal(saved.monthly_income, '300000');
  assert.equal(saved.savings, '1000000');
});

test('同じNotionページを再同期しても重複せず金融情報を更新する', async () => {
  const pageId = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
  mockNotionPages([notionPage({ id: pageId, monthlyIncome: 200000 })]);
  await syncNotionProfiles();

  mockNotionPages([notionPage({ id: pageId, monthlyIncome: 250000 })]);
  await syncNotionProfiles();

  const rows = db.prepare('SELECT * FROM notion_profiles WHERE notion_page_id = ?').all(pageId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].monthly_income, '250000');
});

test('後から学籍番号が設定されたNotionページは同じレコードを更新する', async () => {
  const pageId = '11111111-2222-3333-4444-555555555555';
  mockNotionPages([notionPage({ id: pageId, monthlyIncome: 180000 })]);
  await syncNotionProfiles();

  mockNotionPages([notionPage({
    id: pageId,
    studentNumber: 'N-100',
    monthlyIncome: 180000,
  })]);
  await syncNotionProfiles();

  const rows = db.prepare('SELECT * FROM notion_profiles').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].student_number, 'N-100');
});

test('プロファイル一覧APIは巨大なraw_jsonをレスポンスに含めない', async () => {
  db.prepare(`
    INSERT INTO notion_profiles (
      student_number, notion_page_id, monthly_income, raw_json
    ) VALUES (?, ?, ?, ?)
  `).run(
    null,
    '99999999-8888-7777-6666-555555555555',
    '280000',
    JSON.stringify({ payload: 'x'.repeat(1024 * 1024) })
  );

  const response = await originalFetch(`${baseUrl}/api/notion/profiles`, { headers });
  const profiles = await response.json();

  assert.equal(response.status, 200);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].monthly_income, '280000');
  assert.equal(Object.hasOwn(profiles[0], 'raw_json'), false);
});

test('手動同期APIは完了を待たず202を返し、状態APIで完了を確認できる', async () => {
  let releaseNotionRequest;
  global.fetch = () => new Promise(resolve => {
    releaseNotionRequest = () => resolve({
      ok: true,
      json: async () => ({
        results: [notionPage({
          id: '12121212-3434-5656-7878-909090909090',
          monthlyIncome: 310000,
        })],
        has_more: false,
      }),
    });
  });

  const response = await originalFetch(`${baseUrl}/api/notion/sync`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const started = await response.json();

  assert.equal(response.status, 202);
  assert.equal(started.started, true);
  assert.equal(started.running, true);

  const runningResponse = await originalFetch(`${baseUrl}/api/notion/sync-status`, { headers });
  const runningStatus = await runningResponse.json();
  assert.equal(runningStatus.running, true);

  for (let attempt = 0; attempt < 20 && !releaseNotionRequest; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(typeof releaseNotionRequest, 'function');
  releaseNotionRequest();

  let completedStatus;
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    const statusResponse = await originalFetch(`${baseUrl}/api/notion/sync-status`, { headers });
    completedStatus = await statusResponse.json();
    if (!completedStatus.running) break;
  }

  assert.equal(completedStatus.running, false);
  assert.equal(completedStatus.last_error, null);
  assert.equal(completedStatus.last_saved, 1);
  assert.equal(completedStatus.total, 1);
});
