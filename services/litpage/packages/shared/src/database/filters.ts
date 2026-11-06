// Filter evaluation for query2.filter (advanced, nested and/or groups) and format.property_filters
// (simple filter chips). Operators per value type: FILTER_OPERATORS in schema.ts.
import type { BlockRecord, PropertySchema } from '../records.ts';
import { addDays, msToYmd, relativeDay, relativeRange, startOfDay, ymdToMs } from './dates.ts';
import type { FilterGroup, FilterNode, FilterValue, PropertyFilterLeaf, PropertyValue, QueryContext, Schema } from './types.ts';
import { getPropertyValue, isEmptyValue, pageTitle, userName, valueToNumber, valueToText } from './values.ts';

export function isFilterGroup(n: FilterNode | undefined | null): n is FilterGroup {
  return !!n && Array.isArray((n as FilterGroup).filters);
}

function valuesOf(fv: FilterValue | FilterValue[] | undefined): FilterValue[] {
  if (fv === undefined || fv === null) return [];
  return (Array.isArray(fv) ? fv : [fv]).filter((v) => v && v.value !== undefined && v.value !== null && v.value !== '');
}

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty']);

/** A leaf is "active" when it constrains rows (filters without a value are ignored). */
export function isActiveLeaf(leaf: PropertyFilterLeaf, schema?: Schema): boolean {
  if (schema && !schema[leaf.property]) return false;
  const op = leaf.filter?.operator;
  if (!op) return false;
  if (NO_VALUE_OPS.has(op)) return true;
  if (op === 'any' || op === 'none' || op === 'every') return !!leaf.filter.subfilter && (NO_VALUE_OPS.has(leaf.filter.subfilter.operator) || valuesOf(leaf.filter.subfilter.value).length > 0);
  if (op.startsWith('checkbox_')) return valuesOf(leaf.filter.value).length > 0;
  return valuesOf(leaf.filter.value).length > 0;
}

/** Target day (local midnight) of an exact/relative single-date filter value. */
export function filterDay(v: FilterValue, now: number): number | null {
  if (v.type === 'relative') {
    if (typeof v.value === 'string') return relativeDay(v.value, now);
    return null;
  }
  const raw = v.value;
  if (typeof raw === 'string') {
    const ms = ymdToMs(raw.slice(0, 10));
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof raw === 'number') return startOfDay(raw);
  if (raw && typeof raw === 'object' && raw.start_date) {
    const ms = ymdToMs(raw.start_date);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** [start, endExclusive) for range filters (is within / relative to today). */
export function filterRange(v: FilterValue, now: number, weekStart: 0 | 1 = 0): [number, number] | null {
  if (v.type === 'relative') return relativeRange(v as any, now, weekStart);
  const raw = v.value;
  if (raw && typeof raw === 'object' && raw.start_date) {
    const s = ymdToMs(raw.start_date);
    const e = ymdToMs(raw.end_date ?? raw.start_date);
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    return [Math.min(s, e), addDays(Math.max(s, e), 1)];
  }
  const d = filterDay(v, now);
  return d === null ? null : [d, addDays(d, 1)];
}

function rowDay(v: PropertyValue, useEnd?: boolean): number | null {
  if (v.kind !== 'date' || !v.date) return null;
  const ms = useEnd ? v.date.endMs ?? v.date.startMs : v.date.startMs;
  return startOfDay(ms);
}

function textMatch(op: string, text: string, target: string): boolean {
  const a = text.trim().toLowerCase();
  const b = target.trim().toLowerCase();
  switch (op) {
    case 'string_is': return a === b;
    case 'string_is_not': return a !== b;
    case 'string_contains': return a.includes(b);
    case 'string_does_not_contain': return !a.includes(b);
    case 'string_starts_with': return a.startsWith(b);
    case 'string_ends_with': return a.endsWith(b);
    default: return true;
  }
}

function namesOf(v: PropertyValue, ctx: QueryContext): string[] {
  if (v.kind === 'select') return v.options.map((o) => o.value.toLowerCase());
  if (v.kind === 'status') return v.option ? [v.option.value.toLowerCase()] : [];
  if (v.kind === 'array') return v.items.flatMap((i) => namesOf(i, ctx));
  const t = valueToText(v, undefined, ctx).trim().toLowerCase();
  return t ? [t] : [];
}

function idsOf(v: PropertyValue): string[] {
  if (v.kind === 'person' || v.kind === 'relation') return v.ids;
  if (v.kind === 'array') return v.items.flatMap(idsOf);
  return [];
}

/** Evaluate one operator against a value (exported for tests and the filter UI preview). */
export function evaluateOperator(
  value: PropertyValue,
  op: string,
  fv: FilterValue | FilterValue[] | undefined,
  prop: PropertySchema | undefined,
  ctx: QueryContext,
  useEnd?: boolean,
): boolean {
  if (op === 'is_empty') return isEmptyValue(value);
  if (op === 'is_not_empty') return !isEmptyValue(value);
  const vals = valuesOf(fv);
  if (!vals.length) return true;
  const now = ctx.now ?? Date.now();
  const first = vals[0];

  if (op.startsWith('string_')) {
    const text = value.kind === 'text' ? value.text : valueToText(value, prop, ctx);
    return textMatch(op, text, String(first.value));
  }
  if (op.startsWith('number_')) {
    const n = value.kind === 'array' ? null : valueToNumber(value.kind === 'date' ? { kind: 'number', number: null } : value);
    const t = Number(first.value);
    if (!Number.isFinite(t)) return true;
    if (n === null) return op === 'number_does_not_equal';
    switch (op) {
      case 'number_equals': return n === t;
      case 'number_does_not_equal': return n !== t;
      case 'number_greater_than': return n > t;
      case 'number_less_than': return n < t;
      case 'number_greater_than_or_equal_to': return n >= t;
      case 'number_less_than_or_equal_to': return n <= t;
    }
    return true;
  }
  if (op === 'checkbox_is' || op === 'checkbox_is_not') {
    const checked = value.kind === 'checkbox' ? value.checked : !isEmptyValue(value);
    const t = first.value === true || first.value === 'true' || first.value === 'Yes';
    return op === 'checkbox_is' ? checked === t : checked !== t;
  }
  if (op === 'enum_is' || op === 'enum_is_not' || op === 'enum_contains' || op === 'enum_does_not_contain' || op === 'enum_contains_all') {
    const names = namesOf(value, ctx);
    const targets = vals.map((v) => String(v.value).trim().toLowerCase());
    const any = targets.some((t) => names.includes(t));
    if (op === 'enum_is' || op === 'enum_contains') return any;
    if (op === 'enum_contains_all') return targets.every((t) => names.includes(t));
    return !any;
  }
  if (op === 'status_is' || op === 'status_is_not') {
    const opt = value.kind === 'status' ? value.option : null;
    const group = value.kind === 'status' ? value.group : null;
    const any = vals.some((v) => {
      const t = String(v.value).trim().toLowerCase();
      if (v.type === 'is_group') return !!group && (group.name.toLowerCase() === t || group.id === v.value);
      return !!opt && (opt.value.toLowerCase() === t || opt.id === v.value);
    });
    return op === 'status_is' ? any : !any;
  }
  if (op === 'person_contains' || op === 'person_does_not_contain') {
    const ids = idsOf(value);
    const any = vals.some((v) => {
      const target = v.type === 'relative' && v.value === 'me' ? ctx.userId : typeof v.value === 'object' ? v.value?.id : String(v.value);
      return !!target && ids.includes(target);
    });
    return op === 'person_contains' ? any : !any;
  }
  if (op === 'relation_contains' || op === 'relation_does_not_contain') {
    const ids = idsOf(value);
    // relative sprint variables (Current / Next / Last sprint) resolve through the related Sprints database
    const any = vals.some((v) => (isRelativeSprint(v) ? relativeSprintIds(prop, String(v.value), ctx) : [typeof v.value === 'object' ? v.value?.id : String(v.value)]).some((id) => ids.includes(id)));
    return op === 'relation_contains' ? any : !any;
  }
  if (op.startsWith('date_')) {
    const day = rowDay(value, useEnd);
    if (day === null) return false;
    if (op === 'date_is_within' || op === 'date_is_relative_to') {
      const r = filterRange(first, now, ctx.startOfWeek ?? 0);
      if (!r) return true;
      return day >= r[0] && day < r[1];
    }
    const target = filterDay(first, now);
    if (target === null) return true;
    switch (op) {
      case 'date_is': return day === target;
      case 'date_is_before': return day < target;
      case 'date_is_after': return day > target;
      case 'date_is_on_or_before': return day <= target;
      case 'date_is_on_or_after': return day >= target;
    }
    return true;
  }
  if (op === 'location_is' || op === 'location_is_not') {
    const text = valueToText(value, prop, ctx).toLowerCase();
    const any = vals.some((v) => String(v.value).toLowerCase() === text || (typeof v.value === 'object' && v.value?.id && ctx.getRecord?.('collection', v.value.id) && text === valueToText(value, prop, ctx).toLowerCase()));
    return op === 'location_is' ? any : !any;
  }
  if (op === 'verification_is' || op === 'verification_is_not') {
    const state = value.kind === 'verification' ? value.state : 'none';
    const any = vals.some((v) => String(v.value) === state);
    return op === 'verification_is' ? any : !any;
  }
  return true;
}

export function matchesLeaf(row: BlockRecord, leaf: PropertyFilterLeaf, schema: Schema, ctx: QueryContext): boolean {
  const prop = schema[leaf.property];
  if (!prop || !leaf.filter?.operator) return true;
  if (!isActiveLeaf(leaf)) return true;
  const value = getPropertyValue(row, leaf.property, schema, ctx);
  const { operator, value: fv, use_end, subfilter } = leaf.filter;
  if (operator === 'any' || operator === 'none' || operator === 'every') {
    const items = value.kind === 'array' ? value.items : [value];
    if (!subfilter) return true;
    const test = (i: PropertyValue) => evaluateOperator(i, subfilter.operator, subfilter.value, undefined, ctx, use_end);
    if (operator === 'any') return items.some(test);
    if (operator === 'none') return !items.some(test);
    return items.length > 0 && items.every(test);
  }
  if (value.kind === 'array' && !operator.startsWith('enum_') && !operator.startsWith('person_') && !operator.startsWith('relation_') && operator !== 'is_empty' && operator !== 'is_not_empty') {
    const negative = /_not|does_not/.test(operator);
    return negative ? value.items.every((i) => evaluateOperator(i, operator, fv, undefined, ctx, use_end)) : value.items.some((i) => evaluateOperator(i, operator, fv, undefined, ctx, use_end));
  }
  return evaluateOperator(value, operator, fv, prop, ctx, use_end);
}

export function matchesFilter(row: BlockRecord, node: FilterNode | undefined | null, schema: Schema, ctx: QueryContext): boolean {
  if (!node) return true;
  if (isFilterGroup(node)) {
    const kids = node.filters ?? [];
    if (!kids.length) return true;
    if (node.operator === 'or') {
      const active = kids.filter((k) => (isFilterGroup(k) ? countActive(k, schema) > 0 : isActiveLeaf(k, schema)));
      if (!active.length) return true;
      return active.some((k) => matchesFilter(row, k, schema, ctx));
    }
    return kids.every((k) => matchesFilter(row, k, schema, ctx));
  }
  return matchesLeaf(row, node as PropertyFilterLeaf, schema, ctx);
}

/** Number of active leaves in a filter tree. */
export function countActive(node: FilterNode | undefined | null, schema?: Schema): number {
  if (!node) return 0;
  if (isFilterGroup(node)) return node.filters.reduce((n, k) => n + countActive(k, schema), 0);
  return isActiveLeaf(node as PropertyFilterLeaf, schema) ? 1 : 0;
}

/** Toolbar search: title + text-like property values. */
export function matchesSearch(row: BlockRecord, schema: Schema, query: string, ctx: QueryContext): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  for (const [id, prop] of Object.entries(schema)) {
    if (prop.type === 'button') continue;
    const v = getPropertyValue(row, id, schema, ctx);
    const text = v.kind === 'person' ? v.ids.map((u) => userName(u, ctx)).join(' ') : v.kind === 'relation' ? v.ids.map((p) => pageTitle(p, ctx)).join(' ') : valueToText(v, prop, ctx);
    if (text.toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Values a new row should get so it stays visible under the current filters:
 * only AND-combined equality-ish leaves are applied.
 */
export function valuesFromFilters(nodes: FilterNode[], schema: Schema, ctx: QueryContext): Record<string, { type: string; value: any }> {
  const out: Record<string, { type: string; value: any }> = {};
  for (const n of nodes) {
    if (isFilterGroup(n)) {
      if (n.operator === 'and') Object.assign(out, valuesFromFilters(n.filters, schema, ctx));
      continue;
    }
    const leaf = n as PropertyFilterLeaf;
    const prop = schema[leaf.property];
    if (!prop || !isActiveLeaf(leaf)) continue;
    const vals = valuesOf(leaf.filter.value);
    const op = leaf.filter.operator;
    if (op === 'enum_is' && vals[0]) out[leaf.property] = { type: 'select', value: [String(vals[0].value)] };
    else if (op === 'enum_contains') out[leaf.property] = { type: 'multi_select', value: vals.map((v) => String(v.value)) };
    else if (op === 'status_is' && vals[0]?.type !== 'is_group' && vals[0]) out[leaf.property] = { type: 'status', value: [String(vals[0].value)] };
    else if (op === 'checkbox_is' && vals[0]) out[leaf.property] = { type: 'checkbox', value: vals[0].value === true || vals[0].value === 'true' };
    else if (op === 'person_contains' && vals[0]) out[leaf.property] = { type: 'person', value: vals.map((v) => (v.type === 'relative' && v.value === 'me' ? ctx.userId : String(v.value))).filter(Boolean) };
    else if (op === 'relation_contains' && vals[0]) out[leaf.property] = { type: 'relation', value: vals.flatMap((v) => (isRelativeSprint(v) ? relativeSprintIds(prop, String(v.value), ctx).slice(0, 1) : [String(v.value)])) };
    else if ((op === 'string_is' || op === 'string_contains' || op === 'string_starts_with') && vals[0] && prop.type !== 'title') out[leaf.property] = { type: 'text', value: String(vals[0].value) };
    else if (op === 'number_equals' && vals[0]) out[leaf.property] = { type: 'number', value: Number(vals[0].value) };
    else if (op === 'date_is' && vals[0]) {
      const d = filterDay(vals[0], ctx.now ?? Date.now());
      if (d !== null) out[leaf.property] = { type: 'date', value: msToYmd(d) };
    }
  }
  return out;
}

// ---------- relative sprint variables (relation filters: "Current" / "Next" / "Last" sprint) ---------

const SPRINT_VARIABLES: Record<string, string> = { current_sprint: 'Current', next_sprint: 'Next', last_sprint: 'Last' };

export function isRelativeSprint(v: FilterValue | undefined): boolean {
  return !!v && v.type === 'relative' && typeof v.value === 'string' && v.value in SPRINT_VARIABLES;
}

/** Ids of the sprints in `prop`'s related Sprints database whose Sprint status is Current / Next / Last. */
export function relativeSprintIds(prop: PropertySchema | undefined, variable: string, ctx: QueryContext): string[] {
  const status = SPRINT_VARIABLES[variable];
  const cid = (prop?.collection_pointer as { id?: string } | undefined)?.id ?? (prop?.collection_id as string | undefined);
  if (!status || !cid || !ctx.rowsOf) return [];
  const col = ctx.getRecord?.('collection', cid) as { schema?: Schema; format?: Record<string, unknown> } | undefined;
  const statusProp = (col?.format?.app_uri_map as Record<string, string> | undefined)?.['litpage://sprints/sprint_status_property'];
  if (!col?.schema || !statusProp) return [];
  return ctx.rowsOf(cid).filter((r) => namesOf(getPropertyValue(r, statusProp, col.schema!, ctx), ctx).includes(status.toLowerCase())).map((r) => r.id);
}
