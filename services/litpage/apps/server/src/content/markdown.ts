// Markdown → block specs (the "Text & Markdown" importer): ATX/setext headings, nested
// bulleted / numbered / to-do lists, quotes, the export <aside> callouts and <details> toggles,
// fenced code (language mapped to the supported names), $$ equations, dividers, GFM tables, images,
// and inline bold / italic / strike / underline / code / links / $math$.
import type { Annotation, Decoration, RichText } from '@nc/shared/richtext.ts';
import type { Spec } from './spec.ts';
import { safeHref } from '@nc/shared/url.ts';

// ---------------------------------------------------------------- inline

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~$<>|]/;

function pushText(out: Decoration[], text: string, anns: Annotation[]) {
  if (!text) return;
  const last = out[out.length - 1];
  const same = last && JSON.stringify(last[1] ?? []) === JSON.stringify(anns);
  if (same && !last[0].includes('‣') && !last[0].includes('⁍')) {
    last[0] += text;
    return;
  }
  out.push(anns.length ? [text, anns.map((a) => [...a]) as Annotation[]] : [text]);
}

function findClosing(s: string, from: number, delim: string): number {
  for (let j = from; j <= s.length - delim.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s.startsWith(delim, j)) return j;
  }
  return -1;
}

function findBracketEnd(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '[') depth++;
    else if (s[j] === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findParenEnd(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

export interface InlineContext {
  /** rewrite link targets (e.g. links to other pages of an imported archive) */
  resolveLink?: (href: string) => string | null;
}

/** Inline markdown → rich text. */
export function parseInline(src: string, anns: Annotation[] = [], ctx: InlineContext = {}): RichText {
  const out: Decoration[] = [];
  let buf = '';
  const flush = () => {
    pushText(out, buf, anns);
    buf = '';
  };
  const emit = (inner: RichText) => {
    flush();
    for (const d of inner) {
      if (d[0].includes('‣') || d[0].includes('⁍')) out.push(d);
      else pushText(out, d[0], (d[1] as Annotation[] | undefined) ?? []);
    }
  };
  const has = (k: string) => anns.some((a) => a[0] === k);
  let i = 0;
  const s = src;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const delim = '`'.repeat(n);
      const end = s.indexOf(delim, i + n);
      if (end > 0) {
        let code = s.slice(i + n, end);
        if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        flush();
        pushText(out, code, [...anns, ['c']]);
        i = end + n;
        continue;
      }
    }
    if (ch === '$' && s[i + 1] !== '$' && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
      const end = s.indexOf('$', i + 1);
      if (end > i + 1 && s[end - 1] !== ' ' && !/\d/.test(s[end + 1] ?? '')) {
        flush();
        out.push(['⁍', [...anns.map((a) => [...a] as Annotation), ['e', s.slice(i + 1, end)]]]);
        i = end + 1;
        continue;
      }
    }
    if ((ch === '[' || (ch === '!' && s[i + 1] === '[')) && !has('a')) {
      const open = ch === '!' ? i + 1 : i;
      const close = findBracketEnd(s, open);
      if (close > 0 && s[close + 1] === '(') {
        const pend = findParenEnd(s, close + 1);
        if (pend > 0) {
          const text = s.slice(open + 1, close);
          let href = s.slice(close + 2, pend).trim();
          const titleMatch = /^(\S+)\s+["'(].*["')]$/.exec(href);
          if (titleMatch) href = titleMatch[1];
          if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
          const resolved = safeHref(ctx.resolveLink ? ctx.resolveLink(href) : href);
          const label = text || href;
          if (resolved) emit(parseInline(label, [...anns, ['a', resolved]], ctx));
          else emit(parseInline(label, anns, ctx));
          i = pend + 1;
          continue;
        }
      }
    }
    if (ch === '<') {
      const auto = /^<(https?:\/\/[^\s>]+)>/.exec(s.slice(i));
      if (auto) {
        flush();
        pushText(out, auto[1], [...anns, ['a', auto[1]]]);
        i += auto[0].length;
        continue;
      }
      const br = /^<br\s*\/?>/i.exec(s.slice(i));
      if (br) {
        buf += '\n';
        i += br[0].length;
        continue;
      }
      const u = /^<u>([\s\S]*?)<\/u>/i.exec(s.slice(i));
      if (u) {
        emit(parseInline(u[1], [...anns, ['_']], ctx));
        i += u[0].length;
        continue;
      }
      const mark = /^<mark[^>]*>([\s\S]*?)<\/mark>/i.exec(s.slice(i));
      if (mark) {
        emit(parseInline(mark[1], [...anns, ['h', 'yellow_background']], ctx));
        i += mark[0].length;
        continue;
      }
    }
    if ((s.startsWith('**', i) || s.startsWith('__', i)) && !has('b')) {
      const delim = s.slice(i, i + 2);
      const end = findClosing(s, i + 2, delim);
      if (end > i + 2 && s[i + 2] !== ' ') {
        emit(parseInline(s.slice(i + 2, end), [...anns, ['b']], ctx));
        i = end + 2;
        continue;
      }
    }
    if (s.startsWith('~~', i) && !has('s')) {
      const end = findClosing(s, i + 2, '~~');
      if (end > i + 2) {
        emit(parseInline(s.slice(i + 2, end), [...anns, ['s']], ctx));
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && !has('i') && s[i + 1] !== ch && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
      const wordBefore = i > 0 && /[\p{L}\p{N}]/u.test(s[i - 1]);
      if (!(ch === '_' && wordBefore)) {
        let end = -1;
        for (let j = i + 1; j < s.length; j++) {
          if (s[j] === '\\') {
            j++;
            continue;
          }
          if (s[j] === ch && s[j + 1] !== ch && s[j - 1] !== ' ' && s[j - 1] !== ch) {
            if (ch === '_' && /[\p{L}\p{N}]/u.test(s[j + 1] ?? '')) continue;
            end = j;
            break;
          }
        }
        if (end > i + 1) {
          emit(parseInline(s.slice(i + 1, end), [...anns, ['i']], ctx));
          i = end + 1;
          continue;
        }
      }
    }
    if ((s.startsWith('http://', i) || s.startsWith('https://', i)) && !has('a') && (i === 0 || /[\s(]/.test(s[i - 1]))) {
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      let url = s.slice(i, j);
      while (/[.,;:!?)\]]$/.test(url)) url = url.slice(0, -1);
      flush();
      pushText(out, url, [...anns, ['a', url]]);
      i += url.length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- blocks

const LANG_ALIASES: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', typescript: 'TypeScript',
  py: 'Python', python: 'Python', rb: 'Ruby', ruby: 'Ruby', sh: 'Shell', shell: 'Shell', bash: 'Bash', zsh: 'Shell', console: 'Shell',
  ps1: 'PowerShell', powershell: 'PowerShell', yml: 'YAML', yaml: 'YAML', json: 'JSON', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS',
  sass: 'Sass', less: 'Less', md: 'Markdown', markdown: 'Markdown', sql: 'SQL', go: 'Go', golang: 'Go', rs: 'Rust', rust: 'Rust',
  java: 'Java', kt: 'Kotlin', kotlin: 'Kotlin', swift: 'Swift', c: 'C', h: 'C', cpp: 'C++', 'c++': 'C++', cc: 'C++', cs: 'C#', csharp: 'C#',
  php: 'PHP', r: 'R', scala: 'Scala', dart: 'Dart', lua: 'Lua', perl: 'Perl', pl: 'Perl', hs: 'Haskell', haskell: 'Haskell', toml: 'TOML',
  dockerfile: 'Docker', docker: 'Docker', makefile: 'Makefile', make: 'Makefile', graphql: 'GraphQL', gql: 'GraphQL', diff: 'Diff', patch: 'Diff',
  tex: 'LaTeX', latex: 'LaTeX', mermaid: 'Mermaid', elixir: 'Elixir', ex: 'Elixir', erlang: 'Erlang', clojure: 'Clojure', ocaml: 'OCaml',
  fsharp: 'F#', vb: 'Visual Basic', solidity: 'Solidity', protobuf: 'Protobuf', proto: 'Protobuf', nix: 'Nix', text: 'Plain Text', txt: 'Plain Text',
  plaintext: 'Plain Text', plain: 'Plain Text', ascii: 'ASCII Art', wasm: 'WebAssembly', verilog: 'Verilog', vhdl: 'VHDL', matlab: 'MATLAB',
};

export function codeLanguage(info: string): string {
  const k = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!k) return 'Plain Text';
  return LANG_ALIASES[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
}

interface Line {
  indent: number;
  text: string; // without indentation
  raw: string;
}

function toLines(src: string): Line[] {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw) => {
      const expanded = raw.replace(/\t/g, '    ');
      const m = /^ */.exec(expanded)!;
      return { indent: m[0].length, text: expanded.slice(m[0].length), raw: expanded };
    });
}

const RE_FENCE = /^(`{3,}|~{3,})\s*([^`]*)$/;
const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const RE_BULLET = /^([-*+])\s+(.*)$/;
const RE_ORDERED = /^(\d{1,9})[.)]\s+(.*)$/;
const RE_TASK = /^\[([ xX])\]\s+(.*)$/;
const RE_IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)\s*$/;
const RE_TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isBlockStart(t: string): boolean {
  return RE_FENCE.test(t) || RE_HEADING.test(t) || RE_HR.test(t) || RE_BULLET.test(t) || RE_ORDERED.test(t) || t.startsWith('>') ||
    t.startsWith('$$') || /^<(aside|details)\b/i.test(t) || RE_IMAGE_LINE.test(t);
}

function splitRow(t: string): string[] {
  let s = t.trim();
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

const EMOJI_START = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u;

export interface MarkdownResult {
  title?: string;
  blocks: Spec[];
}

export interface BlockContext extends InlineContext {
  /** image src rewrite (archive-relative images) */
  resolveImage?: (src: string) => string | null;
  /** a paragraph that is only a link to another imported page → that page block (ZIP import) */
  resolvePageLink?: (href: string) => Spec | null;
}

function parseLines(lines: Line[], ctx: BlockContext): Spec[] {
  // normalize the container's base indentation
  const nonBlank = lines.filter((l) => l.text.trim());
  const base = nonBlank.length ? Math.min(...nonBlank.map((l) => l.indent)) : 0;
  const L: Line[] = lines.map((l) => (l.text.trim() ? { ...l, indent: l.indent - base } : { indent: 0, text: '', raw: '' }));
  const out: Spec[] = [];
  let i = 0;
  const text = (s: string) => parseInline(s, [], ctx);

  while (i < L.length) {
    const line = L[i];
    const t = line.text;
    if (!t.trim()) {
      i++;
      continue;
    }
    // indented continuation without an owner (e.g. after a heading): treat as normal content
    // fenced code
    const fence = RE_FENCE.exec(t);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      const isClose = (lt: string) => {
        const tt = lt.trim();
        return tt.length >= marker.length && tt === marker.charAt(0).repeat(tt.length);
      };
      i++;
      while (i < L.length && !isClose(L[i].text)) {
        body.push(L[i].raw.slice(Math.min(line.indent + base, L[i].raw.length - L[i].raw.trimStart().length)));
        i++;
      }
      i++;
      const lang = codeLanguage(fence[2] ?? '');
      out.push({ type: 'code', text: body.join('\n'), language: lang });
      continue;
    }
    // block equation
    if (t.startsWith('$$')) {
      const rest = t.slice(2);
      if (rest.trim().endsWith('$$') && rest.trim().length > 2) {
        out.push({ type: 'equation', text: rest.trim().slice(0, -2).trim() });
        i++;
        continue;
      }
      const body: string[] = rest.trim() ? [rest] : [];
      i++;
      while (i < L.length && !L[i].text.trim().endsWith('$$')) body.push(L[i].text), i++;
      if (i < L.length) {
        const last = L[i].text.trim().slice(0, -2);
        if (last) body.push(last);
        i++;
      }
      out.push({ type: 'equation', text: body.join('\n').trim() });
      continue;
    }
    // the export callout <aside> … </aside>
    if (/^<aside\b/i.test(t)) {
      const body: Line[] = [];
      let first = t.replace(/^<aside[^>]*>/i, '');
      let closed = /<\/aside>\s*$/i.test(first);
      if (closed) first = first.replace(/<\/aside>\s*$/i, '');
      if (first.trim()) body.push({ indent: 0, text: first.trim(), raw: first.trim() });
      i++;
      while (!closed && i < L.length) {
        if (/<\/aside>\s*$/i.test(L[i].text)) {
          const before = L[i].text.replace(/<\/aside>\s*$/i, '');
          if (before.trim()) body.push({ ...L[i], text: before });
          closed = true;
          i++;
          break;
        }
        body.push(L[i]);
        i++;
      }
      const inner = parseLines(body, ctx);
      let icon = '💡';
      let head: RichText = [];
      if (inner[0] && inner[0].type === 'text') {
        const first0 = inner.shift()!;
        const rtx = (first0.text as RichText) ?? [];
        const plain = rtx.map((d) => d[0]).join('');
        const em = EMOJI_START.exec(plain);
        if (em && rtx.length && rtx[0][0].startsWith(em[0])) {
          icon = em[1];
          rtx[0] = [rtx[0][0].slice(em[0].length), ...(rtx[0].length > 1 ? [rtx[0][1]] : [])] as Decoration;
        }
        head = rtx.filter((d) => d[0]);
      }
      out.push({ type: 'callout', text: head, icon, format: { block_color: 'gray_background' }, children: inner });
      continue;
    }
    // toggle <details><summary>…</summary> … </details>
    if (/^<details\b/i.test(t)) {
      let rest = t.replace(/^<details[^>]*>/i, '');
      let summary = '';
      const body: Line[] = [];
      const sm = /<summary>([\s\S]*?)<\/summary>/i.exec(rest);
      if (sm) {
        summary = sm[1];
        rest = rest.slice(sm.index + sm[0].length);
      }
      let depth = 1;
      if (rest.trim()) body.push({ indent: 0, text: rest.trim(), raw: rest.trim() });
      i++;
      while (i < L.length) {
        const lt = L[i].text;
        if (!summary) {
          const m2 = /^<summary>([\s\S]*?)<\/summary>(.*)$/i.exec(lt.trim());
          if (m2) {
            summary = m2[1];
            if (m2[2].trim()) body.push({ indent: 0, text: m2[2].trim(), raw: m2[2].trim() });
            i++;
            continue;
          }
        }
        if (/^<details\b/i.test(lt)) depth++;
        if (/<\/details>\s*$/i.test(lt)) {
          depth--;
          if (depth === 0) {
            const before = lt.replace(/<\/details>\s*$/i, '');
            if (before.trim()) body.push({ ...L[i], text: before });
            i++;
            break;
          }
        }
        body.push(L[i]);
        i++;
      }
      out.push({ type: 'toggle', text: text(summary.trim()), children: parseLines(body, ctx) });
      continue;
    }
    // headings
    const h = RE_HEADING.exec(t);
    if (h && line.indent < 4) {
      const level = h[1].length;
      const type = level === 1 ? 'header' : level === 2 ? 'sub_header' : level === 3 ? 'sub_sub_header' : 'header_4';
      out.push({ type, text: text(h[2]) });
      i++;
      continue;
    }
    // divider
    if (RE_HR.test(t.trim()) && line.indent < 4) {
      out.push({ type: 'divider' });
      i++;
      continue;
    }
    // quote
    if (t.startsWith('>')) {
      const body: Line[] = [];
      while (i < L.length && L[i].text.startsWith('>')) {
        const s = L[i].text.replace(/^>\s?/, '');
        body.push({ indent: 0, text: s, raw: s });
        i++;
      }
      const inner = parseLines(toLines(body.map((b) => b.raw).join('\n')), ctx);
      const first = inner[0] && inner[0].type === 'text' ? inner.shift()! : null;
      out.push({ type: 'quote', text: (first?.text as RichText) ?? [], children: inner });
      continue;
    }
    // GFM table
    if (t.includes('|') && i + 1 < L.length && RE_TABLE_SEP.test(L[i + 1].text.trim())) {
      const header = splitRow(t);
      const rows: RichText[][] = [header.map((c) => text(c))];
      i += 2;
      while (i < L.length && L[i].text.trim() && L[i].text.includes('|')) {
        const cells = splitRow(L[i].text);
        rows.push(header.map((_, ci) => text(cells[ci] ?? '')));
        i++;
      }
      out.push({ type: 'table', table: rows, tableHeader: true });
      continue;
    }
    // list items
    const bullet = RE_BULLET.exec(t);
    const ordered = RE_ORDERED.exec(t);
    if (bullet || ordered) {
      const itemText = (bullet ? bullet[2] : ordered![2]) ?? '';
      const itemIndent = line.indent;
      const childLines: Line[] = [];
      i++;
      let textLines = [itemText];
      // lazy continuation lines (no blank line, not a new block)
      while (i < L.length && L[i].text.trim() && L[i].indent <= itemIndent && !isBlockStart(L[i].text) && !L[i].text.includes('|')) {
        textLines.push(L[i].text);
        i++;
      }
      while (i < L.length) {
        const nl = L[i];
        if (!nl.text.trim()) {
          // blank: include only if the next non-blank line is indented under this item
          let j = i + 1;
          while (j < L.length && !L[j].text.trim()) j++;
          if (j < L.length && L[j].indent > itemIndent) {
            childLines.push(nl);
            i++;
            continue;
          }
          break;
        }
        if (nl.indent > itemIndent) {
          childLines.push(nl);
          i++;
          continue;
        }
        break;
      }
      let spec: Spec;
      const task = bullet ? RE_TASK.exec(itemText) : null;
      if (task) {
        textLines = [task[2], ...textLines.slice(1)];
        spec = { type: 'to_do', checked: task[1].toLowerCase() === 'x', text: text(textLines.join('\n')) };
      } else if (ordered) {
        spec = { type: 'numbered_list', text: text(textLines.join('\n')) };
      } else {
        spec = { type: 'bulleted_list', text: text(textLines.join('\n')) };
      }
      const kids = parseLines(childLines, ctx);
      if (kids.length) spec.children = kids;
      out.push(spec);
      continue;
    }
    // image line
    const img = RE_IMAGE_LINE.exec(t);
    if (img) {
      const src = ctx.resolveImage ? ctx.resolveImage(img[2]) : img[2];
      if (src) out.push({ type: 'image', url: src, ...(img[1] ? { props: { caption: [[img[1]]] } } : {}) });
      i++;
      continue;
    }
    // paragraph (with setext heading support)
    const para: string[] = [t];
    i++;
    while (i < L.length && L[i].text.trim() && !isBlockStart(L[i].text) && !(L[i].text.includes('|') && i + 1 < L.length && RE_TABLE_SEP.test(L[i + 1].text.trim()))) {
      if (/^=+\s*$/.test(L[i].text) || /^-+\s*$/.test(L[i].text)) break;
      para.push(L[i].text);
      i++;
    }
    if (i < L.length && (/^=+\s*$/.test(L[i].text) || /^-{2,}\s*$/.test(L[i].text)) && para.length) {
      out.push({ type: L[i].text.trim().startsWith('=') ? 'header' : 'sub_header', text: text(para.join(' ')) });
      i++;
      continue;
    }
    const joined = para.join('\n');
    const onlyLink = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(joined.trim());
    if (onlyLink && ctx.resolvePageLink) {
      const pageSpec = ctx.resolvePageLink(onlyLink[2]);
      if (pageSpec) {
        out.push(pageSpec);
        continue;
      }
    }
    out.push({ type: 'text', text: text(joined) });
  }
  return out;
}

/** Parse a Markdown document. A leading "# Title" becomes the page title (the export convention). */
export function parseMarkdown(src: string, ctx: BlockContext = {}, opts?: { titleFromH1?: boolean }): MarkdownResult {
  let body = src.replace(/^﻿/, '');
  // YAML front matter
  const fm = /^---\n[\s\S]*?\n---\n/.exec(body);
  let title: string | undefined;
  if (fm) {
    const tm = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[0]);
    if (tm) title = tm[1];
    body = body.slice(fm[0].length);
  }
  const blocks = parseLines(toLines(body), ctx);
  if (opts?.titleFromH1 !== false && !title && blocks[0]?.type === 'header') {
    title = (blocks[0].text as RichText).map((d) => d[0]).join('');
    blocks.shift();
  }
  return { title, blocks };
}
