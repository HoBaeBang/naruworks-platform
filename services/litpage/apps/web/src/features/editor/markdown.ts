// Markdown-style autoformat while typing,

// block (at the start, + space): "# " "## " "### " "#### " · "- " "* " "+ " "• " · "1. " (a./i.) · "[] " · "> " (toggle, open)
// · "\" " / "| " (quote) · heading + "> " → toggle heading · toggle + "# " → toggle heading
// instant: "---" (also "—-" after the "--"→"—" replacement) → divider (+ new text block) · "```" → code
// inline: **x** bold · *x* / _x_ italic · ~x~ strike · `x` code · $$x$$ inline equation · NOT ~~x~~, $x$, __x__
// replacements: -> → · <- ← · => ⇒ · <= ≤ · >= ≥ · != ≠ · -- — ·... … (NOT (c) (r) (tm) 1/2 <=>)
import type { BlockType } from '@nc/shared/records.ts';
import { addAnnotation, deleteRange, insertRich, insertText, slice, toPlainText, EQUATION_CHAR, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import { stickyFormat } from './prefs.ts';

export interface BlockShortcut {
  type: BlockType;
  format?: Record<string, unknown>;
  properties?: Record<string, unknown>;
 /** characters to strip start */
  strip: number;
 /** toggles created by "> " start open */
  open?: boolean;
}

const BLOCK_RULES: [RegExp, (m: RegExpMatchArray) => Omit<BlockShortcut, 'strip'>][] = [
  [/^#### $/, () => ({ type: 'header_4' })],
  [/^### $/, () => ({ type: 'sub_sub_header' })],
  [/^## $/, () => ({ type: 'sub_header' })],
  [/^# $/, () => ({ type: 'header' })],
  [/^[-*+•] $/, () => ({ type: 'bulleted_list' })],
  [/^(\d+|[a-z]|[ivx]+)\. $/i, (m) => ({ type: 'numbered_list', format: /^\d+$/.test(m[1]) && m[1] !== '1' ? { list_start_index: Number(m[1]) } : undefined })],
  [/^\[\] $/, () => ({ type: 'to_do', properties: { checked: [['No']] } })],
  [/^> $/, () => ({ type: 'toggle', open: true })],
  [/^[“"|] $/, () => ({ type: 'quote', format: stickyFormat('quote').format })],
];

const HEADING_LEVEL: Record<string, BlockType> = { '#': 'header', '##': 'sub_header', '###': 'sub_sub_header', '####': 'header_4' };

/**
 * Detect a block-level shortcut right after the user typed a space at the start of the block.
 * `current` is the block's type (+ toggleable) so headings/toggles can become toggle headings (/023).
 */
export function matchBlockShortcut(textBeforeCaret: string, current?: { type: BlockType; toggleable?: boolean }): BlockShortcut | null {
  if (current && /^(header|sub_header|sub_sub_header|header_4)$/.test(current.type) && !current.toggleable && /^> $/.test(textBeforeCaret)) {
    return { type: current.type, format: { toggleable: true }, strip: 2, open: true };
  }
  if (current?.type === 'toggle') {
    const m = /^(#{1,4}) $/.exec(textBeforeCaret);
    if (m) return { type: HEADING_LEVEL[m[1]], format: { toggleable: true }, strip: m[0].length, open: true };
  }
  for (const [re, fn] of BLOCK_RULES) {
    const m = textBeforeCaret.match(re);
    if (m) return { ...fn(m), strip: textBeforeCaret.length };
  }
  return null;
}

/** "---" → divider, "```" → code: triggered as soon as the sequence is complete in an otherwise empty block. */
export function matchInstantShortcut(text: string): BlockType | null {
  if (text === '---' || text === '—-') return 'divider';
  if (text === '```') return 'code';
  return null;
}

const INLINE_RULES: { open: string; close: string; ann: Annotation }[] = [
  { open: '**', close: '**', ann: ['b'] },
  { open: '*', close: '*', ann: ['i'] },
  { open: '_', close: '_', ann: ['i'] },
  { open: '`', close: '`', ann: ['c'] },
  { open: '~', close: '~', ann: ['s'] },
];

/**
 * Inline markdown after typing a closing marker: returns the new rich text and caret, or null.
 * Marker characters are deleted and the annotation is added.
 */
export function applyInlineMarkdown(value: RichText, caret: number): { value: RichText; caret: number; ann: Annotation } | null {
  const text = toPlainText(value);
  const before = text.slice(0, caret);
  for (const r of INLINE_RULES) {
    if (!before.endsWith(r.close)) continue;
    const inner = before.slice(0, before.length - r.close.length);
 // a doubled single-char marker (~~x~~, __x__) is left alone; "**" is handled by its own rule
    if (r.close.length === 1 && inner.endsWith(r.close)) continue;
    const openIdx = inner.lastIndexOf(r.open);
    if (openIdx < 0) continue;
    const content = inner.slice(openIdx + r.open.length);
    if (!content || /^\s|\s$/.test(content)) continue;
    if (r.open.length === 1) {
 // "*" must not be part of "**", "~" not part of "~~", "_" not part of "__"
      if (inner[openIdx - 1] === r.open || content.includes(r.open)) continue;
      if (openIdx > 0 && /[\p{L}\p{N}]/u.test(inner[openIdx - 1]) && r.open !== '`') continue;
    } else if (inner[openIdx - 1] === r.open[0]) continue;
    const start = openIdx;
    const end = caret;
    let v = deleteRange(value, end - r.close.length, end);
    v = deleteRange(v, start, start + r.open.length);
    const cEnd = start + content.length;
    v = addAnnotation(v, start, cEnd, r.ann);
    return { value: v, caret: cEnd, ann: r.ann };
  }
  return null;
}

/** "$$tex$$" typed inline → equation atom (kb-inline-md2: eq true, tex "a^2"); single "$x$" is not converted. */
export function applyInlineEquation(value: RichText, caret: number): { value: RichText; caret: number } | null {
  const text = toPlainText(value);
  const before = text.slice(0, caret);
  if (!before.endsWith('$$')) return null;
  const inner = before.slice(0, -2);
  const openIdx = inner.lastIndexOf('$$');
  if (openIdx < 0) return null;
  const tex = inner.slice(openIdx + 2);
  if (!tex.trim() || tex.includes('\n')) return null;
  let v = deleteRange(value, openIdx, caret);
  v = insertRich(v, openIdx, [[EQUATION_CHAR, [['e', tex]]]]);
  return { value: v, caret: openIdx + 1 };
}

/** Typographic autoreplacements performed while typing (set only). */
const REPLACEMENTS: [string, string][] = [
  ['...', '…'],
  ['->', '→'],
  ['<-', '←'],
  ['=>', '⇒'],
  ['<=', '≤'],
  ['>=', '≥'],
  ['!=', '≠'],
  ['--', '—'],
];

export function applyAutoReplace(value: RichText, caret: number): { value: RichText; caret: number } | null {
  const text = toPlainText(value);
  const before = text.slice(0, caret);
  for (const [from, to] of REPLACEMENTS) {
    if (before.endsWith(from)) {
      const s = caret - from.length;
 // keep annotations of the replaced range
      const anns = slice(value, s, caret)[0]?.[1];
      let v = deleteRange(value, s, caret);
      v = insertText(v, s, to, anns as any);
      return { value: v, caret: s + to.length };
    }
  }
  return null;
}

/** Characters whose insertion can complete a replacement. */
export const AUTOREPLACE_LAST = /^[.>=\-]$/;
