import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, deviceTypes, today, addDays, transaction, claimOrphanData } from './db.js';
import {
  hashPassword, verifyPassword, createSession, sessionUser, destroySession, sessionCookie,
  loginLocked, recordLoginFailure, clearLoginFailures,
} from './auth.js';
import {
  lineStatus, pushLine, dueSummaryText, createLinkCode, unlinkLine,
  verifySignature, handleWebhook, startLineScheduler,
} from './notifier.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation helpers ----------

function text(value, label, { required = true, max = 200 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (required) throw new HttpError(400, `กรุณากรอก${label}`);
    return null;
  }
  if (v.length > max) throw new HttpError(400, `${label}ยาวเกิน ${max} ตัวอักษร`);
  return v;
}

function date(value, label, { required = true } = {}) {
  if (!value) {
    if (required) throw new HttpError(400, `กรุณาระบุ${label}`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  }
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  return value;
}

function number(value, label, { min = 0, integer = false } = {}) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  }
  return n;
}

// อุปกรณ์ต้องเป็นของผู้ใช้ที่ล็อกอินอยู่เท่านั้น
function ownDeviceId(value, user) {
  const id = Number(value);
  if (!db.prepare('SELECT 1 FROM devices WHERE id = ? AND user_id = ?').get(id, user.id)) {
    throw new HttpError(400, 'ไม่พบอุปกรณ์ที่เลือก');
  }
  return id;
}

function mustExist(result) {
  if (result.changes === 0) throw new HttpError(404, 'ไม่พบข้อมูล');
  return { ok: true };
}

const parseList = (row, ...fields) => {
  const out = { ...row };
  for (const f of fields) out[f] = JSON.parse(row[f]);
  out.device_types = row.device_types.split(',');
  return out;
};

const publicUser = (u) => ({ id: u.id, username: u.username, display_name: u.display_name });

// ---------- routes ----------

const routes = [];
const route = (method, path, handler, { auth = true } = {}) => {
  const re = new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>\\d+)')}$`);
  routes.push({ method, re, handler, auth });
};

const DEVICE_TYPES = deviceTypes.map((t) => t.key);
const RECORD_KINDS = ['maintenance', 'repair', 'checkup'];

route('GET', '/api/device-types', () => deviceTypes, { auth: false });

// สมาชิก
route('POST', '/api/auth/register', ({ body, req, res }) => {
  const username = text(body.username, 'ชื่อผู้ใช้', { max: 30 });
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
    throw new HttpError(400, 'ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข _ หรือ . ยาว 3–30 ตัวอักษร');
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new HttpError(400, 'ชื่อผู้ใช้นี้มีคนใช้แล้ว');
  }
  const displayName = text(body.display_name, 'ชื่อที่แสดง', { max: 50 });

  let userId;
  transaction(() => {
    userId = Number(db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
      .run(username, displayName, hashPassword(password)).lastInsertRowid);
    // บัญชีแรกของระบบได้รับข้อมูลที่บันทึกไว้ก่อนมีระบบสมาชิก
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 1) claimOrphanData(userId);
  });
  res.setHeader('Set-Cookie', sessionCookie(req, createSession(userId)));
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}, { auth: false });

route('POST', '/api/auth/login', ({ body, req, res }) => {
  const username = String(body.username ?? '').trim();
  if (loginLocked(username)) throw new HttpError(429, 'ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 5 นาทีแล้วลองใหม่');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(String(body.password ?? ''), user.password_hash)) {
    recordLoginFailure(username);
    throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  clearLoginFailures(username);
  res.setHeader('Set-Cookie', sessionCookie(req, createSession(user.id)));
  return publicUser(user);
}, { auth: false });

route('POST', '/api/auth/logout', ({ req, res }) => {
  destroySession(req);
  res.setHeader('Set-Cookie', sessionCookie(req, null));
  return { ok: true };
}, { auth: false });

route('GET', '/api/auth/me', ({ user }) => publicUser(user));

// อุปกรณ์
route('GET', '/api/devices', ({ user }) =>
  db.prepare(`
    SELECT d.*,
           (SELECT COUNT(*)              FROM records r WHERE r.device_id = d.id) AS record_count,
           (SELECT COALESCE(SUM(cost),0) FROM records r WHERE r.device_id = d.id) AS total_cost
    FROM devices d WHERE d.user_id = ? ORDER BY d.id DESC`).all(user.id));

route('POST', '/api/devices', ({ body, user }) => {
  const r = db.prepare('INSERT INTO devices (user_id, name, type, brand, purchase_date) VALUES (?, ?, ?, ?, ?)').run(
    user.id,
    text(body.name, 'ชื่ออุปกรณ์', { max: 80 }),
    oneOf(body.type, DEVICE_TYPES, 'ประเภทอุปกรณ์'),
    text(body.brand, 'ยี่ห้อ/รุ่น', { required: false, max: 80 }),
    date(body.purchase_date, 'วันที่ซื้อ', { required: false }),
  );
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(r.lastInsertRowid);
});

route('PUT', '/api/devices/:id', ({ body, params, user }) =>
  mustExist(db.prepare('UPDATE devices SET name = ?, type = ?, brand = ?, purchase_date = ? WHERE id = ? AND user_id = ?').run(
    text(body.name, 'ชื่ออุปกรณ์', { max: 80 }),
    oneOf(body.type, DEVICE_TYPES, 'ประเภทอุปกรณ์'),
    text(body.brand, 'ยี่ห้อ/รุ่น', { required: false, max: 80 }),
    date(body.purchase_date, 'วันที่ซื้อ', { required: false }),
    params.id,
    user.id,
  )));

route('DELETE', '/api/devices/:id', ({ params, user }) =>
  mustExist(db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(params.id, user.id)));

// ตรวจอาการ
route('GET', '/api/symptoms', ({ query }) => {
  const type = query.get('type');
  return db.prepare('SELECT * FROM symptoms ORDER BY id').all()
    .map((row) => parseList(row, 'steps', 'see_technician'))
    .filter((s) => !type || s.device_types.includes(type));
});

route('POST', '/api/diagnoses', ({ body, user }) => {
  const code = String(body.symptom_code ?? '');
  if (!db.prepare('SELECT 1 FROM symptoms WHERE code = ?').get(code)) throw new HttpError(400, 'ไม่พบอาการที่เลือก');
  db.prepare('INSERT INTO diagnosis_logs (user_id, device_type, symptom_code) VALUES (?, ?, ?)')
    .run(user.id, oneOf(body.device_type, DEVICE_TYPES, 'ประเภทอุปกรณ์'), code);
  return { ok: true };
});

// คู่มือ
route('GET', '/api/guides', () =>
  db.prepare('SELECT * FROM guides ORDER BY id').all().map((row) => parseList(row, 'content')));

// แจ้งเตือน
route('GET', '/api/reminders', ({ user }) =>
  db.prepare(`
    SELECT r.*, d.name AS device_name, d.type AS device_type
    FROM reminders r JOIN devices d ON d.id = r.device_id
    WHERE d.user_id = ?
    ORDER BY r.next_due, r.id`).all(user.id));

route('POST', '/api/reminders', ({ body, user }) => {
  const interval = number(body.interval_days, 'รอบการแจ้งเตือน', { min: 1, integer: true });
  const r = db.prepare('INSERT INTO reminders (device_id, title, interval_days, next_due) VALUES (?, ?, ?, ?)').run(
    ownDeviceId(body.device_id, user),
    text(body.title, 'หัวข้อการแจ้งเตือน', { max: 100 }),
    interval,
    date(body.next_due, 'วันที่เริ่ม', { required: false }) ?? addDays(today(), interval),
  );
  return db.prepare('SELECT * FROM reminders WHERE id = ?').get(r.lastInsertRowid);
});

// ทำรายการเสร็จ: บันทึกลงประวัติและเลื่อนกำหนดครั้งถัดไปอัตโนมัติ
route('POST', '/api/reminders/:id/complete', ({ params, user }) => {
  const reminder = db.prepare(`
    SELECT r.* FROM reminders r JOIN devices d ON d.id = r.device_id
    WHERE r.id = ? AND d.user_id = ?`).get(params.id, user.id);
  if (!reminder) throw new HttpError(404, 'ไม่พบการแจ้งเตือน');
  const done = today();
  const nextDue = addDays(done, reminder.interval_days);
  transaction(() => {
    db.prepare("INSERT INTO records (device_id, date, kind, description) VALUES (?, ?, 'maintenance', ?)")
      .run(reminder.device_id, done, reminder.title);
    db.prepare('UPDATE reminders SET next_due = ? WHERE id = ?').run(nextDue, reminder.id);
  });
  return { ok: true, next_due: nextDue };
});

route('DELETE', '/api/reminders/:id', ({ params, user }) =>
  mustExist(db.prepare(`
    DELETE FROM reminders WHERE id = ? AND device_id IN (SELECT id FROM devices WHERE user_id = ?)`).run(params.id, user.id)));

// ประวัติการดูแลและซ่อมแซม
route('GET', '/api/records', ({ query, user }) => {
  const device = query.get('device_id');
  const sql = `
    SELECT r.*, d.name AS device_name, s.title AS symptom_title
    FROM records r
    JOIN devices d ON d.id = r.device_id
    LEFT JOIN symptoms s ON s.code = r.symptom_code
    WHERE d.user_id = ? ${device ? 'AND r.device_id = ?' : ''}
    ORDER BY r.date DESC, r.id DESC`;
  return device ? db.prepare(sql).all(user.id, Number(device)) : db.prepare(sql).all(user.id);
});

route('POST', '/api/records', ({ body, user }) => {
  const symptom = body.symptom_code || null;
  if (symptom && !db.prepare('SELECT 1 FROM symptoms WHERE code = ?').get(symptom)) {
    throw new HttpError(400, 'ไม่พบอาการที่เลือก');
  }
  const r = db.prepare('INSERT INTO records (device_id, date, kind, description, cost, symptom_code) VALUES (?, ?, ?, ?, ?, ?)').run(
    ownDeviceId(body.device_id, user),
    date(body.date, 'วันที่'),
    oneOf(body.kind, RECORD_KINDS, 'ประเภทรายการ'),
    text(body.description, 'รายละเอียด', { max: 500 }),
    number(body.cost, 'ค่าใช้จ่าย'),
    symptom,
  );
  return db.prepare('SELECT * FROM records WHERE id = ?').get(r.lastInsertRowid);
});

route('DELETE', '/api/records/:id', ({ params, user }) =>
  mustExist(db.prepare(`
    DELETE FROM records WHERE id = ? AND device_id IN (SELECT id FROM devices WHERE user_id = ?)`).run(params.id, user.id)));

// แจ้งเตือนผ่าน LINE
route('GET', '/api/line', ({ user }) => lineStatus(user.id));

route('POST', '/api/line/link-code', ({ user }) => {
  if (!lineStatus(user.id).can_link) throw new HttpError(400, 'ระบบยังไม่ได้ตั้งค่า LINE สำหรับการเชื่อมต่อ');
  return createLinkCode(user.id);
});

route('POST', '/api/line/unlink', ({ user }) => {
  unlinkLine(user.id);
  return { ok: true };
});

route('POST', '/api/line/test', async ({ user }) => {
  await pushLine(user.id, `✅ DeviceCare เชื่อมต่อ LINE กับบัญชี “${user.display_name}” สำเร็จ ระบบจะส่งสรุปงานดูแลอุปกรณ์มาที่นี่ทุกวัน`);
  return { ok: true };
});

route('POST', '/api/line/send-now', async ({ user }) => {
  await pushLine(user.id, dueSummaryText(user.id) ?? '🎉 DeviceCare: ตอนนี้ไม่มีงานดูแลอุปกรณ์ที่ถึงกำหนด');
  return { ok: true };
});

// แดชบอร์ด
route('GET', '/api/dashboard', ({ user }) => {
  const now = today();
  const soon = addDays(now, 7);
  const reminderSql = `
    SELECT r.*, d.name AS device_name FROM reminders r JOIN devices d ON d.id = r.device_id
    WHERE d.user_id = ? AND r.next_due %s ORDER BY r.next_due`;
  const totals = db.prepare(`
    SELECT COUNT(*) AS record_count,
           COALESCE(SUM(cost), 0) AS total_cost,
           COALESCE(SUM(kind = 'maintenance'), 0) AS maintenance_count,
           COALESCE(SUM(kind = 'repair'), 0) AS repair_count
    FROM records r JOIN devices d ON d.id = r.device_id WHERE d.user_id = ?`).get(user.id);
  return {
    today: now,
    device_count: db.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').get(user.id).n,
    ...totals,
    overdue: db.prepare(reminderSql.replace('%s', '<= ?')).all(user.id, now),
    upcoming: db.prepare(reminderSql.replace('%s', '> ? AND r.next_due <= ?')).all(user.id, now, soon),
    recent_records: db.prepare(`
      SELECT r.*, d.name AS device_name FROM records r JOIN devices d ON d.id = r.device_id
      WHERE d.user_id = ?
      ORDER BY r.date DESC, r.id DESC LIMIT 5`).all(user.id),
    top_symptoms: db.prepare(`
      SELECT s.code, s.title, s.icon, COUNT(*) AS count
      FROM diagnosis_logs l JOIN symptoms s ON s.code = l.symptom_code
      WHERE l.user_id = ?
      GROUP BY s.code ORDER BY count DESC LIMIT 5`).all(user.id),
  };
});

// ---------- http server ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new HttpError(413, 'ข้อมูลมีขนาดใหญ่เกินไป');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const raw = (await readRaw(req)).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง');
  }
}

async function serveStatic(pathname, res) {
  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR + sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

// LINE ส่งข้อความที่ผู้ใช้พิมพ์มาที่นี่ — ต้องตรวจลายเซ็นจาก raw body ก่อน parse
async function lineWebhook(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const raw = await readRaw(req);
  if (!verifySignature(raw, req.headers['x-line-signature'])) return send(res, 401, { error: 'Invalid signature' });
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(res, 400, { error: 'Invalid JSON' });
  }
  await handleWebhook(body);
  send(res, 200, { ok: true });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/webhook/line') return await lineWebhook(req, res);
    if (!url.pathname.startsWith('/api/')) return await serveStatic(url.pathname, res);

    const methodMatches = routes.filter((r) => r.re.test(url.pathname));
    const match = methodMatches.find((r) => r.method === req.method);
    if (!match) return send(res, methodMatches.length ? 405 : 404, { error: 'ไม่พบ API นี้' });

    const user = sessionUser(req);
    if (match.auth && !user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const params = { ...url.pathname.match(match.re).groups };
    send(res, 200, await match.handler({ body, params, query: url.searchParams, user, req, res }));
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (url.pathname.startsWith('/api/line/')) return send(res, 502, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

server.listen(PORT, () => {
  console.log(`DeviceCare พร้อมใช้งานที่ http://localhost:${PORT}`);
  startLineScheduler();
});
