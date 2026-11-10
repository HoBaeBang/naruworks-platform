// Property values: decode block.properties[propId] (decoration encoding) into typed values,
// format them for display, compare/sort them, and encode edits back into decorations.
// Encodings:
// select [["A"]] · multi_select [["A,B"]] · checkbox [["Yes"]] · number [["12.5"]]
// date [["‣",[["d",{type,start_date,…}]]]] · person [["‣",[["u",id]]],[","],…]
// relation [["‣",[["p",id,spaceId]]],[","],…] · file [["name",[["a",url]]],[","],…]
// place [["‣",[["plc",{lat,lon,name,address}]]]] · created/edited time/by from the block record.
import type { BlockRecord, PropertySchema, SelectOption } from '../records.ts';
import { toPlainText, type DateValue, type RichText } from '../richtext.ts';
import { computeFormula, computeRollup } from './computed.ts';
import { dateValueToRange, formatDateRange, formatTimestamp, msToRange, parseDateInput } from './dates.ts';
import { formatNumber } from './numbers.ts';
import type { DateRange, FileValue, PlaceValue, PropertyValue, QueryContext, Schema, StatusGroup } from './types.ts';

const EMPTY_TEXT: PropertyValue = { kind: 'text', text: '' };

function annotationsOf(d: any): any[] {
  return Array.isArray(d?.[1]) ? d[1] : [];
}

function firstAnnotation(rt: RichText | undefined, key: string): any[] | undefined {
  for (const d of rt ?? []) for (const a of annotationsOf(d)) if (a?.[0] === key) return a;
  return undefined;
}

function allAnnotations(rt: RichText | undefined, key: string): any[][] {
  const out: any[][] = [];
  for (const d of rt ?? []) for (const a of annotationsOf(d)) if (a?.[0] === key) out.push(a);
  return out;
}

export function findOption(prop: PropertySchema | undefined, name: string): SelectOption | undefined {
  const key = name.trim().toLowerCase();
  return prop?.options?.find((o) => o.value.trim().toLowerCase() === key);
}

export function statusGroupOf(prop: PropertySchema | undefined, optionId: string | undefined): StatusGroup | null {
  if (!prop || !optionId) return null;
  const groups = (prop.groups ?? []) as StatusGroup[];
  return groups.find((g) => g.optionIds?.includes(optionId)) ?? null;
}

/** Split a multi-select stored string ("A,B") into option names. */
export function splitMulti(text: string): string[] {
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Resolve a display text for rich text with mention atoms (users, pages, dates). */
export function readableText(rt: RichText | undefined, ctx?: QueryContext): string {
  if (!rt) return '';
  let out = '';
  for (const d of rt) {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => a && ['u', 'p', 'd', 'e', 'g'].includes(a[0]));
    if (!atom) {
      out += d[0];
      continue;
    }
    if (atom[0] === 'g') out += groupMentionName(atom[1], atom[2], ctx);
    else if (atom[0] === 'u') out += userName(atom[1], ctx);
    else if (atom[0] === 'p') out += pageTitle(atom[1], ctx);
    else if (atom[0] === 'd') out += formatDateRange(dateValueToRange(atom[1]));
    else out += String(atom[1] ?? '');
  }
  return out;
}

/** "@Design" for a group mention ["g", groupId, spaceId] (the group lives in space.settings.groups). */
function groupMentionName(groupId: string, spaceId: string | undefined, ctx?: QueryContext): string {
  const space = spaceId ? ctx?.getRecord?.('space', spaceId) : undefined;
  const g = ((space?.settings?.groups ?? []) as { id: string; name?: string }[]).find((x) => x?.id === groupId);
  return `@${g?.name || 'Deleted group'}`;
}

export function userName(id: string, ctx?: QueryContext): string {
  const u = ctx?.getRecord?.('lit_user', id);
  return (u?.name as string) || (u?.email as string) || '';
}

export function pageTitle(id: string, ctx?: QueryContext): string {
  const b = ctx?.getRecord?.('block', id);
  return toPlainText(b?.properties?.title) || (b ? 'Untitled' : '');
}

/** Raw (non-computed) decode of a stored property value. */
export function decodeStored(raw: RichText | undefined, prop: PropertySchema | undefined, row?: BlockRecord, ctx?: QueryContext): PropertyValue {
  const type = prop?.type ?? 'text';
  switch (type) {
    case 'title':
    case 'text':
      return { kind: 'text', text: readableText(raw, ctx), rich: raw ?? [] };
    case 'url':
    case 'email':
    case 'phone_number':
      return { kind: 'text', text: toPlainText(raw) };
    case 'number': {
      const s = toPlainText(raw).trim();
      if (!s) return { kind: 'number', number: null };
      const n = Number(s.replace(/,/g, ''));
      return { kind: 'number', number: Number.isFinite(n) ? n : null };
    }
    case 'auto_increment_id': {
      const s = toPlainText(raw).trim();
      const n = s ? Number(s.replace(/^\D+/, '')) : NaN;
      return { kind: 'number', number: Number.isFinite(n) ? n : null };
    }
    case 'checkbox':
      return { kind: 'checkbox', checked: toPlainText(raw).trim() === 'Yes' };
    case 'select': {
      const s = toPlainText(raw).trim();
      if (!s) return { kind: 'select', options: [] };
      return { kind: 'select', options: [findOption(prop, s) ?? { id: '', value: s, color: 'default' }] };
    }
    case 'multi_select': {
      const names = splitMulti(toPlainText(raw));
      return { kind: 'select', options: names.map((n) => findOption(prop, n) ?? { id: '', value: n, color: 'default' }) };
    }
    case 'status': {
      let s = toPlainText(raw).trim();
      if (!s && prop?.defaultOption) s = String(prop.defaultOption);
      if (!s) return { kind: 'status', option: null, group: null };
      const opt = findOption(prop, s) ?? { id: '', value: s, color: 'default' };
      return { kind: 'status', option: opt, group: statusGroupOf(prop, opt.id) };
    }
    case 'date': {
      const a = firstAnnotation(raw, 'd');
      return { kind: 'date', date: dateValueToRange(a?.[1] as DateValue | undefined) };
    }
    case 'person': {
      const ids = allAnnotations(raw, 'u').map((a) => String(a[1]));
      const groups = allAnnotations(raw, 'g').map((a) => ({ id: String(a[1]), ...(a[2] ? { spaceId: String(a[2]) } : {}) }));
      return groups.length ? { kind: 'person', ids, groups } : { kind: 'person', ids };
    }
    case 'relation':
      return { kind: 'relation', ids: allAnnotations(raw, 'p').map((a) => String(a[1])) };
    case 'file': {
      const files: FileValue[] = [];
      for (const d of raw ?? []) {
        const anns = annotationsOf(d);
        const link = anns.find((a) => a?.[0] === 'a');
        const page = anns.find((a) => a?.[0] === 'p');
        if (link) files.push({ name: d[0], url: String(link[1]) });
        else if (page) {
          const fb = ctx?.getRecord?.('block', page[1]);
          const src = toPlainText(fb?.properties?.source);
          files.push({ name: toPlainText(fb?.properties?.title) || src.split('/').pop() || 'File', url: src, id: page[1] });
        }
      }
      return { kind: 'file', files };
    }
    case 'place': {
      const a = firstAnnotation(raw, 'plc');
      if (a?.[1]) return { kind: 'place', place: a[1] as PlaceValue };
      const s = toPlainText(raw).trim();
      return { kind: 'place', place: s ? { name: s } : null };
    }
    case 'verification': {
      const a = firstAnnotation(raw, 'vr');
      if (a?.[1]) {
        const v = a[1] as { state?: string; date?: DateValue; user?: string };
        let state = (v.state ?? 'none') as 'verified' | 'expired' | 'none';
        const date = dateValueToRange(v.date);
        const end = date?.endMs ?? (date?.isRange ? undefined : undefined);
        if (state === 'verified' && end !== undefined && end < (ctx?.now ?? Date.now())) state = 'expired';
        return { kind: 'verification', state, date, by: v.user };
      }
      const s = toPlainText(raw).trim();
      return { kind: 'verification', state: s === 'verified' || s === 'expired' ? s : 'none' };
    }
    case 'button':
      return { kind: 'button' };
    case 'created_time':
      return { kind: 'date', date: row ? msToRange(row.created_time) : null };
    case 'last_edited_time':
      return { kind: 'date', date: row ? msToRange(row.last_edited_time) : null };
    case 'created_by':
      return { kind: 'person', ids: row?.created_by_id ? [row.created_by_id] : [] };
    case 'last_edited_by':
      return { kind: 'person', ids: row?.last_edited_by_id ? [row.last_edited_by_id] : [] };
    case 'location': {
      const col = row ? ctx?.getRecord?.('collection', row.parent_id) : undefined;
      return { kind: 'text', text: col ? toPlainText(col.name) || 'Untitled' : '' };
    }
    default:
      return raw ? { kind: 'text', text: toPlainText(raw) } : EMPTY_TEXT;
  }
}

/**
 * Typed value of `propId` for `row` (formula / rollup computed through computed.ts).
 * This is the shared entry point for every view and for the formula engine (prop("…")).
 */
export function getPropertyValue(row: BlockRecord, propId: string, schema: Schema, ctx: QueryContext = {}): PropertyValue {
  const prop = schema[propId];
  if (!prop) return EMPTY_TEXT;
  if (prop.type === 'formula' || prop.type === 'rollup') {
    const key = `${row.id}:${propId}:${row.version ?? 0}`;
    const cached = ctx.cache?.get(key);
    if (cached) return cached;
    const depth = ctx.depth ?? 0;
    if (depth > 15) return { kind: 'error', message: 'Formula recursion limit' };
    const sub: QueryContext = { ...ctx, depth: depth + 1 };
    const v = prop.type === 'formula' ? computeFormula(row, propId, schema, sub) : computeRollup(row, propId, schema, sub);
    ctx.cache?.set(key, v);
    return v;
  }
  const raw = propId === 'title' || prop.type === 'title' ? (row.properties?.title as RichText | undefined) : (row.properties?.[propId] as RichText | undefined);
  return decodeStored(raw, prop, row, ctx);
}

export function isEmptyValue(v: PropertyValue): boolean {
  switch (v.kind) {
    case 'text': return v.text.trim() === '';
    case 'number': return v.number === null;
    case 'checkbox': return !v.checked;
    case 'select': return v.options.length === 0;
    case 'status': return !v.option;
    case 'date': return !v.date;
    case 'person': return v.ids.length === 0 && !v.groups?.length;
    case 'relation': return v.ids.length === 0;
    case 'file': return v.files.length === 0;
    case 'place': return !v.place;
    case 'verification': return v.state === 'none';
    case 'button': return true;
    case 'array': return v.items.length === 0 || v.items.every(isEmptyValue);
    case 'error': return true;
  }
}

/** Plain text of a value (search, CSV export, text comparisons). */
export function valueToText(v: PropertyValue, prop?: PropertySchema, ctx?: QueryContext): string {
  switch (v.kind) {
    case 'text': return v.text;
    case 'number':
      if (prop?.type === 'auto_increment_id') return v.number === null ? '' : `${prop.prefix ? `${prop.prefix}-` : ''}${v.number}`;
      return formatNumber(v.number, prop?.number_format as string | undefined, prop?.number_precision as string | undefined);
    case 'checkbox': return v.checked ? 'Yes' : 'No';
    case 'select': return v.options.map((o) => o.value).join(', ');
    case 'status': return v.option?.value ?? '';
    case 'date':
      if (!v.date) return '';
      if (prop?.type === 'created_time' || prop?.type === 'last_edited_time') return formatTimestamp(v.date.startMs, { dateFormat: prop?.date_format as string | undefined, timeFormat: prop?.time_format as string | undefined, now: ctx?.now });
      return formatDateRange(v.date, { dateFormat: (v.date.raw?.date_format ?? prop?.date_format) as string | undefined, timeFormat: (v.date.raw?.time_format ?? prop?.time_format) as string | undefined, now: ctx?.now });
    case 'person': return [...v.ids.map((id) => userName(id, ctx)), ...(v.groups ?? []).map((g) => groupMentionName(g.id, g.spaceId, ctx).replace(/^@/, ''))].filter(Boolean).join(', ');
    case 'relation': return v.ids.map((id) => pageTitle(id, ctx)).filter(Boolean).join(', ');
    case 'file': return v.files.map((f) => f.name).join(', ');
    case 'place': return v.place ? [v.place.name, v.place.address].filter(Boolean).join(', ') : '';
    case 'verification': return v.state === 'none' ? '' : v.state === 'verified' ? 'Verified' : 'Expired';
    case 'button': return '';
    case 'array': return v.items.map((i) => valueToText(i, undefined, ctx)).filter(Boolean).join(', ');
    case 'error': return '';
  }
}

/** Display string for a property value (cells, cards, CSV). */
export function formatPropertyValue(v: PropertyValue, prop?: PropertySchema, ctx?: QueryContext): string {
  return valueToText(v, prop, ctx);
}

/** Numeric view of a value (aggregations, number filters on formula results). */
export function valueToNumber(v: PropertyValue): number | null {
  switch (v.kind) {
    case 'number': return v.number;
    case 'checkbox': return v.checked ? 1 : 0;
    case 'date': return v.date ? v.date.startMs : null;
    case 'text': {
      const n = Number(v.text);
      return v.text.trim() !== '' && Number.isFinite(n) ? n : null;
    }
    default: return null;
  }
}

/** Values that count as distinct entries (multi-value types expand). */
export function valueKeys(v: PropertyValue): string[] {
  switch (v.kind) {
    case 'text': return v.text.trim() ? [v.text.trim()] : [];
    case 'number': return v.number === null ? [] : [String(v.number)];
    case 'checkbox': return [v.checked ? 'Yes' : 'No'];
    case 'select': return v.options.map((o) => o.value);
    case 'status': return v.option ? [v.option.value] : [];
    case 'date': return v.date ? [`${v.date.start}${v.date.startTime ? `T${v.date.startTime}` : ''}${v.date.end ? `/${v.date.end}` : ''}`] : [];
    case 'person':
    case 'relation': return v.ids;
    case 'file': return v.files.map((f) => f.url || f.name);
    case 'place': return v.place ? [JSON.stringify([v.place.lat, v.place.lon, v.place.name])] : [];
    case 'verification': return v.state === 'none' ? [] : [v.state];
    case 'array': return v.items.flatMap(valueKeys);
    default: return [];
  }
}

// ---------- comparison (sorting) ---------

function optionRank(prop: PropertySchema | undefined, o: SelectOption): number {
  const opts = prop?.options ?? [];
  if (prop?.type === 'status') {
    const groups = (prop.groups ?? []) as StatusGroup[];
    const gi = groups.findIndex((g) => g.optionIds?.includes(o.id));
    const oi = opts.findIndex((x) => x.id === o.id);
    return (gi < 0 ? groups.length : gi) * 10_000 + (oi < 0 ? 9_999 : oi);
  }
  const i = opts.findIndex((x) => x.id === o.id || x.value === o.value);
  return i < 0 ? 9_999 : i;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * Compare two values of the same property (ascending). Empty values compare as `null`
 * and are placed last by the caller regardless of direction.
 */
export function compareValues(a: PropertyValue, b: PropertyValue, prop?: PropertySchema, ctx?: QueryContext): number {
  if (a.kind === 'select' && b.kind === 'select') {
    const ra = a.options.map((o) => optionRank(prop, o)).sort((x, y) => x - y);
    const rb = b.options.map((o) => optionRank(prop, o)).sort((x, y) => x - y);
    for (let i = 0; i < Math.min(ra.length, rb.length); i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return ra.length - rb.length;
  }
  if (a.kind === 'status' && b.kind === 'status') return optionRank(prop, a.option!) - optionRank(prop, b.option!);
  if (a.kind === 'number' && b.kind === 'number') return (a.number ?? 0) - (b.number ?? 0);
  if (a.kind === 'checkbox' && b.kind === 'checkbox') return Number(a.checked) - Number(b.checked);
  if (a.kind === 'date' && b.kind === 'date') return (a.date?.startMs ?? 0) - (b.date?.startMs ?? 0) || (a.date?.endMs ?? 0) - (b.date?.endMs ?? 0);
  return collator.compare(valueToText(a, prop, ctx), valueToText(b, prop, ctx));
}

// ---------- encoding (edits) ---------

export function encodeText(text: string): RichText | undefined {
  return text ? [[text]] : undefined;
}

export function encodeNumber(n: number | null | undefined): RichText | undefined {
  return n === null || n === undefined || Number.isNaN(n) ? undefined : [[String(n)]];
}

export function encodeCheckbox(checked: boolean): RichText {
  return [[checked ? 'Yes' : 'No']];
}

export function encodeSelect(names: string[]): RichText | undefined {
  const clean = names.map((n) => n.replace(/,/g, ' ').trim()).filter(Boolean);
  return clean.length ? [[clean.join(',')]] : undefined;
}

export function encodeDate(v: DateValue | null | undefined): RichText | undefined {
  return v ? ([['‣', [['d', v]]]] as any) : undefined;
}

function joinAtoms(atoms: any[]): RichText | undefined {
  if (!atoms.length) return undefined;
  const out: any[] = [];
  atoms.forEach((a, i) => {
    if (i) out.push([',']);
    out.push(a);
  });
  return out as RichText;
}

export function encodePeople(ids: string[], groups: { id: string; spaceId?: string }[] = []): RichText | undefined {
  const seen = new Set<string>();
  const groupAtoms = groups.filter((g) => g?.id && !seen.has(g.id) && seen.add(g.id)).map((g) => ['‣', [g.spaceId ? ['g', g.id, g.spaceId] : ['g', g.id]]]);
  return joinAtoms([...[...new Set(ids)].map((id) => ['‣', [['u', id]]]), ...groupAtoms] as any);
}

export function encodeRelation(ids: string[], spaceId?: string): RichText | undefined {
  return joinAtoms([...new Set(ids)].map((id) => ['‣', [spaceId ? ['p', id, spaceId] : ['p', id]]]));
}

export function encodeFiles(files: FileValue[]): RichText | undefined {
  return joinAtoms(files.map((f) => (f.id ? ['‣', [['p', f.id]]] : [f.name || f.url, [['a', f.url]]])));
}

export function encodePlace(place: PlaceValue | null): RichText | undefined {
  return place ? ([['‣', [['plc', place]]]] as any) : undefined;
}

export function encodeVerification(v: { state: 'verified' | 'none'; date?: DateValue; user?: string } | null): RichText | undefined {
  return v && v.state !== 'none' ? ([['‣', [['vr', v]]]] as any) : undefined;
}

/** Encode a typed value for a target property type (used by "Change type" conversions and paste). */
export function encodeValueAs(v: PropertyValue, target: PropertySchema, ctx?: QueryContext): RichText | undefined {
  switch (target.type) {
    case 'title':
    case 'text':
      if (v.kind === 'text' && v.rich) return v.rich.length ? v.rich : undefined;
      return encodeText(valueToText(v, undefined, ctx));
    case 'url':
    case 'email':
    case 'phone_number':
      return encodeText(valueToText(v, undefined, ctx));
    case 'number': {
      const n = v.kind === 'number' ? v.number : valueToNumber(v.kind === 'date' ? EMPTY_TEXT : v);
      return encodeNumber(n);
    }
    case 'checkbox': {
      if (v.kind === 'checkbox') return encodeCheckbox(v.checked);
      const t = valueToText(v, undefined, ctx).trim().toLowerCase();
      return encodeCheckbox(t === 'yes' || t === 'true' || t === 'checked' || t === '1');
    }
    case 'select':
    case 'multi_select':
    case 'status': {
      let names: string[];
      if (v.kind === 'select') names = v.options.map((o) => o.value);
      else if (v.kind === 'status') names = v.option ? [v.option.value] : [];
      else names = splitMulti(valueToText(v, undefined, ctx));
      if (target.type !== 'multi_select') names = names.slice(0, 1);
      return encodeSelect(names);
    }
    case 'date': {
      if (v.kind === 'date' && v.date) return encodeDate(v.date.raw ?? { type: v.date.hasTime ? 'datetime' : 'date', start_date: v.date.start, ...(v.date.hasTime ? { start_time: v.date.startTime } : {}) });
      // Text → Date keeps values that read as dates ("Oct 20, 2026", "2026-10-20", "10월 20일")
      const text = v.kind === 'text' ? v.text.trim() : '';
      const ymd = text ? parseDateInput(text, ctx?.now ?? Date.now()) : null;
      return ymd ? encodeDate({ type: 'date', start_date: ymd }) : undefined;
    }
    case 'person':
      return v.kind === 'person' ? encodePeople(v.ids, v.groups) : undefined;
    case 'relation':
      return v.kind === 'relation' ? encodeRelation(v.ids) : undefined;
    case 'file':
      return v.kind === 'file' ? encodeFiles(v.files) : undefined;
    case 'place': {
      if (v.kind === 'place') return encodePlace(v.place);
      // Text → Place: the text becomes the place name
      const text = valueToText(v, undefined, ctx).trim();
      return text ? encodePlace({ name: text }) : undefined;
    }
    default:
      return undefined;
  }
}

/** Options to add to a select/multi-select/status schema when converting values into it. */
export function optionNamesFromValues(values: PropertyValue[], ctx?: QueryContext): string[] {
  const names: string[] = [];
  for (const v of values) {
    let n: string[] = [];
    if (v.kind === 'select') n = v.options.map((o) => o.value);
    else if (v.kind === 'status') n = v.option ? [v.option.value] : [];
    else n = splitMulti(valueToText(v, undefined, ctx));
    for (const x of n) if (!names.some((y) => y.toLowerCase() === x.toLowerCase())) names.push(x);
  }
  return names;
}

export type { DateRange };
