import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { symptoms, guides } from './seed.js';

export { deviceTypes } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(here, 'data', 'devicecare.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    username          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name      TEXT NOT NULL,
    password_hash     TEXT NOT NULL,
    line_user_id      TEXT UNIQUE,         -- ได้จาก webhook เมื่อผู้ใช้ส่งรหัสเชื่อมต่อ
    line_link_code    TEXT,
    line_link_expires TEXT,
    line_last_daily   TEXT,                -- วันที่ส่งสรุปประจำวันล่าสุด
    line_last_sent_at TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,           -- ค่าที่ใช้ได้อยู่ใน deviceTypes (seed.js)
    brand         TEXT,
    purchase_date TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS symptoms (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    icon           TEXT,
    device_types   TEXT NOT NULL,          -- เช่น 'laptop,desktop'
    severity       TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    steps          TEXT NOT NULL,          -- JSON array
    see_technician TEXT NOT NULL           -- JSON array
  );

  CREATE TABLE IF NOT EXISTS guides (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category     TEXT NOT NULL,
    title        TEXT NOT NULL,
    device_types TEXT NOT NULL,
    summary      TEXT,
    content      TEXT NOT NULL             -- JSON array
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    interval_days INTEGER NOT NULL CHECK (interval_days > 0),
    next_due      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('maintenance', 'repair', 'checkup')),
    description  TEXT NOT NULL,
    cost         REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
    symptom_code TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- เก็บสถิติการใช้ระบบตรวจอาการ ใช้ประเมินผลว่าปัญหาใดพบบ่อย
  CREATE TABLE IF NOT EXISTS diagnosis_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    device_type  TEXT NOT NULL,
    symptom_code TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- ผลการวิเคราะห์ด้วย AI เก็บข้อความที่ผู้ใช้พิมพ์ด้วย จึงลบตามเมื่อผู้ใช้ลบบัญชี (PDPA)
  CREATE TABLE IF NOT EXISTS ai_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    device_type  TEXT,
    input_text   TEXT NOT NULL,
    status       TEXT NOT NULL,            -- ok / need_info / out_of_scope / refused
    confidence   TEXT,
    symptom_code TEXT,
    latency_ms   INTEGER,
    helpful      INTEGER,                  -- ผู้ใช้กด 👍 = 1, 👎 = 0
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_records_device   ON records(device_id, date);
  CREATE INDEX IF NOT EXISTS idx_reminders_due    ON reminders(next_due);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_guides_title ON guides(title);
`);

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ฐานข้อมูลรุ่นแรกจำกัดประเภทอุปกรณ์ไว้แค่ laptop/desktop ด้วย CHECK
// SQLite แก้ CHECK ไม่ได้ จึงสร้างตารางใหม่แล้วย้ายข้อมูล (ปิด foreign key ชั่วคราว ไม่ให้ประวัติถูกลบตาม)
const devicesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'").get().sql;
if (devicesSql.includes('CHECK')) {
  db.exec('PRAGMA foreign_keys = OFF');
  transaction(() => {
    db.exec(`
      CREATE TABLE devices_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL,
        brand         TEXT,
        purchase_date TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      INSERT INTO devices_new (id, name, type, brand, purchase_date, created_at)
        SELECT id, name, type, brand, purchase_date, created_at FROM devices;
      DROP TABLE devices;
      ALTER TABLE devices_new RENAME TO devices;
    `);
  });
  db.exec('PRAGMA foreign_keys = ON');
}

// ฐานข้อมูลก่อนมีระบบสมาชิกไม่มีคอลัมน์ user_id — ข้อมูลเดิมจะถูกโอนให้บัญชีแรกที่สมัคร (ดู claimOrphanData)
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('devices', 'user_id')) {
  db.exec('ALTER TABLE devices ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}
if (!hasColumn('diagnosis_logs', 'user_id')) {
  db.exec('ALTER TABLE diagnosis_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
}
// วันที่ผู้ใช้ยอมรับนโยบายข้อมูลส่วนบุคคลตอนสมัคร (บัญชีเก่ายังว่าง)
if (!hasColumn('users', 'privacy_accepted_at')) {
  db.exec('ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT');
}
// บัญชีชั่วคราวจากปุ่ม "ทดลองใช้งาน" (ลบอัตโนมัติ ดู demo.js)
if (!hasColumn('users', 'is_guest')) {
  db.exec('ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
  DELETE FROM sessions WHERE expires_at <= datetime('now');
`);

export function claimOrphanData(userId) {
  db.prepare('UPDATE devices SET user_id = ? WHERE user_id IS NULL').run(userId);
  db.prepare('UPDATE diagnosis_logs SET user_id = ? WHERE user_id IS NULL').run(userId);
}

// ซิงก์อาการและคู่มือให้ตรงกับ seed.js ทุกครั้งที่เปิดระบบ
transaction(() => {
  const upsertSymptom = db.prepare(`
    INSERT INTO symptoms (code, title, icon, device_types, severity, steps, see_technician)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (code) DO UPDATE SET
      title = excluded.title, icon = excluded.icon, device_types = excluded.device_types,
      severity = excluded.severity, steps = excluded.steps, see_technician = excluded.see_technician`);
  for (const s of symptoms) {
    upsertSymptom.run(s.code, s.title, s.icon, s.device_types, s.severity, JSON.stringify(s.steps), JSON.stringify(s.see_technician));
  }
  const codes = symptoms.map((s) => s.code);
  db.prepare(`DELETE FROM symptoms WHERE code NOT IN (${codes.map(() => '?').join(',')})`).run(...codes);

  const upsertGuide = db.prepare(`
    INSERT INTO guides (category, title, device_types, summary, content) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (title) DO UPDATE SET
      category = excluded.category, device_types = excluded.device_types,
      summary = excluded.summary, content = excluded.content`);
  for (const g of guides) {
    upsertGuide.run(g.category, g.title, g.device_types, g.summary, JSON.stringify(g.content));
  }
  const titles = guides.map((g) => g.title);
  db.prepare(`DELETE FROM guides WHERE title NOT IN (${titles.map(() => '?').join(',')})`).run(...titles);
});

// วันที่ตามเวลาเครื่อง ในรูปแบบ YYYY-MM-DD
export function today() {
  return localDate(new Date());
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

function localDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
