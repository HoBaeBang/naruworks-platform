// NaruWorks: the only way to sign in. Keycloak (realm `naruworks`) OIDC authorization-code flow with PKCE.
// Browser redirects use the public issuer URL; the token exchange and key fetch use NC_OIDC_INTERNAL_URL
// (http://keycloak:8080/... inside Compose) because the public host is slow/unreachable from the container.
import { createHash, randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { newId } from '@nc/shared/ids.ts';
import type { UserRecord } from '@nc/shared/records.ts';
import { auditAccount } from './audit.ts';
import { clearSessionCookie, createSession, destroySession, parseCookies, sessionCookie, userForToken } from './auth.ts';
import { db, findUserIdByEmail, getRecord, putRecord } from './db.ts';
import { hit } from './ratelimit.ts';
import { createUser, createWorkspace } from './seed.ts';

const PENDING_COOKIE = 'lit_oidc';
const PENDING_SECONDS = 600;

export interface OidcConfig {
  issuer: string;
  internalBase: string;
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  role: string;
  idpHint: string;
  /** extra `aud` accepted on Bearer tokens (MCP clients); the web client id is always accepted */
  mcpAudience: string[];
}

/** null when any required setting is missing: sign-in is then impossible (fail closed). */
export function oidcConfig(env = process.env): OidcConfig | null {
  const issuer = env.NC_OIDC_ISSUER?.trim().replace(/\/+$/, '');
  const clientId = env.NC_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.NC_OIDC_CLIENT_SECRET;
  const publicUrl = env.NC_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (!issuer || !clientId || !clientSecret || !publicUrl) return null;
  return {
    issuer, clientId, clientSecret, publicUrl,
    internalBase: (env.NC_OIDC_INTERNAL_URL?.trim() || issuer).replace(/\/+$/, ''),
    role: env.NC_OIDC_REQUIRED_ROLE?.trim() || 'member',
    idpHint: env.NC_OIDC_IDP_HINT?.trim() ?? 'google',
    mcpAudience: (env.NC_OIDC_MCP_AUDIENCE ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

let keyResolver: JWTVerifyGetKey | undefined;
function keys(cfg: OidcConfig): JWTVerifyGetKey {
  keyResolver ??= createRemoteJWKSet(new URL(`${cfg.internalBase}/protocol/openid-connect/certs`));
  return keyResolver;
}
/** tests inject a local key set instead of fetching the realm's keys */
export function setKeyResolverForTests(resolver: JWTVerifyGetKey | undefined) {
  keyResolver = resolver;
}

function realmRoles(payload: JWTPayload): string[] {
  const roles = (payload as { realm_access?: { roles?: unknown } }).realm_access?.roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
}

const b64url = (b: Buffer) => b.toString('base64url');

/** Only same-site paths: never an absolute URL or `//host`. */
export function safeNext(next: string | undefined): string {
  // browsers drop tabs/newlines inside a URL (`/<tab>/evil.test` becomes `//evil.test`), so no control char, space or backslash at all
  if (!next || !next.startsWith('/') || /[\x00-\x20\x7f\\]/.test(next)) return '/';
  try {
    const u = new URL(next, 'http://same-site.invalid');
    return u.origin === 'http://same-site.invalid' ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

interface Pending { s: string; n: string; v: string; x: string; t?: number }
/** login attempts a browser may keep open at once; older cookies are expired when a new attempt starts (bounds Cookie header size) */
const MAX_PENDING = 3;

// one cookie per login attempt (named by its `state`): two overlapping attempts, e.g. a double redirect or a second tab,
// must not overwrite each other, or the returning attempt fails with "session expired"
const STATE_RE = /^[\w-]{16,64}$/;
const pendingName = (state: string) => `${PENDING_COOKIE}_${state}`;

function pendingCookie(state: string, value: string, secure: boolean, maxAge = PENDING_SECONDS): string {
  return `${pendingName(state)}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function readPending(c: Context, state: string | undefined): Pending | null {
  if (!state || !STATE_RE.test(state)) return null;
  const raw = parseCookies(c.req.header('cookie'))[pendingName(state)];
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString());
    return typeof p?.s === 'string' && typeof p?.n === 'string' && typeof p?.v === 'string' ? { s: p.s, n: p.n, v: p.v, x: safeNext(p.x), t: Number(p.t) || 0 } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- identity ↔ Litpage user
function userIdForSub(sub: string): string | null {
  return (db.prepare('SELECT user_id FROM idp_identities WHERE sub = ?').get(sub) as { user_id: string } | undefined)?.user_id ?? null;
}

/**
 * Keycloak `sub` → Litpage user. A first sign-in links an existing account with the same (verified) email, otherwise
 * creates the account with its own workspace. An account already linked to another `sub` is never taken over.
 */
export function resolveUser(sub: string, email: string, name: string): string | null {
  const linked = userIdForSub(sub);
  if (linked) return linked;
  let userId = findUserIdByEmail(email);
  if (userId) {
    if (db.prepare('SELECT 1 FROM idp_identities WHERE user_id = ?').get(userId)) return null;
  } else {
    userId = newId();
    const user = createUser(userId, email, name);
    putRecord('lit_user', { ...user, onboarding_completed: true });
    createWorkspace(userId, `${name}의 작업공간`);
  }
  db.prepare('INSERT INTO idp_identities (sub, user_id, created_time) VALUES (?, ?, ?)').run(sub, userId, Date.now());
  return userId;
}

// ---------------------------------------------------------------- Bearer tokens (MCP)
/** A Keycloak access token for a member who has signed in before; null otherwise. Never creates accounts. */
export async function userFromBearer(header: string | undefined, cfg = oidcConfig()): Promise<string | null> {
  const token = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/.exec(header?.trim() ?? '')?.[1];
  if (!cfg || !token) return null;
  try {
    const { payload } = await jwtVerify(token, keys(cfg), { issuer: cfg.issuer, audience: [cfg.clientId, ...cfg.mcpAudience] });
    if (!payload.sub || !realmRoles(payload).includes(cfg.role)) return null;
    const userId = userIdForSub(payload.sub);
    return userId && getRecord<UserRecord>('lit_user', userId) ? userId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- routes
export function registerOidcRoutes(app: Hono, deps: { isHttps: (c: Context) => boolean; clientIp: (c: Context) => string }) {
  app.get('/auth/login', (c) => {
    const cfg = oidcConfig();
    if (!cfg) return c.text('Sign-in is not configured.', 503);
    if (!hit(`oidc-login:ip:${deps.clientIp(c)}`, 60, 600_000)) return c.text('Too many sign-in attempts. Try again later.', 429);
    const pending: Pending = { s: b64url(randomBytes(24)), n: b64url(randomBytes(24)), v: b64url(randomBytes(48)), x: safeNext(c.req.query('next')), t: Date.now() };
    // expire every attempt cookie beyond the newest MAX_PENDING - 1 (plus malformed ones), so repeated /auth/login cannot grow the Cookie header
    const old = Object.keys(parseCookies(c.req.header('cookie'))).filter((k) => k.startsWith(`${PENDING_COOKIE}_`)).map((k) => k.slice(PENDING_COOKIE.length + 1))
      .map((state) => ({ state, t: readPending(c, state)?.t ?? -1 })).sort((a, b) => b.t - a.t);
    for (const { state } of old.slice(MAX_PENDING - 1)) c.header('Set-Cookie', pendingCookie(state, '', deps.isHttps(c), 0), { append: true });
    const url = new URL(`${cfg.issuer}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: cfg.clientId, redirect_uri: `${cfg.publicUrl}/auth/callback`, scope: 'openid email profile',
      state: pending.s, nonce: pending.n, code_challenge: b64url(createHash('sha256').update(pending.v).digest()), code_challenge_method: 'S256',
      ...(cfg.idpHint ? { kc_idp_hint: cfg.idpHint } : {}),
    }).toString();
    c.header('Set-Cookie', pendingCookie(pending.s, b64url(Buffer.from(JSON.stringify(pending))), deps.isHttps(c)), { append: true });
    c.header('Cache-Control', 'no-store');
    return c.redirect(url.toString(), 302);
  });

  // Data for the NaruWorks bar at the top of the app: who is signed in and where the NaruWorks home is.
  app.get('/auth/nav', (c) => {
    c.header('Cache-Control', 'no-store');
    const userId = userForToken(parseCookies(c.req.header('cookie')).lit_session);
    const user = userId ? getRecord<UserRecord>('lit_user', userId) : null;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return c.json({ home: process.env.NC_HOME_URL?.trim() || null, name: user.name, email: user.email });
  });

  app.get('/auth/callback', async (c) => {
    const cfg = oidcConfig();
    if (!cfg) return c.text('Sign-in is not configured.', 503);
    const secure = deps.isHttps(c);
    const state = c.req.query('state');
    const pending = readPending(c, state);
    if (state && STATE_RE.test(state)) c.header('Set-Cookie', pendingCookie(state, '', secure, 0)); // a login attempt is single use
    c.header('Cache-Control', 'no-store');
    if (!hit(`oidc-callback:ip:${deps.clientIp(c)}`, 60, 3600_000)) return c.text('Too many sign-in attempts. Try again later.', 429);
    if (!pending || state !== pending.s) return c.text('The sign-in session expired. Please try again.', 400);
    const code = c.req.query('code');
    if (c.req.query('error') || !code) return c.text('Sign-in was cancelled or failed.', 400);
    try {
      const res = await fetch(`${cfg.internalBase}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: `${cfg.publicUrl}/auth/callback`,
          client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: pending.v,
        }),
      });
      if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
      const tokens = (await res.json()) as { id_token?: string; access_token?: string };
      if (!tokens.id_token || !tokens.access_token) throw new Error('token response without id_token/access_token');
      const id = (await jwtVerify(tokens.id_token, keys(cfg), { issuer: cfg.issuer, audience: cfg.clientId })).payload;
      if (id.nonce !== pending.n) throw new Error('nonce mismatch');
      // roles travel in the access token (signed by the same realm key); only members may enter
      const access = (await jwtVerify(tokens.access_token, keys(cfg), { issuer: cfg.issuer })).payload;
      const email = typeof id.email === 'string' ? id.email.trim().toLowerCase() : '';
      if (!id.sub || id.sub !== access.sub || !email || id.email_verified !== true || !realmRoles(access).includes(cfg.role)) {
        return c.text('NaruWorks 회원만 이용할 수 있습니다. 승인된 회원인지 확인해 주세요.', 403);
      }
      const name = (typeof id.name === 'string' && id.name.trim()) || (typeof id.preferred_username === 'string' && id.preferred_username) || email.split('@')[0];
      const userId = resolveUser(id.sub, email, name);
      if (!userId) return c.text('이 계정은 다른 로그인 정보와 이미 연결되어 있습니다.', 403);
      c.header('Set-Cookie', sessionCookie(createSession(userId), secure), { append: true });
      auditAccount('login', userId, { ip: deps.clientIp(c), data: { authType: 'oidc' } });
      return c.redirect(pending.x, 302);
    } catch (e) {
      console.error('[oidc] callback failed', e);
      return c.text('로그인 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.', 502);
    }
  });

  // shortcut: GET logout (a cross-site page can sign a user out, nothing more), POST + CSRF token if that ever matters
  app.get('/auth/logout', (c) => {
    destroySession(parseCookies(c.req.header('cookie')).lit_session);
    c.header('Set-Cookie', clearSessionCookie(deps.isHttps(c)));
    c.header('Cache-Control', 'no-store');
    const cfg = oidcConfig();
    if (!cfg) return c.redirect('/', 302);
    const url = new URL(`${cfg.issuer}/protocol/openid-connect/logout`);
    url.search = new URLSearchParams({ client_id: cfg.clientId, post_logout_redirect_uri: `${cfg.publicUrl}/` }).toString();
    return c.redirect(url.toString(), 302);
  });
}
