// Rich text <-> DOM for contenteditable leaves.
// The model (decorations) is the source of truth: user input is folded back as a plain-text diff
// (atoms count as one character), then the leaf is re-rendered canonically when the DOM drifted.
import { annotationsOf, type Annotation, type RichText, ATOM_KEYS, MENTION_CHAR, EQUATION_CHAR } from '@nc/shared/richtext.ts';
import { baseColor, isBackgroundColor } from '@nc/shared/colors.ts';
import { safeHref } from '@nc/shared/url.ts';
import { colorToken } from '../../lib/colorToken.ts';

export interface AtomRenderer {
  (ann: Annotation, deco: [string, Annotation[]?]): HTMLElement;
}

let atomRenderer: AtomRenderer | null = null;
/** Mentions/equations are rendered by a pluggable renderer (needs record lookups, KaTeX). */
export function setAtomRenderer(fn: AtomRenderer) {
  atomRenderer = fn;
}

const CODE_FONT = '"SFMono-Regular", Menlo, Consolas, "PT Mono", "Liberation Mono", Courier, monospace';
const COLOR_TOKEN: Record<string, string> = { gray: 'gra', brown: 'bro', orange: 'ora', yellow: 'yel', green: 'gre', blue: 'blu', purple: 'pur', pink: 'pin', red: 'red' };

/** Inline mark styles used by the editor. */
function styleFor(input: Annotation[]): { cls: string[]; style: string; link?: string; code: boolean; textColor?: string } {
  const cls: string[] = [];
  let style = '';
  // suggested formatting ("sa") previews the formatting it would add 
  const anns = input.some((a) => a[0] === 'sa') ? [...input, ...input.filter((a) => a[0] === 'sa').map((a) => a[2] as Annotation)] : input;
  let link: string | undefined;
  let code = false;
  let underline = false;
  let strike = false;
  let textColor: string | undefined;
  for (const a of anns) {
    switch (a[0]) {
      case 'b': style += 'font-weight:600;'; break;
      case 'i': style += 'font-style:italic;'; break;
      case '_': underline = true; break;
      case 's': strike = true; break;
      case 'c': code = true; break;
      case 'a': link = String(a[1]); break;
      case 'h': {
        const c = String(a[1]);
        const t = COLOR_TOKEN[baseColor(c)];
        if (!t) break;
        if (isBackgroundColor(c)) style += `background:var(${colorToken(t, 'bg-secondary-transparent')});isolation:auto;`;
        else {
          textColor = `var(${colorToken(t, 'text-secondary')})`;
          style += `color:${textColor};fill:${textColor};isolation:auto;`;
        }
        break;
      }
      case 'm': cls.push('lit-discussion-highlight'); break;
      case 'sug': cls.push('lit-suggestion'); break;
      case 'si': cls.push('lit-suggestion', 'lit-suggestion-insert'); break;
      case 'sr': cls.push('lit-suggestion', 'lit-suggestion-remove'); break;
      case 'sa': case 'sua': cls.push('lit-suggestion', 'lit-suggestion-format'); break;
    }
  }
  if (underline && strike) style += 'text-decoration:underline line-through;text-decoration-thickness:0.05em;text-decoration-color:inherit;';
  else if (underline) style += 'text-decoration:underline;text-decoration-thickness:0.05em;text-decoration-color:inherit;text-underline-offset:10%;';
  else if (strike && !code) style += 'text-decoration:line-through;';
  if (underline) cls.push('lit-text-underline');
  if (strike) cls.push('lit-text-strike');
  return { cls, style, link, code, textColor };
}

function suggestionIdsOf(anns: Annotation[]): string {
  return anns.filter((a) => a[0] === 'si' || a[0] === 'sr' || a[0] === 'sa' || a[0] === 'sua').map((a) => String(a[1])).join(' ');
}

export function renderRichText(leaf: HTMLElement, value: RichText) {
  const frag = document.createDocumentFragment();
  value.forEach((d, i) => {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => ATOM_KEYS.has(a[0]));
    if (atom) {
      const el = atomRenderer ? atomRenderer(atom, d as any) : fallbackAtom(atom);
      el.setAttribute('contenteditable', 'false');
      el.dataset.tokenIndex = String(i);
      el.dataset.atom = '1';
      el.dataset.atomChar = d[0];
      const { cls, style } = styleFor(anns.filter((a) => !ATOM_KEYS.has(a[0])));
      if (cls.length) el.classList.add(...cls);
      if (style) el.setAttribute('style', (el.getAttribute('style') ?? '') + style);
      const disc = anns.filter((a) => a[0] === 'm').map((a) => String(a[1]));
      if (disc.length) el.dataset.discussionId = disc.join(' ');
      const sugg = suggestionIdsOf(anns);
      if (sugg) el.dataset.suggestionId = sugg;
      frag.appendChild(el);
      return;
    }
    if (!anns.length) {
      frag.appendChild(document.createTextNode(d[0]));
      return;
    }
    const { cls, style, link, code, textColor } = styleFor(anns);
    let el: HTMLElement;
    let textHost: HTMLElement;
    if (code) {
      // <div.lit-inline-code-container style=display:inline><span …code styles…>text</span></div>
      el = document.createElement('div');
      el.className = 'lit-inline-code-container';
      if (cls.includes('lit-text-strike')) el.classList.add('lit-inline-code-strikethrough');
      el.setAttribute('style', 'display:inline');
      const span = document.createElement('span');
      span.className = ['lit-enable-hover', ...cls.filter((c) => c !== 'lit-text-strike')].join(' ');
      span.setAttribute('spellcheck', 'false');
      span.setAttribute(
        'style',
        `font-family:${CODE_FONT};line-height:normal;background:var(--lp-bg-interactive-transparent);color:${textColor ?? 'var(--lp-red-text-secondary)'};border-radius:4px;font-size:85%;padding:0.2em 0.4em;position:relative;bottom:0.065em;` +
          style.replace(/color:[^;]+;fill:[^;]+;/, ''),
      );
      el.appendChild(span);
      textHost = span;
    } else if (link) {
      // a.lit-link-token > span (underline 0.05em, decoration color --lp-text-decoration-transparent, offset 10%, opacity.7)
      el = document.createElement('a');
      // stored link targets are user data: script-capable schemes (javascript: data: …) get no href
      const href = safeHref(link);
      if (href) (el as HTMLAnchorElement).href = href;
      el.setAttribute('rel', 'noopener noreferrer');
      el.className = ['lit-link-token', 'lit-focusable-token', 'lit-enable-hover', ...cls].join(' ');
      el.setAttribute('style', `cursor:pointer;color:inherit;word-wrap:break-word;text-decoration:inherit;${style}`);
      const span = document.createElement('span');
      span.className = 'link-annotation';
      span.setAttribute('style', 'text-decoration:underline;text-decoration-thickness:0.05em;text-decoration-color:var(--lp-text-decoration-transparent);text-underline-offset:10%;opacity:0.7');
      el.appendChild(span);
      textHost = span;
    } else {
      el = document.createElement('span');
      el.className = ['lit-enable-hover', ...cls].join(' ');
      if (style) el.setAttribute('style', style);
      textHost = el;
    }
    // inline comments: discussion ids for click → thread and resolved/active styling (features/comments)
    const disc = anns.filter((a) => a[0] === 'm').map((a) => String(a[1]));
    if (disc.length) el.dataset.discussionId = disc.join(' ');
    // suggested edits: their discussion ids (author colors, click → suggestion card)
    const sugg = suggestionIdsOf(anns);
    if (sugg) el.dataset.suggestionId = sugg;
    el.dataset.tokenIndex = String(i);
    textHost.textContent = d[0];
    frag.appendChild(el);
  });
  // a trailing "\n" (Shift+Enter / code Enter at the end) needs a placeholder <br> so the empty last line exists
  // and the caret can sit on it (domText/offsetOf ignore a trailing <br>)
  const last = value[value.length - 1];
  if (last && last[0].endsWith('\n')) frag.appendChild(document.createElement('br'));
  leaf.replaceChildren(frag);
}

/** Client rects of the character range [start, end) inside a leaf (selection menu / popovers / decorations). */
export function rectsForRange(leaf: HTMLElement, start: number, end: number): DOMRect[] {
  const s = positionAt(leaf, start);
  const e = end === start ? s : positionAt(leaf, end);
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    return [];
  }
  const rects = Array.from(range.getClientRects());
  if (!rects.length) {
    const r = range.getBoundingClientRect();
    if (r.width || r.height) return [r];
  }
  return rects;
}

function fallbackAtom(a: Annotation): HTMLElement {
  const el = document.createElement('span');
  el.textContent = a[0] === 'e' ? String(a[1]) : MENTION_CHAR;
  return el;
}

/** Canonical HTML for comparison with the live DOM. */
const scratch = typeof document !== 'undefined' ? document.createElement('div') : null;
export function canonicalHTML(value: RichText): string {
  if (!scratch) return '';
  renderRichText(scratch, value);
  return scratch.innerHTML;
}

function isAtomEl(n: Node): n is HTMLElement {
  return n.nodeType === 1 && (n as HTMLElement).dataset?.atom === '1';
}

/** Plain text of the leaf as the model sees it: atoms count as a single character. */
export function domText(leaf: HTMLElement): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? '';
      return;
    }
    if (isAtomEl(n)) {
      const idx = (n as HTMLElement).dataset.tokenIndex;
      void idx;
      out += (n as HTMLElement).dataset.atomChar ?? MENTION_CHAR;
      return;
    }
    if ((n as HTMLElement).tagName === 'BR') {
      // a trailing <br> is the browser's placeholder for an empty line
      if (n.nextSibling) out += '\n';
      return;
    }
    for (const c of Array.from(n.childNodes)) walk(c);
  };
  for (const c of Array.from(leaf.childNodes)) walk(c);
  return out;
}

/** Character offset of a DOM position inside the leaf. */
export function offsetOf(leaf: HTMLElement, node: Node, nodeOffset: number): number {
  if (!leaf.contains(node)) return 0;
  let offset = 0;
  let found = false;
  const walk = (n: Node): boolean => {
    if (n === node) {
      if (n.nodeType === 3) offset += nodeOffset;
      else {
        const kids = Array.from(n.childNodes).slice(0, nodeOffset);
        for (const k of kids) offset += lengthOf(k);
      }
      found = true;
      return true;
    }
    if (n.nodeType === 3) {
      offset += n.nodeValue?.length ?? 0;
      return false;
    }
    if (isAtomEl(n)) {
      if (n.contains(node)) {
        found = true;
        return true;
      }
      offset += 1;
      return false;
    }
    for (const c of Array.from(n.childNodes)) if (walk(c)) return true;
    return false;
  };
  for (const c of Array.from(leaf.childNodes)) if (walk(c)) break;
  if (!found && node === leaf) {
    offset = 0;
    for (const k of Array.from(leaf.childNodes).slice(0, nodeOffset)) offset += lengthOf(k);
  }
  return offset;
}

function lengthOf(n: Node): number {
  if (n.nodeType === 3) return n.nodeValue?.length ?? 0;
  if (isAtomEl(n)) return 1;
  if ((n as HTMLElement).tagName === 'BR') return n.nextSibling ? 1 : 0;
  let len = 0;
  for (const c of Array.from(n.childNodes)) len += lengthOf(c);
  return len;
}

/** DOM position for a character offset (prefers the end of the left text node at boundaries). */
export function positionAt(leaf: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  let last: { node: Node; offset: number } = { node: leaf, offset: 0 };
  const walk = (n: Node): { node: Node; offset: number } | null => {
    if (n.nodeType === 3) {
      const len = n.nodeValue?.length ?? 0;
      if (remaining <= len) return { node: n, offset: remaining };
      remaining -= len;
      last = { node: n, offset: len };
      return null;
    }
    if (isAtomEl(n)) {
      const parent = n.parentNode!;
      const idx = Array.from(parent.childNodes).indexOf(n as ChildNode);
      if (remaining === 0) return { node: parent, offset: idx };
      remaining -= 1;
      last = { node: parent, offset: idx + 1 };
      if (remaining === 0) return last;
      return null;
    }
    for (const c of Array.from(n.childNodes)) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  for (const c of Array.from(leaf.childNodes)) {
    const r = walk(c);
    if (r) return r;
  }
  return last.node === leaf ? { node: leaf, offset: leaf.childNodes.length } : last;
}

export function getSelectionOffsets(leaf: HTMLElement): { start: number; end: number; backward: boolean } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!leaf.contains(r.startContainer) && r.startContainer !== leaf) return null;
  const a = offsetOf(leaf, sel.anchorNode!, sel.anchorOffset);
  const f = offsetOf(leaf, sel.focusNode!, sel.focusOffset);
  return { start: Math.min(a, f), end: Math.max(a, f), backward: f < a };
}

export function setSelectionOffsets(leaf: HTMLElement, start: number, end = start) {
  const sel = window.getSelection();
  if (!sel) return;
  const s = positionAt(leaf, start);
  const e = end === start ? s : positionAt(leaf, end);
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    range.selectNodeContents(leaf);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Caret client rect (falls back to the leaf rect for empty leaves). */
export function caretRect(leaf: HTMLElement): DOMRect {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0).cloneRange();
    const rects = r.getClientRects();
    if (rects.length) return rects[rects.length - 1];
    const span = document.createElement('span');
    span.textContent = '​';
    r.insertNode(span);
    const rect = span.getBoundingClientRect();
    span.remove();
    leaf.normalize();
    return rect;
  }
  return leaf.getBoundingClientRect();
}

/** Is the caret on the first/last visual line of the leaf? */
export function caretLine(leaf: HTMLElement): { first: boolean; last: boolean; x: number } {
  const lr = leaf.getBoundingClientRect();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return { first: true, last: true, x: lr.left };
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(sel.focusNode === range.endContainer && sel.focusOffset === range.endOffset);
  let rect = range.getClientRects()[0];
  if (!rect) {
    const span = document.createElement('span');
    span.textContent = '​';
    range.insertNode(span);
    rect = span.getBoundingClientRect();
    span.remove();
    leaf.normalize();
  }
  const lineH = parseFloat(getComputedStyle(leaf).lineHeight) || 24;
  const padTop = parseFloat(getComputedStyle(leaf).paddingTop) || 0;
  const padBottom = parseFloat(getComputedStyle(leaf).paddingBottom) || 0;
  return {
    first: rect.top - (lr.top + padTop) < lineH * 0.75,
    last: lr.bottom - padBottom - rect.bottom < lineH * 0.75,
    x: rect.left,
  };
}

/** Offset in `leaf` closest to client point x on its first or last line. */
export function offsetAtX(leaf: HTMLElement, x: number, line: 'first' | 'last'): number {
  const lr = leaf.getBoundingClientRect();
  const cs = getComputedStyle(leaf);
  const lineH = parseFloat(cs.lineHeight) || 24;
  const y = line === 'first' ? lr.top + (parseFloat(cs.paddingTop) || 0) + lineH / 2 : lr.bottom - (parseFloat(cs.paddingBottom) || 0) - lineH / 2;
  const doc = document as any;
  let node: Node | null = null;
  let off = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(Math.max(lr.left + 1, Math.min(x, lr.right - 1)), y);
    if (p) { node = p.offsetNode; off = p.offset; }
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(Math.max(lr.left + 1, Math.min(x, lr.right - 1)), y);
    if (r) { node = r.startContainer; off = r.startOffset; }
  }
  if (node && leaf.contains(node)) return offsetOf(leaf, node, off);
  return line === 'first' ? 0 : domText(leaf).length;
}

export { MENTION_CHAR, EQUATION_CHAR };
