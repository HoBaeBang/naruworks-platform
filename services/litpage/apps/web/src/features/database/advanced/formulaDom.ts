// Formula source <-> contenteditable DOM: Prism-like token spans (keyword/number/string/function/operator/

// The engine source keeps tokens as {{lit:…}} text, so caret offsets are offsets in that source string.
import { lex, type FormulaToken, type Tok } from '@nc/shared/formula/index.ts';

export interface ChipInfo {
  label: string;
  icon: string;
}

const OPERATOR_KINDS = new Set(['plus', 'minus', 'bang', 'star', 'slash', 'percent', 'caret', 'eq', 'neq', 'lt', 'gt', 'question', 'colon']);
const PUNCT_KINDS = new Set(['lparen', 'rparen', 'lbracket', 'rbracket', 'comma', 'dot']);


export function classify(tokens: Tok[]): string[] {
  const sig = tokens.map((t, i) => ({ t, i })).filter((x) => x.t.kind !== 'ws' && x.t.kind !== 'comment');
  const pos = new Map(sig.map((x, j) => [x.i, j]));
  return tokens.map((t, i) => {
    switch (t.kind) {
      case 'number': return 'number';
      case 'string': case 'unclosedString': return 'string';
      case 'comment': case 'unclosedComment': return 'comment';
      case 'true': case 'false': return 'boolean';
      case 'and': case 'or': case 'not': return 'keyword';
      case 'ident': {
        const j = pos.get(i)!;
        const next = sig[j + 1]?.t;
        const prev = sig[j - 1]?.t;
        if (next?.kind === 'lparen' || prev?.kind === 'dot') return 'function';
        if (t.text === 'current' || t.text === 'index') return 'variable';
        return 'variable';
      }
      default:
        if (OPERATOR_KINDS.has(t.kind)) return 'operator';
        if (PUNCT_KINDS.has(t.kind)) return 'punctuation';
        return '';
    }
  });
}


export function renderFormula(el: HTMLElement, src: string, chip: (tok: FormulaToken) => ChipInfo, opts?: { error?: { start?: number; end?: number } | null; iconHtml?: (name: string) => string }) {
  const tokens = lex(src);
  const classes = classify(tokens);
  const frag = document.createDocumentFragment();
  const errS = opts?.error?.start ?? -1;
  const errE = opts?.error && opts.error.end !== undefined && opts.error.end > errS ? opts.error.end : errS + 1;
  tokens.forEach((t, i) => {
    if (t.kind === 'input' && t.token) {
      const c = chip(t.token);
      const span = document.createElement('span');
      span.className = 'nc-fx-chip';
      span.contentEditable = 'false';
      span.dataset.src = t.text;
      const icon = document.createElement('span');
      icon.className = 'nc-fx-chip-icon';
      icon.dataset.icon = c.icon;
      if (opts?.iconHtml) icon.innerHTML = opts.iconHtml(c.icon);
      span.appendChild(icon);
      span.appendChild(document.createTextNode(c.label));
      frag.appendChild(span);
      return;
    }
    const inErr = errS >= 0 && t.end > errS && t.start < errE;
    if (!classes[i] && !inErr) {
      frag.appendChild(document.createTextNode(t.text));
      return;
    }
    const span = document.createElement('span');
    span.className = `${classes[i] ? `token ${classes[i]}` : ''}${inErr ? ' nc-fx-err' : ''}`.trim();
    span.textContent = t.text;
    frag.appendChild(span);
  });
  el.replaceChildren(frag);
  if (!src) el.appendChild(document.createElement('br'));
}


export function readFormula(el: HTMLElement): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent ?? '').replace(/ /g, ' ');
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    if (n.dataset.src !== undefined) {
      out += n.dataset.src;
      return;
    }
    if (n.tagName === 'BR') {
      if (n !== el.lastChild) out += '\n';
      return;
    }
    const block = n.tagName === 'DIV' && n !== el;
    if (block && out && !out.endsWith('\n')) out += '\n';
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out;
}

function lengthOf(n: Node): number {
  if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').length;
  if (n instanceof HTMLElement) {
    if (n.dataset.src !== undefined) return n.dataset.src.length;
    if (n.tagName === 'BR') return 0;
    let s = 0;
    n.childNodes.forEach((c) => (s += lengthOf(c)));
    return s;
  }
  return 0;
}


export function getCaret(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const node = sel.focusNode;
  const off = sel.focusOffset;
  if (!node || !el.contains(node)) return null;
  let pos = 0;
  let found: number | null = null;
  const walk = (n: Node): boolean => {
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE) found = pos + off;
      else {
        let p = pos;
        for (let i = 0; i < off && i < n.childNodes.length; i++) p += lengthOf(n.childNodes[i]);
        found = p;
      }
      return true;
    }
    if (n instanceof HTMLElement && n.dataset.src !== undefined) {
      if (n.contains(node)) {
        found = pos + n.dataset.src.length;
        return true;
      }
      pos += n.dataset.src.length;
      return false;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      pos += (n.textContent ?? '').length;
      return false;
    }
    for (const c of Array.from(n.childNodes)) if (walk(c)) return true;
    return false;
  };
  walk(el);
  return found;
}


export function setCaret(el: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  let pos = 0;
  const range = document.createRange();
  let placed = false;
  const children = Array.from(el.childNodes);
  for (let i = 0; i < children.length && !placed; i++) {
    const n = children[i];
    const len = lengthOf(n);
    if (n instanceof HTMLElement && n.dataset.src !== undefined) {
      if (offset <= pos) {
        range.setStartBefore(n);
        placed = true;
      } else if (offset <= pos + len) {
        range.setStartAfter(n);
        placed = true;
      }
    } else if (offset <= pos + len) {
      const textNode = n.nodeType === Node.TEXT_NODE ? n : n.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        range.setStart(textNode, Math.max(0, Math.min(offset - pos, (textNode.textContent ?? '').length)));
      } else range.setStartBefore(n);
      placed = true;
    }
    pos += len;
  }
  if (!placed) {
    range.selectNodeContents(el);
    range.collapse(false);
  } else range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}


export function highlightSegments(src: string): { cls: string; text: string; token?: FormulaToken }[] {
  const tokens = lex(src);
  const classes = classify(tokens);
  return tokens.map((t, i) => ({ cls: t.kind === 'input' ? 'chip' : classes[i], text: t.text, token: t.token }));
}
