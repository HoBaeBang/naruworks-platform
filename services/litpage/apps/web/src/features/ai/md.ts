
// (AiMarkdown.tsx) and block insertion (insert.ts), so what the user sees is what gets inserted.
// Supports the subset the prompts ask for: headings, paragraphs, (nested) bullets/numbers/to-dos,
// quotes, fenced code, pipe tables, dividers, $$ math, and inline **b** *i* ~~s~~ `c` [a](url) [n].

export interface Seg {
  text: string;
  b?: boolean;
  i?: boolean;
  s?: boolean;
  c?: boolean;
  href?: string;
  
  cite?: number;
  
  eq?: boolean;
}

export interface ListItem {
  text: string;
  checked: boolean | null;
  children: MdNode[];
}

export type MdNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'quote'; children: MdNode[] }
  | { type: 'code'; lang: string; text: string; open?: boolean }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' }
  | { type: 'math'; text: string }
  
  | { type: 'image'; url: string; alt: string };

const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE_RE = /^\s*(```+|~~~+)\s*([\w+#.-]*)?.*$/;
const IMAGE_RE = /^\s*!\[([^\]\n]*)\]\((\/files\/[^\s)]+)\)\s*$/;

function isTableLine(l: string) {
  return /^\s*\|.*\|\s*$/.test(l) || (/\|/.test(l) && /^\s*\|/.test(l));
}

function splitRow(l: string): string[] {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isSeparatorRow(l: string) {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes('-');
}

function indentOf(l: string): number {
  const m = /^(\s*)/.exec(l);
  return (m?.[1] ?? '').replace(/\t/g, '    ').length;
}

/** Parse a whole document (tolerates an unfinished stream: unclosed fences become open code). */
export function parseMarkdown(src: string): MdNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  return parseLines(lines);
}

function parseLines(lines: string[]): MdNode[] {
  const out: MdNode[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push({ type: 'paragraph', text: para.join('\n') });
    para = [];
  };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      flushPara();
      i++;
      continue;
    }
    const fence = FENCE_RE.exec(l);
    if (fence && /^\s*(```|~~~)/.test(l)) {
      flushPara();
      const marker = fence[1];
      const lang = (fence[2] ?? '').trim();
      const body: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(marker)) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      out.push({ type: 'code', lang, text: body.join('\n'), open: !closed });
      continue;
    }
    if (l.trim() === '$$') {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') body.push(lines[i++]);
      i++;
      out.push({ type: 'math', text: body.join('\n') });
      continue;
    }
    const h = HEADING_RE.exec(l);
    if (h) {
      flushPara();
      out.push({ type: 'heading', level: Math.min(4, h[1].length) as 1 | 2 | 3 | 4, text: h[2] });
      i++;
      continue;
    }
    if (HR_RE.test(l)) {
      flushPara();
      out.push({ type: 'hr' });
      i++;
      continue;
    }
    if (isTableLine(l) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushPara();
      const header = splitRow(l);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && isTableLine(lines[i])) rows.push(splitRow(lines[i++]));
      out.push({ type: 'table', header, rows });
      continue;
    }
    if (/^\s*>/.test(l)) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ type: 'quote', children: parseLines(inner) });
      continue;
    }
    if (LIST_RE.test(l)) {
      flushPara();
      const [node, next] = parseList(lines, i, indentOf(l));
      out.push(node);
      i = next;
      continue;
    }
    const img = IMAGE_RE.exec(l);
    if (img) {
      flushPara();
      out.push({ type: 'image', alt: img[1], url: img[2] });
      i++;
      continue;
    }
    para.push(l.trim());
    i++;
  }
  flushPara();
  return out;
}

function parseList(lines: string[], start: number, baseIndent: number): [MdNode, number] {
  const first = LIST_RE.exec(lines[start])!;
  const ordered = /\d/.test(first[2]);
  const node: { type: 'list'; ordered: boolean; start: number; items: ListItem[] } = {
    type: 'list', ordered, start: ordered ? parseInt(first[2], 10) || 1 : 1, items: [],
  };
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      // a blank line ends the list unless the next line continues it at the same/deeper indent
      const nxt = lines[i + 1];
      if (nxt && LIST_RE.test(nxt) && indentOf(nxt) >= baseIndent) {
        i++;
        continue;
      }
      break;
    }
    const m = LIST_RE.exec(l);
    const ind = indentOf(l);
    if (m && ind >= baseIndent && ind < baseIndent + 2) {
      if (/\d/.test(m[2]) !== ordered) break;
      node.items.push({ text: m[4], checked: m[3] === undefined ? null : m[3].toLowerCase() === 'x', children: [] });
      i++;
      continue;
    }
    if (ind >= baseIndent + 2 && node.items.length) {
      // nested content of the last item
      const nested: string[] = [];
      while (i < lines.length && (lines[i].trim() === '' ? (lines[i + 1] && indentOf(lines[i + 1]) >= baseIndent + 2) : indentOf(lines[i]) >= baseIndent + 2)) {
        nested.push(lines[i].slice(Math.min(indentOf(lines[i]), baseIndent + 2)));
        i++;
      }
      node.items[node.items.length - 1].children.push(...parseLines(nested));
      continue;
    }
    if (ind < baseIndent) break;
    if (!m) {
      // lazy continuation line of the last item
      const last = node.items[node.items.length - 1];
      if (last && !isTableLine(l) && !HEADING_RE.test(l)) {
        last.text += `\n${l.trim()}`;
        i++;
        continue;
      }
      break;
    }
    break;
  }
  return [node, i];
}

// ---------------------------------------------------------------------------------------------
// Inline


export function parseInline(src: string): Seg[] {
  const out: Seg[] = [];
  walkInline(src, {}, out);
  // merge adjacent plain runs with identical style
  const merged: Seg[] = [];
  for (const s of out) {
    const p = merged[merged.length - 1];
    if (p && !p.cite && !s.cite && !p.eq && !s.eq && p.b === s.b && p.i === s.i && p.s === s.s && p.c === s.c && p.href === s.href) p.text += s.text;
    else merged.push({ ...s });
  }
  return merged.filter((s) => s.text || s.cite);
}

type Style = Omit<Seg, 'text'>;

function push(out: Seg[], text: string, st: Style) {
  if (text) out.push({ text, ...st });
}

function walkInline(s: string, st: Style, out: Seg[]) {
  let i = 0;
  let plain = '';
  const flush = () => {
    push(out, plain, st);
    plain = '';
  };
  while (i < s.length) {
    const rest = s.slice(i);
    // escaped char
    if (s[i] === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|~$>]/.test(s[i + 1])) {
      plain += s[i + 1];
      i += 2;
      continue;
    }
    // inline code
    if (s[i] === '`') {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
      if (m) {
        flush();
        push(out, m[2].replace(/^ (.*) $/, '$1'), { ...st, c: true });
        i += m[0].length;
        continue;
      }
    }
    // citations [1] or [1][2] (not links)
    const cite = /^\[(\d{1,3})\](?!\()/.exec(rest);
    if (cite) {
      flush();
      out.push({ text: '', ...st, cite: Number(cite[1]) });
      i += cite[0].length;
      continue;
    }
    // links [text](url)
    if (s[i] === '[') {
      const m = /^\[((?:[^\][]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (m) {
        flush();
        walkInline(m[1], { ...st, href: m[2] }, out);
        i += m[0].length;
        continue;
      }
    }
    // autolink <https://…>
    if (s[i] === '<') {
      const m = /^<(https?:\/\/[^>\s]+)>/.exec(rest);
      if (m) {
        flush();
        push(out, m[1], { ...st, href: m[1] });
        i += m[0].length;
        continue;
      }
    }
    // bare URLs
    if ((s[i] === 'h' || s[i] === 'w') && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      const m = /^(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.exec(rest);
      if (m) {
        flush();
        push(out, m[1], { ...st, href: st.href ?? m[1] });
        i += m[1].length;
        continue;
      }
    }
    // inline math $x$ (not currency: no space after opening / before closing, closing not followed by digit)
    if (s[i] === '$' && s[i + 1] !== '$') {
      const m = /^\$([^\s$][^$\n]*?[^\s$\\]|[^\s$])\$(?!\d)/.exec(rest);
      if (m && !/^\d+([.,]\d+)?$/.test(m[1])) {
        flush();
        out.push({ text: m[1], ...st, eq: true });
        i += m[0].length;
        continue;
      }
    }
    // strikethrough
    if (rest.startsWith('~~')) {
      const end = s.indexOf('~~', i + 2);
      if (end > i + 2) {
        flush();
        walkInline(s.slice(i + 2, end), { ...st, s: true }, out);
        i = end + 2;
        continue;
      }
    }
    // bold+italic / bold / italic with * or _
    if (s[i] === '*' || s[i] === '_') {
      const ch = s[i];
      const run = /^(\*{1,3}|_{1,3})/.exec(rest)![1];
      const n = run.length;
      const prev = i > 0 ? s[i - 1] : ' ';
      const next = s[i + n] ?? '';
      const opens = next && !/\s/.test(next) && !(ch === '_' && /[\p{L}\p{N}]/u.test(prev));
      if (opens) {
        const close = findClose(s, i + n, ch, n);
        if (close > i + n) {
          flush();
          const inner = s.slice(i + n, close);
          const style = n === 3 ? { ...st, b: true, i: true } : n === 2 ? { ...st, b: true } : { ...st, i: true };
          walkInline(inner, style, out);
          i = close + n;
          continue;
        }
      }
    }
    plain += s[i];
    i++;
  }
  flush();
}

function findClose(s: string, from: number, ch: string, n: number): number {
  const marker = ch.repeat(n);
  let j = from;
  while (j < s.length) {
    const k = s.indexOf(marker, j);
    if (k < 0) return -1;
    const before = s[k - 1];
    const after = s[k + n] ?? '';
    // closing delimiter: not preceded by whitespace; for single markers not part of a longer run
    if (before && !/\s/.test(before) && (n > 1 || after !== ch) && !(ch === '_' && /[\p{L}\p{N}]/u.test(after))) return k;
    j = k + 1;
  }
  return -1;
}

/** Plain text of inline Markdown (for copying/indexing). */
export function inlineToPlain(src: string): string {
  return parseInline(src).map((s) => (s.cite ? `[${s.cite}]` : s.text)).join('');
}

/** Markdown of a node list back to plain-ish text lines (used for list item previews). */
export function nodesToPlain(nodes: MdNode[]): string {
  const lines: string[] = [];
  for (const n of nodes) {
    if (n.type === 'paragraph' || n.type === 'heading') lines.push(inlineToPlain(n.text));
    else if (n.type === 'list') n.items.forEach((it) => lines.push(inlineToPlain(it.text), nodesToPlain(it.children)));
    else if (n.type === 'quote') lines.push(nodesToPlain(n.children));
    else if (n.type === 'code' || n.type === 'math') lines.push(n.text);
    else if (n.type === 'table') lines.push([n.header, ...n.rows].map((r) => r.join('\t')).join('\n'));
  }
  return lines.filter(Boolean).join('\n');
}
