// Transactions: group operations (applied optimistically), send them to /api/rpc/applyChanges in

import { invertOperation, op as mk, type Operation, type Transaction } from '@nc/shared/ops.ts';
import type { Pointer, Table } from '@nc/shared/records.ts';
import type { TextSplice } from '@nc/shared/textmerge.ts';
import { api, ApiError } from '../api.ts';
import { records } from './records.ts';
import { markTyping } from './typing.ts';

export interface SelectionSnapshot {
  blockId?: string;
  offset?: number;
  end?: number;
  property?: string;
}

interface HistoryEntry {
  ops: Operation[];
  inverse: Operation[];
  spaceId: string;
  coalesceKey?: string;
  time: number;
  selectionBefore?: SelectionSnapshot;
  selectionAfter?: SelectionSnapshot;
  userAction: string;
}

export class Tx {
  id = crypto.randomUUID();
  ops: Operation[] = [];
  inverse: Operation[] = [];
  spaceId: string;
  userAction: string;
  skipHistory = false;
  coalesceKey?: string;
  selectionBefore?: SelectionSnapshot;
  selectionAfter?: SelectionSnapshot;

  constructor(spaceId: string, userAction: string) {
    this.spaceId = spaceId;
    this.userAction = userAction;
  }

  private ptr(table: Table, id: string): Pointer {
    return { table, id, spaceId: this.spaceId };
  }

  apply(o: Operation) {
    if (!o.pointer.spaceId) o.pointer.spaceId = this.spaceId;
    const before = records.applyLocal(this.id, o);
    this.ops.push(o);
    this.inverse.push(invertOperation(before, o));
    return this;
  }

  set(table: Table, id: string, path: string[], args: any) {
    return this.apply(mk.set(this.ptr(table, id), path, args));
  }
  update(table: Table, id: string, path: string[], args: any) {
    return this.apply(mk.update(this.ptr(table, id), path, args));
  }
  listAfter(table: Table, id: string, path: string[], itemId: string, after?: string) {
    return this.apply(mk.listAfter(this.ptr(table, id), path, itemId, after));
  }
  listBefore(table: Table, id: string, path: string[], itemId: string, before?: string) {
    return this.apply(mk.listBefore(this.ptr(table, id), path, itemId, before));
  }
  listRemove(table: Table, id: string, path: string[], itemId: string) {
    return this.apply(mk.listRemove(this.ptr(table, id), path, itemId));
  }
  /** Rich-text edit as a splice against the text this client saw (merges with concurrent edits, see textmerge.ts). */
  spliceText(table: Table, id: string, path: string[], splice: TextSplice) {
    return this.apply(mk.spliceText(this.ptr(table, id), path, splice));
  }
}

type SaveListener = (state: { pending: number; error: string | null }) => void;

class TransactionManager {
  private outbox: Transaction[] = [];
  private inflight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private saveListeners = new Set<SaveListener>();
  private lastError: string | null = null;
  onError: ((message: string) => void) | null = null;
  onSelectionRestore: ((sel: SelectionSnapshot | undefined) => void) | null = null;

  /** Run `fn` inside a new transaction and commit it. */
  run(spaceId: string, userAction: string, fn: (tx: Tx) => void, opts?: { coalesceKey?: string; skipHistory?: boolean; selectionBefore?: SelectionSnapshot; selectionAfter?: SelectionSnapshot }) {
    const tx = new Tx(spaceId, userAction);
    tx.coalesceKey = opts?.coalesceKey;
    tx.skipHistory = !!opts?.skipHistory;
    tx.selectionBefore = opts?.selectionBefore;
    tx.selectionAfter = opts?.selectionAfter;
    records.batch(() => {
      fn(tx);
      for (const hook of this.commitHooks) hook(tx);
    });
    this.commit(tx);
    return tx;
  }

  private commitHooks: ((tx: Tx) => void)[] = [];
  /** Extend every transaction before it is committed, inside the same undo step (e.g. database dependency date
   *  shifts). Hooks see the ops added by the action and may append more. Returns an unregister function. */
  addCommitHook(fn: (tx: Tx) => void) {
    this.commitHooks.push(fn);
    return () => {
      this.commitHooks = this.commitHooks.filter((h) => h !== fn);
    };
  }

  commit(tx: Tx) {
    if (!tx.ops.length) return;
    if (tx.userAction === 'Text.handleMutation') markTyping();
    // copies: the undo stack coalesces later typing into its entry, which must never alter an unsent transaction
    this.outbox.push({ id: tx.id, spaceId: tx.spaceId, debug: { userAction: tx.userAction, clientCommitTimeMs: Date.now() }, operations: [...tx.ops] });
    if (!tx.skipHistory) {
      const top = this.undoStack[this.undoStack.length - 1];
      const now = Date.now();
      if (top && tx.coalesceKey && top.coalesceKey === tx.coalesceKey && now - top.time < 1200) {
        top.ops.push(...tx.ops);
        top.inverse.push(...tx.inverse);
        top.time = now;
        top.selectionAfter = tx.selectionAfter ?? top.selectionAfter;
      } else {
        this.undoStack.push({ ops: [...tx.ops], inverse: [...tx.inverse], spaceId: tx.spaceId, coalesceKey: tx.coalesceKey, time: now, selectionBefore: tx.selectionBefore, selectionAfter: tx.selectionAfter, userAction: tx.userAction });
        if (this.undoStack.length > 200) this.undoStack.shift();
      }
      this.redoStack = [];
    }
    this.schedule();
  }

  /** Break typing coalescing so the next edit becomes its own undo step. */
  breakCoalescing() {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.coalesceKey = undefined;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const tx = new Tx(entry.spaceId, 'undo');
    records.batch(() => {
      for (let i = entry.inverse.length - 1; i >= 0; i--) tx.apply(structuredClone(entry.inverse[i]));
    });
    this.commitRaw(tx);
    this.redoStack.push({ ...entry, ops: entry.ops, inverse: entry.inverse });
    this.onSelectionRestore?.(entry.selectionBefore);
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const tx = new Tx(entry.spaceId, 'redo');
    records.batch(() => {
      for (const o of entry.ops) tx.apply(structuredClone(o));
    });
    this.commitRaw(tx);
    this.undoStack.push({ ...entry, inverse: tx.inverse, time: 0, coalesceKey: undefined });
    this.onSelectionRestore?.(entry.selectionAfter);
    return true;
  }

  private commitRaw(tx: Tx) {
    if (!tx.ops.length) return;
    this.outbox.push({ id: tx.id, spaceId: tx.spaceId, debug: { userAction: tx.userAction, clientCommitTimeMs: Date.now() }, operations: [...tx.ops] });
    this.schedule();
  }

  private schedule() {
    this.emit();
    if (this.timer || this.inflight) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 80);
  }

  async flush(): Promise<void> {
    if (this.inflight || !this.outbox.length) return;
    this.inflight = true;
    const batch = this.outbox.splice(0, 50);
    const ids = new Set(batch.map((t) => t.id));
    try {
      const res = await api<{ recordMap?: any }>('applyChanges', { requestId: crypto.randomUUID(), transactions: batch.map(wireTransaction) });
      records.batch(() => {
        records.mergeRecordMap(res.recordMap, ids);
        records.ackTransactions(ids);
      });
      this.lastError = null;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        records.rejectTransactions(ids);
        this.lastError = e.message;
        this.onError?.(e.status === 403 ? "You don't have permission to edit this." : e.message);
      } else {
        // network/server failure: retry later, keeping order
        this.outbox.unshift(...batch);
        this.lastError = 'offline';
        this.inflight = false;
        setTimeout(() => void this.flush(), 2000);
        this.emit();
        return;
      }
    }
    this.inflight = false;
    this.emit();
    if (this.outbox.length) void this.flush();
  }

  pendingCount() {
    return this.outbox.length + (this.inflight ? 1 : 0);
  }

  onSaveState(fn: SaveListener) {
    this.saveListeners.add(fn);
    return () => this.saveListeners.delete(fn);
  }

  private emit() {
    const s = { pending: this.pendingCount(), error: this.lastError };
    for (const fn of this.saveListeners) fn(s);
  }
}

export const transactions = new TransactionManager();

window.addEventListener('beforeunload', (e) => {
  if (transactions.pendingCount() > 0) {
    void transactions.flush();
    e.preventDefault();
  }
});

/** JSON drops `undefined`, so an `update` that clears a key (`{ block_color: undefined }`, applied locally as a
 *  delete) would never reach the server. Send those keys as `null` so the clear persists. */
function wireTransaction<T extends { operations: { command: string; args?: any }[] }>(t: T): T {
  if (!t.operations.some((op) => op.command === 'update' && op.args && Object.values(op.args).includes(undefined))) return t;
  return {
    ...t,
    operations: t.operations.map((op) => {
      if (op.command !== 'update' || !op.args || typeof op.args !== 'object') return op;
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.args)) args[k] = v === undefined ? null : v;
      return { ...op, args };
    }),
  };
}
