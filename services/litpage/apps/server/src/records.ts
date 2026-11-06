// Record access with permission resolution and transaction application.
import { applyOperation, type Transaction } from '@nc/shared/ops.ts';
import { effectiveRole, isSpaceAdmin, isSpaceMember, type PermissionLookup } from '@nc/shared/permissions.ts';
import type {
  BaseRecord, BlockRecord, CollectionRecord, RecordMap, Role, SpaceRecord, SpaceViewRecord, Table, TeamRecord, UserRootRecord,
} from '@nc/shared/records.ts';
import { db, getRecord, putRecord, tx } from './db.ts';
import { indexBlock } from './search.ts';
import { realtime } from './realtime.ts';
import { recordActivity, maybeSnapshot } from './history.ts';
import { TxGuard, prepareOp } from './authz.ts';
import { collectionRole, propertyThreadVisible, redactDatabaseRecord } from './propaccess.ts';
import { agentRecordRole, agentRoleFor } from '@nc/shared/agents.ts';
import { DEMO_VISIBLE_USER_IDS, isDemoMode } from './demo.ts';

export const lookup: PermissionLookup = {
  block: (id) => getRecord<BlockRecord>('block', id),
  space: (id) => getRecord<SpaceRecord>('space', id),
  team: (id) => getRecord<TeamRecord>('team', id),
  collection: (id) => getRecord<CollectionRecord>('collection', id),
};

export function blockRole(blockId: string, userId: string | null): Role {
  return effectiveRole(lookup, blockId, userId);
}

/** Role a user has on an arbitrary record (used for recordMap entries and write checks). */
export function recordRole(table: Table, rec: BaseRecord | undefined, userId: string | null): Role {
  if (!rec) return 'none';
  const r = rec as any;
  switch (table) {
    case 'block':
      return blockRole(rec.id, userId);
    case 'collection':
      // also "Can view" for people who reach some of its rows only (page-level access rules)
      return collectionRole(r, userId);
    case 'collection_view':
      return r.parent_id ? blockRole(r.parent_id, userId) : 'none';
    case 'discussion': {
      const role = r.parent_id ? blockRole(r.parent_id, userId) : 'none';
      // a thread on a database property value only reaches people who can see that value
      return role !== 'none' && r.property_id && !propertyThreadVisible(r, userId) ? 'none' : role;
    }
    case 'comment': {
      const d = getRecord('discussion', r.parent_id) as any;
      const role = d ? blockRole(d.parent_id, userId) : 'none';
      return role !== 'none' && d.property_id && !propertyThreadVisible(d, userId) ? 'none' : role;
    }
    case 'space': {
      const sp = rec as SpaceRecord;
      if (!userId) return 'none';
      if (isSpaceAdmin(sp, userId)) return 'editor';
      return isSpaceMember(sp, userId) ? 'read_and_write' : 'none';
    }
    case 'team': {
      const t = rec as TeamRecord;
      const sp = getRecord<SpaceRecord>('space', t.space_id);
      if (!userId || !isSpaceMember(sp, userId)) return 'none';
      const admin = isSpaceAdmin(sp, userId);
      const inTeam = !!t.membership?.some((m) => m.user_id === userId);
      // private teamspaces are invisible to workspace members outside them
      if (t.settings?.type === 'private' && !inTeam && !admin) return 'none';
      return t.membership?.some((m) => m.user_id === userId && m.role === 'owner') || admin ? 'editor' : 'read_and_write';
    }
    case 'space_view':
      return r.parent_id === userId ? 'editor' : 'none';
    case 'lit_user':
      if (rec.id === userId) return 'editor';
      // public demo: visitors only see the people of their own workspace
      if (userId && isDemoMode()) return new UserVisibility(userId).canSeeUser(rec.id) ? 'reader' : 'none';
      return userId ? 'reader' : 'none';
    case 'user_root':
    case 'user_settings':
      return rec.id === userId ? 'editor' : 'none';
    case 'notification':
      return r.user_id === userId ? 'editor' : 'none';
    case 'page_visit':
    case 'follow':
      // which pages someone visits / follows is theirs only
      return r.user_id === userId ? 'editor' : 'none';
    case 'automation': {
      // database automations are visible to everyone who can open the database (editing is checked by the API)
      const c = r.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', r.parent_id) : undefined;
      return c?.parent_id ? blockRole(c.parent_id, userId) : 'none';
    }
    case 'workflow':
      // Custom Agents: the person's sharing level on the agent (Full access / Can edit / Can view and interact)
      return agentRecordRole(agentRoleFor(rec as any, getRecord<SpaceRecord>('space', r.space_id), userId));
    default:
      return 'none';
  }
}

/** Workspaces `userId` is a member of (through their own space views). */
export function memberSpaceIds(userId: string | null): string[] {
  if (!userId) return [];
  const root = getRecord<UserRootRecord>('user_root', userId);
  const out: string[] = [];
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (!sv || sv.alive === false || sv.parent_id !== userId) continue;
    if (isSpaceMember(getRecord<SpaceRecord>('space', sv.space_id), userId)) out.push(sv.space_id);
  }
  return out;
}

/**
 * Who may see another user's email: the user themself, people sharing a workspace with them, and members of a
 * workspace where they were invited as a guest (share menus, Settings › Guests). Everyone else — anonymous visitors
 * of public pages, guests, people from other workspaces — gets the name and photo only.
 */
export class UserVisibility {
  private viewer: string | null;
  private spaces: string[] | null = null;
  private coMembers: Set<string> | null = null;
  private cache = new Map<string, boolean>();
  constructor(viewer: string | null) {
    this.viewer = viewer;
  }
  canSeeEmail(userId: string): boolean {
    if (!this.viewer) return false;
    if (userId === this.viewer) return true;
    const hit = this.cache.get(userId);
    if (hit !== undefined) return hit;
    if (!this.spaces) {
      this.spaces = memberSpaceIds(this.viewer);
      this.coMembers = new Set();
      for (const sid of this.spaces) {
        for (const p of getRecord<SpaceRecord>('space', sid)?.permissions ?? []) if (p.user_id && p.role !== 'none') this.coMembers.add(p.user_id);
      }
    }
    let ok = this.coMembers!.has(userId);
    if (!ok && this.spaces.length && /^[\w-]{1,64}$/.test(userId)) {
      const row = db.prepare(`SELECT 1 AS hit FROM records WHERE tbl = 'block' AND space_id IN (${this.spaces.map(() => '?').join(',')}) AND data LIKE ? LIMIT 1`)
        .get(...this.spaces, `%"user_id":"${userId}"%`);
      ok = !!row;
    }
    this.cache.set(userId, ok);
    return ok;
  }
  /** Public demo: whether this viewer may see the user at all (themself, workspace members, the template author). */
  canSeeUser(userId: string): boolean {
    return DEMO_VISIBLE_USER_IDS.has(userId) || this.canSeeEmail(userId);
  }
  /** The record as this viewer may see it. */
  user<T extends BaseRecord>(rec: T): T {
    if (!(rec as any).email || this.canSeeEmail(rec.id)) return rec;
    const { email: _e, ...rest } = rec as any;
    return rest as T;
  }
}

export class RecordMapBuilder {
  map: RecordMap = { __version__: 3 };
  private userId: string | null;
  private users: UserVisibility;
  constructor(userId: string | null) {
    this.userId = userId;
    this.users = new UserVisibility(userId);
  }
  add(table: Table, rec: BaseRecord | undefined, role?: Role) {
    if (!rec) return this;
    const r = role ?? recordRole(table, rec, this.userId);
    if (r === 'none' && table !== 'lit_user') return this;
    if (table === 'lit_user' && isDemoMode() && !this.users.canSeeUser(rec.id)) return this;
    // property access: restricted database values / properties are left out
    const value = table === 'lit_user' ? this.users.user(rec) : redactDatabaseRecord(table, rec, this.userId, r);
    const bucket = ((this.map as any)[table] ??= {});
    bucket[rec.id] = { spaceId: (rec as any).space_id, value: { value, role: r } };
    return this;
  }
  has(table: Table, id: string) {
    return !!(this.map as any)[table]?.[id];
  }
}

export class TransactionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Write authorization lives in authz.ts (TxGuard): every op is checked against the in-call state and records
// created by the call are validated (parent, workspace, pointers) before anything is persisted.

export interface AppliedChange {
  table: Table;
  record: BaseRecord;
  spaceId: string | null;
}

/** Apply client transactions atomically: permission-check every op, bump versions, persist, broadcast. */
const txSeen = db.prepare('SELECT 1 AS hit FROM applied_tx WHERE id = ?');
const txMark = db.prepare('INSERT OR IGNORE INTO applied_tx (id, at) VALUES (?, ?)');
const txPrune = db.prepare('DELETE FROM applied_tx WHERE at < ?');
let lastPrune = 0;

/** What a committed applyTransactions call changed: the new records and their values before the call. */
export interface CommitInfo {
  userId: string;
  changes: AppliedChange[];
  /** "table:id" → stored value before this call (undefined for created records) */
  prev: Map<string, BaseRecord | undefined>;
  transactions: Transaction[];
  /** server-side origin of the write ('automation', 'recurring_template' …) — automations ignore their own writes */
  source?: string;
}
const commitHooks: ((info: CommitInfo) => void)[] = [];

/** Run `fn` after every committed applyTransactions call (reminders, notifications, automations). A failing hook is
 * logged and never undoes or fails the write. */
export function onCommit(fn: (info: CommitInfo) => void) {
  commitHooks.push(fn);
}

/** Server-owned values of records a call is about to persist (after the permission checks, inside the write
 * transaction): e.g. Unique ID numbers and Person "Default: Created by" of new database rows (rowdefaults.ts). */
const persistHooks: ((changed: Map<string, AppliedChange>, userId: string) => void)[] = [];
export function onBeforePersist(fn: (changed: Map<string, AppliedChange>, userId: string) => void) {
  persistHooks.push(fn);
}

/** opts.userInitiated: a server-built write the person asked for (Merge with CSV, Restore version, …) — the database
 * rules client writes get (Lock database, property access, schema guards; dbaccess.ts) apply to it too. */
export function applyTransactions(userId: string, transactions: Transaction[], originClientId?: string, opts: { client?: boolean; source?: string; userInitiated?: boolean } = {}): AppliedChange[] {
  const changed = new Map<string, AppliedChange>();
  const txIdsByKey = new Map<string, string[]>();
  const replayed = new Map<string, AppliedChange>(); // touched by an already-applied (retried) transaction
  const client = !!opts.client;
  // shape validation before anything touches a record (prototype-polluting paths, unknown tables/commands, …)
  if (!Array.isArray(transactions)) throw new TransactionError('Invalid transactions', 400);
  for (const t of transactions) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.operations)) throw new TransactionError('Invalid transaction', 400);
    if (t.id !== undefined && (typeof t.id !== 'string' || t.id.length > 100)) throw new TransactionError('Invalid transaction id', 400);
    for (const op of t.operations) {
      const problem = prepareOp(op, client);
      if (problem) throw new TransactionError(problem, 400);
    }
  }
  const guard = new TxGuard(userId, changed, { client, userInitiated: !!opts.userInitiated });
  const prevs = new Map<string, BaseRecord | undefined>();
  const out = tx(() => {
    for (const t of transactions) {
      if (t.id && txSeen.get(t.id)) {
        // idempotent retry: report the current values so the client can acknowledge its pending ops
        for (const op of t.operations) {
          const rec = getRecord(op.pointer.table, op.pointer.id);
          if (rec) replayed.set(`${op.pointer.table}:${op.pointer.id}`, { table: op.pointer.table, record: rec, spaceId: (rec as any).space_id ?? null });
        }
        continue;
      }
      for (const op of t.operations) {
        const key = `${op.pointer.table}:${op.pointer.id}`;
        if (t.id) txIdsByKey.set(key, [...(txIdsByKey.get(key) ?? []).filter((x) => x !== t.id), t.id]);
        const before = changed.get(key)?.record ?? getRecord(op.pointer.table, op.pointer.id);
        const after = applyOperation(before, op);
        if (!after) continue;
        const denied = guard.checkOp(op, before, after);
        if (denied) throw new TransactionError(`Permission denied for ${op.command} on ${key}: ${denied}`, 403);
        const spaceId = (after as any).space_id ?? (op.pointer.table === 'space' ? after.id : op.pointer.spaceId ?? null);
        if (op.pointer.table !== 'space' && op.pointer.table !== 'lit_user' && op.pointer.table !== 'user_root' && op.pointer.table !== 'user_settings' && spaceId && !(after as any).space_id) {
          (after as any).space_id = spaceId;
        }
        changed.set(key, { table: op.pointer.table, record: after, spaceId });
      }
    }
    const denied = guard.finalize();
    if (denied) throw new TransactionError(`Permission denied: ${denied}`, 403);
    for (const fn of persistHooks) fn(changed, userId);
    const now = Date.now();
    for (const t of transactions) if (t.id) txMark.run(t.id, now);
    if (now - lastPrune > 3600_000) { lastPrune = now; txPrune.run(now - 2 * 86400_000); }
    for (const [key, ch] of changed) {
      const prev = getRecord(ch.table, ch.record.id);
      prevs.set(key, prev);
      ch.record.version = (prev?.version ?? 0) + 1;
      // server-owned: the last transactions applied to this record (clients drop matching pending ops)
      (ch.record as any).applied_tx_ids = [...(((prev as any)?.applied_tx_ids as string[] | undefined) ?? []), ...(txIdsByKey.get(key) ?? [])].slice(-8);
      putRecord(ch.table, ch.record);
      if (ch.table === 'block') {
        indexBlock(ch.record as BlockRecord);
        maybeSnapshot(ch.record as BlockRecord, userId, now);
      }
    }
    return [...changed.values()];
  });
  recordActivity(userId, out, transactions);
  realtime.broadcastChanges(out, originClientId);
  for (const fn of commitHooks) {
    try {
      fn({ userId, changes: out, prev: prevs, transactions, source: opts.source });
    } catch (e) {
      console.error('[commit hook] failed', e);
    }
  }
  for (const [key, ch] of replayed) if (!changed.has(key)) out.push(ch);
  return out;
}
