// Write authorization for applyChanges / applyTransactions.
//
// Every operation is checked against the state *inside* the running call (records created or changed by earlier ops
// of the same request count), so a new page plus its first blocks can be created in one request without the old
// "created less than 60 s ago" grace (which trusted the client-supplied created_time/created_by_id).
//   - per op (`checkOp`): shape validation (tables, commands, paths: no prototype keys), role on the record as it
//     was before the op, field-level rules (permissions need full access, comments are edited by their author, team
//     membership changes are self join/leave unless owner/admin, server-owned fields are read-only …)
//   - per call (`finalize`): records created in the call must be attached to a parent the user can write
//     (or comment on), moved blocks/collections must land in a writable parent, `space_id` follows the parent, and
//     for client requests new list entries / pointers (content, pages, view_ids, collection_id, alias / synced-block
//     pointers) must reference records the user can read — no "adopting" someone else's block into your own page to
//     duplicate/export/AI-read it later.
// Functions return a reason string when the write is not allowed (records.ts turns it into a 403).
import type { Operation } from '@nc/shared/ops.ts';
import { effectiveRole, isSpaceAdmin, isSpaceMember, maxRole, roleAtLeast, spaceRoleFor, type PermissionLookup } from '@nc/shared/permissions.ts';
import {
  TABLES, type BaseRecord, type BlockRecord, type CollectionRecord, type DiscussionRecord, type Role, type SpaceRecord, type Table,
  type TeamRecord,
} from '@nc/shared/records.ts';
import { getRecord } from './db.ts';
import { isSuggestionOnlyEdit } from '@nc/shared/richtextSuggest.ts';
import type { RichText } from '@nc/shared/richtext.ts';

/** Block types whose text takes suggested edits: text, to-do, headings, bulleted and numbered lists. */
const SUGGESTABLE_TYPES = new Set(['text', 'to_do', 'header', 'sub_header', 'sub_sub_header', 'header_4', 'bulleted_list', 'numbered_list']);
import { canAddDatabaseRows, checkCreatedRecord, databaseUpdateDecision } from './dbaccess.ts';
import {
  copyPolicyProblem, createdSharingProblem, memberInviteAllowed, policyProblem, policyUpdateProblem, restrictedTeamAddProblem, spaceSettingsProblem,
  teamOverrideProblem, teamSidebarProblem,
} from './policy.ts';
import { SCHEMA_SIZE_LIMIT, schemaSize } from '@nc/shared/formula/schemaLimit.ts';
import { stripVerification, verificationEditProblem } from './verificationGuard.ts';
import { DEMO_DISPLAY_SETTINGS, isDemoMode } from './demo.ts';

const TABLE_SET = new Set<string>(TABLES);
const COMMANDS = new Set(['set', 'update', 'listAfter', 'listBefore', 'listRemove', 'spliceText']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Fields the server owns: never accepted from a client operation. */
export const SERVER_OWNED = new Set(['version', 'applied_tx_ids']);
const MAX_ID = 200;
const MAX_PATH = 16;
const RICH_TEXT_SPLICE_ROOTS = new Set(['title', 'name', 'description', 'text', 'caption']);

function changedSettingKeys(before: Rec | undefined, after: Rec, op: Operation): Set<string> {
  const out = new Set<string>();
  if (op.path[0] === 'settings' && op.path[1]) out.add(op.path[1]);
  const b = (before?.settings ?? {}) as Rec;
  const a = (after.settings ?? {}) as Rec;
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) if (!same(b[key], a[key])) out.add(key);
  return out;
}

function demoTransactionProblem(op: Operation, before: Rec | undefined, after: Rec, keys: Set<string>, userId: string): string | null {
  if (!isDemoMode()) return null;
  const table = op.pointer.table;
  if (table === 'lit_user') return 'Account identity changes are turned off in the public demo.';
  if (table === 'user_settings') {
    const settings = changedSettingKeys(before, after, op);
    if ([...settings].some((key) => DEMO_DISPLAY_SETTINGS.has(key))) return 'Shared display preferences are kept in this browser in the public demo.';
  }
  if (table === 'space' && [...keys].some((key) => key !== 'pages')) return 'Workspace settings are turned off in the public demo.';
  if (table === 'team' && [...keys].some((key) => key !== 'team_pages')) return 'Workspace team settings are turned off in the public demo.';
  if (table === 'block' && keys.has('permissions')) {
    if ((after.permissions ?? []).some((p: any) => p?.type === 'public_permission' && p.role !== 'none')) return 'Sharing and public access are turned off in the public demo.';
    const beforePermissions = Array.isArray(before?.permissions) ? before.permissions : [];
    for (const p of (Array.isArray(after.permissions) ? after.permissions : [])) {
      if (!p || p.role === 'none' || (p.type === 'user_permission' && p.user_id === userId)) continue;
      const identity = `${p.type}:${p.user_id ?? ''}:${p.group_id ?? ''}:${p.team_id ?? ''}`;
      const previous = beforePermissions.find((q: any) => `${q?.type}:${q?.user_id ?? ''}:${q?.group_id ?? ''}:${q?.team_id ?? ''}` === identity && q?.role !== 'none');
      if (!previous || previous.role !== p.role) return 'Sharing and guest invitations are turned off in the public demo.';
    }
  }
  if (table === 'block' && keys.has('permissions_unlinked')) return 'Sharing and public access are turned off in the public demo.';
  if (table === 'collection_view' && before?.format?.form_config?.permission !== 'public' && after.format?.form_config?.permission === 'public') {
    return 'Public forms are turned off in the public demo.';
  }
  if (hasOutboundAction(after)) return 'Outbound actions are turned off in the public demo.';
  return null;
}

function hasOutboundAction(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasOutboundAction);
  const rec = value as Record<string, unknown>;
  if (['webhook', 'mail', 'slack'].includes(String(rec.type ?? '').toLowerCase())) return true;
  for (const [key, child] of Object.entries(rec)) {
    const k = key.toLowerCase();
    if (k.includes('webhook') && child) return true;
    if (hasOutboundAction(child)) return true;
  }
  return false;
}

type Rec = Record<string, any>;
type Changed = Map<string, { table: Table; record: BaseRecord; spaceId: string | null }>;

export interface GuardOptions {
  /** Operations come straight from a client (applyChanges): validate pointers/lists and stamp authorship. */
  client?: boolean;
  /** A server-built write the person asked for (Merge with CSV, Restore version, …): the database rules of dbaccess.ts
   *  that guard client writes (Lock database, property access, schema guards) apply too. */
  userInitiated?: boolean;
}

/** Stable JSON (sorted object keys) so equal values compare equal regardless of key order. */
export function stableJson(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Rec;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

function hasUnsafeKey(v: unknown, depth = 0, budget = { n: 0 }): boolean {
  if (v === null || typeof v !== 'object') return false;
  if (depth > 40 || ++budget.n > 200_000) return true; // absurdly deep/large payloads are rejected too
  if (Array.isArray(v)) return v.some((x) => hasUnsafeKey(x, depth + 1, budget));
  for (const k of Object.keys(v as Rec)) {
    if (UNSAFE_KEYS.has(k)) return true;
    if (hasUnsafeKey((v as Rec)[k], depth + 1, budget)) return true;
  }
  return false;
}

/** Shape validation for any operation (also server-built ones): returns a reason or null. */
export function validateOp(op: Operation): string | null {
  if (!op || typeof op !== 'object') return 'Invalid operation';
  const p = op.pointer as any;
  if (!p || typeof p !== 'object' || typeof p.table !== 'string' || !TABLE_SET.has(p.table)) return 'Invalid table';
  if (typeof p.id !== 'string' || !p.id || p.id.length > MAX_ID) return 'Invalid record id';
  if (!COMMANDS.has(op.command)) return `Unknown command ${String(op.command)}`;
  if (!Array.isArray(op.path) || op.path.length > MAX_PATH || op.path.some((s) => typeof s !== 'string' || s.length > 256 || UNSAFE_KEYS.has(s))) return 'Invalid path';
  if (op.path.length && SERVER_OWNED.has(op.path[0])) return `${op.path[0]} is server-owned`;
  const args = op.args as any;
  switch (op.command) {
    case 'update':
      if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'update expects an object';
      break;
    case 'listAfter':
    case 'listBefore':
    case 'listRemove':
      if (!op.path.length) return 'list operations need a path';
      if (!args || typeof args.id !== 'string' || !args.id || args.id.length > MAX_ID) return 'Invalid list id';
      if ((args.after != null && typeof args.after !== 'string') || (args.before != null && typeof args.before !== 'string')) return 'Invalid list anchor';
      break;
    case 'spliceText': {
      const ok = (op.path.length === 2 && op.path[0] === 'properties') || (op.path.length === 1 && RICH_TEXT_SPLICE_ROOTS.has(op.path[0]));
      if (!ok) return 'spliceText is only valid on rich-text properties';
      if (!args || typeof args.base !== 'string' || !Number.isInteger(args.start) || !Number.isInteger(args.end) || args.start < 0 || args.end < args.start || !Array.isArray(args.insert)) return 'Invalid splice';
      break;
    }
    default:
      break;
  }
  if (hasUnsafeKey(args)) return 'Invalid operation arguments';
  return null;
}

/** Remove server-owned fields from client operation arguments (in place). */
export function stripServerOwned(op: Operation) {
  if ((op.command === 'set' || op.command === 'update') && op.path.length === 0 && op.args && typeof op.args === 'object') {
    for (const k of SERVER_OWNED) delete (op.args as Rec)[k];
  }
}

/** Validate an operation before it is applied (and drop server-owned fields from client operations). */
export function prepareOp(op: Operation, client: boolean): string | null {
  const problem = validateOp(op);
  if (problem) return problem;
  if (client) stripServerOwned(op);
  return null;
}

/** Top-level keys whose value differs between two versions of a record (server-owned fields ignored). */
function changedKeys(before: Rec | undefined, after: Rec, op: Operation): Set<string> {
  const out = new Set<string>();
  if (op.path.length) {
    if (!same(before?.[op.path[0]], after[op.path[0]])) out.add(op.path[0]);
    return out;
  }
  const keys = op.command === 'update' ? Object.keys(op.args ?? {}) : [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])];
  for (const k of keys) if (!SERVER_OWNED.has(k) && !same(before?.[k], after[k])) out.add(k);
  return out;
}

function idsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function addedIds(before: unknown, after: unknown): string[] {
  const prev = new Set(idsOf(before));
  return idsOf(after).filter((id) => !prev.has(id));
}

/** Pointer lists checked for client requests: field → table of the referenced records. */
const LISTS: Partial<Record<Table, Record<string, Table>>> = {
  block: { content: 'block', view_ids: 'collection_view', discussions: 'discussion' },
  space: { pages: 'block', default_team_ids: 'team' },
  team: { team_pages: 'block' },
  space_view: { private_pages: 'block', bookmarked_pages: 'block', joined_teams: 'team' },
  collection: { template_pages: 'block' },
  discussion: { comments: 'comment' },
};

export class TxGuard {
  readonly userId: string;
  readonly client: boolean;
  readonly userInitiated: boolean;
  private changed: Changed;
  /** "table:id" of records created by this call */
  readonly created = new Set<string>();
  /** existing records whose parent changed (re-checked against the final state) */
  private moved = new Set<string>();
  private roleCache = new Map<string, Role>();
  private lookup: PermissionLookup;

  constructor(userId: string, changed: Changed, opts: GuardOptions = {}) {
    this.userId = userId;
    this.changed = changed;
    this.client = !!opts.client;
    this.userInitiated = !!opts.userInitiated;
    this.lookup = {
      block: (id) => this.get<BlockRecord>('block', id),
      space: (id) => this.get<SpaceRecord>('space', id),
      team: (id) => this.get<TeamRecord>('team', id),
      collection: (id) => this.get<CollectionRecord>('collection', id),
    };
  }

  /** Current value inside this call (changed by an earlier op) or the stored one. */
  get<T extends BaseRecord = BaseRecord>(table: Table, id: string | undefined | null): T | undefined {
    if (!id) return undefined;
    const ch = this.changed.get(`${table}:${id}`);
    return (ch ? ch.record : getRecord(table, id)) as T | undefined;
  }

  /** Role on a block in the in-call state; blocks created by this call are fully owned by their creator. */
  role(blockId: string | undefined | null): Role {
    if (!blockId) return 'none';
    const hit = this.roleCache.get(blockId);
    if (hit) return hit;
    let r = effectiveRole(this.lookup, blockId, this.userId);
    if (this.created.has(`block:${blockId}`)) r = maxRole(r, 'editor');
    this.roleCache.set(blockId, r);
    return r;
  }

  private canReadBlock(id: string): boolean {
    return this.created.has(`block:${id}`) || this.role(id) !== 'none';
  }

  /** Role on a collection = role on the block hosting it. */
  private collectionRole(c: CollectionRecord | undefined): Role {
    if (!c) return 'none';
    if (this.created.has(`collection:${c.id}`)) return 'editor';
    return this.role(c.parent_id);
  }

  private discussionRole(d: DiscussionRecord | undefined): Role {
    return d ? this.role(d.parent_id) : 'none';
  }

  /** Check one operation; `before` is the in-call value before the op, `after` the result. Returns a reason or null. */
  checkOp(op: Operation, before: BaseRecord | undefined, after: BaseRecord): string | null {
    const res = this.decide(op, before, after);
    // roles derived from the state before this op must not leak into the next op
    if (this.structural) this.roleCache.clear();
    this.structural = false;
    return res;
  }

  private structural = false;

  private decide(op: Operation, before: BaseRecord | undefined, after: BaseRecord): string | null {
    const table = op.pointer.table;
    const key = `${table}:${op.pointer.id}`;
    const b = before as Rec | undefined;
    const a = after as Rec;
    const uid = this.userId;
    if (a.id !== op.pointer.id) return 'Record id mismatch';
    const keys = changedKeys(b, a, op);
    const demoProblem = demoTransactionProblem(op, b, a, keys, uid);
    if (demoProblem) return demoProblem;

    if (!b) {
      // ---------------------------------------------------------------- creation
      if (isDemoMode() && ['lit_user', 'user_root', 'user_settings'].includes(table)) return 'Account settings cannot be created through the public demo transaction path';
      if (isDemoMode() && table === 'team') return 'Workspace team settings are turned off in the public demo.';
      if (isDemoMode() && table === 'block' && (a.permissions_unlinked || (a.permissions ?? []).some((p: any) => p?.type === 'public_permission' && p.role !== 'none'))) return 'Sharing and public access are turned off in the public demo.';
      if (isDemoMode() && hasOutboundAction(a)) return 'Outbound actions are turned off in the public demo.';
      this.created.add(key);
      this.structural = true;
      if (this.client && ['block', 'collection', 'collection_view', 'discussion', 'comment', 'team'].includes(table)) {
        a.created_by_id = uid; // authorship is not client-controlled (impersonation)
        if (table === 'block') a.created_by_table = 'lit_user';
      }
      switch (table) {
        case 'block':
          if (typeof a.type !== 'string') return 'Blocks need a type';
          return null; // parent checked in finalize (it may be created later in this call)
        case 'collection':
        case 'collection_view':
        case 'discussion':
        case 'comment':
          return null; // finalize
        case 'space':
          return 'Workspaces are created with createWorkspace';
        case 'space_view':
          return a.parent_id === uid ? null : 'Not your sidebar';
        case 'team': {
          const space = this.get<SpaceRecord>('space', a.space_id);
          if (!isSpaceMember(space, uid)) return 'Not a member of this workspace';
          if (a.parent_table !== 'space' || a.parent_id !== a.space_id) return 'Teamspaces live in their workspace';
          const members = new Set((space!.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => p.user_id!));
          if ((a.membership ?? []).some((m: any) => !m || typeof m.user_id !== 'string' || !members.has(m.user_id))) return 'Teamspace members must be workspace members';
          return policyProblem(space, 'create_teamspace', uid) // Settings › Teamspaces › Limit teamspace creation
            ?? restrictedTeamAddProblem(space, undefined, a as TeamRecord, uid) // Security › restricted members
            ?? teamOverrideProblem(space, { settings: {} } as TeamRecord, a as TeamRecord, uid); // relaxing workspace security
        }
        case 'lit_user':
        case 'user_root':
        case 'user_settings':
          return op.pointer.id === uid ? null : 'Not your account';
        case 'notification':
        case 'page_visit':
          return a.user_id === uid ? null : 'Not your record';
        case 'follow':
          if (a.user_id !== uid) return 'Not your record';
          return a.navigable_block_id && this.role(a.navigable_block_id) !== 'none' ? null : 'Not found';
        default:
          return 'Unknown table';
      }
    }

    // ------------------------------------------------------------------ update of an existing record
    if (this.created.has(key)) {
      // created earlier in this call: the creator may keep shaping it; parents/pointers are re-checked in finalize
      this.structural = true;
      return null;
    }
    if (!keys.size) return null;
    if (keys.has('id')) return 'Record ids cannot change';
    if (['permissions', 'permissions_unlinked', 'parent_id', 'parent_table', 'membership', 'settings', 'space_id', 'alive', 'collection_id'].some((k) => keys.has(k))) this.structural = true;
    // workspace security policy (policy.ts): publishing, new guests, public forms
    const policy = policyUpdateProblem(this, table, b, a, keys);
    if (policy) return policy;
    // databases: Lock database / Can edit content / Can create (dbaccess.ts); undefined = default checks below
    const dbDecision = databaseUpdateDecision(this, table, b as Rec, a, keys);
    if (dbDecision !== undefined) return dbDecision;
    switch (table) {
      case 'block': {
        const role = this.role(op.pointer.id);
        if (keys.has('space_id')) return 'Blocks cannot change workspace';
        if (keys.has('created_by_id') || keys.has('created_time')) return 'Authorship can’t be changed';
        if ((keys.has('permissions') || keys.has('permissions_unlinked')) && !roleAtLeast(role, 'editor')) return 'Only people with full access can change sharing';
        // Share › Advanced › Agent access settings (agents/access.ts grantProblem): Full access only
        if (keys.has('format') && ((b as BlockRecord).format?.agent_access_policy ?? null) !== ((a as BlockRecord).format?.agent_access_policy ?? null) && !roleAtLeast(role, 'editor')) return 'Only people with full access can change this setting.';
        // page verification and Verification property values are the server's (wiki.ts setPageVerification: owners, plan)
        if (this.client) {
          const verification = verificationEditProblem(this, b, a, keys);
          if (verification) return verification;
        }
        if (keys.has('parent_id') || keys.has('parent_table')) this.moved.add(key);
        const onlyDiscussions = [...keys].every((k) => k === 'discussions');
        if (onlyDiscussions && !roleAtLeast(role, 'read_and_write')) {
          if (!roleAtLeast(role, 'comment_only')) return 'Not allowed';
          // commenters may attach threads and remove their own, not hide other people's
          for (const id of addedIds(a.discussions, b.discussions)) {
            if ((this.get('discussion', id) as Rec | undefined)?.created_by_id !== uid) return 'Not allowed';
          }
          return null;
        }
        // suggested edits : commenters change block text only through suggestions of their own
        if (!roleAtLeast(role, 'read_and_write') && roleAtLeast(role, 'comment_only')) {
          const problem = this.suggestionEditProblem(b as BlockRecord, a as BlockRecord, keys);
          if (problem !== undefined) return problem;
        }
        return roleAtLeast(role, 'read_and_write') ? null : 'Not allowed';
      }
      case 'collection':
      case 'collection_view': {
        if (keys.has('space_id')) return 'Records cannot change workspace';
        const role = this.role(b.parent_id);
        if (!roleAtLeast(role, 'read_and_write')) return 'Not allowed';
        if (keys.has('parent_id') || keys.has('parent_table')) this.moved.add(key);
        return null;
      }
      case 'space': {
        const sp = b as SpaceRecord;
        const forbidden = ['permissions', 'plan_type', 'domain', 'invite_link_code', 'created_by_id', 'created_time', 'deleted_time', 'deleted_by_id'];
        if (forbidden.some((k) => keys.has(k))) return 'Use the workspace settings API for this change';
        if (keys.has('pages') && !roleAtLeast(spaceRoleFor(sp, uid), 'read_and_write')) return 'Not allowed';
        if ([...keys].every((k) => k === 'pages')) return null;
        // owners: every setting; membership admins: membership keys only; endpoint-only keys never (policy.ts)
        return spaceSettingsProblem(sp, a as SpaceRecord, keys, uid);
      }
      case 'space_view':
        if (b.parent_id !== uid || a.parent_id !== uid) return 'Not your sidebar';
        if (keys.has('space_id') || keys.has('parent_table')) return 'Not allowed';
        return null;
      case 'team':
        return this.checkTeam(b as TeamRecord, a as TeamRecord, keys);
      case 'discussion':
        return this.checkDiscussion(b as DiscussionRecord, a as DiscussionRecord, keys);
      case 'comment':
        return this.checkComment(b, a, keys);
      case 'lit_user':
        if (op.pointer.id !== uid) return 'Not your account';
        if (keys.has('email') || keys.has('created_time')) return 'This field can’t be changed here';
        return null;
      case 'user_root':
        if (op.pointer.id !== uid) return 'Not your account';
        for (const id of addedIds(b.space_views, a.space_views)) {
          const sv = this.get('space_view', id) as Rec | undefined;
          if (!sv || sv.parent_id !== uid) return 'Not your sidebar';
        }
        return null;
      case 'user_settings':
        return op.pointer.id === uid ? null : 'Not your account';
      case 'notification':
        if (b.user_id !== uid || a.user_id !== uid) return 'Not your notification';
        if (['user_id', 'space_id', 'type', 'actor_id', 'navigable_block_id', 'activity', 'created_time', 'discussion_id', 'comment_id'].some((k) => keys.has(k))) return 'Not allowed';
        return null;
      case 'follow':
      case 'page_visit':
        if (b.user_id !== uid || a.user_id !== uid) return 'Not your record';
        if (keys.has('navigable_block_id') || keys.has('parent_id') || keys.has('space_id')) return 'Not allowed';
        return null;
      default:
        return 'Unknown table';
    }
  }

  /**
   * A commenter's block update that only adds/edits/withdraws their own suggestions (richtextSuggest.ts): returns null
   * when allowed, a reason when it is a suggestion edit that breaks the rules, undefined when it is not a suggestion
   * edit at all (the normal role check applies).
   */
  private suggestionEditProblem(b: BlockRecord, a: BlockRecord, keys: Set<string>): string | null | undefined {
    const uid = this.userId;
    const allowed = new Set(['properties', 'discussions', 'last_edited_time', 'last_edited_by_id', 'last_edited_by_table']);
    if ([...keys].some((k) => !allowed.has(k))) return undefined;
    if (!keys.has('properties')) {
      // the editor's touch right after a suggestion edit of this block in the same call
      if (!this.suggestedBlocks.has(b.id) || keys.has('discussions')) return undefined;
      return (a as Rec).last_edited_by_id === uid || !keys.has('last_edited_by_id') ? null : 'Not allowed';
    }
    if (!SUGGESTABLE_TYPES.has(b.type) || a.type !== b.type) return 'Suggestions are only possible in text, to-do, heading and list blocks';
    if (keys.has('last_edited_by_id') && (a as Rec).last_edited_by_id !== uid) return 'Not allowed';
    // a locked page takes no suggestions 
    let cur: BlockRecord | undefined = b;
    for (let i = 0; i < 60 && cur; i++) {
      if (cur.format?.block_locked) return 'This page is locked';
      if (cur.type === 'page' || cur.type === 'collection_view_page' || cur.parent_table !== 'block') break;
      cur = this.get<BlockRecord>('block', cur.parent_id);
    }
    const bp = (b.properties ?? {}) as Record<string, unknown>;
    const ap = (a.properties ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(bp), ...Object.keys(ap)])) {
      if (k !== 'title' && !same(bp[k], ap[k])) return 'Commenters can only suggest text changes';
    }
    const owns = (id: string) => {
      const d = this.get<DiscussionRecord>('discussion', id) as (DiscussionRecord & Rec) | undefined;
      return !!d && d.created_by_id === uid && d.type === 'suggestion' && d.parent_id === b.id;
    };
    if (!isSuggestionOnlyEdit(bp.title as RichText | undefined, ap.title as RichText | undefined, owns)) return 'Commenters can only suggest edits';
    if (keys.has('discussions')) {
      const changed = [...addedIds(a.discussions, b.discussions), ...addedIds(b.discussions, a.discussions)];
      for (const id of changed) if ((this.get('discussion', id) as Rec | undefined)?.created_by_id !== uid) return 'Not allowed';
    }
    this.suggestedBlocks.add(b.id);
    return null;
  }

  /** blocks whose text a commenter changed through suggestions in this call (their touch is allowed) */
  private suggestedBlocks = new Set<string>();

  private checkTeam(b: TeamRecord, a: TeamRecord, keys: Set<string>): string | null {
    const uid = this.userId;
    if (keys.has('space_id') || keys.has('parent_id') || keys.has('parent_table')) return 'Teamspaces cannot move';
    const space = this.get<SpaceRecord>('space', b.space_id);
    if (!isSpaceMember(space, uid)) return 'Not a member of this workspace';
    if (keys.has('membership')) {
      // Security › Who can add restricted members to Teamspaces; restricted members are never teamspace owners
      const restricted = restrictedTeamAddProblem(space, b, a, uid);
      if (restricted) return restricted;
    }
    const isOwner = (b.membership ?? []).some((m) => m.user_id === uid && m.role === 'owner');
    if (isOwner || isSpaceAdmin(space, uid)) {
      const members = new Set((space!.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => p.user_id!));
      if (keys.has('membership') && (a.membership ?? []).some((m) => !m || !members.has(m.user_id))) return 'Teamspace members must be workspace members';
      return null;
    }
    const inTeam = (b.membership ?? []).some((m) => m.user_id === uid);
    const open = (b.settings?.type ?? 'open') === 'open';
    for (const k of keys) {
      if (k === 'team_pages') {
        if (!inTeam && !open) return 'Join this team first';
        const sidebar = teamSidebarProblem(b, uid); // Teamspace settings › Who can edit teamspace sidebar
        if (sidebar) return sidebar;
        continue;
      }
      if (k === 'membership') {
        const prev = (b.membership ?? []).map((m) => stableJson(m));
        const next = (a.membership ?? []).map((m) => stableJson(m));
        const removed = (b.membership ?? []).filter((_, i) => !next.includes(prev[i]));
        const added = (a.membership ?? []).filter((_, i) => !prev.includes(next[i]));
        const selfLeave = !added.length && removed.length >= 1 && removed.every((m) => m.user_id === uid);
        const selfJoin = !removed.length && added.length === 1 && added[0]?.user_id === uid && added[0]?.role === 'member' && !inTeam && open;
        // Teamspace settings › Who can invite or remove teamspace members (Any teamspace member)
        if (!selfLeave && !selfJoin && !memberInviteAllowed(b, a, uid)) return 'Only team owners can manage members';
        continue;
      }
      return 'Only team owners can change team settings';
    }
    return null;
  }

  private checkDiscussion(b: DiscussionRecord, a: DiscussionRecord, keys: Set<string>): string | null {
    const uid = this.userId;
    if (keys.has('parent_id') || keys.has('parent_table') || keys.has('space_id') || keys.has('created_by_id')) return 'Not allowed';
    const role = this.discussionRole(b);
    if (roleAtLeast(role, 'read_and_write')) return null; // page editors moderate discussions
    if (!roleAtLeast(role, 'comment_only')) return 'Not allowed';
    for (const k of keys) {
      if (k === 'resolved' || k === 'resolved_by_id' || k === 'resolved_time') continue;
      if (k === 'comments') {
        for (const id of addedIds(a.comments, b.comments)) {
          if ((this.get('comment', id) as Rec | undefined)?.created_by_id !== uid) return 'Not allowed';
        }
        continue;
      }
      if (k === 'muted_user_ids') {
        const prev = new Set(idsOf(b.muted_user_ids));
        const next = new Set(idsOf(a.muted_user_ids));
        const diff = [...prev].filter((x) => !next.has(x)).concat([...next].filter((x) => !prev.has(x)));
        if (diff.some((x) => x !== uid)) return 'Not allowed';
        continue;
      }
      if (k === 'alive' && b.created_by_id === uid) continue;
      // withdrawing your own suggestion (Reject) records how it ended
      if ((k === 'suggestion_status' || k === 'suggestion_summary') && b.created_by_id === uid && b.type === 'suggestion' && (a as Rec).suggestion_status !== 'accepted') continue;
      return 'Not allowed';
    }
    return null;
  }

  private checkComment(b: Rec, a: Rec, keys: Set<string>): string | null {
    const uid = this.userId;
    if (keys.has('parent_id') || keys.has('parent_table') || keys.has('space_id') || keys.has('created_by_id') || keys.has('created_time')) return 'Not allowed';
    const role = this.discussionRole(this.get<DiscussionRecord>('discussion', b.parent_id));
    if (!roleAtLeast(role, 'comment_only')) return 'Not allowed';
    const author = b.created_by_id === uid;
    for (const k of keys) {
      if (k === 'reactions') {
        const prev = (b.reactions ?? {}) as Record<string, unknown>;
        const next = (a.reactions ?? {}) as Record<string, unknown>;
        for (const emoji of new Set([...Object.keys(prev), ...Object.keys(next)])) {
          const p = new Set(idsOf(prev[emoji]));
          const n = new Set(idsOf(next[emoji]));
          const diff = [...p].filter((x) => !n.has(x)).concat([...n].filter((x) => !p.has(x)));
          if (diff.some((x) => x !== uid)) return 'You can only add or remove your own reactions';
        }
        continue;
      }
      if (k === 'alive' && (author || roleAtLeast(role, 'read_and_write'))) continue;
      if ((k === 'text' || k === 'last_edited_time' || k === 'edited') && author) continue;
      return 'Only the author can edit this comment';
    }
    return null;
  }

  /** Parent of a created/moved record must be writable (blocks, collections) or commentable (discussions, comments). */
  private parentProblem(table: Table, r: Rec): string | null {
    const uid = this.userId;
    switch (table) {
      case 'block': {
        const pt = r.parent_table;
        if (pt === 'block') {
          const p = this.get<BlockRecord>('block', r.parent_id);
          if (!p) return 'Parent block not found';
          if (!roleAtLeast(this.role(p.id), 'read_and_write')) return 'Not allowed to add content here';
          r.space_id = p.space_id;
          return null;
        }
        if (pt === 'collection') {
          const c = this.get<CollectionRecord>('collection', r.parent_id);
          if (!c) return 'Database not found';
          if (!roleAtLeast(this.collectionRole(c), 'read_and_write') && !canAddDatabaseRows(this, c)) return 'Not allowed to add rows here';
          r.space_id = c.space_id ?? this.get<BlockRecord>('block', c.parent_id)?.space_id ?? r.space_id;
          return null;
        }
        if (pt === 'space') {
          if (!isSpaceMember(this.get<SpaceRecord>('space', r.parent_id), uid)) return 'Not a member of this workspace';
          r.space_id = r.parent_id;
          return null;
        }
        if (pt === 'team') {
          const t = this.get<TeamRecord>('team', r.parent_id);
          if (!t || t.alive === false) return 'Teamspace not found';
          if (!isSpaceMember(this.get<SpaceRecord>('space', t.space_id), uid)) return 'Not a member of this workspace';
          const inTeam = (t.membership ?? []).some((m) => m.user_id === uid);
          if (!inTeam && (t.settings?.type ?? 'open') !== 'open') return 'Join this team first';
          r.space_id = t.space_id;
          return null;
        }
        return 'Invalid parent';
      }
      case 'collection':
      case 'collection_view': {
        const p = this.get<BlockRecord>('block', r.parent_id);
        if (!p) return 'Parent block not found';
        if (!roleAtLeast(this.role(p.id), 'read_and_write')) return 'Not allowed';
        r.parent_table = 'block';
        r.space_id = p.space_id;
        return null;
      }
      case 'discussion': {
        const p = this.get<BlockRecord>('block', r.parent_id);
        if (!p) return 'Block could not be found';
        if (!roleAtLeast(this.role(p.id), 'comment_only')) return 'Not allowed to comment here';
        r.parent_table = 'block';
        r.space_id = p.space_id;
        return null;
      }
      case 'comment': {
        const d = this.get<DiscussionRecord>('discussion', r.parent_id);
        if (!d) return 'Discussion not found';
        if (!roleAtLeast(this.discussionRole(d), 'comment_only')) return 'Not allowed to comment here';
        r.parent_table = 'discussion';
        r.space_id = d.space_id;
        return null;
      }
      default:
        return null;
    }
  }

  /** A record created in this call must hang below something that existed before (no orphan islands / cycles). */
  private anchored(table: Table, r: Rec): boolean {
    const seen = new Set<string>();
    let curTable: Table = table;
    let cur: Rec | undefined = r;
    for (let i = 0; i < 500 && cur; i++) {
      const key = `${curTable}:${cur.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (!this.created.has(key)) return true;
      let nextTable: Table | null = null;
      if (curTable === 'comment') nextTable = 'discussion';
      else if (curTable === 'block') nextTable = cur.parent_table === 'block' ? 'block' : cur.parent_table === 'collection' ? 'collection' : null;
      else if (curTable === 'collection' || curTable === 'collection_view' || curTable === 'discussion') nextTable = 'block';
      if (!nextTable) return true; // space / team roots were checked by parentProblem
      cur = this.get(nextTable, cur.parent_id) as Rec | undefined;
      curTable = nextTable;
    }
    return false;
  }

  /** End-of-call checks against the final in-call state; also normalizes space_id. Returns a reason or null. */
  finalize(): string | null {
    this.roleCache.clear();
    for (const key of [...this.created, ...this.moved]) {
      const ch = this.changed.get(key);
      if (!ch) continue;
      const r = ch.record as Rec;
      const problem = this.parentProblem(ch.table, r);
      if (problem) return `${problem} (${key})`;
      // records never move between workspaces (their sub-tree would stay behind, and "Disable duplicating pages to other
      // workspaces" would be bypassed): Move to another workspace duplicates through move.ts duplicateToSpace
      if (!this.created.has(key)) {
        const stored = getRecord(ch.table, r.id) as Rec | undefined;
        if (stored?.space_id && r.space_id && stored.space_id !== r.space_id) return `Pages can only be duplicated to another workspace, not moved (${key})`;
      }
      if (this.created.has(key) && ['block', 'collection', 'collection_view', 'discussion', 'comment'].includes(ch.table) && !this.anchored(ch.table, r)) {
        return `Record is not attached to a page (${key})`;
      }
      // Settings › Security › Disable duplicating pages to other workspaces
      if (this.created.has(key)) {
        const copyProblem = copyPolicyProblem(this, ch.table, r);
        if (copyProblem) return `${copyProblem} (${key})`;
      }
      // databases (dbaccess.ts): new rows and rows moved in only carry restricted property values the writer can edit
      // (every write: client, API or server-built); copies don't keep someone else's sprint automation
      const dbProblem = checkCreatedRecord(this, ch.table, r, !this.created.has(key));
      if (dbProblem) return `${dbProblem} (${key})`;
      // pasted / duplicated pages from a client never arrive verified (verificationGuard.ts)
      if (this.client && this.created.has(key) && ch.table === 'block') stripVerification(r);
      // workspace sharing policy (guests, restricted members, publishing) on sharing written into records created by
      // this call — also by later ops of the call, which decide lets through for new records
      if (this.client && this.created.has(key)) {
        const sharingProblem = createdSharingProblem(this, ch.table, r);
        if (sharingProblem) return `${sharingProblem} (${key})`;
      }
      if (r.space_id) ch.spaceId = r.space_id;
    }
    if (!this.client) return null;
    for (const [key, ch] of this.changed) {
      const r = ch.record as Rec;
      const prev = (this.created.has(key) ? undefined : getRecord(ch.table, r.id)) as Rec | undefined;
      //  : a data source's property schema (formulas included) may not grow past 1.5MB
      if (ch.table === 'collection' && r.schema && r.schema !== prev?.schema) {
        const size = schemaSize(r.schema);
        if (size > SCHEMA_SIZE_LIMIT && size > schemaSize(prev?.schema)) return `The database’s properties are too large (${key})`;
      }
      // new entries in pointer lists must be records the user can read (or children of this record)
      for (const [field, target] of Object.entries(LISTS[ch.table] ?? {})) {
        for (const id of addedIds(prev?.[field], r[field])) {
          const problem = this.listEntryProblem(ch.table, r, field, target, id);
          if (problem) return `${problem} (${key} ${field})`;
        }
      }
      // pointers to other records
      if (ch.table === 'block') {
        if (r.collection_id && r.collection_id !== prev?.collection_id && !this.created.has(`collection:${r.collection_id}`)) {
          const c = this.get<CollectionRecord>('collection', r.collection_id);
          if (!c || this.collectionRole(c) === 'none') return `Database not found (${key})`;
        }
        const fcid = r.format?.collection_pointer?.id;
        if (typeof fcid === 'string' && fcid !== prev?.format?.collection_pointer?.id && !this.created.has(`collection:${fcid}`)) {
          const c = this.get<CollectionRecord>('collection', fcid);
          if (!c || this.collectionRole(c) === 'none') return `Database not found (${key})`;
        }
        for (const ptr of ['alias_pointer', 'transclusion_reference_pointer'] as const) {
          const id = r.format?.[ptr]?.id;
          if (typeof id === 'string' && id !== prev?.format?.[ptr]?.id && !this.canReadBlock(id)) return `Linked block not found (${key})`;
        }
      }
      if (ch.table === 'collection_view') {
        const cid = r.format?.collection_pointer?.id;
        if (typeof cid === 'string' && cid !== prev?.format?.collection_pointer?.id && !this.created.has(`collection:${cid}`)) {
          const c = this.get<CollectionRecord>('collection', cid);
          if (!c || this.collectionRole(c) === 'none') return `Database not found (${key})`;
        }
      }
    }
    return null;
  }

  private listEntryProblem(table: Table, owner: Rec, field: string, target: Table, id: string): string | null {
    const rec = this.get(target, id) as Rec | undefined;
    if (!rec) return target === 'block' && table === 'space_view' ? null : 'Referenced record not found';
    switch (target) {
      case 'block':
        if (table === 'block' && rec.parent_table === 'block' && rec.parent_id === owner.id) return null;
        return this.canReadBlock(id) ? null : 'Not allowed to reference this block';
      case 'discussion':
      case 'comment':
        return rec.parent_id === owner.id ? null : 'Not allowed to reference this record';
      case 'collection_view':
        return this.created.has(`collection_view:${id}`) || this.role(rec.parent_id) !== 'none' ? null : 'Not allowed to reference this view';
      case 'team': {
        const space = this.get<SpaceRecord>('space', rec.space_id);
        return rec.space_id === owner.space_id || (table === 'space' && rec.space_id === owner.id) ? (isSpaceMember(space, this.userId) ? null : 'Not a member') : 'Teamspace of another workspace';
      }
      default:
        return null;
    }
  }
}
