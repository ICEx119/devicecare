import { randomBytes } from 'node:crypto';
import { db, today, addDays, transaction } from './db.js';
import { hashPassword } from './auth.js';

const GUEST_HOURS = 24;

// อุปกรณ์ แจ้งเตือน และประวัติตัวอย่าง ให้เห็นทุกฟีเจอร์ตั้งแต่เข้าครั้งแรก
function seedSampleData(userId) {
  const now = today();
  const addDevice = db.prepare('INSERT INTO devices (user_id, name, type, brand, purchase_date) VALUES (?, ?, ?, ?, ?)');
  const laptop = Number(addDevice.run(userId, 'โน้ตบุ๊กเรียน', 'laptop', 'Acer Aspire 5', addDays(now, -800)).lastInsertRowid);
  const phone = Number(addDevice.run(userId, 'มือถือ', 'smartphone', 'Samsung Galaxy A54', addDays(now, -420)).lastInsertRowid);
  addDevice.run(userId, 'เครื่องพิมพ์หอพัก', 'printer', 'Canon PIXMA G2010', addDays(now, -300));

  const addReminder = db.prepare('INSERT INTO reminders (device_id, title, interval_days, next_due) VALUES (?, ?, ?, ?)');
  addReminder.run(laptop, 'ทำความสะอาดช่องระบายอากาศ', 90, addDays(now, -2));
  addReminder.run(laptop, 'สำรองข้อมูลสำคัญ', 7, addDays(now, 3));
  addReminder.run(phone, 'ตรวจสุขภาพแบตเตอรี่', 30, addDays(now, 12));

  const addRecord = db.prepare('INSERT INTO records (device_id, date, kind, description, cost, symptom_code) VALUES (?, ?, ?, ?, ?, ?)');
  addRecord.run(laptop, addDays(now, -95), 'maintenance', 'ทำความสะอาดช่องระบายอากาศ', 0, null);
  addRecord.run(laptop, addDays(now, -40), 'repair', 'เปลี่ยนพัดลมระบายความร้อนที่ร้านซ่อม', 650, null);
  addRecord.run(phone, addDays(now, -10), 'checkup', 'ตรวจอาการ: แบตเตอรี่หมดเร็ว — ปิดแอปเบื้องหลังแล้วดีขึ้น', 0, 'mobile_battery');
}

// บัญชีทดสอบสำหรับผู้ประเมิน: สร้างเมื่อตั้ง DEMO_PASSWORD ไว้ และยังไม่มีบัญชีนี้
// Render รุ่นฟรีล้างฐานข้อมูลเมื่อ deploy ใหม่ บัญชีนี้จึงถูกสร้างใหม่พร้อมข้อมูลตัวอย่างทุกครั้ง
export function ensureDemoAccount() {
  const password = process.env.DEMO_PASSWORD;
  const username = process.env.DEMO_USERNAME || 'demo';
  if (!password) return;
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return;

  transaction(() => {
    const userId = Number(db.prepare(`
      INSERT INTO users (username, display_name, password_hash, privacy_accepted_at)
      VALUES (?, 'ผู้ทดสอบระบบ', ?, datetime('now', 'localtime'))`).run(username, hashPassword(password)).lastInsertRowid);
    seedSampleData(userId);
  });
  console.log(`สร้างบัญชีทดสอบ "${username}" แล้ว`);
}

// โหมดทดลองใช้: บัญชีชั่วคราวแยกของแต่ละคน (ไม่มีรหัสผ่านที่ใช้ล็อกอินได้) ลบเมื่อออกจากระบบหรือครบ 24 ชม.
export function createGuestAccount() {
  let userId;
  transaction(() => {
    userId = Number(db.prepare(`
      INSERT INTO users (username, display_name, password_hash, privacy_accepted_at, is_guest)
      VALUES (?, 'ผู้ทดลองใช้', ?, datetime('now', 'localtime'), 1)`)
      .run(`guest_${randomBytes(4).toString('hex')}`, hashPassword(randomBytes(24).toString('hex'))).lastInsertRowid);
    seedSampleData(userId);
  });
  return userId;
}

export function cleanupGuests() {
  const { changes } = db.prepare(`DELETE FROM users WHERE is_guest = 1 AND created_at < datetime('now', 'localtime', '-${GUEST_HOURS} hours')`).run();
  if (changes) console.log(`ลบบัญชีทดลองใช้ที่หมดอายุ ${changes} บัญชี`);
}
