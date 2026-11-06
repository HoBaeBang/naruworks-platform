// Export renderers: page tree → Markdown / HTML (the export layout: "Title <id>.md" + "Title <id>/" folder for
// sub-pages, databases as "Name <id>.csv" with row pages), plus print-ready HTML for "PDF".
import { compactId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, CommentRecord, DiscussionRecord, PropertySchema, SpaceRecord } from '@nc/shared/records.ts';
import type { Annotation, RichText } from '@nc/shared/richtext.ts';
import { annotationsOf, toPlainText } from '@nc/shared/richtext.ts';
import { dateValueToRange, formatDateRange } from '@nc/shared/database/dates.ts';
import { formatPropertyValue, getPropertyValue } from '@nc/shared/database/values.ts';
import { runQuery } from '@nc/shared/database/query.ts';
import { propertiesKeyFor } from '@nc/shared/database/schema.ts';
import type { QueryContext } from '@nc/shared/database/types.ts';
import { isArchivedRecord } from '@nc/shared/archive.ts';
import { safeHref } from '@nc/shared/url.ts';
import { canSeePropertyValues, groupIdsOf, propertyRoleFor } from '@nc/shared/database/propertyAccess.ts';
import { getRecord } from '../db.ts';
import { childBlocks } from '../tree.ts';
import { viewerQueryContext } from '../queryctx.ts';
import { blockRole } from '../records.ts';
import { toCsv } from './csv.ts';

export type ExportFormat = 'markdown' | 'html' | 'pdf';

/** Export dialog › PDF › Page format (CSS @page sizes; Tabloid = 11×17 in). */
export const PDF_PAGE_SIZES: Record<string, string> = { A4: 'A4', A3: 'A3', Letter: 'letter', Legal: 'legal', Tabloid: '11in 17in' };

export interface ExportOptions {
  format: ExportFormat;
  includeSubpages: boolean;
  includeFiles: boolean;
  /** the exporting user: every record reached through content, pointers, mentions or relations is read as them */
  userId: string;
  /** permission check for each page/database visited */
  canRead: (blockId: string) => boolean;
  /** read an uploaded file (/files/<id>/<name>) for includeFiles */
  readUpload?: (url: string) => { name: string; data: Buffer } | null;
  /** HTML › Export comments: page discussions under the title, block threads after their block (open and resolved) */
  includeComments?: boolean;
  /**
   * Database views: 'current' = the view each database shows the exporting user (`currentViews[blockId]`, else its
   * first view) with that view's filters, sorts and visible properties; 'default' (`all`) = every row and
   * every property. Form and dashboard views have no rows to export: the first table-like view is used instead.
   */
  databaseView?: 'current' | 'default';
  currentViews?: Record<string, string>;
  /** PDF › Page format / Scale percent */
  pdf?: { format?: string; scale?: number };
  /** IANA time zone for comment timestamps (the exporting browser's) */
  timeZone?: string;
}

export interface ExportFile {
  path: string;
  data: string | Buffer;
}

// Query context of the running export (exportTree is synchronous, so one module-level slot is enough). Lookups go
// through the exporting user's permissions; outside an export nothing resolves.
let ctx: QueryContext & { canRead(blockId: string | undefined): boolean } = { canRead: () => false, getRecord: () => undefined, rowsOf: () => [] };

const readable = (b: BlockRecord | undefined): BlockRecord | undefined => (b && ctx.canRead(b.id) ? b : undefined);

/**
 * The exporting user's view of databases, as expected's record maps: rows they can't open (page-level access rules,
 * "Can only create") are left out, values of properties they can't see are removed and "No access" properties drop
 * out of the schema (propaccess.ts), for columns, CSV cells, relations, rollups and formulas alike.
 */
function exportQueryContext(userId: string): typeof ctx {
  return viewerQueryContext(userId);
}

/** A comment thread on a database property value is exported only to people who can see that property's values. */
function discussionVisible(d: DiscussionRecord): boolean {
  if (!d.property_id) return true;
  const row = getRecord<BlockRecord>('block', d.parent_id);
  if (!row || row.parent_table !== 'collection') return true;
  const col = getRecord<CollectionRecord>('collection', row.parent_id);
  const userId = ctx.userId ?? null;
  const prop = col?.schema?.[d.property_id];
  if (!col || !prop) return false;
  const space = getRecord<SpaceRecord>('space', col.space_id ?? row.space_id);
  return canSeePropertyValues(propertyRoleFor(prop, {
    userId, databaseRole: blockRole(col.parent_id, userId), rowRole: blockRole(row.id, userId), groupIds: groupIdsOf(space, userId), row, schema: col.schema,
  }));
}

/** Link target for exported HTML/Markdown: http(s), mailto, tel or relative; anything else is dropped. */
const href = (u: unknown): string => safeHref(u) ?? '';

export function safeName(title: string): string {
  const s = title.replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || 'Untitled';
}

function blockTitle(b: BlockRecord | undefined): string {
  if (!b) return 'Untitled';
  if (b.type === 'collection_view_page' || b.type === 'collection_view') {
    const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
    return toPlainText(col && (ctx.canRead(col.parent_id) || col.parent_id === b.id) ? col.name : undefined) || 'Untitled';
  }
  return toPlainText(b.properties?.title) || 'Untitled';
}

function baseName(b: BlockRecord): string {
  return `${safeName(blockTitle(b))} ${compactId(b.id)}`;
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function atomText(a: Annotation): string {
  switch (a[0]) {
    case 'p':
      return blockTitle(readable(getRecord<BlockRecord>('block', a[1])));
    case 'u': {
      const u = getRecord('lit_user', a[1]) as { name?: string } | undefined;
      return `@${u?.name || 'Unknown'}`;
    }
    case 'd':
      return formatDateRange(dateValueToRange(a[1] as any));
    case 'e':
      return String(a[1]);
    case 'lm':
      return (a[1] as { href: string; title?: string }).title ?? (a[1] as { href: string }).href;
    case 'g': {
      // group mention : "@<group name>"
      const space = getRecord<SpaceRecord>('space', String(a[2] ?? ''));
      const g = (((space?.settings as { groups?: { id: string; name?: string }[] } | undefined)?.groups) ?? []).find((x) => x?.id === String(a[1]));
      return `@${g?.name || 'Deleted group'}`;
    }
    default:
      return '';
  }
}

// ---------------- inline renderers

export function inlineMarkdown(rt: RichText | undefined): string {
  if (!rt) return '';
  let out = '';
  for (const d of rt) {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => ['p', 'u', 'd', 'e', 'lm', 'g'].includes(a[0]));
    if (atom) {
      if (atom[0] === 'e') out += `$${atom[1]}$`;
      else if (atom[0] === 'lm') out += `[${atomText(atom)}](${href((atom[1] as { href: string }).href)})`;
      else out += atomText(atom);
      continue;
    }
    let t = d[0].replace(/([*_`~\\])/g, '\\$1');
    if (!t.trim()) {
      out += t;
      continue;
    }
    const lead = /^\s*/.exec(t)![0];
    const trail = /\s*$/.exec(t)![0];
    t = t.trim();
    const link = anns.find((a) => a[0] === 'a');
    if (anns.some((a) => a[0] === 'c')) t = '`' + d[0].trim() + '`';
    if (anns.some((a) => a[0] === 'b')) t = `**${t}**`;
    if (anns.some((a) => a[0] === 'i')) t = `*${t}*`;
    if (anns.some((a) => a[0] === 's')) t = `~~${t}~~`;
    if (anns.some((a) => a[0] === '_')) t = `<u>${t}</u>`;
    if (link && href(link[1])) t = `[${t}](${href(link[1])})`;
    out += lead + t + trail;
  }
  return out;
}

export function inlineHtml(rt: RichText | undefined): string {
  if (!rt) return '';
  let out = '';
  for (const d of rt) {
    const anns = annotationsOf(d);
    const atom = anns.find((a) => ['p', 'u', 'd', 'e', 'lm', 'g'].includes(a[0]));
    if (atom) {
      out += `<span class="mention">${escHtml(atomText(atom))}</span>`;
      continue;
    }
    let t = escHtml(d[0]).replace(/\n/g, '<br>');
    if (anns.some((a) => a[0] === 'c')) t = `<code>${t}</code>`;
    if (anns.some((a) => a[0] === 'b')) t = `<strong>${t}</strong>`;
    if (anns.some((a) => a[0] === 'i')) t = `<em>${t}</em>`;
    if (anns.some((a) => a[0] === 's')) t = `<del>${t}</del>`;
    if (anns.some((a) => a[0] === '_')) t = `<span style="text-decoration:underline">${t}</span>`;
    const color = anns.find((a) => a[0] === 'h');
    if (color) t = `<span class="color-${escHtml(String(color[1]))}">${t}</span>`;
    const link = anns.find((a) => a[0] === 'a');
    if (link && href(link[1])) t = `<a href="${escHtml(href(link[1]))}">${t}</a>`;
    out += t;
  }
  return out;
}

// ---------------- database → CSV

/** Views without rows to export ("Form views can't be exported", so a table view is exported instead). */
const ROWLESS_VIEWS = new Set(['form', 'dashboard']);

/** The view a database export follows (see ExportOptions.databaseView). */
export function exportViewOf(viewIds: string[] | undefined, blockId: string | undefined, opts: Pick<ExportOptions, 'databaseView' | 'currentViews'>): CollectionViewRecord | undefined {
  const views = (viewIds ?? []).map((id) => getRecord<CollectionViewRecord>('collection_view', id)).filter((v): v is CollectionViewRecord => !!v && v.alive !== false && !ROWLESS_VIEWS.has(v.type));
  const wanted = opts.databaseView === 'current' && blockId ? opts.currentViews?.[blockId] : undefined;
  return (wanted && views.find((v) => v.id === wanted)) || views[0];
}

/** Columns (title first) and rows of a database as exported under the job's view option. */
function databaseTableData(collectionId: string, viewIds: string[] | undefined, blockId: string | undefined, opts: Pick<ExportOptions, 'databaseView' | 'currentViews'>): { props: string[]; rows: BlockRecord[]; schema: Record<string, PropertySchema> } | null {
  // a block can name any collection id: export it only when the user can read the database itself; the schema is the
  // user's copy (no "No access" properties) and rows are their readable, redacted rows (exportQueryContext)
  const col = ctx.getRecord!('collection', collectionId) as CollectionRecord | undefined;
  if (!col || !ctx.canRead(col.parent_id)) return null;
  const schema = col.schema ?? {};
  const view = exportViewOf(viewIds, blockId, opts);
  const stored = ((view?.format as Record<string, unknown> | undefined)?.[propertiesKeyFor(view?.type)] ?? []) as { property: string; visible?: boolean }[];
  const ordered = (Array.isArray(stored) ? stored : []).filter((p) => p && schema[p.property]);
  const all = Object.keys(schema).filter((p) => schema[p]);
  let props: string[];
  if (opts.databaseView === 'current' && view) {
    // the view's visible properties in its order (unlisted properties are hidden), title always
    props = ['title', ...ordered.filter((p) => p.visible !== false && p.property !== 'title').map((p) => p.property)];
  } else {
    const listed = ordered.map((p) => p.property);
    props = ['title', ...listed.filter((p) => p !== 'title'), ...all.filter((p) => p !== 'title' && !listed.includes(p))];
  }
  props = [...new Set(props)].filter((p) => schema[p] && schema[p].type !== 'button');
  // archived rows are hidden from database views
  const source = ctx.rowsOf!(collectionId).filter((r) => !isArchivedRecord(r));
  let rows: BlockRecord[];
  if (opts.databaseView === 'current' && view) rows = runQuery(source, col, view, ctx).rows;
  else {
    const sortIds = view?.page_sort ?? [];
    rows = [...source].sort((a, b) => {
      const ia = sortIds.indexOf(a.id);
      const ib = sortIds.indexOf(b.id);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.created_time - b.created_time;
    });
  }
  return { props, rows, schema };
}

export function databaseCsv(collectionId: string, viewIds: string[] | undefined, blockId?: string, opts: Pick<ExportOptions, 'databaseView' | 'currentViews'> = {}): string {
  const data = databaseTableData(collectionId, viewIds, blockId, opts);
  return data ? csvOf(data) : '';
}

// ---------------- page tree export

interface Job {
  files: ExportFile[];
  opts: ExportOptions;
  seen: Set<string>;
  /** PDF: one printable article per page, in document order (the root first, then subpages when included) */
  sections: string[];
}

/** Real children (blocks pointing back at `b`); ids merely listed in `content` are not part of the page. */
function children(b: BlockRecord): BlockRecord[] {
  return childBlocks(b);
}

function mediaSrc(b: BlockRecord, job: Job, dir: string): string {
  const src = (b.format?.display_source as string | undefined) ?? toPlainText(b.properties?.source);
  if (!src) return '';
  if (job.opts.includeFiles && src.startsWith('/files/') && job.opts.readUpload) {
    const f = job.opts.readUpload(src);
    if (f) {
      const rel = `${dir}${safeName(f.name.replace(/\.[^.]+$/, ''))}${/\.[^.]+$/.exec(f.name)?.[0] ?? ''}`;
      if (!job.files.some((x) => x.path === rel)) job.files.push({ path: rel, data: f.data });
      return rel;
    }
  }
  return src;
}

const isDatabase = (b: BlockRecord) => b.type === 'collection_view_page' || b.type === 'collection_view';

/** Path of the file that represents `b` (Markdown & CSV: .md / .csv; HTML: .html; PDF: anchor in the print document). */
function nodePath(b: BlockRecord, dir: string, job: Job): string {
  if (job.opts.format === 'pdf') return `#${b.id}`;
  if (job.opts.format === 'markdown') return `${dir}${baseName(b)}.${isDatabase(b) ? 'csv' : 'md'}`;
  return `${dir}${baseName(b)}.html`;
}

/** Export page (or database) `blockId` into `dir`; returns the file path that represents it. */
function exportNode(b: BlockRecord, dir: string, job: Job): string {
  const path = nodePath(b, dir, job);
  if (job.seen.has(b.id)) return path;
  job.seen.add(b.id);
  // PDF: reserve this page's place first so subpages print after it (document order)
  const slot = job.opts.format === 'pdf' ? job.sections.push('') - 1 : -1;
  if (isDatabase(b)) return exportDatabase(b, dir, path, job, slot);
  const name = baseName(b);
  const childDir = `${dir}${name}/`;
  const body = job.opts.format === 'markdown' ? renderMarkdown(children(b), job, childDir, '') : renderHtml(children(b), job, childDir);
  if (job.opts.format === 'markdown') job.files.push({ path, data: `# ${blockTitle(b)}\n\n${body}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n' });
  else if (slot >= 0) job.sections[slot] = pageArticle(b, body, job, slot > 0);
  else job.files.push({ path, data: htmlDocument(b, pageArticle(b, body, job, false), job) });
  return path;
}

/** Markdown & CSV: "Name <id>.csv" (+ row pages as .md); HTML / PDF: the database as a table (rows link to their pages). */
function exportDatabase(b: BlockRecord, dir: string, path: string, job: Job, slot: number): string {
  const data = b.collection_id ? databaseTableData(b.collection_id, b.view_ids, b.id, job.opts) : null;
  const name = baseName(b);
  const rowLinks = new Map<string, string>();
  if (data && job.opts.includeSubpages) {
    for (const row of data.rows) {
      if (!job.opts.canRead(row.id)) continue;
      if (job.opts.format === 'markdown' && !row.content?.length) continue;
      rowLinks.set(row.id, exportNode(row, `${dir}${name}/`, job));
    }
  }
  if (job.opts.format === 'markdown') {
    job.files.push({ path, data: data ? csvOf(data) : '' });
    return path;
  }
  const table = data ? databaseTableHtml(b, data, (id) => {
    const p = rowLinks.get(id);
    return p ? (p.startsWith('#') ? p : encPath(rel(dir, p))) : null;
  }, false) : '';
  if (slot >= 0) job.sections[slot] = pageArticle(b, table, job, slot > 0);
  else job.files.push({ path, data: htmlDocument(b, pageArticle(b, table, job, false), job) });
  return path;
}

function csvOf({ props, rows, schema }: NonNullable<ReturnType<typeof databaseTableData>>): string {
  const out: string[][] = [props.map((p) => (schema[p] as PropertySchema).name)];
  for (const r of rows) out.push(props.map((p) => formatPropertyValue(getPropertyValue(r, p, schema, ctx), schema[p], ctx)));
  return toCsv(out);
}

function rel(fromDir: string, target: string): string {
  return target.startsWith(fromDir) ? target.slice(fromDir.length) : target;
}

function renderMarkdown(blocks: BlockRecord[], job: Job, childDir: string, indent: string): string {
  const out: string[] = [];
  let num = 0;
  const pageDir = childDir.replace(/[^/]+\/$/, '');
  for (const b of blocks) {
    if (b.type !== 'numbered_list') num = 0;
    const t = inlineMarkdown(b.properties?.title);
    const kids = children(b);
    const sub = (ind: string) => (kids.length ? '\n' + renderMarkdown(kids, job, childDir, ind) : '');
    let line = '';
    switch (b.type) {
      case 'text':
        line = indent + t.replace(/\n/g, `  \n${indent}`) + sub(indent + '    ');
        break;
      case 'header':
        line = `${indent}# ${t}`;
        break;
      case 'sub_header':
        line = `${indent}## ${t}`;
        break;
      case 'sub_sub_header':
        line = `${indent}### ${t}`;
        break;
      case 'header_4':
        line = `${indent}#### ${t}`;
        break;
      case 'bulleted_list':
      case 'toggle':
        line = `${indent}- ${t}${sub(indent + '    ')}`;
        break;
      case 'numbered_list':
        num++;
        line = `${indent}${num}. ${t}${sub(indent + '    ')}`;
        break;
      case 'to_do':
        line = `${indent}- [${b.properties?.checked?.[0]?.[0] === 'Yes' ? 'x' : ' '}] ${t}${sub(indent + '    ')}`;
        break;
      case 'quote':
        line = `${indent}> ${t.replace(/\n/g, `\n${indent}> `)}` + (kids.length ? '\n' + renderMarkdown(kids, job, childDir, '').split('\n').map((l) => `${indent}> ${l}`).join('\n') : '');
        break;
      case 'callout': {
        const icon = (b.format?.page_icon as string | undefined) ?? '';
        line = `${indent}<aside>\n${indent}${icon && !icon.startsWith('/') && !icon.startsWith('http') && !icon.startsWith('lit-icon') ? icon + ' ' : ''}${t}\n${kids.length ? '\n' + renderMarkdown(kids, job, childDir, indent) + '\n' : ''}${indent}</aside>`;
        break;
      }
      case 'code': {
        const lang = toPlainText(b.properties?.language) || 'Plain Text';
        line = `${indent}\`\`\`${lang === 'Plain Text' ? '' : lang.toLowerCase().replace(/\s+/g, '')}\n${toPlainText(b.properties?.title)}\n${indent}\`\`\``;
        break;
      }
      case 'equation':
        line = `${indent}$$\n${indent}${toPlainText(b.properties?.title)}\n${indent}$$`;
        break;
      case 'divider':
        line = `${indent}---`;
        break;
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf': {
        const src = mediaSrc(b, job, childDir);
        const cap = inlineMarkdown(b.properties?.caption);
        line = b.type === 'image' ? `${indent}![${cap}](${encPath(rel(pageDir, src))})` : `${indent}[${cap || src.split('/').pop() || b.type}](${encPath(rel(pageDir, src))})`;
        break;
      }
      case 'bookmark':
      case 'embed': {
        const src = href(toPlainText(b.properties?.source) || (b.format?.display_source as string | undefined) || '');
        line = src ? `${indent}[${inlineMarkdown(b.properties?.caption) || src}](${src})` : '';
        break;
      }
      case 'table': {
        const order = (b.format?.table_block_column_order as string[] | undefined) ?? [];
        const rows = kids.filter((r) => r.type === 'table_row');
        if (order.length && rows.length) {
          const cells = rows.map((r) => order.map((c) => inlineMarkdown(r.properties?.[c] as RichText).replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
          const lines = [`| ${cells[0].join(' | ')} |`, `| ${order.map(() => '---').join(' | ')} |`, ...cells.slice(1).map((r) => `| ${r.join(' | ')} |`)];
          line = lines.map((l) => indent + l).join('\n');
        }
        break;
      }
      case 'column_list':
        line = kids.map((col) => renderMarkdown(children(col), job, childDir, indent)).join('\n\n');
        break;
      case 'page':
      case 'collection_view_page':
      case 'collection_view': {
        if (!job.opts.canRead(b.id)) break;
        const title = blockTitle(b);
        if (job.opts.includeSubpages || b.type === 'collection_view') {
          const p = exportNode(b, childDir, job);
          line = `${indent}[${title}](${encPath(rel(pageDir, p))})`;
        } else line = `${indent}${title}`;
        break;
      }
      case 'alias':
      case 'link_to_page': {
        const target = readable(getRecord<BlockRecord>('block', (b.format as { alias_pointer?: { id: string } } | undefined)?.alias_pointer?.id ?? ''));
        line = target ? `${indent}${blockTitle(target)}` : '';
        break;
      }
      case 'transclusion_reference': {
        // a synced copy shows its original only to people who can read the original
        const src = (b.format as { transclusion_reference_pointer?: { id: string } } | undefined)?.transclusion_reference_pointer?.id;
        const sb = readable(src ? getRecord<BlockRecord>('block', src) : undefined);
        line = sb && !job.seen.has(`sync:${sb.id}`) ? (job.seen.add(`sync:${sb.id}`), renderMarkdown(children(sb), job, childDir, indent)) : '';
        break;
      }
      case 'transclusion_container':
        line = renderMarkdown(kids, job, childDir, indent);
        break;
      case 'table_of_contents':
      case 'breadcrumb':
      case 'button':
        break;
      default:
        line = t ? indent + t : '';
    }
    if (line === '' && b.type === 'text') out.push('');
    else if (line) out.push(line);
  }
  // list items stay together; other blocks separated by a blank line (the export style)
  let s = '';
  const isList = (l: string) => /^\s*(- |\d+\. )/.test(l);
  out.forEach((l, i) => {
    if (i === 0) s = l;
    else s += (isList(l) && isList(out[i - 1]) ? '\n' : '\n\n') + l;
  });
  return s;
}

function renderHtml(blocks: BlockRecord[], job: Job, childDir: string): string {
  const out: string[] = [];
  const pageDir = childDir.replace(/[^/]+\/$/, '');
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'bulleted_list' || b.type === 'numbered_list' || b.type === 'to_do') {
      const tag = b.type === 'numbered_list' ? 'ol' : 'ul';
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === b.type) {
        const it = blocks[i];
        const kids = children(it);
        const check = it.type === 'to_do' ? `<input type="checkbox" disabled${it.properties?.checked?.[0]?.[0] === 'Yes' ? ' checked' : ''}> ` : '';
        items.push(`<li>${check}${inlineHtml(it.properties?.title)}${blockComments(it, job)}${kids.length ? renderHtml(kids, job, childDir) : ''}</li>`);
        i++;
      }
      out.push(`<${tag}${b.type === 'to_do' ? ' class="to-do-list"' : ''}>${items.join('')}</${tag}>`);
      continue;
    }
    const t = inlineHtml(b.properties?.title);
    const kids = children(b);
    switch (b.type) {
      case 'text':
        out.push(`<p>${t || '<br>'}</p>${kids.length ? `<div class="indented">${renderHtml(kids, job, childDir)}</div>` : ''}`);
        break;
      case 'header':
        out.push(`<h1>${t}</h1>`);
        break;
      case 'sub_header':
        out.push(`<h2>${t}</h2>`);
        break;
      case 'sub_sub_header':
        out.push(`<h3>${t}</h3>`);
        break;
      case 'header_4':
        out.push(`<h4>${t}</h4>`);
        break;
      case 'toggle':
        out.push(`<details open><summary>${t}</summary>${renderHtml(kids, job, childDir)}</details>`);
        break;
      case 'quote':
        out.push(`<blockquote>${t}${kids.length ? renderHtml(kids, job, childDir) : ''}</blockquote>`);
        break;
      case 'callout': {
        const icon = (b.format?.page_icon as string | undefined) ?? '💡';
        out.push(`<figure class="callout"><div class="icon">${escHtml(icon.startsWith('/') || icon.startsWith('http') ? '💡' : icon)}</div><div>${t}${kids.length ? renderHtml(kids, job, childDir) : ''}</div></figure>`);
        break;
      }
      case 'code': {
        const lang = toPlainText(b.properties?.language) || 'Plain Text';
        out.push(`<pre class="code"><code class="language-${escHtml(lang.toLowerCase().replace(/\s+/g, '-'))}">${escHtml(toPlainText(b.properties?.title))}</code></pre>`);
        break;
      }
      case 'equation':
        out.push(`<figure class="equation">${escHtml(toPlainText(b.properties?.title))}</figure>`);
        break;
      case 'divider':
        out.push('<hr>');
        break;
      case 'image': {
        const src = mediaSrc(b, job, childDir);
        const cap = inlineHtml(b.properties?.caption);
        out.push(`<figure class="image"><img src="${escHtml(encPath(rel(pageDir, src)))}">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`);
        break;
      }
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf':
      case 'bookmark':
      case 'embed': {
        const raw = b.type === 'bookmark' || b.type === 'embed' ? toPlainText(b.properties?.source) || ((b.format?.display_source as string) ?? '') : mediaSrc(b, job, childDir);
        const src = href(raw);
        if (src) out.push(`<figure class="bookmark"><a href="${escHtml(src.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(src) ? src : encPath(rel(pageDir, src)))}">${escHtml(toPlainText(b.properties?.caption) || src)}</a></figure>`);
        break;
      }
      case 'table': {
        const order = (b.format?.table_block_column_order as string[] | undefined) ?? [];
        const rows = kids.filter((r) => r.type === 'table_row');
        const header = !!b.format?.table_block_column_header;
        const body = rows.map((r, ri) => `<tr>${order.map((c) => (header && ri === 0 ? `<th>${inlineHtml(r.properties?.[c] as RichText)}</th>` : `<td>${inlineHtml(r.properties?.[c] as RichText)}</td>`)).join('')}</tr>`).join('');
        out.push(`<table class="simple-table"><tbody>${body}</tbody></table>`);
        break;
      }
      case 'column_list':
        out.push(`<div class="column-list">${kids.map((col) => `<div class="column">${renderHtml(children(col), job, childDir)}</div>`).join('')}</div>`);
        break;
      case 'page':
      case 'collection_view_page':
      case 'collection_view': {
        if (!job.opts.canRead(b.id)) break;
        const title = escHtml(blockTitle(b));
        const icon = (b.format?.page_icon as string | undefined) ?? '';
        if (b.type === 'collection_view' && b.collection_id) out.push(databaseTable(b, job, childDir));
        else if (job.opts.includeSubpages) {
          const p = exportNode(b, childDir, job);
          const link = p.startsWith('#') ? p : encPath(rel(pageDir, p));
          out.push(`<figure class="link-to-page"><a href="${escHtml(link)}">${icon && !icon.startsWith('/') && !icon.startsWith('http') && !icon.startsWith('lit-icon') ? `<span class="icon">${escHtml(icon)}</span>` : ''}${title}</a></figure>`);
        } else out.push(`<p class="link-to-page">📄 ${title}</p>`);
        break;
      }
      case 'transclusion_container':
        out.push(renderHtml(kids, job, childDir));
        break;
      default:
        if (t) out.push(`<p>${t}</p>`);
    }
    const comments = blockComments(b, job);
    if (comments) out.push(comments);
    i++;
  }
  return out.join('\n');
}

/** Inline database in an HTML/PDF export: title + table of the exported view (rows link to their exported pages). */
function databaseTable(b: BlockRecord, job: Job, childDir: string): string {
  const data = databaseTableData(b.collection_id!, b.view_ids, b.id, job.opts);
  if (!data) return '';
  const pageDir = childDir.replace(/[^/]+\/$/, '');
  const links = new Map<string, string>();
  if (job.opts.includeSubpages) {
    for (const row of data.rows) {
      if (!job.opts.canRead(row.id)) continue;
      const p = exportNode(row, `${childDir}${baseName(b)}/`, job);
      links.set(row.id, p.startsWith('#') ? p : encPath(rel(pageDir, p)));
    }
  }
  return databaseTableHtml(b, data, (id) => links.get(id) ?? null, true);
}

function databaseTableHtml(b: BlockRecord, { props, rows, schema }: NonNullable<ReturnType<typeof databaseTableData>>, linkOf: (rowId: string) => string | null, inline: boolean): string {
  const head = props.map((p) => `<th>${escHtml((schema[p] as PropertySchema).name)}</th>`).join('');
  const body = rows.map((r) => `<tr>${props.map((p) => {
    const text = escHtml(formatPropertyValue(getPropertyValue(r, p, schema, ctx), schema[p], ctx));
    const link = p === 'title' ? linkOf(r.id) : null;
    return `<td>${link ? `<a href="${escHtml(link)}">${text || 'Untitled'}</a>` : text}</td>`;
  }).join('')}</tr>`).join('');
  const title = inline ? `<h4 class="collection-title">${escHtml(blockTitle(b))}</h4>` : '';
  return `<div class="collection-content">${title}<table class="collection-content"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const EXPORT_CSS = `
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;color:rgb(44,44,43);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji";line-height:1.5;font-size:16px}
article.page{max-width:720px;margin:0 auto;padding:80px 96px 120px}
.page-cover{width:100%;height:30vh;max-height:280px;object-fit:cover;display:block}
.page-icon{font-size:78px;line-height:1.1;margin-bottom:4px}
h1.page-title{font-size:40px;font-weight:700;line-height:1.2;margin:8px 0 24px}
h1{font-size:30px;font-weight:600;margin:32px 0 4px;line-height:1.3}
h2{font-size:24px;font-weight:600;margin:22px 0 1px;line-height:1.3}
h3{font-size:20px;font-weight:600;margin:16px 0 1px;line-height:1.3}
h4{font-size:16px;font-weight:600;margin:12px 0 1px}
p{margin:2px 0;min-height:1.5em;white-space:pre-wrap}
ul,ol{margin:2px 0;padding-inline-start:1.7em}
ul.to-do-list{list-style:none;padding-inline-start:4px}
ul.to-do-list input{margin-right:8px}
blockquote{margin:6px 0;padding:0 14px;border-left:3px solid currentColor}
figure{margin:6px 0}
figure.callout{display:flex;gap:10px;padding:16px 16px 16px 12px;border-radius:10px;background:rgb(249,248,247)}
figure.callout .icon{font-size:20px;line-height:1.3}
pre.code{background:rgb(247,246,243);border-radius:10px;padding:32px 16px 32px 32px;font-size:85%;white-space:pre-wrap;font-family:"SFMono-Regular",Menlo,Consolas,"PT Mono","Liberation Mono",Courier,monospace;tab-size:2}
code{font-family:"SFMono-Regular",Menlo,Consolas,"PT Mono","Liberation Mono",Courier,monospace;background:rgba(135,131,120,.15);color:#eb5757;border-radius:4px;font-size:85%;padding:.2em .4em}
pre code{background:none;color:inherit;padding:0;font-size:inherit}
hr{border:none;border-top:1px solid rgba(55,53,47,.16);margin:12px 0}
img{max-width:100%}
figcaption{font-size:14px;color:rgba(55,53,47,.65);margin-top:6px}
table{border-collapse:collapse;margin:8px 0}
td,th{border:1px solid rgb(233,233,231);padding:6px 8px;text-align:left;vertical-align:top;font-size:14px}
th{background:rgb(247,246,243);font-weight:500}
.collection-title{margin:16px 0 6px}
.column-list{display:flex;gap:46px}.column{flex:1;min-width:0}
.link-to-page a{color:inherit;text-decoration:underline;text-decoration-color:rgba(55,53,47,.4)}
.link-to-page .icon{margin-right:6px}
.mention{color:rgba(55,53,47,.65)}
a{color:inherit}
.indented{padding-inline-start:1.5em}
details summary{cursor:pointer}
.color-gray{color:rgb(120,119,116)}.color-brown{color:rgb(159,107,83)}.color-orange{color:rgb(217,115,13)}.color-yellow{color:rgb(203,145,47)}.color-green{color:rgb(68,131,97)}.color-blue{color:rgb(51,126,169)}.color-purple{color:rgb(144,101,176)}.color-pink{color:rgb(193,76,138)}.color-red{color:rgb(212,76,71)}
[class$="_background"]{border-radius:3px}
.color-yellow_background{background:rgb(251,243,219)}.color-gray_background{background:rgb(241,241,239)}.color-blue_background{background:rgb(231,243,248)}.color-red_background{background:rgb(253,235,236)}.color-green_background{background:rgb(237,243,236)}
@media print{article.page{padding:0;max-width:none}.page-cover{height:160px}a{text-decoration:none}article.page.page-break{break-before:page}}
.page-comments{margin:0 0 20px}
.block-comments{margin:4px 0 10px 0;padding:8px 12px;border-left:2px solid rgba(255,203,0,.8);background:rgba(255,203,0,.08);border-radius:4px;font-size:14px}
.discussion+.discussion{margin-top:10px;padding-top:10px;border-top:1px solid rgba(55,53,47,.09)}
.discussion-context{color:rgba(55,53,47,.65);border-left:3px solid rgba(255,203,0,.8);padding-left:8px;margin-bottom:6px}
.comment+.comment{margin-top:6px}
.comment-author{font-weight:600}
.comment-time{color:rgba(55,53,47,.5);font-size:12px;margin-left:6px}
.comment-body{white-space:pre-wrap}
.discussion-resolved{color:rgba(55,53,47,.5);font-size:12px;margin-top:4px}
`;

function commentTime(t: number | undefined, job: Job): string {
  if (!t) return '';
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  try {
    return new Date(t).toLocaleString('en-US', job.opts.timeZone ? { ...o, timeZone: job.opts.timeZone } : o);
  } catch {
    return new Date(t).toLocaleString('en-US', o);
  }
}

/** Export comments (HTML): every discussion of `ids` with its context quote, comments (author · time · text) and
 *  resolved state. Mentions inside comments resolve like page text (only what the exporting user can read). */
function discussionsHtml(ids: string[] | undefined, job: Job): string {
  const out: string[] = [];
  for (const id of ids ?? []) {
    const d = getRecord<DiscussionRecord>('discussion', id);
    if (!d || d.alive === false || !discussionVisible(d)) continue;
    const comments = (d.comments ?? []).map((cid) => getRecord<CommentRecord>('comment', cid)).filter((c): c is CommentRecord => !!c && c.alive !== false);
    if (!comments.length) continue;
    const context = toPlainText(d.context as RichText | undefined);
    out.push(`<div class="discussion${d.resolved ? ' resolved' : ''}">${context ? `<div class="discussion-context">${escHtml(context)}</div>` : ''}${comments.map((c) => {
      const author = (getRecord('lit_user', c.created_by_id) as { name?: string } | undefined)?.name || 'Unknown';
      return `<div class="comment"><div class="comment-header"><span class="comment-author">${escHtml(author)}</span><span class="comment-time">${escHtml(commentTime(c.created_time, job))}</span></div><div class="comment-body">${inlineHtml(c.text as RichText)}</div></div>`;
    }).join('')}${d.resolved ? '<div class="discussion-resolved">Resolved</div>' : ''}</div>`);
  }
  return out.join('');
}

function blockComments(b: BlockRecord, job: Job): string {
  if (!job.opts.includeComments || job.opts.format !== 'html' || !b.discussions?.length) return '';
  const html = discussionsHtml(b.discussions, job);
  return html ? `<aside class="block-comments">${html}</aside>` : '';
}

/** One page as an <article> (cover, icon, title, page comments, body). */
function pageArticle(b: BlockRecord, body: string, job: Job, pageBreak: boolean): string {
  const title = blockTitle(b);
  const icon = (b.format?.page_icon as string | undefined) ?? '';
  const cover = (b.format?.page_cover as string | undefined) ?? '';
  const iconHtml = icon && !icon.startsWith('lit-icon')
    ? icon.startsWith('/') || icon.startsWith('http') ? `<div class="page-icon"><img src="${escHtml(icon)}" style="width:78px;height:78px;object-fit:cover;border-radius:6px"></div>` : `<div class="page-icon">${escHtml(icon)}</div>`
    : '';
  const pageComments = job.opts.includeComments && job.opts.format === 'html' ? discussionsHtml(b.discussions, job) : '';
  return `${cover && /^(https?:|\/)/.test(cover) ? `<img class="page-cover" src="${escHtml(cover)}" alt="">` : ''}<article class="page${pageBreak ? ' page-break' : ''}" id="${escHtml(b.id)}"><header>${iconHtml}<h1 class="page-title">${escHtml(title)}</h1></header>${pageComments ? `<div class="page-comments">${pageComments}</div>` : ''}<div class="page-body">${body}</div></article>`;
}

/** A standalone HTML document; PDF adds the paper size / scale and opens the browser's print dialog. */
function htmlDocument(b: BlockRecord | string, articles: string, job: Job): string {
  const title = typeof b === 'string' ? b : blockTitle(b);
  const print = job.opts.format === 'pdf';
  const size = PDF_PAGE_SIZES[job.opts.pdf?.format ?? 'A4'] ?? 'A4';
  const scale = Math.max(10, Math.min(200, Math.round(Number(job.opts.pdf?.scale) || 100))) / 100;
  const printCss = print ? `@page{size:${size};margin:16mm 14mm}${scale !== 1 ? `body{zoom:${scale}}` : ''}` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(title)}</title><style>${EXPORT_CSS}${printCss}</style></head>
<body>${articles}${
    print ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},350)})</script>' : ''
  }</body></html>
`;
}

/** Export a page / database tree. */
export function exportTree(rootId: string, opts: ExportOptions): { files: ExportFile[]; root: BlockRecord; rootPath: string } | null {
  const root = getRecord<BlockRecord>('block', rootId);
  if (!root || !opts.canRead(rootId)) return null;
  const job: Job = { files: [], opts, seen: new Set(), sections: [] };
  const prev = ctx;
  ctx = exportQueryContext(opts.userId);
  let rootPath = '';
  try {
    rootPath = exportNode(root, '', job);
    if (opts.format === 'pdf') {
      // one print document: the page, then (Include subpages) every subpage on a new sheet
      rootPath = `${baseName(root)}.html`;
      job.files.unshift({ path: rootPath, data: htmlDocument(root, job.sections.join('\n'), job) });
    }
  } finally {
    ctx = prev;
  }
  return { files: job.files, root, rootPath };
}

/** Most sheets one combined print document may hold (a workspace PDF); bigger workspaces export as HTML / Markdown. */
export const PRINT_BUNDLE_MAX_SECTIONS = 2000;

/** One print document for several page trees (Settings › Export all workspace content as PDF): each
 *  top-level page and every subpage starts on a new sheet. Null when nothing readable; throws past the size cap. */
export function exportPrintBundle(rootIds: string[], opts: ExportOptions, title: string): { html: string; pages: number } | null {
  const job: Job = { files: [], opts: { ...opts, format: 'pdf', includeSubpages: true, includeFiles: false }, seen: new Set(), sections: [] };
  const prev = ctx;
  ctx = exportQueryContext(opts.userId);
  try {
    for (const id of rootIds) {
      const root = getRecord<BlockRecord>('block', id);
      if (!root || !root.alive || !opts.canRead(id) || job.seen.has(id)) continue;
      exportNode(root, '', job);
      if (job.sections.length > PRINT_BUNDLE_MAX_SECTIONS) throw new Error('too_large');
    }
  } finally {
    ctx = prev;
  }
  const sections = job.sections.filter(Boolean);
  if (!sections.length) return null;
  return { html: htmlDocument(title, sections.join('\n'), job), pages: sections.length };
}

export { blockTitle, baseName };
