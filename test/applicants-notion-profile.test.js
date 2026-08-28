'use strict';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const applicantsSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'pages', 'applicants.js'),
  'utf8'
);
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  `${applicantsSource}\n;globalThis.__ApplicantsPage = ApplicantsPage;`,
  sandbox
);
const ApplicantsPage = sandbox.__ApplicantsPage;

beforeEach(() => {
  ApplicantsPage.notionProfileMap = {};
  ApplicantsPage.notionProfileByPageId = {};
});

test('学籍番号がない報告は保存済みNotion URLのページIDでプロファイルを取得する', () => {
  const profile = {
    student_number: 'N-001',
    notion_page_id: '12345678-90ab-cdef-1234-567890abcdef',
    monthly_income: '30万円',
  };
  ApplicantsPage.notionProfileByPageId[
    ApplicantsPage._normalizeNotionPageId(profile.notion_page_id)
  ] = profile;

  const reports = [{
    student_number: '',
    notion_url: 'https://www.notion.so/workspace/Applicant-1234567890abcdef1234567890abcdef?pvs=4',
  }];

  assert.equal(ApplicantsPage._notionProfileForReports(reports), profile);
});

test('ハイフン付きページIDを含むNotion URLでも照合できる', () => {
  const profile = {
    student_number: 'N-002',
    notion_page_id: 'abcdefab-cdef-abcd-efab-cdefabcdefab',
  };
  ApplicantsPage.notionProfileByPageId[
    ApplicantsPage._normalizeNotionPageId(profile.notion_page_id)
  ] = profile;

  const reports = [{
    notion_url: 'https://www.notion.so/abcdefab-cdef-abcd-efab-cdefabcdefab',
  }];

  assert.equal(ApplicantsPage._notionProfileForReports(reports), profile);
});

test('学籍番号とNotion URLが両方一致する場合は学籍番号を優先する', () => {
  const studentProfile = { student_number: 'N-003', status: '学籍番号一致' };
  const urlProfile = { student_number: 'N-999', status: 'URL一致' };
  ApplicantsPage.notionProfileMap['N-003'] = studentProfile;
  ApplicantsPage.notionProfileByPageId['11111111111111111111111111111111'] = urlProfile;

  const reports = [{
    student_number: 'N-003',
    notion_url: 'https://www.notion.so/11111111111111111111111111111111',
  }];

  assert.equal(ApplicantsPage._notionProfileForReports(reports), studentProfile);
});

test('最新報告が空でも過去報告の学籍番号を利用する', () => {
  const profile = { student_number: 'N-004' };
  ApplicantsPage.notionProfileMap['N-004'] = profile;

  const reports = [
    { id: 2, student_number: '', notion_url: '' },
    { id: 1, student_number: ' N-004 ', notion_url: '' },
  ];

  assert.equal(ApplicantsPage._firstStudentNumber(reports), 'N-004');
  assert.equal(ApplicantsPage._notionProfileForReports(reports), profile);
});

test('照合できる学籍番号もNotion URLもない場合はnullを返す', () => {
  assert.equal(
    ApplicantsPage._notionProfileForReports([{ student_number: '', notion_url: 'https://example.com/notion' }]),
    null
  );
});
