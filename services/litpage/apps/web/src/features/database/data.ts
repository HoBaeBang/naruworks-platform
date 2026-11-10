// Database data access for views: rows of a collection, QueryContext backed by the record store, and a
// memoized runQuery hook. Every view (core + calendar/timeline/chart/… from other work streams) uses these.
import { useMemo, useRef } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, Table, UserSettingsRecord } from '@nc/shared/records.ts';
import { conditionalColorRulesOf, conditionalColorsFor, runQuery, type ConditionalColors, type QueryContext, type QueryOptions, type QueryResult } from '@nc/shared/database/index.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useTableVersion } from '../../lib/hooks.ts';
import { isArchivedRecord } from '@nc/shared/archive.ts';
import { useArchivedViews } from '../page/archive.tsx';
import { effectiveView, useViewTempVersion } from './viewState.ts';
import './formulaBridge.ts';

/** Rows (pages) of a data source in creation order (alive, non-template). Archived rows are left out; * `archived: true` returns only them (Settings › View archived pages). */
export function collectionRows(collectionId: string | undefined, opts: { archived?: boolean } = {}): BlockRecord[] {
  if (!collectionId) return [];
  const out: BlockRecord[] = [];
  for (const b of records.all<BlockRecord>('block')) {
    if (b.parent_table === 'collection' && b.parent_id === collectionId && b.alive && !b.is_template && isArchivedRecord(b) === !!opts.archived) out.push(b);
  }
  return out.sort((a, b) => (a.created_time ?? 0) - (b.created_time ?? 0) || (a.id < b.id ? -1 : 1));
}

/** Template pages of a data source (collection.template_pages order). */
export function collectionTemplates(collection: CollectionRecord | undefined): BlockRecord[] {
  if (!collection) return [];
  return (collection.template_pages ?? []).map((id) => records.get<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && b.alive);
}

export function makeQueryContext(): QueryContext {
  const userId = useSession.getState().userId ?? undefined;
  const settings = records.get<UserSettingsRecord>('user_settings', userId);
  const memo = new Map<string, BlockRecord[]>();
  return {
    getRecord: (table, id) => records.get(table as Table, id),
    rowsOf: (cid) => {
      if (!memo.has(cid)) memo.set(cid, collectionRows(cid));
      return memo.get(cid)!;
    },
    userId,
    now: Date.now(),
    startOfWeek: (settings?.settings?.start_day_of_week as 0 | 1 | undefined) ?? 0,
    cache: new Map(),
  };
}

/** Re-render on any block / collection / view / user change; returns a version number. */
export function useDatabaseVersion(): number {
  return useTableVersion(['block', 'collection', 'collection_view', 'lit_user']);
}

export function useCollectionRows(collectionId: string | undefined): BlockRecord[] {
  const v = useTableVersion(['block']);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => collectionRows(collectionId), [collectionId, v]);
}

/** runQuery for a view, memoized on record changes + options. */
export function useViewQuery(collection: CollectionRecord | undefined, view: CollectionViewRecord | undefined, opts: QueryOptions = {}): QueryResult {
  const version = useDatabaseVersion();
  const last = useRef<QueryResult | null>(null);
  const key = JSON.stringify(opts);
  const archived = useArchivedViews((s) => !!(view && s.on[view.parent_id]));
// the person’s unsaved filters and sorts apply to what they see
  const temp = useViewTempVersion();
  return useMemo(() => {
    if (!collection || !view) return { rows: [], total: 0, aggregations: {} };
    const rows = collectionRows(collection.id, { archived });
    const res = runQuery(rows, collection, effectiveView(view), makeQueryContext(), opts);
    last.current = res;
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, view, version, key, archived, temp]);
}

/** localStorage key of the tab a database block shows (DatabaseView remembers the last one used). */
export const activeViewKey = (blockId: string) => `nc:activeView:${blockId}`;

/** The view a database block shows: its remembered tab, else the first (Find in page searches what it shows). */
export function activeViewIdOf(block: BlockRecord): string | undefined {
  const ids = block.view_ids ?? [];
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(activeViewKey(block.id));
  } catch {
    /* storage unavailable */
  }
  return remembered && ids.includes(remembered) ? remembered : ids[0];
}

/** The block (collection_view / collection_view_page) that hosts a data source, if loaded. */
export function hostBlockOf(collection: CollectionRecord | undefined): BlockRecord | undefined {
  return collection ? records.get<BlockRecord>('block', collection.parent_id) : undefined;
}

export function collectionOfBlock(block: BlockRecord | undefined): CollectionRecord | undefined {
  if (!block) return undefined;
  const id = block.collection_id ?? (block.format as any)?.collection_pointer?.id;
  return records.get<CollectionRecord>('collection', id);
}

/** Data source of a view: linked views carry format.collection_pointer, otherwise the host block's collection. */
export function collectionOfView(view: CollectionViewRecord | undefined, block: BlockRecord | undefined): CollectionRecord | undefined {
  const pid = (view?.format as any)?.collection_pointer?.id;
  if (pid) return records.get<CollectionRecord>('collection', pid);
  return collectionOfBlock(block);
}

/** Conditional color (view settings › Conditional color): per-row colors for the rows rendered by a view. */
export function useConditionalColors(view: CollectionViewRecord | undefined, collection: CollectionRecord | undefined): (row: BlockRecord) => ConditionalColors | null {
  const v = useDatabaseVersion();
  return useMemo(() => {
    const rules = conditionalColorRulesOf(view);
    if (!rules.length || !collection) return () => null;
    const ctx = makeQueryContext();
    const cache = new Map<string, ConditionalColors>();
    return (row: BlockRecord) => {
      const hit = cache.get(row.id);
      if (hit) return hit;
      const c = conditionalColorsFor(row, rules, collection.schema, ctx);
      cache.set(row.id, c);
      return c;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, collection, v]);
}

const CONDITIONAL_COLORS = new Set(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);
/** Background used by conditional colors (same palette as block "… background" colors). */
export function conditionalBg(color: string | undefined): string | undefined {
  return color && CONDITIONAL_COLORS.has(color) ? `var(--lp-${color}-bg-secondary)` : undefined;
}
