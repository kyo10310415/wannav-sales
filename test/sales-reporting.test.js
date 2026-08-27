'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-only-jwt-secret';
process.env.NODE_ENV = 'test';

const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../src/database');
const statsRouter = require('../src/routes/stats');
const salesReportsRouter = require('../src/routes/salesReports');
const interviewDatesRouter = require('../src/routes/interviewDates');
const {
  upsertCalendarInterviewDate,
  syncCalendarEvents,
} = require('../src/services/calendarInterviewSync');

const app = express();
app.use(express.json());
app.use('/api/stats', statsRouter);
app.use('/api/sales-reports', salesReportsRouter);
app.use('/api/interview-dates', interviewDatesRouter);

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
  await new Promise(resolve => server.close(resolve));
  db.close();
});

beforeEach(() => {
  db.exec('DELETE FROM sales_reports; DELETE FROM applicant_interview_dates;');
});

function addReport({
  name = '山田太郎',
  email = 'taro@example.com',
  date,
  result,
  parentId = null,
  interviewer = '営業A',
} = {}) {
  const nameEmail = `${name.replace(/[\s\u3000]/g, '').toLowerCase()}::${email.toLowerCase()}`;
  const inserted = db.prepare(`
    INSERT INTO sales_reports (
      interviewer_id, interviewer_name, applicant_full_name, applicant_email,
      interview_date, result, applicant_name_email, parent_id, sheet_type
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'as')
  `).run(interviewer, name, email, date, result, nameEmail, parentId);
  return Number(inserted.lastInsertRowid);
}

async function summary(extra = {}) {
  const params = new URLSearchParams({
    period: 'custom',
    date_from: '2026-01-01',
    date_to: '2026-12-31',
    applicant_count: '0',
    ...extra,
  });
  const response = await fetch(`${baseUrl}/api/stats/summary?${params}`, { headers });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

test('ケース1: 1人に飛び報告1件は飛び1件', async () => {
  addReport({ date: '2026-06-01', result: '飛び' });
  const data = await summary();
  assert.equal(data.total_noshow, 1);
  assert.equal(data.total_interviews, 0);
});

test('ケース2: 同じ面接の飛び2件は集計上1件', async () => {
  addReport({ date: '2026-06-01', result: '飛び' });
  addReport({ date: '2026-06-01', result: '飛び' });
  const data = await summary();
  assert.equal(data.total_noshow, 1);
});

test('ケース3: 別予約として別日に2回飛んだ場合は2件', async () => {
  addReport({ date: '2026-06-01', result: '飛び' });
  addReport({ date: '2026-07-01', result: '飛び' });
  const data = await summary();
  assert.equal(data.total_noshow, 2);
});

test('同じ営業報告チェーン内で別日に飛びを追記しても1件', async () => {
  const rootId = addReport({ date: '2026-08-27', result: '飛び' });
  addReport({ date: '2026-08-29', result: '飛び', parentId: rootId });
  const data = await summary();
  assert.equal(data.total_noshow, 1);
});

test('ケース4: 飛びの後日に追記した契約は契約1・面接1・CVR100%', async () => {
  const rootId = addReport({ date: '2026-06-01', result: '飛び' });
  addReport({ date: '2026-07-15', result: '契約', parentId: rootId });
  const data = await summary();
  assert.equal(data.total_noshow, 1);
  assert.equal(data.total_contracts, 1);
  assert.equal(data.total_interviews, 1);
  assert.equal(data.cvr_interview, '100.0');
});

test('ケース5: 契約と後日のクーリングオフは両方を1件ずつ保持', async () => {
  const rootId = addReport({ date: '2026-07-15', result: '契約' });
  addReport({ date: '2026-07-20', result: 'クーリングオフ', parentId: rootId });
  const data = await summary();
  assert.equal(data.total_contracts, 1);
  assert.equal(data.total_coolingoff, 1);
});

test('ケース6: 面接日空欄時は営業報告の面接日を自動補完', async () => {
  const response = await fetch(`${baseUrl}/api/sales-reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      interviewer_id: 1,
      interviewer_name: '営業A',
      applicant_full_name: '佐藤花子',
      applicant_email: 'hanako@example.com',
      interview_date: '2026-07-15',
      result: '契約',
    }),
  });
  assert.equal(response.status, 201, await response.text());

  const row = db.prepare(`
    SELECT interview_date, source FROM applicant_interview_dates WHERE applicant_key = ?
  `).get('hanako@example.com');
  assert.deepEqual(row, { interview_date: '2026-07-15', source: 'report' });
});

test('ケース7: 手動変更した面接日はCalendar同期で上書きしない', () => {
  db.prepare(`
    INSERT INTO applicant_interview_dates (applicant_key, interview_date, source)
    VALUES ('manual@example.com', '2026-07-15', 'manual')
  `).run();

  const result = upsertCalendarInterviewDate(
    db,
    'manual@example.com',
    '2026-06-10'
  );
  const row = db.prepare(`
    SELECT interview_date, source FROM applicant_interview_dates WHERE applicant_key = ?
  `).get('manual@example.com');

  assert.equal(result.protected, true);
  assert.deepEqual(row, { interview_date: '2026-07-15', source: 'manual' });
});

test('同一応募者のCalendar日付が複数ある場合は未来日で上書きしない', () => {
  db.prepare(`
    INSERT INTO applicant_interview_dates (applicant_key, interview_date, source)
    VALUES ('calendar@example.com', '2026-06-10', 'calendar')
  `).run();

  const synced = syncCalendarEvents(db, [
    { guestEmail: 'calendar@example.com', guestName: '日付花子', startDt: '2026-06-10T10:00:00+09:00' },
    { guestEmail: 'calendar@example.com', guestName: '日付花子', startDt: '2026-10-01T10:00:00+09:00' },
  ], [
    { email: 'calendar@example.com', full_name: '日付花子' },
  ]);

  const row = db.prepare(`
    SELECT interview_date, source FROM applicant_interview_dates WHERE applicant_key = ?
  `).get('calendar@example.com');
  assert.deepEqual(row, { interview_date: '2026-06-10', source: 'calendar' });
  assert.equal(synced.results.every(result => result.reason === 'multiple_event_dates'), true);
});

test('ケース8: AIレコメンは予約+1・面接実施+0・AI案内+1', async () => {
  addReport({ date: '2026-08-01', result: 'AIレコメン' });
  const data = await summary();
  assert.equal(data.total_ai_recommend, 1);
  assert.equal(data.sales_report_reservations, 1);
  assert.equal(data.adjusted_reservation_count, 1);
  assert.equal(data.total_interviews, 0);
});

test('任意期間外の営業報告は集計しない', async () => {
  addReport({ date: '2026-07-04', result: '契約' });
  addReport({ date: '2026-07-05', result: '契約', email: 'inside1@example.com' });
  addReport({ date: '2026-07-20', result: '契約', email: 'inside2@example.com' });
  addReport({ date: '2026-07-21', result: '契約', email: 'outside@example.com' });
  const data = await summary({ date_from: '2026-07-05', date_to: '2026-07-20' });
  assert.equal(data.total_contracts, 2);
});

test('既存の手動面接日は営業報告保存でも上書きしない', async () => {
  db.prepare(`
    INSERT INTO applicant_interview_dates (applicant_key, interview_date, source)
    VALUES ('preserve@example.com', '2026-06-10', 'manual')
  `).run();

  const response = await fetch(`${baseUrl}/api/sales-reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      interviewer_id: 1,
      interviewer_name: '営業A',
      applicant_full_name: '保存花子',
      applicant_email: 'preserve@example.com',
      interview_date: '2026-07-15',
      result: '契約',
    }),
  });
  assert.equal(response.status, 201, await response.text());

  const row = db.prepare(`
    SELECT interview_date, source FROM applicant_interview_dates WHERE applicant_key = ?
  `).get('preserve@example.com');
  assert.deepEqual(row, { interview_date: '2026-06-10', source: 'manual' });
});

test('過去の営業報告を編集すると集計へ反映される', async () => {
  const reportId = addReport({ date: '2026-07-15', result: '契約' });
  const response = await fetch(`${baseUrl}/api/sales-reports/${reportId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ result: '飛び' }),
  });
  assert.equal(response.status, 200, await response.text());

  const data = await summary();
  assert.equal(data.total_contracts, 0);
  assert.equal(data.total_noshow, 1);
  assert.equal(data.total_interviews, 0);
});

test('初回営業報告の削除時は追記履歴を昇格して保持する', async () => {
  const rootId = addReport({ date: '2026-07-15', result: '契約' });
  const childId = addReport({ date: '2026-07-20', result: 'クーリングオフ', parentId: rootId });
  const response = await fetch(`${baseUrl}/api/sales-reports/${rootId}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(response.status, 200, await response.text());

  const promoted = db.prepare('SELECT parent_id, result FROM sales_reports WHERE id = ?').get(childId);
  assert.deepEqual(promoted, { parent_id: null, result: 'クーリングオフ' });
  const data = await summary();
  assert.equal(data.total_contracts, 0);
  assert.equal(data.total_coolingoff, 1);
});

test('担当者別比較は担当者ごとの面接・契約・飛びを返す', async () => {
  addReport({ date: '2026-07-15', result: '契約', interviewer: '営業A' });
  addReport({ date: '2026-07-16', result: '飛び', interviewer: '営業B', email: 'b@example.com' });
  const params = new URLSearchParams({
    period: 'custom',
    date_from: '2026-07-01',
    date_to: '2026-07-31',
  });
  const response = await fetch(`${baseUrl}/api/stats/by-interviewer?${params}`, { headers });
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const data = JSON.parse(responseText);

  assert.deepEqual(data.map(row => ({
    name: row.interviewer_name,
    interviews: row.total_interviews,
    contracts: row.total_contracts,
    noshow: row.total_noshow,
  })), [
    { name: '営業A', interviews: 1, contracts: 1, noshow: 0 },
    { name: '営業B', interviews: 0, contracts: 0, noshow: 1 },
  ]);
});

test('担当者別比較でも同じ営業報告チェーンの複数飛びは1件', async () => {
  const rootId = addReport({ date: '2026-08-27', result: '飛び', interviewer: '営業B' });
  addReport({ date: '2026-08-29', result: '飛び', interviewer: '営業B', parentId: rootId });
  const params = new URLSearchParams({
    period: 'custom',
    date_from: '2026-08-01',
    date_to: '2026-08-31',
  });
  const response = await fetch(`${baseUrl}/api/stats/by-interviewer?${params}`, { headers });
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const data = JSON.parse(responseText);

  assert.equal(data.length, 1);
  assert.equal(data[0].interviewer_name, '営業B');
  assert.equal(data[0].total_noshow, 1);
});
