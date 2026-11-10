// Database creation: collection (schema) + collection_view(s) + block (inline `collection_view` or full-page
// `collection_view_page`) — the record split uses (05-database-.4: block set with
// format.collection_pointer, view set with table_properties [{title,280}], collection with schema {title:"Name"}).
// New databases start with no rows (the table shows placeholder rows).
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, ViewType } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { createBlockIn, getBlock, run } from '../../lib/blocks.ts';
import type { Tx } from '../../lib/store/transactions.ts';
import { useEditor } from '../editor/editorState.ts';
import type { SlashContext } from '../editor/slashItems.ts';
import { openPage } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { createViewIn as createViewForCollection, defaultViewFormat, newPropertyId, VIEW_DEFAULT_NAMES, viewCreationHooks } from './actions.ts';
import { openLinkedSourcePicker } from './chrome/LinkedSourcePicker.tsx';
import { newChartConfig } from './views/chart/chartModel.ts';

export const VIEW_LABEL: Record<string, string> = VIEW_DEFAULT_NAMES;

/** New database schema: just the title property “Name”. */
export function defaultSchema(): Record<string, PropertySchema> {
  return { title: { name: 'Name', type: 'title' } };
}

export function shortId(): string {
  return newPropertyId();
}

/** Initial view format for `type` over a schema (kept for other view work streams). */
export function viewFormat(type: ViewType, schema: Record<string, PropertySchema>): Record<string, unknown> {
  return defaultViewFormat(type, schema).format;
}

/** Create a view record (legacy signature: schema instead of collection id). */
export function createViewIn(tx: Tx, blockId: string, type: ViewType, schema: Record<string, PropertySchema>, opts?: { name?: string; chartType?: string; id?: string; collectionId?: string }): string {
  const block = records.get<BlockRecord>('block', blockId);
  const collectionId = opts?.collectionId ?? block?.collection_id;
  if (collectionId) return createViewForCollection(tx, blockId, type, collectionId, { name: opts?.name, id: opts?.id, extraFormat: opts?.chartType ? { chart_type: opts.chartType } : undefined });
  const id = opts?.id ?? newId();
  const d = defaultViewFormat(type, schema);
  tx.set('collection_view', id, [], {
    id, type, name: opts?.name ?? VIEW_LABEL[type] ?? 'View', format: { ...d.format, ...(opts?.chartType ? { chart_type: opts.chartType } : {}) }, query2: d.query2,
    parent_id: blockId, parent_table: 'block', alive: true, space_id: tx.spaceId, page_sort: [],
  });
  return id;
}

export interface CreateDatabaseOptions {
  parentId: string;
  parentTable: 'block' | 'space' | 'team';
  after?: string;
  inline: boolean;
  viewType: ViewType;
  chartType?: string;
  name?: string;
  rows?: number;
  list?: any;
  /** show the "New database" setup panel (full-page databases) */
  setupPanel?: boolean;
}

export function createDatabaseIn(tx: Tx, opts: CreateDatabaseOptions): { blockId: string; collectionId: string; viewId: string } {
  const blockId = newId();
  const collectionId = newId();
  const schema = defaultSchema();
// a new form’s database records who answered: “Respondent”
  if (opts.viewType === 'form') schema[shortId()] = { name: 'Respondent', type: 'created_by' } as PropertySchema;
  const col: Omit<CollectionRecord, 'version'> = {
    id: collectionId, name: opts.name ? [[opts.name]] : [], schema, format: {},
    parent_id: blockId, parent_table: 'block', alive: true, space_id: tx.spaceId, template_pages: [],
  };
  tx.set('collection', collectionId, [], col);
  const pointer = { id: collectionId, table: 'collection', spaceId: tx.spaceId };
  createBlockIn(tx, {
    id: blockId, type: opts.inline ? 'collection_view' : 'collection_view_page', parentId: opts.parentId, parentTable: opts.parentTable, after: opts.after,
    format: { collection_pointer: pointer, ...(opts.setupPanel ?? !opts.inline ? { nc_new_database_setup: true } : {}) } as any,
    extra: { collection_id: collectionId, view_ids: [] }, list: opts.list,
  });
  const viewId = createViewForCollection(tx, blockId, opts.viewType, collectionId, { extraFormat: { collection_pointer: pointer, ...(opts.chartType ? { chart_type: opts.chartType } : {}) } });
  tx.listAfter('block', blockId, ['view_ids'], viewId);
  const c = records.get<CollectionRecord>('collection', collectionId);
  if (c) viewCreationHooks[opts.viewType]?.(tx, viewId, c);
  // /Horizontal bar chart, /Line chart … start as that chart type (format.chart_type alone wasn't read by the view)
  if (opts.viewType === 'chart' && opts.chartType) tx.update('collection_view', viewId, ['format'], { chart_config: newChartConfig(c?.schema ?? schema, opts.chartType) });
  for (let i = 0; i < (opts.rows ?? 0); i++) createBlockIn(tx, { type: 'page', parentId: collectionId, parentTable: 'collection', list: null });
  return { blockId, collectionId, viewId };
}

/** Slash menu entry point (/Table view, /Board view, /Database - Inline, /Database - Full page, /Linked view of data source…). */
export function insertDatabase(ctx: SlashContext, opts: { viewType: ViewType; inline: boolean; linked?: boolean; chartType?: string }) {
  const b = getBlock(ctx.blockId);
  if (!b) return;
  if (opts.viewType === 'chart' && !opts.linked) {
    // /chart: "New chart" (a new database) or link an existing data source 
    const el = document.querySelector<HTMLElement>(`[data-block-id="${ctx.blockId}"]`);
    const removeEmpty = (tx: Tx) => {
      if (ctx.empty && b.type === 'text') {
        tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
        tx.update('block', ctx.blockId, [], { alive: false });
      }
    };
    setTimeout(() => openLinkedSourcePicker(el ?? document.body, {
      skipViewStep: true,
      createLabel: 'New chart',
      onPick: (target) => {
        run('createLinkedChart', (tx) => {
          const blockId = newId();
          const pointer = { id: target.id, table: 'collection', spaceId: target.space_id };
          createBlockIn(tx, { id: blockId, type: 'collection_view', parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId, format: { collection_pointer: pointer, collection_pointers: [pointer] } as any, extra: { collection_id: target.id, view_ids: [] } });
          const viewId = createViewForCollection(tx, blockId, 'chart', target.id, { extraFormat: { collection_pointer: pointer } });
          viewCreationHooks.chart?.(tx, viewId, target);
          tx.update('collection_view', viewId, ['format'], { chart_config: newChartConfig(target.schema, opts.chartType) });
          tx.listAfter('block', blockId, ['view_ids'], viewId);
          removeEmpty(tx);
        });
        useEditor.getState().clearBlockSelection();
      },
      onCreate: (name) => {
        let id = '';
        run('createDatabase', (tx) => {
          id = createDatabaseIn(tx, { parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId, inline: true, viewType: 'chart', chartType: opts.chartType, name: name || undefined }).blockId;
          removeEmpty(tx);
        });
        useEditor.getState().clearBlockSelection();
        if (!name) setTimeout(() => document.querySelector<HTMLElement>(`[data-block-id="${id}"] .nc-db-title-leaf`)?.focus(), 60);
      },
    }), 0);
    return;
  }
  if (opts.linked) {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${ctx.blockId}"]`);
    // opened after the slash menu has closed (it closes the overlays stacked above it)
    setTimeout(() => openLinkedSourcePicker(el ?? document.body, {
      // step 2 picks a new view or a copy of one of the source's views 
      onPick: (target, choice) => {
        run('createLinkedDatabase', (tx) => {
          const blockId = newId();
          const pointer = { id: target.id, table: 'collection', spaceId: target.space_id };
          createBlockIn(tx, { id: blockId, type: 'collection_view', parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId, format: { collection_pointer: pointer, collection_pointers: [pointer] } as any, extra: { collection_id: target.id, view_ids: [] } });
          const src = choice.copyViewId ? records.get<CollectionViewRecord>('collection_view', choice.copyViewId) : undefined;
          let viewId: string;
          if (src) {
            viewId = newId();
            const { version: _v, ...rest } = src as CollectionViewRecord & { version?: number };
            tx.set('collection_view', viewId, [], { ...structuredClone(rest), id: viewId, parent_id: blockId, parent_table: 'block', alive: true, page_sort: [], format: { ...structuredClone(rest.format ?? {}), collection_pointer: pointer } });
          } else {
            viewId = createViewForCollection(tx, blockId, choice.type ?? opts.viewType, target.id, { extraFormat: { collection_pointer: pointer } });
            viewCreationHooks[choice.type ?? opts.viewType]?.(tx, viewId, target);
          }
          tx.listAfter('block', blockId, ['view_ids'], viewId);
          if (ctx.empty && b.type === 'text') {
            tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
            tx.update('block', ctx.blockId, [], { alive: false });
          }
        });
        useEditor.getState().clearBlockSelection();
      },
      // "New empty data source" / New “…” data source: a new inline database instead of a link
      onCreate: (name) => {
        let id = '';
        run('createDatabase', (tx) => {
          id = createDatabaseIn(tx, { parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId, inline: true, viewType: opts.viewType, name: name || undefined }).blockId;
          if (ctx.empty && b.type === 'text') {
            tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
            tx.update('block', ctx.blockId, [], { alive: false });
          }
        });
        useEditor.getState().clearBlockSelection();
        if (!name) setTimeout(() => document.querySelector<HTMLElement>(`[data-block-id="${id}"] .nc-db-title-leaf`)?.focus(), 60);
      },
    }), 0);
    return;
  }
  let res: { blockId: string } | null = null;
  run('createDatabase', (tx) => {
    res = createDatabaseIn(tx, { parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId, inline: opts.inline, viewType: opts.viewType, chartType: opts.chartType });
    if (ctx.empty && b.type === 'text') {
      tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
      tx.update('block', ctx.blockId, [], { alive: false });
    }
  });
  useEditor.getState().clearBlockSelection();
  if (res && !opts.inline) openPage((res as { blockId: string }).blockId);
  else if (res) {
    const id = (res as { blockId: string }).blockId;
    setTimeout(() => document.querySelector<HTMLElement>(`[data-block-id="${id}"] .nc-db-title-leaf`)?.focus(), 60);
  }
}

export function rowsOf(collectionId: string, all: BlockRecord[]): BlockRecord[] {
  return all.filter((b) => b.parent_table === 'collection' && b.parent_id === collectionId && b.alive && !b.is_template);
}

/** "Get started with" › Database / Form / ••• layouts on an empty page: the page itself becomes a * full-page database of that layout (its title becomes the database's name); "Database" also opens the New database * panel /Database - Full page. */
export function turnPageIntoDatabase(pageId: string, viewType: ViewType, opts: { setupPanel?: boolean } = {}) {
  const page = getBlock(pageId);
  if (!page || page.type !== 'page') return;
  run('getStarted.turnIntoDatabase', (tx) => {
    const collectionId = newId();
    const schema = defaultSchema();
    if (viewType === 'form') schema[shortId()] = { name: 'Respondent', type: 'created_by' } as PropertySchema;
    tx.set('collection', collectionId, [], {
      id: collectionId, name: (page.properties?.title as unknown) ?? [], schema, format: {},
      parent_id: pageId, parent_table: 'block', alive: true, space_id: tx.spaceId, template_pages: [],
    });
    const pointer = { id: collectionId, table: 'collection', spaceId: tx.spaceId };
    tx.update('block', pageId, [], { type: 'collection_view_page', collection_id: collectionId, view_ids: [] });
    tx.update('block', pageId, ['format'], { collection_pointer: pointer, collection_pointers: [pointer], ...(opts.setupPanel ? { nc_new_database_setup: true } : {}) });
    const viewId = createViewForCollection(tx, pageId, viewType, collectionId, { extraFormat: { collection_pointer: pointer } });
    tx.listAfter('block', pageId, ['view_ids'], viewId);
    const c = records.get<CollectionRecord>('collection', collectionId);
    if (c) viewCreationHooks[viewType]?.(tx, viewId, c);
  });
}
