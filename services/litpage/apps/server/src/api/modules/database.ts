// Database (data source) endpoints that are cleaner server-side: template instantiation (deep content copy),
// queryRows (shared query engine), CSV export of a view, CSV import into a data source,
// and view duplication across blocks. All writes go through applyTransactions (same op model as clients).
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getPropertyValue, propertiesKeyFor, runQuery, valueToText } from '@nc/shared/database/index.ts';
import { childrenOf, getRecord, recordsInSpace } from '../../db.ts';
import { applyTransactions, blockRole, RecordMapBuilder } from '../../records.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { ApiError as HttpError, type Ctx } from '../handlers.ts';
import { viewerQueryContext } from '../../queryctx.ts';
import { instantiateTemplate, templateOfRow, TemplateError } from '../../automations/templates.ts';
import { ownedCollectionsOf } from '../../dbcopy.ts';

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new HttpError('Unauthorized', 401);
  return ctx.userId;
}

function canEditCollection(c: CollectionRecord | undefined, userId: string) {
  return !!c && roleAtLeast(blockRole(c.parent_id, userId), 'read_and_write');
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const handlers = {
  /** Instantiate a database template into an existing row: properties (where empty, template variables resolved),
   *  icon/cover, content with sub-pages, inline databases and linked views (automations/templates.ts). */
  applyDatabaseTemplate(ctx: Ctx, { rowId, templateId, override }: { rowId: string; templateId: string; override?: boolean }) {
    const uid = requireUser(ctx);
    const row = getRecord<BlockRecord>('block', String(rowId ?? ''));
    if (!row || !row.alive) throw new HttpError('Not found', 404);
    if (!roleAtLeast(blockRole(row.id, uid), 'read_and_write')) throw new HttpError('Forbidden', 403);
    // the template must be one the user can read, and a template of this row's database
    if (!templateOfRow(row, String(templateId ?? ''), uid)) throw new HttpError('Not found', 404);
    try {
      // buttons' "Add page to … as <template>": the template's values win over the ones the button set
      const res = instantiateTemplate(row.id, String(templateId), uid, { clientId: ctx.clientId, override: override === true });
      // the caller's own realtime echo is skipped by the client: hand the new records back with the response
      const rm = new RecordMapBuilder(uid);
      for (const ch of res.changes) rm.add(ch.table, ch.record);
      return { blockId: res.blockId, recordMap: rm.map };
    } catch (e) {
      if (e instanceof TemplateError) throw new HttpError(e.message, e.status);
      throw e;
    }
  },

  /** Server-side query with the shared engine: ordered row ids (+ groups / calculations). */
  queryRows(ctx: Ctx, { collectionId, viewId, search, limit }: { collectionId: string; viewId: string; search?: string; limit?: number }) {
    const uid = requireUser(ctx);
    const c = getRecord<CollectionRecord>('collection', String(collectionId ?? ''));
    const v = getRecord<CollectionViewRecord>('collection_view', String(viewId ?? ''));
    if (!c || !v || blockRole(c.parent_id, uid) === 'none' || blockRole(v.parent_id, uid) === 'none') throw new HttpError('Not found', 404);
    // the caller's view: hidden rows and restricted values never feed the result, filters, sorts, groups or calculations
    const qctx = viewerQueryContext(uid);
    const res = runQuery(qctx.rowsOf!(c.id), qctx.getRecord!('collection', c.id) as CollectionRecord, v, qctx, { search: typeof search === 'string' ? search.slice(0, 500) : undefined });
    const ids = res.rows.map((r) => r.id);
    const max = Math.min(Math.max(Number(limit) || ids.length, 0), 10_000);
    const rm = new RecordMapBuilder(uid);
    for (const r of res.rows.slice(0, max)) rm.add('block', r);
    return {
      result: {
        type: v.type, blockIds: ids.slice(0, max), total: res.total,
        groups: res.groups?.map((g) => ({ value: g.value, label: g.label, hidden: g.hidden, blockIds: g.rows.map((r) => r.id), aggregation: g.aggregation })),
        aggregations: res.aggregations,
      },
      recordMap: rm.map,
    };
  },

  /** CSV of a view (visible properties, current filters/sorts) — Export › Current view. */
  exportCollectionViewCsv(ctx: Ctx, { collectionId, viewId, allProperties }: { collectionId: string; viewId: string; allProperties?: boolean }) {
    const uid = requireUser(ctx);
    const c = getRecord<CollectionRecord>('collection', String(collectionId ?? ''));
    const v = getRecord<CollectionViewRecord>('collection_view', String(viewId ?? ''));
    if (!c || !v || blockRole(c.parent_id, uid) === 'none' || blockRole(v.parent_id, uid) === 'none') throw new HttpError('Not found', 404);
    const space = getRecord<SpaceRecord>('space', c.space_id);
    if (space?.disable_export && !space.permissions?.some((p) => p.user_id === uid && ['owner', 'membership_admin'].includes(p.role as string))) throw new HttpError('Export is disabled in this workspace', 403);
    // the exporting person's view, like Export in render.ts: no hidden rows, no "No access" columns, no hidden values
    const qctx = viewerQueryContext(uid);
    const col = qctx.getRecord!('collection', c.id) as CollectionRecord;
    const res = runQuery(qctx.rowsOf!(c.id), col, v, qctx);
    const stored = ((v.format as any)?.[propertiesKeyFor(v.type)] ?? []) as { property: string; visible: boolean }[];
    const order = ['title', ...stored.map((e) => e.property).filter((p) => p !== 'title'), ...Object.keys(col.schema).filter((p) => p !== 'title' && !stored.some((e) => e.property === p))];
    const props = order.filter((p, i) => order.indexOf(p) === i && col.schema[p] && col.schema[p].type !== 'button' && (allProperties || p === 'title' || stored.find((e) => e.property === p)?.visible !== false));
    const lines = [props.map((p) => csvEscape(col.schema[p].name)).join(',')];
    for (const r of res.rows) lines.push(props.map((p) => csvEscape(valueToText(getPropertyValue(r, p, col.schema, qctx), col.schema[p], qctx))).join(','));
    const name = toPlainText(c.name as any) || 'Untitled';
    return { filename: `${name}.csv`, csv: `${lines.join('\n')}\n` };
  },

  /** Import CSV rows into a data source (first column → title, new text properties for unknown headers). */
  importCsvToCollection(ctx: Ctx, { collectionId, csv }: { collectionId: string; csv: string }) {
    const uid = requireUser(ctx);
    const c = getRecord<CollectionRecord>('collection', String(collectionId ?? ''));
    if (!canEditCollection(c, uid)) throw new HttpError('Forbidden', 403);
    const table = parseCsv(String(csv ?? ''));
    if (!table.length) return { rows: 0 };
    if (table.length > 10_001 || table[0].length > 200) throw new HttpError('CSV is too large (10,000 rows / 200 columns max)', 413);
    const [header, ...body] = table;
    const spaceId = c!.space_id;
    const ops: any[] = [];
    const byName = new Map(Object.entries(c!.schema).map(([id, p]) => [p.name.toLowerCase(), id]));
    const colIds: string[] = header.map((h, i) => {
      if (i === 0) return 'title';
      const existing = byName.get(h.trim().toLowerCase());
      if (existing) return existing;
      let id = '';
      do id = Math.random().toString(36).slice(2, 6); while (c!.schema[id]);
      const prop: PropertySchema = { name: h.trim() || `Column ${i + 1}`, type: 'text' };
      ops.push({ pointer: { table: 'collection', id: c!.id, spaceId }, path: ['schema', id], command: 'set', args: prop });
      byName.set(prop.name.toLowerCase(), id);
      return id;
    });
    const now = Date.now();
    body.forEach((cells, ri) => {
      const id = newId();
      const properties: Record<string, any> = {};
      colIds.forEach((pid, ci) => {
        const val = (cells[ci] ?? '').trim();
        if (!val) return;
        const prop = c!.schema[pid];
        if (prop?.type === 'checkbox') properties[pid] = [[/^(yes|true|1|checked)$/i.test(val) ? 'Yes' : 'No']];
        else if (prop?.type === 'multi_select') properties[pid] = [[val.split(',').map((s) => s.trim()).filter(Boolean).join(',')]];
        else properties[pid] = [[val]];
      });
      ops.push({
        pointer: { table: 'block', id, spaceId }, path: [], command: 'set',
        args: { id, type: 'page', properties, parent_id: c!.id, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now + ri, created_by_id: uid, created_by_table: 'lit_user', last_edited_time: now + ri, last_edited_by_id: uid, last_edited_by_table: 'lit_user' },
      });
    });
    // user-initiated: a locked database takes rows but no new properties; property access applies (dbaccess.ts)
    applyTransactions(uid, [{ id: newId(), spaceId, debug: { userAction: 'importCsvToCollection' }, operations: ops }], ctx.clientId, { userInitiated: true });
    return { rows: body.length };
  },

  /** Duplicate a view into another (or the same) collection_view block. */
  duplicateCollectionView(ctx: Ctx, { viewId, blockId }: { viewId: string; blockId?: string }) {
    const uid = requireUser(ctx);
    const v = getRecord<CollectionViewRecord>('collection_view', String(viewId ?? ''));
    if (!v || blockRole(v.parent_id, uid) === 'none') throw new HttpError('Not found', 404);
    const target = String(blockId ?? v.parent_id);
    if (!roleAtLeast(blockRole(target, uid), 'read_and_write')) throw new HttpError('Forbidden', 403);
    const nid = newId();
    const { version: _v, applied_tx_ids: _a, ...rest } = v as any;
    applyTransactions(uid, [{
      id: newId(), spaceId: v.space_id, debug: { userAction: 'duplicateCollectionView' },
      operations: [
        { pointer: { table: 'collection_view', id: nid, spaceId: v.space_id }, path: [], command: 'set', args: { ...rest, id: nid, parent_id: target } },
        { pointer: { table: 'block', id: target, spaceId: v.space_id }, path: ['view_ids'], command: 'listAfter', args: target === v.parent_id ? { id: nid, after: viewId } : { id: nid } },
      ],
    }], ctx.clientId, { userInitiated: true }); // a locked database takes no new views
    return { viewId: nid };
  },

  /** Data sources the user can link to ("Link to existing data source" picker). */
  searchDataSources(ctx: Ctx, { spaceId, query, limit }: { spaceId: string; query?: string; limit?: number }) {
    const uid = requireUser(ctx);
    // a workspace-wide scan is for members (guests link the data sources shared with them from the page itself)
    if (!isSpaceMember(getRecord<SpaceRecord>('space', String(spaceId ?? '')), uid)) return { results: [], recordMap: {} };
    const q = String(query ?? '').trim().toLowerCase().slice(0, 200);
    const rm = new RecordMapBuilder(uid);
    const out: { collectionId: string; blockId: string; name: string }[] = [];
    const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const blocks = [...childrenOfSpace(String(spaceId))];
    for (const b of blocks) {
      if (out.length >= max) break;
      if (blockRole(b.id, uid) === 'none') continue;
      // every data source the database owns: several sources per database
      for (const c of ownedCollectionsOf(b)) {
        if (out.length >= max) break;
        const name = toPlainText(c.name as any) || 'Untitled';
        if (q && !name.toLowerCase().includes(q)) continue;
        out.push({ collectionId: c.id, blockId: b.id, name });
        rm.add('collection', c);
        rm.add('block', b);
        for (const vid of b.view_ids ?? []) rm.add('collection_view', getRecord('collection_view', vid));
      }
    }
    return { results: out, recordMap: rm.map };
  },
};

function* childrenOfSpace(spaceId: string): Generator<BlockRecord> {
  // collection_view(_page) blocks of a workspace, most recently edited first
  const all = (getRecordsInSpace(spaceId) as BlockRecord[]).filter((b) => b.alive && (b.type === 'collection_view' || b.type === 'collection_view_page'));
  all.sort((a, b) => (b.last_edited_time ?? 0) - (a.last_edited_time ?? 0));
  yield* all;
}

function getRecordsInSpace(spaceId: string) {
  return recordsInSpace<BlockRecord>('block', spaceId);
}
