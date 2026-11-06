// Agent change log + Undo ("Changes made" card → Undo → "Changes reverted").
//
// Every agent edit is applied as an ordinary transaction through applyTransactions(userId, …, {client: true}) — the
// same permission checks, pointer validation, persistence, history and realtime broadcast as a client edit — and
// recorded here with its inverse. Inverses are computed against the state before each operation (list operations are
// inverted semantically: an added id is removed, a removed id is put back after its old neighbour, so concurrent list
// edits by other people survive). Each value inverse carries a fingerprint of what the agent wrote; Undo skips an
// inverse whose target was edited since (someone else's later change wins) and reports it as a conflict.
import { newId } from '@nc/shared/ids.ts';
import { applyOperation, getAtPath, invertOperation, op as mk, type Operation } from '@nc/shared/ops.ts';
import type { BaseRecord } from '@nc/shared/records.ts';
import { stableJson } from '../authz.ts';
import { db, getRecord } from '../db.ts';
import { applyTransactions, type AppliedChange } from '../records.ts';
import { AiError } from './client.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS ai_changes (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  thread_id TEXT,
  user_id TEXT NOT NULL,
  space_id TEXT,
  tool TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  ops TEXT NOT NULL,
  inverse TEXT NOT NULL,
  pages TEXT NOT NULL,
  undone_time INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_changes_turn ON ai_changes(turn_id);
CREATE INDEX IF NOT EXISTS idx_ai_changes_thread ON ai_changes(thread_id, created_time);
`);

export type PageAction = 'created' | 'updated' | 'deleted' | 'moved' | 'commented' | 'restored';

export interface TouchedPage {
  pageId: string;
  title: string;
  action: PageAction;
  /** database (collection_view_page / inline database) rather than a page */
  database?: boolean;
}

interface InverseStep {
  op: Operation;
  /** value written by the forward op (stable JSON) — the inverse only applies while it is still there */
  check?: { path: string[]; keys?: string[]; after: string };
}

function key(o: Operation) {
  return `${o.pointer.table}:${o.pointer.id}`;
}

function listOf(rec: BaseRecord | undefined, path: string[]): string[] {
  const v = getAtPath(rec, path);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function fingerprint(rec: BaseRecord | undefined, path: string[], keys?: string[]): string {
  const v = getAtPath(rec, path);
  if (!keys) return stableJson(v);
  const picked: Record<string, unknown> = {};
  for (const k of keys) picked[k] = (v as Record<string, unknown> | undefined)?.[k];
  return stableJson(picked);
}

function invertOne(before: BaseRecord | undefined, after: BaseRecord | undefined, o: Operation): InverseStep | null {
  if (o.command === 'listAfter' || o.command === 'listBefore' || o.command === 'listRemove') {
    const id = String(o.args?.id ?? '');
    const prev = listOf(before, o.path);
    const idx = prev.indexOf(id);
    if (o.command === 'listRemove') {
      if (idx < 0) return null;
      return { op: idx > 0 ? mk.listAfter(o.pointer, o.path, id, prev[idx - 1]) : mk.listBefore(o.pointer, o.path, id) };
    }
    if (idx < 0) return { op: mk.listRemove(o.pointer, o.path, id) };
    return { op: idx > 0 ? mk.listAfter(o.pointer, o.path, id, prev[idx - 1]) : mk.listBefore(o.pointer, o.path, id) };
  }
  if (o.command === 'set' && o.path.length === 0 && !before) {
    // creation → archive (blocks / collections / views / discussions / comments all honour `alive`)
    return { op: mk.update(o.pointer, [], { alive: false }) };
  }
  const keys = o.command === 'update' ? Object.keys(o.args ?? {}) : undefined;
  return { op: invertOperation(before, o), check: { path: o.path, keys, after: fingerprint(after, o.path, keys) } };
}

/** Inverse steps of `ops` (in undo order) computed against the stored state. */
export function planInverse(ops: Operation[]): InverseStep[] {
  const state = new Map<string, BaseRecord | undefined>();
  const out: InverseStep[] = [];
  for (const o of ops) {
    const k = key(o);
    const before = state.has(k) ? state.get(k) : getRecord(o.pointer.table, o.pointer.id);
    const after = applyOperation(before, o);
    const inv = invertOne(before, after, o);
    if (inv) out.push(inv);
    state.set(k, after);
  }
  return out.reverse();
}

export interface ChangeContext {
  userId: string;
  spaceId: string;
  /** the assistant message the changes belong to */
  turnId: string;
  threadId: string | null;
  clientId?: string;
  /** commit source (records.ts CommitInfo.source): Custom Agent runs tag their writes for the trigger loop guard */
  source?: string;
}

/**
 * Apply agent operations as the user (full client-level authorization) and log them for Undo.
 * Throws AiError('forbidden') when the user may not make the change.
 */
export function applyAgentOps(ctx: ChangeContext, tool: string, ops: Operation[], pages: TouchedPage[]): { changeId: string; applied: AppliedChange[] } {
  if (!ops.length) return { changeId: '', applied: [] };
  const inverse = planInverse(ops);
  let applied: AppliedChange[];
  try {
    // no origin client: the requesting tab must receive the agent's records over the websocket too (it ignores its own
    // echoes, but these edits did not come from it)
    applied = applyTransactions(ctx.userId, [{ id: newId(), spaceId: ctx.spaceId, debug: { userAction: `ai.agent.${tool}` }, operations: ops }], undefined, { client: true, ...(ctx.source ? { source: ctx.source } : {}) });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 403) throw new AiError('forbidden', 'The user doesn’t have permission to make this change.', 403);
    throw new AiError('bad_request', `The change couldn’t be applied: ${String((e as Error)?.message ?? e).slice(0, 200)}`, 400);
  }
  const changeId = newId();
  db.prepare('INSERT INTO ai_changes (id, turn_id, thread_id, user_id, space_id, tool, created_time, ops, inverse, pages) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(changeId, ctx.turnId, ctx.threadId, ctx.userId, ctx.spaceId, tool, Date.now(), JSON.stringify(ops), JSON.stringify(inverse), JSON.stringify(pages));
  return { changeId, applied };
}

interface ChangeRow {
  id: string;
  turn_id: string;
  thread_id: string | null;
  user_id: string;
  space_id: string | null;
  tool: string;
  created_time: number;
  inverse: string;
  pages: string;
  undone_time: number | null;
}

export interface TurnChanges {
  pages: TouchedPage[];
  undone: boolean;
  count: number;
}

/** Pages touched by a turn's changes (merged; "created" wins over later updates of the same page). */
export function turnChanges(turnId: string): TurnChanges | null {
  const rows = db.prepare('SELECT * FROM ai_changes WHERE turn_id = ? ORDER BY created_time').all(turnId) as unknown as ChangeRow[];
  if (!rows.length) return null;
  const pages = new Map<string, TouchedPage>();
  for (const r of rows) {
    for (const p of JSON.parse(r.pages) as TouchedPage[]) {
      const cur = pages.get(p.pageId);
      if (!cur || (cur.action !== 'created' && cur.action !== 'deleted')) pages.set(p.pageId, { ...p, title: p.title || cur?.title || '' });
      else if (p.title) cur.title = p.title;
    }
  }
  return { pages: [...pages.values()], undone: rows.every((r) => r.undone_time !== null), count: rows.length };
}

/**
 * Revert the changes of one agent turn. Changes must be undone newest first within a chat.
 * You’ll need to undo the most recent changes from this chat first"). Returns how many inverse operations were
 * skipped because the target was edited after the agent.
 */
export function undoTurn(userId: string, turnId: string): { reverted: number; conflicts: number } {
  const rows = (db.prepare('SELECT * FROM ai_changes WHERE turn_id = ? AND undone_time IS NULL ORDER BY created_time').all(turnId) as unknown as ChangeRow[]);
  if (!rows.length) {
    const any = db.prepare('SELECT user_id FROM ai_changes WHERE turn_id = ? LIMIT 1').get(turnId) as { user_id?: string } | undefined;
    if (!any || any.user_id !== userId) throw new AiError('not_found', 'There are no changes to undo.', 404);
    throw new AiError('bad_request', 'These changes were already reverted.', 409);
  }
  if (rows.some((r) => r.user_id !== userId)) throw new AiError('forbidden', 'Only the person who made these changes can undo them.', 403);
  const threadId = rows[0].thread_id;
  const last = rows[rows.length - 1].created_time;
  if (threadId) {
    const later = db.prepare('SELECT 1 AS hit FROM ai_changes WHERE thread_id = ? AND turn_id != ? AND created_time > ? AND undone_time IS NULL LIMIT 1').get(threadId, turnId, last);
    if (later) throw new AiError('bad_request', 'Undo the latest change in this chat before undoing this one.', 409);
  }
  const state = new Map<string, BaseRecord | undefined>();
  const ops: Operation[] = [];
  let conflicts = 0;
  for (const r of [...rows].reverse()) {
    for (const step of JSON.parse(r.inverse) as InverseStep[]) {
      const k = key(step.op);
      const cur = state.has(k) ? state.get(k) : getRecord(step.op.pointer.table, step.op.pointer.id);
      if (!cur) continue;
      if (step.check && fingerprint(cur, step.check.path, step.check.keys) !== step.check.after) {
        conflicts++;
        continue;
      }
      ops.push(step.op);
      state.set(k, applyOperation(cur, step.op));
    }
  }
  if (ops.length) {
    try {
      applyTransactions(userId, [{ id: newId(), spaceId: rows[0].space_id ?? '', debug: { userAction: 'ai.agent.undo' }, operations: ops }], undefined, { client: true });
    } catch (e) {
      const status = (e as { status?: number })?.status;
      throw new AiError(status === 403 ? 'forbidden' : 'bad_request', 'That turn could not be undone. Try again.', status === 403 ? 403 : 400);
    }
  }
  const now = Date.now();
  db.prepare('UPDATE ai_changes SET undone_time = ? WHERE turn_id = ? AND undone_time IS NULL').run(now, turnId);
  return { reverted: ops.length, conflicts };
}
