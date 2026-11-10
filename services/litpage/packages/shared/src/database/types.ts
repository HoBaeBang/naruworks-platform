// Shared database (data source) engine types.
// Record shapes: collection.schema / collection_view.format / query2.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, SelectOption } from '../records.ts';
import type { DateValue, RichText } from '../richtext.ts';
import type { SubitemQueryResult } from './subitems.ts';

export type Schema = Record<string, PropertySchema>;

export interface StatusGroup {
  id: string;
  name: string; // stored English literal: "To-do" | "In progress" | "Complete"
  color: string;
  optionIds: string[];
}

/** Lookups the engine needs from the record store (client) or the database (server). */
export interface QueryContext {
  getRecord?: (table: string, id: string) => any;
  /** alive, non-template rows of a collection (relations / rollups / location) */
  rowsOf?: (collectionId: string) => BlockRecord[];
  /** viewer id for "Me" person filters */
  userId?: string;
  /** "now" in epoch ms (tests pin it) */
  now?: number;
  /** 0 = Sunday (en-US default), 1 = Monday */
  startOfWeek?: 0 | 1;
  locale?: string;
  /** per-query memo for computed values */
  cache?: Map<string, PropertyValue>;
  /** recursion guard for formulas/rollups */
  depth?: number;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  end?: string;
  endTime?: string;
  timeZone?: string;
  /** local epoch ms of the start (00:00 when no time) */
  startMs: number;
  endMs?: number;
  hasTime: boolean;
  isRange: boolean;
  raw?: DateValue;
}

export interface FileValue {
  name: string;
  url: string;
  id?: string;
}

export interface PlaceValue {
  lat?: number;
  lon?: number;
  name?: string;
  address?: string;
  [k: string]: unknown;
}

/** Typed value of one property of one row. */
export type PropertyValue =
  | { kind: 'text'; text: string; rich?: RichText }
  | { kind: 'number'; number: number | null }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'select'; options: SelectOption[] } // select (0..1) and multi_select (0..n)
  | { kind: 'status'; option: SelectOption | null; group: StatusGroup | null }
  | { kind: 'date'; date: DateRange | null }
  /** groups: permission groups in the value (["g", groupId, spaceId] atoms — "Search for people or groups…") */
  | { kind: 'person'; ids: string[]; groups?: { id: string; spaceId?: string }[] }
  | { kind: 'relation'; ids: string[] }
  | { kind: 'file'; files: FileValue[] }
  | { kind: 'place'; place: PlaceValue | null }
  | { kind: 'verification'; state: 'verified' | 'expired' | 'none'; date?: DateRange | null; by?: string }
  | { kind: 'button' }
  | { kind: 'array'; items: PropertyValue[] }
  | { kind: 'error'; message: string };

export type PropertyValueKind = PropertyValue['kind'];

// ---------- query2 / format shapes ---------

export interface FilterValue {
  type: 'exact' | 'relative' | 'is_option' | 'is_group';
  value?: any;
  unit?: 'day' | 'week' | 'month' | 'year';
  direction?: 'past' | 'future';
  count?: number;
}

export interface PropertyFilterLeaf {
  property: string;
  filter: {
    operator: string;
    value?: FilterValue | FilterValue[];
    /** filter on the end date of date ranges */
    use_end?: boolean;
    /** quantifier filters (formula/rollup lists): operator any|none|every */
    subfilter?: { operator: string; value?: FilterValue | FilterValue[] };
  };
}

export interface FilterGroup {
  operator: 'and' | 'or';
  filters: FilterNode[];
}

export type FilterNode = PropertyFilterLeaf | FilterGroup;

export interface SortSpec {
  property: string;
  direction: 'ascending' | 'descending';
}

export type Aggregator =
  | 'none' | 'count' | 'count_values' | 'unique' | 'empty' | 'not_empty' | 'percent_empty' | 'percent_not_empty'
  | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked'
  | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range'
  | 'earliest_date' | 'latest_date' | 'date_range' | 'show_unique' | 'show_original'
  | 'count_per_group' | 'percent_per_group';

export interface AggregationSpec {
  property?: string;
  aggregator: Aggregator | { operator: 'count_per_group' | 'percent_per_group'; groupName: string };
  enforceMaxAggregationLimit?: boolean;
}

export interface GroupBy {
  type: string; // property type
  property: string;
  groupBy?: string | { type: 'unique' | 'range'; start?: number; end?: number; size?: number };
  hideEmptyGroups?: boolean;
  sort?: { type: 'manual' | 'ascending' | 'descending' };
  start?: number;
  end?: number;
  size?: number;
  startDayOfWeek?: 0 | 1;
  disableBoardColorColumns?: boolean;
}

/** Stored group descriptor ({type, value?}); value undefined = "No <property>". */
export interface GroupValue {
  type: string;
  value?: any;
}

export interface SavedGroup {
  property: string;
  value: GroupValue;
  hidden?: boolean;
  emptyHidden?: boolean;
}

export interface Query2 {
  filter?: FilterGroup;
  sort?: SortSpec[];
  aggregations?: AggregationSpec[];
  [k: string]: unknown;
}

export interface AggregationResult {
  aggregator: string;
  property?: string;
  /** raw numeric/date result */
  value: number | null;
  /** formatted text shown in the UI (e.g. "3", "50%", "$1,200.00", "Oct 3, 2026") */
  display: string;
  /** for show_unique */
  values?: PropertyValue[];
}

export interface GroupResult {
  /** stable key (JSON of value) */
  id: string;
  value: GroupValue;
  label: string;
  color?: string;
  /** option/status-group backing this group, if any */
  option?: SelectOption;
  rows: BlockRecord[];
  hidden: boolean;
  /** "No <property>" bucket */
  uncategorized: boolean;
  subgroups?: GroupResult[];
  aggregation?: AggregationResult;
}

export interface QueryOptions {
  /** live search text from the toolbar search box */
  search?: string;
  /** compute groups using this config instead of the view's */
  groupBy?: GroupBy | null;
  subGroupBy?: GroupBy | null;
  /** skip property_filters (e.g. when a chip is being edited) */
  ignoreFilters?: boolean;
  /** false: ignore sub-item nesting (every row top level) */
  subitems?: boolean;
}

export interface QueryResult {
  rows: BlockRecord[];
  total: number;
  groups?: GroupResult[];
  /** footer calculations keyed by property id */
  aggregations: Record<string, AggregationResult>;
  groupBy?: GroupBy | null;
  subGroupBy?: GroupBy | null;
  /** sub-items arrangement (rows = top-level rows when nested); undefined when sub-items are off for the view */
  subitems?: SubitemQueryResult;
}

export type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, SelectOption };
