// Clipboard for the editor: copy/cut/paste of rich HTML + internal block JSON + Markdown (plain text).
// - text selection inside one leaf → partial rich text (keeps marks, links, mentions, equations)
// - block selection → block trees (nested lists, to-dos, code, quotes, toggles …)
// - paste: internal JSON > HTML > Markdown/plain; images/files upload into image/file blocks; a bare URL pastes as a
// link and opens the "Paste as" menu; a URL over a selection links it (ed-paste-url-on-selection).
import type { BlockRecord, BlockType } from '@nc/shared/records.ts';
import {
  annotationsAt, annotationsOf, deleteRange, insertRich, insertText, length, slice, toPlainText, EQUATION_CHAR, MENTION_CHAR,
  type Annotation, type DateValue, type RichText,
} from '@nc/shared/richtext.ts';
import { TEXT_BLOCKS, canHaveChildren } from '@nc/shared/blocks.ts';
import { newId } from '@nc/shared/ids.ts';
import { createBlockIn, deleteBlocksIn, getBlock, moveBlocksIn, run, setTitle } from '../../lib/blocks.ts';
import { uploadFile } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { pageUrl } from '../../lib/router.ts';
import type { LeafApi } from './RichTextEditable.tsx';
import { useEditor } from './editorState.ts';
import { titleOf } from './commands.ts';
import { commitText } from './textHandlers.ts';
import { formatDateValue } from './inline/dates.ts';

export const BLOCKS_MIME = 'application/x-nc-blocks';

export interface ParsedBlock {
  type: BlockType;
  title: RichText;
  props?: Record<string, any>;
  format?: Record<string, any>;
  children?: ParsedBlock[];
}

// ------------------------------------------------------------------------------------------------
// Markdown → blocks

function inlineMarkdown(s: string): RichText {
 // **bold**, __bold__, *italic*, _italic_, `code`, ~~strike~~, ~strike~, [text](url), $$tex$$, bare URLs
  const out: RichText = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|~~[^~]+~~|\$\$[^$]+\$\$|\*[^*\s][^*]*\*|_[^_\s][^_]*_|~[^~\s][^~]*~|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push([s.slice(last, m.index)]);
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) out.push([tok.slice(2, -2), [['b']]]);
    else if (tok.startsWith('`')) out.push([tok.slice(1, -1), [['c']]]);
    else if (tok.startsWith('~~')) out.push([tok.slice(2, -2), [['s']]]);
    else if (tok.startsWith('$$')) out.push([EQUATION_CHAR, [['e', tok.slice(2, -2)]]]);
    else if (tok.startsWith('~')) out.push([tok.slice(1, -1), [['s']]]);
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      out.push([mm[1], [['a', mm[2]]]]);
    } else if (/^https?:/.test(tok)) out.push([tok, [['a', tok]]]);
    else out.push([tok.slice(1, -1), [['i']]]);
    last = m.index! + tok.length;
  }
  if (last < s.length) out.push([s.slice(last)]);
  return out.filter((d) => d[0]);
}

export function markdownToBlocks(text: string): ParsedBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
 // drop a single trailing empty line (clipboards usually end with "\n")
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  type Entry = { block: ParsedBlock; indent: number };
  const stack: Entry[] = [];
  const out: ParsedBlock[] = [];
  let code: { lang: string; lines: string[]; indent: number } | null = null;
  const push = (b: ParsedBlock, indent: number) => {
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && indent > parent.indent && canHaveChildren(parent.block.type)) (parent.block.children ??= []).push(b);
    else out.push(b);
    stack.push({ block: b, indent });
  };
  for (const raw of lines) {
    if (code) {
      if (/^\s*```/.test(raw)) {
        push({ type: 'code', title: [[code.lines.join('\n')]], props: { language: [[codeLanguage(code.lang)]] } }, code.indent);
        code = null;
      } else code.lines.push(raw);
      continue;
    }
    const indentStr = /^(\s*)/.exec(raw)?.[1] ?? '';
    const indent = indentStr.replace(/\t/g, '    ').length;
    const line = raw.trim();
    const fence = /^```\s*([\w+#-]*)\s*$/.exec(line);
    if (fence) {
      code = { lang: fence[1], lines: [], indent };
      continue;
    }
    if (!line) {
      stack.length = 0;
      continue;
    }
    let b: ParsedBlock;
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      const lvl = m[1].length;
      b = { type: lvl === 1 ? 'header' : lvl === 2 ? 'sub_header' : lvl === 3 ? 'sub_sub_header' : 'header_4', title: inlineMarkdown(m[2]) };
    } else if ((m = /^[-*+•]\s+\[([ xX])\]\s+(.*)$/.exec(line))) b = { type: 'to_do', title: inlineMarkdown(m[2]), props: { checked: [[m[1].toLowerCase() === 'x' ? 'Yes' : 'No']] } };
    else if ((m = /^\[([ xX]?)\]\s+(.*)$/.exec(line))) b = { type: 'to_do', title: inlineMarkdown(m[2]), props: { checked: [[m[1].toLowerCase() === 'x' ? 'Yes' : 'No']] } };
    else if ((m = /^[-*+•]\s+(.*)$/.exec(line))) b = { type: 'bulleted_list', title: inlineMarkdown(m[1]) };
    else if ((m = /^(\d+)[.)]\s+(.*)$/.exec(line))) b = { type: 'numbered_list', title: inlineMarkdown(m[2]), ...(m[1] !== '1' ? { format: { list_start_index: Number(m[1]) } } : {}) };
    else if ((m = /^>\s?(.*)$/.exec(line))) b = { type: 'quote', title: inlineMarkdown(m[1]) };
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) b = { type: 'divider', title: [] };
    else if ((m = /^\$\$(.+)\$\$$/.exec(line))) b = { type: 'equation', title: [[m[1]]] };
    else if ((m = /^!\[[^\]]*\]\((\S+)\)$/.exec(line))) b = { type: 'image', title: [], props: { source: [[m[1]]] }, format: { display_source: m[1] } };
    else b = { type: 'text', title: inlineMarkdown(line) };
    push(b, indent);
  }
  if (code) push({ type: 'code', title: [[code.lines.join('\n')]], props: { language: [[codeLanguage(code.lang)]] } }, code.indent);
  return out;
}

function codeLanguage(lang: string): string {
  const l = lang.toLowerCase();
  const map: Record<string, string> = {
    js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', py: 'Python', python: 'Python', sh: 'Shell', bash: 'Bash',
    json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL', java: 'Java', go: 'Go', rust: 'Rust', rs: 'Rust', c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#',
    rb: 'Ruby', ruby: 'Ruby', php: 'PHP', swift: 'Swift', kotlin: 'Kotlin', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', mermaid: 'Mermaid',
    jsx: 'JavaScript', tsx: 'TypeScript', xml: 'XML', diff: 'Diff', docker: 'Docker', dockerfile: 'Docker', graphql: 'GraphQL', scala: 'Scala',
  };
  return map[l] ?? (lang ? lang : 'Plain Text');
}

// ------------------------------------------------------------------------------------------------
// HTML → blocks

function inlineFromHtml(el: Node, anns: Annotation[] = []): RichText {
  const rt: RichText = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      const t = (n.nodeValue ?? '').replace(/[\t\n\r ]+/g, ' ');
      if (t) rt.push(anns.length ? [t, anns] : [t]);
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as HTMLElement;
    const tag = e.tagName.toLowerCase();
    if (tag === 'br') {
      rt.push(['\n']);
      return;
    }
    if (tag === 'script' || tag === 'style') return;
    if (tag === 'img') return;
    if (tag === 'input') return;
    const next = [...anns];
    const fw = e.style.fontWeight;
    const bold = (tag === 'b' || tag === 'strong' || fw === 'bold' || Number(fw) >= 600) && fw !== 'normal' && Number(fw || 700) >= 600;
    if (bold) next.push(['b']);
    if ((tag === 'i' || tag === 'em' || e.style.fontStyle === 'italic') && e.style.fontStyle !== 'normal') next.push(['i']);
    if (tag === 'u' || /underline/.test(e.style.textDecoration)) next.push(['_']);
    if (tag === 's' || tag === 'del' || tag === 'strike' || /line-through/.test(e.style.textDecoration)) next.push(['s']);
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') next.push(['c']);
    if (tag === 'a' && e.getAttribute('href') && !e.getAttribute('href')!.startsWith('javascript:')) next.push(['a', e.getAttribute('href')!]);
    const eq = e.getAttribute('data-nc-equation');
    if (eq !== null) {
      rt.push([EQUATION_CHAR, [['e', eq]]]);
      return;
    }
    const mention = e.getAttribute('data-nc-mention');
    if (mention) {
      try {
        const ann = JSON.parse(mention) as Annotation;
        rt.push([MENTION_CHAR, [ann]]);
        return;
      } catch {
 /* fall through */
      }
    }
    rt.push(...inlineFromHtml(e, dedupe(next)));
  });
  return rt;
}

function dedupe(anns: Annotation[]): Annotation[] {
  const seen = new Set<string>();
  return anns.filter((a) => {
    const k = a[0] === 'a' ? 'a' : JSON.stringify(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function trimRt(rt: RichText): RichText {
  const v = rt.slice();
  while (v.length && /^\s*$/.test(v[0][0]) && !annotationsOf(v[0]).length) v.shift();
  if (v.length && !isAtomDeco(v[0])) v[0] = [v[0][0].replace(/^\s+/, ''), ...(v[0][1] ? [v[0][1]] : [])] as any;
  while (v.length && /^\s*$/.test(v[v.length - 1][0]) && !annotationsOf(v[v.length - 1]).length) v.pop();
  if (v.length && !isAtomDeco(v[v.length - 1])) {
    const l = v[v.length - 1];
    v[v.length - 1] = [l[0].replace(/\s+$/, ''), ...(l[1] ? [l[1]] : [])] as any;
  }
  return v.filter((d) => d[0]);
}

function isAtomDeco(d: [string] | [string, Annotation[]]): boolean {
  return d[0] === MENTION_CHAR || d[0] === EQUATION_CHAR;
}

const BLOCK_TAGS = /^(p|div|h[1-6]|ul|ol|li|pre|blockquote|hr|table|img|figure|details|section|article|header|footer|main)$/;

export function htmlToBlocks(html: string): ParsedBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (el: Element, listType?: BlockType): ParsedBlock[] => {
    const out: ParsedBlock[] = [];
    let inlineBuf: Node[] = [];
    const flushInline = () => {
      if (!inlineBuf.length) return;
      const wrap = document.createElement('div');
      for (const n of inlineBuf) wrap.appendChild(n.cloneNode(true));
      inlineBuf = [];
      const t = trimRt(inlineFromHtml(wrap));
      if (length(t)) out.push({ type: 'text', title: t });
    };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 || (node.nodeType === 1 && !BLOCK_TAGS.test((node as Element).tagName.toLowerCase()))) {
        if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === 'br') {
          flushInline();
          continue;
        }
        if (node.nodeType === 1 && (node as HTMLElement).querySelector?.('p,div,ul,ol,h1,h2,h3,h4,pre,blockquote,li,table')) {
 // inline wrapper around block content (e.g. Google Docs <b id="docs-internal-guid">)
          flushInline();
          out.push(...walk(node as Element, listType));
          continue;
        }
        inlineBuf.push(node);
        continue;
      }
      flushInline();
      const child = node as HTMLElement;
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const lvl = Number(tag[1]);
        out.push({ type: lvl === 1 ? 'header' : lvl === 2 ? 'sub_header' : lvl === 3 ? 'sub_sub_header' : 'header_4', title: trimRt(inlineFromHtml(child)) });
      } else if (tag === 'ul' || tag === 'ol') {
        out.push(...walk(child, tag === 'ul' ? 'bulleted_list' : 'numbered_list'));
      } else if (tag === 'li') {
        const cb = child.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label > input[type=checkbox]') as HTMLInputElement | null;
        const textPart = child.cloneNode(true) as HTMLElement;
        textPart.querySelectorAll(':scope > ul, :scope > ol').forEach((x) => x.remove());
        const nested = Array.from(child.querySelectorAll(':scope > ul, :scope > ol'));
        const isTodo = !!cb || child.classList.contains('task-list-item') || listType === 'to_do' || child.closest('.to-do-list') !== null;
        const b: ParsedBlock = isTodo
          ? { type: 'to_do', title: trimRt(inlineFromHtml(textPart)), props: { checked: [[cb?.checked || child.querySelector('.checkbox-on') ? 'Yes' : 'No']] } }
          : { type: listType ?? 'bulleted_list', title: trimRt(inlineFromHtml(textPart)) };
        const kids: ParsedBlock[] = [];
        for (const n of nested) kids.push(...walk(n, n.tagName.toLowerCase() === 'ul' ? 'bulleted_list' : 'numbered_list'));
        if (kids.length) b.children = kids;
        out.push(b);
      } else if (tag === 'blockquote') {
        const inner = walk(child);
        if (inner.length <= 1) out.push({ type: 'quote', title: inner[0]?.title ?? trimRt(inlineFromHtml(child)) });
        else out.push({ type: 'quote', title: inner[0].title, children: inner.slice(1) });
      } else if (tag === 'pre') {
        const codeEl = child.querySelector('code');
        const lang = /language-([\w+#-]+)/.exec(codeEl?.className ?? child.className)?.[1] ?? '';
        out.push({ type: 'code', title: [[(child.textContent ?? '').replace(/\n$/, '')]], props: { language: [[codeLanguage(lang)]] } });
      } else if (tag === 'hr') out.push({ type: 'divider', title: [] });
      else if (tag === 'img' && child.getAttribute('src')) out.push({ type: 'image', title: [], props: { source: [[child.getAttribute('src')!]] }, format: { display_source: child.getAttribute('src')! } });
      else if (tag === 'figure') {
        const img = child.querySelector('img');
        if (img?.getAttribute('src')) out.push({ type: 'image', title: [], props: { source: [[img.getAttribute('src')!]] }, format: { display_source: img.getAttribute('src')! } });
        else out.push(...walk(child, listType));
      } else if (tag === 'details') {
        const summary = child.querySelector(':scope > summary');
        const rest = child.cloneNode(true) as HTMLElement;
        rest.querySelector(':scope > summary')?.remove();
        out.push({ type: 'toggle', title: summary ? trimRt(inlineFromHtml(summary)) : [], children: walk(rest) });
      } else if (tag === 'table') {
        for (const tr of Array.from(child.querySelectorAll('tr'))) {
          const cells = Array.from(tr.children).map((c) => (c.textContent ?? '').trim());
          if (cells.some(Boolean)) out.push({ type: 'text', title: [[cells.join('\t')]] });
        }
      } else if (tag === 'p' || !child.querySelector('p,div,ul,ol,h1,h2,h3,h4,h5,h6,pre,blockquote,hr,table,img,li')) {
        const t = trimRt(inlineFromHtml(child));
        if (length(t) || tag === 'p') out.push({ type: 'text', title: t });
      } else out.push(...walk(child, listType));
    }
    flushInline();
    return out;
  };
  const blocks = walk(doc.body);
 // drop empty paragraphs that only separated content
  return blocks.filter((b, i) => b.type !== 'text' || length(b.title) > 0 || (b.children?.length ?? 0) > 0 || (i > 0 && i < blocks.length - 1 && false));
}

// ------------------------------------------------------------------------------------------------
// blocks → clipboard

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function atomText(a: Annotation): string {
  switch (a[0]) {
    case 'p': {
      const b = records.get<BlockRecord>('block', a[1] as string);
      return toPlainText(b?.properties?.title) || 'Untitled';
    }
    case 'u': {
      const u = records.get<any>('lit_user', a[1] as string);
      return `@${u?.name || u?.email || 'Unknown'}`;
    }
    case 'g': {
      const space = records.get<any>('space', (a[2] as string | undefined) ?? '');
      const g = ((space?.settings?.groups ?? []) as { id: string; name?: string }[]).find((x) => x.id === a[1]);
      return `@${g?.name || 'Deleted group'}`;
    }
    case 'd':
      return `@${formatDateValue(a[1] as DateValue)}`;
    case 'e':
      return String(a[1]);
    case 'lm':
      return (a[1] as any)?.href ?? '';
    default:
      return '';
  }
}

export function richTextToHtml(rt: RichText): string {
  return rt.map((d) => {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => ['p', 'u', 'd', 'e', 'lm'].includes(a[0]));
    if (atom) {
      if (atom[0] === 'e') return `<span data-nc-equation="${escapeHtml(String(atom[1]))}">${escapeHtml(String(atom[1]))}</span>`;
      const data = escapeHtml(JSON.stringify(atom));
      if (atom[0] === 'p') return `<a href="${escapeHtml(location.origin + pageUrl(atom[1] as string))}" data-nc-mention="${data}">${escapeHtml(atomText(atom))}</a>`;
      if (atom[0] === 'lm') return `<a href="${escapeHtml(atomText(atom))}">${escapeHtml(atomText(atom))}</a>`;
      return `<span data-nc-mention="${data}">${escapeHtml(atomText(atom))}</span>`;
    }
    let s = escapeHtml(d[0]).replace(/\n/g, '<br>');
    for (const a of anns) {
      if (a[0] === 'b') s = `<strong>${s}</strong>`;
      else if (a[0] === 'i') s = `<em>${s}</em>`;
      else if (a[0] === '_') s = `<u>${s}</u>`;
      else if (a[0] === 's') s = `<s>${s}</s>`;
      else if (a[0] === 'c') s = `<code>${s}</code>`;
      else if (a[0] === 'a') s = `<a href="${escapeHtml(String(a[1]))}">${s}</a>`;
    }
    return s;
  }).join('');
}

function rtToMarkdown(rt: RichText): string {
  return rt.map((d) => {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => ['p', 'u', 'd', 'e', 'lm'].includes(a[0]));
    if (atom) {
      if (atom[0] === 'e') return `$$${atom[1]}$$`;
      if (atom[0] === 'p') return `[${atomText(atom)}](${location.origin}${pageUrl(atom[1] as string)})`;
      return atomText(atom);
    }
    let s = d[0];
    if (!s.trim()) return s;
    for (const a of anns) {
      if (a[0] === 'b') s = `**${s}**`;
      else if (a[0] === 'i') s = `*${s}*`;
      else if (a[0] === 'c') s = `\`${s}\``;
      else if (a[0] === 's') s = `~~${s}~~`;
      else if (a[0] === 'a') s = `[${s}](${a[1]})`;
    }
    return s;
  }).join('');
}

export function blockToMarkdown(b: ParsedBlock, depth: number, index = 1): string {
  const pad = '    '.repeat(depth);
  const t = rtToMarkdown(b.title);
  let line: string;
  switch (b.type) {
    case 'header': line = `# ${t}`; break;
    case 'sub_header': line = `## ${t}`; break;
    case 'sub_sub_header': line = `### ${t}`; break;
    case 'header_4': line = `#### ${t}`; break;
    case 'bulleted_list': line = `- ${t}`; break;
    case 'numbered_list': line = `${index}. ${t}`; break;
    case 'to_do': line = `- [${(b.props?.checked as any)?.[0]?.[0] === 'Yes' ? 'x' : ' '}] ${t}`; break;
    case 'toggle': line = `- ${t}`; break;
    case 'quote': line = `> ${t}`; break;
    case 'callout': line = `> ${t}`; break;
    case 'divider': line = '---'; break;
    case 'equation': line = `$$${toPlainText(b.title)}$$`; break;
    case 'code': line = '```' + ((b.props?.language as any)?.[0]?.[0] ?? '') + '\n' + toPlainText(b.title) + '\n```'; break;
    case 'image': line = `![](${(b.props?.source as any)?.[0]?.[0] ?? b.format?.display_source ?? ''})`; break;
    default: line = t;
  }
  let n = 0;
  const kids = (b.children ?? []).map((c) => blockToMarkdown(c, depth + 1, c.type === 'numbered_list' ? ++n : (n = 0, 1))).join('\n');
  return pad + line.replace(/\n/g, `\n${pad}`) + (kids ? '\n' + kids : '');
}

export function blocksToMarkdown(blocks: ParsedBlock[]): string {
  let n = 0;
  return blocks.map((b) => blockToMarkdown(b, 0, b.type === 'numbered_list' ? ++n : (n = 0, 1))).join('\n');
}

export function blocksToHtml(blocks: ParsedBlock[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const listTag = b.type === 'bulleted_list' || b.type === 'to_do' || b.type === 'toggle' ? 'ul' : b.type === 'numbered_list' ? 'ol' : null;
    if (listTag) {
      const items: string[] = [];
      while (i < blocks.length && (listTag === 'ol' ? blocks[i].type === 'numbered_list' : ['bulleted_list', 'to_do', 'toggle'].includes(blocks[i].type))) {
        const it = blocks[i];
        const check = it.type === 'to_do' ? `<input type="checkbox" disabled${(it.props?.checked as any)?.[0]?.[0] === 'Yes' ? ' checked' : ''}> ` : '';
        items.push(`<li>${check}${richTextToHtml(it.title)}${it.children?.length ? blocksToHtml(it.children) : ''}</li>`);
        i++;
      }
      out.push(`<${listTag}>${items.join('')}</${listTag}>`);
      continue;
    }
    const inner = richTextToHtml(b.title);
    const kids = b.children?.length ? blocksToHtml(b.children) : '';
    switch (b.type) {
      case 'header': out.push(`<h1>${inner}</h1>${kids}`); break;
      case 'sub_header': out.push(`<h2>${inner}</h2>${kids}`); break;
      case 'sub_sub_header': out.push(`<h3>${inner}</h3>${kids}`); break;
      case 'header_4': out.push(`<h4>${inner}</h4>${kids}`); break;
      case 'quote': case 'callout': out.push(`<blockquote>${inner}${kids}</blockquote>`); break;
      case 'divider': out.push('<hr>'); break;
      case 'code': out.push(`<pre><code class="language-${escapeHtml(((b.props?.language as any)?.[0]?.[0] ?? '').toLowerCase())}">${escapeHtml(toPlainText(b.title))}</code></pre>`); break;
      case 'image': out.push(`<img src="${escapeHtml((b.props?.source as any)?.[0]?.[0] ?? b.format?.display_source ?? '')}">`); break;
      case 'equation': out.push(`<p><span data-nc-equation="${escapeHtml(toPlainText(b.title))}">${escapeHtml(toPlainText(b.title))}</span></p>`); break;
      default: out.push(`<p>${inner || '<br>'}</p>${kids}`);
    }
    i++;
  }
  return out.join('');
}

function toParsed(id: string): ParsedBlock | null {
  const b = getBlock(id);
  if (!b || b.alive === false) return null;
  const { title, ...props } = (b.properties ?? {}) as Record<string, any>;
  return {
    type: b.type,
    title: (title as RichText) ?? [],
    props: Object.keys(props).length ? props : undefined,
    format: b.format,
    children: (b.type === 'page' ? [] : (b.content ?? []).map(toParsed).filter(Boolean)) as ParsedBlock[],
  };
}

function writeClipboard(e: ClipboardEvent | null, payload: { plain: string; html: string; json: string }) {
  if (e?.clipboardData) {
    e.clipboardData.setData('text/plain', payload.plain);
    e.clipboardData.setData('text/html', payload.html);
    e.clipboardData.setData(BLOCKS_MIME, payload.json);
    e.preventDefault();
    return;
  }
  try {
    void navigator.clipboard?.write([new ClipboardItem({ 'text/plain': new Blob([payload.plain], { type: 'text/plain' }), 'text/html': new Blob([payload.html], { type: 'text/html' }) })]);
  } catch {
    void navigator.clipboard?.writeText(payload.plain);
  }
}

/** Serialize selected blocks (block selection copy / cut). */
export function copyBlocks(ids: string[], e: ClipboardEvent | null) {
  const parsed = ids.map(toParsed).filter(Boolean) as ParsedBlock[];
 // `src`: the copied blocks themselves, for "Paste and mirror".
  writeClipboard(e, { plain: blocksToMarkdown(parsed), html: blocksToHtml(parsed), json: JSON.stringify({ v: 1, blocks: parsed, src: ids }) });
}

/** Copy of a text selection inside one leaf: the partial rich text as a single block. */
export function copyTextRange(blockId: string, property: string, start: number, end: number, e: ClipboardEvent) {
  const b = getBlock(blockId);
  const value = (property === 'title' ? titleOf(blockId) : ((b?.properties as any)?.[property] ?? [])) as RichText;
  const part = slice(value, start, end);
  const isCode = b?.type === 'code';
  const plain = isCode ? toPlainText(part) : rtToMarkdown(part);
  e.clipboardData?.setData('text/plain', plain);
  e.clipboardData?.setData('text/html', isCode ? `<code>${escapeHtml(toPlainText(part))}</code>` : richTextToHtml(part));
  e.clipboardData?.setData(BLOCKS_MIME, JSON.stringify({ v: 1, text: part }));
  e.preventDefault();
}

// ------------------------------------------------------------------------------------------------
// paste

function createTree(tx: any, blocks: ParsedBlock[], parentId: string, parentTable: any, after?: string): string[] {
  const ids: string[] = [];
  let prev = after;
  for (const b of blocks) {
    const id = newId();
    const props = b.type === 'to_do' && !b.props?.checked ? { ...(b.props ?? {}), checked: [['No']] } : b.props;
    createBlockIn(tx, { id, type: b.type, parentId, parentTable, after: prev, title: b.title, properties: props, format: b.format });
    if (b.children?.length) createTree(tx, b.children, id, 'block');
    ids.push(id);
    prev = id;
  }
  return ids;
}

/** Copied blocks that still exist (same workspace, alive): what "Paste and mirror" can sync to. */
function syncSources(internal: { src?: unknown } | null): string[] {
  const ids = Array.isArray(internal?.src) ? (internal!.src as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const blocks = ids.map((id) => getBlock(id));
  if (!ids.length || blocks.some((b) => !b || b.alive === false) || new Set(blocks.map((b) => b!.parent_id)).size !== 1) return [];
  return ids;
}

/** Block paste menu after pasting copied blocks: "Paste and mirror" turns the copy into a synced
 * block — the originals are wrapped in a synced block (unless they already are one) and the pasted blocks are
 * replaced by a synced copy of it. "Dismiss" keeps the plain copy. */
function offerPasteAndSync(srcIds: string[], pastedIds: string[]) {
  if (!srcIds.length || !pastedIds.length) return;
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${pastedIds[pastedIds.length - 1]}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    void import('../../components/Menu.tsx').then(({ openMenu }) => {
 // no backdrop: the page stays clickable; the next click elsewhere or a typed key dismisses the menu
      const close = openMenu(new DOMRect(r.left, r.bottom, 0, 0), {
        width: 240,
 initialActive: -1, // nothing highlighted: Enter / typing go on as usual until an action is picked
        sections: [{ title: 'Suggested actions', items: [
          { label: 'Paste and mirror', icon: 'blockSync', onSelect: () => pasteAndSync(srcIds, pastedIds) },
          { label: 'Dismiss', icon: 'close', onSelect: () => undefined },
        ] }],
      }, { placement: 'bottom-start', offset: 4, backdrop: 'none', onClose: () => off() });
      const onDown = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.('.lit-overlay-container')) close(); };
      const onKey = (e: KeyboardEvent) => { if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') close(); };
      const off = () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true); };
      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('keydown', onKey, true);
    });
  }, 30);
}

export function pasteAndSync(srcIds: string[], pastedIds: string[]) {
  const src = srcIds.map((id) => getBlock(id)).filter((b): b is BlockRecord => !!b && b.alive !== false);
  const anchor = getBlock(pastedIds[0]);
  if (!src.length || !anchor) return;
  const first = src[0];
  let containerId = first.type === 'transclusion_container' && src.length === 1 ? first.id : '';
  const refId = newId();
  run('blockPasteActions.createTransclusion', (tx) => {
    if (!containerId) {
      containerId = newId();
      createBlockIn(tx, { id: containerId, type: 'transclusion_container', parentId: first.parent_id, parentTable: first.parent_table as any, before: first.id });
      moveBlocksIn(tx, src.map((b) => b.id), { parentId: containerId, parentTable: 'block' });
    }
    createBlockIn(tx, {
      id: refId, type: 'transclusion_reference', parentId: anchor.parent_id, parentTable: anchor.parent_table as any, before: anchor.id,
      format: { transclusion_reference_pointer: { id: containerId, table: 'block', spaceId: first.space_id } } as any,
    });
    deleteBlocksIn(tx, pastedIds);
  });
  useEditor.getState().selectBlocks([refId], refId);
}

function readInternal(data: DataTransfer): { blocks?: ParsedBlock[]; text?: RichText; src?: string[] } | null {
  const raw = data.getData(BLOCKS_MIME);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return { blocks: v };
    return v;
  } catch {
    return null;
  }
}

const URL_RE = /^(https?:\/\/|mailto:)\S+$/i;

function imageFiles(data: DataTransfer): File[] {
  const out: File[] = [];
  for (const f of Array.from(data.files ?? [])) out.push(f);
  if (!out.length) for (const it of Array.from(data.items ?? [])) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); }
  return out;
}

/** Upload files and insert image/video/audio/pdf/file blocks after `afterId` (an empty text block is replaced). */
export async function insertFiles(files: File[], afterId: string | null, parent: { id: string; table: string }) {
  const spaceId = useSession.getState().spaceId ?? undefined;
  const target = afterId ? getBlock(afterId) : undefined;
  const replaceEmpty = !!target && target.type === 'text' && length(target.properties?.title as RichText | undefined) === 0 && !(target.content?.length);
  let prev = afterId ?? undefined;
  let first = true;
  for (const f of files) {
    const kind: BlockType = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : f.type === 'application/pdf' ? 'pdf' : 'file';
    let res: Awaited<ReturnType<typeof uploadFile>>;
    try {
      res = await uploadFile(f, f.name || `${kind}.${(f.type.split('/')[1] ?? 'bin').replace('jpeg', 'jpg')}`, spaceId, parent.table === 'block' ? parent.id : undefined);
    } catch (err) {
      useUI.getState().toast(`Upload failed: ${(err as Error).message}`);
      continue;
    }
    const props: Record<string, any> = { source: [[res.url]], ...(kind === 'file' || kind === 'pdf' ? { title: [[f.name || res.name]] } : {}) };
    const fmt = { display_source: res.url, file_name: res.name, file_size: res.size };
    run('paste.uploadFile', (tx) => {
      if (first && replaceEmpty && target) {
        tx.update('block', target.id, [], { type: kind });
        for (const [k, v] of Object.entries(props)) tx.set('block', target.id, ['properties', k], v);
        tx.update('block', target.id, ['format'], fmt);
        prev = target.id;
      } else {
        prev = createBlockIn(tx, { id: newId(), type: kind, parentId: parent.id, parentTable: parent.table as any, after: prev, properties: props, format: fmt });
      }
    });
    first = false;
  }
  if (prev) {
 // a trailing empty text block keeps typing flowing after pasted media
    useEditor.getState().selectBlocks([prev], prev);
  }
}

export function pasteIntoBlock(blockId: string, property: string, api: LeafApi, data: DataTransfer, opts?: { plain?: boolean }) {
  const sel = api.selection() ?? { start: 0, end: 0 };
  const value = api.value();
  const b = getBlock(blockId);
  if (!b) return;
  const isCode = b.type === 'code';
  const plain = data.getData('text/plain');
 // ⌘⇧V “paste without formatting”: only plain text, with no Markdown, link menu, or block structure parsing
  const plainOnly = !!opts?.plain;
  const html = plainOnly ? '' : data.getData('text/html');
  const internal = plainOnly ? null : readInternal(data);

 // images / files from the clipboard
  const files = plainOnly ? [] : imageFiles(data);
  if (files.length && !plain && !internal) {
    void insertFiles(files, blockId, { id: b.parent_id, table: b.parent_table });
    return;
  }

 // code blocks take plain text verbatim
  if (isCode) {
    const text = plain || (internal?.text ? toPlainText(internal.text) : '');
    let next = deleteRange(value, sel.start, sel.end);
    next = insertText(next, sel.start, text, []);
    commitText(blockId, property, next, sel.start + text.length, { coalesce: false, action: 'paste' });
    useEditor.getState().requestFocus(blockId, sel.start + text.length, { property });
    return;
  }

  const url = plainOnly ? '' : plain?.trim();
 // URL pasted over a selection → link it (ed-paste-url-on-selection)
  if (url && URL_RE.test(url) && sel.start !== sel.end && !internal) {
    void import('./inline/LinkPopups.tsx').then(({ linkSelectionWithUrl }) => linkSelectionWithUrl({ blockId, property, start: sel.start, end: sel.end }, url));
    return;
  }
 // bare URL at the caret → link + "Paste as" menu
  if (url && URL_RE.test(url) && !internal && property === 'title' && !html.includes('<img')) {
    void import('./inline/PasteMenu.tsx').then(({ pasteUrlWithMenu }) => pasteUrlWithMenu(blockId, property, sel.start, sel.end, url));
    return;
  }

  let blocks: ParsedBlock[] | null = null;
  let single: RichText | null = null;
  if (internal?.text) single = internal.text;
  else if (internal?.blocks) blocks = internal.blocks;
  else if (html && /<(p|h[1-6]|ul|ol|li|pre|blockquote|div|br|table|strong|b|em|i|a|span|code)[\s>]/i.test(html)) blocks = htmlToBlocks(html);
  else if (plain && plainOnly) blocks = plain.replace(/\r\n?/g, '\n').split('\n').map((line) => ({ type: 'text' as BlockType, title: line ? [[line]] as RichText : [] }));
  else if (plain) blocks = markdownToBlocks(plain);

 // copied blocks pasted into an empty text block: they replace it as standalone blocks, with "Paste and mirror"
 // (also for a single copied paragraph — a block copy, not a text copy)
  const sources = internal?.blocks ? syncSources(internal) : [];
  const syncPaste = sources.length > 0 && property === 'title' && b.type === 'text' && length(value) === 0 && !(b.content?.length) && !!blocks?.length;
  if (!syncPaste && blocks && blocks.length === 1 && TEXT_BLOCKS.has(blocks[0].type) && !blocks[0].children?.length && blocks[0].type === 'text') single = blocks[0].title;
  if (property !== 'title' && blocks) single = blocks.flatMap((x, i) => (i ? [['\n'] as [string], ...x.title] : x.title));

  if (single || !blocks || !blocks.length) {
    const ins: RichText = single ?? [[plain.replace(/\r?\n/g, property === 'title' ? '\n' : '\n')]];
    let next = deleteRange(value, sel.start, sel.end);
    const caret = sel.start + length(ins);
    next = ins.length === 1 && !ins[0][1] ? insertText(next, sel.start, ins[0][0], annotationsAt(value, sel.start)) : insertRich(next, sel.start, ins);
    commitText(blockId, property, next, caret, { coalesce: false, action: 'paste' });
    useEditor.getState().requestFocus(blockId, caret, { property });
    return;
  }

  if (syncPaste && blocks) {
    let pasted: string[] = [];
    run('paste', (tx) => {
      pasted = createTree(tx, blocks!, b.parent_id, b.parent_table, blockId);
      deleteBlocksIn(tx, [blockId]);
    });
    if (pasted.length) useEditor.getState().selectBlocks(pasted, pasted[0]);
    offerPasteAndSync(sources, pasted);
    return;
  }

 // multi-block paste: the first block merges into the caret position, the rest follow;
 // text after the caret moves to the end of the last pasted text block
  const before = slice(titleOf(blockId), 0, sel.start);
  const after = slice(titleOf(blockId), sel.end);
  const [first, ...rest] = blocks;
  let lastId = blockId;
  let caretBlock = blockId;
  let caretOffset = 0;
  run('paste', (tx) => {
    const firstIsText = TEXT_BLOCKS.has(first.type) && first.type !== 'code';
    let restBlocks = rest;
    if (firstIsText) {
      setTitle(tx, blockId, [...before, ...first.title]);
      if (length(before) === 0 && first.type !== b.type && b.type === 'text') {
        tx.update('block', blockId, [], { type: first.type });
        if (first.props) for (const [k, v] of Object.entries(first.props)) tx.set('block', blockId, ['properties', k], v);
        if (first.format) tx.update('block', blockId, ['format'], first.format);
      }
      if (first.children?.length) createTree(tx, first.children, blockId, 'block');
      caretOffset = length(before) + length(first.title);
    } else {
      setTitle(tx, blockId, before);
      restBlocks = blocks!;
    }
    const ids = createTree(tx, restBlocks, b.parent_id, b.parent_table, blockId);
    lastId = ids[ids.length - 1] ?? blockId;
    const last = restBlocks[restBlocks.length - 1];
    if (ids.length && last && TEXT_BLOCKS.has(last.type) && last.type !== 'code') {
      caretBlock = lastId;
      caretOffset = length(last.title);
      if (length(after)) setTitle(tx, lastId, [...last.title, ...after]);
    } else if (length(after)) {
 // non-text last block: the remainder becomes its own text block
      const tailId = newId();
      createBlockIn(tx, { id: tailId, type: 'text', parentId: b.parent_id, parentTable: b.parent_table as any, after: lastId, title: after });
      caretBlock = tailId;
      caretOffset = 0;
    } else if (ids.length) {
      caretBlock = lastId;
      caretOffset = last && TEXT_BLOCKS.has(last.type) ? length(last.title) : 0;
    }
  });
  const cb = getBlock(caretBlock);
  if (cb && TEXT_BLOCKS.has(cb.type)) useEditor.getState().requestFocus(caretBlock, caretOffset);
  else useEditor.getState().selectBlocks([caretBlock], caretBlock);
}

/** Paste while blocks are selected (block selection mode): insert after the last selected block. */
export function pasteAfterBlocks(ids: string[], data: DataTransfer) {
  const last = getBlock(ids[ids.length - 1]);
  if (!last) return;
  const internal = readInternal(data);
  const files = imageFiles(data);
  if (files.length && !internal && !data.getData('text/plain')) {
    void insertFiles(files, last.id, { id: last.parent_id, table: last.parent_table });
    return;
  }
  const html = data.getData('text/html');
  const plain = data.getData('text/plain');
  const blocks = internal?.blocks ?? (internal?.text ? [{ type: 'text' as BlockType, title: internal.text }] : html ? htmlToBlocks(html) : plain ? markdownToBlocks(plain) : []);
  if (!blocks.length) return;
  let ids2: string[] = [];
  run('paste', (tx) => { ids2 = createTree(tx, blocks, last.parent_id, last.parent_table, last.id); });
  if (ids2.length) useEditor.getState().selectBlocks(ids2, ids2[0]);
  if (internal?.blocks) offerPasteAndSync(syncSources(internal), ids2);
}
