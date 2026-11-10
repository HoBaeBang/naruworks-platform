// Page export and "Copy page contents".
// The Export dialog first asks the server (`api('startPageExport')`, apps/server/src/api/modules/export.ts) and falls
// back to this client-side exporter when that endpoint is absent:
// Markdown & CSV / HTML (zip when subpages are included) and PDF via the browser's print-to-PDF.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, UserRecord } from '@nc/shared/records.ts';
import { annotationsOf, toPlainText, type Annotation, type DateValue, type RichText } from '@nc/shared/richtext.ts';
import { safeHref } from '@nc/shared/url.ts';
import { getBlock } from '../../lib/blocks.ts';
import { api, ApiError } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { loadPage } from './usePageLoader.ts';

export type ExportFormat = 'markdown' | 'html' | 'pdf';
export interface ExportOptions {
  format: ExportFormat;
  includeContents: 'everything' | 'no_files';
  includeSubpages: boolean;
  createFolders: boolean;
  databaseView: 'currentView' | 'defaultView';
  includeComments?: boolean;
  pageFormat?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';
  scale?: number;
}

const PAGE = new Set(['page', 'collection_view_page']);

// ------------------------------------------------------------------ rich text

function atomText(a: Annotation): string {
  if (a[0] === 'p') return pageTitle(getBlock(a[1] as string)) || 'Untitled';
  if (a[0] === 'u') {
    const u = records.get<UserRecord>('lit_user', a[1] as string);
    return `@${u?.name || u?.email || 'Unknown'}`;
  }
  if (a[0] === 'd') {
    const v = a[1] as DateValue;
    return `@${v.start_date}${v.start_time ? ` ${v.start_time}` : ''}${v.end_date ? ` → ${v.end_date}` : ''}`;
  }
  if (a[0] === 'e') return `$${a[1]}$`;
  return '';
}

export function pageTitle(b: BlockRecord | undefined): string {
  if (!b) return '';
  if (b.type === 'collection_view_page' || b.type === 'collection_view') {
    const t = toPlainText(records.get<CollectionRecord>('collection', b.collection_id)?.name as RichText | undefined);
    if (t) return t;
  }
  return toPlainText(b.properties?.title);
}

export function richToMarkdown(rt: RichText | undefined): string {
  let out = '';
  for (const d of rt ?? []) {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => a[0] === 'p' || a[0] === 'u' || a[0] === 'd' || a[0] === 'e');
    let s = atom ? atomText(atom) : d[0];
    if (!atom) {
      if (anns.some((a) => a[0] === 'c')) s = `\`${s}\``;
      if (anns.some((a) => a[0] === 'b')) s = `**${s}**`;
      if (anns.some((a) => a[0] === 'i')) s = `*${s}*`;
      if (anns.some((a) => a[0] === 's')) s = `~~${s}~~`;
    }
    const link = anns.find((a) => a[0] === 'a');
    if (link) s = `[${s}](${link[1]})`;
    else if (atom?.[0] === 'p') s = `[${s}](${encodeURI(pageTitle(getBlock(atom[1] as string)) || 'Untitled')}.md)`;
    out += s;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function richToHtml(rt: RichText | undefined): string {
  let out = '';
  for (const d of rt ?? []) {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => a[0] === 'p' || a[0] === 'u' || a[0] === 'd' || a[0] === 'e');
    let s = esc(atom ? atomText(atom) : d[0]).replace(/\n/g, '<br>');
    if (anns.some((a) => a[0] === 'c')) s = `<code>${s}</code>`;
    if (anns.some((a) => a[0] === 'b')) s = `<strong>${s}</strong>`;
    if (anns.some((a) => a[0] === 'i')) s = `<em>${s}</em>`;
    if (anns.some((a) => a[0] === '_')) s = `<span style="border-bottom:0.05em solid">${s}</span>`;
    if (anns.some((a) => a[0] === 's')) s = `<s>${s}</s>`;
    const color = anns.find((a) => a[0] === 'h');
    if (color) s = `<mark class="highlight-${esc(String(color[1]))}">${s}</mark>`;
    const link = anns.find((a) => a[0] === 'a');
    // the PDF print view is written into a same-origin window: links keep only safe schemes
    const href = link ? safeHref(link[1]) : null;
    if (href) s = `<a href="${esc(href)}">${s}</a>`;
    out += s;
  }
  return out;
}

// ------------------------------------------------------------------ blocks

interface Ctx {
  opts: ExportOptions;
  files: Map<string, string>;
  /** path of the page being written (for relative subpage links) */
  dir: string;
  seen: Set<string>;
}

function src(b: BlockRecord): string {
  return toPlainText(b.properties?.source as RichText | undefined) || (b.format?.display_source as string) || '';
}

function blockMd(b: BlockRecord, depth: number, ctx: Ctx, num: number): string {
  const pad = '    '.repeat(depth);
  const t = richToMarkdown(b.properties?.title as RichText | undefined);
  const kids = () => (b.content ?? []).map((id) => getBlock(id)).filter((c): c is BlockRecord => !!c && c.alive);
  const childMd = (d = depth + 1) => {
    let n = 0;
    return kids().map((c) => blockMd(c, d, ctx, c.type === 'numbered_list' ? ++n : (n = 0))).filter(Boolean).join('\n');
  };
  let line: string;
  switch (b.type) {
    case 'header': line = `# ${t}`; break;
    case 'sub_header': line = `## ${t}`; break;
    case 'sub_sub_header': line = `### ${t}`; break;
    case 'header_4': line = `#### ${t}`; break;
    case 'bulleted_list': line = `- ${t}`; break;
    case 'numbered_list': line = `${num || 1}. ${t}`; break;
    case 'to_do': line = `- [${toPlainText(b.properties?.checked as RichText | undefined) === 'Yes' ? 'x' : ' '}] ${t}`; break;
    case 'toggle': line = `- ${t}`; break;
    case 'quote': line = `> ${t}`; break;
    case 'callout': line = `> ${typeof b.format?.page_icon === 'string' && !b.format.page_icon.startsWith('lit-icon') ? `${b.format.page_icon} ` : ''}${t}`; break;
    case 'divider': line = '---'; break;
    case 'code': return `${pad}\`\`\`${toPlainText(b.properties?.language as RichText | undefined).toLowerCase()}\n${toPlainText(b.properties?.title)}\n${pad}\`\`\``;
    case 'equation': line = `$$\n${toPlainText(b.properties?.title)}\n$$`; break;
    case 'image': line = ctx.opts.includeContents === 'no_files' ? '' : `![${toPlainText(b.properties?.caption as RichText | undefined)}](${src(b)})`; break;
    case 'video': case 'audio': case 'file': case 'pdf': case 'embed': case 'bookmark':
      line = ctx.opts.includeContents === 'no_files' && b.type !== 'bookmark' && b.type !== 'embed' ? '' : `[${toPlainText(b.properties?.title) || src(b)}](${src(b)})`; break;
    case 'page': case 'collection_view_page': {
      const title = pageTitle(b) || 'Untitled';
      if (ctx.opts.includeSubpages && !ctx.seen.has(b.id)) writePage(b, ctx);
      line = `[${title}](${encodeURI(ctx.opts.createFolders ? `${safe(pageTitle(getBlock(b.parent_id)) || 'Untitled')}/${safe(title)}.md` : `${safe(title)}.md`)})`;
      return pad + line;
    }
    case 'collection_view': {
      line = `${pageTitle(b)}`;
      if (ctx.opts.includeSubpages || true) ctx.files.set(`${ctx.dir}${safe(pageTitle(b) || 'Untitled')}.csv`, collectionCsv(b, ctx.opts));
      line = `[${pageTitle(b) || 'Untitled'}](${encodeURI(`${safe(pageTitle(b) || 'Untitled')}.csv`)})`;
      break;
    }
    case 'table': {
      const rows = kids();
      const order = (b.format?.table_block_column_order as string[] | undefined) ?? Object.keys(rows[0]?.properties ?? {});
      const cells = rows.map((r) => order.map((k) => richToMarkdown(r.properties?.[k] as RichText | undefined).replace(/\|/g, '\\|')));
      if (!cells.length) return '';
      const head = cells[0];
      return [head, head.map(() => '---'), ...cells.slice(1)].map((r) => `${pad}| ${r.join(' | ')} |`).join('\n');
    }
    case 'column_list': case 'column': case 'transclusion_container': case 'tabs': case 'tab':
      return childMd(depth);
    case 'table_of_contents': case 'breadcrumb': return '';
    default: line = t;
  }
  const nested = b.content?.length ? childMd() : '';
  return [line ? pad + line : '', nested].filter(Boolean).join('\n');
}

function blocksMd(ids: string[] | undefined, ctx: Ctx): string {
  let n = 0;
  return (ids ?? [])
    .map((id) => getBlock(id))
    .filter((b): b is BlockRecord => !!b && b.alive)
    .map((b) => blockMd(b, 0, ctx, b.type === 'numbered_list' ? ++n : (n = 0)))
    .filter((s) => s !== '')
    .join('\n\n');
}

function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|#%]+/g, ' ').trim().slice(0, 80) || 'Untitled';
}

function cellText(v: any, schema: any): string {
  if (!v) return '';
  const rt = v as RichText;
  if (schema?.type === 'checkbox') return toPlainText(rt) === 'Yes' ? 'Yes' : 'No';
  let out = '';
  for (const d of rt) {
    const atom = annotationsOf(d).find((a) => a[0] === 'p' || a[0] === 'u' || a[0] === 'd');
    out += atom ? atomText(atom).replace(/^@/, '') : d[0];
  }
  return out;
}

export function collectionCsv(b: BlockRecord, opts: Pick<ExportOptions, 'databaseView'>): string {
  const col = records.get<CollectionRecord>('collection', b.collection_id);
  if (!col) return '';
  const viewId = b.view_ids?.[0];
  const view = records.get<CollectionViewRecord>('collection_view', viewId);
  void opts;
  const props = Object.entries(col.schema).sort((x, y) => (x[0] === 'title' ? -1 : y[0] === 'title' ? 1 : 0));
  const rows = records.all<BlockRecord>('block').filter((r) => r.parent_table === 'collection' && r.parent_id === col.id && r.alive);
  const order = view?.page_sort ?? [];
  rows.sort((x, y) => (order.indexOf(x.id) >>> 0) - (order.indexOf(y.id) >>> 0));
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = props.map(([, s]) => q(s.name));
  const lines = rows.map((r) => props.map(([k, s]) => {
    if (s.type === 'created_time') return q(new Date(r.created_time).toISOString());
    if (s.type === 'last_edited_time') return q(new Date(r.last_edited_time).toISOString());
    return q(cellText(r.properties?.[k], s));
  }).join(','));
  return [head.join(','), ...lines].join('\n');
}

function writePage(page: BlockRecord, ctx: Ctx) {
  ctx.seen.add(page.id);
  const title = pageTitle(page) || 'Untitled';
  const parentDir = ctx.dir;
  const name = safe(title);
  if (page.type === 'collection_view_page') {
    ctx.files.set(`${parentDir}${name}.csv`, collectionCsv(page, ctx.opts));
    return;
  }
  const childCtx: Ctx = { ...ctx, dir: ctx.opts.createFolders ? `${parentDir}${name}/` : parentDir };
  const body = blocksMd(page.content, childCtx);
  const icon = typeof page.format?.page_icon === 'string' && !page.format.page_icon.startsWith('lit-icon') && !page.format.page_icon.startsWith('/') && !page.format.page_icon.startsWith('http') ? `${page.format.page_icon} ` : '';
  ctx.files.set(`${parentDir}${name}.md`, `# ${icon}${title}\n\n${body}\n`);
}

/** Markdown of one page (no subpage files) — "Copy page contents". */
export function pageToMarkdown(pageId: string): string {
  const page = getBlock(pageId);
  if (!page) return '';
  const ctx: Ctx = { opts: { format: 'markdown', includeContents: 'everything', includeSubpages: false, createFolders: false, databaseView: 'currentView' }, files: new Map(), dir: '', seen: new Set([pageId]) };
  return `# ${pageTitle(page) || 'Untitled'}\n\n${blocksMd(page.content, ctx)}\n`;
}

// ------------------------------------------------------------------ HTML

function blockHtml(b: BlockRecord, ctx: Ctx): string {
  const t = richToHtml(b.properties?.title as RichText | undefined);
  const kids = (b.content ?? []).map((id) => getBlock(id)).filter((c): c is BlockRecord => !!c && c.alive);
  const inner = () => groupLists(kids, ctx);
  const color = b.format?.block_color ? ` block-color-${esc(String(b.format.block_color))}` : '';
  switch (b.type) {
    case 'header': return `<h1 id="${b.id}" class="${color}">${t}</h1>${kids.length ? inner() : ''}`;
    case 'sub_header': return `<h2 id="${b.id}" class="${color}">${t}</h2>${kids.length ? inner() : ''}`;
    case 'sub_sub_header': case 'header_4': return `<h3 id="${b.id}" class="${color}">${t}</h3>${kids.length ? inner() : ''}`;
    case 'bulleted_list': case 'numbered_list': return `<li class="${color}">${t}${kids.length ? inner() : ''}</li>`;
    case 'to_do': {
      const done = toPlainText(b.properties?.checked as RichText | undefined) === 'Yes';
      return `<ul class="to-do-list"><li><div class="checkbox ${done ? 'checkbox-on' : 'checkbox-off'}"></div><span class="${done ? 'to-do-children-checked' : ''}">${t}</span>${kids.length ? inner() : ''}</li></ul>`;
    }
    case 'toggle': return `<details open class="${color}"><summary>${t}</summary>${inner()}</details>`;
    case 'quote': return `<blockquote class="${color}">${t}${kids.length ? inner() : ''}</blockquote>`;
    case 'callout': return `<figure class="callout${color}"><div class="callout-icon">${esc(typeof b.format?.page_icon === 'string' && !b.format.page_icon.startsWith('lit-icon') ? b.format.page_icon : '💡')}</div><div>${t}${inner()}</div></figure>`;
    case 'divider': return '<hr>';
    case 'code': return `<pre class="code"><code>${esc(toPlainText(b.properties?.title))}</code></pre>`;
    case 'equation': return `<figure class="equation">${esc(toPlainText(b.properties?.title))}</figure>`;
    case 'image': return ctx.opts.includeContents === 'no_files' ? '' : `<figure class="image"><img src="${esc(src(b))}" style="max-width:100%">${b.properties?.caption ? `<figcaption>${richToHtml(b.properties.caption as RichText)}</figcaption>` : ''}</figure>`;
    case 'video': case 'audio': case 'file': case 'pdf': case 'embed': case 'bookmark':
      return `<figure>${safeHref(src(b)) ? `<a href="${esc(safeHref(src(b))!)}">` : '<span>'}${esc(toPlainText(b.properties?.title) || src(b))}${safeHref(src(b)) ? '</a>' : '</span>'}</figure>`;
    case 'page': case 'collection_view_page': {
      const title = pageTitle(b) || 'Untitled';
      if (ctx.opts.includeSubpages && !ctx.seen.has(b.id)) writeHtmlPage(b, ctx);
      return `<figure class="link-to-page"><a href="${encodeURI(`${ctx.opts.createFolders ? `${safe(pageTitle(getBlock(b.parent_id)) || 'Untitled')}/` : ''}${safe(title)}.html`)}">${esc(title)}</a></figure>`;
    }
    case 'collection_view': {
      const csv = collectionCsv(b, ctx.opts).split('\n').map((l) => l.split(','));
      return `<h4>${esc(pageTitle(b))}</h4><table class="collection-content">${csv.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table>`;
    }
    case 'table': {
      const order = (b.format?.table_block_column_order as string[] | undefined) ?? Object.keys(kids[0]?.properties ?? {});
      return `<table class="simple-table">${kids.map((r) => `<tr>${order.map((k) => `<td>${richToHtml(r.properties?.[k] as RichText | undefined)}</td>`).join('')}</tr>`).join('')}</table>`;
    }
    case 'column_list': return `<div class="column-list">${kids.map((c) => `<div class="column">${groupLists((c.content ?? []).map((id) => getBlock(id)).filter((x): x is BlockRecord => !!x && x.alive), ctx)}</div>`).join('')}</div>`;
    case 'column': case 'transclusion_container': case 'tabs': case 'tab': return inner();
    case 'table_of_contents': case 'breadcrumb': return '';
    default: return `<p class="${color}">${t}</p>${kids.length ? `<div class="indented">${inner()}</div>` : ''}`;
  }
}

function groupLists(blocks: BlockRecord[], ctx: Ctx): string {
  let out = '';
  let open: 'ul' | 'ol' | null = null;
  for (const b of blocks) {
    const tag = b.type === 'bulleted_list' ? 'ul' : b.type === 'numbered_list' ? 'ol' : null;
    if (tag !== open) {
      if (open) out += `</${open}>`;
      if (tag) out += `<${tag}>`;
      open = tag;
    }
    out += blockHtml(b, ctx);
  }
  if (open) out += `</${open}>`;
  return out;
}

const HTML_CSS = `
body{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif;line-height:1.5;color:rgb(63, 63, 70);max-width:900px;margin:2em auto;padding:0 2em;white-space:pre-wrap}
h1.page-title{font-size:2.5rem;margin:.2em 0 .6em}h1{font-size:1.875rem;margin:1.2em 0 .2em}h2{font-size:1.5rem;margin:1.1em 0 .2em}h3{font-size:1.25rem;margin:1em 0 .2em}
p{margin:.25em 0}blockquote{border-left:3px solid currentcolor;padding-left:.9em;margin:.4em 0}code{background:rgba(161, 161, 170, 0.15);border-radius:4px;padding:.2em .4em;font-size:85%;color:#eb5757}
pre.code{background:rgb(9, 9, 11);padding:2em;border-radius:4px;white-space:pre-wrap}pre.code code{background:none;color:inherit;padding:0}
figure{margin:.5em 0}figure.callout{display:flex;gap:.6em;background:rgb(212, 212, 216);border-radius:4px;padding:1em}hr{border:0;border-top:1px solid rgba(63, 63, 70, 0.09)}
table{border-collapse:collapse}td,th{border:1px solid rgba(63, 63, 70, 0.09);padding:.25em .5em;text-align:left;vertical-align:top}.column-list{display:flex;gap:1em}.column{flex:1}
.to-do-list{list-style:none;padding-left:0}.checkbox{display:inline-block;width:.9em;height:.9em;border:1px solid #3f3f46;margin-right:.5em;vertical-align:-.1em}.checkbox-on{background:#818cf8;border-color:#818cf8}.to-do-children-checked{text-decoration:line-through;opacity:.4}
mark{background:transparent}.page-cover-image{width:100%;max-height:30vh;object-fit:cover;display:block;margin-bottom:1em}.page-header-icon{font-size:78px;line-height:1}
@media print{body{margin:0;max-width:none}}`;

function htmlDoc(page: BlockRecord, body: string, opts: ExportOptions): string {
  const title = pageTitle(page) || 'Untitled';
  const cover = page.format?.page_cover as string | undefined;
  const icon = typeof page.format?.page_icon === 'string' && !page.format.page_icon.startsWith('lit-icon') && !/^(https?:|\/)/.test(page.format.page_icon) ? page.format.page_icon : '';
  const font = page.format?.page_font === 'serif' ? 'font-family:Georgia,serif;' : page.format?.page_font === 'mono' ? 'font-family:Menlo,Courier,monospace;' : '';
  const pdf = opts.format === 'pdf' ? `@page{size:${opts.pageFormat ?? 'A4'};margin:20mm}body{zoom:${(opts.scale ?? 100) / 100}}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${HTML_CSS}${pdf}</style></head><body${font ? ` style="${font}"` : ''}><article class="page sans">` +
    `<header>${cover && /^(https?:|\/)/.test(cover) ? `<img class="page-cover-image" src="${esc(cover.startsWith('/') ? location.origin + cover : cover)}">` : ''}${icon ? `<div class="page-header-icon">${esc(icon)}</div>` : ''}<h1 class="page-title">${esc(title)}</h1></header>` +
    `<div class="page-body">${body}</div></article></body></html>`;
}

function writeHtmlPage(page: BlockRecord, ctx: Ctx) {
  ctx.seen.add(page.id);
  const name = safe(pageTitle(page) || 'Untitled');
  const childCtx: Ctx = { ...ctx, dir: ctx.opts.createFolders ? `${ctx.dir}${name}/` : ctx.dir };
  const body = page.type === 'collection_view_page' ? blockHtml({ ...page, type: 'collection_view' } as BlockRecord, childCtx) : groupLists((page.content ?? []).map((id) => getBlock(id)).filter((b): b is BlockRecord => !!b && b.alive), childCtx);
  ctx.files.set(`${ctx.dir}${name}.html`, htmlDoc(page, body, ctx.opts));
}

export function pageToHtml(pageId: string, opts: ExportOptions): string {
  const page = getBlock(pageId);
  if (!page) return '';
  const ctx: Ctx = { opts: { ...opts, includeSubpages: false }, files: new Map(), dir: '', seen: new Set([pageId]) };
  const body = groupLists((page.content ?? []).map((id) => getBlock(id)).filter((b): b is BlockRecord => !!b && b.alive), ctx);
  return htmlDoc(page, body, opts);
}

// ------------------------------------------------------------------ zip (store, no compression)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: Map<string, string>): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text);
    const fname = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, fname.length, true);
    parts.push(new Uint8Array(local.buffer), fname, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, fname.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), fname);
    offset += 30 + fname.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.size, true);
  end.setUint16(10, files.size, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function loadTree(pageId: string, depth = 0, seen = new Set<string>()) {
  if (seen.has(pageId) || depth > 6 || seen.size > 200) return;
  seen.add(pageId);
  await loadPage(pageId);
  const walk = async (id: string) => {
    const b = getBlock(id);
    if (!b || !b.alive) return;
    if (id !== pageId && PAGE.has(b.type)) {
      await loadTree(id, depth + 1, seen);
      return;
    }
    for (const c of b.content ?? []) await walk(c);
  };
  await walk(pageId);
}

/** Client-side export; returns the downloaded file name. */
export async function exportLocally(pageId: string, opts: ExportOptions): Promise<string> {
  if (opts.includeSubpages) await loadTree(pageId);
  else await loadPage(pageId);
  const page = getBlock(pageId);
  if (!page) throw new Error('Page could not be found');
  const title = safe(pageTitle(page) || 'Untitled');
  if (opts.format === 'pdf') {
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups to export as PDF');
    w.document.write(pageToHtml(pageId, opts));
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
    return `${title}.pdf`;
  }
  const ctx: Ctx = { opts, files: new Map(), dir: '', seen: new Set() };
  if (opts.format === 'html') writeHtmlPage(page, ctx);
  else writePage(page, ctx);
  if (ctx.files.size === 1) {
    const [[name, text]] = [...ctx.files.entries()];
    const file = name.split('/').pop()!;
    download(new Blob([text], { type: opts.format === 'html' ? 'text/html' : name.endsWith('.csv') ? 'text/csv' : 'text/markdown' }), file);
    return file;
  }
  const zipName = `Export-${title}.zip`;
  download(makeZip(ctx.files), zipName);
  return zipName;
}

/** Database view each database currently shows on this device (DatabaseView keeps it in `nc:activeView:<blockId>`):
 *  "Current view" exports follow it. */
export function currentDatabaseViews(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length && Object.keys(out).length < 500; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('nc:activeView:')) continue;
      const v = localStorage.getItem(k);
      if (v) out[k.slice('nc:activeView:'.length)] = v;
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

/** Open the server's print view (PDF): a new tab that opens the browser's print dialog ("Save as PDF"). */
function openPrintView(url: string) {
  const w = window.open(url, '_blank');
  if (w) w.opener = null;
  else useUI.getState().toast('Allow pop-ups to export as PDF', { label: 'Open', run: () => { window.open(url, '_blank'); } });
}

/** Export through the server (`startPageExport`) when available, else locally. */
export async function exportPage(pageId: string, opts: ExportOptions = { format: 'markdown', includeContents: 'everything', includeSubpages: false, createFolders: true, databaseView: 'currentView' }): Promise<string> {
  const page = getBlock(pageId);
  try {
    const res = await api('startPageExport', {
      block: { id: pageId, spaceId: page?.space_id ?? useSession.getState().spaceId },
      recursive: opts.includeSubpages,
      exportOptions: {
        exportType: opts.format, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language,
        includeContents: opts.includeContents, flattenExportFiletree: !opts.createFolders,
        collectionViewExportType: opts.databaseView === 'currentView' ? 'currently_selected' : 'all',
        currentViews: opts.databaseView === 'currentView' ? currentDatabaseViews() : undefined,
        pdfFormat: opts.pageFormat, pdfScale: opts.scale, includeComments: opts.includeComments,
      },
    });
    if (res?.printUrl) {
      openPrintView(res.printUrl);
      return res.fileName ?? 'Export.pdf';
    }
    // very large exports arrive in the Inbox
    if (res?.deferred) {
      useUI.getState().toast(res.message ?? 'This export is still processing because of its size. We’ll email you a download link when it is ready.');
      return '';
    }
    const url = res?.exportURL ?? res?.url ?? res?.status?.exportURL;
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.download = res?.fileName ?? '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return res?.fileName ?? url.split('/').pop();
    }
    if (res?.taskId) {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const st = await api('getJobStatus', { taskIds: [res.taskId] });
        const task = st?.results?.[0];
        const u = task?.status?.exportURL;
        if (u) {
          window.location.assign(u);
          return u.split('/').pop();
        }
        if (task?.state === 'failure') throw new Error(task?.error ?? 'Export failed');
      }
    }
    if (res?.content && res?.fileName) {
      download(new Blob([res.content], { type: res.mime ?? 'application/octet-stream' }), res.fileName);
      return res.fileName;
    }
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 501)) throw e;
  }
  return exportLocally(pageId, opts);
}
