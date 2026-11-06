// Template gallery endpoints (Marketplace › Templates, Templates modal, page "Get started with › Templates"):
//   listTemplates {}                         → { templates: [{ id, name, description, icon, cover, category, tags, creator, featured, pageId }] }
//   getTemplatePreview { templateId }        → { pageId, recordMap }   (read-only records of the template tree)
//   getTemplate { templateId, spaceId, parent? } → { pageId }          ("Get template": copy into the user's Private section)
//   getTemplate { templateId, spaceId, applyTo }  → { pageId }          (Templates modal from an empty page: the page becomes the template)
// Marketplace numbers: every "Add" is counted (template_adds); people who added a
// template can rate it (template_reviews, 1–5 stars + text, one per person). listTemplates carries adds / rating /
// reviews / updatedTime / added; getTemplateReviews, reviewTemplate, getAddedTemplates (Marketplace › Purchased).
//   applyTemplateToDatabase { templateId, blockId } → { blockId, collectionId }  (new database › More templates, :
//     an empty database takes the template's data source — properties, views, sample rows — keeping its place and type)
import { newId } from '@nc/shared/ids.ts';
import type { Operation } from '@nc/shared/ops.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, SpaceViewRecord, UserRootRecord } from '@nc/shared/records.ts';
import { childrenOf, db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { ensureTemplateGallery, TEMPLATE_USER_ID } from '../../seed.ts';
import { childBlocks } from '../../tree.ts';
import { TEMPLATES, templateMeta } from '../../content/catalog.ts';

type Handler = (ctx: Ctx, body: any) => any;

db.exec(`
CREATE TABLE IF NOT EXISTS template_adds (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  space_id TEXT,
  page_id TEXT,
  time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_template_adds_tpl ON template_adds(template_id);
CREATE INDEX IF NOT EXISTS idx_template_adds_user ON template_adds(user_id, time);
CREATE TABLE IF NOT EXISTS template_reviews (
  template_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  name TEXT,
  text TEXT,
  time INTEGER NOT NULL,
  PRIMARY KEY (template_id, user_id)
);
`);
for (const col of ['title', 'name']) {
  if (!(db.prepare('PRAGMA table_info(template_reviews)').all() as { name: string }[]).some((c) => c.name === col)) db.exec(`ALTER TABLE template_reviews ADD COLUMN ${col} TEXT`);
}

// the template catalog ships with Litpage: its "last updated" is the catalog's release date
const CATALOG_UPDATED = Date.UTC(2026, 8, 15);

function stats(uid: string) {
  const adds = new Map((db.prepare('SELECT template_id, COUNT(*) AS n FROM template_adds GROUP BY template_id').all() as any[]).map((r) => [r.template_id, Number(r.n)]));
  const ratings = new Map((db.prepare('SELECT template_id, AVG(rating) AS avg, COUNT(*) AS n FROM template_reviews GROUP BY template_id').all() as any[]).map((r) => [r.template_id, { avg: Number(r.avg), n: Number(r.n) }]));
  const mine = new Set((db.prepare('SELECT DISTINCT template_id FROM template_adds WHERE user_id = ?').all(uid) as any[]).map((r) => r.template_id));
  return { adds, ratings, mine };
}

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

function isMember(space: SpaceRecord | undefined, userId: string) {
  return !!space?.permissions?.some((p) => p.type === 'user_permission' && p.user_id === userId && p.role !== 'none');
}

/** All records of a page tree (nested pages, databases with views and rows), capped. */
export function collectTree(rootId: string, rm: RecordMapBuilder | null, limit = 4000): { blocks: BlockRecord[]; collections: CollectionRecord[]; views: CollectionViewRecord[] } {
  const blocks: BlockRecord[] = [];
  const collections: CollectionRecord[] = [];
  const views: CollectionViewRecord[] = [];
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length && seen.size < limit) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const b = getRecord<BlockRecord>('block', id);
    if (!b || b.alive === false) continue;
    blocks.push(b);
    rm?.add('block', b);
    if ((b.type === 'collection_view' || b.type === 'collection_view_page') && b.collection_id) {
      const col = getRecord<CollectionRecord>('collection', b.collection_id);
      if (col) {
        collections.push(col);
        rm?.add('collection', col);
        for (const row of childrenOf<BlockRecord>('block', col.id)) if (row.alive && row.parent_table === 'collection') queue.push(row.id);
      }
      for (const vid of b.view_ids ?? []) {
        const v = getRecord<CollectionViewRecord>('collection_view', vid);
        if (v) {
          views.push(v);
          rm?.add('collection_view', v);
        }
      }
    }
    for (const c of childBlocks(b)) queue.push(c.id);
  }
  return { blocks, collections, views };
}

/** Copy a template tree into `spaceId` with fresh ids (blocks, collections, views, rows); returns ops + new root id.
 *  With `into`, the template root is written over that (blank) page instead, keeping its place, permissions and title. */
function copyTreeOps(rootId: string, spaceId: string, userId: string, parent: { id: string; table: string }, into?: BlockRecord): { ops: Operation[]; newRoot: string } {
  const { blocks, collections, views } = collectTree(rootId, null);
  const idMap = new Map<string, string>();
  for (const b of blocks) idMap.set(b.id, into && b.id === rootId ? into.id : newId());
  for (const c of collections) idMap.set(c.id, newId());
  for (const v of views) idMap.set(v.id, newId());
  const map = (id: string) => idMap.get(id) ?? id;
  const now = Date.now();
  const ops: Operation[] = [];
  const set = (table: 'block' | 'collection' | 'collection_view', id: string, args: Record<string, unknown>) => ops.push({ pointer: { table, id, spaceId }, path: [], command: 'set', args });
  // remap page mentions / relations inside rich text
  const remapRich = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null), (_k, val) => (typeof val === 'string' && idMap.has(val) ? idMap.get(val) : val));
  for (const b of blocks) {
    const { version: _v, permissions: _p, ...rest } = b;
    const nid = map(b.id);
    const isRoot = b.id === rootId;
    const value: Record<string, unknown> = {
      ...rest,
      id: nid,
      space_id: spaceId,
      properties: remapRich(b.properties) ?? undefined,
      content: b.content?.filter((c) => idMap.has(c)).map(map),
      parent_id: isRoot ? parent.id : b.parent_table === 'collection' ? map(b.parent_id) : map(b.parent_id),
      parent_table: isRoot ? parent.table : b.parent_table,
      created_time: now, created_by_id: userId, created_by_table: 'lit_user',
      last_edited_time: now, last_edited_by_id: userId, last_edited_by_table: 'lit_user',
      alive: true,
      copied_from: b.id,
    };
    if (b.collection_id) value.collection_id = map(b.collection_id);
    if (b.view_ids) value.view_ids = b.view_ids.map(map);
    if (isRoot && parent.table === 'space' && !into) value.permissions = [{ type: 'user_permission', role: 'editor', user_id: userId }];
    if (isRoot && into) {
      Object.assign(value, { created_time: into.created_time, created_by_id: into.created_by_id, created_by_table: into.created_by_table, permissions: into.permissions });
      if (plainText(into.properties?.title)) value.properties = { ...(value.properties as object), title: into.properties!.title };
      if (!value.permissions) delete value.permissions;
    }
    if (!value.content || !(value.content as string[]).length) delete value.content;
    if (!value.properties) delete value.properties;
    set('block', nid, value);
  }
  for (const c of collections) {
    const { version: _v, ...rest } = c;
    set('collection', map(c.id), { ...rest, id: map(c.id), parent_id: map(c.parent_id), space_id: spaceId, template_pages: (c.template_pages ?? []).filter((t) => idMap.has(t)).map(map) });
  }
  for (const v of views) {
    const { version: _v, ...rest } = v;
    set('collection_view', map(v.id), { ...rest, id: map(v.id), parent_id: map(v.parent_id), space_id: spaceId, page_sort: (v.page_sort ?? []).filter((x) => idMap.has(x)).map(map) });
  }
  // the blank page's own (empty) blocks are replaced by the template's
  for (const id of into?.content ?? []) ops.push({ pointer: { table: 'block', id, spaceId }, path: [], command: 'update', args: { alive: false } });
  return { ops, newRoot: map(rootId) };
}

function plainText(rt: unknown): string {
  return Array.isArray(rt) ? (rt as [string][]).map((d) => d[0]).join('') : '';
}

/** A page a template can be applied to: a plain page (not a database row) holding nothing but empty text blocks. */
function isBlankPage(p: BlockRecord): boolean {
  if (p.type !== 'page' || p.parent_table === 'collection') return false;
  return (p.content ?? []).every((id) => {
    const c = getRecord<BlockRecord>('block', id);
    return !c || c.alive === false || (c.type === 'text' && !plainText(c.properties?.title));
  });
}

/** Compact outline of a template for gallery thumbnails (first blocks / database columns and rows). */
function outlineOf(rootId: string) {
  const root = getRecord<BlockRecord>('block', rootId);
  if (!root) return null;
  const plain = (rt: unknown) => (Array.isArray(rt) ? (rt as [string][]).map((d) => d[0]).join('') : '').slice(0, 80);
  const dbOutline = (b: BlockRecord) => {
    const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
    if (!col) return null;
    const view = b.view_ids?.[0] ? getRecord<CollectionViewRecord>('collection_view', b.view_ids[0]) : undefined;
    const props = ['title', ...Object.keys(col.schema).filter((k) => k !== 'title')].slice(0, 4);
    const rows = childrenOf<BlockRecord>('block', col.id).filter((r) => r.alive && r.parent_table === 'collection');
    const order = view?.page_sort ?? [];
    rows.sort((a, b2) => order.indexOf(a.id) - order.indexOf(b2.id));
    return {
      name: plain(col.name), view: view?.type ?? 'table',
      columns: props.map((p) => ({ name: col.schema[p]?.name ?? '', type: col.schema[p]?.type ?? 'text' })),
      rows: rows.slice(0, 6).map((r) => ({ icon: (r.format?.page_icon as string | undefined) ?? '', cells: props.map((p) => plain(r.properties?.[p]).split(',')[0]) })),
    };
  };
  if (root.type === 'collection_view_page') return { db: dbOutline(root) };
  const blocks = (root.content ?? []).slice(0, 16).map((id) => getRecord<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && b.alive !== false).map((b) => ({
    t: b.type, x: b.type === 'page' ? plain(b.properties?.title) : plain(b.properties?.title), c: b.properties?.checked?.[0]?.[0] === 'Yes',
    i: (b.format?.page_icon as string | undefined) ?? undefined,
    ...(b.type === 'collection_view' ? { db: dbOutline(b) } : {}),
  }));
  return { blocks };
}

function templateRoot(templateId: string): string {
  const pages = ensureTemplateGallery();
  const id = pages[String(templateId)];
  if (!id) throw new ApiError('Template not found', 404);
  return id;
}

export const handlers: Record<string, Handler> = {
  listTemplates(ctx) {
    const uid = requireUser(ctx);
    const pages = ensureTemplateGallery();
    const st = stats(uid);
    return {
      templates: TEMPLATES.map((t) => ({
        ...templateMeta(t), pageId: pages[t.id], outline: outlineOf(pages[t.id]),
        adds: st.adds.get(t.id) ?? 0, rating: st.ratings.get(t.id)?.avg ?? null, reviews: st.ratings.get(t.id)?.n ?? 0,
        updatedTime: CATALOG_UPDATED, added: st.mine.has(t.id),
      })),
    };
  },

  /** Ratings & reviews of a template, newest first, plus the 1–5 star histogram and this person's own review. */
  getTemplateReviews(ctx, { templateId }) {
    const uid = requireUser(ctx);
    templateRoot(templateId);
    const rows = db.prepare('SELECT user_id, rating, title, name, text, time FROM template_reviews WHERE template_id = ? ORDER BY time DESC LIMIT 200').all(String(templateId)) as any[];
    const histogram = [1, 2, 3, 4, 5].map((star) => rows.filter((r) => r.rating === star).length);
    const review = (r: any) => ({ userId: r.user_id, rating: r.rating, title: r.title ?? '', name: r.name ?? '', text: r.text ?? '', time: r.time });
    const mine = rows.find((r) => r.user_id === uid);
    const added = !!db.prepare('SELECT 1 FROM template_adds WHERE template_id = ? AND user_id = ? LIMIT 1').get(String(templateId), uid);
    return { reviews: rows.map(review), histogram, mine: mine ? review(mine) : null, canReview: added && !mine };
  },

  /** "Leave a review" (Marketplace › Purchased › •••, template page): people who added the template rate it once. */
  reviewTemplate(ctx, { templateId, rating, title, text, name }) {
    const uid = requireUser(ctx);
    templateRoot(templateId);
    const added = db.prepare('SELECT 1 FROM template_adds WHERE template_id = ? AND user_id = ? LIMIT 1').get(String(templateId), uid);
    if (!added) throw new ApiError('Add this template to a workspace before reviewing it', 403);
    const r = Math.round(Number(rating));
    if (!(r >= 1 && r <= 5)) throw new ApiError('Rate this template to continue', 400);
    const ttl = String(title ?? '').trim();
    const body = String(text ?? '').trim();
    if (ttl.length > 100) throw new ApiError('Keep the review title under 100 characters.', 400);
    if (body.length > 1500) throw new ApiError('Keep the review under 1,500 characters.', 400);
    const user = getRecord<any>('lit_user', uid);
    const shown = String(name ?? '').trim().slice(0, 100) || user?.name || '';
    if (db.prepare('SELECT 1 FROM template_reviews WHERE template_id = ? AND user_id = ?').get(String(templateId), uid)) throw new ApiError('You have already reviewed this template', 409);
    db.prepare('INSERT INTO template_reviews (template_id, user_id, rating, title, name, text, time) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(String(templateId), uid, r, ttl, shown, body, Date.now());
    return {};
  },

  /** Marketplace › Purchased (Added): templates this person added, newest first, with where they went. */
  getAddedTemplates(ctx) {
    const uid = requireUser(ctx);
    const rows = db.prepare('SELECT template_id, MAX(time) AS time, COUNT(*) AS n FROM template_adds WHERE user_id = ? GROUP BY template_id ORDER BY time DESC LIMIT 200').all(uid) as any[];
    const rm = new RecordMapBuilder(uid);
    const out = rows.map((r) => {
      const last = db.prepare('SELECT page_id, space_id FROM template_adds WHERE user_id = ? AND template_id = ? ORDER BY time DESC LIMIT 1').get(uid, r.template_id) as any;
      const page = last?.page_id ? getRecord<BlockRecord>('block', last.page_id) : undefined;
      const open = page && page.alive && blockRole(page.id, uid) !== 'none';
      if (open) rm.add('block', page);
      const rev = db.prepare('SELECT rating FROM template_reviews WHERE template_id = ? AND user_id = ?').get(r.template_id, uid) as any;
      return { templateId: r.template_id, time: r.time, times: Number(r.n), pageId: open ? page!.id : null, spaceId: last?.space_id ?? null, myRating: rev?.rating ?? null };
    });
    return { added: out, recordMap: rm.map };
  },

  applyTemplateToDatabase(ctx, { templateId, blockId }) {
    const uid = requireUser(ctx);
    const rootId = templateRoot(templateId);
    const block = getRecord<BlockRecord>('block', String(blockId ?? ''));
    if (!block || block.alive === false || (block.type !== 'collection_view' && block.type !== 'collection_view_page')) throw new ApiError('Not found', 404);
    if (!roleAtLeast(blockRole(block.id, uid), 'read_and_write')) throw new ApiError('Not allowed', 403);
    const own = block.collection_id ? getRecord<CollectionRecord>('collection', block.collection_id) : undefined;
    if (own && childrenOf<BlockRecord>('block', own.id).some((r) => r.alive && r.parent_table === 'collection')) throw new ApiError('Templates can only be applied to an empty database', 400);
    const src = collectTree(rootId, null, 200).blocks.find((b) => (b.type === 'collection_view_page' || b.type === 'collection_view') && !!b.collection_id);
    if (!src) throw new ApiError('This template has no database', 400);
    const { ops } = copyTreeOps(src.id, block.space_id, uid, { id: block.parent_id, table: block.parent_table }, block);
    // copyTreeOps wrote the template's database block over ours: keep our block's type, format and title, point it
    // at the copied data source, and keep a name the person already typed
    const rootOp = ops.find((o) => o.pointer.table === 'block' && o.pointer.id === block.id && o.command === 'set');
    const colOp = ops.find((o) => o.pointer.table === 'collection' && o.command === 'set');
    if (!rootOp || !colOp) throw new ApiError('This template has no database', 400);
    const newCol = colOp.pointer.id;
    const root = rootOp.args as Record<string, unknown>;
    root.type = block.type;
    root.format = { ...(block.format ?? {}), collection_pointer: { id: newCol, table: 'collection', spaceId: block.space_id } };
    if (block.properties) root.properties = block.properties;
    else delete root.properties;
    if (own && plainText(own.name)) (colOp.args as Record<string, unknown>).name = own.name;
    // the empty data source and its views go away (only when this block owns them; linked views just re-point)
    if (own && own.parent_id === block.id) ops.push({ pointer: { table: 'collection', id: own.id, spaceId: block.space_id }, path: [], command: 'update', args: { alive: false } });
    for (const vid of block.view_ids ?? []) ops.push({ pointer: { table: 'collection_view', id: vid, spaceId: block.space_id }, path: [], command: 'update', args: { alive: false } });
    // user-initiated: a locked database keeps its views and properties (dbaccess.ts)
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: block.space_id, debug: { userAction: 'applyTemplateToDatabase' }, operations: ops }], ctx.clientId, { userInitiated: true });
    db.prepare('INSERT INTO template_adds (id, template_id, user_id, space_id, page_id, time) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), String(templateId), uid, block.space_id, block.id, Date.now());
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { blockId: block.id, collectionId: newCol, recordMap: rm.map };
  },

  getTemplatePreview(ctx, { templateId }) {
    const uid = requireUser(ctx);
    const rootId = templateRoot(templateId);
    const rm = new RecordMapBuilder(uid);
    collectTree(rootId, rm, 1500);
    rm.add('lit_user', getRecord('lit_user', TEMPLATE_USER_ID), 'reader');
    return { pageId: rootId, recordMap: rm.map };
  },

  getTemplate(ctx, { templateId, spaceId, parent, applyTo }) {
    const uid = requireUser(ctx);
    const rootId = templateRoot(templateId);
    const space = getRecord<SpaceRecord>('space', String(spaceId));
    if (!space || !isMember(space, uid)) throw new ApiError('Not a member of this workspace', 403);
    if (applyTo) {
      const p = getRecord<BlockRecord>('block', String(applyTo));
      if (!p || p.alive === false || p.space_id !== space.id || !roleAtLeast(blockRole(p.id, uid), 'read_and_write')) throw new ApiError('Not allowed', 403);
      if (!isBlankPage(p)) throw new ApiError('Templates can only be applied to an empty page', 400);
      const { ops } = copyTreeOps(rootId, space.id, uid, { id: p.parent_id, table: p.parent_table }, p);
      const changes = applyTransactions(uid, [{ id: newId(), spaceId: space.id, debug: { userAction: 'applyTemplate' }, operations: ops }], ctx.clientId);
      db.prepare('INSERT INTO template_adds (id, template_id, user_id, space_id, page_id, time) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), String(templateId), uid, space.id, p.id, Date.now());
      const rm = new RecordMapBuilder(uid);
      for (const ch of changes) rm.add(ch.table, ch.record);
      return { pageId: p.id, recordMap: rm.map };
    }
    let target: { id: string; table: 'space' | 'block' } = { id: space.id, table: 'space' };
    if (parent?.kind === 'page' && parent.pageId) {
      const p = getRecord<BlockRecord>('block', String(parent.pageId));
      if (!p || p.space_id !== space.id || !roleAtLeast(blockRole(p.id, uid), 'read_and_write')) throw new ApiError('Not allowed', 403);
      target = { id: p.id, table: 'block' };
    }
    const { ops, newRoot } = copyTreeOps(rootId, space.id, uid, target);
    if (target.table === 'space') {
      const sv = spaceViewOf(uid, space.id);
      if (!sv) throw new ApiError('Workspace view not found', 404);
      ops.push({ pointer: { table: 'space_view', id: sv.id, spaceId: space.id }, path: ['private_pages'], command: 'listBefore', args: { id: newRoot } });
    } else {
      ops.push({ pointer: { table: 'block', id: target.id, spaceId: space.id }, path: ['content'], command: 'listAfter', args: { id: newRoot } });
    }
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: space.id, debug: { userAction: 'getTemplate' }, operations: ops }], ctx.clientId);
    db.prepare('INSERT INTO template_adds (id, template_id, user_id, space_id, page_id, time) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), String(templateId), uid, space.id, newRoot, Date.now());
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { pageId: newRoot, recordMap: rm.map };
  },
};
