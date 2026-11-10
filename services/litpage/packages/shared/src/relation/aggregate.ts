// Rollup / column aggregations: which aggregators exist per value type,
// their menu buckets (Count / Percent / More options / Date) and how they reduce a list of per-page values.
import { dateEndMs, dateStartMs, type LitDate } from '../formula/dates.ts';
import { displayText, flattenDeep, list, num, UNDEF, type FValue, type TextResolver } from '../formula/values.ts';

export type Aggregator =
  | 'show_original' | 'show_unique' | 'count' | 'count_values' | 'unique' | 'empty' | 'not_empty' | 'percent_empty' | 'percent_not_empty'
  | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range' | 'earliest_date' | 'latest_date' | 'date_range'
  | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked' | 'count_per_group' | 'percent_per_group';

/** Aggregation object form used for status groups: {operator:"count_per_group", groupName}. */
export type AggregationSpec = Aggregator | { operator: 'count_per_group' | 'percent_per_group'; groupName: string };

export const AGGREGATION_LABEL: Record<Aggregator, string> = {
  show_original: 'Show source values', show_unique: 'Show distinct values', count: 'Count items', count_values: 'Count filled values', unique: 'Count distinct values',
  empty: 'Count blank', not_empty: 'Count filled', percent_empty: 'Percent blank', percent_not_empty: 'Percent filled',
  sum: 'Sum', average: 'Average', median: 'Median', min: 'Min', max: 'Max', range: 'Range',
  earliest_date: 'Earliest date', latest_date: 'Latest date', date_range: 'Date range',
  checked: 'Checked', unchecked: 'Unchecked', percent_checked: 'Percent checked', percent_unchecked: 'Percent unchecked',
  count_per_group: 'Items per group', percent_per_group: 'Share per group',
};

export const AGGREGATION_SHORT: Partial<Record<Aggregator, string>> = {
  count: 'Count', count_values: 'Filled', unique: 'Distinct', empty: 'Blank', not_empty: 'Filled', percent_empty: 'Blank', percent_not_empty: 'Filled',
  sum: 'Sum', average: 'Average', median: 'Median', min: 'Min', max: 'Max', range: 'Range', earliest_date: 'Earliest', latest_date: 'Latest',
  date_range: 'Range', checked: 'Checked', unchecked: 'Unchecked', percent_checked: 'Checked', percent_unchecked: 'Unchecked', show_unique: 'Show unique',
};

/** Aggregators per value type. */
export const AGGREGATIONS_BY_TYPE: Record<string, Aggregator[]> = {
  text: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'],
  checkbox: ['count', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked'],
  select: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'],
  multi_select: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'],
  status: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty', 'count_per_group', 'percent_per_group'],
  relation: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'],
  person: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'],
  number: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty', 'sum', 'average', 'median', 'min', 'max', 'range'],
  date: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty', 'earliest_date', 'latest_date', 'date_range'],
  file: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'],
  place: ['show_unique', 'count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'],
};

/** Menu buckets of the "Calculate" submenu. */
export const AGGREGATION_BUCKETS = {
  count: ['count', 'count_values', 'unique', 'empty', 'not_empty', 'checked', 'unchecked', 'count_per_group'] as Aggregator[],
  percent: ['percent_empty', 'percent_not_empty', 'percent_checked', 'percent_unchecked', 'percent_per_group'] as Aggregator[],
  more: ['sum', 'average', 'median', 'min', 'max', 'range'] as Aggregator[],
  date: ['earliest_date', 'latest_date', 'date_range'] as Aggregator[],
};

/** Map a property type to the aggregation value-type table key. */
export function aggregationValueType(propType: string | undefined): string {
  switch (propType) {
    case 'title': case 'text': case 'url': case 'email': case 'phone_number': case 'auto_increment_id': return 'text';
    case 'created_time': case 'last_edited_time': case 'date': return 'date';
    case 'created_by': case 'last_edited_by': case 'person': return 'person';
    case 'formula': case 'rollup': return 'number';
    case undefined: return 'text';
    default: return AGGREGATIONS_BY_TYPE[propType] ? propType : 'text';
  }
}

export function aggregatorName(spec: AggregationSpec | undefined): Aggregator {
  if (!spec) return 'show_original';
  return typeof spec === 'string' ? spec : spec.operator;
}

export interface AggregateOptions {
  resolver?: TextResolver;
  /** status option name -> group name (for count/percent per group) */
  statusGroupOf?: (option: string) => string | undefined;
}

/** Result kinds: numbers (percent=true for ratios), dates, text (date range duration), lists (show original/unique). */
export interface AggregateResult {
  value: FValue;
  percent?: boolean;
}

function isEmptyValue(v: FValue): boolean {
  if (v.type === 'undefined') return true;
  if (v.type === 'array') return v.values.length === 0;
  if (v.type === 'text') return displayText(v) === '';
  return false;
}

function keyOf(v: FValue, r?: TextResolver): string {
  switch (v.type) {
    case 'block': case 'person': return `${v.type}:${v.value.id}`;
    case 'date': return `date:${dateStartMs(v.value, r?.timeZone)}:${v.value.end_date ?? ''}`;
    default: return `${v.type}:${displayText(v, r)}`;
  }
}

function humanDuration(ms: number): string {
  const day = 864e5;
  const units: [number, string][] = [[365 * day, 'year'], [30 * day, 'month'], [7 * day, 'week'], [day, 'day'], [3600e3, 'hour'], [60e3, 'minute']];
  for (const [u, n] of units) {
    if (ms >= u) {
      const k = Math.round(ms / u);
      return `${k} ${n}${k === 1 ? '' : 's'}`;
    }
  }
  return ms > 0 ? 'less than a minute' : '0 days';
}

/**
 * Reduce per-page values with an aggregator. `values` holds one entry per related page (or per row for column
 * calculations); entries may be lists (multi-select, people, relations) which count element-wise where relevant.
 */
export function aggregate(values: FValue[], spec: AggregationSpec | undefined, opts: AggregateOptions = {}): AggregateResult {
  const agg = aggregatorName(spec);
  const r = opts.resolver;
  const total = values.length;
  const items = flattenDeep(values).filter((v) => !isEmptyValue(v));
  const numbers = items.flatMap((v) => (v.type === 'number' ? [v.value] : []));
  const dates = items.flatMap((v) => (v.type === 'date' ? [v.value as LitDate] : []));
  const emptyCount = values.filter(isEmptyValue).length;
  const pct = (n: number, d: number): AggregateResult => ({ value: num(d ? n / d : 0), percent: true });
  switch (agg) {
    case 'show_original': return { value: list(flattenDeep(values)) };
    case 'show_unique': {
      const seen = new Set<string>();
      const out: FValue[] = [];
      for (const v of items) {
        const k = keyOf(v, r);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(v);
        }
      }
      return { value: list(out) };
    }
    case 'count': return { value: num(total) };
    case 'count_values': return { value: num(items.length) };
    case 'unique': return { value: num(new Set(items.map((v) => keyOf(v, r))).size) };
    case 'empty': return { value: num(emptyCount) };
    case 'not_empty': return { value: num(total - emptyCount) };
    case 'percent_empty': return pct(emptyCount, total);
    case 'percent_not_empty': return pct(total - emptyCount, total);
    case 'sum': return { value: num(numbers.reduce((s, x) => s + x, 0)) };
    case 'average': return { value: numbers.length ? num(numbers.reduce((s, x) => s + x, 0) / numbers.length) : UNDEF };
    case 'median': {
      if (!numbers.length) return { value: UNDEF };
      const s = [...numbers].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return { value: num(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) };
    }
    case 'min': return { value: numbers.length ? num(Math.min(...numbers)) : UNDEF };
    case 'max': return { value: numbers.length ? num(Math.max(...numbers)) : UNDEF };
    case 'range': return { value: numbers.length ? num(Math.max(...numbers) - Math.min(...numbers)) : UNDEF };
    case 'earliest_date':
    case 'latest_date': {
      if (!dates.length) return { value: UNDEF };
      const ms = dates.map((d) => dateStartMs(d, r?.timeZone));
      const target = agg === 'earliest_date' ? Math.min(...ms) : Math.max(...ms);
      return { value: { type: 'date', value: dates[ms.indexOf(target)] } };
    }
    case 'date_range': {
      if (!dates.length) return { value: UNDEF };
      const start = Math.min(...dates.map((d) => dateStartMs(d, r?.timeZone)));
      const end = Math.max(...dates.map((d) => dateEndMs(d, r?.timeZone)));
      return { value: { type: 'text', value: [[humanDuration(end - start)]] } };
    }
    case 'checked': return { value: num(items.filter((v) => v.type === 'checkbox' && v.value).length) };
    case 'unchecked': return { value: num(values.filter((v) => !(v.type === 'checkbox' && v.value)).length) };
    case 'percent_checked': return pct(items.filter((v) => v.type === 'checkbox' && v.value).length, total);
    case 'percent_unchecked': return pct(values.filter((v) => !(v.type === 'checkbox' && v.value)).length, total);
    case 'count_per_group':
    case 'percent_per_group': {
      const group = typeof spec === 'object' ? spec.groupName : undefined;
      const n = items.filter((v) => v.type === 'text' && opts.statusGroupOf?.(displayText(v, r)) === group).length;
      return agg === 'count_per_group' ? { value: num(n) } : pct(n, total);
    }
  }
}
