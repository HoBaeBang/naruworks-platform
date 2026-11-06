// Passkeys (Settings › Account › Passkeys and the login page's "Passkey" button): WebAuthn registration
// and authentication verified here without a library —
// - registration: clientDataJSON (type webauthn.create, our challenge, our origin), CBOR attestation object
// (attestation statements aren't checked: we ask for attestation 'none' like most relying parties), authenticator
// data (RP ID hash, user present, attested credential), COSE public key → JWK (ES256 / RS256 / EdDSA);
// - authentication: clientDataJSON (webauthn.get), authenticator data (RP ID hash of the credential's RP, user
// present, signature counter must grow), signature over authData ‖ (clientDataJSON).
// Credentials are discoverable (resident keys), so the login page can sign in without an email. The RP ID is the
// host name of the page (WebAuthn needs a domain — `localhost` works, a bare IP such as 127.0.0.1 doesn't).
// Challenges are single-use and expire after 5 minutes.
import { constants, createHash, createPublicKey, randomBytes, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { newId } from '@nc/shared/ids.ts';
import { db } from './db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_time INTEGER NOT NULL,
  last_used_time INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

/** JSON Web Key of a credential public key (EC P-256, RSA or Ed25519). */
type JsonWebKey = Record<string, string>;

const CHALLENGE_TTL = 5 * 60_000;
export const MAX_PASSKEYS = 10;

export class PasskeyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const fromB64url = (s: unknown) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s) || s.length > 200_000) throw new PasskeyError('Malformed passkey response');
  return Buffer.from(s, 'base64url');
};
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

// ---------------------------------------------------------------------------------------------- CBOR (RFC 8949 subset)

/** Decode one CBOR item at `offset`; returns the value and the offset after it. Maps decode to Map. */
export function cborDecodeAt(buf: Uint8Array, offset = 0): { value: unknown; end: number } {
  const r = { pos: offset };
  const value = cborItem(buf, r, 0);
  return { value, end: r.pos };
}

function cborItem(b: Uint8Array, r: { pos: number }, depth: number): unknown {
  if (depth > 16) throw new PasskeyError('CBOR nesting too deep');
  if (r.pos >= b.length) throw new PasskeyError('Truncated CBOR');
  const ib = b[r.pos++];
  const major = ib >> 5;
  const info = ib & 31;
  const need = (n: number) => { if (r.pos + n > b.length) throw new PasskeyError('Truncated CBOR'); };
  const len = (): number => {
    if (info < 24) return info;
    if (info === 24) { need(1); return b[r.pos++]; }
    if (info === 25) { need(2); const v = (b[r.pos] << 8) | b[r.pos + 1]; r.pos += 2; return v; }
    if (info === 26) { need(4); const v = ((b[r.pos] << 24) >>> 0) + (b[r.pos + 1] << 16) + (b[r.pos + 2] << 8) + b[r.pos + 3]; r.pos += 4; return v; }
    if (info === 27) {
      need(8);
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[r.pos + i]);
      r.pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new PasskeyError('CBOR integer too large');
      return Number(v);
    }
    throw new PasskeyError('Unsupported CBOR encoding');
  };
  switch (major) {
    case 0: return len();
    case 1: return -1 - len();
    case 2: { const n = len(); need(n); const v = b.slice(r.pos, r.pos + n); r.pos += n; return v; }
    case 3: { const n = len(); need(n); const v = Buffer.from(b.slice(r.pos, r.pos + n)).toString('utf8'); r.pos += n; return v; }
    case 4: {
      const n = len();
      if (n > 1000) throw new PasskeyError('CBOR array too large');
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(cborItem(b, r, depth + 1));
      return out;
    }
    case 5: {
      const n = len();
      if (n > 1000) throw new PasskeyError('CBOR map too large');
      const m = new Map<unknown, unknown>();
      for (let i = 0; i < n; i++) {
        const k = cborItem(b, r, depth + 1);
        m.set(k, cborItem(b, r, depth + 1));
      }
      return m;
    }
    case 6: len(); return cborItem(b, r, depth + 1); // tag: ignore
    default:
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return undefined;
      throw new PasskeyError('Unsupported CBOR value');
  }
}

// ---------------------------------------------------------------------------------------------- authenticator data

export interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
  credential?: { id: Buffer; publicKey: Map<unknown, unknown> };
}

export function parseAuthData(a: Buffer): AuthData {
  if (a.length < 37) throw new PasskeyError('Malformed authenticator data');
  const flags = a[32];
  const out: AuthData = { rpIdHash: a.subarray(0, 32), flags, userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04), signCount: a.readUInt32BE(33) };
  if (flags & 0x40) {
    if (a.length < 55) throw new PasskeyError('Malformed attested credential data');
    const idLen = a.readUInt16BE(53);
    if (idLen < 16 || idLen > 1023 || a.length < 55 + idLen) throw new PasskeyError('Malformed credential id');
    const id = a.subarray(55, 55 + idLen);
    const { value } = cborDecodeAt(a, 55 + idLen);
    if (!(value instanceof Map)) throw new PasskeyError('Malformed credential public key');
    out.credential = { id: Buffer.from(id), publicKey: value };
  }
  return out;
}

/** COSE_Key → JWK + COSE algorithm (ES256 -7, RS256 -257, EdDSA -8). */
export function coseToJwk(k: Map<unknown, unknown>): { jwk: JsonWebKey; alg: number } {
  const kty = k.get(1);
  const alg = k.get(3);
  const bytes = (v: unknown) => { if (!(v instanceof Uint8Array)) throw new PasskeyError('Malformed public key'); return b64url(v); };
  if (kty === 2 && alg === -7 && k.get(-1) === 1) return { jwk: { kty: 'EC', crv: 'P-256', x: bytes(k.get(-2)), y: bytes(k.get(-3)) }, alg: -7 };
  if (kty === 3 && alg === -257) return { jwk: { kty: 'RSA', n: bytes(k.get(-1)), e: bytes(k.get(-2)) }, alg: -257 };
  if (kty === 1 && alg === -8 && k.get(-1) === 6) return { jwk: { kty: 'OKP', crv: 'Ed25519', x: bytes(k.get(-2)) }, alg: -8 };
  throw new PasskeyError('This passkey uses an unsupported key type.');
}

function keyOf(jwk: JsonWebKey): KeyObject {
  try {
    return createPublicKey({ key: jwk as any, format: 'jwk' });
  } catch {
    throw new PasskeyError('Malformed public key');
  }
}

export function verifySignature(alg: number, jwk: JsonWebKey, data: Buffer, sig: Buffer): boolean {
  const key = keyOf(jwk);
  try {
    if (alg === -7) return cryptoVerify('sha256', data, { key, dsaEncoding: 'der' }, sig);
    if (alg === -257) return cryptoVerify('sha256', data, { key, padding: constants.RSA_PKCS1_PADDING }, sig);
    if (alg === -8) return cryptoVerify(null, data, key, sig);
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------- relying party

/** RP ID + origin from the page's origin (Origin header of the API call). */
export function relyingParty(origin: string | undefined): { rpId: string; origin: string } {
  let u: URL;
  try {
    u = new URL(String(origin ?? ''));
  } catch {
    throw new PasskeyError('Passkeys need a browser.', 400);
  }
  const host = u.hostname;
  // WebAuthn RP IDs are domains: IP literals can't hold passkeys
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) throw new PasskeyError('Passkeys need a domain name (for example localhost) — they can’t be used on an IP address.', 400);
  if (u.protocol !== 'https:' && host !== 'localhost' && !host.endsWith('.localhost')) throw new PasskeyError('Passkeys need a secure (https) connection.', 400);
  return { rpId: host, origin: u.origin };
}

function newChallenge(kind: 'register' | 'login', userId: string | null, rp: { rpId: string; origin: string }) {
  const id = newId();
  const challenge = b64url(randomBytes(32));
  db.prepare('DELETE FROM passkey_challenges WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO passkey_challenges (id, user_id, kind, challenge, rp_id, origin, expires) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, kind, challenge, rp.rpId, rp.origin, Date.now() + CHALLENGE_TTL);
  return { id, challenge };
}

function takeChallenge(id: unknown, kind: 'register' | 'login', userId: string | null) {
  const row = db.prepare('SELECT * FROM passkey_challenges WHERE id = ?').get(String(id ?? '')) as any;
  if (row) db.prepare('DELETE FROM passkey_challenges WHERE id = ?').run(row.id); // single use
  if (!row || row.kind !== kind || row.expires < Date.now() || (userId !== null && row.user_id !== userId)) throw new PasskeyError('This passkey request expired. Try again.', 400);
  return row as { challenge: string; rp_id: string; origin: string; user_id: string | null };
}

function checkClientData(raw: Buffer, type: string, ch: { challenge: string; origin: string }) {
  let cd: any;
  try {
    cd = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new PasskeyError('Malformed passkey response');
  }
  if (cd?.type !== type) throw new PasskeyError('Unexpected passkey response');
  if (cd.challenge !== ch.challenge) throw new PasskeyError('This passkey request expired. Try again.');
  if (cd.origin !== ch.origin) throw new PasskeyError('The passkey was created for a different site.');
  if (cd.crossOrigin === true) throw new PasskeyError('Unexpected passkey response');
}

export interface PasskeyInfo { id: string; name: string; createdTime: number; lastUsedTime: number | null }

export function listPasskeys(userId: string): PasskeyInfo[] {
  return (db.prepare('SELECT id, name, created_time, last_used_time FROM passkeys WHERE user_id = ? ORDER BY created_time').all(userId) as any[])
    .map((r) => ({ id: r.id, name: r.name, createdTime: r.created_time, lastUsedTime: r.last_used_time ?? null }));
}

/** navigator.credentials.create options for a signed-in user. */
export function registrationOptions(user: { id: string; email: string; name?: string }, originHeader: string | undefined) {
  const rp = relyingParty(originHeader);
  if (listPasskeys(user.id).length >= MAX_PASSKEYS) throw new PasskeyError(`You can have up to ${MAX_PASSKEYS} passkeys.`);
  const { id, challenge } = newChallenge('register', user.id, rp);
  const existing = db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id) as { id: string; transports: string | null }[];
  return {
    challengeId: id,
    publicKey: {
      challenge,
      rp: { name: 'Litpage', id: rp.rpId },
      user: { id: b64url(Buffer.from(user.id, 'utf8')), name: user.email, displayName: user.name || user.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
      timeout: CHALLENGE_TTL,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      excludeCredentials: existing.map((c) => ({ type: 'public-key', id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    },
  };
}

export interface RegistrationResponse {
  id?: unknown;
  rawId?: unknown;
  type?: unknown;
  response?: { clientDataJSON?: unknown; attestationObject?: unknown; transports?: unknown };
}

/** Verify navigator.credentials.create output and store the passkey. */
export function verifyRegistration(userId: string, challengeId: unknown, cred: RegistrationResponse, name: string): PasskeyInfo {
  const ch = takeChallenge(challengeId, 'register', userId);
  if (cred?.type !== 'public-key') throw new PasskeyError('Unexpected passkey response');
  checkClientData(fromB64url(cred.response?.clientDataJSON), 'webauthn.create', ch);
  const att = cborDecodeAt(fromB64url(cred.response?.attestationObject)).value;
  if (!(att instanceof Map) || !(att.get('authData') instanceof Uint8Array)) throw new PasskeyError('Malformed attestation');
  const ad = parseAuthData(Buffer.from(att.get('authData') as Uint8Array));
  if (!ad.rpIdHash.equals(sha256(ch.rp_id))) throw new PasskeyError('The passkey was created for a different site.');
  if (!ad.userPresent) throw new PasskeyError('The passkey needs your confirmation on the device.');
  if (!ad.credential) throw new PasskeyError('Malformed attestation');
  const credId = b64url(ad.credential.id);
  if (typeof cred.rawId === 'string' && cred.rawId !== credId) throw new PasskeyError('Malformed passkey response');
  const { jwk, alg } = coseToJwk(ad.credential.publicKey);
  keyOf(jwk); // a valid key (point on the curve, etc.)
  if (db.prepare('SELECT 1 FROM passkeys WHERE id = ?').get(credId)) throw new PasskeyError('This passkey is already registered.');
  const transports = Array.isArray(cred.response?.transports) ? (cred.response!.transports as unknown[]).filter((x) => typeof x === 'string').slice(0, 6) : null;
  const now = Date.now();
  const label = String(name ?? '').trim().slice(0, 60) || 'Passkey';
  db.prepare('INSERT INTO passkeys (id, user_id, name, rp_id, public_key, alg, sign_count, transports, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(credId, userId, label, ch.rp_id, JSON.stringify(jwk), alg, ad.signCount, transports ? JSON.stringify(transports) : null, now);
  return { id: credId, name: label, createdTime: now, lastUsedTime: null };
}

/** navigator.credentials.get options for the login page (discoverable credentials: no allow list). */
export function loginOptions(originHeader: string | undefined) {
  const rp = relyingParty(originHeader);
  const { id, challenge } = newChallenge('login', null, rp);
  return { challengeId: id, publicKey: { challenge, rpId: rp.rpId, timeout: CHALLENGE_TTL, userVerification: 'preferred', allowCredentials: [] } };
}

export interface AssertionResponse {
  id?: unknown;
  rawId?: unknown;
  type?: unknown;
  response?: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown; userHandle?: unknown };
}

/** Verify navigator.credentials.get output; returns the signed-in user id. */
export function verifyAssertion(challengeId: unknown, cred: AssertionResponse): { userId: string; passkeyId: string } {
  const ch = takeChallenge(challengeId, 'login', null);
  if (cred?.type !== 'public-key' || typeof cred.id !== 'string') throw new PasskeyError('Unexpected passkey response');
  const row = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(cred.id) as any;
  if (!row) throw new PasskeyError('This passkey isn’t registered to a Litpage account.', 401);
  const clientData = fromB64url(cred.response?.clientDataJSON);
  checkClientData(clientData, 'webauthn.get', ch);
  if (row.rp_id !== ch.rp_id) throw new PasskeyError('The passkey was created for a different site.', 401);
  const authData = fromB64url(cred.response?.authenticatorData);
  const ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(sha256(row.rp_id))) throw new PasskeyError('The passkey was created for a different site.', 401);
  if (!ad.userPresent) throw new PasskeyError('The passkey needs your confirmation on the device.', 401);
  if (cred.response?.userHandle) {
    const handle = fromB64url(cred.response.userHandle).toString('utf8');
    if (handle !== row.user_id) throw new PasskeyError('This passkey belongs to another account.', 401);
  }
  const ok = verifySignature(row.alg, JSON.parse(row.public_key), Buffer.concat([authData, sha256(clientData)]), fromB64url(cred.response?.signature));
  if (!ok) throw new PasskeyError('Passkey sign-in failed. Try again.', 401);
  // a counter that doesn't grow means a cloned authenticator (counters of 0 = authenticator doesn't count)
  if ((ad.signCount !== 0 || row.sign_count !== 0) && ad.signCount <= row.sign_count) throw new PasskeyError('This passkey can’t be used. Remove it and add it again.', 401);
  db.prepare('UPDATE passkeys SET sign_count = ?, last_used_time = ? WHERE id = ?').run(ad.signCount, Date.now(), row.id);
  return { userId: row.user_id, passkeyId: row.id };
}

export function renamePasskey(userId: string, id: unknown, name: unknown) {
  const label = String(name ?? '').trim().slice(0, 60);
  if (!label) throw new PasskeyError('Give the passkey a name.');
  const r = db.prepare('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?').run(label, String(id ?? ''), userId);
  if (!Number(r.changes)) throw new PasskeyError('Passkey not found', 404);
}

export function deletePasskey(userId: string, id: unknown) {
  const r = db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(String(id ?? ''), userId);
  if (!Number(r.changes)) throw new PasskeyError('Passkey not found', 404);
}

export function deleteAllPasskeys(userId: string) {
  db.prepare('DELETE FROM passkeys WHERE user_id = ?').run(userId);
}
