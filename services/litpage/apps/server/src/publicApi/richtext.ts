// Rich text ↔ public API rich text objects:
// { type: "text", text: { content, link }, annotations: { bold, italic, strikethrough, underline, code, color },
// plain_text, href }
// { type: "mention", mention: { type: "user" | "page" | "database" | "date" | "link_mention" | "template_mention", … } }
// { type: "equation", equation: { expression } }
// Stored decorations: packages/shared/src/richtext.ts ([text, [["b"], ["a", url], ["h", color], ["‣"…]]]).
import type { BlockRecord, CollectionRecord, UserRecord } from '@nc/shared/records.ts';
import { annotationsOf, normalize, type Annotation, type DateValue, type RichText } from '@nc/shared/richtext.ts';
import { expandId } from '@nc/shared/ids.ts';
import { safeHref } from '@nc/shared/url.ts';
import { getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { pageLink } from '../notify.ts';
import { invalid } from './errors.ts';

export const COLORS = [
  'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
  'default_background', 'gray_background', 'brown_background', 'orange_background', 'yellow_background', 'green_background',
  'blue_background', 'purple_background', 'pink_background', 'red_background',
];

const MAX_TEXT = 2000;

export interface Annotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

export interface ApiRichText {
  type: 'text' | 'mention' | 'equation';
  text?: { content: string; link: { url: string } | null };
  mention?: Record<string, unknown>;
  equation?: { expression: string };
  annotations: Annotations;
  plain_text: string;
  href: string | null;
}

export interface RichTextReader {
  /** acting principal (bot or person) */
  principalId: string;
}

const iso = (ms: number | undefined | null) => (ms ? new Date(ms).toISOString() : null);
export { iso };

function annotationsFrom(anns: Annotation[]): { a: Annotations; link: string | null } {
  const a: Annotations = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
  let link: string | null = null;
  for (const x of anns) {
    switch (x[0]) {
      case 'b': a.bold = true; break;
      case 'i': a.italic = true; break;
      case 's': a.strikethrough = true; break;
      case '_': a.underline = true; break;
      case 'c': a.code = true; break;
      case 'h': if (COLORS.includes(String(x[1]))) a.color = String(x[1]); break;
      case 'a': link = safeHref(x[1]) ? String(x[1]) : null; break;
    }
  }
  return { a, link };
}

/** "2026-10-21" / "2026-10-21T09:30:00.000+00:00" from a stored date (time zone kept separately). */
export function dateToApi(v: DateValue | undefined | null): { start: string; end: string | null; time_zone: string | null } | null {
  if (!v?.start_date) return null;
  const one = (d: string | undefined, t: string | undefined) => {
    if (!d) return null;
    if (!t) return d;
    return v.time_zone ? `${d}T${t}:00.000` : `${d}T${t}:00.000+00:00`;
  };
  const hasEnd = v.type === 'daterange' || v.type === 'datetimerange' || !!v.end_date;
  return { start: one(v.start_date, v.start_time)!, end: hasEnd ? one(v.end_date ?? v.start_date, v.end_time) : null, time_zone: v.time_zone ?? null };
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseOne(s: unknown, field: string): { date: string; time?: string; utc: boolean } {
  if (typeof s !== 'string') throw invalid(`${field} must be a string, instead was \`${JSON.stringify(s)}\`.`);
  const m = DATE_RE.exec(s.trim());
  if (!m) throw invalid(`${field} must be a valid ISO 8601 date string, instead was \`"${s}"\`.`);
  if (!m[2]) return { date: m[1], utc: false };
  if (m[5]) {
    // an explicit offset: keep the instant (stored as UTC wall time)
    const d = new Date(s.trim());
    if (Number.isNaN(d.getTime())) throw invalid(`${field} must be a valid ISO 8601 date string, instead was \`"${s}"\`.`);
    const isoS = d.toISOString();
    return { date: isoS.slice(0, 10), time: isoS.slice(11, 16), utc: true };
  }
  return { date: m[1], time: `${m[2]}:${m[3]}`, utc: false };
}

/** API date object → stored DateValue. */
export function dateFromApi(raw: unknown, field = 'date'): DateValue | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') throw invalid(`${field} must be an object or \`null\`, instead was \`${JSON.stringify(raw)}\`.`);
  const o = raw as { start?: unknown; end?: unknown; time_zone?: unknown };
  const start = parseOne(o.start, `${field}.start`);
  const end = o.end === undefined || o.end === null ? null : parseOne(o.end, `${field}.end`);
  const tz = typeof o.time_zone === 'string' && o.time_zone ? o.time_zone.slice(0, 64) : (start.utc ? 'UTC' : undefined);
  const timed = !!start.time || !!end?.time;
  const v: DateValue = { type: end ? (timed ? 'datetimerange' : 'daterange') : (timed ? 'datetime' : 'date'), start_date: start.date };
  if (start.time) v.start_time = start.time;
  if (end) {
    v.end_date = end.date;
    if (end.time) v.end_time = end.time;
  }
  if (tz && timed) v.time_zone = tz;
  return v;
}

function readableDate(v: DateValue): string {
  const d = dateToApi(v);
  if (!d) return '';
  return d.end ? `${d.start} → ${d.end}` : d.start;
}

/** Stored rich text → API rich text array (at most 2,000 characters per object). */
export function toApiRichText(rt: RichText | undefined | null, reader: RichTextReader): ApiRichText[] {
  const out: ApiRichText[] = [];
  for (const d of rt ?? []) {
    const anns = annotationsOf(d);
    // suggested insertions are not part of the content until accepted
    if (anns.some((x) => x[0] === 'si')) continue;
    const { a, link } = annotationsFrom(anns);
    const atom = anns.find((x) => ['p', 'u', 'd', 'e', 'lm', 'ce', 'tv', 'g'].includes(x[0]));
    if (atom) {
      out.push(atomToApi(atom, a, reader));
      continue;
    }
    const text = d[0];
    for (let i = 0; i < text.length || (i === 0 && !text.length); i += MAX_TEXT) {
      const part = text.slice(i, i + MAX_TEXT);
      if (!part) break;
      out.push({ type: 'text', text: { content: part, link: link ? { url: link } : null }, annotations: { ...a }, plain_text: part, href: link });
    }
  }
  return out;
}

function atomToApi(atom: Annotation, a: Annotations, reader: RichTextReader): ApiRichText {
  switch (atom[0]) {
    case 'p': {
      const id = String(atom[1]);
      const b = getRecord<BlockRecord>('block', id);
      const visible = !!b && b.alive !== false && blockRole(id, reader.principalId) !== 'none';
      const isDb = !!b && (b.type === 'collection_view_page' || b.type === 'collection_view');
      let title = 'Untitled';
      if (visible && b) {
        title = isDb && b.collection_id ? (getRecord<CollectionRecord>('collection', b.collection_id)?.name ?? []).map((x) => x[0]).join('') || 'Untitled'
          : (b.properties?.title ?? []).map((x) => x[0]).join('').replace(/[‣⁍]/g, '') || 'Untitled';
      }
      return {
        type: 'mention', mention: isDb ? { type: 'database', database: { id } } : { type: 'page', page: { id } },
        annotations: a, plain_text: title, href: visible ? pageLink(id) : null,
      };
    }
    case 'u': {
      const id = String(atom[1]);
      const u = getRecord<UserRecord>('lit_user', id);
      return { type: 'mention', mention: { type: 'user', user: { object: 'user', id } }, annotations: a, plain_text: `@${u?.name || 'Unknown'}`, href: null };
    }
    case 'd': {
      const v = atom[1] as DateValue;
      return { type: 'mention', mention: { type: 'date', date: dateToApi(v) }, annotations: a, plain_text: readableDate(v), href: null };
    }
    case 'e':
      return { type: 'equation', equation: { expression: String(atom[1]) }, annotations: a, plain_text: String(atom[1]), href: null };
    case 'lm': {
      const v = (atom[1] ?? {}) as { href?: string; title?: string };
      const href = safeHref(v.href) ?? null;
      return { type: 'mention', mention: { type: 'link_mention', link_mention: { href: href ?? '', title: v.title ?? href ?? '' } }, annotations: a, plain_text: v.title || href || '', href };
    }
    case 'tv': {
      const k = String(atom[1]);
      const mention = k === 'me' ? { type: 'template_mention', template_mention: { type: 'template_mention_user', template_mention_user: 'me' } }
        : { type: 'template_mention', template_mention: { type: 'template_mention_date', template_mention_date: k === 'now' ? 'now' : 'today' } };
      return { type: 'mention', mention, annotations: a, plain_text: k === 'me' ? '@Me' : k === 'now' ? '@Now' : '@Today', href: null };
    }
    case 'ce':
      return { type: 'mention', mention: { type: 'custom_emoji', custom_emoji: { id: String(atom[1]) } }, annotations: a, plain_text: ':emoji:', href: null };
    default:
      return { type: 'text', text: { content: '@group', link: null }, annotations: a, plain_text: '@group', href: null };
  }
}

export function plainOf(arr: ApiRichText[]): string {
  return arr.map((r) => r.plain_text).join('');
}

/** API rich text array → stored rich text. Mentions must point at things the principal can see. */
export function fromApiRichText(raw: unknown, reader: RichTextReader, field = 'rich_text'): RichText {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw invalid(`Invalid request: ${field} must be an array, instead was \`${JSON.stringify(raw).slice(0, 80)}\`.`);
  if (raw.length > 100) throw invalid(`Invalid request: ${field}.length must be ≤ \`100\`, instead was \`${raw.length}\`.`);
  const out: RichText = [];
  raw.forEach((item, i) => {
    const path = `${field}[${i}]`;
    if (!item || typeof item !== 'object') throw invalid(`Invalid request: ${path} must be an object.`);
    const o = item as Record<string, any>;
    const type = o.type ?? (o.text ? 'text' : o.mention ? 'mention' : o.equation ? 'equation' : undefined);
    const anns: Annotation[] = [];
    const ann = o.annotations && typeof o.annotations === 'object' ? o.annotations : {};
    if (ann.bold === true) anns.push(['b']);
    if (ann.italic === true) anns.push(['i']);
    if (ann.strikethrough === true) anns.push(['s']);
    if (ann.underline === true) anns.push(['_']);
    if (ann.code === true) anns.push(['c']);
    if (typeof ann.color === 'string' && ann.color !== 'default') {
      if (!COLORS.includes(ann.color)) throw invalid(`Invalid request: ${path}.annotations.color must be a valid color, instead was \`"${ann.color}"\`.`);
      anns.push(['h', ann.color]);
    }
    if (type === 'text') {
      const content = o.text?.content;
      if (typeof content !== 'string') throw invalid(`Invalid request: ${path}.text.content is required, instead was \`undefined\`.`);
      if (content.length > MAX_TEXT) throw invalid(`Invalid request: ${path}.text.content.length must be ≤ \`2000\`, instead was \`${content.length}\`.`);
      const url = o.text?.link?.url;
      if (url !== undefined && url !== null) {
        if (typeof url !== 'string' || !safeHref(url) || url.length > 2000) throw invalid(`Invalid request: ${path}.text.link.url must be a valid URL.`);
        anns.push(['a', url]);
      }
      if (content) out.push(anns.length ? [content, anns] : [content]);
      return;
    }
    if (type === 'equation') {
      const expr = o.equation?.expression;
      if (typeof expr !== 'string' || !expr || expr.length > 1000) throw invalid(`Invalid request: ${path}.equation.expression must be a non-empty string.`);
      out.push(['⁍', [...anns, ['e', expr]]]);
      return;
    }
    if (type === 'mention') {
      const m = o.mention ?? {};
      const mt = m.type ?? (m.user ? 'user' : m.page ? 'page' : m.database ? 'database' : m.date ? 'date' : undefined);
      if (mt === 'user') {
        const id = expandId(String(m.user?.id ?? ''));
        const u = getRecord<UserRecord>('lit_user', id);
        if (!u) throw invalid(`Invalid request: ${path}.mention.user.id does not identify a user.`);
        out.push(['‣', [...anns, ['u', id]]]);
        return;
      }
      if (mt === 'page' || mt === 'database') {
        const id = expandId(String((m.page ?? m.database)?.id ?? ''));
        const b = getRecord<BlockRecord>('block', id);
        if (!b || blockRole(id, reader.principalId) === 'none') throw invalid(`No ${mt} with id ${id} is available to this connection.`);
        out.push(['‣', [...anns, ['p', id]]]);
        return;
      }
      if (mt === 'date') {
        const v = dateFromApi(m.date, `${path}.mention.date`);
        if (!v) throw invalid(`Invalid request: ${path}.mention.date is required.`);
        out.push(['‣', [...anns, ['d', v]]]);
        return;
      }
      if (mt === 'template_mention') {
        const t = m.template_mention ?? {};
        const k = t.type === 'template_mention_user' ? 'me' : t.template_mention_date === 'now' ? 'now' : 'today';
        out.push(['‣', [...anns, ['tv', k]]]);
        return;
      }
      if (mt === 'link_mention') {
        const href = m.link_mention?.href;
        if (typeof href !== 'string' || !safeHref(href)) throw invalid(`Invalid request: ${path}.mention.link_mention.href must be a valid URL.`);
        out.push(['‣', [...anns, ['lm', { href }]]]);
        return;
      }
      throw invalid(`Invalid request: ${path}.mention must be one of user, page, database, date, template_mention, link_mention.`);
    }
    throw invalid(`Invalid request: ${path}.type must be \`"text"\`, \`"mention"\` or \`"equation"\`, instead was \`${JSON.stringify(type)}\`.`);
  });
  return normalize(out);
}
