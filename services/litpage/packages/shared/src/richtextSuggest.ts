// Suggested edits in rich text, as suggestion annotations:
// ["si", discussionId] suggested insertion (the text is shown, not yet part of the page)
// ["sr", discussionId] suggested removal (the text stays, struck through, until accepted)
// ["sa", discussionId, annotation] suggested formatting added ["sua", discussionId, annotation] … removed
// A suggestion is a discussion (type "suggestion") on the block; accepting applies the change, rejecting drops it.
// Shared by the editor (typing in suggest mode, accept/reject) and the server (authz: a comment-only user may change a
// block's text only through suggestions of their own — `isSuggestionOnlyEdit`).
import { annotationsOf, deleteRange, insertText, isAtom, length, normalize, slice, toPlainText, type Annotation, type Decoration, type RichText } from './richtext.ts';

export const SUGGESTION_KEYS = new Set(['si', 'sr', 'sa', 'sua', 'sug']);

const isSuggestionAnn = (a: Annotation) => SUGGESTION_KEYS.has(a[0]);

/** Suggestion discussion ids present in a rich text value. */
export function suggestionIds(rt: RichText | undefined | null): string[] {
  const out = new Set<string>();
  for (const d of rt ?? []) for (const a of annotationsOf(d)) if (isSuggestionAnn(a) && typeof a[1] === 'string') out.add(a[1]);
  return [...out];
}

/** What the page says if every suggestion were rejected: suggested insertions removed, suggestion marks dropped. */
export function acceptedView(rt: RichText | undefined | null): RichText {
  const out: RichText = [];
  for (const d of rt ?? []) {
    const anns = annotationsOf(d);
    if (anns.some((a) => a[0] === 'si')) continue;
    const keep = anns.filter((a) => !isSuggestionAnn(a));
    out.push(keep.length ? [d[0], keep] : [d[0]]);
  }
  return normalize(out);
}

/** Stable description of everything suggestion `id` does in `rt` (kind + text per run, in order). */
export function suggestionSignature(rt: RichText | undefined | null, id: string): string {
  const parts: string[] = [];
  for (const d of rt ?? []) {
    for (const a of annotationsOf(d)) {
      if (!isSuggestionAnn(a) || a[1] !== id) continue;
      parts.push(`${a[0]}:${a[0] === 'sa' || a[0] === 'sua' ? JSON.stringify(a[2]) : ''}:${d[0]}`);
    }
  }
  return parts.join('\u0000');
}

/**
 * Server check for a commenter's text edit: the accepted text (with its formatting, links, mentions) must not change,
 * and every suggestion whose spans changed must be one the user owns (`owns(id)` — a suggestion discussion they
 * created). Rejecting one's own suggestion is allowed; accepting (which changes the accepted text) is not.
 */
export function isSuggestionOnlyEdit(before: RichText | undefined | null, after: RichText | undefined | null, owns: (id: string) => boolean): boolean {
  if (JSON.stringify(acceptedView(before)) !== JSON.stringify(acceptedView(after))) return false;
  for (const id of new Set([...suggestionIds(before), ...suggestionIds(after)])) {
    if (suggestionSignature(before, id) !== suggestionSignature(after, id) && !owns(id)) return false;
  }
  return true;
}

/** Map every run with a predicate over its annotations (atoms keep their payload). */
function mapRuns(rt: RichText, fn: (d: Decoration, anns: Annotation[]) => Decoration | null): RichText {
  const out: RichText = [];
  for (const d of rt) {
    const r = fn(d, annotationsOf(d));
    if (r && r[0]) out.push(r);
  }
  return normalize(out);
}

const withAnns = (text: string, anns: Annotation[]): Decoration => (anns.length ? [text, anns] : [text]);

/** Accept suggestion `id`: insertions become plain text, removals are deleted, formatting is applied. */
export function acceptSuggestion(rt: RichText, id: string): RichText {
  return mapRuns(rt, (d, anns) => {
    if (anns.some((a) => a[0] === 'sr' && a[1] === id)) return null;
    let next = anns.filter((a) => !((a[0] === 'si' || a[0] === 'sr') && a[1] === id));
    for (const a of anns) {
      if (a[0] === 'sa' && a[1] === id) {
        const inner = a[2] as Annotation;
        next = [...next.filter((x) => !(x[0] === 'sa' && x[1] === id) && x[0] !== inner[0]), inner];
      } else if (a[0] === 'sua' && a[1] === id) {
        const inner = a[2] as Annotation;
        next = next.filter((x) => !(x[0] === 'sua' && x[1] === id) && x[0] !== inner[0]);
      }
    }
    return withAnns(d[0], next);
  });
}

/** Reject suggestion `id`: insertions are deleted, removals and formatting marks are dropped. */
export function rejectSuggestion(rt: RichText, id: string): RichText {
  return mapRuns(rt, (d, anns) => {
    if (anns.some((a) => a[0] === 'si' && a[1] === id)) return null;
    return withAnns(d[0], anns.filter((a) => !(isSuggestionAnn(a) && a[1] === id)));
  });
}

export interface SuggestionSummary {
  kind: 'add' | 'remove' | 'replace' | 'format' | 'unformat' | 'empty';
  added: string;
  removed: string;
  /** formatting key for format suggestions ("b", "i", "_", "s", "c", "h", "a") */
  format?: Annotation;
  /** text the formatting applies to */
  target?: string;
}

/** What suggestion `id` changes (for the suggestion card: "Add: “x”", "Delete: “y”", "Replace “y” with “x”", "Bold “z”"). */
export function summarizeSuggestion(rt: RichText | undefined | null, id: string): SuggestionSummary {
  let added = '';
  let removed = '';
  let format: Annotation | undefined;
  let unformat = false;
  let target = '';
  for (const d of rt ?? []) {
    const anns = annotationsOf(d);
    const text = isAtom(d) ? '@' : d[0];
    for (const a of anns) {
      if (a[1] !== id) continue;
      if (a[0] === 'si') added += text;
      else if (a[0] === 'sr') removed += text;
      else if (a[0] === 'sa' || a[0] === 'sua') {
        format = a[2] as Annotation;
        unformat = a[0] === 'sua';
        target += text;
      }
    }
  }
  if (added && removed) return { kind: 'replace', added, removed };
  if (added) return { kind: 'add', added, removed };
  if (removed) return { kind: 'remove', added, removed };
  if (format) return { kind: unformat ? 'unformat' : 'format', added, removed, format, target };
  return { kind: 'empty', added, removed };
}

/** Own suggestion id touching [start, end) (inside or right next to it) so consecutive typing / deleting extends it. */
export function adjacentSuggestionId(rt: RichText, start: number, end: number, mine: (id: string) => boolean): string | null {
  let pos = 0;
  for (const d of rt) {
    const len = d[0].length;
    const s = pos;
    const e = pos + len;
    pos = e;
    // touching: overlaps [start, end] including both boundaries
    if (e < start || s > end) continue;
    for (const a of annotationsOf(d)) {
      if ((a[0] === 'si' || a[0] === 'sr') && typeof a[1] === 'string' && mine(a[1])) return a[1];
    }
  }
  return null;
}

export interface SuggestEditResult {
  value: RichText;
  /** caret after the edit (model offset) */
  caret: number;
  /** suggestion ids used by this edit */
  used: string[];
}

/**
 * Turn a text edit into suggestions: [start, end) of `prev` is removed and `inserted` typed in its place.
 * - removed characters that are the user's own suggested insertions are really deleted;
 * - other removed characters get ["sr", removeId] (they stay, struck through);
 * - inserted text gets ["si", insertId] and the formatting of its left neighbour (minus suggestion marks / links);
 * in a replacement it goes after the struck text.
 * `forward` = the Delete key (caret ends after the struck text instead of before it).
 */
export function suggestEdit(
  prev: RichText,
  start: number,
  end: number,
  inserted: string,
  opts: { insertId: string; removeId: string; mine: (id: string) => boolean; marks?: Annotation[]; forward?: boolean },
): SuggestEditResult {
  const used = new Set<string>();
  const len = length(prev);
  const s = Math.max(0, Math.min(start, len));
  const e = Math.max(s, Math.min(end, len));
  const head = slice(prev, 0, s);
  const middle = slice(prev, s, e);
  const tail = slice(prev, e);
  const mid: RichText = [];
  for (const d of middle) {
    const anns = annotationsOf(d);
    const ownInsert = anns.some((a) => a[0] === 'si' && typeof a[1] === 'string' && opts.mine(a[1]));
    if (ownInsert) continue; // never part of the page: just delete it
    if (anns.some((a) => a[0] === 'sr')) {
      mid.push(d); // already suggested for removal
      continue;
    }
    used.add(opts.removeId);
    mid.push([d[0], [...anns, ['sr', opts.removeId] as Annotation]]);
  }
  const midLen = length(mid);
  let value = normalize([...head, ...mid, ...tail]);
  let caret = opts.forward ? s + midLen : s;
  if (inserted) {
    const at = s + midLen;
    const base = (opts.marks ?? leftMarks(value, at)).filter((a) => !isSuggestionAnn(a) && a[0] !== 'a' && a[0] !== 'm');
    value = insertText(value, at, inserted, [...base, ['si', opts.insertId]]);
    used.add(opts.insertId);
    caret = at + inserted.length;
  }
  return { value: normalize(value), caret, used: [...used] };
}

/** Formatting of the run left of an offset (what typed text inherits). */
function leftMarks(rt: RichText, offset: number): Annotation[] {
  let pos = 0;
  for (const d of rt) {
    const l = d[0].length;
    if (offset > pos && offset <= pos + l) return isAtom(d) ? [] : annotationsOf(d);
    pos += l;
  }
  return [];
}

/** Suggest a formatting change on [start, end): ["sa", id, ann] (or ["sua", id, ann] to remove it). */
export function suggestFormat(prev: RichText, start: number, end: number, ann: Annotation, id: string): RichText {
  let pos = 0;
  const out: RichText = [];
  for (const d of prev) {
    const l = d[0].length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + l);
    const anns = annotationsOf(d);
    if (s >= e || isAtom(d)) {
      out.push(d);
    } else {
      const has = anns.some((a) => a[0] === ann[0]);
      const mark: Annotation = has ? ['sua', id, ann] : ['sa', id, ann];
      const before = d[0].slice(0, s - pos);
      const midT = d[0].slice(s - pos, e - pos);
      const after = d[0].slice(e - pos);
      if (before) out.push(withAnns(before, anns));
      out.push(withAnns(midT, [...anns.filter((a) => !((a[0] === 'sa' || a[0] === 'sua') && (a[2] as Annotation)?.[0] === ann[0])), mark]));
      if (after) out.push(withAnns(after, anns));
    }
    pos += l;
  }
  return normalize(out);
}

/** Remove every trace of suggestion `id` without applying it (used when its last character is deleted). */
export function hasSuggestion(rt: RichText | undefined | null, id: string): boolean {
  return suggestionIds(rt).includes(id);
}

export { toPlainText, deleteRange };
