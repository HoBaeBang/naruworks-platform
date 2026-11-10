// Public REST API under /v1: the API surface for internal connections and
// personal access tokens: users, search, pages (+ property items, Markdown), blocks, databases / data sources (query
// with filters and sorts), comments.
// Authorization: Bearer <token> · Litpage-Version: 2026-10-01 (optional)
// Every read and write runs as the token's principal (a connection's bot or the token's person): reads go through
// blockRole + the database property access rules (objects.ts), writes are ordinary transactions through
// applyTransactions(…, { client: true }) — the same TxGuard checks as the service (locks, property rules, pointers).
// Capabilities are checked per endpoint; rate limit NC_API_RATE_PER_MIN (default 180/min per token, typical clients ~3/s).
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { expandId, newId } from '@nc/shared/ids.ts';
import { op as mk, type Operation } from '@nc/shared/ops.ts';
import { isRestrictedMember, isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type {
  BlockRecord, CollectionRecord, CollectionViewRecord, CommentRecord, DiscussionRecord, PropertySchema, PropertyType, SpaceRecord, SpaceViewRecord,
  UserRecord, UserRootRecord,
} from '@nc/shared/records.ts';
import { normalize, toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../db.ts';
import { applyTransactions, blockRole } from '../records.ts';
import { hit } from '../ratelimit.ts';
import { OpsBuilder, shortPropId, type DbPropSpec, type Spec } from '../content/spec.ts';
import { deleteOps, markdownToSpecs, matchSelection } from '../ai/edit.ts';
import { handlers as commentHandlers } from '../api/modules/comments.ts';
import { propertyThreadVisible } from '../propaccess.ts';
import { personalTokenBlocked } from '../ai/litMcp.ts';
import { errorBody, invalid, notFound, PublicApiError, restricted } from './errors.ts';
import { API_VERSION, canListUsers, principalForToken, type Principal } from './principal.ts';
import {
  API_TEXT_TYPES, DATABASE_TYPES, PAGE_TYPES, apiBlockType, blockObject, commentObject, dataSourceObject, databaseObject, listObject, pageObject,
  propertyValueObject, readCtx, userObject, type ReadCtx,
} from './objects.ts';
import { codeLanguage, coverFromApi, findProperty, iconFromApi, propertiesFromApi, specsFromApi } from './inputs.ts';
import { COLORS, fromApiRichText, iso } from './richtext.ts';
import { compileFilter, compileSorts, sortRows } from './query.ts';
import { pageAsMarkdown, pageUnitsAs } from './markdown.ts';
import { recordRequest, integrationsInSpace, type Capabilities } from './store.ts';
import { DEMO_MESSAGE, isDemoMode } from '../demo.ts';

type Json = Record<string, any>;

interface Req {
  p: Principal;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Json;
  ctx: ReadCtx;
}

type Handler = (r: Req) => Json | Promise<Json>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(raw: string | undefined, name: string): string {
  const id = expandId(String(raw ?? '').trim()).toLowerCase();
  if (!UUID.test(id)) throw invalid(`Invalid request: path.${name} must be a valid uuid, instead was \`"${String(raw ?? '').slice(0, 60)}"\`.`);
  return id;
}

function bodyId(raw: unknown, path: string): string {
  const id = expandId(String(raw ?? '').trim()).toLowerCase();
  if (!UUID.test(id)) throw invalid(`Invalid request: ${path} must be a valid uuid, instead was \`${JSON.stringify(raw)?.slice(0, 60)}\`.`);
  return id;
}

function need(p: Principal, cap: keyof Capabilities) {
  if (!p.caps[cap]) throw restricted('Insufficient permissions for this endpoint.');
}

/** A block the principal can read (404 otherwise — no difference between "missing" and "not shared"). */
function readable(p: Principal, id: string, kind = 'block'): BlockRecord {
  const b = getRecord<BlockRecord>('block', id);
  if (!b || b.space_id !== p.spaceId || blockRole(id, p.id) === 'none') throw notFound(kind, id);
  return b;
}

function pageSize(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 100;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw invalid(`Invalid request: page_size must be a number between 1 and 100, instead was \`${JSON.stringify(raw)}\`.`);
  return n;
}

/** Cursor = id of the first item of the next page. */
function paginate<T>(items: T[], idOf: (t: T) => string, start: unknown, size: number): { page: T[]; next: string | null } {
  let from = 0;
  if (start !== undefined && start !== null && start !== '') {
    const s = expandId(String(start)).toLowerCase();
    from = items.findIndex((x) => idOf(x) === s);
    if (from < 0) throw invalid('Invalid request: start_cursor must be a valid cursor.');
  }
  const page = items.slice(from, from + size);
  const next = from + size < items.length ? idOf(items[from + size]) : null;
  return { page, next };
}

/** Apply operations as the principal (Litpage's write path); permission problems become forbidden. */
function applyAs(p: Principal, ops: Operation[], action: string) {
  if (!ops.length) return [];
  try {
    return applyTransactions(p.id, [{ id: newId(), spaceId: p.spaceId, debug: { userAction: `api.${action}` }, operations: ops }], undefined, { client: true, source: `api:${p.key}` });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    const msg = String((e as Error)?.message ?? e);
    const reason = msg.split(': ').slice(-1)[0].replace(/ \([^)]*\)$/, '');
    if (status === 403) throw restricted(reason && !/^Permission denied/.test(reason) ? reason : 'Insufficient permissions for this resource.');
    throw invalid(reason || 'The change couldn’t be applied.');
  }
}

const now = () => Date.now();
const touchFields = (p: Principal) => ({ last_edited_time: now(), last_edited_by_id: p.id, last_edited_by_table: 'lit_user' });

function ptr(b: { id: string; space_id: string }, table: 'block' | 'collection' | 'collection_view' = 'block') {
  return { table, id: b.id, spaceId: b.space_id } as const;
}

// ---------------------------------------------------------------- users

function workspaceUserIds(p: Principal): string[] {
  const space = getRecord<SpaceRecord>('space', p.spaceId);
  const people = (space?.permissions ?? []).filter((x) => x.type === 'user_permission' && x.user_id && x.role !== 'none').map((x) => x.user_id!);
  const bots = integrationsInSpace(p.spaceId).map((i) => i.botId);
  return [...new Set([...people, ...bots])];
}

const usersMe: Handler = ({ p }) => userObject(p.id, { ...p, caps: { ...p.caps, user_info: p.kind === 'personal' ? 'with_email' : p.caps.user_info === 'none' ? 'no_email' : p.caps.user_info } });

const usersList: Handler = ({ p, query }) => {
  if (!canListUsers(p)) {
    if (p.kind === 'personal') return listObject([userObject(p.id, p)], null, 'user');
    throw restricted();
  }
  const ids = workspaceUserIds(p).sort();
  const { page, next } = paginate(ids, (x) => x, query.start_cursor, pageSize(query.page_size));
  return listObject(page.map((id) => userObject(id, p)), next, 'user');
};

const usersGet: Handler = ({ p, params }) => {
  const id = idParam(params.id, 'user_id');
  if (id !== p.id) {
    if (!canListUsers(p)) throw (p.kind === 'personal' ? notFound('user', id) : restricted());
    if (!workspaceUserIds(p).includes(id)) throw notFound('user', id);
  }
  return userObject(id, p);
};

// ---------------------------------------------------------------- search

function titleOf(b: BlockRecord): string {
  if (DATABASE_TYPES.has(b.type) && b.collection_id) return toPlainText(getRecord<CollectionRecord>('collection', b.collection_id)?.name);
  return toPlainText(b.properties?.title).replace(/[‣⁍]/g, '');
}

const search: Handler = ({ p, body, ctx }) => {
  need(p, 'read_content');
  const q = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
  const f = body.filter;
  let want: 'page' | 'data_source' | null = null;
  if (f !== undefined && f !== null) {
    if (f.property !== 'object' || !['page', 'data_source'].includes(f.value)) {
      throw invalid('Invalid request: filter.value must be "page" or "data_source".');
    }
    want = f.value;
  }
  const dir = body.sort?.direction === 'ascending' ? 1 : -1;
  if (body.sort && body.sort.timestamp !== undefined && body.sort.timestamp !== 'last_edited_time') throw invalid('Invalid request: body.sort.timestamp must be `"last_edited_time"`.');
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND json_extract(data, '$.type') IN ('page', 'collection_view_page', 'collection_view') ORDER BY last_edited_time DESC LIMIT 20000`).all(p.spaceId) as { data: string }[];
  const hits: BlockRecord[] = [];
  for (const r of rows) {
    const b = JSON.parse(r.data) as BlockRecord;
    if (b.is_template) continue;
    const isDb = DATABASE_TYPES.has(b.type);
    if (want === 'page' && isDb) continue;
    if (want === 'data_source' && !isDb) continue;
    if (q && !titleOf(b).toLowerCase().includes(q)) continue;
    if (!ctx.canRead(b.id)) continue;
    hits.push(b);
  }
  hits.sort((a, b) => ((a.last_edited_time ?? a.created_time) - (b.last_edited_time ?? b.created_time)) * dir || (a.id < b.id ? -1 : 1));
  // Database blocks are represented by their current data source.
  const asDataSource = (b: BlockRecord): CollectionRecord | undefined =>
    DATABASE_TYPES.has(b.type) && b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
  // cursor = id of the next result object
  const { page, next } = paginate(hits, (b) => asDataSource(b)?.id ?? b.id, body.start_cursor, pageSize(body.page_size));
  const results = page.map((b) => {
    if (!DATABASE_TYPES.has(b.type)) return pageObject(b, ctx);
    const col = asDataSource(b);
    return col ? dataSourceObject(col, ctx) : databaseObject(b, ctx);
  });
  return { ...listObject(results, next, 'page_or_data_source'), type: 'page_or_data_source', page_or_data_source: {} };
};

// ---------------------------------------------------------------- pages

function pageOr404(p: Principal, id: string): BlockRecord {
  const b = readable(p, id, 'page');
  if (!PAGE_TYPES.has(b.type) && b.parent_table !== 'collection') throw notFound('page', id);
  if (b.type === 'collection_view_page') throw invalid(`Provided ID ${id} is a database, not a page. Use the retrieve database API instead.`);
  return b;
}

const pagesGet: Handler = ({ p, params, ctx }) => {
  need(p, 'read_content');
  return pageObject(pageOr404(p, idParam(params.id, 'page_id')), ctx);
};

const pagePropertyGet: Handler = ({ p, params, ctx }) => {
  need(p, 'read_content');
  const page = ctx.row(pageOr404(p, idParam(params.id, 'page_id')));
  const key = decodeURIComponent(String(params.pid ?? ''));
  let schema: Record<string, PropertySchema> = { title: { name: 'title', type: 'title' } };
  if (page.parent_table === 'collection') {
    const col = getRecord<CollectionRecord>('collection', page.parent_id);
    if (col) schema = ctx.collection(col).schema;
  }
  const pid = findProperty(schema, key);
  if (!pid) throw notFound('property', key);
  const v = propertyValueObject(page, pid, schema[pid], schema, ctx);
  const type = String(v.type);
  if (['title', 'rich_text', 'people', 'relation'].includes(type)) {
    const items = (v[type] as unknown[]).map((x) => ({ object: 'property_item', id: v.id, type, [type === 'rich_text' || type === 'title' ? type : type === 'people' ? 'people' : 'relation']: x }));
    return { object: 'list', results: items, next_cursor: null, has_more: false, type: 'property_item', property_item: { id: v.id, next_url: null, type, [type]: {} }, request_id: '' };
  }
  return { object: 'property_item', ...v };
};

/** Where a new page goes: a page, a database / data source (row) or (personal tokens) the person's private pages. */
function resolvePageParent(p: Principal, parent: unknown): { kind: 'page'; block: BlockRecord } | { kind: 'row'; col: CollectionRecord; block: BlockRecord } | { kind: 'private'; sv: SpaceViewRecord } {
  const o = (parent ?? {}) as Json;
  if (o.workspace === true || o.type === 'workspace') {
    if (p.kind !== 'personal') throw invalid('Invalid request: body.parent.workspace can only be used by public connections and personal access tokens.');
    const root = getRecord<UserRootRecord>('user_root', p.id);
    const sv = (root?.space_views ?? []).map((id) => getRecord<SpaceViewRecord>('space_view', id)).find((v) => v && v.space_id === p.spaceId && v.parent_id === p.id);
    if (!sv) throw restricted();
    return { kind: 'private', sv };
  }
  if (o.page_id) {
    const b = readable(p, bodyId(o.page_id, 'body.parent.page_id'), 'page');
    if (DATABASE_TYPES.has(b.type)) throw invalid('Invalid request: body.parent.page_id is a database. Use body.parent.database_id or data_source_id.');
    return { kind: 'page', block: b };
  }
  const dsId = o.data_source_id ? bodyId(o.data_source_id, 'body.parent.data_source_id') : null;
  const dbId = o.database_id ? bodyId(o.database_id, 'body.parent.database_id') : null;
  if (dsId || dbId) {
    let col = dsId ? getRecord<CollectionRecord>('collection', dsId) : undefined;
    let block = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
    if (!col && dbId) {
      block = getRecord<BlockRecord>('block', dbId);
      col = block?.collection_id ? getRecord<CollectionRecord>('collection', block.collection_id) : undefined;
    }
    if (!col || !block || col.alive === false || block.space_id !== p.spaceId || blockRole(block.id, p.id) === 'none') throw notFound(dsId ? 'data_source' : 'database', (dsId ?? dbId)!);
    return { kind: 'row', col, block };
  }
  throw invalid('Invalid request: body.parent is required, instead was `undefined`.');
}

const pagesCreate: Handler = ({ p, body, ctx }) => {
  need(p, 'insert_content');
  const parent = resolvePageParent(p, body.parent);
  const reader = { principalId: p.id };
  const spaceId = p.spaceId;
  const b = new OpsBuilder(spaceId, p.id);
  if (body.children !== undefined && body.markdown !== undefined) throw invalid('Invalid request: use either body.children or body.markdown.');
  const children: Spec[] = body.markdown !== undefined
    ? (typeof body.markdown === 'string' && body.markdown.length <= 500_000 ? markdownToSpecs(body.markdown) : (() => { throw invalid('Invalid request: body.markdown must be a string.'); })())
    : body.children !== undefined ? specsFromApi(body.children, reader, spaceId) : [];
  const icon = body.icon !== undefined ? iconFromApi(body.icon) ?? undefined : undefined;
  const cover = body.cover !== undefined ? coverFromApi(body.cover) ?? undefined : undefined;
  let id = '';
  if (parent.kind === 'row') {
    const visible = ctx.collection(parent.col);
    const enc = propertiesFromApi(body.properties, visible, reader, spaceId, { allowCreateOptions: true });
    const props: Record<string, RichText> = {};
    for (const [pid, v] of Object.entries(enc.properties)) if (v) props[pid] = v;
    id = b.block({ type: 'page', text: enc.title ?? [], props, icon, cover, children }, parent.col.id, 'collection');
    for (const vid of parent.block.view_ids ?? []) {
      const v = getRecord<CollectionViewRecord>('collection_view', vid);
      if (v?.page_sort?.length) b.ops.push(mk.listAfter(ptr(v, 'collection_view'), ['page_sort'], id));
    }
    if (Object.keys(enc.schemaPatch).length) {
      b.ops.push(mk.update({ table: 'collection', id: parent.col.id, spaceId }, ['schema'], enc.schemaPatch));
    }
  } else {
    const enc = propertiesFromApi(body.properties, undefined, reader, spaceId, { allowCreateOptions: false });
    if (parent.kind === 'page') {
      id = b.block({ type: 'page', text: enc.title ?? [], icon, cover, children }, parent.block.id, 'block');
      b.ops.push(mk.listAfter(ptr(parent.block), ['content'], id));
    } else {
      id = b.block({ type: 'page', text: enc.title ?? [], icon, cover, children }, spaceId, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: p.id }] });
      b.ops.push(mk.listBefore({ table: 'space_view', id: parent.sv.id, spaceId }, ['private_pages'], id));
    }
  }
  applyAs(p, b.ops, 'createPage');
  return pageObject(getRecord<BlockRecord>('block', id)!, readCtx(p));
};

function restoreOps(b: BlockRecord): Operation[] {
  const ops: Operation[] = [mk.update(ptr(b), [], { alive: true, deleted_time: undefined, deleted_by_id: undefined })];
  if (b.parent_table === 'block') {
    const parent = getRecord<BlockRecord>('block', b.parent_id);
    if (parent?.alive !== false && !(parent?.content ?? []).includes(b.id)) ops.push(mk.listAfter({ table: 'block', id: b.parent_id, spaceId: b.space_id }, ['content'], b.id));
  } else if (b.parent_table === 'team') {
    ops.push(mk.listAfter({ table: 'team', id: b.parent_id, spaceId: b.space_id }, ['team_pages'], b.id));
  }
  return ops;
}

function trashFlag(body: Json): boolean | undefined {
  if (typeof body.in_trash === 'boolean') return body.in_trash;
  if (typeof body.archived === 'boolean') return body.archived;
  return undefined;
}

const pagesUpdate: Handler = ({ p, params, body, ctx }) => {
  need(p, 'update_content');
  const id = idParam(params.id, 'page_id');
  const page = getRecord<BlockRecord>('block', id);
  if (!page || page.space_id !== p.spaceId || blockRole(id, p.id) === 'none') throw notFound('page', id);
  if (page.type === 'collection_view_page') throw invalid(`Provided ID ${id} is a database, not a page. Use the update database API instead.`);
  const reader = { principalId: p.id };
  const ops: Operation[] = [];
  const fmt: Json = {};
  if (body.properties !== undefined) {
    const col = page.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', page.parent_id) : undefined;
    const enc = propertiesFromApi(body.properties, col ? ctx.collection(col) : undefined, reader, p.spaceId, { allowCreateOptions: true });
    if (enc.title) ops.push(mk.set(ptr(page), ['properties', 'title'], enc.title));
    for (const [pid, v] of Object.entries(enc.properties)) ops.push(mk.set(ptr(page), ['properties', pid], v ?? []));
    if (col && Object.keys(enc.schemaPatch).length) ops.push(mk.update({ table: 'collection', id: col.id, spaceId: p.spaceId }, ['schema'], enc.schemaPatch));
  }
  if (body.icon !== undefined) fmt.page_icon = iconFromApi(body.icon) ?? undefined;
  if (body.cover !== undefined) {
    fmt.page_cover = coverFromApi(body.cover) ?? undefined;
    if (fmt.page_cover) fmt.page_cover_position = 0.5;
  }
  if (typeof body.is_locked === 'boolean') fmt.block_locked = body.is_locked || undefined;
  if (Object.keys(fmt).length) ops.push(mk.update(ptr(page), ['format'], fmt));
  const trash = trashFlag(body);
  if (ops.length) ops.push(mk.update(ptr(page), [], touchFields(p)));
  if (trash === true && page.alive !== false) ops.push(...deleteOps([page], p.id));
  if (trash === false && page.alive === false) ops.push(...restoreOps(page));
  applyAs(p, ops, 'updatePage');
  return pageObject(getRecord<BlockRecord>('block', id)!, readCtx(p));
};

const pagesMarkdownGet: Handler = ({ p, params, ctx }) => {
  need(p, 'read_content');
  const page = readable(p, idParam(params.id, 'page_id'), 'page');
  if (!PAGE_TYPES.has(page.type) && page.parent_table !== 'collection') throw notFound('page', page.id);
  const md = pageAsMarkdown(page, ctx);
  return { object: 'page_markdown', id: page.id, markdown: md.markdown, truncated: md.truncated };
};

const pagesMarkdownUpdate: Handler = ({ p, params, body, ctx }) => {
  need(p, 'update_content');
  const page = readable(p, idParam(params.id, 'page_id'), 'page');
  if (page.type !== 'page') throw invalid('Only pages can be edited with Markdown.');
  const type = String(body.type ?? '');
  const data = (body[type] ?? {}) as Json;
  if (typeof data.content !== 'string' || data.content.length > 500_000) throw invalid(`Invalid request: body.${type || 'type'}.content must be a string.`);
  const specs = markdownToSpecs(data.content);
  const b = new OpsBuilder(p.spaceId, p.id);
  const ptrPage = ptr(page);
  const insertAt = (after?: string) => {
    let prev = after;
    for (const s of specs) {
      const id = b.block(s, page.id, 'block');
      b.ops.push(mk.listAfter(ptrPage, ['content'], id, prev));
      prev = id;
    }
  };
  if (type === 'insert_content') {
    const after = data.after ? bodyId(data.after, 'body.insert_content.after') : undefined;
    if (after && !(page.content ?? []).includes(after)) throw invalid('Invalid request: body.insert_content.after must be a block of this page.');
    insertAt(after ?? (page.content ?? []).filter((id) => getRecord<BlockRecord>('block', id)?.alive !== false).slice(-1)[0]);
  } else if (type === 'replace_content') {
    const kids = (page.content ?? []).map((id) => getRecord<BlockRecord>('block', id)).filter((x): x is BlockRecord => !!x && x.alive !== false && x.type !== 'page' && x.type !== 'collection_view_page');
    b.ops.push(...deleteOps(kids, p.id));
    insertAt(undefined);
  } else if (type === 'replace_content_range') {
    if (typeof data.content_range !== 'string' || !data.content_range.trim()) throw invalid('Invalid request: body.replace_content_range.content_range must be "start...end" text of the page.');
    const units = pageUnitsAs(page.id, ctx);
    let range: { first: number; last: number };
    try {
      range = matchSelection(units, data.content_range);
    } catch (e) {
      throw invalid(String((e as Error)?.message ?? 'The content range was not found.'));
    }
    const doomed = units.slice(range.first, range.last + 1).map((u) => getRecord<BlockRecord>('block', u.id)).filter((x): x is BlockRecord => !!x && x.alive !== false);
    const before = range.first > 0 ? units[range.first - 1].id : undefined;
    b.ops.push(...deleteOps(doomed, p.id));
    insertAt(before);
  } else {
    throw invalid('Invalid request: body.type must be `"insert_content"`, `"replace_content"` or `"replace_content_range"`.');
  }
  b.ops.push(mk.update(ptrPage, [], touchFields(p)));
  applyAs(p, b.ops, 'updatePageMarkdown');
  const md = pageAsMarkdown(getRecord<BlockRecord>('block', page.id)!, readCtx(p));
  return { object: 'page_markdown', id: page.id, markdown: md.markdown, truncated: md.truncated };
};

// ---------------------------------------------------------------- blocks

const blocksGet: Handler = ({ p, params, ctx }) => {
  need(p, 'read_content');
  return blockObject(readable(p, idParam(params.id, 'block_id')), ctx);
};

const blocksChildren: Handler = ({ p, params, query, ctx }) => {
  need(p, 'read_content');
  const b = readable(p, idParam(params.id, 'block_id'));
  const kids = (b.content ?? []).map((id) => getRecord<BlockRecord>('block', id)).filter((x): x is BlockRecord => !!x && x.alive !== false && x.parent_id === b.id && ctx.canRead(x.id));
  const { page, next } = paginate(kids, (x) => x.id, query.start_cursor, pageSize(query.page_size));
  return listObject(page.map((x) => blockObject(x, ctx)), next, 'block');
};

const NO_CHILDREN = new Set(['divider', 'equation', 'code', 'image', 'video', 'audio', 'file', 'pdf', 'bookmark', 'embed', 'table_of_contents', 'breadcrumb', 'alias', 'link_to_page', 'transclusion_reference', 'collection_view', 'collection_view_page', 'table_row']);

const blocksAppend: Handler = ({ p, params, body, ctx }) => {
  need(p, 'insert_content');
  const parent = readable(p, idParam(params.id, 'block_id'));
  if (NO_CHILDREN.has(parent.type)) throw invalid(`Block type ${apiBlockType(parent)} does not support children.`);
  const specs = specsFromApi(body.children, { principalId: p.id }, p.spaceId);
  if (parent.type === 'table' && specs.some((s) => s.type !== 'table_row')) throw invalid('Tables only take table_row children.');
  let after: string | undefined;
  const pos = body.position as Json | undefined;
  const kids = (parent.content ?? []).filter((id) => getRecord<BlockRecord>('block', id)?.alive !== false);
  if (body.after !== undefined) after = bodyId(body.after, 'body.after');
  else if (pos?.type === 'after_block') after = bodyId(pos.after_block?.id, 'body.position.after_block.id');
  else if (pos?.type === 'start') after = undefined;
  else after = kids[kids.length - 1];
  if (after && !kids.includes(after)) throw invalid('Invalid request: body.after must be a child of the block.');
  const b = new OpsBuilder(p.spaceId, p.id);
  const ids: string[] = [];
  let prev = after;
  specs.forEach((s, i) => {
    const id = b.block(s, parent.id, 'block');
    ids.push(id);
    if (i === 0 && pos?.type === 'start') b.ops.push(mk.listBefore(ptr(parent), ['content'], id));
    else b.ops.push(mk.listAfter(ptr(parent), ['content'], id, prev));
    prev = id;
  });
  b.ops.push(mk.update(ptr(parent), [], touchFields(p)));
  applyAs(p, b.ops, 'appendBlockChildren');
  const fresh = readCtx(p);
  return listObject(ids.map((id) => blockObject(getRecord<BlockRecord>('block', id)!, fresh)), null, 'block');
};

const blocksUpdate: Handler = ({ p, params, body }) => {
  need(p, 'update_content');
  const id = idParam(params.id, 'block_id');
  const b = readable(p, id);
  const reader = { principalId: p.id };
  const type = apiBlockType(b);
  const ops: Operation[] = [];
  const trash = trashFlag(body);
  const data = body[type] as Json | undefined;
  const otherType = Object.keys(body).find((k) => k !== type && k !== 'in_trash' && k !== 'archived' && k !== 'type' && k !== 'object');
  if (otherType && !data) throw invalid(`Invalid request: block type can’t be changed (block is a ${type}).`);
  if (data && typeof data === 'object') {
    const fmt: Json = {};
    const props: Json = {};
    if (API_TEXT_TYPES[type]) {
      if (data.rich_text !== undefined) props.title = fromApiRichText(data.rich_text, reader, `body.${type}.rich_text`);
      if (data.color !== undefined) {
        if (data.color !== 'default' && !COLORS.includes(data.color)) throw invalid(`Invalid request: body.${type}.color must be a valid color.`);
        fmt.block_color = data.color === 'default' ? undefined : data.color;
      }
      if (type === 'to_do' && typeof data.checked === 'boolean') props.checked = [[data.checked ? 'Yes' : 'No']];
      if (type.startsWith('heading_') && typeof data.is_toggleable === 'boolean') fmt.toggleable = data.is_toggleable || undefined;
      if (type === 'callout' && data.icon !== undefined) fmt.page_icon = iconFromApi(data.icon, `body.callout.icon`) ?? undefined;
    } else if (type === 'code') {
      if (data.rich_text !== undefined) props.title = [[toPlainText(fromApiRichText(data.rich_text, reader, 'body.code.rich_text'))]];
      if (data.language !== undefined) props.language = [[codeLanguage(data.language)]];
      if (data.caption !== undefined) props.caption = fromApiRichText(data.caption, reader, 'body.code.caption');
    } else if (type === 'equation') {
      if (typeof data.expression !== 'string') throw invalid('Invalid request: body.equation.expression must be a string.');
      props.title = [[data.expression.slice(0, 5000)]];
    } else if (['image', 'video', 'audio', 'file', 'pdf', 'bookmark', 'embed'].includes(type)) {
      const url = data.external?.url ?? data.url;
      if (url !== undefined) {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw invalid(`Invalid request: body.${type}.url must be a valid URL.`);
        props.source = [[url]];
        if (type === 'bookmark') props.link = [[url]];
        else fmt.display_source = url;
      }
      if (data.caption !== undefined) props.caption = fromApiRichText(data.caption, reader, `body.${type}.caption`);
    } else if (type === 'table_row') {
      const parent = getRecord<BlockRecord>('block', b.parent_id);
      const order = ((parent?.format as Json | undefined)?.table_block_column_order as string[] | undefined) ?? [];
      if (!Array.isArray(data.cells) || data.cells.length !== order.length) throw invalid(`Invalid request: body.table_row.cells must have ${order.length} cells.`);
      data.cells.forEach((c: unknown, i: number) => { props[order[i]] = fromApiRichText(c, reader, `body.table_row.cells[${i}]`); });
    } else if (type === 'table') {
      if (typeof data.has_column_header === 'boolean') fmt.table_block_column_header = data.has_column_header;
      if (typeof data.has_row_header === 'boolean') fmt.table_block_row_header = data.has_row_header;
    } else if (type === 'child_page') {
      if (data.title !== undefined) props.title = typeof data.title === 'string' ? (data.title ? [[data.title.slice(0, 2000)]] : []) : fromApiRichText(data.title, reader, 'body.child_page.title');
    } else if (type === 'table_of_contents') {
      if (data.color !== undefined) fmt.block_color = data.color === 'default' ? undefined : data.color;
    } else {
      throw invalid(`Block type ${type} can’t be updated through the API.`);
    }
    for (const [k, v] of Object.entries(props)) ops.push(mk.set(ptr(b), ['properties', k], v));
    if (Object.keys(fmt).length) ops.push(mk.update(ptr(b), ['format'], fmt));
    if (ops.length) ops.push(mk.update(ptr(b), [], touchFields(p)));
  }
  if (trash === true && b.alive !== false) ops.push(...deleteOps([b], p.id));
  if (trash === false && b.alive === false) ops.push(...restoreOps(b));
  applyAs(p, ops, 'updateBlock');
  return blockObject(getRecord<BlockRecord>('block', id)!, readCtx(p));
};

const blocksDelete: Handler = ({ p, params }) => {
  need(p, 'update_content');
  const id = idParam(params.id, 'block_id');
  const b = readable(p, id);
  if (b.alive !== false) applyAs(p, deleteOps([b], p.id), 'deleteBlock');
  return blockObject(getRecord<BlockRecord>('block', id)!, readCtx(p));
};

// ---------------------------------------------------------------- databases / data sources

function databaseOr404(p: Principal, id: string): BlockRecord {
  const b = getRecord<BlockRecord>('block', id);
  if (!b || !DATABASE_TYPES.has(b.type) || b.space_id !== p.spaceId || blockRole(id, p.id) === 'none') {
    // A data source id passed to /databases/ (or the other way round) gets a helpful 404
    throw notFound('database', id);
  }
  return b;
}

function dataSourceOr404(p: Principal, id: string): { col: CollectionRecord; block: BlockRecord } {
  const col = getRecord<CollectionRecord>('collection', id);
  const block = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
  if (!col || !block || block.space_id !== p.spaceId || blockRole(block.id, p.id) === 'none') throw notFound('data_source', id);
  return { col, block };
}

const databasesGet: Handler = ({ p, params, ctx }) => {
  need(p, 'read_content');
  return databaseObject(databaseOr404(p, idParam(params.id, 'database_id')), ctx);
};

const dataSourcesGet: Handler = ({ p, params, ctx }) => {
  need(p, 'read_content');
  return dataSourceObject(dataSourceOr404(p, idParam(params.id, 'data_source_id')).col, ctx);
};

function queryRows(r: Req, col0: CollectionRecord): Json {
  const { p, body, ctx } = r;
  need(p, 'read_content');
  const col = ctx.collection(col0);
  const schema = col.schema;
  const pred = compileFilter(body.filter, schema, ctx.query);
  const sorts = compileSorts(body.sorts, schema);
  const archived = body.in_trash === true || body.archived === true;
  const rows = (ctx.query.rowsOf?.(col.id) ?? []).filter((row) => (archived ? true : row.alive !== false));
  const matched = sortRows(rows.filter(pred), sorts, schema, ctx.query);
  const { page, next } = paginate(matched, (b) => b.id, body.start_cursor, pageSize(body.page_size));
  return listObject(page.map((b) => pageObject(b, ctx)), next, 'page_or_data_source');
}

const databasesQuery: Handler = (r) => {
  const block = databaseOr404(r.p, idParam(r.params.id, 'database_id'));
  const col = block.collection_id ? getRecord<CollectionRecord>('collection', block.collection_id) : undefined;
  if (!col) throw notFound('database', block.id);
  return queryRows(r, col);
};

const dataSourcesQuery: Handler = (r) => queryRows(r, dataSourceOr404(r.p, idParam(r.params.id, 'data_source_id')).col);

const API_TO_TYPE: Record<string, PropertyType> = {
  title: 'title', rich_text: 'text', number: 'number', select: 'select', multi_select: 'multi_select', status: 'status', date: 'date',
  people: 'person', files: 'file', checkbox: 'checkbox', url: 'url', email: 'email', phone_number: 'phone_number', formula: 'formula',
  relation: 'relation', created_time: 'created_time', created_by: 'created_by', last_edited_time: 'last_edited_time', last_edited_by: 'last_edited_by',
  unique_id: 'auto_increment_id', place: 'place',
};

/** API property configuration → stored schema entry. */
function schemaFromApi(name: string, config: Json, p: Principal, path: string): PropertySchema {
  const apiType = Object.keys(config).find((k) => API_TO_TYPE[k] && k !== 'name' && k !== 'description') ?? String(config.type ?? '');
  const type = API_TO_TYPE[apiType];
  if (!type) throw invalid(`Invalid request: ${path} must specify a supported property type.`);
  const c = (config[apiType] ?? {}) as Json;
  const out: PropertySchema = { name, type };
  const opts = (list: unknown) => (Array.isArray(list) ? list : []).slice(0, 100).map((o: Json, i: number) => {
    if (typeof o?.name !== 'string' || !o.name || o.name.includes(',')) throw invalid(`Invalid request: ${path}.${apiType}.options[${i}].name must be a non-empty string without commas.`);
    return { id: newId(), value: o.name.slice(0, 100), color: COLORS.slice(0, 10).includes(o.color) ? o.color : 'default' };
  });
  if (type === 'select' || type === 'multi_select') out.options = opts(c.options);
  if (type === 'number' && typeof c.format === 'string') out.number_format = c.format;
  if (type === 'formula') {
    if (typeof c.expression !== 'string' || !c.expression) throw invalid(`Invalid request: ${path}.formula.expression is required.`);
    out.formula = { expression: c.expression.slice(0, 10_000) };
  }
  if (type === 'auto_increment_id' && typeof c.prefix === 'string' && c.prefix) out.prefix = c.prefix.slice(0, 10);
  if (type === 'relation') {
    const ds = c.data_source_id ? bodyId(c.data_source_id, `${path}.relation.data_source_id`) : null;
    const dbId = c.database_id ? bodyId(c.database_id, `${path}.relation.database_id`) : null;
    let target = ds ? getRecord<CollectionRecord>('collection', ds) : undefined;
    if (!target && dbId) {
      const blk = getRecord<BlockRecord>('block', dbId);
      target = blk?.collection_id ? getRecord<CollectionRecord>('collection', blk.collection_id) : undefined;
    }
    if (!target || blockRole(target.parent_id, p.id) === 'none') throw invalid(`Invalid request: ${path}.relation must point at a database available to this connection.`);
    out.collection_id = target.id;
  }
  return out;
}

function schemaFromProperties(raw: unknown, p: Principal, path: string): Record<string, PropertySchema> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`Invalid request: ${path} must be an object.`);
  const out: Record<string, PropertySchema> = {};
  let titles = 0;
  for (const [name, config] of Object.entries(raw as Json)) {
    if (!config || typeof config !== 'object') throw invalid(`Invalid request: ${path}.${name} must be an object.`);
    const prop = schemaFromApi(String((config as Json).name ?? name).slice(0, 200), config as Json, p, `${path}.${name}`);
    if (prop.type === 'title') {
      titles++;
      out.title = prop;
    } else out[shortPropId()] = prop;
  }
  if (titles !== 1) throw invalid(`Invalid request: ${path} must contain exactly one title property.`);
  return out;
}

const databasesCreate: Handler = ({ p, body }) => {
  need(p, 'insert_content');
  const parentId = body.parent?.page_id ? bodyId(body.parent.page_id, 'body.parent.page_id') : null;
  if (!parentId) throw invalid('Invalid request: body.parent.page_id is required.');
  const parent = readable(p, parentId, 'page');
  if (parent.type !== 'page') throw invalid('Invalid request: body.parent.page_id must be a page.');
  const reader = { principalId: p.id };
  const propsRaw = body.initial_data_source?.properties ?? body.properties ?? { Name: { title: {} } };
  const schema = schemaFromProperties(propsRaw, p, body.initial_data_source ? 'body.initial_data_source.properties' : 'body.properties');
  const title = fromApiRichText(body.title ?? [], reader, 'body.title');
  const description = fromApiRichText(body.description ?? [], reader, 'body.description');
  const inline = body.is_inline === true;
  const b = new OpsBuilder(p.spaceId, p.id);
  const dbSchema: Record<string, DbPropSpec> = {};
  for (const [pid, prop] of Object.entries(schema)) dbSchema[pid] = { name: prop.name, type: prop.type, options: prop.options?.map((o) => ({ value: o.value, color: o.color })), number_format: prop.number_format };
  const icon = body.icon !== undefined ? iconFromApi(body.icon) ?? undefined : undefined;
  const cover = body.cover !== undefined ? coverFromApi(body.cover) ?? undefined : undefined;
  const id = b.block({ type: inline ? 'collection_view' : 'collection_view_page', icon, cover, db: { name: toPlainText(title), schema: dbSchema, rows: [], views: [{ type: 'table' }] } }, parent.id, 'block');
  // full schema (formula, relation, unique id prefixes) and rich title / description on the created collection
  const colOp = b.ops.find((o) => o.pointer.table === 'collection' && o.command === 'set');
  if (colOp) {
    const s = colOp.args.schema as Record<string, PropertySchema>;
    for (const [pid, prop] of Object.entries(schema)) s[pid] = { ...s[pid], ...prop, options: s[pid]?.options ?? prop.options };
    colOp.args.name = title;
    if (description.length) colOp.args.description = description;
  }
  b.ops.push(mk.listAfter(ptr(parent), ['content'], id));
  applyAs(p, b.ops, 'createDatabase');
  return databaseObject(getRecord<BlockRecord>('block', id)!, readCtx(p));
};

/** Schema edits: { Name: { name: "New" } | null (delete) | { <type>: config } } on the visible schema. */
function schemaPatchOps(p: Principal, col: CollectionRecord, visible: CollectionRecord, raw: unknown, path: string): Operation[] {
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`Invalid request: ${path} must be an object.`);
  const ops: Operation[] = [];
  const cp = { table: 'collection' as const, id: col.id, spaceId: col.space_id };
  for (const [key, change] of Object.entries(raw as Json)) {
    const pid = findProperty(visible.schema, key);
    if (change === null) {
      if (!pid) throw invalid(`No property named ${key} exists in this data source.`);
      if (visible.schema[pid].type === 'title') throw invalid('The title property cannot be deleted.');
      // same as Delete property : kept under deleted_schema (restorable), gone from the schema
      ops.push(mk.set(cp, ['deleted_schema', pid], { ...col.schema[pid], deleted_time: now() }));
      ops.push(mk.set(cp, ['schema', pid], undefined));
      continue;
    }
    if (!change || typeof change !== 'object') throw invalid(`Invalid request: ${path}.${key} must be an object or \`null\`.`);
    const hasType = Object.keys(change).some((k) => API_TO_TYPE[k]);
    if (!pid) {
      if (!hasType) throw invalid(`No property named ${key} exists in this data source.`);
      const prop = schemaFromApi(String((change as Json).name ?? key).slice(0, 200), change as Json, p, `${path}.${key}`);
      if (prop.type === 'title') throw invalid('A data source can have only one title property.');
      ops.push(mk.set(cp, ['schema', shortPropId()], prop));
      continue;
    }
    const cur = col.schema[pid];
    const next: PropertySchema = { ...cur };
    if (typeof (change as Json).name === 'string' && (change as Json).name.trim()) next.name = (change as Json).name.trim().slice(0, 200);
    if (hasType) {
      const typed = schemaFromApi(next.name, change as Json, p, `${path}.${key}`);
      if (typed.type !== cur.type && cur.type === 'title') throw invalid('The title property’s type cannot be changed.');
      Object.assign(next, typed, typed.options ? { options: [...(cur.options ?? []).filter((o) => !typed.options!.some((n) => n.value === o.value)), ...typed.options] } : {});
    }
    ops.push(mk.set(cp, ['schema', pid], next));
  }
  return ops;
}

const databasesUpdate: Handler = ({ p, params, body, ctx }) => {
  need(p, 'update_content');
  const block = databaseOr404(p, idParam(params.id, 'database_id'));
  const col = block.collection_id ? getRecord<CollectionRecord>('collection', block.collection_id) : undefined;
  if (!col) throw notFound('database', block.id);
  const reader = { principalId: p.id };
  const ops: Operation[] = [];
  const cp = { table: 'collection' as const, id: col.id, spaceId: col.space_id };
  if (body.title !== undefined) ops.push(mk.set(cp, ['name'], fromApiRichText(body.title, reader, 'body.title')));
  if (body.description !== undefined) ops.push(mk.set(cp, ['description'], fromApiRichText(body.description, reader, 'body.description')));
  const fmt: Json = {};
  if (body.icon !== undefined) fmt.page_icon = iconFromApi(body.icon) ?? undefined;
  if (body.cover !== undefined) fmt.page_cover = coverFromApi(body.cover) ?? undefined;
  if (typeof body.is_locked === 'boolean') fmt.block_locked = body.is_locked || undefined;
  if (Object.keys(fmt).length) ops.push(mk.update(ptr(block), ['format'], fmt));
  if (body.properties !== undefined) throw invalid('Invalid request: update properties through PATCH /v1/data_sources/{id}.');
  const trash = trashFlag(body);
  if (trash === true && block.alive !== false) ops.push(...deleteOps([block], p.id));
  if (trash === false && block.alive === false) ops.push(...restoreOps(block));
  applyAs(p, ops, 'updateDatabase');
  return databaseObject(getRecord<BlockRecord>('block', block.id)!, readCtx(p));
};

const dataSourcesUpdate: Handler = ({ p, params, body, ctx }) => {
  need(p, 'update_content');
  const { col, block } = dataSourceOr404(p, idParam(params.id, 'data_source_id'));
  const reader = { principalId: p.id };
  const ops: Operation[] = [];
  const cp = { table: 'collection' as const, id: col.id, spaceId: col.space_id };
  if (body.title !== undefined) ops.push(mk.set(cp, ['name'], fromApiRichText(body.title, reader, 'body.title')));
  if (body.description !== undefined) ops.push(mk.set(cp, ['description'], fromApiRichText(body.description, reader, 'body.description')));
  ops.push(...schemaPatchOps(p, col, ctx.collection(col), body.properties, 'body.properties'));
  const trash = trashFlag(body);
  if (trash === true && block.alive !== false) ops.push(...deleteOps([block], p.id));
  if (trash === false && block.alive === false) ops.push(...restoreOps(block));
  applyAs(p, ops, 'updateDataSource');
  return dataSourceObject(getRecord<CollectionRecord>('collection', col.id)!, readCtx(p));
};

const dataSourcesCreate: Handler = () => {
  throw invalid('Each database in this workspace has one data source. Add a database with POST /v1/databases instead.');
};

// ---------------------------------------------------------------- comments

const commentsList: Handler = ({ p, query, ctx }) => {
  need(p, 'read_comments');
  const id = idParam(query.block_id, 'block_id');
  const b = readable(p, id);
  const out: { c: CommentRecord; d: DiscussionRecord }[] = [];
  for (const did of b.discussions ?? []) {
    const d = getRecord<DiscussionRecord>('discussion', did);
    if (!d || d.alive === false || d.resolved || d.parent_id !== b.id || d.type === 'suggestion') continue;
    // a thread on a database property value belongs to that value: not for principals who can't see it
    if (!propertyThreadVisible(d as DiscussionRecord & { property_id?: string }, p.id)) continue;
    for (const cid of d.comments ?? []) {
      const c = getRecord<CommentRecord>('comment', cid);
      if (c && c.alive !== false && c.parent_id === d.id) out.push({ c, d });
    }
  }
  const { page, next } = paginate(out, (x) => x.c.id, query.start_cursor, pageSize(query.page_size));
  return listObject(page.map((x) => commentObject(x.c, x.d, ctx)), next, 'comment');
};

const commentsCreate: Handler = async ({ p, body, ctx }) => {
  need(p, 'insert_comments');
  const text = normalize(fromApiRichText(body.rich_text, { principalId: p.id }, 'body.rich_text'));
  if (!text.length) throw invalid('Invalid request: body.rich_text must not be empty.');
  const nowMs = now();
  const ops: Operation[] = [];
  const cid = newId();
  let did: string;
  let target: BlockRecord;
  if (body.discussion_id) {
    did = bodyId(body.discussion_id, 'body.discussion_id');
    const d = getRecord<DiscussionRecord>('discussion', did);
    if (!d || d.alive === false || !propertyThreadVisible(d as DiscussionRecord & { property_id?: string }, p.id)) throw notFound('discussion', did);
    target = readable(p, d.parent_id, 'discussion');
    if (d.resolved) ops.push(mk.update({ table: 'discussion', id: did, spaceId: d.space_id }, [], { resolved: false }));
  } else {
    const pid = body.parent?.page_id ?? body.parent?.block_id;
    if (!pid) throw invalid('Invalid request: body.parent.page_id or body.discussion_id is required.');
    target = readable(p, bodyId(pid, body.parent?.page_id ? 'body.parent.page_id' : 'body.parent.block_id'), body.parent?.page_id ? 'page' : 'block');
    did = newId();
    const isPage = PAGE_TYPES.has(target.type) && !!body.parent?.page_id;
    ops.push(mk.set({ table: 'discussion', id: did, spaceId: target.space_id }, [], {
      id: did, parent_id: target.id, parent_table: 'block', resolved: false, comments: [], space_id: target.space_id, alive: true,
      type: isPage ? 'page' : 'default', created_by_id: p.id, created_time: nowMs,
    }));
    ops.push(mk.listAfter(ptr(target), ['discussions'], did));
  }
  ops.push(mk.set({ table: 'comment', id: cid, spaceId: target.space_id }, [], {
    id: cid, parent_id: did, parent_table: 'discussion', text, created_by_id: p.id, created_time: nowMs, last_edited_time: nowMs, alive: true, space_id: target.space_id,
  }));
  ops.push(mk.listAfter({ table: 'discussion', id: did, spaceId: target.space_id }, ['comments'], cid));
  applyAs(p, ops, 'createComment');
  try {
    await commentHandlers.notifyComment({ userId: p.id, setCookie: () => {} }, { commentId: cid });
  } catch {
    /* notifications are best effort */
  }
  return commentObject(getRecord<CommentRecord>('comment', cid)!, getRecord<DiscussionRecord>('discussion', did)!, ctx);
};

// ---------------------------------------------------------------- server

const ROUTES: [string, string, Handler][] = [
  ['GET', '/users/me', usersMe],
  ['GET', '/users', usersList],
  ['GET', '/users/:id', usersGet],
  ['POST', '/search', search],
  ['POST', '/pages', pagesCreate],
  ['GET', '/pages/:id', pagesGet],
  ['PATCH', '/pages/:id', pagesUpdate],
  ['GET', '/pages/:id/properties/:pid', pagePropertyGet],
  ['GET', '/pages/:id/markdown', pagesMarkdownGet],
  ['PATCH', '/pages/:id/markdown', pagesMarkdownUpdate],
  ['GET', '/blocks/:id', blocksGet],
  ['PATCH', '/blocks/:id', blocksUpdate],
  ['DELETE', '/blocks/:id', blocksDelete],
  ['GET', '/blocks/:id/children', blocksChildren],
  ['PATCH', '/blocks/:id/children', blocksAppend],
  ['POST', '/databases', databasesCreate],
  ['GET', '/databases/:id', databasesGet],
  ['PATCH', '/databases/:id', databasesUpdate],
  ['POST', '/databases/:id/query', databasesQuery],
  ['POST', '/data_sources', dataSourcesCreate],
  ['GET', '/data_sources/:id', dataSourcesGet],
  ['PATCH', '/data_sources/:id', dataSourcesUpdate],
  ['POST', '/data_sources/:id/query', dataSourcesQuery],
  ['GET', '/comments', commentsList],
  ['POST', '/comments', commentsCreate],
];

function ratePerMin(): number {
  return Number(process.env.NC_API_RATE_PER_MIN) || 180;
}

function hasSupportedVersion(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === API_VERSION;
}

async function handle(c: Context, h: Handler): Promise<Response> {
  const requestId = newId();
  let principal: Principal | null = null;
  const send = (status: number, payload: Json, headers: Record<string, string> = {}) => {
    if (principal?.integration) recordRequest(principal.integration.id, status);
    return c.json(payload, status as any, { 'x-request-id': requestId, ...headers });
  };
  try {
    const auth = c.req.header('authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1] ?? '';
    const version = c.req.header('lit-version');
    if (!token) throw new PublicApiError('unauthorized', 'Unauthorized: API token is invalid.');
    if (!hasSupportedVersion(version)) throw invalid(`Litpage-Version must be "${API_VERSION}".`);
    principal = principalForToken(token);
    if (!principal) throw new PublicApiError('unauthorized', 'Unauthorized: API token is invalid.');
    const space = getRecord<SpaceRecord>('space', principal.spaceId);
    if (!space) throw new PublicApiError('unauthorized', 'Unauthorized: API token is invalid.');
    if (principal.kind === 'personal' && !isSpaceMember(space, principal.id)) throw new PublicApiError('unauthorized', 'Unauthorized: API token is invalid.');
    // personal access tokens are MCP tokens: the same workspace switches apply here as on /api/mcp ("Allow
    // MCP", "Approved MCP clients only")
    if (principal.kind === 'personal') {
      const blocked = personalTokenBlocked({ tokenId: principal.tokenId!, userId: principal.id, spaceId: principal.spaceId });
      if (blocked) throw restricted(blocked);
    }
    if (!hit(`v1:${principal.key}`, ratePerMin(), 60_000)) {
      throw new PublicApiError('rate_limited', 'Rate limit exceeded: try again shortly.', { retryAfter: 20 });
    }
    let body: Json = {};
    const m = c.req.method;
    if (m === 'POST' || m === 'PATCH') {
      const text = await c.req.text();
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new PublicApiError('invalid_json', 'Invalid request: the JSON body could not be parsed.');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicApiError('invalid_json', 'Invalid request: the JSON body must be an object.');
      }
    }
    const query: Record<string, string> = {};
    for (const [k, v] of new URL(c.req.url).searchParams) query[k] = v;
    const req: Req = { p: principal, params: c.req.param() as Record<string, string>, query, body, ctx: readCtx(principal) };
    const out = await h(req);
    if (out && typeof out === 'object' && 'request_id' in out) (out as Json).request_id = requestId;
    return send(200, out);
  } catch (e) {
    if (e instanceof PublicApiError) {
      return send(e.status, errorBody(e, requestId), e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {});
    }
    console.error('[v1] request failed', e);
    return send(500, errorBody(new PublicApiError('internal_server_error', 'Internal error: unexpected failure.'), requestId));
  }
}

export function registerPublicApi(app: Hono) {
  const v1 = new Hono();
  v1.use('*', async (c, next) => {
    if (isDemoMode()) return c.json({ object: 'error', status: 403, code: 'forbidden', message: DEMO_MESSAGE }, 403);
    await next();
  });
  v1.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ object: 'error', status: 413, code: 'validation_error', message: 'Invalid request: body is too large.' }, 413) }));
  for (const [method, path, h] of ROUTES) v1.on(method, path, (c) => handle(c, h));
  v1.all('*', (c) => c.json({ object: 'error', status: 400, code: 'invalid_request_url', message: 'Invalid request URL.', request_id: newId() }, 400));
  app.route('/v1', v1);
}

/** Helpers other /v1 modules reuse. */
export { need, readable, idParam, paginate, pageSize, applyAs, iso };
export type { Req, Handler };
