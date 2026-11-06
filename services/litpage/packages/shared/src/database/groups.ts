// Group-by (board columns, table/list/gallery groups) and sub-groups.
// GroupBy / group value shapes: board_columns / collection_groups with {property, value:{type, value?}, hidden?}.
import type { BlockRecord, PropertySchema, SelectOption } from '../records.ts';
import { addDays, addMonths, addYears, formatDay, monthLabel, msToYmd, relativeBucket, RELATIVE_BUCKET_LABELS, relativeBucketRank, startOfDay, startOfMonth, startOfWeek, startOfYear, weekLabel, ymdToMs } from './dates.ts';
import { formatNumber } from './numbers.ts';
import type { GroupBy, GroupResult, GroupValue, PropertyValue, QueryContext, SavedGroup, Schema, StatusGroup } from './types.ts';
import { getPropertyValue, pageTitle, userName, valueToText } from './values.ts';

/** Canonical key of a group value (stable JSON with sorted keys). */
export function groupKey(v: GroupValue | undefined): string {
  return stableStringify(v ?? {});
}

function stableStringify(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x ?? null);
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

interface Candidate {
  value: GroupValue;
  label: string;
  color?: string;
  option?: SelectOption;
  rank: number;
  uncategorized: boolean;
}

function dateMode(gb: GroupBy): string {
  return typeof gb.groupBy === 'string' ? gb.groupBy : 'relative';
}

function resultKind(prop: PropertySchema, sample: PropertyValue | undefined): string {
  if (prop.type !== 'formula' && prop.type !== 'rollup') return prop.type;
  switch (sample?.kind) {
    case 'number': return 'number';
    case 'checkbox': return 'checkbox';
    case 'date': return 'date';
    case 'person': return 'person';
    case 'relation': return 'relation';
    case 'select': return 'select';
    default: return 'text';
  }
}

/** Group values a single row falls into (multi-value properties → several). */
function bucketsFor(v: PropertyValue, prop: PropertySchema, gb: GroupBy, kind: string, ctx: QueryContext): Candidate[] {
  const type = gb.type || prop.type;
  const now = ctx.now ?? Date.now();
  const none = (): Candidate[] => [];
  switch (kind) {
    case 'select':
    case 'multi_select':
      if (v.kind !== 'select') return none();
      return v.options.map((o, i) => ({ value: { type, value: o.value }, label: o.value, color: o.color, option: o, rank: i, uncategorized: false }));
    case 'status': {
      if (v.kind !== 'status' || !v.option) return none();
      if (gb.groupBy === 'group') {
        const g = v.group;
        if (!g) return none();
        return [{ value: { type: 'status', value: { type: 'by_group', group: g.name } }, label: g.name, color: g.color, rank: 0, uncategorized: false }];
      }
      return [{ value: { type: 'status', value: { type: 'by_option', option: v.option.value } }, label: v.option.value, color: v.option.color, option: v.option, rank: 0, uncategorized: false }];
    }
    case 'checkbox': {
      const checked = v.kind === 'checkbox' ? v.checked : false;
      return [{ value: { type: 'checkbox', value: checked }, label: checked ? 'Checked' : 'Unchecked', rank: checked ? 1 : 0, uncategorized: false }];
    }
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      if (v.kind !== 'person') return none();
      return v.ids.map((id) => ({ value: { type, value: { id, table: 'lit_user' } }, label: userName(id, ctx) || 'Unknown', rank: 0, uncategorized: false }));
    case 'relation':
      if (v.kind !== 'relation') return none();
      return v.ids.map((id) => ({ value: { type: 'relation', value: { id, table: 'block' } }, label: pageTitle(id, ctx) || 'Untitled', rank: 0, uncategorized: false }));
    case 'date':
    case 'created_time':
    case 'last_edited_time':
    case 'last_visited_time': {
      if (v.kind !== 'date' || !v.date) return none();
      const ms = startOfDay(v.date.startMs);
      const mode = dateMode(gb);
      if (mode === 'relative') {
        const b = relativeBucket(ms, now);
        const label = b.range ? monthLabel(ymdToMs(b.range.start_date)) : RELATIVE_BUCKET_LABELS[b.type];
        return [{ value: { type, value: b.range ? { type: b.type, range: b.range } : { type: b.type } }, label, rank: relativeBucketRank(b, now), uncategorized: false }];
      }
      let s = ms;
      let e = ms;
      let label = '';
      if (mode === 'day') label = formatDay(ms, 'MMM DD, YYYY');
      else if (mode === 'week') {
        s = startOfWeek(ms, gb.startDayOfWeek ?? ctx.startOfWeek ?? 0);
        e = addDays(s, 6);
        label = weekLabel(s);
      } else if (mode === 'month') {
        s = startOfMonth(ms);
        e = addDays(addMonths(s, 1), -1);
        label = monthLabel(s);
      } else {
        s = startOfYear(ms);
        e = addDays(addYears(s, 1), -1);
        label = String(new Date(s).getFullYear());
      }
      return [{ value: { type, value: { type: mode, range: { type: 'daterange', start_date: msToYmd(s), end_date: msToYmd(e) } } }, label, rank: s, uncategorized: false }];
    }
    case 'number': {
      const n = v.kind === 'number' ? v.number : null;
      if (n === null) return none();
      const g = typeof gb.groupBy === 'object' ? gb.groupBy : undefined;
      if (!g || g.type === 'unique') {
        return [{ value: { type: 'number', value: { type: 'unique', value: n } }, label: formatNumber(n, prop.number_format as string | undefined), rank: n, uncategorized: false }];
      }
      const start = gb.start ?? g.start ?? 0;
      const end = gb.end ?? g.end ?? 1000;
      const size = Math.max(1e-9, gb.size ?? g.size ?? 100);
      if (n < start || n >= end) return [{ value: { type: 'number', value: { type: 'out_of_range' } }, label: 'Outside range', rank: Number.MAX_SAFE_INTEGER, uncategorized: false }];
      const lo = start + Math.floor((n - start) / size) * size;
      const hi = Math.min(lo + size, end);
      return [{ value: { type: 'number', value: { type: 'range', start: lo, end: hi } }, label: `${formatNumber(lo)} through ${formatNumber(hi)}`, rank: lo, uncategorized: false }];
    }
    default: {
      const text = valueToText(v, prop, ctx).trim();
      if (!text) return none();
      if (gb.groupBy === 'alphabet_prefix') {
        const ch = text[0].toUpperCase();
        if (!/\p{L}/u.test(ch)) return [{ value: { type: 'text', value: { type: 'other' } }, label: 'Other', rank: 0, uncategorized: false }];
        return [{ value: { type: 'text', value: { type: 'alphabet_prefix', value: ch } }, label: ch, rank: 0, uncategorized: false }];
      }
      return [{ value: { type: 'text', value: { type: 'exact', value: text } }, label: text, rank: 0, uncategorized: false }];
    }
  }
}

/** Groups that exist even without rows (select/status options, checkbox states). */
function staticCandidates(prop: PropertySchema, gb: GroupBy, kind: string): Candidate[] {
  const type = gb.type || prop.type;
  if (kind === 'select' || kind === 'multi_select') {
    return (prop.options ?? []).map((o, i) => ({ value: { type, value: o.value }, label: o.value, color: o.color, option: o, rank: i, uncategorized: false }));
  }
  if (kind === 'status') {
    const groups = (prop.groups ?? []) as StatusGroup[];
    if (gb.groupBy === 'group') return groups.map((g, i) => ({ value: { type: 'status', value: { type: 'by_group', group: g.name } }, label: g.name, color: g.color, rank: i, uncategorized: false }));
    const ordered: SelectOption[] = [];
    for (const g of groups) for (const id of g.optionIds ?? []) {
      const o = prop.options?.find((x) => x.id === id);
      if (o && !ordered.includes(o)) ordered.push(o);
    }
    for (const o of prop.options ?? []) if (!ordered.includes(o)) ordered.push(o);
    return ordered.map((o, i) => ({ value: { type: 'status', value: { type: 'by_option', option: o.value } }, label: o.value, color: o.color, option: o, rank: i, uncategorized: false }));
  }
  if (kind === 'checkbox') {
    return [
      { value: { type: 'checkbox', value: false }, label: 'Unchecked', rank: 0, uncategorized: false },
      { value: { type: 'checkbox', value: true }, label: 'Checked', rank: 1, uncategorized: false },
    ];
  }
  return [];
}

export interface ComputeGroupsOptions {
  saved?: SavedGroup[];
  /** board columns keep empty option groups visible unless hideEmptyGroups */
  board?: boolean;
}

/**
 * Split (already filtered + sorted) rows into groups. Rows keep their relative order inside groups;
 * multi-value properties place a row in several groups.
 */
export function computeGroups(rows: BlockRecord[], gb: GroupBy, schema: Schema, ctx: QueryContext, opts: ComputeGroupsOptions = {}): GroupResult[] {
  const prop = schema[gb.property];
  if (!prop) return [];
  const values = rows.map((r) => getPropertyValue(r, gb.property, schema, ctx));
  const kind = resultKind(prop, values.find((v) => v.kind !== 'text' || v.text));
  const byKey = new Map<string, { c: Candidate; rows: BlockRecord[] }>();
  const add = (c: Candidate) => {
    const k = groupKey(c.value);
    if (!byKey.has(k)) byKey.set(k, { c, rows: [] });
    return byKey.get(k)!;
  };
  const uncategorized: Candidate = { value: { type: gb.type || prop.type }, label: `No ${prop.name}`, rank: -1, uncategorized: true };
  for (const c of staticCandidates(prop, gb, kind)) add(c);
  const uncatEntry = add(uncategorized);
  rows.forEach((row, i) => {
    const buckets = bucketsFor(values[i], prop, gb, kind, ctx);
    if (!buckets.length) {
      uncatEntry.rows.push(row);
      return;
    }
    for (const b of buckets) {
      const e = add(b);
      if (!e.rows.includes(row)) e.rows.push(row);
    }
  });

  // natural order
  const naturalRank = (e: { c: Candidate }) => e.c.rank;
  let entries = [...byKey.values()];
  const sortType = gb.sort?.type ?? (kind === 'select' || kind === 'multi_select' || kind === 'checkbox' || kind === 'person' ? 'manual' : 'ascending');
  const textual = (e: { c: Candidate }) => e.c.label.toLowerCase();
  const byNatural = (a: { c: Candidate }, b: { c: Candidate }) => {
    if (a.c.uncategorized !== b.c.uncategorized) return a.c.uncategorized ? -1 : 1;
    const ra = naturalRank(a);
    const rb = naturalRank(b);
    if (ra !== rb) return ra - rb;
    return textual(a) < textual(b) ? -1 : textual(a) > textual(b) ? 1 : 0;
  };
  entries.sort(byNatural);
  if (sortType === 'descending') {
    const unc = entries.filter((e) => e.c.uncategorized);
    entries = [...unc, ...entries.filter((e) => !e.c.uncategorized).reverse()];
  }
  const saved = (opts.saved ?? []).filter((s) => !s.property || s.property === gb.property);
  if (sortType === 'manual' && saved.length) {
    const pos = new Map(saved.map((s, i) => [groupKey(s.value), i]));
    entries.sort((a, b) => {
      const pa = pos.get(groupKey(a.c.value));
      const pb = pos.get(groupKey(b.c.value));
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return byNatural(a, b);
    });
  }
  const hiddenKeys = new Set(saved.filter((s) => s.hidden).map((s) => groupKey(s.value)));
  const out: GroupResult[] = [];
  for (const e of entries) {
    const empty = e.rows.length === 0;
    if (empty && e.c.uncategorized) continue; // "No X" only when something is uncategorized
    if (empty && gb.hideEmptyGroups) continue;
    if (empty && !opts.board && !(kind === 'select' || kind === 'multi_select' || kind === 'status' || kind === 'checkbox')) continue;
    const key = groupKey(e.c.value);
    out.push({
      id: key, value: e.c.value, label: e.c.label, color: e.c.color, option: e.c.option, rows: e.rows,
      hidden: hiddenKeys.has(key), uncategorized: e.c.uncategorized,
    });
  }
  return out;
}

/** Saved descriptor list for the current visible order (to persist manual group order / hidden flags). */
export function savedGroupsFrom(groups: GroupResult[], property: string, prev?: SavedGroup[]): SavedGroup[] {
  const prevByKey = new Map((prev ?? []).map((s) => [groupKey(s.value), s]));
  return groups.map((g) => {
    const p = prevByKey.get(g.id);
    return { property, value: g.value, ...(g.hidden ? { hidden: true } : {}), ...(p?.emptyHidden ? { emptyHidden: true } : {}) };
  });
}

/** Property values a row needs so it lands in `group` (used when creating rows in a group / dragging cards). */
export function groupAssignment(group: GroupResult, prop: PropertySchema): { kind: string; value: any } | null {
  const v = group.value.value;
  if (group.uncategorized) return { kind: 'clear', value: null };
  switch (prop.type) {
    case 'select':
    case 'multi_select':
      return { kind: prop.type, value: String(v) };
    case 'status':
      if (v?.type === 'by_option') return { kind: 'status', value: String(v.option) };
      if (v?.type === 'by_group') {
        const g = ((prop.groups ?? []) as StatusGroup[]).find((x) => x.name === v.group);
        const first = prop.options?.find((o) => g?.optionIds?.[0] === o.id);
        return first ? { kind: 'status', value: first.value } : null;
      }
      return null;
    case 'checkbox':
      return { kind: 'checkbox', value: !!v };
    case 'person':
      return v?.id ? { kind: 'person', value: v.id } : null;
    case 'relation':
      return v?.id ? { kind: 'relation', value: v.id } : null;
    case 'text':
    case 'title':
    case 'url':
    case 'email':
    case 'phone_number':
      return v?.type === 'exact' ? { kind: 'text', value: String(v.value) } : null;
    case 'number':
      if (v?.type === 'unique') return { kind: 'number', value: v.value };
      if (v?.type === 'range') return { kind: 'number', value: v.start };
      return null;
    case 'date':
      if (v?.range?.start_date) return { kind: 'date', value: v.range.start_date };
      if (v?.type === 'today') return { kind: 'date', value: msToYmd(Date.now()) };
      if (v?.type === 'tomorrow') return { kind: 'date', value: msToYmd(addDays(Date.now(), 1)) };
      if (v?.type === 'yesterday') return { kind: 'date', value: msToYmd(addDays(Date.now(), -1)) };
      return null;
    default:
      return null;
  }
}
