import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// กันการเดารหัสผ่าน: ผิดเกิน 5 ครั้ง ล็อกชื่อผู้ใช้นั้น 5 นาที
const failures = new Map();

export function loginLocked(username) {
  const f = failures.get(username.toLowerCase());
  return Boolean(f && f.count >= MAX_FAILURES && Date.now() - f.at < LOCK_MS);
}

export function recordLoginFailure(username) {
  const key = username.toLowerCase();
  const f = failures.get(key);
  const expired = !f || Date.now() - f.at >= LOCK_MS;
  failures.set(key, { count: expired ? 1 : f.count + 1, at: Date.now() });
}

export const clearLoginFailures = (username) => failures.delete(username.toLowerCase());

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v));
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
    .run(token, userId);
  return token;
}

export function sessionUser(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.line_user_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token) ?? null;
}

export function destroySession(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function sessionCookie(req, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `sid=${token ?? ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
