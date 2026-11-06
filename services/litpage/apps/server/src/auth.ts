// Passwordless email-code login  with optional password, cookie session `lit_session`.
import { randomBytes, scryptSync, timingSafeEqual, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db } from './db.ts';

const SESSION_DAYS = 365;
const CODE_TTL_MS = 15 * 60_000;
/** Wrong codes accepted per issued code; re-requesting a code does not reset the counter while it is valid. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Login codes are shown in the API response / login screen only for local development: NODE_ENV must not be
 * "production" *and* NC_DEV_LOGIN_CODES=1 must be set explicitly (apps/server `pnpm dev` does).
 */
export function devLoginCodesEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.NC_DEV_LOGIN_CODES === '1';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    let v = part.slice(i + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep the raw value: a malformed cookie must not break the request */
    }
    out[part.slice(0, i).trim()] = v;
  }
  return out;
}

/** `expires`: end of the session (default one year; demo sandboxes end with their sandbox). */
export function createSession(userId: string, expires?: number): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_time, expires) VALUES (?, ?, ?, ?)').run(token, userId, now, expires ?? now + SESSION_DAYS * 86400_000);
  return token;
}

export function userForToken(token: string | undefined): string | null {
  if (!token || token.length > 200) return null;
  const row = db.prepare('SELECT user_id, expires FROM sessions WHERE token = ?').get(token) as { user_id: string; expires: number } | undefined;
  if (!row || row.expires < Date.now()) return null;
  return row.user_id;
}

export function destroySession(token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userFromRequest(req: IncomingMessage): string | null {
  return userForToken(parseCookies(req.headers.cookie).lit_session);
}

/** Session cookie: HttpOnly, SameSite=Lax, and Secure whenever the service is served over https. */
export function sessionCookie(token: string, secure = false, maxAgeSeconds = SESSION_DAYS * 86400): string {
  return `lit_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = false): string {
  return `lit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export const clearCookie = clearSessionCookie(false);

export function issueLoginCode(email: string): string {
  const code = String(randomInt(100000, 1000000));
  const now = Date.now();
  // a still-valid code keeps its failed-attempt count (re-requesting must not reset the brute-force budget)
  db.prepare(`INSERT INTO login_codes (email, code, expires, attempts) VALUES (?, ?, ?, 0)
              ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires = excluded.expires,
                attempts = CASE WHEN login_codes.expires > ? THEN login_codes.attempts ELSE 0 END`)
    .run(email.toLowerCase(), code, now + CODE_TTL_MS, now);
  return code;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyLoginCode(email: string, code: string): boolean {
  const e = email.toLowerCase();
  const row = db.prepare('SELECT code, expires, attempts FROM login_codes WHERE email = ?').get(e) as { code: string; expires: number; attempts: number } | undefined;
  if (!row || row.expires < Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) return false;
  db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').run(e);
  const ok = safeEqual(row.code, String(code).trim());
  if (ok) db.prepare('DELETE FROM login_codes WHERE email = ?').run(e);
  return ok;
}

// scrypt cost: N=2^15, r=8, p=1 (≈32 MiB). Hashes are stored as "scrypt$N$r$p$<hex>"; older rows (plain hex) used
// Node's defaults (N=2^14) and are upgraded on the next successful password check.
const SCRYPT = { N: 1 << 15, r: 8, p: 1 };
const MAX_PASSWORD = 512;

function derive(password: string, salt: string, N: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
}

export function setPassword(userId: string, password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${derive(password.slice(0, MAX_PASSWORD), salt, SCRYPT.N, SCRYPT.r, SCRYPT.p).toString('hex')}`;
  db.prepare(`INSERT INTO passwords (user_id, hash, salt) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash, salt=excluded.salt`).run(userId, hash, salt);
}

export function hasPassword(userId: string): boolean {
  return !!db.prepare('SELECT 1 FROM passwords WHERE user_id = ?').get(userId);
}

export function checkPassword(userId: string, password: string): boolean {
  const row = db.prepare('SELECT hash, salt FROM passwords WHERE user_id = ?').get(userId) as { hash: string; salt: string } | undefined;
  if (!row || password.length > MAX_PASSWORD) return false;
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([0-9a-f]+)$/.exec(row.hash);
  const [N, r, p, hex] = m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4]] : [16384, 8, 1, row.hash];
  if (N > 1 << 20 || r > 32 || p > 16) return false;
  const a = Buffer.from(hex, 'hex');
  const b = derive(password, row.salt, N, r, p);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (ok && !m) setPassword(userId, password); // upgrade legacy parameters
  return ok;
}
