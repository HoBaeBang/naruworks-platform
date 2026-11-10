// Rich text in Litpage's decoration format: [["plain"], ["bold", [["b"]]], ["‣", [["p", pageId]]]].
// Atoms (mentions "‣", inline equations "⁍") are single characters carrying their payload in an annotation.

export type Annotation =
  | ['b'] // bold
  | ['i'] // italic
  | ['_'] // underline
  | ['s'] // strikethrough
  | ['c'] // inline code
  | ['a', string] // link
  | ['h', string] // color: "red" | "red_background" | ...
  | ['e', string] // inline equation (text is "⁍")
  | ['p', string] // page mention (text "‣")
  | ['p', string, string] // page link inserted via "[[" (pageId, spaceId) — rendered with a link arrow
  | ['u', string] // user mention (text "‣")
  | ['d', DateValue] // date mention (text "‣")
  | ['lm', LinkMentionValue] // link mention (URL pasted "as mention")
  | ['m', string] // discussion (comment) highlight
  | ['sug', string] // suggested edit (legacy marker)
  | ['si', string] // suggested insertion (discussion id) — Litpage "Suggestion insert text"
  | ['sr', string] // suggested deletion (discussion id) — Litpage "Suggestion remove text"
  | ['sa', string, Annotation] // suggested formatting added (discussion id, annotation)
  | ['sua', string, Annotation] // suggested formatting removed (discussion id, annotation)
  | ['ce', string, string?] // custom emoji (text "‣"): workspace emoji id, space id
  | ['tv', 'me' | 'now' | 'today'] // template variable (text "‣"): @me / @now / @today, resolved when a template is used
  | ['g', string, string?]; // group mention (text "‣"): workspace permission group id (space.settings.groups), space id

export interface LinkMentionValue {
  href: string;
  title?: string;
  icon_url?: string;
  description?: string;
  provider?: string;
}

export type Decoration = [string] | [string, Annotation[]];
export type RichText = Decoration[];

export interface DateValue {
  type: 'date' | 'datetime' | 'daterange' | 'datetimerange';
  start_date: string; // YYYY-MM-DD
  start_time?: string; // HH:mm
  end_date?: string;
  end_time?: string;
  time_zone?: string;
  date_format?: string;
  time_format?: string;
  reminder?: { unit: 'minute' | 'hour' | 'day' | 'week'; value: number; time?: string; defaultTimeZone?: string };
}

export const MENTION_CHAR = '‣'; // ‣
export const EQUATION_CHAR = '⁍'; // ⁍
export const ATOM_KEYS = new Set(['e', 'p', 'u', 'd', 'lm', 'ce', 'tv', 'g']);

export function text(s: string): RichText {
  return s ? [[s]] : [];
}

export function annotationsOf(d: Decoration): Annotation[] {
  return (d[1] as Annotation[] | undefined) ?? [];
}

export function isAtom(d: Decoration): boolean {
  return annotationsOf(d).some((a) => ATOM_KEYS.has(a[0]));
}

export function toPlainText(rt: RichText | undefined | null): string {
  if (!rt) return '';
  let out = '';
  for (const d of rt) out += d[0];
  return out;
}

/** Human-readable text: atoms replaced by resolver output (page titles, user names, dates, equations). */
export function toReadableText(rt: RichText | undefined | null, resolve?: (a: Annotation) => string): string {
  if (!rt) return '';
  let out = '';
  for (const d of rt) {
    const atom = annotationsOf(d).find((a) => ATOM_KEYS.has(a[0]));
    if (atom) out += resolve ? resolve(atom) : atom[0] === 'e' ? String(atom[1]) : '';
    else out += d[0];
  }
  return out;
}

export function length(rt: RichText | undefined | null): number {
  if (!rt) return 0;
  let n = 0;
  for (const d of rt) n += d[0].length;
  return n;
}

function sameAnnotations(a: Annotation[], b: Annotation[]): boolean {
  if (a.length !== b.length) return false;
  const key = (x: Annotation) => JSON.stringify(x);
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Merge adjacent runs with identical annotations; drop empty runs; atoms are never merged. */
export function normalize(rt: RichText): RichText {
  const out: RichText = [];
  for (const d of rt) {
    if (!d[0]) continue;
    const anns = annotationsOf(d);
    const prev = out[out.length - 1];
    if (prev && !isAtom(prev) && !isAtom(d) && sameAnnotations(annotationsOf(prev), anns)) {
      const merged = prev[0] + d[0];
      out[out.length - 1] = anns.length ? [merged, anns] : [merged];
    } else {
      out.push(anns.length ? [d[0], anns.map((a) => [...a] as Annotation)] : [d[0]]);
    }
  }
  return out;
}

/** Slice by character offsets [start, end). Atoms are kept whole when they overlap. */
export function slice(rt: RichText, start: number, end = Infinity): RichText {
  const out: RichText = [];
  let pos = 0;
  for (const d of rt) {
    const len = d[0].length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e) {
      const piece = isAtom(d) ? d[0] : d[0].slice(s - pos, e - pos);
      const anns = annotationsOf(d);
      out.push(anns.length ? [piece, anns] : [piece]);
    }
    pos += len;
    if (pos >= end) break;
  }
  return normalize(out);
}

export function concat(...parts: RichText[]): RichText {
  return normalize(parts.flat());
}

export function splitAt(rt: RichText, offset: number): [RichText, RichText] {
  return [slice(rt, 0, offset), slice(rt, offset)];
}

/** Annotations active at an insertion offset (inherits from the run to the left, like Litpage; never inherits atoms/links at boundaries). */
export function annotationsAt(rt: RichText, offset: number): Annotation[] {
  let pos = 0;
  for (const d of rt) {
    const len = d[0].length;
    if (offset > pos && offset <= pos + len) {
      if (isAtom(d)) return [];
      const anns = annotationsOf(d);
      // typing right after a link/code end does not extend it (Litpage behavior)
      if (offset === pos + len) return anns.filter((a) => a[0] !== 'a' && a[0] !== 'c' && a[0] !== 'm');
      return anns;
    }
    pos += len;
  }
  return [];
}

export function insertText(rt: RichText, offset: number, s: string, anns?: Annotation[]): RichText {
  const [a, b] = splitAt(rt, offset);
  const use = anns ?? annotationsAt(rt, offset);
  return concat(a, [use.length ? [s, use] : [s]], b);
}

export function insertRich(rt: RichText, offset: number, ins: RichText): RichText {
  const [a, b] = splitAt(rt, offset);
  return concat(a, ins, b);
}

export function deleteRange(rt: RichText, start: number, end: number): RichText {
  if (end <= start) return rt;
  return concat(slice(rt, 0, start), slice(rt, end));
}

function mapRange(rt: RichText, start: number, end: number, fn: (anns: Annotation[]) => Annotation[]): RichText {
  const out: RichText = [];
  let pos = 0;
  for (const d of rt) {
    const len = d[0].length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s >= e || isAtom(d)) {
      // atoms can still receive formatting (bold/color) but keep their payload
      if (s < e && isAtom(d)) {
        const anns = fn(annotationsOf(d));
        out.push([d[0], anns]);
      } else out.push(d);
    } else {
      const before = d[0].slice(0, s - pos);
      const mid = d[0].slice(s - pos, e - pos);
      const after = d[0].slice(e - pos);
      const anns = annotationsOf(d);
      if (before) out.push(anns.length ? [before, anns] : [before]);
      const next = fn(anns);
      out.push(next.length ? [mid, next] : [mid]);
      if (after) out.push(anns.length ? [after, anns] : [after]);
    }
    pos += len;
  }
  return normalize(out);
}

export function addAnnotation(rt: RichText, start: number, end: number, ann: Annotation): RichText {
  return mapRange(rt, start, end, (anns) => {
    const rest = anns.filter((a) => a[0] !== ann[0] || (ann[0] === 'm' && a[1] !== ann[1]));
    // color annotations: text colors and background colors are independent in Litpage's UI
    if (ann[0] === 'h') {
      const isBg = String(ann[1]).endsWith('_background');
      const keep = anns.filter((a) => a[0] !== 'h' || String(a[1]).endsWith('_background') !== isBg);
      return ann[1] === 'default' || ann[1] === 'default_background' ? keep : [...keep, ann];
    }
    return [...rest, ann];
  });
}

export function removeAnnotation(rt: RichText, start: number, end: number, key: Annotation[0], value?: unknown): RichText {
  return mapRange(rt, start, end, (anns) => anns.filter((a) => !(a[0] === key && (value === undefined || a[1] === value))));
}

/** True if every non-empty character in [start,end) carries annotation key. */
export function hasAnnotation(rt: RichText, start: number, end: number, key: Annotation[0]): boolean {
  if (end <= start) return annotationsAt(rt, start).some((a) => a[0] === key);
  let pos = 0;
  let any = false;
  for (const d of rt) {
    const len = d[0].length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e) {
      any = true;
      if (!annotationsOf(d).some((a) => a[0] === key)) return false;
    }
    pos += len;
  }
  return any;
}

export function toggleAnnotation(rt: RichText, start: number, end: number, ann: Annotation): RichText {
  return hasAnnotation(rt, start, end, ann[0]) ? removeAnnotation(rt, start, end, ann[0]) : addAnnotation(rt, start, end, ann);
}

export function annotationValue(rt: RichText, start: number, end: number, key: Annotation[0]): unknown {
  let pos = 0;
  for (const d of rt) {
    const len = d[0].length;
    if (Math.max(start, pos) < Math.min(end, pos + len) || (start === end && start > pos && start <= pos + len)) {
      const a = annotationsOf(d).find((x) => x[0] === key);
      if (a) return a[1];
    }
    pos += len;
  }
  return undefined;
}

export function equals(a: RichText | undefined, b: RichText | undefined): boolean {
  return JSON.stringify(normalize(a ?? [])) === JSON.stringify(normalize(b ?? []));
}

export function isEmpty(rt: RichText | undefined | null): boolean {
  return length(rt) === 0;
}

export function mention(kind: 'p' | 'u', id: string): RichText {
  return [[MENTION_CHAR, [[kind, id]]]];
}

export function dateMention(value: DateValue): RichText {
  return [[MENTION_CHAR, [['d', value]]]];
}

export function inlineEquation(expr: string): RichText {
  return [[EQUATION_CHAR, [['e', expr]]]];
}
