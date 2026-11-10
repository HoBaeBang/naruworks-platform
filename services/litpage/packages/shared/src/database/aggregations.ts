// Calculations (table footer, board/group headers, rollups): the 23 aggregators of
// aggregations with Litpage's result formats (counts, percents, number formats, dates).
import type { BlockRecord, PropertySchema } from '../records.ts';
import { formatDay, formatDuration, formatTime } from './dates.ts';
import { formatNumber } from './numbers.ts';
import type { AggregationResult, AggregationSpec, PropertyValue, QueryContext, Schema, StatusGroup } from './types.ts';
import { getPropertyValue, isEmptyValue, valueKeys, valueToNumber } from './values.ts';

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%';
  const pct = Math.round(fraction * 10_000) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function numbersOf(values: PropertyValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v.kind === 'array') {
      for (const i of v.items) {
        const n = valueToNumber(i);
        if (n !== null && i.kind !== 'date') out.push(n);
      }
      continue;
    }
    if (v.kind === 'date') continue;
    const n = valueToNumber(v);
    if (n !== null) out.push(n);
  }
  return out;
}

function datesOf(values: PropertyValue[]): { start: number; end: number; hasTime: boolean }[] {
  const out: { start: number; end: number; hasTime: boolean }[] = [];
  const add = (v: PropertyValue) => {
    if (v.kind === 'date' && v.date) out.push({ start: v.date.startMs, end: v.date.endMs ?? v.date.startMs, hasTime: v.date.hasTime });
  };
  for (const v of values) {
    if (v.kind === 'array') v.items.forEach(add);
    else add(v);
  }
  return out;
}

/**
 * Aggregate a list of values. `prop` supplies number/date formats; `spec` carries status group
 * aggregators ({operator:"count_per_group", groupName}).
 */
export function aggregateValues(
  values: PropertyValue[],
  aggregator: string,
  prop?: PropertySchema,
  ctx?: QueryContext,
  spec?: { operator?: string; groupName?: string },
): AggregationResult {
  const total = values.length;
  const res = (value: number | null, display: string): AggregationResult => ({ aggregator, property: undefined, value, display });
  const numberFormat = prop?.number_format as string | undefined;
  const precision = prop?.number_precision as string | undefined;
  switch (aggregator) {
    case 'none':
      return res(null, '');
    case 'count':
      return res(total, formatCount(total));
    case 'count_values': {
      const n = values.reduce((acc, v) => acc + (v.kind === 'checkbox' ? (v.checked ? 1 : 0) : valueKeys(v).length), 0);
      return res(n, formatCount(n));
    }
    case 'unique': {
      const set = new Set<string>();
      for (const v of values) for (const k of valueKeys(v)) set.add(k.toLowerCase());
      return res(set.size, formatCount(set.size));
    }
    case 'empty': {
      const n = values.filter(isEmptyValue).length;
      return res(n, formatCount(n));
    }
    case 'not_empty': {
      const n = values.filter((v) => !isEmptyValue(v)).length;
      return res(n, formatCount(n));
    }
    case 'percent_empty': {
      const f = total ? values.filter(isEmptyValue).length / total : 0;
      return res(f, formatPercent(f));
    }
    case 'percent_not_empty': {
      const f = total ? values.filter((v) => !isEmptyValue(v)).length / total : 0;
      return res(f, formatPercent(f));
    }
    case 'checked':
    case 'unchecked':
    case 'percent_checked':
    case 'percent_unchecked': {
      const checked = values.filter((v) => (v.kind === 'checkbox' ? v.checked : !isEmptyValue(v))).length;
      const n = aggregator.endsWith('unchecked') ? total - checked : checked;
      if (aggregator.startsWith('percent')) {
        const f = total ? n / total : 0;
        return res(f, formatPercent(f));
      }
      return res(n, formatCount(n));
    }
    case 'sum':
    case 'average':
    case 'median':
    case 'min':
    case 'max':
    case 'range': {
      const nums = numbersOf(values);
      if (!nums.length) return res(null, aggregator === 'sum' ? formatNumber(0, numberFormat, precision) : '');
      let v: number;
      if (aggregator === 'sum') v = nums.reduce((a, b) => a + b, 0);
      else if (aggregator === 'average') v = nums.reduce((a, b) => a + b, 0) / nums.length;
      else if (aggregator === 'median') {
        const s = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      } else if (aggregator === 'min') v = Math.min(...nums);
      else if (aggregator === 'max') v = Math.max(...nums);
      else v = Math.max(...nums) - Math.min(...nums);
      v = Math.round(v * 1e10) / 1e10;
      const capped = aggregator === 'average' || aggregator === 'median' ? { maxFractionDigits: 2 } : undefined;
      return res(v, formatNumber(v, numberFormat, precision, capped));
    }
    case 'earliest_date':
    case 'latest_date': {
      const ds = datesOf(values);
      if (!ds.length) return res(null, '');
      const pick = aggregator === 'earliest_date' ? ds.reduce((a, b) => (b.start < a.start ? b : a)) : ds.reduce((a, b) => (b.start > a.start ? b : a));
      const day = formatDay(pick.start, (prop?.date_format as string | undefined) ?? 'MMM DD, YYYY', ctx?.now);
      const t = pick.hasTime ? formatTime(pick.start, prop?.time_format as string | undefined) : '';
      return res(pick.start, t ? `${day} ${t}` : day);
    }
    case 'date_range': {
      const ds = datesOf(values);
      if (!ds.length) return res(null, '');
      const min = Math.min(...ds.map((d) => d.start));
      const max = Math.max(...ds.map((d) => d.end));
      return res(max - min, formatDuration(max - min));
    }
    case 'count_per_group':
    case 'percent_per_group': {
      const groupName = spec?.groupName;
      const groups = ((prop?.groups ?? []) as StatusGroup[]);
      const g = groups.find((x) => x.name === groupName || x.id === groupName);
      const n = values.filter((v) => v.kind === 'status' && v.option && g?.optionIds?.includes(v.option.id)).length;
      if (aggregator === 'percent_per_group') {
        const f = total ? n / total : 0;
        return res(f, formatPercent(f));
      }
      return res(n, formatCount(n));
    }
    case 'show_unique': {
      const set = new Map<string, PropertyValue>();
      for (const v of values) for (const k of valueKeys(v)) if (!set.has(k)) set.set(k, v);
      return { aggregator, value: set.size, display: formatCount(set.size), values: [...set.values()] };
    }
    default:
      return res(total, formatCount(total));
  }
}

export function aggregatorName(spec: AggregationSpec | undefined): string {
  if (!spec) return 'none';
  return typeof spec.aggregator === 'string' ? spec.aggregator : spec.aggregator.operator;
}

/** Aggregate rows for a property (property omitted → counts rows). */
export function aggregateRows(rows: BlockRecord[], spec: AggregationSpec, schema: Schema, ctx: QueryContext = {}): AggregationResult {
  const agg = aggregatorName(spec);
  const propId = spec.property;
  const groupSpec = typeof spec.aggregator === 'object' ? spec.aggregator : undefined;
  if (!propId || !schema[propId]) {
    const r = aggregateValues(rows.map(() => ({ kind: 'text', text: 'x' }) as PropertyValue), agg === 'none' ? 'none' : 'count', undefined, ctx);
    return { ...r, aggregator: agg };
  }
  const values = rows.map((r) => getPropertyValue(r, propId, schema, ctx));
  const r = aggregateValues(values, agg, schema[propId], ctx, groupSpec);
  return { ...r, aggregator: agg, property: propId };
}
