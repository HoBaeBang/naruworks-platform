// Operations & transactions in Litpage's applyChanges shape:
// { pointer: { table, id, spaceId }, path: string[], command, args }
import type { Pointer, BaseRecord } from './records.ts';
import { applySplice, invertSplice, type TextSplice } from './textmerge.ts';

// spliceText: args = TextSplice ({ base, start, end, insert }) on a rich-text path such as ["properties","title"];
// the range is re-mapped onto the current text when others edited it meanwhile (see textmerge.ts).
export type Command = 'set' | 'update' | 'listAfter' | 'listBefore' | 'listRemove' | 'spliceText';

export interface Operation {
  pointer: Pointer;
  path: string[];
  command: Command;
  args: any;
}

export interface Transaction {
  id: string;
  spaceId: string;
  debug?: { userAction?: string; clientCommitTimeMs?: number };
  operations: Operation[];
}

export interface SaveTransactionsRequest {
  requestId: string;
  transactions: Transaction[];
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export function getAtPath(obj: any, path: string[]): any {
  let cur = obj;
  for (const p of path) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// Keys that would reach Object.prototype (prototype pollution) when used as a path segment or an update key.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeKey(k: unknown): string {
  if (typeof k !== 'string' || UNSAFE_KEYS.has(k)) throw new Error(`Invalid operation key ${String(k)}`);
  return k;
}

function ensurePath(obj: any, path: string[]): any {
  let cur = obj;
  for (const p of path) {
    safeKey(p);
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  return cur;
}

function setAtPath(obj: any, path: string[], value: any): any {
  if (path.length === 0) return clone(value);
  const parent = ensurePath(obj, path.slice(0, -1));
  const last = safeKey(path[path.length - 1]);
  if (value === undefined) delete parent[last];
  else parent[last] = clone(value);
  return obj;
}

/**
 * Apply one operation to a record value (returns a new object; input is not mutated).
 * `record` may be undefined for `set` with path [] (record creation).
 */
export function applyOperation<T extends BaseRecord>(record: T | undefined, op: Operation): T | undefined {
  const base: any = record ? structuredClone(record) : { id: op.pointer.id };
  switch (op.command) {
    case 'set': {
      if (op.path.length === 0) {
        const next = clone(op.args) ?? {};
        next.id = op.pointer.id;
        if (base.version !== undefined && next.version === undefined) next.version = base.version;
        return next;
      }
      return setAtPath(base, op.path, op.args);
    }
    case 'update': {
      const target = op.path.length ? ensurePath(base, op.path) : base;
      for (const [k, v] of Object.entries(op.args ?? {})) {
        safeKey(k);
        if (v === undefined) delete target[k];
        else target[k] = clone(v);
      }
      return base;
    }
    case 'listAfter':
    case 'listBefore':
    case 'listRemove': {
      const parent = op.path.length > 1 ? ensurePath(base, op.path.slice(0, -1)) : base;
      const key = safeKey(op.path[op.path.length - 1]);
      const arr: string[] = Array.isArray(parent[key]) ? [...parent[key]] : [];
      const id: string = op.args.id;
      const existing = arr.indexOf(id);
      if (existing >= 0) arr.splice(existing, 1);
      if (op.command !== 'listRemove') {
        if (op.command === 'listAfter') {
          const after = op.args.after ? arr.indexOf(op.args.after) : -1;
          if (op.args.after && after >= 0) arr.splice(after + 1, 0, id);
          else arr.push(id);
        } else {
          const before = op.args.before ? arr.indexOf(op.args.before) : -1;
          if (op.args.before && before >= 0) arr.splice(before, 0, id);
          else arr.unshift(id);
        }
      }
      parent[key] = arr;
      return base;
    }
    case 'spliceText': {
      const next = applySplice(getAtPath(base, op.path), op.args as TextSplice);
      return setAtPath(base, op.path, next);
    }
    default:
      throw new Error(`Unknown command ${(op as Operation).command}`);
  }
}

/** Inverse operation computed against the value *before* applying `op` (used for undo). */
export function invertOperation(before: BaseRecord | undefined, op: Operation): Operation {
  if (op.command === 'spliceText') {
    return { pointer: op.pointer, path: op.path, command: 'spliceText', args: invertSplice(getAtPath(before, op.path), op.args as TextSplice) };
  }
  if (op.command === 'set' && op.path.length === 0) {
    if (!before) return { pointer: op.pointer, path: [], command: 'update', args: { alive: false } };
    return { pointer: op.pointer, path: [], command: 'set', args: stripVersion(before) };
  }
  if (op.command === 'update') {
    const prev = getAtPath(before, op.path) ?? {};
    const args: Record<string, unknown> = {};
    for (const k of Object.keys(op.args ?? {})) args[k] = prev[k] === undefined ? undefined : clone(prev[k]);
    return { pointer: op.pointer, path: op.path, command: 'update', args };
  }
  const prevValue = getAtPath(before, op.path);
  return { pointer: op.pointer, path: op.path, command: 'set', args: prevValue === undefined ? undefined : clone(prevValue) };
}

function stripVersion(r: BaseRecord) {
  const { version: _v, ...rest } = r;
  return rest;
}

/** Records touched by a set of operations (deduplicated "table:id"). */
export function touchedKeys(ops: Operation[]): string[] {
  return [...new Set(ops.map((o) => `${o.pointer.table}:${o.pointer.id}`))];
}

export const op = {
  set: (pointer: Pointer, path: string[], args: any): Operation => ({ pointer, path, command: 'set', args }),
  update: (pointer: Pointer, path: string[], args: any): Operation => ({ pointer, path, command: 'update', args }),
  listAfter: (pointer: Pointer, path: string[], id: string, after?: string): Operation => ({ pointer, path, command: 'listAfter', args: after ? { id, after } : { id } }),
  listBefore: (pointer: Pointer, path: string[], id: string, before?: string): Operation => ({ pointer, path, command: 'listBefore', args: before ? { id, before } : { id } }),
  listRemove: (pointer: Pointer, path: string[], id: string): Operation => ({ pointer, path, command: 'listRemove', args: { id } }),
  spliceText: (pointer: Pointer, path: string[], splice: TextSplice): Operation => ({ pointer, path, command: 'spliceText', args: splice }),
};
