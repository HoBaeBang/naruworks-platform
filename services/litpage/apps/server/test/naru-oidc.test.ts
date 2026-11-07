// NaruWorks sign-in: the Keycloak OIDC flow (oidc.ts) is the only way to get a session. Temporary SQLite workspace;
// the realm's token endpoint is a fake fetch and its keys are a local key set.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, createLocalJWKSet, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-oidc-test-'));
const ISS = 'https://idp.test/realms/naruworks';
Object.assign(process.env, {
  NC_OIDC_ISSUER: ISS, NC_OIDC_INTERNAL_URL: 'http://keycloak:8080/realms/naruworks', NC_OIDC_CLIENT_ID: 'litpage',
  NC_OIDC_CLIENT_SECRET: 'test-secret', NC_PUBLIC_URL: 'https://litpage.test',
});

let app: typeof import('../src/app.ts').app;
let oidc: typeof import('../src/oidc.ts');
let dbm: typeof import('../src/db.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let privateKey: CryptoKey;

const sign = (claims: Record<string, unknown>, o: { aud?: string; key?: CryptoKey } = {}) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISS).setAudience(o.aud ?? 'litpage')
    .setIssuedAt().setExpirationTime('5m').sign(o.key ?? privateKey);

beforeAll(async () => {
  ({ app } = await import('../src/app.ts'));
  oidc = await import('../src/oidc.ts');
  dbm = await import('../src/db.ts');
  H = (await import('../src/api/handlers.ts')).handlers;
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  oidc.setKeyResolverForTests(createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] }));
});
afterEach(() => vi.unstubAllGlobals());

interface Login { sub?: string; email?: string; verified?: boolean; roles?: string[]; nonce?: string; name?: string }

/** /auth/login, then /auth/callback with the fake realm answering the code exchange. */
async function signIn(l: Login = {}, next = '/') {
  const r1 = await app.request(`/auth/login?next=${encodeURIComponent(next)}`);
  const loc = new URL(r1.headers.get('location')!);
  const cookie = r1.headers.getSetCookie()[0].split(';')[0];
  let tokenRequest: { url: string; body: URLSearchParams } | undefined;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    tokenRequest = { url, body: new URLSearchParams(init.body as URLSearchParams) };
    const sub = l.sub ?? 'sub-1';
    return Response.json({
      id_token: await sign({ sub, email: l.email ?? 'a@naru.test', email_verified: l.verified ?? true, name: l.name ?? 'Alice', nonce: l.nonce ?? loc.searchParams.get('nonce') }),
      access_token: await sign({ sub, realm_access: { roles: l.roles ?? ['member'] } }, { aud: 'account' }),
    });
  });
  const res = await app.request(`/auth/callback?state=${loc.searchParams.get('state')}&code=abc`, { headers: { cookie } });
  return { res, loc, tokenRequest, cookie, session: res.headers.getSetCookie().find((c) => c.startsWith('lit_session=') && !c.startsWith('lit_session=;')) };
}
const sessionCount = () => (dbm.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

describe('GET /auth/login', () => {
  it('redirects to Keycloak with PKCE and the Google hint, without showing a Litpage page', async () => {
    const res = await app.request('/auth/login');
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get('location')!);
    expect(u.origin + u.pathname).toBe(`${ISS}/protocol/openid-connect/auth`);
    expect(u.searchParams.get('client_id')).toBe('litpage');
    expect(u.searchParams.get('redirect_uri')).toBe('https://litpage.test/auth/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('kc_idp_hint')).toBe('google');
    expect(res.headers.get('set-cookie')).toMatch(/^lit_oidc_[\w-]+=.*HttpOnly/);
  });

  it('keeps two overlapping login attempts apart (each has its own cookie)', async () => {
    const a = await app.request('/auth/login');
    const b = await app.request('/auth/login');
    const ca = a.headers.getSetCookie()[0].split(';')[0];
    const cb = b.headers.getSetCookie()[0].split(';')[0];
    expect(ca.split('=')[0]).not.toBe(cb.split('=')[0]);
    // the browser holds both cookies; the first attempt returns after the second was started and is still found
    const res = await app.request(`/auth/callback?state=${new URL(a.headers.get('location')!).searchParams.get('state')}&code=x`, { headers: { cookie: `${ca}; ${cb}` } });
    expect(res.status).not.toBe(400);
  });

  it('sends visitors without a session to the NaruWorks home when it is configured', async () => {
    process.env.NC_HOME_URL = 'https://app.naru.test/';
    try {
      const res = await app.request('/auth/home');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://app.naru.test/');
    } finally {
      delete process.env.NC_HOME_URL;
    }
    expect(new URL((await app.request('/auth/home')).headers.get('location')!, 'http://x').pathname).toBe('/auth/login');
  });

  it('keeps only same-site return paths', () => {
    expect(oidc.safeNext('/p/abc?x=1')).toBe('/p/abc?x=1');
    for (const bad of ['//evil.test', 'https://evil.test', '/\\evil.test', 'javascript:1', '', undefined, '/\t/evil.test', '/\n/evil.test', '/\r/evil.test', ' //evil.test', '/ /evil.test', '/\u0000/evil.test', '/\u007f/evil.test']) {
      expect(oidc.safeNext(bad as any), JSON.stringify(bad)).toBe('/');
    }
  });

  it('refuses to sign anyone in when the realm settings are missing', async () => {
    const saved = process.env.NC_OIDC_CLIENT_SECRET;
    delete process.env.NC_OIDC_CLIENT_SECRET;
    expect((await app.request('/auth/login')).status).toBe(503);
    process.env.NC_OIDC_CLIENT_SECRET = saved;
  });
});

describe('GET /auth/callback', () => {
  it('signs a member in: personal workspace, 7-day session, token exchange on the internal address', async () => {
    const { res, tokenRequest, session } = await signIn({}, '/docs');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/docs');
    expect(tokenRequest!.url).toBe('http://keycloak:8080/realms/naruworks/protocol/openid-connect/token');
    expect(tokenRequest!.body.get('code_verifier')).toBeTruthy();
    expect(tokenRequest!.body.get('client_secret')).toBe('test-secret');
    const token = /^lit_session=([^;]+)/.exec(session!)![1];
    const row = dbm.db.prepare('SELECT user_id, expires FROM sessions WHERE token = ?').get(token) as { user_id: string; expires: number };
    expect(row.expires - Date.now()).toBeGreaterThan(6.9 * 86400_000);
    expect(row.expires - Date.now()).toBeLessThan(7.1 * 86400_000);
    expect(dbm.getRecord<any>('lit_user', row.user_id)).toMatchObject({ email: 'a@naru.test', onboarding_completed: true });
    const root = dbm.getRecord<any>('user_root', row.user_id);
    expect(root.space_views).toHaveLength(1); // one personal workspace
    // the same Keycloak user comes back to the same account without a second workspace
    const again = await signIn({});
    expect(dbm.getRecord<any>('user_root', row.user_id).space_views).toHaveLength(1);
    const token2 = /^lit_session=([^;]+)/.exec(again.session!)![1];
    expect((dbm.db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token2) as any).user_id).toBe(row.user_id);
  });

  it('gives every member a workspace of their own', async () => {
    await signIn({ sub: 'sub-a', email: 'a2@naru.test', name: 'A2' });
    await signIn({ sub: 'sub-b', email: 'b2@naru.test', name: 'B2' });
    const a = dbm.findUserIdByEmail('a2@naru.test')!;
    const b = dbm.findUserIdByEmail('b2@naru.test')!;
    expect(a).not.toBe(b);
    const spaceOf = (u: string) => dbm.getRecord<any>('user_root', u).space_views.map((id: string) => dbm.getRecord<any>('space_view', id).space_id);
    expect(spaceOf(a).filter((s: string) => spaceOf(b).includes(s))).toEqual([]);
  });

  it('turns away users without the member role and creates nothing', async () => {
    const before = sessionCount();
    const { res, session } = await signIn({ sub: 'sub-x', email: 'x@naru.test', roles: ['offline_access'] });
    expect(res.status).toBe(403);
    expect(session).toBeUndefined();
    expect(sessionCount()).toBe(before);
    expect(dbm.findUserIdByEmail('x@naru.test')).toBeNull();
  });

  it('turns away unverified emails', async () => {
    const { res, session } = await signIn({ sub: 'sub-y', email: 'y@naru.test', verified: false });
    expect(res.status).toBe(403);
    expect(session).toBeUndefined();
  });

  it('rejects a replayed or foreign login: wrong state, wrong nonce, no pending login', async () => {
    const r1 = await app.request('/auth/login');
    const cookie = r1.headers.getSetCookie()[0].split(';')[0];
    expect((await app.request('/auth/callback?state=nope&code=abc', { headers: { cookie } })).status).toBe(400);
    expect((await app.request('/auth/callback?state=nope&code=abc')).status).toBe(400);
    const { res, session } = await signIn({ nonce: 'someone-elses' });
    expect(res.status).toBe(502);
    expect(session).toBeUndefined();
  });

  it('does not hand an account that is linked to another Keycloak user to a new one with the same email', async () => {
    await signIn({ sub: 'sub-owner', email: 'shared@naru.test' });
    const { res, session } = await signIn({ sub: 'sub-other', email: 'shared@naru.test' });
    expect(res.status).toBe(403);
    expect(session).toBeUndefined();
  });

  it('links an existing account that has the same verified email', async () => {
    const id = 'preexisting-user';
    (await import('../src/seed.ts')).createUser(id, 'old@naru.test', 'Old');
    const { res } = await signIn({ sub: 'sub-old', email: 'old@naru.test' });
    expect(res.status).toBe(302);
    expect((dbm.db.prepare('SELECT user_id FROM idp_identities WHERE sub = ?').get('sub-old') as any).user_id).toBe(id);
  });
});

describe('/auth/logout', () => {
  it('ends the session and leaves through Keycloak', async () => {
    const { session } = await signIn({ sub: 'sub-out', email: 'out@naru.test' });
    const cookie = session!.split(';')[0];
    const res = await app.request('/auth/logout', { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(`${ISS}/protocol/openid-connect/logout`);
    expect(dbm.db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(cookie.slice('lit_session='.length))).toBeUndefined();
  });
});

describe('removed sign-in paths', () => {
  it('answers 410 for login codes, passwords, second factors and passkeys', async () => {
    const status = async (name: string, body: any = {}) => {
      try { await H[name]({ userId: null, setCookie: () => {} }, body); return 200; } catch (e: any) { return e.status; }
    };
    for (const name of ['sendSignInCode', 'signInWithEmail', 'checkSignInMethods', 'changePassword', 'loginWithMfa', 'passkeyLoginOptions', 'loginWithPasskey']) {
      expect(await status(name, { email: 'a@naru.test', code: '123456', password: 'x' }), name).toBe(410);
    }
  });
});

describe('Bearer tokens (MCP)', () => {
  const bearer = async (claims: Record<string, unknown>, o: { aud?: string; key?: CryptoKey } = {}) => `Bearer ${await sign(claims, o)}`;

  it('accepts a Keycloak token of a member who has signed in before', async () => {
    await signIn({ sub: 'sub-mcp', email: 'mcp@naru.test' });
    const id = await oidc.userFromBearer(await bearer({ sub: 'sub-mcp', realm_access: { roles: ['member'] } }));
    expect(id).toBe(dbm.findUserIdByEmail('mcp@naru.test'));
  });

  it('rejects unknown users, missing role, wrong audience, foreign keys and malformed headers', async () => {
    await signIn({ sub: 'sub-mcp2', email: 'mcp2@naru.test' });
    const roles = { realm_access: { roles: ['member'] } };
    expect(await oidc.userFromBearer(await bearer({ sub: 'never-logged-in', ...roles }))).toBeNull();
    expect(await oidc.userFromBearer(await bearer({ sub: 'sub-mcp2', realm_access: { roles: [] } }))).toBeNull();
    expect(await oidc.userFromBearer(await bearer({ sub: 'sub-mcp2', ...roles }, { aud: 'other-client' }))).toBeNull();
    const other = await generateKeyPair('RS256');
    expect(await oidc.userFromBearer(await bearer({ sub: 'sub-mcp2', ...roles }, { key: other.privateKey }))).toBeNull();
    expect(await oidc.userFromBearer('Bearer lp_pat_abcdefghijklmnopqrstuvwx')).toBeNull();
    expect(await oidc.userFromBearer(undefined)).toBeNull();
  });
});
