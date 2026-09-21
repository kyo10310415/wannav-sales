'use strict';

const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const modalSource = readFileSync(
  require.resolve('../public/js/pages/sales-report-modal.js'),
  'utf8'
);
const applicantsSource = readFileSync(
  require.resolve('../public/js/pages/applicants.js'),
  'utf8'
);

test('営業報告モーダルは担当者APIの完了前に表示される', async () => {
  let resolveUsers;
  const usersPromise = new Promise(resolve => { resolveUsers = resolve; });
  const interviewer = { focusCalled: false, focus() { this.focusCalled = true; } };
  const overlay = {};
  const context = vm.createContext({
    API: { users: { sales: () => usersPromise } },
    Utils: { escHtml: value => String(value ?? '') },
    document: {
      getElementById(id) {
        if (id === 'sr-modal-overlay') return overlay;
        if (id === 'sr-interviewer') return interviewer;
        return null;
      },
    },
    console,
  });
  vm.runInContext(modalSource, context);
  const modal = vm.runInContext('SalesReportModal', context);
  const calls = [];
  modal.renderModal = usersLoading => calls.push(['render', usersLoading]);
  modal._updateInterviewerOptions = error => calls.push(['update', error]);

  const opening = modal.open({ full_name: '応募者A' });

  assert.deepEqual(calls, [['render', true]]);
  assert.equal(interviewer.focusCalled, true);

  resolveUsers([{ id: 1, name: '営業A' }]);
  await opening;

  assert.deepEqual(modal.salesUsers, [{ id: 1, name: '営業A' }]);
  assert.deepEqual(calls, [['render', true], ['update', undefined]]);
});

test('既存報告の追記は一覧取得済みデータを使い、詳細APIを待たない', async () => {
  let getCalls = 0;
  let openedWith = null;
  const context = vm.createContext({
    API: {
      salesReports: {
        get: async () => {
          getCalls += 1;
          throw new Error('詳細APIを呼んではならない');
        },
      },
    },
    SalesReportModal: {
      open: async (...args) => { openedWith = args; },
    },
    Utils: { notify() {}, escHtml: value => String(value ?? '') },
    console,
  });
  vm.runInContext(applicantsSource, context);
  const page = vm.runInContext('ApplicantsPage', context);
  const applicant = { full_name: '応募者B' };
  const report = { id: 42, sheet_type: 'gh' };
  page._cache = { 'app-2': applicant };
  page.reports = [report];
  page.activeTab = 'as';

  await page.editReport('app-2', 42);

  assert.equal(getCalls, 0);
  assert.deepEqual(openedWith, [applicant, report, 'gh']);
});
