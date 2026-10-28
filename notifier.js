// แจ้งเตือนผ่าน LINE Messaging API
// - ผู้ใช้แต่ละคนเชื่อมบัญชี LINE ของตัวเอง โดยแอดเพื่อนแล้วส่งรหัส 6 หลักจากเว็บ (รับผ่าน webhook)
// - เซิร์ฟเวอร์ส่งสรุปงานที่ถึงกำหนดให้แต่ละคนวันละครั้ง จึงแจ้งเตือนได้แม้ปิดหน้าเว็บ

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { db, today, transaction } from './db.js';

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
const SECRET = process.env.LINE_CHANNEL_SECRET?.trim();
const DEV_USER_ID = process.env.LINE_USER_ID?.trim();
const APP_URL = process.env.APP_URL?.trim().replace(/\/$/, '');
const NOTIFY_TIME = /^\d{2}:\d{2}$/.test(process.env.NOTIFY_TIME ?? '') ? process.env.NOTIFY_TIME : '08:00';
const RETRY_AFTER_MS = 30 * 60 * 1000;
const CODE_MINUTES = 15;

export const lineConfigured = () => Boolean(TOKEN);

let basicId = null; // เช่น @295nfvpq — โหลดจาก LINE ตอนเริ่มระบบ ใช้ทำลิงก์แอดเพื่อน

async function lineApi(path, payload) {
  const res = await fetch(`https://api.line.me/v2/bot${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LINE ตอบกลับ ${res.status}: ${data.message ?? 'ไม่ทราบสาเหตุ'}`);
  return data;
}

const textMessage = (text) => [{ type: 'text', text: text.slice(0, 5000) }];

export async function pushLine(userId, text) {
  const user = db.prepare('SELECT line_user_id FROM users WHERE id = ?').get(userId);
  if (!lineConfigured()) throw new Error('ระบบยังไม่ได้ตั้งค่า LINE');
  if (!user?.line_user_id) throw new Error('บัญชีนี้ยังไม่ได้เชื่อมต่อ LINE');
  await lineApi('/message/push', { to: user.line_user_id, messages: textMessage(text) });
  db.prepare('UPDATE users SET line_last_sent_at = ? WHERE id = ?').run(new Date().toLocaleString('sv-SE'), userId);
}

const reply = (replyToken, text) => lineApi('/message/reply', { replyToken, messages: textMessage(text) });

export function lineStatus(userId) {
  const u = db.prepare('SELECT line_user_id, line_last_sent_at FROM users WHERE id = ?').get(userId);
  return {
    configured: lineConfigured(),
    can_link: Boolean(TOKEN && SECRET),
    linked: Boolean(u.line_user_id),
    notify_time: NOTIFY_TIME,
    last_sent: u.line_last_sent_at,
    add_friend_url: basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : null,
    bot_id: basicId,
  };
}

export function createLinkCode(userId) {
  let code;
  do {
    code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  } while (db.prepare("SELECT 1 FROM users WHERE line_link_code = ? AND line_link_expires > datetime('now')").get(code));
  db.prepare(`UPDATE users SET line_link_code = ?, line_link_expires = datetime('now', '+${CODE_MINUTES} minutes') WHERE id = ?`)
    .run(code, userId);
  return { code, expires_in_minutes: CODE_MINUTES };
}

export function unlinkLine(userId) {
  db.prepare('UPDATE users SET line_user_id = NULL, line_link_code = NULL, line_link_expires = NULL WHERE id = ?').run(userId);
}

// ---------- webhook ----------

export function verifySignature(rawBody, signature) {
  if (!SECRET || !signature) return false;
  const expected = Buffer.from(createHmac('sha256', SECRET).update(rawBody).digest('base64'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const HELP_TEXT = [
  'วิธีรับแจ้งเตือนจาก DeviceCare',
  '1. เข้าสู่ระบบเว็บ DeviceCare',
  '2. ไปที่เมนู “แจ้งเตือน” แล้วกด “เชื่อมต่อ LINE”',
  '3. พิมพ์รหัส 6 หลักที่ได้ส่งมาในแชตนี้',
  ...(APP_URL ? ['', `เว็บไซต์: ${APP_URL}`] : []),
].join('\n');

async function handleEvent(event) {
  const lineUserId = event.source?.userId;
  if (event.source?.type !== 'user' || !lineUserId) return;

  if (event.type === 'follow') {
    return reply(event.replyToken, `สวัสดีครับ 👋 ขอบคุณที่เพิ่ม DeviceCare เป็นเพื่อน\n\n${HELP_TEXT}`);
  }
  if (event.type === 'unfollow') {
    // ผู้ใช้บล็อกบัญชี — ส่งข้อความหาไม่ได้แล้ว จึงยกเลิกการเชื่อมต่อ
    db.prepare('UPDATE users SET line_user_id = NULL WHERE line_user_id = ?').run(lineUserId);
    return;
  }
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const text = event.message.text.trim();
  if (/^\d{6}$/.test(text)) {
    const user = db.prepare(`
      SELECT id, display_name FROM users
      WHERE line_link_code = ? AND line_link_expires > datetime('now')`).get(text);
    if (!user) return reply(event.replyToken, '❌ รหัสไม่ถูกต้องหรือหมดอายุแล้ว\nกรุณากด “เชื่อมต่อ LINE” ในเว็บอีกครั้งเพื่อรับรหัสใหม่');
    transaction(() => {
      db.prepare('UPDATE users SET line_user_id = NULL WHERE line_user_id = ?').run(lineUserId);
      db.prepare('UPDATE users SET line_user_id = ?, line_link_code = NULL, line_link_expires = NULL WHERE id = ?')
        .run(lineUserId, user.id);
    });
    return reply(event.replyToken,
      `✅ เชื่อมต่อกับบัญชี “${user.display_name}” สำเร็จ\nระบบจะส่งสรุปงานดูแลอุปกรณ์ที่ถึงกำหนดมาที่นี่ทุกวันเวลา ${NOTIFY_TIME} น.`);
  }

  const linked = db.prepare('SELECT display_name FROM users WHERE line_user_id = ?').get(lineUserId);
  return reply(event.replyToken, linked
    ? `LINE นี้เชื่อมต่อกับบัญชี “${linked.display_name}” แล้ว ✅\nระบบจะส่งแจ้งเตือนทุกวันเวลา ${NOTIFY_TIME} น. เมื่อมีงานที่ถึงกำหนด`
    : HELP_TEXT);
}

export async function handleWebhook(body) {
  for (const event of body.events ?? []) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error(`LINE webhook: ${err.message}`);
    }
  }
}

// ---------- สรุปประจำวัน ----------

export function dueSummaryText(userId) {
  const due = db.prepare(`
    SELECT r.title, r.next_due, d.name AS device_name
    FROM reminders r JOIN devices d ON d.id = r.device_id
    WHERE d.user_id = ? AND r.next_due <= ? ORDER BY r.next_due`).all(userId, today());
  if (!due.length) return null;
  const now = new Date(`${today()}T00:00:00`);
  const lines = due.map((r) => {
    const late = Math.round((now - new Date(`${r.next_due}T00:00:00`)) / 86400000);
    return `• ${r.title} (${r.device_name}) — ${late > 0 ? `เลยกำหนด ${late} วัน` : 'ถึงกำหนดวันนี้'}`;
  });
  return [
    `🔔 DeviceCare: มีงานดูแลอุปกรณ์ ${due.length} รายการ`,
    '',
    ...lines,
    '',
    APP_URL ? `เปิดเว็บเพื่อกด “ทำแล้ว”: ${APP_URL}/#reminders` : 'เปิดเว็บ DeviceCare เพื่อกด “ทำแล้ว”',
  ].join('\n');
}

// สำหรับทดสอบบนเครื่องตัวเอง (webhook เข้าถึง localhost ไม่ได้):
// ถ้าตั้ง LINE_USER_ID ไว้ จะผูกให้บัญชีแรกในระบบโดยอัตโนมัติ
function linkDevUser() {
  if (!DEV_USER_ID || db.prepare('SELECT 1 FROM users WHERE line_user_id = ?').get(DEV_USER_ID)) return;
  db.prepare('UPDATE users SET line_user_id = ? WHERE id = (SELECT MIN(id) FROM users) AND line_user_id IS NULL')
    .run(DEV_USER_ID);
}

const failedAt = new Map();
let running = false;

async function sendDailySummaries() {
  if (running) return;
  linkDevUser();
  const now = new Date();
  const [h, m] = NOTIFY_TIME.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;

  running = true;
  try {
    const users = db.prepare(`
      SELECT id FROM users
      WHERE line_user_id IS NOT NULL AND (line_last_daily IS NULL OR line_last_daily <> ?)`).all(today());
    for (const { id } of users) {
      if (Date.now() - (failedAt.get(id) ?? 0) < RETRY_AFTER_MS) continue;
      // ยังไม่มีงานค้างก็ยังไม่นับว่าส่งแล้ว เผื่อมีงานถึงกำหนดเพิ่มในวันเดียวกัน
      const text = dueSummaryText(id);
      if (!text) continue;
      try {
        await pushLine(id, text);
        db.prepare('UPDATE users SET line_last_daily = ? WHERE id = ?').run(today(), id);
        failedAt.delete(id);
      } catch (err) {
        failedAt.set(id, Date.now());
        console.error(`LINE: ส่งถึงผู้ใช้ #${id} ไม่สำเร็จ จะลองใหม่ใน 30 นาที — ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

export async function startLineScheduler() {
  if (!lineConfigured()) {
    console.log('LINE: ยังไม่ได้ตั้งค่า (ดูวิธีตั้งค่าใน README.md) — ระบบยังใช้งานได้ตามปกติ');
    return;
  }
  try {
    basicId = (await lineApi('/info')).basicId;
    console.log(`LINE: เชื่อมต่อบัญชี ${basicId} แล้ว จะส่งสรุปทุกวันเวลา ${NOTIFY_TIME}`);
  } catch (err) {
    console.error(`LINE: ตรวจสอบ token ไม่ผ่าน — ${err.message}`);
  }
  if (!SECRET) console.log('LINE: ยังไม่ได้ใส่ LINE_CHANNEL_SECRET — ผู้ใช้จะเชื่อมต่อ LINE ด้วยรหัสไม่ได้');
  sendDailySummaries();
  setInterval(sendDailySummaries, 60 * 1000);
}
