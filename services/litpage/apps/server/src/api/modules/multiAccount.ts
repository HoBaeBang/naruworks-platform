// Several accounts in one browser ("Add another account", "Log out of all accounts", account switching in
// the workspace switcher) and new-device login emails.
//
// The browser keeps its other sessions in an HttpOnly cookie `nc_accounts` (comma-separated session tokens, like
// lit_session never readable by scripts). "Add another account" (beginAddAccount) puts the current session into it;
// the normal login flow (incl. 2-step verification) then sets lit_session to the new session. getAccounts lists every
// still-valid session's user and workspaces (never tokens); switchAccount swaps lit_session for one of them;
// logoutAllAccounts ends them all.
import { createHash } from 'node:crypto';
import type { SpaceRecord, SpaceViewRecord, UserRecord, UserRootRecord } from '@nc/shared/records.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { db, getRecord } from '../../db.ts';
import { destroySession, parseCookies, userForToken } from '../../auth.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder } from '../../records.ts';
import { mailTemplates, sendMail } from '../../mail.ts';
import { domainJoinMode, hasPendingDomainRequest, joinThroughAllowedDomain, spacesAllowingDomain } from '../../domainJoin.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';

type Handler = (ctx: Ctx, body: any) => any;

const COOKIE = 'nc_accounts';
const MAX_ACCOUNTS = 10;
const TOKEN_RE = /^[0-9a-f]{16,200}$/;

db.exec(`
CREATE TABLE IF NOT EXISTS session_devices (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_devices_user ON session_devices(user_id, created_time);
`);

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function storedTokens(ctx: Ctx): string[] {
  const raw = parseCookies(ctx.cookie)[COOKIE] ?? '';
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => TOKEN_RE.test(s)))].slice(0, MAX_ACCOUNTS);
}

function accountsCookie(tokens: string[], secure: boolean): string {
  const v = tokens.slice(0, MAX_ACCOUNTS).join(',');
  return v
    ? `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${secure ? '; Secure' : ''}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function sessionCookieFor(token: string, secure: boolean): string {
  return `lit_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${secure ? '; Secure' : ''}`;
}

/** Valid sessions of this browser: the current one first, then the remembered ones (one per user). */
function sessionsOf(ctx: Ctx): { token: string; userId: string }[] {
  const out: { token: string; userId: string }[] = [];
  const seen = new Set<string>();
  for (const token of [ctx.token ?? '', ...storedTokens(ctx)]) {
    if (!token) continue;
    const uid = userForToken(token);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push({ token, userId: uid });
  }
  return out;
}

function spacesOf(userId: string) {
  const root = getRecord<UserRootRecord>('user_root', userId);
  const out: { id: string; name: string; icon: string; domain: string; plan: string; memberCount: number }[] = [];
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (!sv || sv.alive === false || sv.parent_id !== userId) continue;
    const s = getRecord<SpaceRecord>('space', sv.space_id);
    if (!s || !isSpaceMember(s, userId)) continue;
    out.push({ id: s.id, name: s.name, icon: s.icon ?? '', domain: s.domain, plan: s.plan_type, memberCount: (s.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role !== 'none').length });
  }
  return out;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export const handlers: Record<string, Handler> = {
  /** Accounts signed in on this browser with their workspaces (switcher "Other accounts"). */
  getAccounts(ctx) {
    const uid = requireUser(ctx);
    const rm = new RecordMapBuilder(uid);
    const accounts = sessionsOf(ctx).map(({ userId }) => {
      const u = getRecord<UserRecord>('lit_user', userId);
      return { userId, name: u?.name ?? '', email: u?.email ?? '', photo: u?.profile_photo ?? '', current: userId === uid, spaces: spacesOf(userId) };
    });
    return { accounts, recordMap: rm.map };
  },

  /** "Add another account": remember the current session, then the client shows the login screen. */
  beginAddAccount(ctx) {
    requireUser(ctx);
    const tokens = [ctx.token!, ...storedTokens(ctx).filter((t) => t !== ctx.token && userForToken(t))];
    ctx.setCookie(accountsCookie(tokens, !!ctx.secure));
    return { ok: true };
  },

  /** Make another signed-in account (and optionally one of its workspaces) the active one. */
  switchAccount(ctx, { userId }) {
    requireUser(ctx);
    const target = sessionsOf(ctx).find((s) => s.userId === String(userId ?? ''));
    if (!target) throw new ApiError('This account is no longer signed in on this device.', 404);
    const others = sessionsOf(ctx).map((s) => s.token);
    ctx.setCookie(sessionCookieFor(target.token, !!ctx.secure));
    ctx.setCookie(accountsCookie(others, !!ctx.secure));
    return { userId: target.userId };
  },

  /** Log out of one remembered account (not the current one). */
  removeAccount(ctx, { userId }) {
    const uid = requireUser(ctx);
    if (userId === uid) throw new ApiError('Use “Log out” for the current account.');
    const keep: string[] = [];
    for (const s of sessionsOf(ctx)) {
      if (s.userId === userId) destroySession(s.token);
      else keep.push(s.token);
    }
    ctx.setCookie(accountsCookie(keep, !!ctx.secure));
    return { ok: true };
  },

  /** "Log out of all accounts" on this device. */
  logoutAllAccounts(ctx) {
    for (const s of sessionsOf(ctx)) destroySession(s.token);
    if (ctx.token) destroySession(ctx.token);
    ctx.setCookie(accountsCookie([], !!ctx.secure));
    ctx.setCookie(`lit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${ctx.secure ? '; Secure' : ''}`);
    return { ok: true };
  },

  /** "Join or create workspace" : workspaces whose Allowed email domains include my email's domain and
   *  let people join ("Join automatically") or ask to ("Request to join"); "No access" workspaces aren't listed. */
  getJoinableWorkspaces(ctx) {
    const uid = requireUser(ctx);
    const u = getRecord<UserRecord>('lit_user', uid);
    const list = u?.email ? spacesAllowingDomain(u.email).filter((s) => !isSpaceMember(s, uid) && domainJoinMode(s) !== 'none').slice(0, 20) : [];
    return {
      spaces: list.map((s) => ({
        id: s.id, name: s.name, icon: s.icon ?? '', domain: s.domain,
        memberCount: (s.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role !== 'none').length,
        joinMode: domainJoinMode(s) as 'auto' | 'request',
        requested: domainJoinMode(s) === 'request' && hasPendingDomainRequest(s, u!.email),
      })),
    };
  },

  /** Join through the allowed email domains, following the workspace's join mode : members join right
   *  away, "Request to join" files a member request admins approve, "No access" refuses. */
  joinWorkspace(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const u = getRecord<UserRecord>('lit_user', uid);
    const space = u?.email ? spacesAllowingDomain(u.email).find((s) => s.id === String(spaceId ?? '')) : undefined;
    if (!space || (!isSpaceMember(space, uid) && domainJoinMode(space) === 'none')) throw new ApiError('This workspace isn’t open to your email domain.', 403);
    if (!hit(`domain-join:${uid}`, 30, 60 * 60_000)) throw new RateLimitError();
    const result = joinThroughAllowedDomain(space, uid, u!.email);
    return { spaceId: space.id, domain: space.domain, requested: result === 'requested' };
  },

  /** Called once per app start: a session from a device (browser) this account hasn't used before → "New login" email. */
  noteSessionDevice(ctx) {
    const uid = requireUser(ctx);
    if (!ctx.token) return { isNew: false };
    const h = hashToken(ctx.token);
    if (db.prepare('SELECT 1 FROM session_devices WHERE token_hash = ?').get(h)) return { isNew: false };
    const ua = (ctx.userAgent ?? '').slice(0, 300);
    const known = db.prepare('SELECT user_agent FROM session_devices WHERE user_id = ? ORDER BY created_time DESC LIMIT 50').all(uid) as { user_agent: string | null }[];
    db.prepare('INSERT OR IGNORE INTO session_devices (token_hash, user_id, user_agent, ip, created_time) VALUES (?, ?, ?, ?, ?)').run(h, uid, ua, ctx.ip ?? null, Date.now());
    // the very first session of an account is the signup itself; later sessions from a new browser get an email
    const isNew = known.length > 0 && !known.some((k) => (k.user_agent ?? '') === ua);
    if (isNew) {
      const u = getRecord<UserRecord>('lit_user', uid);
      if (u?.email) sendMail({ to: u.email, toUserId: uid, kind: 'new_login', ...mailTemplates.newLogin({ time: Date.now(), ip: ctx.ip, device: deviceName(ua) }) });
    }
    return { isNew };
  },
};

function deviceName(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
