// /api/rpc/<name> handlers.
import { newId } from '@nc/shared/ids.ts';
import type { Transaction } from '@nc/shared/ops.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type {
  BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, SpaceViewRecord, Table, TeamRecord, UserRootRecord,
} from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { changesSince, childrenOf, currentLsn, db, findUserIdByEmail, getRecord, recordsInSpace } from '../db.ts';
import {
  checkPassword, clearSessionCookie, createSession, destroySession, devLoginCodesEnabled, hasPassword, issueLoginCode, sessionCookie, setPassword,
  verifyLoginCode,
} from '../auth.ts';
import { RecordMapBuilder, applyTransactions, blockRole, recordRole, TransactionError } from '../records.ts';
import { exemptIp, hit, RateLimitError, reset } from '../ratelimit.ts';
import { childBlocks } from '../tree.ts';
import { addMember, createUser, createWorkspace, saveRecord } from '../seed.ts';
import { quickFindSearch } from './modules/searchFilters.ts';
import { getSnapshot, listActivity, listSnapshots, takeSnapshot } from '../history.ts';
import { redactVersionData } from '../versionAccess.ts';
import { realtime } from '../realtime.ts';
import { sendLoginCodeEmail, sendWorkspaceInviteEmail } from '../notify.ts';
import { createLoginChallenge, listFactors, mfaEnabled } from '../mfa.ts';
import { audit, auditAccount } from '../audit.ts';
import { passwordProblem } from '../policy.ts';
import { autoJoinAllowedDomains } from '../domainJoin.ts';
import { retainBeforePurge } from '../retention.ts';
import { TreeCopier, assertCopyBudget, ownedCollectionsOf } from '../dbcopy.ts';
import { demoConfig, isDemoAccountEmail } from '../demo.ts';
import { sandboxOfUser } from '../demoSandbox.ts';

export interface Ctx {
  userId: string | null;
  token?: string;
  clientId?: string;
  /** client address (rate limits) */
  ip?: string;
  /** request arrived over https (Secure cookies) */
  secure?: boolean;
  setCookie(c: string): void;
  /** raw Cookie header (multi-account switching reads its own HttpOnly cookie) */
  cookie?: string;
  /** User-Agent (new-device login emails) */
  userAgent?: string;
  /** Origin header (same-origin checked by app.ts): the page's origin for passkeys (WebAuthn RP ID) */
  origin?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Handler = (ctx: Ctx, body: any) => any | Promise<any>;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MEMBER_ROLES = new Set(['owner', 'membership_admin', 'editor']);

function userSpaces(userId: string): { views: SpaceViewRecord[]; spaces: SpaceRecord[] } {
  const root = getRecord<UserRootRecord>('user_root', userId);
  // only this user's own space views (user_root.space_views is user-writable)
  const views = (root?.space_views ?? []).map((id) => getRecord<SpaceViewRecord>('space_view', id)).filter((v): v is SpaceViewRecord => !!v && v.alive !== false && v.parent_id === userId);
  const spaces = views.map((v) => getRecord<SpaceRecord>('space', v.space_id)).filter((s): s is SpaceRecord => !!s && s.permissions.some((p) => p.user_id === userId && p.role !== 'none'));
  return { views: views.filter((v) => spaces.some((s) => s.id === v.space_id)), spaces };
}

/** Collect a page subtree plus everything needed to render it (collections, views, rows, ancestors, users). */
function pageChunk(pageId: string, userId: string | null, rm: RecordMapBuilder) {
  const root = getRecord<BlockRecord>('block', pageId);
  if (!root) return;
  if (recordRole('block', root, userId) === 'none') return;
  const queue: BlockRecord[] = [root];
  const users = new Set<string>();
  const seen = new Set<string>();
  while (queue.length) {
    const b = queue.shift()!;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    rm.add('block', b);
    users.add(b.created_by_id);
    users.add(b.last_edited_by_id);
    const nestedPage = b.id !== pageId && (b.type === 'page' || b.type === 'collection_view_page');
    if (b.type === 'collection_view' || b.type === 'collection_view_page') addCollection(b, userId, rm, users);
    if (b.type === 'transclusion_reference') {
      const src = (b.format as any)?.transclusion_reference_pointer?.id;
      const srcBlock = src && getRecord<BlockRecord>('block', src);
      if (srcBlock) queue.push(srcBlock);
    }
    if (b.type === 'alias' || b.type === 'link_to_page') {
      const target = (b.format as any)?.alias_pointer?.id;
      const tb = target && getRecord<BlockRecord>('block', target);
      if (tb) rm.add('block', tb);
    }
    // mentioned pages (titles/icons render inline)
    for (const deco of Object.values(b.properties ?? {})) {
      for (const d of (deco as any[]) ?? []) {
        for (const a of d?.[1] ?? []) {
          if (a[0] === 'p') { const mb = getRecord<BlockRecord>('block', a[1]); if (mb) rm.add('block', mb); }
          if (a[0] === 'u') users.add(a[1]);
        }
      }
    }
    for (const id of b.discussions ?? []) {
      const d = getRecord('discussion', id) as any;
      if (d) {
        rm.add('discussion', d);
        for (const cid of d.comments ?? []) {
          const c = getRecord('comment', cid) as any;
          if (c) { rm.add('comment', c); users.add(c.created_by_id); }
        }
      }
    }
    if (nestedPage) continue;
    for (const c of childBlocks(b, { alive: false })) queue.push(c);
  }
  // ancestors for breadcrumbs / permissions
  let cur: BlockRecord | undefined = root;
  for (let i = 0; i < 50 && cur; i++) {
    if (cur.parent_table === 'block') {
      cur = getRecord<BlockRecord>('block', cur.parent_id);
      if (cur) rm.add('block', cur);
    } else if (cur.parent_table === 'collection') {
      const col = getRecord<CollectionRecord>('collection', cur.parent_id);
      if (col) {
        rm.add('collection', col);
        cur = getRecord<BlockRecord>('block', col.parent_id);
        if (cur) rm.add('block', cur);
      } else cur = undefined;
    } else if (cur.parent_table === 'team') {
      rm.add('team', getRecord<TeamRecord>('team', cur.parent_id));
      cur = undefined;
    } else cur = undefined;
  }
  rm.add('space', getRecord<SpaceRecord>('space', root.space_id));
  for (const u of users) if (u) rm.add('lit_user', getRecord('lit_user', u), 'reader');
}

function addCollection(b: BlockRecord, userId: string | null, rm: RecordMapBuilder, users: Set<string>) {
  // every data source the block shows : its collection, sources of its views (multiple data sources, linked
  // views), and all its views — dashboard widgets live under the block without being tabs (view_ids)
  const views = childrenOf<CollectionViewRecord>('collection_view', b.id).filter((v) => v.alive !== false);
  const sourceIds = new Set<string>();
  if (b.collection_id) sourceIds.add(b.collection_id);
  for (const v of views) {
    const pid = (v.format as any)?.collection_pointer?.id;
    if (typeof pid === 'string') sourceIds.add(pid);
  }
  const seen = new Set<string>();
  for (const cid of sourceIds) addCollectionRecords(getRecord<CollectionRecord>('collection', cid), rm, users, seen);
  for (const vid of b.view_ids ?? []) rm.add('collection_view', getRecord<CollectionViewRecord>('collection_view', vid));
  for (const v of views) if (!rm.has('collection_view', v.id)) rm.add('collection_view', v);
}

function addCollectionRecords(col: CollectionRecord | undefined, rm: RecordMapBuilder, users: Set<string>, seen: Set<string>) {
  if (col && !seen.has(col.id)) {
    seen.add(col.id);
    rm.add('collection', col);
    for (const tid of col.template_pages ?? []) rm.add('block', getRecord<BlockRecord>('block', tid));
    for (const row of childrenOf<BlockRecord>('block', col.id)) {
      if (row.parent_table !== 'collection' || !row.alive) continue;
      rm.add('block', row);
      users.add(row.created_by_id);
      users.add(row.last_edited_by_id);
      for (const [k, v] of Object.entries(row.properties ?? {})) {
        if (col.schema[k]?.type === 'person') for (const d of (v as any[]) ?? []) for (const a of d?.[1] ?? []) if (a[0] === 'u') users.add(a[1]);
        if (col.schema[k]?.type === 'relation') for (const d of (v as any[]) ?? []) for (const a of d?.[1] ?? []) if (a[0] === 'p') rm.add('block', getRecord<BlockRecord>('block', a[1]));
      }
    }
    // relation targets' collections (for rollups / relation titles)
    for (const prop of Object.values(col.schema)) {
      if (prop.type === 'relation' && prop.collection_id && !rm.has('collection', prop.collection_id)) {
        const target = getRecord<CollectionRecord>('collection', prop.collection_id);
        if (target) {
          rm.add('collection', target);
          for (const row of childrenOf<BlockRecord>('block', target.id)) if (row.alive && row.parent_table === 'collection') rm.add('block', row);
        }
      }
    }
  }
}

export const handlers: Record<string, Handler> = {
  // ---------- auth ----------
  checkSignInMethods(ctx, { email }) {
    if (!exemptIp(ctx.ip) && !hit(`login-options:ip:${ctx.ip}`, 120, 3600_000)) throw new RateLimitError();
    const id = email ? findUserIdByEmail(String(email)) : null;
    return { hasAccount: !!id, passwordSignIn: id ? hasPassword(id) : false, mustReverify: false };
  },
  sendSignInCode(ctx, { email }) {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e || e.length > 254 || !EMAIL_RE.test(e)) throw new ApiError('Please provide a valid email address.');
    // login codes: 5 per address per 15 minutes and 20 per day; 60 per client address per hour
    if (!exemptIp(ctx.ip) && !hit(`login-code:ip:${ctx.ip}`, 60, 3600_000)) throw new RateLimitError();
    if (!hit(`login-code:email:${e}`, 5, 15 * 60_000) || !hit(`login-code:email-day:${e}`, 20, 86_400_000)) {
      throw new RateLimitError('Too many login codes were requested for this email. Try again later.');
    }
    const code = issueLoginCode(e);
    sendLoginCodeEmail(e, code); // mail outbox (SMTP only when NC_SMTP_URL is set)
    const dev = devLoginCodesEnabled();
    if (dev) console.log(`[auth] login code for ${e}: ${code}`); // never logged unless dev login codes are on
    return { csrfState: newId(), ...(dev ? { devCode: code } : {}) };
  },
  signInWithEmail(ctx, { email, code, password }) {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e || e.length > 254) throw new ApiError('Please provide a valid email address.');
    // attempts: 10 per address and 100 per client address per hour (a code also locks after 5 wrong tries)
    const failKey = `login-fail:email:${e}`;
    const emailLimited = !isDemoAccountEmail(e);
    if ((emailLimited && !hit(failKey, 10, 3600_000)) || (!exemptIp(ctx.ip) && !hit(`login-fail:ip:${ctx.ip}`, 100, 3600_000))) {
      throw new RateLimitError('Too many login attempts. Try again later.');
    }
    let userId = findUserIdByEmail(e);
    if (password) {
      if (!userId || !checkPassword(userId, String(password))) throw new ApiError('Incorrect password.', 401);
    } else if (!verifyLoginCode(e, String(code ?? ''))) {
      throw new ApiError('Invalid or expired login code.', 401);
    }
    if (emailLimited) reset(failKey);
    let isNewUser = false;
    if (!userId) {
      userId = newId();
      createUser(userId, e);
      isNewUser = true;
      autoJoinAllowedDomains(userId, e); // Settings › General › Allowed email domains
    }
    // two-factor authentication: no session until loginWithMfa gets a valid code (Settings › Account)
    if (!isNewUser && mfaEnabled(userId)) {
      return { mfaRequired: true, mfaToken: createLoginChallenge(userId), factors: listFactors(userId).map((f) => ({ id: f.id, name: f.name })) };
    }
    const token = createSession(userId);
    ctx.setCookie(sessionCookie(token, !!ctx.secure));
    auditAccount('login', userId, { ip: ctx.ip, data: { authType: password ? 'password' : 'email' } });
    return { userId, isNewUser };
  },
  signOut(ctx) {
    if (ctx.userId) auditAccount('logout', ctx.userId, { ip: ctx.ip });
    destroySession(ctx.token);
    ctx.setCookie(clearSessionCookie(!!ctx.secure));
    return {};
  },
  changePassword(ctx, { password, currentPassword }) {
    const uid = requireUser(ctx);
    const problem = passwordProblem(String(password ?? ''));
    if (problem) throw new ApiError(problem);
    // changing an existing password needs the current one (a stolen session can't lock the owner out)
    const had = hasPassword(uid);
    if (had) {
      if (!hit(`pw-check:user:${uid}`, 10, 15 * 60_000)) throw new RateLimitError();
      if (!checkPassword(uid, String(currentPassword ?? ''))) throw new ApiError('Incorrect password.', 401);
    }
    setPassword(uid, String(password));
    auditAccount(had ? 'password_changed' : 'password_set', uid, { ip: ctx.ip });
    return {};
  },
  hasPassword(ctx) {
    return { hasPassword: hasPassword(requireUser(ctx)) };
  },

  // ---------- user & workspace ----------
  loadAccountData(ctx) {
    const uid = requireUser(ctx);
    const rm = new RecordMapBuilder(uid);
    rm.add('lit_user', getRecord('lit_user', uid), 'editor');
    rm.add('user_root', getRecord('user_root', uid), 'editor');
    rm.add('user_settings', getRecord('user_settings', uid), 'editor');
    const { views, spaces } = userSpaces(uid);
    for (const v of views) rm.add('space_view', v, 'editor');
    for (const s of spaces) {
      rm.add('space', s);
      for (const p of s.permissions) if (p.user_id) rm.add('lit_user', getRecord('lit_user', p.user_id), 'reader');
      const teams = recordsInSpace<TeamRecord>('team', s.id).filter((t) => t.alive !== false);
      for (const t of teams) rm.add('team', t);
      // sidebar trees: private, favorites, teamspace and workspace pages with their nested sub-pages
      const view = views.find((v) => v.space_id === s.id);
      const roots = [
        ...(view?.private_pages ?? []), ...(view?.bookmarked_pages ?? []), ...(s.pages ?? []),
        ...teams.filter((t) => view?.joined_teams?.includes(t.id)).flatMap((t) => t.team_pages ?? []),
      ];
      addPageTrees(roots, uid, rm);
    }
    const sandbox = sandboxOfUser(uid);
    return { recordMap: rm.map, lsn: currentLsn(), demoMode: { ...demoConfig(), ...(sandbox ? { sandbox: { createdTime: sandbox.created_time, expires: sandbox.expires } } : {}) } };
  },
  createWorkspace(ctx, { name, icon }) {
    const uid = requireUser(ctx);
    const { space } = createWorkspace(uid, String(name || 'My Workspace'), icon);
    const rm = new RecordMapBuilder(uid);
    return { spaceId: space.id, recordMap: rm.map };
  },
  listMyWorkspaces(ctx) {
    return handlers.loadAccountData(ctx, {});
  },
  inviteMembers(ctx, { spaceId, emails, role }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', spaceId);
    if (!space || !space.permissions.some((p) => p.user_id === uid && ['owner', 'membership_admin'].includes(p.role as string))) throw new ApiError('Only workspace admins can invite members.', 403);
    const r = String(role ?? 'editor');
    if (!MEMBER_ROLES.has(r) && !(r === 'restricted_member' && space.plan_type === 'enterprise')) throw new ApiError('Unknown role');
    // only owners create owners (same rule as setMemberRole)
    if (r === 'owner' && !space.permissions.some((p) => p.user_id === uid && (p.role as string) === 'owner')) throw new ApiError('Only workspace owners can add owners.', 403);
    const added: string[] = [];
    for (const raw of (Array.isArray(emails) ? emails : []).slice(0, 100)) {
      const email = String(raw).trim().toLowerCase();
      if (!email) continue;
      if (email.length > 254 || !EMAIL_RE.test(email)) throw new ApiError(`"${email}" is not a valid email address.`);
      let id = findUserIdByEmail(email);
      if (!id) { id = newId(); createUser(id, email); }
      // an invite never changes the role of someone who already is a member
      if (!space.permissions.some((p) => p.user_id === id && p.role !== 'none')) {
        addMember(space.id, id, r);
        sendWorkspaceInviteEmail(space.id, uid, id);
        audit('member_invited', { spaceId: space.id, actorId: uid, targetId: id, ip: ctx.ip, data: { email, newRole: r } });
      }
      added.push(id);
    }
    return { userIds: added };
  },

  // ---------- records ----------
  loadPage(ctx, { pageId }) {
    const rm = new RecordMapBuilder(ctx.userId);
    pageChunk(String(pageId), ctx.userId, rm);
    return { recordMap: rm.map, cursor: { stack: [] } };
  },
  loadPageCached(ctx, body) {
    return handlers.loadPage(ctx, { pageId: body?.page?.id ?? body.pageId });
  },
  fetchRecords(ctx, { requests }) {
    const rm = new RecordMapBuilder(ctx.userId);
    for (const r of (Array.isArray(requests) ? requests : []).slice(0, 2000)) {
      const table = r?.pointer?.table as Table;
      if (typeof table !== 'string' || typeof r.pointer?.id !== 'string') continue;
      const rec = getRecord(table, r.pointer.id);
      if (rec) rm.add(table, rec);
    }
    return { recordMap: rm.map };
  },
  getChangesSince(ctx, { lsn, spaceIds }) {
    const uid = requireUser(ctx);
    const allowed = userSpaces(uid).spaces.map((s) => s.id).filter((id) => !spaceIds || spaceIds.includes(id));
    const changes = changesSince(allowed, Number(lsn) || 0);
    const rm = new RecordMapBuilder(uid);
    for (const c of changes) rm.add(c.tbl, getRecord(c.tbl, c.id));
    return { recordMap: rm.map, lsn: changes.length ? changes[changes.length - 1].lsn : Number(lsn) || 0 };
  },
  applyChanges(ctx, { transactions }) {
    const uid = requireUser(ctx);
    let changes;
    try {
      if (!Array.isArray(transactions) || transactions.length > 500) throw new ApiError('Invalid transactions');
      if (transactions.reduce((n: number, t: any) => n + (Array.isArray(t?.operations) ? t.operations.length : 0), 0) > 20_000) throw new ApiError('Too many operations', 413);
      changes = applyTransactions(uid, transactions as Transaction[], ctx.clientId, { client: true });
    } catch (e) {
      if (e instanceof TransactionError) throw new ApiError(e.message, e.status);
      throw e;
    }
    // Echo authoritative values so the client can rebase its pending operations immediately.
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { recordMap: rm.map };
  },
  applyChangesFanout(ctx, body) {
    return handlers.applyChanges(ctx, body);
  },

  // ---------- search / navigation ----------
  searchWorkspace(ctx, body) {
    // Quick Find filters/sorts live in api/modules/searchFilters.ts (backward compatible: {query, spaceId, limit, filters.titleOnly/createdBy}).
    return quickFindSearch(requireUser(ctx), body ?? {});
  },
  markPageVisited(ctx, { block }) {
    const uid = requireUser(ctx);
    const pageId = block?.id;
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || blockRole(page.id, uid) === 'none') return {};
    const id = `${uid}:${pageId}`;
    const prev = getRecord('page_visit', id) as any;
    saveRecord('page_visit', {
      id, version: prev?.version ?? 0, parent_id: pageId, parent_table: 'block', user_id: uid, space_id: page.space_id,
      visited_at: Date.now(), total_visits: (prev?.total_visits ?? 0) + 1,
    });
    return {};
  },
  listRecentPages(ctx, { spaceId, limit }) {
    const uid = requireUser(ctx);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'page_visit' AND space_id = ? AND json_extract(data, '$.user_id') = ?
                             ORDER BY json_extract(data, '$.visited_at') DESC LIMIT ?`).all(String(spaceId ?? ''), uid, Math.min(Math.max(Number(limit) || 20, 1), 200)) as any[];
    const rm = new RecordMapBuilder(uid);
    const pages: { id: string; visitedAt: number }[] = [];
    for (const r of rows) {
      const v = JSON.parse(r.data);
      const page = getRecord<BlockRecord>('block', v.parent_id);
      if (!page || !page.alive || blockRole(page.id, uid) === 'none') continue;
      rm.add('block', page);
      addAncestors(page, rm);
      pages.push({ id: page.id, visitedAt: v.visited_at });
    }
    return { pages, recordMap: rm.map };
  },
  listBacklinks(ctx, { block }) {
    const uid = requireUser(ctx);
    const id = String(block?.id ?? '');
    if (!/^[\w-]{1,64}$/.test(id) || blockRole(id, uid) === 'none') return { backlinks: [], recordMap: {} };
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND alive = 1 AND data LIKE ? LIMIT 2000`).all(`%["p","${id}"%`) as any[]; // also ["p", id, spaceId] page links inserted via "[["
    const rm = new RecordMapBuilder(uid);
    const backlinks: any[] = [];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      if (blockRole(b.id, uid) === 'none') continue;
      rm.add('block', b);
      addAncestors(b, rm);
      backlinks.push({ block_id: b.id, mentioned_from: { type: 'block_id', block_id: b.id } });
    }
    return { backlinks, recordMap: rm.map };
  },
  listPageActivity(ctx, { pageId, limit }) {
    const uid = requireUser(ctx);
    if (blockRole(pageId, uid) === 'none') throw new ApiError('Not found', 404);
    const activities = listActivity(pageId, Math.min(Math.max(Number(limit) || 50, 1), 500));
    const rm = new RecordMapBuilder(uid);
    for (const a of activities) rm.add('lit_user', getRecord('lit_user', a.userId), 'reader');
    return { activities, recordMap: rm.map };
  },

  // ---------- page history ----------
  listPageVersions(ctx, { pageId }) {
    const uid = requireUser(ctx);
    // version history is for people who can edit the page ("Can edit" or more)
    const role = blockRole(String(pageId ?? ''), uid);
    if (role === 'none') throw new ApiError('Not found', 404);
    if (!roleAtLeast(role, 'read_and_write')) throw new ApiError('Not allowed', 403);
    takeSnapshotIfNone(pageId, uid);
    const snapshots = listSnapshots(pageId);
    const rm = new RecordMapBuilder(uid);
    for (const s of snapshots) for (const a of s.authorIds) rm.add('lit_user', getRecord('lit_user', a), 'reader');
    return { snapshots, recordMap: rm.map };
  },
  getPageVersion(ctx, { snapshotId }) {
    const uid = requireUser(ctx);
    const snap = getSnapshot(String(snapshotId ?? ''));
    const role = snap ? blockRole(snap.pageId, uid) : 'none';
    if (!snap || role === 'none') throw new ApiError('Not found', 404);
    if (!roleAtLeast(role, 'read_and_write')) throw new ApiError('Not allowed', 403);
    // getSnapshot returns only the page's own subtree; rows, values, properties and sub-pages hidden from this person
    // today stay out (versionAccess.ts)
    return { ...snap, data: redactVersionData(snap.pageId, snap.data, uid) };
  },
  restorePageVersion(ctx, { snapshotId }) {
    requireUser(ctx);
    // the rules of Version history › Restore (modules/pages.ts restoreVersion): edit access; values the restorer can't
    // edit, access rules, locks and sharing stay as they are
    const restore = handlers.restoreVersion;
    if (!restore) throw new ApiError('Not found', 404);
    return restore(ctx, { snapshotId, restoreDatabases: false });
  },

  // ---------- trash ----------
  getTrash(ctx, { spaceId, query }) {
    const uid = requireUser(ctx);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 0
                             AND json_extract(data, '$.type') IN ('page', 'collection_view_page') ORDER BY last_edited_time DESC LIMIT 500`).all(String(spaceId ?? '')) as any[];
    const rm = new RecordMapBuilder(uid);
    const pages: string[] = [];
    const q = String(query ?? '').toLowerCase();
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      // only top-most deleted pages (whose parent is alive or not a block)
      const parent = b.parent_table === 'block' ? getRecord<BlockRecord>('block', b.parent_id) : null;
      if (parent && parent.alive === false) continue;
      if (q && !toPlainText(b.properties?.title).toLowerCase().includes(q)) continue;
      // only pages the user can still access (having created a page once is not access to it)
      const role = blockRole(b.id, uid);
      if (role === 'none') continue;
      rm.add('block', b, role);
      addAncestors(b, rm);
      pages.push(b.id);
    }
    return { pages, recordMap: rm.map };
  },
  deleteBlocksPermanently(ctx, { blockIds }) {
    const uid = requireUser(ctx);
    for (const id of (Array.isArray(blockIds) ? blockIds : []).slice(0, 500).map(String)) {
      const b = getRecord<BlockRecord>('block', id);
      if (!b || b.alive) continue;
      const role = blockRole(id, uid);
      if (!roleAtLeast(role, 'editor') && !(roleAtLeast(role, 'read_and_write') && b.created_by_id === uid)) continue;
      // the block's own subtree (children pointing back at their parent), never ids that are merely listed in content
      const ids: string[] = [];
      const q: BlockRecord[] = [b];
      const seen = new Set<string>();
      while (q.length && ids.length < 50_000) {
        const cur = q.pop()!;
        if (seen.has(cur.id)) continue;
        seen.add(cur.id);
        ids.push(cur.id);
        for (const c of childBlocks(cur, { alive: false })) q.push(c);
      }
      if (b.type === 'page' || b.type === 'collection_view_page') audit('page.permanently_deleted', { spaceId: b.space_id, actorId: uid, targetId: b.id, ip: ctx.ip, data: { pageName: toPlainText(b.properties?.title).slice(0, 200) } });
      retainBeforePurge(b.space_id, b, ids, uid); // Security › Data retention: keep a copy for the retention window
      for (const bid of ids) {
        db.prepare("DELETE FROM records WHERE tbl = 'block' AND id = ?").run(bid);
        db.prepare('DELETE FROM search_index WHERE block_id = ?').run(bid);
      }
    }
    return {};
  },

  // ---------- duplication ----------
  duplicateBlock(ctx, { blockId, parentId, parentTable, afterId }) {
    const uid = requireUser(ctx);
    const src = getRecord<BlockRecord>('block', String(blockId ?? ''));
    if (!src || blockRole(src.id, uid) === 'none') throw new ApiError('Not found', 404);
    // dbcopy.ts TreeCopier : new ids for the whole tree, databases get their own data sources, views re-pointed
    // at the copies, rows/templates copied, references between copies re-pointed, comments and sharing left behind
    const copier = new TreeCopier(uid, src.space_id, { rows: true });
    const ops: any[] = [];
    const pTable = parentTable ?? src.parent_table;
    const pId = parentId ?? src.parent_id;
    let nid: string;
    try {
      nid = copier.block(src, pId, pTable, src.permissions && pTable !== 'block' ? { permissions: src.permissions } : {});
      assertCopyBudget(uid, copier.count);
    } catch (e) {
      if (e instanceof TransactionError) throw new ApiError(e.message, e.status);
      throw e;
    }
    for (const e of copier.finish().values()) ops.push({ pointer: { table: e.table, id: e.record.id, spaceId: src.space_id }, path: [], command: 'set', args: e.record });
    if (pTable === 'block') {
      ops.push({ pointer: { table: 'block', id: pId, spaceId: src.space_id }, path: ['content'], command: 'listAfter', args: { id: nid, after: afterId ?? blockId } });
    } else if (pTable === 'team') {
      ops.push({ pointer: { table: 'team', id: pId, spaceId: src.space_id }, path: ['team_pages'], command: 'listAfter', args: { id: nid, after: afterId ?? blockId } });
    } else if (pTable === 'space') {
      // private page: add to the user's space_view private list
      const sv = userSpaces(uid).views.find((v) => v.space_id === src.space_id);
      if (sv) {
        const isPrivate = sv.private_pages.includes(blockId);
        if (isPrivate) ops.push({ pointer: { table: 'space_view', id: sv.id, spaceId: src.space_id }, path: ['private_pages'], command: 'listAfter', args: { id: nid, after: blockId } });
        else ops.push({ pointer: { table: 'space', id: pId, spaceId: src.space_id }, path: ['pages'], command: 'listAfter', args: { id: nid, after: blockId } });
      }
    }
    const title = toPlainText(src.properties?.title);
    const top = ops.find((o) => o.pointer.id === nid && o.command === 'set');
    if (top && (src.type === 'page' || src.type === 'collection_view_page')) top.args.properties = { ...top.args.properties, title: [[`${title} (1)`]] };
    applyTransactions(uid, [{ id: newId(), spaceId: src.space_id, debug: { userAction: 'duplicateBlock' }, operations: ops }], ctx.clientId);
    return { blockId: nid };
  },

  // ---------- public pages ----------
  getSharedPageInfo(ctx, { blockId }) {
    const b = getRecord<BlockRecord>('block', String(blockId ?? ''));
    const role = b ? blockRole(b.id, ctx.userId) : 'none';
    if (!b || role === 'none') throw new ApiError('Not found', 404);
    const space = getRecord<SpaceRecord>('space', b.space_id);
    return { publicAccessRole: role, spaceName: space?.name, spaceId: b.space_id, betaEnabled: false };
  },

  // ---------- notifications ----------
  getNotifications(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND space_id = ? AND json_extract(data, '$.user_id') = ?
                             ORDER BY json_extract(data, '$.created_time') DESC LIMIT 200`).all(String(spaceId ?? ''), uid) as any[];
    const rm = new RecordMapBuilder(uid);
    const ids: string[] = [];
    for (const r of rows) {
      const n = JSON.parse(r.data);
      rm.add('notification', n, 'editor');
      if (n.navigable_block_id) { const b = getRecord<BlockRecord>('block', n.navigable_block_id); if (b) { rm.add('block', b); addAncestors(b, rm); } }
      if (n.actor_id) rm.add('lit_user', getRecord('lit_user', n.actor_id), 'reader');
      ids.push(n.id);
    }
    return { notificationIds: ids, recordMap: rm.map };
  },
  notifyMention(ctx, { userIds, blockId, type }) {
    const uid = requireUser(ctx);
    const b = getRecord<BlockRecord>('block', String(blockId ?? ''));
    // same rules as notifyMentions: the author can edit the block, the target is mentioned in it and can see it
    if (!b || b.alive === false || !roleAtLeast(blockRole(b.id, uid), 'read_and_write')) return {};
    const mentioned = new Set<string>();
    for (const v of Object.values(b.properties ?? {})) for (const d of (Array.isArray(v) ? v : []) as any[]) for (const a of (Array.isArray(d?.[1]) ? d[1] : [])) if (a?.[0] === 'u') mentioned.add(String(a[1]));
    for (const target of (Array.isArray(userIds) ? userIds : []).slice(0, 20).map(String)) {
      if (target === uid || !mentioned.has(target) || blockRole(b.id, target) === 'none') continue;
      const n = { id: newId(), version: 0, user_id: target, space_id: b.space_id, type: type === 'property_mention' ? 'property_mention' : 'mention', navigable_block_id: b.id, actor_id: uid, created_time: Date.now(), read: false, archived: false };
      saveRecord('notification', n);
      realtime.notifyUser(target, { type: 'records', records: [{ table: 'notification', id: n.id, version: n.version, value: n, role: 'editor' }] });
    }
    return {};
  },
};

/** Page-type descendants (sidebar outline) of the given roots, without page content. */
function addPageTrees(roots: string[], userId: string, rm: RecordMapBuilder, maxNodes = 3000) {
  const queue = [...roots];
  const seen = new Set<string>();
  while (queue.length && seen.size < maxNodes) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const b = getRecord<BlockRecord>('block', id);
    if (!b || !b.alive) continue;
    if (blockRole(b.id, userId) === 'none') continue;
    rm.add('block', b);
    if (b.type === 'collection_view_page' || b.type === 'collection_view') {
      const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
      if (col) rm.add('collection', col);
      for (const vid of b.view_ids ?? []) rm.add('collection_view', getRecord<CollectionViewRecord>('collection_view', vid));
      continue;
    }
    for (const child of childBlocks(b)) {
      if (child.type === 'page' || child.type === 'collection_view_page' || child.type === 'collection_view') queue.push(child.id);
    }
  }
}

function addAncestors(b: BlockRecord, rm: RecordMapBuilder) {
  let cur: BlockRecord | undefined = b;
  for (let i = 0; i < 30 && cur; i++) {
    if (cur.parent_table === 'block') {
      cur = getRecord<BlockRecord>('block', cur.parent_id);
      if (cur) rm.add('block', cur);
    } else if (cur.parent_table === 'collection') {
      const col = getRecord<CollectionRecord>('collection', cur.parent_id);
      if (!col) break;
      rm.add('collection', col);
      cur = getRecord<BlockRecord>('block', col.parent_id);
      if (cur) rm.add('block', cur);
    } else if (cur.parent_table === 'team') {
      rm.add('team', getRecord<TeamRecord>('team', cur.parent_id));
      break;
    } else break;
  }
}

function takeSnapshotIfNone(pageId: string, uid: string) {
  const has = db.prepare('SELECT 1 FROM snapshots WHERE page_id = ? LIMIT 1').get(pageId);
  if (!has) takeSnapshot(pageId, [uid]);
}
