// Import (Settings › Import, page ••• › Import, slash /import /csv /pdf …): uploaded files → pages / databases.
//   importFiles { spaceId, parent: { kind: 'private' } | { kind: 'page', pageId, afterBlockId? }, files: [{ name, url }],
//                 csvTypes?: { [columnIndex]: propertyType | 'skip' } }
//     → { pageIds: string[], pages: number, databases: number }
//   previewCsv { url, blockId? }  → columns (name, inferred type, samples) + the target database's properties
//   mergeCsv { blockId, url, mapping?: { [columnIndex]: propertyId | 'new' | 'skip' } }   "Merge with CSV" :
//   (third-party tiles import those apps' export files: Evernote .enex, Trello .json, Asana/Jira/Monday CSV or Excel,
//    Confluence HTML ZIP, Quip/Google Docs .docx/.html, Workflowy .opml/.txt)
//     rows are added to an existing database (columns matched to properties by name; unmatched become Text)
// Supported: Text & Markdown (.md .markdown .txt), CSV / TSV / Excel (.xlsx) → full-page database, HTML (.html .htm),
// Word (.docx), PDF (text layer), OPML outlines, ZIP (the export tree of Markdown/HTML/CSV + images, and any of
// the formats above inside it). Limits : 5 MB per file on Free, 50 MB on paid plans (PDF 20 MB); 120 files
// per 12 hours per user.
import { compactId, newId } from '@nc/shared/ids.ts';
import type { Operation } from '@nc/shared/ops.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, PropertyType, SpaceRecord, SpaceViewRecord, UserRootRecord } from '@nc/shared/records.ts';
import { getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { OpsBuilder, encodeRowValue, shortPropId, type Spec } from '../../content/spec.ts';
import { parseMarkdown } from '../../content/markdown.ts';
import { parseHtml } from '../../content/html.ts';
import { CSV_COLUMN_TYPES, csvToDb, inferColumnType, parseCsv, parseDateCell, rowsToDb } from '../../content/csv.ts';
import { readZip, type ZipEntry } from '../../content/zip.ts';
import { readStoredFile, storeFile, mimeFor } from '../../content/files.ts';
import { docxToSpecs } from '../../content/docx.ts';
import { pdfToSpecs } from '../../content/pdf.ts';
import { opmlToSpecs, tsvToRows, xlsxToRows } from '../../content/sheets.ts';
import { enexToDb, trelloToDb } from '../../content/apps.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';

type Handler = (ctx: Ctx, body: any) => any;

const MAX_FILES = 20;
const MAX_BLOCKS = 20_000;
const PAGE_EXT = /\.(md|markdown|txt|html?|csv|tsv|docx|pdf|xlsx|opml|enex)$/i;
/** File types importFiles accepts directly (ZIP aside): + Evernote .enex and Trello board .json exports. */
export const IMPORT_EXT = /\.(md|markdown|txt|csv|tsv|html?|docx|pdf|xlsx|opml|enex|json)$/i;
const MB = 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function spaceViewOf(userId: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', userId);
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (sv?.space_id === spaceId && sv.alive !== false) return sv;
  }
  return undefined;
}

/** "Meeting notes 1a2b…(32 hex).md" → "Meeting notes" */
export function titleFromFileName(name: string): string {
  const base = name.split('/').pop()!.replace(/\.[^.]+$/, '');
  return base.replace(/\s+[0-9a-f]{32}$/i, '').replace(/_all$/, '').trim() || 'Untitled';
}

function decodeText(buf: Buffer): string {
  // UTF-8 (with BOM) or UTF-16LE
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

function pageFromText(name: string, text: string, ctx: Parameters<typeof parseMarkdown>[1] = {}, csvTypes?: Record<number, PropertyType | 'skip'>): Spec {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? 'md';
  if (ext === 'csv') return { type: 'collection_view_page', db: csvToDb(titleFromFileName(name), text, csvTypes), icon: undefined };
  if (ext === 'tsv') return { type: 'collection_view_page', db: rowsToDb(titleFromFileName(name), tsvToRows(text), csvTypes) };
  if (ext === 'opml') {
    const r = opmlToSpecs(text);
    return { type: 'page', text: r.title ?? titleFromFileName(name), children: r.blocks };
  }
  if (ext === 'html' || ext === 'htm') {
    const r = parseHtml(text, ctx);
    return { type: 'page', text: r.title ?? titleFromFileName(name), children: r.blocks };
  }
  if (ext === 'txt') {
    // plain text: paragraphs separated by blank lines, line breaks kept
    const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim());
    return { type: 'page', text: titleFromFileName(name), children: paras.map((p) => ({ type: 'text', text: p })) };
  }
  const r = parseMarkdown(text, ctx);
  return { type: 'page', text: r.title ?? titleFromFileName(name), children: r.blocks };
}

/** Any supported file (binary formats included) → a page / database spec. */
function pageFromFile(name: string, data: Buffer, uid: string, spaceId: string, ctx: Parameters<typeof parseMarkdown>[1] = {}, csvTypes?: Record<number, PropertyType | 'skip'>): Spec {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  try {
    if (ext === 'docx') {
      const r = docxToSpecs(data, { title: titleFromFileName(name), storeImage: (img, bytes) => storeFile(img, bytes, uid, spaceId, mimeFor(img)).url });
      return { type: 'page', text: r.title, children: r.blocks };
    }
    if (ext === 'pdf') {
      const r = pdfToSpecs(data, { title: titleFromFileName(name) });
      return { type: 'page', text: r.title, children: r.blocks };
    }
    if (ext === 'xlsx') return { type: 'collection_view_page', db: rowsToDb(titleFromFileName(name), xlsxToRows(data), csvTypes) };
    if (ext === 'enex') return { type: 'collection_view_page', db: enexToDb(titleFromFileName(name), decodeText(data)) };
    if (ext === 'json') return { type: 'collection_view_page', db: trelloToDb(titleFromFileName(name), decodeText(data)) };
  } catch (e) {
    throw new ApiError(`${name.split('/').pop()}: ${(e as Error).message}`, 400);
  }
  return pageFromText(name, decodeText(data), ctx, csvTypes);
}

/** Per-file size limit : Free 5 MB, paid plans 50 MB (PDF 20 MB). */
function maxBytesFor(space: SpaceRecord, name: string): number {
  if (space.plan_type === 'free') return 5 * MB;
  return /\.pdf$/i.test(name) ? 20 * MB : 50 * MB;
}

// ---------------- ZIP (the export layout)

interface ZipCtx {
  entries: Map<string, ZipEntry>;
  ids: Map<string, string>;
  consumed: Set<string>;
  uid: string;
  spaceId: string;
  storedImages: Map<string, string>;
}

function dirOf(path: string) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

function resolveRel(fromDir: string, href: string): string | null {
  let h = href.split('#')[0].split('?')[0];
  if (!h || /^[a-z]+:/i.test(h) || h.startsWith('/')) return null;
  try {
    h = decodeURIComponent(h);
  } catch {
    /* keep raw */
  }
  const parts = (fromDir + h).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function zipPageSpec(path: string, z: ZipCtx): Spec {
  z.consumed.add(path);
  const entry = z.entries.get(path)!;
  const dir = dirOf(path);
  const base = path.slice(dir.length).replace(/\.[^.]+$/, '');
  const childDir = `${dir}${base}/`;
  const id = z.ids.get(path)!;
  const ctx = {
    resolveImage: (src: string) => {
      const p = resolveRel(dir, src);
      if (!p) return /^https?:/i.test(src) ? src : null;
      const e = z.entries.get(p);
      if (!e || !IMAGE_EXT.test(p)) return null;
      if (!z.storedImages.has(p)) z.storedImages.set(p, storeFile(p.split('/').pop()!, e.data, z.uid, z.spaceId, mimeFor(p)).url);
      return z.storedImages.get(p)!;
    },
    resolvePageLink: (href: string) => {
      const p = resolveRel(dir, href);
      if (!p || !z.entries.has(p) || !PAGE_EXT.test(p) || z.consumed.has(p)) return null;
      // only sub-pages (inside this page's folder) are embedded where the link appears
      if (!p.startsWith(childDir)) return null;
      return zipPageSpec(p, z);
    },
    resolveLink: (href: string) => {
      const p = resolveRel(dir, href);
      if (p && z.ids.has(p)) return `/${compactId(z.ids.get(p)!)}`;
      return /^(https?:|mailto:)/i.test(href) ? href : null;
    },
  };
  const text = decodeText(entry.data);
  let spec: Spec;
  if (/\.csv$/i.test(path)) {
    const db = csvToDb(titleFromFileName(path), text);
    // row pages exported next to the CSV ("<db>/<row title> <id>.md") become row content
    for (const row of db.rows) {
      const title = String(row.values.title ?? '');
      const match = [...z.entries.keys()].find((k) => dirOf(k) === childDir && /\.(md|html?)$/i.test(k) && !z.consumed.has(k) && titleFromFileName(k) === title);
      if (match) {
        z.consumed.add(match);
        const rowSpec = pageFromText(match, decodeText(z.entries.get(match)!.data), ctx);
        // row exports start with "Prop: value" lines; drop the ones matching columns
        row.children = (rowSpec.children ?? []).filter((c) => !(c.type === 'text' && typeof c.text !== 'string' && /^[^:\n]{1,40}: .*/.test((c.text ?? []).map((d) => d[0]).join('')) && (c.text ?? []).length <= 2));
      }
    }
    spec = { type: 'collection_view_page', db, id };
  } else {
    spec = /\.(docx|pdf|xlsx)$/i.test(path) ? pageFromFile(path, entry.data, z.uid, z.spaceId, ctx) : pageFromText(path, text, ctx);
    spec.id = id;
  }
  // sub-pages not linked from the content are appended (they remain child pages)
  if (spec.type === 'page') {
    const rest = [...z.entries.keys()].filter((k) => dirOf(k) === childDir && PAGE_EXT.test(k) && !z.consumed.has(k)).sort();
    const preferAll = new Set(rest.filter((k) => /_all\.csv$/i.test(k)).map((k) => k.replace(/_all\.csv$/i, '.csv')));
    for (const k of rest) {
      if (preferAll.has(k) || z.consumed.has(k)) continue;
      spec.children = [...(spec.children ?? []), zipPageSpec(k, z)];
    }
  }
  return spec;
}

function zipSpecs(buf: Buffer, uid: string, spaceId: string, zipName: string): Spec[] {
  // one decompression budget for the archive and the archives nested in it (zip bombs)
  const budget = { bytes: 256 * 1024 * 1024, entries: 5000 };
  let entries: ZipEntry[];
  try {
    entries = readZip(buf, { budget }).filter((e) => !/(^|\/)\./.test(e.name));
    // nested zips (exports wrap "Export-….zip" inside) — unpack one level
    const inner = entries.filter((e) => /\.zip$/i.test(e.name));
    if (inner.length && entries.every((e) => /\.zip$/i.test(e.name) || !PAGE_EXT.test(e.name))) entries = inner.flatMap((e) => readZip(e.data, { budget }));
  } catch (e) {
    throw new ApiError(`${zipName}: ${(e as Error).message}`, 400);
  }
  // strip a single shared top folder
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  if (tops.size === 1 && entries.every((e) => e.name.includes('/'))) {
    const top = [...tops][0] + '/';
    entries = entries.map((e) => ({ ...e, name: e.name.slice(top.length) }));
  }
  const z: ZipCtx = { entries: new Map(entries.map((e) => [e.name, e])), ids: new Map(), consumed: new Set(), uid, spaceId, storedImages: new Map() };
  for (const k of z.entries.keys()) if (PAGE_EXT.test(k)) z.ids.set(k, newId());
  const specs: Spec[] = [];
  const roots = [...z.entries.keys()].filter((k) => PAGE_EXT.test(k) && dirOf(k) === '').sort();
  const preferAll = new Set(roots.filter((k) => /_all\.csv$/i.test(k)).map((k) => k.replace(/_all\.csv$/i, '.csv')));
  for (const k of roots) if (!z.consumed.has(k) && !preferAll.has(k)) specs.push(zipPageSpec(k, z));
  // orphan folders (no page file for them) → a page per folder holding its files
  const leftovers = [...z.entries.keys()].filter((k) => PAGE_EXT.test(k) && !z.consumed.has(k));
  const byTopFolder = new Map<string, string[]>();
  for (const k of leftovers) {
    const top = k.split('/')[0];
    byTopFolder.set(top, [...(byTopFolder.get(top) ?? []), k]);
  }
  for (const [folder, files] of byTopFolder) {
    const children: Spec[] = [];
    for (const f of files.sort()) if (!z.consumed.has(f)) children.push(zipPageSpec(f, z));
    specs.push({ type: 'page', text: titleFromFileName(folder), children });
  }
  if (!specs.length) throw new ApiError(`No Markdown, HTML or CSV files found in ${zipName}`, 400);
  return specs;
}

function countPages(specs: Spec[]): { pages: number; databases: number } {
  let pages = 0;
  let databases = 0;
  const walk = (s: Spec) => {
    if (s.type === 'page') pages++;
    if (s.type === 'collection_view_page' || s.type === 'collection_view') {
      databases++;
      for (const r of s.db?.rows ?? []) for (const c of r.children ?? []) walk(c);
    }
    for (const c of s.children ?? []) walk(c);
  };
  specs.forEach(walk);
  return { pages, databases };
}

function spaceOrThrow(spaceId: unknown, uid: string): SpaceRecord {
  const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
  if (!space || !space.permissions?.some((p) => p.type === 'user_permission' && p.user_id === uid && p.role !== 'none')) throw new ApiError('Not a member of this workspace', 403);
  return space;
}

/** The uploaded file a request names (only the uploader can import it). */
function uploadOf(f: any, uid: string, space: SpaceRecord) {
  const name = String(f?.name ?? 'Untitled').slice(0, 255);
  const file = readStoredFile(String(f?.url ?? f?.id ?? ''), uid);
  if (!file) throw new ApiError(`Upload not found: ${name}`, 404);
  const max = maxBytesFor(space, name);
  if (file.data.length > max && !/\.zip$/i.test(name)) throw new ApiError(`${name} is larger than ${Math.round(max / MB)} MB`, 413);
  return { name, file };
}

/** : about 120 files per 12 hours per user. */
function importRateLimit(uid: string, files: number) {
  for (let i = 0; i < files; i++) {
    if (!hit(`import:${uid}`, 120, 12 * 3600_000)) throw new RateLimitError('You’ve imported a lot of files recently. Try again in a few hours.');
  }
}

/** Database block (inline or full page) the user may add rows to, with its collection. */
function databaseOrThrow(blockId: unknown, uid: string): { block: BlockRecord; col: CollectionRecord } {
  const block = getRecord<BlockRecord>('block', String(blockId ?? ''));
  if (!block || blockRole(block.id, uid) === 'none') throw new ApiError('Not found', 404);
  if (block.type !== 'collection_view' && block.type !== 'collection_view_page') throw new ApiError('Merge with CSV works on databases', 400);
  const col = block.collection_id ? getRecord<CollectionRecord>('collection', block.collection_id) : undefined;
  if (!col || col.parent_id !== block.id) throw new ApiError('Open the original database to merge a CSV', 400);
  if (!roleAtLeast(blockRole(block.id, uid), 'read_and_write')) throw new ApiError('You need edit access to add rows', 403);
  return { block, col };
}

function csvRowsOf(name: string, data: Buffer): string[][] {
  if (/\.xlsx$/i.test(name)) return xlsxToRows(data);
  const text = decodeText(data);
  return /\.tsv$/i.test(name) ? tsvToRows(text) : parseCsv(text);
}

const MERGEABLE: PropertyType[] = ['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone_number'];

export const handlers: Record<string, Handler> = {
  importFiles(ctx, { spaceId, parent, files, csvTypes }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId, uid);
    const list = (Array.isArray(files) ? files : []).slice(0, MAX_FILES);
    if (!list.length) throw new ApiError('No files to import', 400);
    importRateLimit(uid, list.length);
    let target: { id: string; table: 'space' | 'block' } = { id: space.id, table: 'space' };
    let afterBlockId: string | undefined;
    if (parent?.kind === 'page' && parent.pageId) {
      const p = getRecord<BlockRecord>('block', String(parent.pageId));
      if (!p || p.space_id !== space.id || !roleAtLeast(blockRole(p.id, uid), 'read_and_write')) throw new ApiError('You can’t import into this page', 403);
      target = { id: p.id, table: 'block' };
      if (typeof parent.afterBlockId === 'string' && p.content?.includes(parent.afterBlockId)) afterBlockId = parent.afterBlockId;
    }
    const types: Record<number, PropertyType | 'skip'> = {};
    if (csvTypes && typeof csvTypes === 'object') {
      for (const [k, v] of Object.entries(csvTypes)) if (/^\d{1,3}$/.test(k) && (v === 'skip' || CSV_COLUMN_TYPES.includes(v as PropertyType))) types[Number(k)] = v as PropertyType | 'skip';
    }
    const specs: Spec[] = [];
    for (const f of list) {
      const { name, file } = uploadOf(f, uid, space);
      if (/\.zip$/i.test(name) || file.mime === 'application/zip') specs.push(...zipSpecs(file.data, uid, space.id, name));
      else if (IMPORT_EXT.test(name)) specs.push(pageFromFile(name, file.data, uid, space.id, {}, types));
      else throw new ApiError(`${name}: this file type can’t be imported`, 400);
    }
    const builder = new OpsBuilder(space.id, uid);
    const rootIds: string[] = [];
    for (const s of specs) {
      const extra: Record<string, unknown> = {};
      if (target.table === 'space') extra.permissions = [{ type: 'user_permission', role: 'editor', user_id: uid }];
      rootIds.push(builder.block(s, target.id, target.table, extra));
      if (builder.blockCount > MAX_BLOCKS) throw new ApiError('Import is too large', 413);
    }
    const ops: Operation[] = builder.ops;
    if (target.table === 'space') {
      const sv = spaceViewOf(uid, space.id);
      if (!sv) throw new ApiError('Workspace view not found', 404);
      for (const id of [...rootIds].reverse()) ops.push({ pointer: { table: 'space_view', id: sv.id, spaceId: space.id }, path: ['private_pages'], command: 'listBefore', args: { id } });
    } else {
      let after: string | undefined = afterBlockId;
      if (!after) {
        const p = getRecord<BlockRecord>('block', target.id);
        after = p?.content?.[p.content.length - 1];
      }
      for (const id of rootIds) {
        ops.push({ pointer: { table: 'block', id: target.id, spaceId: space.id }, path: ['content'], command: 'listAfter', args: after ? { id, after } : { id } });
        after = id;
      }
    }
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: space.id, debug: { userAction: 'importFiles' }, operations: ops }], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { pageIds: rootIds, ...countPages(specs), recordMap: rm.map };
  },

  /** CSV import step 2 (column mapping): header, inferred types and sample values; with blockId, the database to merge into. */
  previewCsv(ctx, { spaceId, url, name, blockId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId, uid);
    const { file } = uploadOf({ url, name }, uid, space);
    let rows: string[][];
    try {
      rows = csvRowsOf(String(name ?? 'file.csv'), file.data);
    } catch (e) {
      throw new ApiError((e as Error).message, 400);
    }
    const header = (rows[0] ?? []).map((h, i) => h.trim() || (i === 0 ? 'Name' : `Column ${i + 1}`));
    const body = rows.slice(1);
    const columns = header.map((h, i) => ({
      index: i, name: h, type: i === 0 ? 'title' : inferColumnType(h, body.map((r) => r[i] ?? '')),
      samples: body.slice(0, 3).map((r) => (r[i] ?? '').slice(0, 80)),
    }));
    let target: { blockId: string; name: string; properties: { id: string; name: string; type: string }[] } | undefined;
    if (blockId) {
      const { block, col } = databaseOrThrow(blockId, uid);
      target = { blockId: block.id, name: (col.name ?? []).map((d) => d[0]).join(''), properties: Object.entries(col.schema).filter(([, p]) => MERGEABLE.includes(p.type)).map(([id, p]) => ({ id, name: p.name, type: p.type })) };
    }
    return { columns, rows: body.length, types: CSV_COLUMN_TYPES, target };
  },

  /** "Merge with CSV": append the CSV's rows to an existing database (no updates of existing rows, as expected). */
  mergeCsv(ctx, { blockId, url, name, mapping }) {
    const uid = requireUser(ctx);
    const { block, col } = databaseOrThrow(blockId, uid);
    const space = spaceOrThrow(block.space_id, uid);
    importRateLimit(uid, 1);
    const { file } = uploadOf({ url, name }, uid, space);
    let rows: string[][];
    try {
      rows = csvRowsOf(String(name ?? 'file.csv'), file.data);
    } catch (e) {
      throw new ApiError((e as Error).message, 400);
    }
    if (rows.length < 2) throw new ApiError('The CSV has no rows', 400);
    if (rows.length > 10_001) throw new ApiError('Merge up to 10,000 rows at a time', 413);
    const header = rows[0].map((h) => h.trim());
    const schema = { ...col.schema };
    const byName = new Map(Object.entries(schema).map(([id, p]) => [p.name.trim().toLowerCase(), id]));
    const target: (string | null)[] = [];
    const newProps: Record<string, any> = {};
    header.forEach((h, i) => {
      const m = mapping && typeof mapping === 'object' ? (mapping as Record<string, string>)[String(i)] : undefined;
      if (m === 'skip') return void target.push(null);
      if (m && m !== 'new' && schema[m] && MERGEABLE.includes(schema[m].type)) return void target.push(m);
      if (!m && i === 0 && !byName.has(h.toLowerCase())) return void target.push('title');
      const existing = byName.get(h.toLowerCase());
      if (!m && existing && MERGEABLE.includes(schema[existing].type)) return void target.push(existing);
      if (!h) return void target.push(null);
      // unmatched column → a new Text property
      let id = shortPropId();
      while (schema[id]) id = shortPropId();
      schema[id] = { name: h, type: 'text' };
      newProps[id] = schema[id];
      byName.set(h.toLowerCase(), id);
      target.push(id);
    });
    const ops: Operation[] = [];
    const sp = block.space_id;
    // select / multi-select / status options that the CSV introduces
    const optionsAdded = new Map<string, Set<string>>();
    const now = Date.now();
    const rowIds: string[] = [];
    for (const r of rows.slice(1)) {
      if (r.every((c) => !c.trim())) continue;
      const properties: Record<string, any> = {};
      target.forEach((pid, i) => {
        if (!pid) return;
        const raw = (r[i] ?? '').trim();
        if (!raw) return;
        const prop = schema[pid];
        let v: any = raw;
        if (prop.type === 'number') v = Number(raw.replace(/[$€£₩¥,%\s]/g, ''));
        else if (prop.type === 'date') {
          const d = parseDateCell(raw);
          if (!d) return;
          v = { date: d };
        } else if (prop.type === 'multi_select') v = raw.split(',').map((x) => x.trim()).filter(Boolean);
        if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') {
          const known = new Set((prop.options ?? []).map((o) => o.value));
          for (const val of Array.isArray(v) ? v : [v]) if (!known.has(val)) optionsAdded.set(pid, (optionsAdded.get(pid) ?? new Set()).add(val));
        }
        const enc = encodeRowValue(prop, v);
        if (enc) properties[pid] = enc;
      });
      const id = newId();
      rowIds.push(id);
      ops.push({
        pointer: { table: 'block', id, spaceId: sp }, path: [], command: 'set',
        args: { id, type: 'page', properties, parent_id: col.id, parent_table: 'collection', space_id: sp, alive: true, created_time: now, created_by_id: uid, created_by_table: 'lit_user', last_edited_time: now, last_edited_by_id: uid, last_edited_by_table: 'lit_user' },
      });
    }
    const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
    for (const [pid, vals] of optionsAdded) {
      const prop = schema[pid];
      const opts = [...(prop.options ?? [])];
      for (const v of vals) opts.push({ id: newId(), value: v, color: COLORS[opts.length % COLORS.length] });
      schema[pid] = { ...prop, options: opts };
      if (prop.type === 'status' && prop.groups?.length) {
        const added = opts.slice((prop.options ?? []).length).map((o) => o.id);
        schema[pid].groups = prop.groups.map((g, gi) => (gi === 0 ? { ...g, optionIds: [...g.optionIds, ...added] } : g));
      }
    }
    if (Object.keys(newProps).length || optionsAdded.size) ops.unshift({ pointer: { table: 'collection', id: col.id, spaceId: sp }, path: ['schema'], command: 'set', args: schema });
    // new columns show up in every table view
    if (Object.keys(newProps).length) {
      for (const vid of block.view_ids ?? []) {
        const v = getRecord<any>('collection_view', vid);
        if (!v || v.type !== 'table') continue;
        const list = [...((v.format?.table_properties ?? []) as any[]), ...Object.keys(newProps).map((p) => ({ property: p, visible: true, width: 200 }))];
        ops.push({ pointer: { table: 'collection_view', id: vid, spaceId: sp }, path: ['format', 'table_properties'], command: 'set', args: list });
      }
    }
    // a user-initiated write: lock database and property access apply as to Litpage edits (dbaccess.ts)
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: sp, debug: { userAction: 'mergeCsv' }, operations: ops }], ctx.clientId, { userInitiated: true });
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { added: rowIds.length, newProperties: Object.values(newProps).map((p) => p.name), recordMap: rm.map };
  },
};
