// Two-factor authentication (Settings › Account › Two-factor authentication; login step).
// Authenticator apps (TOTP, RFC 6238: HMAC-SHA1, 30-second steps, 6 digits, ±1 step of clock drift, a step is accepted
// once per factor) and one-time backup codes (6, shown once at setup, stored as hashes). "Text me a code" (SMS)
// needs a paid SMS provider and is not offered. A password is required before 2FA can be turned on; once on, a
// verification code is asked after the password/login code on every new login (signInWithEmail → loginWithMfa).
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { newId } from '@nc/shared/ids.ts';
import { db } from './db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS mfa_factors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  last_step INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mfa_factors_user ON mfa_factors(user_id);
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  used_time INTEGER,
  PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE IF NOT EXISTS mfa_pending (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_time INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
`);

export const MAX_AUTHENTICATORS = 2;
export const BACKUP_CODE_COUNT = 6;
const STEP_SECONDS = 30;
const DIGITS = 6;
const PENDING_TTL_MS = 30 * 60_000;
const CHALLENGE_TTL_MS = 10 * 60_000;
export const MAX_CHALLENGE_ATTEMPTS = 5;

// ---------------------------------------------------------------------------------------------- base32 / TOTP

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP value for a counter (RFC 6238 uses the 30-second step as the counter). */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totp(secretB32: string, now = Date.now()): string {
  return hotp(base32Decode(secretB32), totpStep(now));
}

function eq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Step that `code` matches within ±1 step, newer than `afterStep` (replay protection), or null. */
export function matchTotp(secretB32: string, code: string, afterStep = 0, now = Date.now()): number | null {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const cur = totpStep(now);
  for (const s of [cur, cur - 1, cur + 1]) {
    if (s <= afterStep) continue;
    if (eq(hotp(secret, s), c)) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'Litpage'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------------------------------------- factors

export interface MfaFactor { id: string; kind: 'totp'; name: string; createdTime: number }

const q = {
  factors: db.prepare('SELECT id, kind, name, secret, created_time, last_step FROM mfa_factors WHERE user_id = ? ORDER BY created_time'),
  factor: db.prepare('SELECT id, kind, name, secret, created_time, last_step FROM mfa_factors WHERE user_id = ? AND id = ?'),
  insertFactor: db.prepare('INSERT INTO mfa_factors (id, user_id, kind, name, secret, created_time, last_step) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  setStep: db.prepare('UPDATE mfa_factors SET last_step = ? WHERE id = ? AND last_step < ?'),
  rename: db.prepare('UPDATE mfa_factors SET name = ? WHERE user_id = ? AND id = ?'),
  deleteFactor: db.prepare('DELETE FROM mfa_factors WHERE user_id = ? AND id = ?'),
  deleteFactors: db.prepare('DELETE FROM mfa_factors WHERE user_id = ?'),
  insertPending: db.prepare('INSERT INTO mfa_pending (id, user_id, secret, created_time) VALUES (?, ?, ?, ?)'),
  pending: db.prepare('SELECT secret, created_time FROM mfa_pending WHERE id = ? AND user_id = ?'),
  deletePending: db.prepare('DELETE FROM mfa_pending WHERE id = ?'),
  prunePending: db.prepare('DELETE FROM mfa_pending WHERE created_time < ?'),
  codes: db.prepare('SELECT code_hash, used_time FROM mfa_backup_codes WHERE user_id = ?'),
  insertCode: db.prepare('INSERT OR IGNORE INTO mfa_backup_codes (user_id, code_hash, created_time) VALUES (?, ?, ?)'),
  useCode: db.prepare('UPDATE mfa_backup_codes SET used_time = ? WHERE user_id = ? AND code_hash = ? AND used_time IS NULL'),
  deleteCodes: db.prepare('DELETE FROM mfa_backup_codes WHERE user_id = ?'),
  insertChallenge: db.prepare('INSERT INTO mfa_challenges (token_hash, user_id, expires, attempts) VALUES (?, ?, ?, 0)'),
  challenge: db.prepare('SELECT user_id, expires, attempts FROM mfa_challenges WHERE token_hash = ?'),
  bumpChallenge: db.prepare('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = ?'),
  deleteChallenge: db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?'),
  pruneChallenges: db.prepare('DELETE FROM mfa_challenges WHERE expires < ?'),
};

export function listFactors(userId: string): MfaFactor[] {
  return (q.factors.all(userId) as any[]).map((r) => ({ id: r.id, kind: 'totp', name: r.name, createdTime: r.created_time }));
}

export function mfaEnabled(userId: string): boolean {
  return listFactors(userId).length > 0;
}

export class MfaError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Step 1 of "Code from authenticator": a fresh secret the user scans (QR) or types. Kept server-side until verified. */
export function startTotpEnrollment(userId: string, account: string): { enrollmentId: string; secret: string; uri: string } {
  if (listFactors(userId).length >= MAX_AUTHENTICATORS) throw new MfaError('2 of 2 authenticators are set up');
  q.prunePending.run(Date.now() - PENDING_TTL_MS);
  const secret = base32Encode(randomBytes(20));
  const id = newId();
  q.insertPending.run(id, userId, secret, Date.now());
  return { enrollmentId: id, secret, uri: otpauthUri(secret, account) };
}

function checkName(userId: string, name: string, exceptId?: string): string {
  const n = String(name ?? '').trim();
  if (!n) throw new MfaError('Give the authenticator a name.');
  if (n.length > 60 || /[<>]/.test(n)) throw new MfaError('That authenticator name cannot be used.');
  if (listFactors(userId).some((f) => f.id !== exceptId && f.name.toLowerCase() === n.toLowerCase())) throw new MfaError('That authenticator name is already in use.');
  return n;
}

/** Step 2: name + first code. Returns the backup codes when this turned 2FA on (shown once). */
export function completeTotpEnrollment(userId: string, enrollmentId: string, name: string, code: string): { factor: MfaFactor; backupCodes: string[] | null } {
  const row = q.pending.get(String(enrollmentId ?? ''), userId) as { secret: string; created_time: number } | undefined;
  if (!row || row.created_time < Date.now() - PENDING_TTL_MS) throw new MfaError('This setup has expired. Start again.');
  const n = checkName(userId, name);
  if (listFactors(userId).length >= MAX_AUTHENTICATORS) throw new MfaError('2 of 2 authenticators are set up');
  const step = matchTotp(row.secret, code);
  if (step === null) throw new MfaError('That code was not accepted. Enter it again.');
  const first = !mfaEnabled(userId);
  const id = newId();
  const now = Date.now();
  q.insertFactor.run(id, userId, 'totp', n, row.secret, now, step);
  q.deletePending.run(String(enrollmentId));
  const backupCodes = first ? regenerateBackupCodes(userId) : null;
  return { factor: { id, kind: 'totp', name: n, createdTime: now }, backupCodes };
}

export function renameFactor(userId: string, factorId: string, name: string) {
  if (!q.factor.get(userId, String(factorId ?? ''))) throw new MfaError('Authenticator not found', 404);
  q.rename.run(checkName(userId, name, factorId), userId, factorId);
}

/** Delete one authenticator; deleting the last one turns 2FA off (backup codes go too). Returns whether 2FA is still on. */
export function deleteFactor(userId: string, factorId: string): boolean {
  if (!q.factor.get(userId, String(factorId ?? ''))) throw new MfaError('Authenticator not found', 404);
  q.deleteFactor.run(userId, factorId);
  if (!mfaEnabled(userId)) {
    q.deleteCodes.run(userId);
    return false;
  }
  return true;
}

export function disableMfa(userId: string) {
  q.deleteFactors.run(userId);
  q.deleteCodes.run(userId);
}

function hashCode(code: string): string {
  return createHash('sha256').update(String(code).toLowerCase().replace(/[\s-]/g, '')).digest('hex');
}

/** New set of one-time backup codes (the previous ones stop working). Format: xxxx-xxxx (base36). */
export function regenerateBackupCodes(userId: string): string[] {
  q.deleteCodes.run(userId);
  const codes: string[] = [];
  const now = Date.now();
  while (codes.length < BACKUP_CODE_COUNT) {
    const raw = Array.from({ length: 8 }, () => '0123456789abcdefghijkmnpqrstuvwxyz'[randomInt(34)]).join('');
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    if (codes.includes(code)) continue;
    codes.push(code);
    q.insertCode.run(userId, hashCode(code), now);
  }
  return codes;
}

export function backupCodesRemaining(userId: string): number {
  return (q.codes.all(userId) as { used_time: number | null }[]).filter((r) => r.used_time === null).length;
}

/**
 * Check a second factor: a current authenticator code (any of the user's authenticators, once per step) or an unused
 * backup code (consumed). Returns which method matched, or null.
 */
export function verifySecondFactor(userId: string, code: string, method: 'totp' | 'backup' | 'any' = 'any'): 'totp' | 'backup' | null {
  const c = String(code ?? '').trim();
  if (!c || c.length > 40) return null;
  if (method !== 'backup' && /^\d{6}$/.test(c.replace(/\s/g, ''))) {
    for (const f of q.factors.all(userId) as any[]) {
      const step = matchTotp(f.secret, c, f.last_step);
      if (step !== null) {
        const res = q.setStep.run(step, f.id, step);
        if (Number(res.changes ?? 0) > 0) return 'totp';
      }
    }
  }
  if (method !== 'totp') {
    const res = q.useCode.run(Date.now(), userId, hashCode(c));
    if (Number(res.changes ?? 0) > 0) return 'backup';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- login challenge

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** After the first factor succeeded: an opaque token the client sends back with the verification code. */
export function createLoginChallenge(userId: string): string {
  q.pruneChallenges.run(Date.now());
  const token = randomBytes(32).toString('hex');
  q.insertChallenge.run(tokenHash(token), userId, Date.now() + CHALLENGE_TTL_MS);
  return token;
}

/** Resolve a login challenge with a code. Throws MfaError (401 wrong code / 429 too many tries / 400 expired). */
export function completeLoginChallenge(token: string, code: string, method: 'totp' | 'backup' | 'any' = 'any'): { userId: string; method: 'totp' | 'backup' } {
  const h = tokenHash(String(token ?? ''));
  const row = q.challenge.get(h) as { user_id: string; expires: number; attempts: number } | undefined;
  if (!row || row.expires < Date.now()) throw new MfaError('Your login session expired. Please log in again.', 400);
  if (row.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    q.deleteChallenge.run(h);
    throw new MfaError('Too many attempts. Please log in again.', 429);
  }
  q.bumpChallenge.run(h);
  const used = verifySecondFactor(row.user_id, code, method);
  if (!used) {
    throw new MfaError(method === 'backup' ? 'That backup code was not accepted. Try it again or use another code.' : 'That code was not accepted. Enter it again.', 401);
  }
  q.deleteChallenge.run(h);
  return { userId: row.user_id, method: used };
}
