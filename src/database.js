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

  // interview_date カラムのマイグレーション（既存DBへの追加）
  const cols = db.pragma('table_info(sales_reports)');
  const hasInterviewDate = cols.some(c => c.name === 'interview_date');
  if (!hasInterviewDate) {
    db.exec(`ALTER TABLE sales_reports ADD COLUMN interview_date TEXT`);
    console.log('Migration: added interview_date column to sales_reports');
  }

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
