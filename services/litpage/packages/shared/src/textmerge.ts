// Concurrency-safe text edits. A splice replaces [start, end) of the plain text the author saw (`base`) with
// `insert`. When the stored text has moved on (someone else typed in the same block), the range is mapped from
// `base` onto the current text through a character diff, so concurrent edits in different places both survive
// instead of the last writer replacing the whole title.
import { annotationsOf, concat, deleteRange, insertRich, slice, toPlainText, type RichText } from './richtext.ts';

export interface TextSplice {
  base: string;
  start: number;
  end: number;
  insert: RichText;
}

function flatten(rt: RichText): string[] {
  const out: string[] = [];
  for (const d of rt) {
    const key = JSON.stringify(annotationsOf(d).map((a) => JSON.stringify(a)).sort());
    for (const ch of d[0]) for (let i = 0; i < ch.length; i++) out.push(`${ch}\u0000${key}`); // per UTF-16 unit
  }
  return out;
}

/** Smallest single splice that turns `prev` into `next` (characters and annotations compared), or null if equal. */
export function diffSplice(prev: RichText, next: RichText): TextSplice | null {
  const a = flatten(prev);
  const b = flatten(next);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  if (p === a.length && p === b.length) return null;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { base: toPlainText(prev), start: p, end: a.length - s, insert: slice(next, p, b.length - s) };
}

/** Matching segments [fromStart, toStart, length] between two strings (prefix/suffix trim + Myers on the rest). */
function matches(from: string, to: string): [number, number, number][] {
  let p = 0;
  while (p < from.length && p < to.length && from[p] === to[p]) p++;
  let s = 0;
  while (s < from.length - p && s < to.length - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
  const out: [number, number, number][] = [];
  if (p) out.push([0, 0, p]);
  const a = from.slice(p, from.length - s);
  const b = to.slice(p, to.length - s);
  if (a.length && b.length) for (const [x, y, n] of myers(a, b)) out.push([x + p, y + p, n]);
  if (s) out.push([from.length - s, to.length - s, s]);
  return out;
}

/** Myers O((N+M)·D) diff returning matching runs; falls back to "no match" when D gets large. */
function myers(a: string, b: string): [number, number, number][] {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, 2000);
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  if (!found) return [];
  // backtrack the snakes
  const runs: [number, number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vd.get(k - 1) ?? 0) < (vd.get(k + 1) ?? 0)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    const startX = d === 0 ? 0 : prevK === k + 1 ? prevX : prevX + 1;
    const startY = startX - k;
    if (x > startX) runs.push([startX, startY, x - startX]);
    x = d === 0 ? 0 : prevX;
    y = d === 0 ? 0 : prevY;
  }
  return runs.reverse();
}

/**
 * Map an offset in `from` onto `to`. An offset inside text that was replaced concurrently snaps to the end of the
 * replacement for a range start / insertion point ("after theirs") and to its beginning for a range end, so a
 * concurrent edit is never deleted by a range that only touched the old text.
 */
export function mapOffset(segments: [number, number, number][], offset: number, fromLength: number, toLength: number, side: 'start' | 'end'): number {
  let prevTo = 0;
  for (const [fs, ts, n] of [...segments, [fromLength, toLength, 0] as [number, number, number]]) {
    if (offset < fs) return side === 'start' ? ts : prevTo;
    if (offset <= fs + n) return ts + (offset - fs);
    prevTo = ts + n;
  }
  return toLength;
}

/** Where a splice lands on `current` (mapped when `current` differs from the author's base). */
export function spliceRange(current: RichText, sp: TextSplice): [number, number] {
  const plain = toPlainText(current);
  let { start, end } = sp;
  if (plain !== sp.base) {
    const seg = matches(sp.base, plain);
    const collapsed = start === end;
    start = mapOffset(seg, start, sp.base.length, plain.length, 'start');
    end = collapsed ? start : Math.max(start, mapOffset(seg, end, sp.base.length, plain.length, 'end'));
  }
  start = Math.max(0, Math.min(start, plain.length));
  end = Math.max(start, Math.min(end, plain.length));
  return [start, end];
}

export function applySplice(current: RichText | undefined, sp: TextSplice): RichText {
  const cur = current ?? [];
  const plain = toPlainText(cur);
  if (plain === sp.base) {
    const [start, end] = spliceRange(cur, sp);
    return concat(slice(cur, 0, start), sp.insert ?? [], slice(cur, end));
  }
  // Text moved on: delete only the base characters of [start, end) that still exist (text others inserted inside
  // the range survives), then insert at the mapped start.
  const seg = matches(sp.base, plain);
  const at = mapOffset(seg, sp.start, sp.base.length, plain.length, 'start');
  const pieces: [number, number][] = [];
  for (const [fs, ts, n] of seg) {
    const a = Math.max(fs, sp.start);
    const b = Math.min(fs + n, sp.end);
    if (a < b) pieces.push([ts + (a - fs), ts + (b - fs)]);
  }
  let out = cur;
  let removedBefore = 0;
  for (const [a, b] of pieces) removedBefore += Math.max(0, Math.min(b, at) - a);
  for (const [a, b] of pieces.reverse()) out = deleteRange(out, a, b);
  return insertRich(out, Math.max(0, at - removedBefore), sp.insert ?? []);
}

/** Inverse splice for undo, computed against the value the splice was applied to. */
export function invertSplice(before: RichText | undefined, sp: TextSplice): TextSplice {
  const cur = before ?? [];
  const [start, end] = spliceRange(cur, sp);
  const after = applySplice(cur, sp);
  let insLen = 0;
  for (const d of sp.insert ?? []) insLen += d[0].length;
  return { base: toPlainText(after), start, end: start + insLen, insert: slice(cur, start, end) };
}

/** Map a caret/selection offset from one version of a text to another (keeps a caret beside the same characters). */
export function mapTextOffset(from: string, to: string, offset: number, side: 'start' | 'end' = 'start'): number {
  if (from === to) return offset;
  return mapOffset(matches(from, to), offset, from.length, to.length, side);
}
