// Data source query (POST /v1/data_sources/{id}/query, legacy /v1/databases/{id}/query): public API filter objects
// (property / timestamp conditions, compound and/or up to two levels deep) and sorts over the rows the principal can
// see. Rows arrive already redacted (property access rules): a filter or sort on a property the principal can't see is
// refused like an unknown property, so hidden values can't be probed through filters either.
import type { BlockRecord, PropertySchema } from '@nc/shared/records.ts';
import { compareValues, getPropertyValue, isEmptyValue } from '@nc/shared/database/values.ts';
import { dateValueToRange } from '@nc/shared/database/dates.ts';
import type { PropertyValue, QueryContext } from '@nc/shared/database/types.ts';
import { invalid } from './errors.ts';
import { dateFromApi } from './richtext.ts';
import { findProperty } from './inputs.ts';

type Json = Record<string, any>;
type Schema = Record<string, PropertySchema>;
export type RowPredicate = (row: BlockRecord) => boolean;

const DAY = 86_400_000;

function textOf(v: PropertyValue): string {
  switch (v.kind) {
    case 'text': return v.text;
    case 'select': return v.options.map((o) => o.value).join(', ');
    case 'status': return v.option?.value ?? '';
    case 'number': return v.number === null ? '' : String(v.number);
    case 'checkbox': return v.checked ? 'true' : 'false';
    default: return '';
  }
}

function textCondition(cond: Json, get: (r: BlockRecord) => string, path: string): RowPredicate {
  const [op, arg] = single(cond, path);
  const s = String(arg ?? '').toLowerCase();
  switch (op) {
    case 'equals': return (r) => get(r).toLowerCase() === s;
    case 'does_not_equal': return (r) => get(r).toLowerCase() !== s;
    case 'contains': return (r) => get(r).toLowerCase().includes(s);
    case 'does_not_contain': return (r) => !get(r).toLowerCase().includes(s);
    case 'starts_with': return (r) => get(r).toLowerCase().startsWith(s);
    case 'ends_with': return (r) => get(r).toLowerCase().endsWith(s);
    case 'is_empty': return (r) => !get(r);
    case 'is_not_empty': return (r) => !!get(r);
    default: throw invalid(`Invalid request: ${path} must specify one of equals, does_not_equal, contains, does_not_contain, starts_with, ends_with, is_empty, is_not_empty.`);
  }
}

function numberCondition(cond: Json, get: (r: BlockRecord) => number | null, path: string): RowPredicate {
  const [op, arg] = single(cond, path);
  if (op === 'is_empty') return (r) => get(r) === null;
  if (op === 'is_not_empty') return (r) => get(r) !== null;
  if (typeof arg !== 'number') throw invalid(`Invalid request: ${path}.${op} must be a number.`);
  const cmp = (f: (n: number) => boolean) => (r: BlockRecord) => {
    const n = get(r);
    return n !== null && f(n);
  };
  switch (op) {
    case 'equals': return cmp((n) => n === arg);
    case 'does_not_equal': return (r) => get(r) !== arg;
    case 'greater_than': return cmp((n) => n > arg);
    case 'less_than': return cmp((n) => n < arg);
    case 'greater_than_or_equal_to': return cmp((n) => n >= arg);
    case 'less_than_or_equal_to': return cmp((n) => n <= arg);
    default: throw invalid(`Invalid request: ${path} must specify a number condition.`);
  }
}

function startOfWeek(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function dateCondition(cond: Json, get: (r: BlockRecord) => { start: number; day: string } | null, path: string, now: number): RowPredicate {
  const [op, arg] = single(cond, path);
  if (op === 'is_empty') return (r) => !get(r);
  if (op === 'is_not_empty') return (r) => !!get(r);
  const range = (from: number, to: number) => (r: BlockRecord) => {
    const v = get(r);
    return !!v && v.start >= from && v.start <= to;
  };
  switch (op) {
    case 'past_week': return range(now - 7 * DAY, now);
    case 'past_month': return range(now - 31 * DAY, now);
    case 'past_year': return range(now - 365 * DAY, now);
    case 'next_week': return range(now, now + 7 * DAY);
    case 'next_month': return range(now, now + 31 * DAY);
    case 'next_year': return range(now, now + 365 * DAY);
    case 'this_week': { const s = startOfWeek(now); return range(s, s + 7 * DAY - 1); }
  }
  const v = dateFromApi({ start: arg }, `${path}.${op}`);
  const at = dateValueToRange(v);
  if (!v || !at) throw invalid(`Invalid request: ${path}.${op} must be a date.`);
  const dayOnly = !v.start_time;
  switch (op) {
    case 'equals': return (r) => { const x = get(r); return !!x && (dayOnly ? x.day === v.start_date : x.start === at.startMs); };
    case 'before': return (r) => { const x = get(r); return !!x && x.start < at.startMs; };
    case 'after': return (r) => { const x = get(r); return !!x && (dayOnly ? x.start >= at.startMs + DAY : x.start > at.startMs); };
    case 'on_or_before': return (r) => { const x = get(r); return !!x && (dayOnly ? x.start < at.startMs + DAY : x.start <= at.startMs); };
    case 'on_or_after': return (r) => { const x = get(r); return !!x && x.start >= at.startMs; };
    default: throw invalid(`Invalid request: ${path} must specify a date condition.`);
  }
}

function listCondition(cond: Json, get: (r: BlockRecord) => string[], path: string, lower = false): RowPredicate {
  const [op, arg] = single(cond, path);
  const want = lower ? String(arg ?? '').toLowerCase() : String(arg ?? '').replace(/-/g, '');
  const norm = (x: string) => (lower ? x.toLowerCase() : x.replace(/-/g, ''));
  switch (op) {
    case 'contains': return (r) => get(r).some((x) => norm(x) === want);
    case 'does_not_contain': return (r) => !get(r).some((x) => norm(x) === want);
    case 'is_empty': return (r) => !get(r).length;
    case 'is_not_empty': return (r) => get(r).length > 0;
    default: throw invalid(`Invalid request: ${path} must specify one of contains, does_not_contain, is_empty, is_not_empty.`);
  }
}

function single(cond: unknown, path: string): [string, unknown] {
  if (!cond || typeof cond !== 'object') throw invalid(`Invalid request: ${path} must be an object.`);
  const keys = Object.keys(cond as Json);
  if (keys.length !== 1) throw invalid(`Invalid request: ${path} must specify exactly one condition.`);
  return [keys[0], (cond as Json)[keys[0]]];
}

function dateOf(v: PropertyValue): { start: number; day: string } | null {
  return v.kind === 'date' && v.date ? { start: v.date.startMs, day: v.date.start } : null;
}

/** public API filter → predicate over (redacted) rows. */
export function compileFilter(filter: unknown, schema: Schema, ctx: QueryContext, path = 'filter', depth = 0): RowPredicate {
  if (filter === undefined || filter === null) return () => true;
  if (typeof filter !== 'object' || Array.isArray(filter)) throw invalid(`Invalid request: ${path} must be an object.`);
  const f = filter as Json;
  const now = ctx.now ?? Date.now();
  if (Array.isArray(f.and) || Array.isArray(f.or)) {
    if (depth >= 2) throw invalid(`Invalid request: ${path} exceeds the maximum filter depth of 2.`);
    const list = (f.and ?? f.or) as unknown[];
    if (list.length > 100) throw invalid(`Invalid request: ${path} has too many filters.`);
    const parts = list.map((x, i) => compileFilter(x, schema, ctx, `${path}.${f.and ? 'and' : 'or'}[${i}]`, depth + 1));
    return f.and ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r));
  }
  if (f.timestamp === 'created_time' || f.timestamp === 'last_edited_time') {
    const key = f.timestamp as 'created_time' | 'last_edited_time';
    return dateCondition(f[key], (r) => {
      const ms = key === 'created_time' ? r.created_time : (r.last_edited_time ?? r.created_time);
      return ms ? { start: ms, day: new Date(ms).toISOString().slice(0, 10) } : null;
    }, `${path}.${key}`, now);
  }
  if (typeof f.property !== 'string') throw invalid(`Invalid request: ${path} must specify a property or timestamp.`);
  const pid = findProperty(schema, f.property);
  if (!pid) throw invalid(`No property named or identified by ${f.property} is available to this connection.`);
  const prop = schema[pid];
  const val = (r: BlockRecord) => getPropertyValue(r, pid, schema, ctx);
  const typeKey = Object.keys(f).find((k) => k !== 'property');
  if (!typeKey) throw invalid(`Invalid request: ${path} must specify a condition for ${f.property}.`);
  const cond = f[typeKey];
  const cpath = `${path}.${typeKey}`;
  switch (typeKey) {
    case 'title': case 'rich_text': case 'url': case 'email': case 'phone_number':
      return textCondition(cond, (r) => textOf(val(r)), cpath);
    case 'number': case 'unique_id':
      return numberCondition(cond, (r) => { const v = val(r); return v.kind === 'number' ? v.number : null; }, cpath);
    case 'checkbox': {
      const [op, arg] = single(cond, cpath);
      if (typeof arg !== 'boolean') throw invalid(`Invalid request: ${cpath}.${op} must be a boolean.`);
      return op === 'does_not_equal' ? (r) => { const v = val(r); return (v.kind === 'checkbox' && v.checked) !== arg; } : (r) => { const v = val(r); return (v.kind === 'checkbox' && v.checked) === arg; };
    }
    case 'select': case 'status': {
      const name = (r: BlockRecord) => { const v = val(r); return v.kind === 'select' ? v.options[0]?.value ?? '' : v.kind === 'status' ? v.option?.value ?? '' : ''; };
      const [op, arg] = single(cond, cpath);
      if (op === 'equals') return (r) => name(r).toLowerCase() === String(arg).toLowerCase();
      if (op === 'does_not_equal') return (r) => name(r).toLowerCase() !== String(arg).toLowerCase();
      if (op === 'is_empty') return (r) => !name(r);
      if (op === 'is_not_empty') return (r) => !!name(r);
      throw invalid(`Invalid request: ${cpath} must specify one of equals, does_not_equal, is_empty, is_not_empty.`);
    }
    case 'multi_select':
      return listCondition(cond, (r) => { const v = val(r); return v.kind === 'select' ? v.options.map((o) => o.value) : []; }, cpath, true);
    case 'date': case 'created_time': case 'last_edited_time':
      return dateCondition(cond, (r) => dateOf(val(r)), cpath, now);
    case 'people': case 'created_by': case 'last_edited_by':
      return listCondition(cond, (r) => { const v = val(r); return v.kind === 'person' ? v.ids : []; }, cpath);
    case 'relation':
      return listCondition(cond, (r) => { const v = val(r); return v.kind === 'relation' ? v.ids : []; }, cpath);
    case 'files': {
      const [op] = single(cond, cpath);
      if (op === 'is_empty') return (r) => isEmptyValue(val(r));
      if (op === 'is_not_empty') return (r) => !isEmptyValue(val(r));
      throw invalid(`Invalid request: ${cpath} must specify is_empty or is_not_empty.`);
    }
    case 'formula': {
      const [kind, sub] = single(cond, cpath);
      if (kind === 'string') return textCondition(sub as Json, (r) => textOf(val(r)), `${cpath}.string`);
      if (kind === 'number') return numberCondition(sub as Json, (r) => { const v = val(r); return v.kind === 'number' ? v.number : null; }, `${cpath}.number`);
      if (kind === 'checkbox') return compileFilter({ property: f.property, checkbox: sub }, schema, ctx, path, depth);
      if (kind === 'date') return dateCondition(sub as Json, (r) => dateOf(val(r)), `${cpath}.date`, now);
      throw invalid(`Invalid request: ${cpath} must specify string, number, checkbox or date.`);
    }
    case 'rollup': {
      const [kind, sub] = single(cond, cpath);
      if (kind === 'number') return numberCondition(sub as Json, (r) => { const v = val(r); return v.kind === 'number' ? v.number : null; }, `${cpath}.number`);
      if (kind === 'date') return dateCondition(sub as Json, (r) => dateOf(val(r)), `${cpath}.date`, now);
      if (kind === 'any' || kind === 'every' || kind === 'none') {
        const items = (r: BlockRecord): PropertyValue[] => { const v = val(r); return v.kind === 'array' ? v.items : [v]; };
        const [ik, isub] = single(sub, `${cpath}.${kind}`);
        const test = (v: PropertyValue): boolean => {
          if (ik === 'rich_text') return textCondition(isub as Json, () => textOf(v), `${cpath}.${kind}.rich_text`)({} as BlockRecord);
          if (ik === 'number') return numberCondition(isub as Json, () => (v.kind === 'number' ? v.number : null), `${cpath}.${kind}.number`)({} as BlockRecord);
          if (ik === 'date') return dateCondition(isub as Json, () => dateOf(v), `${cpath}.${kind}.date`, now)({} as BlockRecord);
          throw invalid(`Invalid request: ${cpath}.${kind} must specify rich_text, number or date.`);
        };
        if (kind === 'any') return (r) => items(r).some(test);
        if (kind === 'every') return (r) => items(r).every(test);
        return (r) => !items(r).some(test);
      }
      throw invalid(`Invalid request: ${cpath} must specify any, every, none, number or date.`);
    }
    default:
      throw invalid(`Invalid request: ${path}.${typeKey} doesn’t match the type of property ${prop.name} (${prop.type}).`);
  }
}

export interface SortSpec {
  pid?: string;
  timestamp?: 'created_time' | 'last_edited_time';
  dir: 1 | -1;
}

export function compileSorts(raw: unknown, schema: Schema): SortSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw invalid('Invalid request: body.sorts must be an array.');
  if (raw.length > 100) throw invalid('Invalid request: body.sorts.length must be ≤ `100`.');
  return raw.map((s, i) => {
    const o = (s ?? {}) as Json;
    const dir = o.direction === 'descending' ? -1 : o.direction === 'ascending' || o.direction === undefined ? 1 : null;
    if (dir === null) throw invalid(`Invalid request: body.sorts[${i}].direction must be "ascending" or "descending".`);
    if (o.timestamp === 'created_time' || o.timestamp === 'last_edited_time') return { timestamp: o.timestamp, dir };
    if (typeof o.property !== 'string') throw invalid(`Invalid request: body.sorts[${i}] must specify a property or timestamp.`);
    const pid = findProperty(schema, o.property);
    if (!pid) throw invalid(`No sort property named or identified by ${o.property} is available to this connection.`);
    return { pid, dir };
  });
}

/** Sort rows (empty values last); default: newest first. */
export function sortRows(rows: BlockRecord[], sorts: SortSpec[], schema: Schema, ctx: QueryContext): BlockRecord[] {
  const specs = sorts.length ? sorts : [{ timestamp: 'created_time' as const, dir: -1 as const }];
  return [...rows].sort((a, b) => {
    for (const s of specs) {
      if (s.timestamp) {
        const ta = s.timestamp === 'created_time' ? a.created_time : (a.last_edited_time ?? a.created_time);
        const tb = s.timestamp === 'created_time' ? b.created_time : (b.last_edited_time ?? b.created_time);
        if (ta !== tb) return (ta - tb) * s.dir;
        continue;
      }
      const va = getPropertyValue(a, s.pid!, schema, ctx);
      const vb = getPropertyValue(b, s.pid!, schema, ctx);
      const ea = isEmptyValue(va);
      const eb = isEmptyValue(vb);
      if (ea !== eb) return ea ? 1 : -1;
      if (ea) continue;
      const c = compareValues(va, vb, schema[s.pid!], ctx);
      if (c) return c * s.dir;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
