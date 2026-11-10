// Data sources of a database block: a database can own or link sources.
// shows one or more data sources (collections). Sources it owns it (collection.parent_id = block); linked
// sources belong to another database. Every view points at its source (format.collection_pointer); the block keeps
// format.collection_pointers and collection_id identify the sources. Adding a source adds a Table tab.
// for it; the database title follows the active tab's source.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, ViewType } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { newId } from '@nc/shared/ids.ts';
import { records } from '../../../lib/store/records.ts';
import { run } from '../../../lib/blocks.ts';
import { useUI } from '../../../lib/store/ui.ts';
import type { Tx } from '../../../lib/store/transactions.ts';
import { createViewIn, defaultViewFormat, viewCreationHooks, VIEW_DEFAULT_NAMES } from '../actions.ts';
import { viewsOfBlock } from '../duplicate.ts';
import { copyName } from '../viewState.ts';

/** per-database limits (transactionErrors.collection_view_block_exceeds_max_collections). */
export const MAX_DATA_SOURCES = 50;

export interface BlockSources {
  /** data sources living under the block, first = block.collection_id */
  owned: CollectionRecord[];
  /** other databases' sources shown by the block's views */
  linked: CollectionRecord[];
  /** tab views per source id */
  views: Map<string, CollectionViewRecord[]>;
}

export function sourceIdOfView(v: CollectionViewRecord, block: BlockRecord): string | undefined {
  return (v.format as { collection_pointer?: { id?: string } } | undefined)?.collection_pointer?.id ?? block.collection_id ?? undefined;
}

export function sourceName(c: CollectionRecord | undefined): string {
  return toPlainText(c?.name as never) || '';
}

export function blockSources(block: BlockRecord): BlockSources {
  const views = new Map<string, CollectionViewRecord[]>();
  const order: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !order.includes(id)) order.push(id);
  };
  add(block.collection_id ?? undefined);
  for (const p of ((block.format as { collection_pointers?: { id?: string }[] } | undefined)?.collection_pointers ?? [])) add(p?.id);
  for (const id of block.view_ids ?? []) {
    const v = records.get<CollectionViewRecord>('collection_view', id);
    if (!v || v.alive === false) continue;
    const sid = sourceIdOfView(v, block);
    add(sid);
    if (sid) views.set(sid, [...(views.get(sid) ?? []), v]);
  }
  const owned: CollectionRecord[] = [];
  const linked: CollectionRecord[] = [];
  for (const id of order) {
    const c = records.get<CollectionRecord>('collection', id);
    if (!c || c.alive === false) continue;
    if (c.parent_id === block.id) owned.push(c);
    else if ((views.get(id) ?? []).length) linked.push(c);
  }
  return { owned, linked, views };
}

function pointer(c: { id: string; space_id?: string }, spaceId: string) {
  return { id: c.id, table: 'collection', spaceId: c.space_id ?? spaceId };
}

/** Keep block.format.collection_pointers in step with the sources the block shows. */
function syncPointers(tx: Tx, blockId: string) {
  const b = records.get<BlockRecord>('block', blockId);
  if (!b) return;
  const { owned, linked } = blockSources(b);
  tx.update('block', blockId, ['format'], { collection_pointers: [...owned, ...linked].map((c) => pointer(c, b.space_id)) });
}

/** "New empty data source" (or a template's schema): a data source under the block + a view of it. Returns the view. */
export function addDataSource(block: BlockRecord, opts: { name?: string; schema?: Record<string, PropertySchema>; views?: { type: ViewType; name?: string; groupBy?: string }[] } = {}): { collectionId: string; viewId: string } | null {
  const { owned } = blockSources(block);
  if (owned.length >= MAX_DATA_SOURCES) {
    useUI.getState().toast('You are at the maximum number of datasets for this table.');
    return null;
  }
  const collectionId = newId();
  let first = '';
  run('CollectionSettingsCreateViewSource.addNewDataSource', (tx) => {
    tx.set('collection', collectionId, [], {
      id: collectionId, name: opts.name ? [[opts.name]] : [], schema: opts.schema ?? { title: { name: 'Name', type: 'title' } }, format: {},
      parent_id: block.id, parent_table: 'block', alive: true, space_id: tx.spaceId, template_pages: [],
    });
    let after = block.view_ids?.[block.view_ids.length - 1];
    for (const v of opts.views?.length ? opts.views : [{ type: 'table' as ViewType }]) {
      const id = createViewIn(tx, block.id, v.type, collectionId, { name: v.name, extraFormat: { collection_pointer: { id: collectionId, table: 'collection', spaceId: tx.spaceId } } });
      if (v.groupBy && v.type === 'board') tx.update('collection_view', id, ['format'], { board_columns_by: { type: 'status', property: v.groupBy, groupBy: 'option', sort: { type: 'manual' }, hideEmptyGroups: false } });
      tx.listAfter('block', block.id, ['view_ids'], id, after);
      after = id;
      first ||= id;
      const c = records.get<CollectionRecord>('collection', collectionId);
      if (c) viewCreationHooks[v.type]?.(tx, id, c);
    }
    syncPointers(tx, block.id);
  });
  return { collectionId, viewId: first };
}

/** A view of another database's data source in this block: a new view of `type`, or a copy of `copyViewId`. */
export function addLinkedView(block: BlockRecord, target: CollectionRecord, opts: { type?: ViewType; copyViewId?: string; replaceViewIds?: string[] } = {}): string {
  let id = '';
  run('CollectionSettingsCreateViewSource.handleSourcePickerAccept', (tx) => {
    const src = opts.copyViewId ? records.get<CollectionViewRecord>('collection_view', opts.copyViewId) : undefined;
    const ptr = pointer(target, tx.spaceId);
    if (src) {
      id = newId();
      const { version: _v, ...rest } = src as CollectionViewRecord & { version?: number };
      tx.set('collection_view', id, [], {
        ...structuredClone(rest), id, parent_id: block.id, parent_table: 'block', alive: true, page_sort: [],
        format: { ...(structuredClone(rest.format ?? {}) as Record<string, unknown>), collection_pointer: ptr, dashboard_view_id: undefined },
      });
    } else {
      id = createViewIn(tx, block.id, opts.type ?? 'table', target.id, { extraFormat: { collection_pointer: ptr } });
      viewCreationHooks[opts.type ?? 'table']?.(tx, id, target);
    }
    tx.listAfter('block', block.id, ['view_ids'], id, block.view_ids?.[block.view_ids.length - 1]);
    for (const vid of opts.replaceViewIds ?? []) {
      tx.listRemove('block', block.id, ['view_ids'], vid);
      tx.update('collection_view', vid, [], { alive: false });
    }
    // a database whose only source is replaced by the link (New database › Link to existing data source) points at it
    if (!block.collection_id || opts.replaceViewIds?.length) {
      tx.update('block', block.id, [], { collection_id: target.id });
      tx.update('block', block.id, ['format'], { collection_pointer: ptr });
    }
    syncPointers(tx, block.id);
  });
  return id;
}

/** Views of a data source that a database (the "Views on <source>" list of the linked-view picker). */
export function viewsOfSource(collection: CollectionRecord): CollectionViewRecord[] {
  const host = records.get<BlockRecord>('block', collection.parent_id);
  if (!host) return [];
  return (host.view_ids ?? [])
    .map((id) => records.get<CollectionViewRecord>('collection_view', id))
    .filter((v): v is CollectionViewRecord => !!v && v.alive !== false && sourceIdOfView(v, host) === collection.id && v.type !== 'form');
}

/** Move a data source this block owns (and its views) to the Trash. The last source of a database stays. */
export function trashDataSource(block: BlockRecord, collectionId: string): boolean {
  const { owned, views } = blockSources(block);
  const c = owned.find((x) => x.id === collectionId);
  if (!c || owned.length + blockSources(block).linked.length <= 1) return false;
  const doomed = views.get(collectionId) ?? [];
  run('collectionSettingsActions.deleteDataSource', (tx) => {
    tx.update('collection', collectionId, [], { alive: false });
    for (const v of doomed) {
      tx.listRemove('block', block.id, ['view_ids'], v.id);
      tx.update('collection_view', v.id, [], { alive: false });
    }
    // widgets of dashboards on this source go too
    for (const v of viewsOfBlock(block)) if (!doomed.includes(v) && sourceIdOfView(v, block) === collectionId) tx.update('collection_view', v.id, [], { alive: false });
    if (block.collection_id === collectionId) {
      const next = owned.find((x) => x.id !== collectionId) ?? blockSources(block).linked[0];
      if (next) tx.update('block', block.id, [], { collection_id: next.id });
    }
    syncPointers(tx, block.id);
  });
  useUI.getState().toast(`Sent ${sourceName(c) || 'Untitled'} to trash`);
  return true;
}

/** Remove the views of a linked source from this block ("Delete linked views"). */
export function removeLinkedSource(block: BlockRecord, collectionId: string): boolean {
  const { views, owned, linked } = blockSources(block);
  const list = views.get(collectionId) ?? [];
  if (!list.length || owned.length + linked.length <= 1) return false;
  run('manageDataSourcesMenu.deleteLinkedViews', (tx) => {
    for (const v of list) {
      tx.listRemove('block', block.id, ['view_ids'], v.id);
      tx.update('collection_view', v.id, [], { alive: false });
    }
    if (block.collection_id === collectionId) {
      const next = owned[0] ?? linked.find((x) => x.id !== collectionId);
      if (next) tx.update('block', block.id, [], { collection_id: next.id });
    }
    syncPointers(tx, block.id);
  });
  return true;
}

/** Move a data source to another database with its views or alone, leaving the views here as linked views. */
export function moveDataSource(from: BlockRecord, collectionId: string, to: BlockRecord, withViews: boolean): boolean {
  const { owned, views, linked } = blockSources(from);
  const c = owned.find((x) => x.id === collectionId);
  if (!c || to.id === from.id) return false;
  const list = views.get(collectionId) ?? [];
  if (withViews && owned.length + linked.length <= 1) return false; // a database keeps at least one source
  if (blockSources(to).owned.length >= MAX_DATA_SOURCES) {
    useUI.getState().toast(`Maximum number of datasets (${MAX_DATA_SOURCES}) reached`);
    return false;
  }
  run('dataSourceMoveToMenu.moveDataSource', (tx) => {
    tx.update('collection', collectionId, [], { parent_id: to.id, parent_table: 'block' });
    if (withViews) {
      for (const v of list) {
        tx.listRemove('block', from.id, ['view_ids'], v.id);
        tx.update('collection_view', v.id, [], { parent_id: to.id });
        tx.listAfter('block', to.id, ['view_ids'], v.id);
      }
      if (from.collection_id === collectionId) {
        const next = owned.find((x) => x.id !== collectionId) ?? linked[0];
        if (next) tx.update('block', from.id, [], { collection_id: next.id });
      }
    } else {
      // the views stay and now show a source that elsewhere; the destination gets a table view of it
      const id = createViewIn(tx, to.id, 'table', collectionId, { name: VIEW_DEFAULT_NAMES.table, extraFormat: { collection_pointer: pointer(c, tx.spaceId) } });
      tx.listAfter('block', to.id, ['view_ids'], id);
    }
    if (!to.collection_id) tx.update('block', to.id, [], { collection_id: collectionId });
    syncPointers(tx, from.id);
    syncPointers(tx, to.id);
  });
  useUI.getState().toast(`Moved ${sourceName(c) || 'Untitled'}`);
  return true;
}

/** Name of a copied view ("Table" → "Table (1)"), used when copying a source's view into a linked database. */
export function linkedViewName(v: CollectionViewRecord): string {
  return copyName(v.name || VIEW_DEFAULT_NAMES[v.type] || 'View');
}

/** Point a view at another data source; its properties, filters, sorts, and layout settings are rebuilt for the new source. */
export function setViewSource(view: CollectionViewRecord, block: BlockRecord, target: CollectionRecord) {
  if (sourceIdOfView(view, block) === target.id) return;
  if (view.type === 'form' && target.parent_id !== block.id) return;
  run('CollectionSettingsSourceMenu.changeViewSource', (tx) => {
    const d = defaultViewFormat(view.type as ViewType, target.schema);
    // a board on a source without a status / select property gets one only when the database owns that source
    if (d.schemaPatch && target.parent_id === block.id) for (const [pid, p] of Object.entries(d.schemaPatch)) tx.set('collection', target.id, ['schema', pid], p);
    const reset: Record<string, unknown> = {};
    for (const k of ['property_filters', 'conditional_color_rules', 'collection_group_by', 'collection_groups', 'board_columns', 'collection_group_aggregation']) reset[k] = null;
    tx.update('collection_view', view.id, ['format'], { ...reset, ...d.format, collection_pointer: pointer(target, tx.spaceId) });
    tx.set('collection_view', view.id, ['query2'], { ...d.query2 });
    tx.set('collection_view', view.id, ['page_sort'], []);
    viewCreationHooks[view.type]?.(tx, view.id, target);
    syncPointers(tx, block.id);
  });
}
