// runQuery: apply a collection_view's filters (format.property_filters + query2.filter), search, sorts
// (query2.sort, else manual page_sort order), grouping (board_columns_by / collection_group_by + saved
// group order) and calculations (query2.aggregations, group header aggregation) to a collection's rows.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '../records.ts';
import { aggregateRows } from './aggregations.ts';
import { matchesFilter, matchesSearch } from './filters.ts';
import { computeGroups } from './groups.ts';
import type { AggregationResult, AggregationSpec, FilterGroup, FilterNode, GroupBy, GroupResult, PropertyFilterLeaf, QueryContext, QueryOptions, QueryResult, SavedGroup, Schema, SortSpec } from './types.ts';
import { compareValues, getPropertyValue, isEmptyValue } from './values.ts';
import { arrangeSubitems, subitemSettingsOf, type SubitemQueryResult } from './subitems.ts';

type ViewLike = Pick<CollectionViewRecord, 'type' | 'format' | 'query2' | 'page_sort'> & Partial<CollectionViewRecord>;

export function viewFormat(view: ViewLike): Record<string, any> {
  return (view.format ?? {}) as Record<string, any>;
}

/** Simple filter chips stored in format.property_filters ([{id, filter:{property, filter}}]). */
export function propertyFiltersOf(view: ViewLike): { id: string; filter: PropertyFilterLeaf }[] {
  const pf = viewFormat(view).property_filters;
  return Array.isArray(pf) ? pf.filter((f: any) => f && f.filter && f.filter.property) : [];
}

export function advancedFilterOf(view: ViewLike): FilterGroup | undefined {
  const f = view.query2?.filter as FilterGroup | undefined;
  return f && Array.isArray(f.filters) && f.filters.length ? f : undefined;
}

/** All filters of a view as one AND group. */
export function combinedFilter(view: ViewLike): FilterGroup | undefined {
  const parts: FilterNode[] = propertyFiltersOf(view).map((f) => f.filter);
  const adv = advancedFilterOf(view);
  if (adv) parts.push(adv);
  return parts.length ? { operator: 'and', filters: parts } : undefined;
}

export function sortsOf(view: ViewLike, schema?: Schema): SortSpec[] {
  const s = (view.query2?.sort ?? []) as SortSpec[];
  return s.filter((x) => x && x.property && (!schema || schema[x.property]));
}

export function groupByOf(view: ViewLike, schema?: Schema): GroupBy | null {
  const f = viewFormat(view);
  let gb: GroupBy | null = null;
  if (view.type === 'board') {
    gb = (f.board_columns_by as GroupBy) ?? null;
    if (!gb && typeof view.query2?.group_by === 'string') {
      const pid = view.query2.group_by as string;
      gb = { type: schema?.[pid]?.type ?? 'select', property: pid, sort: { type: 'manual' } };
    }
  } else gb = (f.collection_group_by as GroupBy) ?? null;
  if (gb && schema && !schema[gb.property]) return null;
  return gb && gb.property ? gb : null;
}

export function subGroupByOf(view: ViewLike, schema?: Schema): GroupBy | null {
  if (view.type !== 'board') return null;
  const gb = viewFormat(view).collection_group_by as GroupBy | undefined;
  if (!gb || !gb.property || (schema && !schema[gb.property])) return null;
  return gb;
}

export function savedGroupsOf(view: ViewLike): SavedGroup[] {
  const f = viewFormat(view);
  if (view.type === 'board') return (f.board_columns ?? f.board_groups2 ?? []) as SavedGroup[];
  return (f.collection_groups ?? []) as SavedGroup[];
}

export function savedSubGroupsOf(view: ViewLike): SavedGroup[] {
  return view.type === 'board' ? ((viewFormat(view).collection_groups ?? []) as SavedGroup[]) : [];
}

/** Group header calculation: board → query2.aggregations[0]; others → format.collection_group_aggregation. */
export function groupAggregationOf(view: ViewLike): AggregationSpec | null {
  if (view.type === 'board') {
    const a = (view.query2?.aggregations ?? [])[0] as AggregationSpec | undefined;
    return a ?? { aggregator: 'count' };
  }
  const a = viewFormat(view).collection_group_aggregation as AggregationSpec | undefined;
  return a ?? { aggregator: 'count' };
}

export function footerAggregationsOf(view: ViewLike): AggregationSpec[] {
  if (view.type === 'board') return [];
  return ((view.query2?.aggregations ?? []) as AggregationSpec[]).filter((a) => a && a.property);
}

/**
 * Rows in the view's manual order. Rows listed in `page_sort` (rows added with "+ New page" are appended
 * there, like Litpage's `page_sort listAfter`) keep that order; rows not listed come first, newest first
 * Litpage shows a fresh view's rows newest-first.
 */
export function manualOrder(rows: BlockRecord[], pageSort: string[] | undefined): BlockRecord[] {
  const newestFirst = [...rows].sort((a, b) => (b.created_time ?? 0) - (a.created_time ?? 0) || (a.id < b.id ? 1 : -1));
  if (!pageSort?.length) return newestFirst;
  const pos = new Map(pageSort.map((id, i) => [id, i]));
  const known = rows.filter((r) => pos.has(r.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  const rest = newestFirst.filter((r) => !pos.has(r.id));
  return [...rest, ...known];
}

/** Multi-level sort; empty values last regardless of direction; stable. */
export function sortRows(rows: BlockRecord[], sorts: SortSpec[], schema: Schema, ctx: QueryContext): BlockRecord[] {
  if (!sorts.length) return rows;
  const keyed = rows.map((row, index) => ({
    row,
    index,
    vals: sorts.map((s) => getPropertyValue(row, s.property, schema, ctx)),
  }));
  keyed.sort((a, b) => {
    for (let i = 0; i < sorts.length; i++) {
      const prop: PropertySchema | undefined = schema[sorts[i].property];
      const va = a.vals[i];
      const vb = b.vals[i];
      const ea = va.kind !== 'checkbox' && isEmptyValue(va);
      const eb = vb.kind !== 'checkbox' && isEmptyValue(vb);
      if (ea && eb) continue;
      if (ea) return 1;
      if (eb) return -1;
      let c = compareValues(va, vb, prop, ctx);
      if (sorts[i].direction === 'descending') c = -c;
      if (c) return c;
    }
    return a.index - b.index;
  });
  return keyed.map((k) => k.row);
}

/** Main entry point shared by every view (and the server's queryRows). */
export function runQuery(rows: BlockRecord[], collection: Pick<CollectionRecord, 'schema'> & Partial<CollectionRecord>, view: ViewLike, ctx: QueryContext = {}, opts: QueryOptions = {}): QueryResult {
  const schema = collection.schema ?? {};
  const c: QueryContext = { ...ctx, cache: ctx.cache ?? new Map() };
  let list = rows.filter((r) => r && r.alive !== false && !r.is_template);
  const sorts = sortsOf(view, schema);
  const filter = !opts.ignoreFilters ? combinedFilter(view) : undefined;
  const searchText = opts.search?.trim();
  const sub = opts.subitems === false ? null : subitemSettingsOf(view, collection as Parameters<typeof subitemSettingsOf>[1]);
  let subitems: SubitemQueryResult | undefined;
  if (sub) {
    // sub-items: order every row, then keep the tree (filters per "Filter options")
    const orderedAll = sorts.length ? sortRows(manualOrder(list, view.page_sort), sorts, schema, c) : manualOrder(list, view.page_sort);
    const arranged = arrangeSubitems(orderedAll, (r) => (!filter || matchesFilter(r, filter, schema, c)) && (!searchText || matchesSearch(r, schema, searchText, c)), sub);
    list = arranged.rows;
    subitems = arranged.result;
  } else {
    if (filter) list = list.filter((r) => matchesFilter(r, filter, schema, c));
    if (searchText) list = list.filter((r) => matchesSearch(r, schema, searchText, c));
    list = sorts.length ? sortRows(manualOrder(list, view.page_sort), sorts, schema, c) : manualOrder(list, view.page_sort);
  }

  const aggregations: Record<string, AggregationResult> = {};
  for (const spec of footerAggregationsOf(view)) {
    if (spec.property && schema[spec.property]) aggregations[spec.property] = aggregateRows(list, spec, schema, c);
  }

  const gb = opts.groupBy !== undefined ? opts.groupBy : groupByOf(view, schema);
  const subGb = opts.subGroupBy !== undefined ? opts.subGroupBy : subGroupByOf(view, schema);
  let groups: GroupResult[] | undefined;
  if (gb && schema[gb.property]) {
    const groupAgg = groupAggregationOf(view);
    groups = computeGroups(list, gb, schema, c, { saved: savedGroupsOf(view), board: view.type === 'board' });
    for (const g of groups) {
      if (groupAgg) g.aggregation = aggregateRows(g.rows, groupAgg, schema, c);
      if (subGb && schema[subGb.property]) {
        g.subgroups = computeGroups(g.rows, subGb, schema, c, { saved: savedSubGroupsOf(view), board: false });
        if (groupAgg) for (const sg of g.subgroups) sg.aggregation = aggregateRows(sg.rows, groupAgg, schema, c);
      }
    }
  }
  return { rows: list, total: list.length, groups, aggregations, groupBy: gb, subGroupBy: subGb, subitems };
}
