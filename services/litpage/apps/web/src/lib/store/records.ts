// Client record cache keyed by "table:id".
// Displayed value = pending local operations applied on top of the last known server value, so
// optimistic edits survive remote updates (rebase) and are dropped once the server acknowledges them.
import { applyOperation, type Operation } from '@nc/shared/ops.ts';
import type { BaseRecord, RecordMap, Role, Table } from '@nc/shared/records.ts';

interface Entry {
  server: BaseRecord | undefined;
  serverVersion: number;
  role: Role;
  pending: { txId: string; op: Operation }[];
  value: BaseRecord | undefined;
}

type Listener = () => void;

class RecordStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<Listener>>();
  private anyListeners = new Set<(keys: string[]) => void>();
  private batchDepth = 0;
  private dirty = new Set<string>();

  key(table: Table, id: string) {
    return `${table}:${id}`;
  }

  get<T extends BaseRecord = any>(table: Table, id: string | undefined | null): T | undefined {
    if (!id) return undefined;
    return this.entries.get(this.key(table, id))?.value as T | undefined;
  }

  role(table: Table, id: string | undefined | null): Role {
    if (!id) return 'none';
    return this.entries.get(this.key(table, id))?.role ?? 'none';
  }

  has(table: Table, id: string) {
    return this.entries.has(this.key(table, id));
  }

  all<T extends BaseRecord = any>(table: Table): T[] {
    const out: T[] = [];
    const prefix = `${table}:`;
    for (const [k, e] of this.entries) if (k.startsWith(prefix) && e.value) out.push(e.value as T);
    return out;
  }

  /** Merge a server recordMap (from loads, sync, transaction echoes or websocket pushes). */
  mergeRecordMap(rm: RecordMap | undefined, ackTxIds?: Set<string>) {
    if (!rm) return;
    this.batch(() => {
      for (const [table, recs] of Object.entries(rm)) {
        if (table === '__version__' || !recs) continue;
        for (const [id, entry] of Object.entries(recs as Record<string, any>)) {
          const v = entry?.value;
          const value = v?.value ?? v; // tolerate {value: rec}
          const role = (v?.role ?? 'reader') as Role;
          if (!value || typeof value !== 'object') continue;
          this.mergeServer(table as Table, id, value, role, ackTxIds);
        }
      }
    });
  }

  mergeServer(table: Table, id: string, value: BaseRecord, role: Role, ackTxIds?: Set<string>) {
    const k = this.key(table, id);
    const e = this.entries.get(k) ?? { server: undefined, serverVersion: -1, role, pending: [], value: undefined };
    const version = value.version ?? 0;
    if (ackTxIds && e.pending.length) e.pending = e.pending.filter((p) => !ackTxIds.has(p.txId));
    // the server lists the last transactions applied to this record: a pending op already contained in this value
    // must not be applied again (text splices aren't idempotent) — e.g. a websocket push that overtook our ack
    const applied = (value as any).applied_tx_ids as string[] | undefined;
    if (applied?.length && e.pending.length && version >= e.serverVersion) e.pending = e.pending.filter((p) => !applied.includes(p.txId));
    if (version >= e.serverVersion) {
      e.server = value;
      e.serverVersion = version;
      e.role = role;
    }
    e.value = this.recompute(e);
    this.entries.set(k, e);
    this.markDirty(k);
  }

  private recompute(e: Entry): BaseRecord | undefined {
    let v = e.server;
    for (const p of e.pending) v = applyOperation(v, p.op);
    return v;
  }

  /** Optimistically apply a local operation; returns the value before the operation (for inverses). */
  applyLocal(txId: string, op: Operation): BaseRecord | undefined {
    const k = this.key(op.pointer.table, op.pointer.id);
    const e = this.entries.get(k) ?? { server: undefined, serverVersion: -1, role: 'editor' as Role, pending: [], value: undefined };
    const before = e.value;
    e.pending.push({ txId, op });
    e.value = applyOperation(e.value, op);
    if (e.role === 'none') e.role = 'editor';
    this.entries.set(k, e);
    this.markDirty(k);
    return before;
  }

  /** Drop pending ops of failed transactions (server rejected) and restore server values. */
  rejectTransactions(txIds: Set<string>) {
    this.batch(() => {
      for (const [k, e] of this.entries) {
        if (!e.pending.some((p) => txIds.has(p.txId))) continue;
        e.pending = e.pending.filter((p) => !txIds.has(p.txId));
        e.value = this.recompute(e);
        this.markDirty(k);
      }
    });
  }

  /** Acknowledge transactions whose records were not echoed (no-op ops). */
  ackTransactions(txIds: Set<string>) {
    this.batch(() => {
      for (const [k, e] of this.entries) {
        if (!e.pending.some((p) => txIds.has(p.txId))) continue;
        // keep displayed value; fold acknowledged ops into the server base
        let base = e.server;
        const rest: Entry['pending'] = [];
        for (const p of e.pending) {
          if (txIds.has(p.txId)) base = applyOperation(base, p.op);
          else rest.push(p);
        }
        e.server = base;
        e.pending = rest;
        e.value = this.recompute(e);
        this.markDirty(k);
      }
    });
  }

  hasPending(): boolean {
    for (const e of this.entries.values()) if (e.pending.length) return true;
    return false;
  }

  subscribe(key: string, fn: Listener): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.listeners.delete(key);
    };
  }

  subscribeAll(fn: (keys: string[]) => void): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  batch(fn: () => void) {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.flush();
    }
  }

  private markDirty(k: string) {
    this.dirty.add(k);
    if (this.batchDepth === 0) this.flush();
  }

  private flush() {
    if (!this.dirty.size) return;
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const k of keys) for (const fn of this.listeners.get(k) ?? []) fn();
    for (const fn of this.anyListeners) fn(keys);
  }
}

export const records = new RecordStore();
(globalThis as any).__records = records;
