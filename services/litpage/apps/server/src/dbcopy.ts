// Deep copies of blocks with their databases.
//
// TreeCopier copies a block tree the duplicate operation: every block gets a new id, a database block gets new
// data sources (schema, name, templates, rows with their content — rows only "with content") and new views re-pointed
// at the copies; linked views keep their source. finish re-points the references between copied records (relations
// between copied rows, page mentions, manual row order, view/source pointers, dashboard widgets). Comments, sharing,
// archive and verification state stay with the original. A copy is capped at MAX_COPY_BLOCKS blocks.
//
// The client duplicates a database block (⋮⋮ › Duplicate › Duplicate with content / without content, ⌘D) inside its
// own transaction — new block, data source(s) marked { copied_from, nc_copy } and views — so the copy is placed and
// undone like any block. The persist hook below adds the rows and templates of the source to that same write (the
// automation engine sees one commit: copied automations follow, copied rows don't trigger "Page added").
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, Table } from '@nc/shared/records.ts';
import { childrenOf, getRecord } from './db.ts';
import { blockRole, onBeforePersist, TransactionError, type AppliedChange } from './records.ts';
import { redactDatabaseRecord, writableCopyValues } from './propaccess.ts';
import { childBlocks } from './tree.ts';
import { count, hit } from './ratelimit.ts';

export const MAX_COPY_BLOCKS = 20_000;
/** copied blocks per person and hour (shared with the other duplicate paths' spirit: move.ts uses 50k/h) */
const COPY_BLOCKS_PER_HOUR = 50_000;

type Rec = Record<string, any>;
const UUID_RE = /"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g;

/** Data sources owned by a database block: its collection and every view's source that lives under it. */
export function ownedCollectionsOf(b: BlockRecord): CollectionRecord[] {
  const ids = new Set<string>();
  if (b.collection_id) ids.add(b.collection_id);
  for (const p of ((b.format as Rec | undefined)?.collection_pointers ?? []) as { id?: string }[]) if (p?.id) ids.add(p.id);
  for (const v of childrenOf<CollectionViewRecord>('collection_view', b.id)) {
    const pid = (v.format as Rec | undefined)?.collection_pointer?.id;
    if (typeof pid === 'string') ids.add(pid);
  }
  const out: CollectionRecord[] = [];
  for (const id of ids) {
    const c = getRecord<CollectionRecord>('collection', id);
    if (c && c.alive !== false && c.parent_id === b.id) out.push(c);
  }
  return out;
}

export class TreeCopier {
  /** copied records by "table:id" */
  readonly out = new Map<string, { table: Table; record: Rec }>();
  /** source id → copy id (blocks, data sources, views) */
  readonly idMap = new Map<string, string>();
  count = 0;
  readonly now: number;
  readonly uid: string;
  readonly spaceId: string;
  readonly opts: { rows: boolean; max?: number };

  constructor(uid: string, spaceId: string, opts: { rows: boolean; max?: number } = { rows: true }) {
    this.uid = uid;
    this.spaceId = spaceId;
    this.opts = opts;
    this.now = Date.now();
  }

  private strip(rec: unknown): Rec {
    const { version: _v, applied_tx_ids: _a, ...rest } = rec as Rec;
    return structuredClone(rest);
  }

  private stored = new Map<string, boolean>();
  /** An existing data source (copies made by this copier aren't stored yet). */
  private storedCollection(id: string): boolean {
    if (!this.stored.has(id)) this.stored.set(id, !!getRecord('collection', id));
    return this.stored.get(id)!;
  }

  private put(table: Table, record: Rec) {
    this.out.set(`${table}:${record.id}`, { table, record });
  }

  /** Copy a block subtree under `parentId`; returns the copy's id. */
  block(b: BlockRecord, parentId: string, parentTable: string, extra: Rec = {}): string {
    if (++this.count > (this.opts.max ?? MAX_COPY_BLOCKS)) throw new TransactionError('This page is too large to duplicate', 413);
    const nid = newId();
    this.idMap.set(b.id, nid);
    // a nested page restricted from this person ("unlinked" sharing) stays behind: only those can narrow access
    const content = childBlocks(b).filter((c) => !(c as Rec).permissions_unlinked || blockRole(c.id, this.uid) !== 'none').map((c) => this.block(c, nid, 'block'));
    const v = this.strip(b);
    delete v.discussions;
    delete v.permissions;
    delete v.permissions_unlinked;
    delete v.archived_time;
    delete v.archived_by;
    if (v.format?.page_verification) v.format = { ...v.format, page_verification: undefined };
    // a row duplicated into its own (existing) data source: restricted values the copier couldn't see on the original,
    // or can't edit on a page they create, stay behind (dbaccess.ts refuses new rows carrying them)
    if (parentTable === 'collection' && b.parent_table === 'collection' && this.storedCollection(parentId)) {
      v.properties = writableCopyValues(b, v.properties, this.uid);
    }
    Object.assign(v, extra, {
      id: nid, parent_id: parentId, parent_table: parentTable, space_id: this.spaceId, alive: true, content: content.length ? content : undefined,
      copied_from: b.id, created_time: this.now, created_by_id: this.uid, created_by_table: 'lit_user',
      last_edited_time: this.now, last_edited_by_id: this.uid, last_edited_by_table: 'lit_user',
    });
    if (b.type === 'collection_view' || b.type === 'collection_view_page') this.database(b, v);
    this.put('block', v);
    return nid;
  }

  /** New data sources + views for a copied database block `v` (the copy of `b`). */
  private database(b: BlockRecord, v: Rec) {
    const readable = blockRole(b.id, this.uid) !== 'none';
    const owned = readable ? ownedCollectionsOf(b) : [];
    for (const c of owned) this.idMap.set(c.id, newId());
    for (const c of owned) {
      // properties this person can't see ("No access") are not copied
      const cv = this.strip(redactDatabaseRecord('collection', c, this.uid));
      Object.assign(cv, { id: this.idMap.get(c.id), parent_id: v.id, parent_table: 'block', space_id: this.spaceId, alive: true, template_pages: [], copied_from: c.id });
      this.put('collection', cv);
      this.collectionContent(c, cv);
    }
    // tab views and dashboard widgets (views with format.dashboard_view_id live under the block too)
    const views = childrenOf<CollectionViewRecord>('collection_view', b.id).filter((x) => x.alive !== false && x.parent_table === 'block');
    for (const x of views) this.idMap.set(x.id, newId());
    for (const x of views) {
      const xv = this.strip(x);
      Object.assign(xv, { id: this.idMap.get(x.id), parent_id: v.id, parent_table: 'block', space_id: this.spaceId, alive: true });
      this.put('collection_view', xv);
    }
    v.view_ids = (b.view_ids ?? []).filter((id) => this.idMap.has(id));
    // a linked database whose source this person can't read loses the pointer (it would show "No data source")
    if (b.collection_id && !this.idMap.has(b.collection_id)) {
      const c = getRecord<CollectionRecord>('collection', b.collection_id);
      if (!c || blockRole(c.parent_id, this.uid) === 'none') delete v.collection_id;
    }
  }

  /** Copy the templates (always) and rows (opts.rows) of data source `src` into the data source record `dst`. */
  collectionContent(src: CollectionRecord, dst: Rec) {
    const templates = new Set(src.template_pages ?? []);
    for (const row of childrenOf<BlockRecord>('block', src.id)) {
      if (row.alive === false || row.parent_table !== 'collection') continue;
      const isTemplate = !!row.is_template || templates.has(row.id);
      if (!isTemplate && !this.opts.rows) continue;
      // rows a page-level access rule hides from this person stay behind; values of properties they can't see too
      if (blockRole(row.id, this.uid) === 'none') continue;
      this.block(redactDatabaseRecord('block', row, this.uid) as BlockRecord, dst.id, 'collection');
    }
    dst.template_pages = (src.template_pages ?? []).filter((id) => this.idMap.has(id));
  }

  /** Re-point references between the copies; returns the copied records ready to persist. */
  finish(): Map<string, { table: Table; record: Rec }> {
    const copied = new Set(this.idMap.values());
    for (const e of this.out.values()) {
      const from = e.record.copied_from;
      const s = JSON.stringify(e.record).replace(UUID_RE, (m, id: string) => {
        const n = this.idMap.get(id);
        return n ? `"${n}"` : m;
      });
      const rec = JSON.parse(s) as Rec;
      if (from !== undefined) rec.copied_from = from;
      if (e.table === 'collection') rec.schema = oneWayOutside(rec.schema, copied);
      if (e.table === 'collection_view' && Array.isArray(rec.page_sort)) rec.page_sort = rec.page_sort.filter((id: string) => copied.has(id));
      e.record = rec;
    }
    return this.out;
  }
}

/** A two-way relation with a data source outside the copy becomes one-way in the copy: the other database's
 *  reverse property keeps pointing at the original. Relations among copied data sources stay two-way. */
function oneWayOutside(schema: Rec | undefined, copied: Set<string>): Rec | undefined {
  if (!schema) return schema;
  let out: Rec | undefined;
  for (const [pid, p] of Object.entries(schema)) {
    if (p?.type !== 'relation' || !p.property || copied.has(p.collection_id)) continue;
    out ??= { ...schema };
    const { property: _rev, ...rest } = p;
    out[pid] = rest;
  }
  return out ?? schema;
}

/** Rate limit for copies: COPY_BLOCKS_PER_HOUR blocks per person (counted in steps of 100). */
export function assertCopyBudget(uid: string, blocks: number) {
  const key = `dbcopy:${uid}`;
  const steps = Math.ceil(blocks / 100);
  if (count(key, 3600_000) + steps > COPY_BLOCKS_PER_HOUR / 100) throw new TransactionError('You have reached the request limit. Try again later.', 429);
  for (let i = 0; i < steps; i++) hit(key, Number.MAX_SAFE_INTEGER, 3600_000);
}

// ---------------------------------------------------------------- client duplicates: rows join the same write

onBeforePersist((changed, userId) => {
  for (const ch of [...changed.values()]) {
    if (ch.table !== 'collection') continue;
    const c = ch.record as Rec;
    if (!c.nc_copy) continue;
    const mode = c.nc_copy;
    delete c.nc_copy; // never stored
    if (getRecord('collection', c.id)) continue; // only data sources created by this write
    const src = typeof c.copied_from === 'string' ? getRecord<CollectionRecord>('collection', c.copied_from) : undefined;
    if (!src || src.alive === false || blockRole(src.parent_id, userId) === 'none') continue;
    const copier = new TreeCopier(userId, c.space_id ?? ch.spaceId ?? '', { rows: mode === 'with_content' });
    copier.idMap.set(src.id, c.id);
    copier.collectionContent(src, c);
    assertCopyBudget(userId, copier.count);
    const out = copier.finish();
    for (const [key, e] of out) changed.set(key, { table: e.table, record: e.record as never, spaceId: c.space_id ?? ch.spaceId } as AppliedChange);
    const map = copier.idMap;
    // the data source itself was written by the client: point its template list at the copied templates
    c.template_pages = ((c.template_pages ?? []) as string[]).map((id) => map.get(id)).filter((id): id is string => !!id);
    // views of the copy: manual order follows the copied rows
    for (const vc of changed.values()) {
      if (vc.table !== 'collection_view' || getRecord('collection_view', vc.record.id)) continue;
      const v = vc.record as Rec;
      const host = changed.get(`block:${v.parent_id}`)?.record as Rec | undefined;
      const sourceId = v.format?.collection_pointer?.id ?? host?.collection_id;
      if (sourceId !== c.id || !Array.isArray(v.page_sort)) continue;
      v.page_sort = v.page_sort.map((id: string) => map.get(id)).filter((id: string | undefined): id is string => !!id);
    }
    // two-way relations with databases outside the copy (this write's new data sources) become one-way in it
    const fresh = new Set([...changed.values()].filter((x) => x.table === 'collection' && !getRecord('collection', x.record.id)).map((x) => x.record.id));
    c.schema = oneWayOutside(c.schema, fresh);
  }
});
