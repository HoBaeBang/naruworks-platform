// Formula 2.0 runtime values and their helpers: truthiness, deep equality,
// value -> text conversion for `+` / format() / join().
import type { Annotation, Decoration, RichText } from '../richtext.ts';
import { compareDates, formatLitDate, sameDate, type LitDate } from './dates.ts';
import { formatNumberValue } from './numbers.ts';

export type FValue =
  | { type: 'number'; value: number }
  | { type: 'text'; value: RichText }
  | { type: 'checkbox'; value: boolean }
  | { type: 'date'; value: LitDate }
  | { type: 'person'; value: { table: 'lit_user'; id: string } }
  | { type: 'block'; value: { table: 'block'; id: string; spaceId?: string } }
  | { type: 'array'; values: FValue[] }
  | { type: 'undefined' }
  | { type: 'function'; name: string };

export type FType = FValue['type'];

export const UNDEF: FValue = { type: 'undefined' };
export const num = (value: number): FValue => ({ type: 'number', value });
export const bool = (value: boolean): FValue => ({ type: 'checkbox', value });
export const text = (s: string): FValue => ({ type: 'text', value: [[s]] });
export const rich = (value: RichText): FValue => ({ type: 'text', value });
export const list = (values: FValue[]): FValue => ({ type: 'array', values });
export const dateV = (value: LitDate): FValue => ({ type: 'date', value });
export const page = (id: string, spaceId?: string): FValue => ({ type: 'block', value: { table: 'block', id, ...(spaceId ? { spaceId } : {}) } });
export const person = (id: string): FValue => ({ type: 'person', value: { table: 'lit_user', id } });

/** Lookups used to render mentions inside text values (page titles, user names) and dates. */
export interface TextResolver {
  pageTitle?(id: string): string;
  userName?(id: string): string;
  timeZone?: string;
  dateFormat?: string;
  timeFormat?: string;
}

export const MENTION = '‣';

export function dateMention(v: LitDate): Decoration {
  return [MENTION, [['d', v] as unknown as Annotation]];
}

function mentionText(a: Annotation, r?: TextResolver): string {
  switch (a[0]) {
    case 'd': return formatLitDate(a[1] as unknown as LitDate, { tz: r?.timeZone, dateFormat: r?.dateFormat, timeFormat: r?.timeFormat });
    case 'u': return r?.userName?.(String(a[1])) ?? '';
    case 'p': return r?.pageTitle?.(String(a[1])) ?? '';
    case 'e': return String(a[1]);
    default: return '';
  }
}

/** Plain string of a rich text (mentions rendered deterministically, no "@" prefix). */
export function plainText(rt: RichText | undefined, r?: TextResolver): string {
  if (!rt) return '';
  let out = '';
  for (const d of rt) {
    const anns = (d[1] as Annotation[] | undefined) ?? [];
    const atom = anns.find((a) => a[0] === 'd' || a[0] === 'u' || a[0] === 'p' || a[0] === 'e');
    out += atom ? mentionText(atom, r) : d[0];
  }
  return out;
}

/** Character length used by length()/truthiness: atoms count as their text ("‣" = 1). */
export function richLength(rt: RichText): number {
  let n = 0;
  for (const d of rt) n += d[0].length;
  return n;
}

/** truthiness */
export function truthy(v: FValue): boolean {
  switch (v.type) {
    case 'checkbox': return v.value;
    case 'undefined': return false;
    case 'number': return v.value !== 0;
    case 'array': return v.values.length > 0;
    case 'text': return richLength(v.value) > 0;
    default: return true;
  }
}

function interleave<T>(items: T[][], sep: () => T[]): T[] {
  const out: T[] = [];
  items.forEach((it, i) => {
    if (i) out.push(...sep());
    out.push(...it);
  });
  return out;
}

/** Value -> rich text: used by `+` concatenation, format(), join() and text coercion. */
export function toRich(v: FValue): RichText {
  switch (v.type) {
    case 'text': return v.value;
    case 'number': return Number.isNaN(v.value) ? [] : [[String(v.value)]];
    case 'checkbox': return [[v.value ? 'true' : 'false']];
    case 'date': return [dateMention(v.value)];
    case 'person': return [[MENTION, [['u', v.value.id]]]];
    case 'block': return [[MENTION, [['p', v.value.id]]]];
    case 'array': return normalizeRich(interleave(v.values.map(toRich), () => [[',']] as RichText));
    default: return [];
  }
}

/** Merge adjacent plain runs (keeps atoms separate). */
export function normalizeRich(rt: RichText): RichText {
  const out: RichText = [];
  for (const d of rt) {
    if (!d[0]) continue;
    const anns = (d[1] as Annotation[] | undefined) ?? [];
    const prev = out[out.length - 1];
    const isAtom = (x: Decoration) => ((x[1] as Annotation[] | undefined) ?? []).some((a) => ['d', 'u', 'p', 'e'].includes(a[0]));
    if (prev && !isAtom(prev) && !isAtom(d) && JSON.stringify(prev[1] ?? []) === JSON.stringify(d[1] ?? [])) {
      out[out.length - 1] = anns.length ? [prev[0] + d[0], anns] : [prev[0] + d[0]];
    } else out.push(anns.length ? [d[0], anns] : [d[0]]);
  }
  return out;
}

export function personEquals(a: { id: string }, b: { id: string }) {
  return a.id === b.id;
}

/** Deep equality — text compares rendered plain strings. */
export function valuesEqual(a: FValue, b: FValue, r?: TextResolver): boolean {
  if (a.type === 'text' && b.type === 'text') return plainText(a.value, r) === plainText(b.value, r);
  if ((a.type === 'number' && b.type === 'number') || (a.type === 'checkbox' && b.type === 'checkbox')) return a.value === b.value;
  if (a.type === 'date' && b.type === 'date') return sameDate(a.value, b.value);
  if (a.type === 'person' && b.type === 'person') return personEquals(a.value, b.value);
  if (a.type === 'array' && b.type === 'array') {
    if (a.values.length !== b.values.length) return false;
    return a.values.every((x, i) => valuesEqual(x, b.values[i], r));
  }
  if (a.type === 'block' && b.type === 'block') return a.value.id === b.value.id;
  return a.type === 'undefined' && b.type === 'undefined';
}

/** Comparator for sort(): numbers/dates/checkboxes natively, everything else by display text. */
export function compareForSort(a: FValue, b: FValue, r?: TextResolver): number {
  if (a.type === 'date' && b.type === 'date') return compareDates(a.value, b.value, r?.timeZone);
  if (a.type === 'number' && b.type === 'number') return a.value - b.value;
  if (a.type === 'checkbox' && b.type === 'checkbox') return a.value === b.value ? 0 : a.value ? 1 : -1;
  if (a.type === 'undefined') return b.type !== 'undefined' ? 1 : 0;
  if (b.type === 'undefined') return -1;
  return collator.compare(displayText(a, r), displayText(b, r));
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Readable string for any value (used for sorting, text conversion and previews). */
export function displayText(v: FValue, r?: TextResolver, numberFormat?: string, precision?: number | string): string {
  switch (v.type) {
    case 'number': return numberFormat ? formatNumberValue(v.value, numberFormat, precision) : formatNumberValue(v.value, 'number', precision);
    case 'text': return plainText(v.value, r);
    case 'checkbox': return v.value ? 'true' : 'false';
    case 'date': return formatLitDate(v.value, { tz: r?.timeZone, dateFormat: r?.dateFormat, timeFormat: r?.timeFormat });
    case 'person': return r?.userName?.(v.value.id) ?? '';
    case 'block': return r?.pageTitle?.(v.value.id) ?? '';
    case 'array': return v.values.map((x) => displayText(x, r, numberFormat, precision)).join(', ');
    default: return '';
  }
}

/** Flatten nested arrays deeply. */
export function flattenDeep(values: FValue[]): FValue[] {
  const out: FValue[] = [];
  const walk = (vs: FValue[]) => {
    for (const v of vs) {
      if (v.type === 'array') walk(v.values);
      else out.push(v);
    }
  };
  walk(values);
  return out;
}

/** Numbers found in (possibly nested) arguments. */
export function numbersOf(values: FValue[]): number[] {
  return flattenDeep(values).flatMap((v) => (v.type === 'number' ? [v.value] : []));
}
