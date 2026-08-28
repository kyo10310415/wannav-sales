'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

test('旧notion_profilesを既存データを保ったままページIDキーへ移行する', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wannav-notion-migration-'));
  const dbPath = path.join(tempDir, 'legacy.db');
  let migrated;

  try {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE notion_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_number TEXT UNIQUE NOT NULL,
        notion_page_id TEXT,
        gender TEXT,
        birth_date TEXT,
        final_education TEXT,
        current_job TEXT,
        job_type TEXT,
        monthly_income TEXT,
        disposable_income TEXT,
        savings TEXT,
        debt TEXT,
        has_card TEXT,
        work_history TEXT,
        part_time_history TEXT,
        prefecture TEXT,
        cohabitants TEXT,
        has_partner TEXT,
        partner_understanding TEXT,
        sales_classification TEXT,
        has_streaming_experience TEXT,
        streaming_history TEXT,
        streaming_equipment TEXT,
        motivation TEXT,
        company_reason TEXT,
        contribution TEXT,
        vtuber_effort TEXT,
        other_auditions TEXT,
        desired_streaming TEXT,
        vtuber_passion TEXT,
        medical_history TEXT,
        raw_json TEXT,
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT,
        contract_plan TEXT
      );
      INSERT INTO notion_profiles (
        student_number, notion_page_id, monthly_income, status, contract_plan
      ) VALUES (
        'N-OLD', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '350000', '契約', 'プランA'
      );
    `);
    legacy.close();

    const databaseModule = path.join(__dirname, '..', 'src', 'database.js');
    const child = spawnSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(databaseModule)}).close()`],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          DB_PATH: dbPath,
          NODE_ENV: 'test',
          JWT_SECRET: 'test-only-jwt-secret',
        },
        encoding: 'utf8',
      }
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);

    migrated = new Database(dbPath);
    const studentNumber = migrated.prepare('PRAGMA table_info(notion_profiles)').all()
      .find(column => column.name === 'student_number');
    assert.equal(studentNumber.notnull, 0);

    const oldRow = migrated.prepare(
      'SELECT * FROM notion_profiles WHERE notion_page_id = ?'
    ).get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(oldRow.student_number, 'N-OLD');
    assert.equal(oldRow.monthly_income, '350000');
    assert.equal(oldRow.status, '契約');
    assert.equal(oldRow.contract_plan, 'プランA');

    migrated.prepare(
      'INSERT INTO notion_profiles (student_number, notion_page_id) VALUES (NULL, ?)'
    ).run('11111111-2222-3333-4444-555555555555');
    assert.throws(
      () => migrated.prepare(
        'INSERT INTO notion_profiles (student_number, notion_page_id) VALUES (NULL, ?)'
      ).run('11111111-2222-3333-4444-555555555555'),
      /UNIQUE constraint failed/
    );
  } finally {
    if (migrated?.open) migrated.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
