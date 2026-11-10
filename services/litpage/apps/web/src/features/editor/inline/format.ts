// Range formatting operations shared by the text action menu, keyboard shortcuts and popovers.
// Every mutation is a transaction (commitText) and the DOM selection is restored afterwards.
import {
  addAnnotation, annotationsOf, hasAnnotation, removeAnnotation, toggleAnnotation, type Annotation, type RichText,
} from '@nc/shared/richtext.ts';
import { getBlock } from '../../../lib/blocks.ts';
import { commitText } from '../textHandlers.ts';
import { useEditor } from '../editorState.ts';
import { getPref, PREF, setPref } from '../prefs.ts';
import { suggestFormatRange, suggestingIn } from '../../comments/suggestEdits.ts';

export interface TextRange {
  blockId: string;
  property: string;
  start: number;
  end: number;
}

export function valueOf(blockId: string, property = 'title'): RichText {
  const b = getBlock(blockId);
  const v = (b?.properties as Record<string, RichText> | undefined)?.[property];
  return v ?? [];
}

export function restoreRange(r: TextRange) {
  useEditor.getState().requestFocus(r.blockId, r.start, { property: r.property, end: r.end });
}

export function rangeHas(r: TextRange, key: Annotation[0]): boolean {
  return hasAnnotation(valueOf(r.blockId, r.property), r.start, r.end, key);
}

/** While suggesting, formatting selection card / shortcuts becomes a formatting suggestion. */
function suggested(r: TextRange, ann: Annotation): boolean {
  if (r.property !== 'title' || !suggestingIn(r.blockId)) return false;
  suggestFormatRange(r.blockId, r.start, r.end, ann);
  return true;
}

export function toggleMarkRange(r: TextRange, ann: Annotation, action = 'textAnnotationActions.annotateSelection') {
  if (r.start >= r.end) return;
  if (suggested(r, ann)) return;
  const next = toggleAnnotation(valueOf(r.blockId, r.property), r.start, r.end, ann);
  commitText(r.blockId, r.property, next, r.end, { coalesce: false, action });
  restoreRange(r);
}

export function applyAnnotationRange(r: TextRange, ann: Annotation | null, removeKey?: Annotation[0], action = 'textAnnotationActions.annotateSelection') {
  let next = valueOf(r.blockId, r.property);
  if (removeKey) next = removeAnnotation(next, r.start, r.end, removeKey);
  if (ann) next = addAnnotation(next, r.start, r.end, ann);
  commitText(r.blockId, r.property, next, r.end, { coalesce: false, action });
}

// ---- colors ("h" annotations): text and background colors are independent --------------------------
// Recently used colors are a per-user device preference shared by the
// block menu's "Last used", the color menu's "Recently used" and ⌘⇧H.

export function recentColors(): string[] {
  const v = getPref<unknown>(PREF.recentColors);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function pushRecentColor(c: string) {
  setPref(PREF.recentColors, [c, ...recentColors().filter((x) => x !== c)].slice(0, 5));
}

/** Last used color for ⌘⇧H; “Highlight selected text” reapplies it. */
export function lastUsedColor(): string | null {
  return recentColors()[0] ?? null;
}

export function setColorRange(r: TextRange, color: string) {
  if (r.start >= r.end) return;
  pushRecentColor(color);
  if (suggested(r, ['h', color])) return;
  const next = addAnnotation(valueOf(r.blockId, r.property), r.start, r.end, ['h', color]);
  commitText(r.blockId, r.property, next, r.end, { coalesce: false, action: 'textAnnotationActions.annotateSelection' });
  restoreRange(r);
}

/** Current text/background color of a range (first run wins), for the "A" button swatch. */
export function colorsOf(value: RichText, start: number, end: number): { text?: string; bg?: string } {
  let pos = 0;
  const out: { text?: string; bg?: string } = {};
  for (const d of value) {
    const len = d[0].length;
    if (Math.max(start, pos) < Math.min(end, pos + len) || (start === end && start > pos && start <= pos + len)) {
      for (const a of annotationsOf(d)) {
        if (a[0] !== 'h') continue;
        const c = String(a[1]);
        if (c.endsWith('_background')) out.bg ??= c.replace('_background', '');
        else out.text ??= c;
      }
      break;
    }
    pos += len;
  }
  return out;
}

/** "Clear format" (⌘⌥\): drops bold/italic/underline/strike/code/colors; links, mentions and comments stay. */
export function clearFormatRange(r: TextRange) {
  if (r.start >= r.end) return;
  if (r.property === 'title' && suggestingIn(r.blockId)) return; // clearing formats can't be suggested in one mark
  let next = valueOf(r.blockId, r.property);
  for (const k of ['b', 'i', '_', 's', 'c', 'h'] as const) next = removeAnnotation(next, r.start, r.end, k);
  commitText(r.blockId, r.property, next, r.end, { coalesce: false, action: 'textAnnotationActions.clearFormat' });
  restoreRange(r);
}
