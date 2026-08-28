'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-only-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.NOTION_API_KEY = 'test-notion-key';
process.env.NOTION_DATABASE_ID = 'test-notion-database';

const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/database');
const { syncNotionProfiles } = require('../src/routes/notion');

const originalFetch = global.fetch;

after(() => {
  global.fetch = originalFetch;
  db.close();
});

beforeEach(() => {
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
