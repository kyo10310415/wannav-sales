const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Renderでは /var/data をマウントポイントとして使用
const DB_PATH = process.env.DB_PATH ||
  (process.env.NODE_ENV === 'production'
    ? '/var/data/wannav.db'
    : path.join(__dirname, '..', 'data', 'wannav.db'));

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'sales')),
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Sales reports table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interviewer_id INTEGER NOT NULL,
      interviewer_name TEXT NOT NULL,
      applicant_full_name TEXT NOT NULL,
      applicant_last_name TEXT,
      applicant_first_name TEXT,
      applicant_email TEXT,
      student_number TEXT,
      interview_time TEXT,
      result TEXT,
      contract_plan TEXT,
      payment_method TEXT,
      notion_url TEXT,
      lesson_start_date TEXT,
      character_rights TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (interviewer_id) REFERENCES users(id)
    )
  `);

  // 応募者ごとの面接日を独立管理するテーブル
  // applicant_key = email優先、なければfull_name
  db.exec(`
    CREATE TABLE IF NOT EXISTS applicant_interview_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_key TEXT UNIQUE NOT NULL,
      interview_date TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: users に各カラムを追加
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('calendar_id')) {
    db.exec('ALTER TABLE users ADD COLUMN calendar_id TEXT');
    console.log('Migration: users.calendar_id column added');
  }
  if (!userCols.includes('google_refresh_token')) {
    db.exec('ALTER TABLE users ADD COLUMN google_refresh_token TEXT');
    console.log('Migration: users.google_refresh_token column added');
  }
  if (!userCols.includes('google_email')) {
    db.exec('ALTER TABLE users ADD COLUMN google_email TEXT');
    console.log('Migration: users.google_email column added');
  }

  // すくう君ソース管理テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS sukuukun_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'text',
      file_name TEXT,
      char_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // すくう君採点履歴テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS sukuukun_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_name TEXT,
      evaluator_id INTEGER,
      evaluator_name TEXT,
      interviewer_id INTEGER,
      interviewer_name TEXT,
      interview_result TEXT,
      transcript_length INTEGER,
      total_score INTEGER,
      result_json TEXT,
      source_snapshot TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: sales_reports に新カラムを追加
  const srCols = db.prepare('PRAGMA table_info(sales_reports)').all().map(c => c.name);
  if (!srCols.includes('interview_date')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN interview_date TEXT');
    console.log('Migration: sales_reports.interview_date column added');
  }
  if (!srCols.includes('interview_content')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN interview_content TEXT');
    console.log('Migration: sales_reports.interview_content column added');
  }
  if (!srCols.includes('stay_count')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN stay_count INTEGER DEFAULT 0');
    console.log('Migration: sales_reports.stay_count column added');
  }
  if (!srCols.includes('no_count')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN no_count INTEGER DEFAULT 0');
    console.log('Migration: sales_reports.no_count column added');
  }
  if (!srCols.includes('join_reasons')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN join_reasons TEXT');
    console.log('Migration: sales_reports.join_reasons column added');
  }
  if (!srCols.includes('decline_reasons')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN decline_reasons TEXT');
    console.log('Migration: sales_reports.decline_reasons column added');
  }
  if (!srCols.includes('phone_number')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN phone_number TEXT');
    console.log('Migration: sales_reports.phone_number column added');
  }

  // Migration: sukuukun_evaluations に担当者・結果カラムを追加
  const evalCols = db.prepare('PRAGMA table_info(sukuukun_evaluations)').all().map(c => c.name);
  if (!evalCols.includes('interviewer_id')) {
    db.exec('ALTER TABLE sukuukun_evaluations ADD COLUMN interviewer_id INTEGER');
    console.log('Migration: sukuukun_evaluations.interviewer_id column added');
  }
  if (!evalCols.includes('interviewer_name')) {
    db.exec('ALTER TABLE sukuukun_evaluations ADD COLUMN interviewer_name TEXT');
    console.log('Migration: sukuukun_evaluations.interviewer_name column added');
  }
  if (!evalCols.includes('interview_result')) {
    db.exec('ALTER TABLE sukuukun_evaluations ADD COLUMN interview_result TEXT');
    console.log('Migration: sukuukun_evaluations.interview_result column added');
  }
  // Migration: sukuukun_evaluations に applicant_key カラムを追加（機能1）
  if (!evalCols.includes('applicant_key')) {
    db.exec('ALTER TABLE sukuukun_evaluations ADD COLUMN applicant_key TEXT');
    console.log('Migration: sukuukun_evaluations.applicant_key column added');
  }

  // Migration: applicant_interview_dates に source カラムを追加（機能3）
  const dateCols = db.prepare('PRAGMA table_info(applicant_interview_dates)').all().map(c => c.name);
  if (!dateCols.includes('source')) {
    db.exec("ALTER TABLE applicant_interview_dates ADD COLUMN source TEXT DEFAULT 'manual'");
    console.log('Migration: applicant_interview_dates.source column added');
  }

  // Migration: 既存すくう君履歴にapplicant_keyを紐付け（機能4）
  // applicant_key が NULL のレコードに applicant_name をセット
  const evalKeyFixed = db.prepare(
    "UPDATE sukuukun_evaluations SET applicant_key = applicant_name WHERE applicant_key IS NULL AND applicant_name IS NOT NULL"
  ).run();
  if (evalKeyFixed.changes > 0) {
    console.log(`Migration: sukuukun_evaluations.applicant_key backfilled for ${evalKeyFixed.changes} rows`);
  }
  // Migration: sales_reports に applicant_name_email カラム（複合キー用）を追加
  // 氏名+メールアドレスを正規化結合した値を格納し、UNIQUE制約で同一人物の重複登録を防ぐ
  // 値のフォーマット: "<正規化氏名>::<小文字メール>" or "<正規化氏名>::" (メールなし)
  if (!srCols.includes('applicant_name_email')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN applicant_name_email TEXT');
    // 既存レコードをバックフィル（氏名のスペース除去・小文字化 + メール小文字化）
    const existing = db.prepare('SELECT id, applicant_full_name, applicant_email FROM sales_reports').all();
    const update = db.prepare('UPDATE sales_reports SET applicant_name_email = ? WHERE id = ?');
    const upsertTx = db.transaction(() => {
      for (const row of existing) {
        const normalName = (row.applicant_full_name || '').replace(/[\s\u3000]/g, '').toLowerCase();
        const normalEmail = (row.applicant_email || '').toLowerCase().trim();
        update.run(`${normalName}::${normalEmail}`, row.id);
      }
    });
    upsertTx();
    // UNIQUE INDEX は追加しない（複数報告を許可するため）
    console.log('Migration: sales_reports.applicant_name_email column added');
  }

  // Migration: sales_reports に parent_id カラムを追加
  //   追記（2件目以降）の場合、元の報告の id を格納する
  //   初回報告は NULL
  if (!srCols.includes('parent_id')) {
    db.exec('ALTER TABLE sales_reports ADD COLUMN parent_id INTEGER');
    console.log('Migration: sales_reports.parent_id column added');
  }

  // Migration: idx_sr_name_email UNIQUE INDEX を削除（複数報告を許可するため）
  //   既に存在する場合のみ DROP（存在しなければスキップ）
  try {
    const hasUniqueIdx = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sr_name_email'"
    ).get();
    if (hasUniqueIdx) {
      db.exec('DROP INDEX idx_sr_name_email');
      console.log('Migration: idx_sr_name_email UNIQUE INDEX removed (multi-report support)');
    }
  } catch (e) {
    console.warn('Migration: idx_sr_name_email DROP スキップ:', e.message);
  }

  // すくう君発話比率分析履歴テーブル
  // ※ Migration（applicant_key追加・バックフィル）はこのCREATE TABLE の直後に記述
  db.exec(`
    CREATE TABLE IF NOT EXISTS sukuukun_speech_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interviewer_id INTEGER,
      interviewer_name TEXT,
      applicant_name TEXT,
      analyzed_at TEXT,
      sales_ratio INTEGER,
      applicant_ratio INTEGER,
      sales_chars INTEGER,
      applicant_chars INTEGER,
      max_monologue_sec INTEGER,
      mono_3min_count INTEGER,
      mono_5min_count INTEGER,
      applicant_turn_count INTEGER,
      silence_over_15s INTEGER,
      sales_interrupts INTEGER,
      applicant_interrupts INTEGER,
      emotion_confusion INTEGER,
      emotion_stress INTEGER,
      emotion_positive INTEGER,
      advice TEXT,
      actions TEXT,
      transcript_length INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: sukuukun_speech_analyses に applicant_key カラムを追加（機能1）
  // ※ CREATE TABLE の後に実行しないとテーブル未存在エラーになる
  const speechCols = db.prepare('PRAGMA table_info(sukuukun_speech_analyses)').all().map(c => c.name);
  if (!speechCols.includes('applicant_key')) {
    db.exec('ALTER TABLE sukuukun_speech_analyses ADD COLUMN applicant_key TEXT');
    console.log('Migration: sukuukun_speech_analyses.applicant_key column added');
  }
  const speechKeyFixed = db.prepare(
    "UPDATE sukuukun_speech_analyses SET applicant_key = applicant_name WHERE applicant_key IS NULL AND applicant_name IS NOT NULL"
  ).run();
  if (speechKeyFixed.changes > 0) {
    console.log(`Migration: sukuukun_speech_analyses.applicant_key backfilled for ${speechKeyFixed.changes} rows`);
  }

  // Notionから取得した応募者詳細プロファイルテーブル
  // student_number をキーとして各プロパティを保存
  db.exec(`
    CREATE TABLE IF NOT EXISTS notion_profiles (
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
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Check if admin user exists
  const adminExists = db.prepare("SELECT id FROM users WHERE login_id = 'admin'").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('1111', 10);
    db.prepare(`
      INSERT INTO users (login_id, name, role, password_hash, must_change_password)
      VALUES ('admin', '管理者', 'admin', ?, 1)
    `).run(hash);
    console.log('Default admin user created: login_id=admin, password=1111');
  }
}

initializeDatabase();

module.exports = db;
