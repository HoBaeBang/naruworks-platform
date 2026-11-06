// Adapter between formula values (FValue) and the database engine's typed PropertyValue shape
// (packages/shared/src/database/types.ts `{kind: ...}`), so the core engine's registered formula/rollup hooks
// (features/database/formulaBridge.ts -> registerFormulaEngine/registerRollupEngine) receive values it can
// render, filter, sort and aggregate directly.
import type { PropertySchema, SelectOption } from '../records.ts';
import type { RichText } from '../richtext.ts';
import { dateInterval, hasTime as dateHasTime, isRange as dateIsRange, type LitDate } from './dates.ts';
import { plainText, type FValue, type TextResolver } from './values.ts';

export interface CompatDateRange {
  start: string;
  startTime?: string;
  end?: string;
  endTime?: string;
  timeZone?: string;
  startMs: number;
  endMs?: number;
  hasTime: boolean;
  isRange: boolean;
  raw?: LitDate;
}

export type CompatValue =
  | { kind: 'text'; text: string; rich?: RichText }
  | { kind: 'number'; number: number | null }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'select'; options: SelectOption[] }
  | { kind: 'status'; option: SelectOption | null; group: { id: string; name: string; color: string; optionIds: string[] } | null }
  | { kind: 'date'; date: CompatDateRange | null }
  | { kind: 'person'; ids: string[] }
  | { kind: 'relation'; ids: string[] }
  | { kind: 'array'; items: CompatValue[] }
  | { kind: 'error'; message: string };

export function dateToRange(v: LitDate, tz?: string): CompatDateRange {
  const iv = dateInterval(v, tz);
  const timed = dateHasTime(v);
  const range = dateIsRange(v);
  return {
    start: v.start_date,
    startTime: timed ? v.start_time : undefined,
    end: range ? v.end_date ?? v.start_date : undefined,
    endTime: range && timed ? v.end_time ?? v.start_time : undefined,
    timeZone: v.time_zone,
    startMs: iv.start.ts,
    endMs: range ? (iv.end ?? iv.start).ts : undefined,
    hasTime: timed,
    isRange: range,
    raw: v,
  };
}

/**
 * FValue -> PropertyValue. `target` (rollup target property schema) turns plain option names back into
 * select/status chips so rollups of select properties keep their colors.
 */
export function toCompat(v: FValue, opts?: { target?: PropertySchema; resolver?: TextResolver; emptyAs?: string }): CompatValue {
  const target = opts?.target;
  switch (v.type) {
    case 'number': return { kind: 'number', number: Number.isFinite(v.value) ? v.value : null };
    case 'checkbox': return { kind: 'checkbox', checked: v.value };
    case 'text': {
      const s = plainText(v.value, opts?.resolver);
      if (target && (target.type === 'select' || target.type === 'multi_select')) {
        const o = target.options?.find((x) => x.value === s);
        return { kind: 'select', options: [o ?? { id: '', value: s, color: 'default' }] };
      }
      if (target?.type === 'status') {
        const o = target.options?.find((x) => x.value === s) ?? null;
        const g = o ? target.groups?.find((gr) => gr.optionIds.includes(o.id)) ?? null : null;
        return { kind: 'status', option: o ?? { id: '', value: s, color: 'default' }, group: g };
      }
      const styled = v.value.some((d) => (d[1]?.length ?? 0) > 0);
      return styled ? { kind: 'text', text: s, rich: v.value } : { kind: 'text', text: s };
    }
    case 'date': return { kind: 'date', date: dateToRange(v.value, opts?.resolver?.timeZone) };
    case 'person': return { kind: 'person', ids: [v.value.id] };
    case 'block': return { kind: 'relation', ids: [v.value.id] };
    case 'array': {
      // homogeneous people/page lists render as one person/relation value (avatars / page chips)
      if (v.values.length && v.values.every((x) => x.type === 'person')) return { kind: 'person', ids: v.values.map((x) => (x as { value: { id: string } }).value.id) };
      if (v.values.length && v.values.every((x) => x.type === 'block')) return { kind: 'relation', ids: v.values.map((x) => (x as { value: { id: string } }).value.id) };
      return { kind: 'array', items: v.values.map((x) => toCompat(x, opts)) };
    }
    case 'undefined':
      if (opts?.emptyAs === 'number') return { kind: 'number', number: null };
      if (opts?.emptyAs === 'date') return { kind: 'date', date: null };
      if (opts?.emptyAs === 'checkbox') return { kind: 'checkbox', checked: false };
      return { kind: 'text', text: '' };
    default: return { kind: 'text', text: '' };
  }
}
