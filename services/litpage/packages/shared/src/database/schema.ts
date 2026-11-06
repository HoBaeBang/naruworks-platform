// Property-type / view-type metadata: creatable order, picker sections, number/date/time formats,
// status defaults, filter operator sets, aggregations by type, filter labels, relative dates,
// aggregation labels, group-by defaults, peek modes and load limits.
import type { PropertySchema, PropertyType, SelectOption } from '../records.ts';
import type { GroupBy, StatusGroup } from './types.ts';

export interface PropertyTypeMeta {
  type: PropertyType | 'last_visited_time';
  label: string;
  /** icon name for <Icon> (icon registry name where known) */
  icon: string;
  description?: string;
  tooltip?: string;
  section?: 'basic' | 'advanced' | 'metadata';
  /** order in "Change type"/creatable list */
  creatableOrder?: number;
  filterValueType: FilterValueType | null;
  aggregations: string[];
  /** group-by default config */
  groupable: boolean;
  /** value is computed, not stored in block.properties */
  computed?: boolean;
  /** cell has no popup editor (toggle / read only) */
  noEditor?: boolean;
}

export type FilterValueType =
  | 'text' | 'number' | 'checkbox' | 'select' | 'multi_select' | 'status' | 'person' | 'relation' | 'date' | 'file'
  | 'location' | 'verification' | 'place' | 'formula' | 'rollup';

export const FILTER_OPERATORS: Record<FilterValueType, string[]> = {
  text: ['string_is', 'string_is_not', 'string_contains', 'string_does_not_contain', 'string_starts_with', 'string_ends_with', 'is_empty', 'is_not_empty'],
  number: ['number_equals', 'number_does_not_equal', 'number_greater_than', 'number_less_than', 'number_greater_than_or_equal_to', 'number_less_than_or_equal_to', 'is_empty', 'is_not_empty'],
  checkbox: ['checkbox_is', 'checkbox_is_not'],
  select: ['enum_is', 'enum_is_not', 'is_empty', 'is_not_empty'],
  multi_select: ['enum_contains', 'enum_does_not_contain', 'is_empty', 'is_not_empty'],
  status: ['status_is', 'status_is_not', 'is_empty', 'is_not_empty'],
  person: ['person_contains', 'person_does_not_contain', 'is_empty', 'is_not_empty'],
  relation: ['relation_contains', 'relation_does_not_contain', 'is_empty', 'is_not_empty'],
  date: ['date_is', 'date_is_before', 'date_is_after', 'date_is_on_or_before', 'date_is_on_or_after', 'date_is_within', 'date_is_relative_to', 'is_empty', 'is_not_empty'],
  file: ['is_empty', 'is_not_empty'],
  location: ['location_is', 'location_is_not'],
  verification: ['verification_is', 'verification_is_not'],
  // place name / address text
  place: ['string_contains', 'string_does_not_contain', 'is_empty', 'is_not_empty'],
  formula: [],
  rollup: [],
};

/** Menu labels (en-US) */
export const FILTER_OPERATOR_LABELS: Record<string, string> = {
  string_is: 'Is', string_is_not: 'Is not', string_contains: 'Contains', string_does_not_contain: 'Excludes',
  string_starts_with: 'Starts with', string_ends_with: 'Ends with', is_empty: 'Is empty', is_not_empty: 'Has a value',
  checkbox_is: 'Is', checkbox_is_not: 'Is not', enum_is: 'Is', enum_is_not: 'Is not', enum_contains: 'Contains',
  enum_does_not_contain: 'Excludes', status_is: 'Is', status_is_not: 'Is not', person_contains: 'Contains',
  person_does_not_contain: 'Excludes', relation_contains: 'Contains', relation_does_not_contain: 'Excludes',
  location_is: 'Is', location_is_not: 'Is not', number_equals: '=', number_does_not_equal: '≠', number_greater_than: '>',
  number_less_than: '<', number_greater_than_or_equal_to: '≥', number_less_than_or_equal_to: '≤', date_is: 'Is',
  date_is_before: 'Is before', date_is_after: 'Is after', date_is_on_or_before: 'On or earlier', date_is_on_or_after: 'On or later',
  date_is_within: 'Is between', date_is_relative_to: 'Relative to today', verification_is: 'Is', verification_is_not: 'Is not',
  any: 'Any', none: 'None', every: 'Every',
};

/** Chip labels; others reuse the menu label. */
export const FILTER_CHIP_LABELS: Record<string, string> = {
  string_is_not: 'Not', checkbox_is_not: 'Not', enum_is_not: 'Not', status_is_not: 'Not', location_is_not: 'Not', verification_is_not: 'Not',
  date_is_before: 'Before', date_is_after: 'After', date_is_on_or_before: 'On or earlier', date_is_on_or_after: 'On or later',
};

export const RELATIVE_DATE_VALUES = ['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now', 'one_month_ago', 'one_month_from_now'] as const;
export const RELATIVE_DATE_LABELS: Record<string, string> = {
  today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday', one_week_ago: 'Previous week', one_week_from_now: 'Following week',
  one_month_ago: 'Previous month', one_month_from_now: 'Following month', exact: 'Exact date',
  this_week: 'This week', the_past_week: 'Past week', the_past_month: 'Past month', the_past_year: 'Past year',
  the_next_week: 'Next week', the_next_month: 'Next month', the_next_year: 'Next year', custom: 'Relative range', surrounding: 'Surrounding range',
  // relation filters on a Sprints database
  current_sprint: 'Current', next_sprint: 'Next', last_sprint: 'Last',
};

/** Range presets for "Is within" / "Relative to today". */
export const RELATIVE_RANGE_PRESETS: Record<string, { type: 'relative'; value: string; unit: 'day' | 'week' | 'month' | 'year'; direction?: 'past' | 'future'; count?: number }> = {
  this_week: { type: 'relative', value: 'surrounding', unit: 'week' },
  the_past_week: { type: 'relative', value: 'custom', direction: 'past', count: 1, unit: 'week' },
  the_past_month: { type: 'relative', value: 'custom', direction: 'past', count: 1, unit: 'month' },
  the_past_year: { type: 'relative', value: 'custom', direction: 'past', count: 1, unit: 'year' },
  the_next_week: { type: 'relative', value: 'custom', direction: 'future', count: 1, unit: 'week' },
  the_next_month: { type: 'relative', value: 'custom', direction: 'future', count: 1, unit: 'month' },
  the_next_year: { type: 'relative', value: 'custom', direction: 'future', count: 1, unit: 'year' },
};

const AGG_TEXT = ['count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'];
const AGG_NUMBER = [...AGG_TEXT, 'sum', 'average', 'median', 'min', 'max', 'range'];
const AGG_DATE = [...AGG_TEXT, 'earliest_date', 'latest_date', 'date_range'];
const AGG_CHECKBOX = ['count', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked'];

export const PROPERTY_TYPES: PropertyTypeMeta[] = [
  { type: 'title', label: 'Title', icon: 'font', filterValueType: 'text', aggregations: AGG_TEXT, groupable: true, tooltip: 'Name each database item; this becomes its page title.' },
  { type: 'text', label: 'Text', icon: 'propText', section: 'basic', creatableOrder: 0, filterValueType: 'text', aggregations: AGG_TEXT, groupable: true, description: 'Short text on one line.', tooltip: 'Formatted text for notes, summaries, or descriptions.' },
  { type: 'number', label: 'Number', icon: 'propNumber', section: 'basic', creatableOrder: 1, filterValueType: 'number', aggregations: AGG_NUMBER, groupable: true, description: 'A numeric value with currency, percent, and other formats.', tooltip: 'Stores numbers for counts, prices, progress, or other measurements.' },
  { type: 'select', label: 'Select', icon: 'propSelect', section: 'basic', creatableOrder: 2, filterValueType: 'select', aggregations: AGG_TEXT, groupable: true, description: 'Choose one value from a set of options.', tooltip: 'Pick one tag to classify an item.' },
  { type: 'multi_select', label: 'Multi-select', icon: 'propMultiSelect', section: 'basic', creatableOrder: 3, filterValueType: 'multi_select', aggregations: AGG_TEXT, groupable: true, description: 'Apply one or more options from a list.', tooltip: 'Use several tags to classify an item across categories.' },
  { type: 'status', label: 'Status', icon: 'burst', section: 'basic', creatableOrder: 4, filterValueType: 'status', aggregations: [...AGG_TEXT, 'count_per_group', 'percent_per_group'], groupable: true, description: 'Group custom status options into stages', tooltip: 'Track progress with grouped stages such as To-do, Active, and Complete.' },
  { type: 'date', label: 'Date', icon: 'propDate', section: 'basic', creatableOrder: 5, filterValueType: 'date', aggregations: AGG_DATE, groupable: true, description: 'A date or range, with optional time.', tooltip: 'Use dates and deadlines in calendar or timeline views.' },
  { type: 'person', label: 'Person', icon: 'propPerson', section: 'basic', creatableOrder: 6, filterValueType: 'person', aggregations: AGG_TEXT, groupable: true, description: 'Link a teammate to this item.', tooltip: 'Mention workspace members to assign or discuss work.' },
  { type: 'file', label: 'Files & media', icon: 'files', section: 'basic', creatableOrder: 7, filterValueType: 'file', aggregations: AGG_TEXT, groupable: false, description: 'Attach files or images.', tooltip: 'Keep documents and images with the item for quick access.' },
  { type: 'checkbox', label: 'Checkbox', icon: 'propCheckbox', section: 'basic', creatableOrder: 8, filterValueType: 'checkbox', aggregations: AGG_CHECKBOX, groupable: true, noEditor: true, description: 'Mark a yes or no state.', tooltip: 'Use a checkbox for simple task tracking.' },
  { type: 'url', label: 'URL', icon: 'propUrl', section: 'basic', creatableOrder: 9, filterValueType: 'text', aggregations: AGG_TEXT, groupable: true, description: 'Store a web address.', tooltip: 'Opens the saved address in a new tab.' },
  { type: 'email', label: 'Email', icon: 'propEmail', section: 'basic', creatableOrder: 10, filterValueType: 'text', aggregations: AGG_TEXT, groupable: true, description: 'Store an email address.', tooltip: 'Opens the address in your mail app.' },
  { type: 'phone_number', label: 'Phone', icon: 'propPhone', section: 'basic', creatableOrder: 11, filterValueType: 'text', aggregations: AGG_TEXT, groupable: true, description: 'Store a phone number.', tooltip: 'Starts a call when the number is selected.' },
  { type: 'formula', label: 'Formula', icon: 'formula', section: 'advanced', creatableOrder: 12, filterValueType: 'formula', aggregations: AGG_NUMBER, groupable: true, computed: true, noEditor: true, description: 'Calculate a value from other item properties.', tooltip: 'Use Litpage formulas to calculate from other properties.' },
  { type: 'relation', label: 'Relation', icon: 'propRelation', section: 'advanced', creatableOrder: 13, filterValueType: 'relation', aggregations: AGG_TEXT, groupable: true, description: 'Link items to pages in another database.', tooltip: 'Connect related items across databases.' },
  { type: 'rollup', label: 'Rollup', icon: 'propRollup', section: 'advanced', creatableOrder: 14, filterValueType: 'rollup', aggregations: AGG_NUMBER, groupable: true, computed: true, noEditor: true, description: 'Summarize values from linked pages.', tooltip: 'Review and aggregate fields from related items.' },
  { type: 'created_time', label: 'Created time', icon: 'createdTime', section: 'metadata', creatableOrder: 15, filterValueType: 'date', aggregations: AGG_DATE, groupable: true, computed: true, noEditor: true, description: 'Show when the item was created.', tooltip: 'The creation time is recorded automatically.' },
  { type: 'created_by', label: 'Created by', icon: 'createdBy', section: 'metadata', creatableOrder: 16, filterValueType: 'person', aggregations: AGG_TEXT, groupable: true, computed: true, noEditor: true, description: 'Show who created the item.', tooltip: 'The creator is recorded automatically.' },
  { type: 'last_edited_time', label: 'Edited time', icon: 'editedTime', section: 'metadata', creatableOrder: 17, filterValueType: 'date', aggregations: AGG_DATE, groupable: true, computed: true, noEditor: true, description: 'Show when the item last changed.', tooltip: 'The latest edit time updates automatically.' },
  { type: 'last_edited_by', label: 'Edited by', icon: 'editedBy', section: 'metadata', creatableOrder: 18, filterValueType: 'person', aggregations: AGG_TEXT, groupable: true, computed: true, noEditor: true, description: 'Show who last changed the item.', tooltip: 'The latest editor is recorded automatically.' },
  { type: 'button', label: 'Button', icon: 'cursorButton', section: 'advanced', creatableOrder: 19, filterValueType: null, aggregations: [], groupable: false, noEditor: true, description: 'A button that runs a configured action.', tooltip: 'Run actions using this item’s properties.' },
  { type: 'location', label: 'Location', icon: 'viewTable', creatableOrder: 20, filterValueType: 'location', aggregations: ['count', 'count_values', 'unique'], groupable: true, computed: true, noEditor: true, description: 'A location.', tooltip: 'Show the database that contains this item.' },
  { type: 'verification', label: 'Verification', icon: 'verification', creatableOrder: 21, filterValueType: 'verification', aggregations: [], groupable: false, description: 'Verified status.', tooltip: 'Show owner verification and an optional expiry date.' },
  { type: 'place', label: 'Place', icon: 'location', section: 'advanced', creatableOrder: 22, filterValueType: 'place', aggregations: AGG_TEXT, groupable: false, description: 'A physical place.', tooltip: 'Show the place on a map.' },
  { type: 'auto_increment_id', label: 'ID', icon: 'numero', section: 'advanced', creatableOrder: 23, filterValueType: 'number', aggregations: AGG_NUMBER, groupable: false, computed: true, noEditor: true, description: 'A number that increases for each item.', tooltip: 'Creates a unique numeric ID that cannot be edited.' },
  { type: 'last_visited_time', label: 'Most recent visit', icon: 'clock', filterValueType: 'date', aggregations: AGG_DATE, groupable: true, computed: true, noEditor: true },
];

const META_BY_TYPE = new Map(PROPERTY_TYPES.map((m) => [m.type, m]));

export function propertyTypeMeta(type: string | undefined): PropertyTypeMeta {
  return META_BY_TYPE.get((type ?? 'text') as PropertyType) ?? META_BY_TYPE.get('text')!;
}

/** "+ Add property" grid sections: basic 12, advanced 6, metadata 4. */
export const PICKER_SECTIONS: { id: 'basic' | 'advanced' | 'metadata'; types: PropertyType[] }[] = [
  { id: 'basic', types: ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'file', 'checkbox', 'url', 'phone_number', 'email'] },
  { id: 'advanced', types: ['relation', 'rollup', 'formula', 'button', 'auto_increment_id', 'place'] },
  { id: 'metadata', types: ['created_time', 'last_edited_time', 'created_by', 'last_edited_by'] },
];

/** Change-type submenu order (creatable order). */
export const CREATABLE_TYPES: PropertyType[] = [
  'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'file', 'checkbox', 'url', 'email', 'phone_number',
  'formula', 'relation', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'button', 'place', 'auto_increment_id',
];

export function filterOperatorsFor(prop: PropertySchema | undefined, resultType?: string): string[] {
  if (!prop) return [];
  const meta = propertyTypeMeta(prop.type);
  let vt = meta.filterValueType;
  if (vt === 'formula' || vt === 'rollup') vt = (computedFilterType(resultType) ?? 'text') as FilterValueType;
  return vt ? FILTER_OPERATORS[vt] : [];
}

function computedFilterType(resultType?: string): FilterValueType | null {
  switch (resultType) {
    case 'number': return 'number';
    case 'checkbox': case 'boolean': return 'checkbox';
    case 'date': return 'date';
    case 'person': return 'person';
    case 'block': case 'relation': return 'relation';
    case 'text': case 'string': return 'text';
    default: return resultType ? 'text' : null;
  }
}

export function defaultFilterOperator(prop: PropertySchema | undefined): string {
  const ops = filterOperatorsFor(prop, (prop as any)?.formula2?.result_type?.type);
  if (!prop) return 'string_contains';
  switch (propertyTypeMeta(prop.type).filterValueType) {
    case 'text': return 'string_contains';
    case 'multi_select': return 'enum_contains';
    case 'select': return 'enum_is';
    case 'status': return 'status_is';
    case 'person': return 'person_contains';
    case 'relation': return 'relation_contains';
    case 'number': return 'number_equals';
    case 'checkbox': return 'checkbox_is';
    case 'date': return 'date_is';
    default: return ops[0] ?? 'is_not_empty';
  }
}

// ---------- calculations ---------

export const AGGREGATION_LABELS: Record<string, { full: string; short: string; description?: string }> = {
  none: { full: 'None', short: 'Calculate' },
  count: { full: 'Count all', short: 'Count', description: 'Counts every page, including empty ones.' },
  count_values: { full: 'Count values', short: 'Values', description: 'Counts populated values, including each selected value in multi-value fields.' },
  unique: { full: 'Unique count', short: 'Unique', description: 'Counts distinct values across the database.' },
  show_unique: { full: 'List unique values', short: 'Show unique', description: 'Lists distinct values found in the database.' },
  empty: { full: 'Count empty', short: 'Empty', description: 'Counts items where this field is blank.' },
  not_empty: { full: 'Count filled', short: 'Not Empty', description: 'Counts items where this field has a value.' },
  percent_empty: { full: 'Percent empty', short: 'Empty', description: 'Shows the share of items with a blank field.' },
  percent_not_empty: { full: 'Percent filled', short: 'Not Empty', description: 'Shows the share of items with a populated field.' },
  checked: { full: 'Checked', short: 'Checked', description: 'Counts checked boxes.' },
  unchecked: { full: 'Unchecked', short: 'Unchecked', description: 'Counts unchecked boxes.' },
  percent_checked: { full: 'Percent checked', short: 'Checked', description: 'Shows the percentage of checked boxes.' },
  percent_unchecked: { full: 'Percent unchecked', short: 'Unchecked', description: 'Shows the percentage of unchecked boxes.' },
  sum: { full: 'Sum', short: 'Sum', description: 'Adds numeric values.' },
  average: { full: 'Average', short: 'Average', description: 'Calculates the numeric average.' },
  median: { full: 'Median', short: 'Median', description: 'Finds the middle numeric value.' },
  min: { full: 'Min', short: 'Min', description: 'Finds the smallest numeric value.' },
  max: { full: 'Max', short: 'Max', description: 'Finds the largest numeric value.' },
  range: { full: 'Range', short: 'Range', description: 'Calculates the spread from minimum to maximum.' },
  earliest_date: { full: 'Earliest date', short: 'Earliest', description: 'Finds the earliest date of this property.' },
  latest_date: { full: 'Latest date', short: 'Latest', description: 'Finds the latest date of this property.' },
  date_range: { full: 'Date range', short: 'Range', description: 'Computes the range between the earliest and latest date of this property.' },
  count_per_group: { full: 'Items per group', short: 'Count' },
  percent_per_group: { full: 'Share per group', short: 'Percent' },
  show_original: { full: 'Show original', short: 'Show original' },
};

/** Calculate submenu buckets. */
export const AGGREGATION_BUCKETS: { id: string; label: string; aggregators: string[] }[] = [
  { id: 'count', label: 'Count', aggregators: ['count', 'count_values', 'unique', 'empty', 'not_empty', 'checked', 'unchecked'] },
  { id: 'percent', label: 'Percent', aggregators: ['percent_empty', 'percent_not_empty', 'percent_checked', 'percent_unchecked'] },
  { id: 'more_options', label: 'More options', aggregators: ['sum', 'average', 'median', 'min', 'max', 'range'] },
  { id: 'date', label: 'Date', aggregators: ['earliest_date', 'latest_date', 'date_range'] },
];

export function aggregatorsFor(prop: PropertySchema | undefined): string[] {
  if (!prop) return ['count'];
  const meta = propertyTypeMeta(prop.type);
  if (prop.type === 'formula' || prop.type === 'rollup') {
    const rt = (prop as any).formula2?.result_type?.type ?? (prop as any).target_property_type;
    if (rt === 'date') return AGG_DATE;
    if (rt === 'checkbox' || rt === 'boolean') return AGG_CHECKBOX;
    if (rt === 'text' || rt === 'string') return AGG_TEXT;
    return AGG_NUMBER;
  }
  return meta.aggregations.filter((a) => a !== 'show_unique');
}

// ---------- number formats ---------

export const NUMBER_FORMATS: { id: string; label: string; currency?: string }[] = [
  { id: 'number', label: 'Number' }, { id: 'number_with_commas', label: 'Number with commas' }, { id: 'percent', label: 'Percent' },
  { id: 'dollar', label: 'US Dollar', currency: 'USD' }, { id: 'australian_dollar', label: 'Australian dollar', currency: 'AUD' },
  { id: 'canadian_dollar', label: 'Canadian dollar', currency: 'CAD' }, { id: 'singapore_dollar', label: 'Singapore dollar', currency: 'SGD' },
  { id: 'euro', label: 'Euro', currency: 'EUR' }, { id: 'pound', label: 'Pound', currency: 'GBP' }, { id: 'yen', label: 'Yen', currency: 'JPY' },
  { id: 'ruble', label: 'Ruble', currency: 'RUB' }, { id: 'rupee', label: 'Rupee', currency: 'INR' }, { id: 'won', label: 'Won', currency: 'KRW' },
  { id: 'yuan', label: 'Yuan', currency: 'CNY' }, { id: 'real', label: 'Real', currency: 'BRL' }, { id: 'lira', label: 'Lira', currency: 'TRY' },
  { id: 'rupiah', label: 'Rupiah', currency: 'IDR' }, { id: 'franc', label: 'Franc', currency: 'CHF' }, { id: 'hong_kong_dollar', label: 'HK dollar', currency: 'HKD' },
  { id: 'new_zealand_dollar', label: 'NZ dollar', currency: 'NZD' }, { id: 'krona', label: 'Swedish krona', currency: 'SEK' },
  { id: 'norwegian_krone', label: 'Norwegian krone', currency: 'NOK' }, { id: 'mexican_peso', label: 'Mexican peso', currency: 'MXN' },
  { id: 'rand', label: 'Rand', currency: 'ZAR' }, { id: 'new_taiwan_dollar', label: 'Taiwan dollar', currency: 'TWD' },
  { id: 'danish_krone', label: 'Danish krone', currency: 'DKK' }, { id: 'zloty', label: 'Złoty', currency: 'PLN' }, { id: 'baht', label: 'Baht', currency: 'THB' },
  { id: 'forint', label: 'Forint', currency: 'HUF' }, { id: 'koruna', label: 'Koruna', currency: 'CZK' }, { id: 'shekel', label: 'Shekel', currency: 'ILS' },
  { id: 'chilean_peso', label: 'Chilean peso', currency: 'CLP' }, { id: 'philippine_peso', label: 'Philippine peso', currency: 'PHP' },
  { id: 'dirham', label: 'Dirham', currency: 'AED' }, { id: 'colombian_peso', label: 'Colombian peso', currency: 'COP' }, { id: 'riyal', label: 'Riyal', currency: 'SAR' },
  { id: 'ringgit', label: 'Ringgit', currency: 'MYR' }, { id: 'leu', label: 'Leu', currency: 'RON' }, { id: 'argentine_peso', label: 'Argentine peso', currency: 'ARS' },
  { id: 'uruguayan_peso', label: 'Uruguayan peso', currency: 'UYU' }, { id: 'peruvian_sol', label: 'Peruvian sol', currency: 'PEN' },
  { id: 'vietnamese_dong', label: 'Vietnamese dong', currency: 'VND' }, { id: 'pakistani_rupee', label: 'Pakistani rupee', currency: 'PKR' },
  { id: 'nigerian_naira', label: 'Nigerian naira', currency: 'NGN' }, { id: 'bitcoin', label: 'Bitcoin', currency: 'BTC' },
];

export const ZERO_DECIMAL_FORMATS = new Set(['yen', 'won', 'vietnamese_dong']);

export const NUMBER_PRECISIONS: { id: string; label: string; digits: number | null }[] = [
  { id: 'precision_uncapped', label: 'Default', digits: null },
  { id: 'precision_0', label: '1', digits: 0 },
  { id: 'precision_1', label: '1.0', digits: 1 },
  { id: 'precision_2', label: '1.00', digits: 2 },
  { id: 'precision_3', label: '1.000', digits: 3 },
  { id: 'precision_4', label: '1.0000', digits: 4 },
  { id: 'precision_5', label: '1.00000', digits: 5 },
];

// ---------- date / time formats ---------

export const DATE_FORMATS: { id: string; label: string }[] = [
  { id: 'll', label: 'Full date' }, { id: 'MMM d', label: 'Short date' }, { id: 'MM/DD/YYYY', label: 'Month first' },
  { id: 'DD/MM/YYYY', label: 'Day first' }, { id: 'Year / month / day', label: 'Year first' }, { id: 'relative', label: 'Relative' },
];

export const TIME_FORMATS: { id: string; label: string; stored: string }[] = [
  { id: 'hidden', label: 'Hidden', stored: ' ' },
  { id: '12h', label: '12 hour', stored: 'h:mm A' },
  { id: '24h', label: '24 hour', stored: 'H:mm' },
];

export function timeFormatId(stored: string | undefined): string {
  if (stored === ' ') return 'hidden';
  if (stored === 'H:mm') return '24h';
  return '12h';
}

export const REMINDER_OPTIONS_DATE = [
  { unit: 'none' }, { unit: 'day', value: 0, time: '09:00' }, { unit: 'day', value: 1, time: '09:00' }, { unit: 'day', value: 2, time: '09:00' }, { unit: 'week', value: 1, time: '09:00' },
] as const;
export const REMINDER_OPTIONS_DATETIME = [
  { unit: 'none' }, { unit: 'minute', value: 0 }, { unit: 'minute', value: 5 }, { unit: 'minute', value: 10 }, { unit: 'minute', value: 15 }, { unit: 'minute', value: 30 },
  { unit: 'hour', value: 1 }, { unit: 'hour', value: 2 }, { unit: 'day', value: 1, time: '09:00' }, { unit: 'day', value: 2, time: '09:00' },
] as const;

// ---------- select / status ---------

export const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

/** New option color: a color not used yet by existing options; random when all are used. */
export function nextOptionColor(existing: SelectOption[] | undefined, rand: () => number = Math.random): string {
  const used = new Set((existing ?? []).map((o) => o.color));
  const free = OPTION_COLORS.filter((c) => !used.has(c));
  const pool = free.length ? free : [...OPTION_COLORS];
  return pool[Math.floor(rand() * pool.length)] ?? 'default';
}

export function newOptionId(): string {
  return globalThis.crypto.randomUUID();
}

/** Default status options/groups: Not started / In progress / Done in To-do / In progress / Complete. */
export function defaultStatusSchema(): { options: SelectOption[]; groups: StatusGroup[]; defaultOption: string } {
  const notStarted = { id: newOptionId(), value: 'Not started', color: 'default' };
  const inProgress = { id: newOptionId(), value: 'In progress', color: 'blue' };
  const done = { id: newOptionId(), value: 'Done', color: 'green' };
  return {
    options: [notStarted, inProgress, done],
    groups: [
      { id: newOptionId(), name: 'To-do', color: 'gray', optionIds: [notStarted.id] },
      { id: newOptionId(), name: 'In progress', color: 'blue', optionIds: [inProgress.id] },
      { id: newOptionId(), name: 'Complete', color: 'green', optionIds: [done.id] },
    ],
    defaultOption: 'Not started',
  };
}

export const STATUS_GROUP_LABELS: Record<string, string> = { 'To-do': 'To-do', 'In progress': 'In progress', Complete: 'Complete' };

// ---------- group-by defaults ---------

export function defaultGroupBy(prop: PropertySchema, propId: string, opts?: { board?: boolean }): GroupBy {
  const base: GroupBy = { type: prop.type, property: propId, hideEmptyGroups: !opts?.board, sort: { type: 'ascending' } };
  switch (prop.type as string) {
    case 'select': case 'multi_select': case 'person': case 'created_by': case 'last_edited_by': case 'checkbox':
      return { ...base, sort: { type: 'manual' } };
    case 'status':
      // tables and boards both default to "Status by: Option"
      return { ...base, groupBy: 'option', sort: { type: 'ascending' } };
    case 'date': case 'created_time': case 'last_edited_time': case 'last_visited_time':
      return { ...base, groupBy: 'relative' };
    case 'text': case 'title': case 'url': case 'email': case 'phone_number':
      return { ...base, groupBy: 'exact' };
    case 'number':
      return { ...base, groupBy: { type: 'unique' }, start: 0, end: 1000, size: 100 };
    default:
      return base;
  }
}

export function isGroupable(prop: PropertySchema | undefined): boolean {
  return !!prop && propertyTypeMeta(prop.type).groupable;
}

/** Board grouping candidates in preference order (status → select → person → multi-select → relation). */
export function pickBoardGroupProperty(schema: Record<string, PropertySchema>): string | undefined {
  const order = ['status', 'select', 'person', 'multi_select', 'relation'];
  for (const t of order) {
    const id = Object.keys(schema).find((k) => schema[k].type === t);
    if (id) return id;
  }
  return undefined;
}

// ---------- view types ---------

export interface ViewTypeMeta {
  type: string;
  label: string;
  icon: string;
  propertiesKey: string | null;
  defaultPeek: 'side_peek' | 'center_peek';
  addMenu: boolean;
}

/** Add-view grid order: Table, Board, Gallery, List / Chart, Dashboard, Timeline, Feed / Map, Calendar, Form. */
export const VIEW_TYPES: ViewTypeMeta[] = [
  { type: 'table', label: 'Table', icon: 'dbViewTable', propertiesKey: 'table_properties', defaultPeek: 'side_peek', addMenu: true },
  { type: 'board', label: 'Board', icon: 'dbViewBoard', propertiesKey: 'board_properties', defaultPeek: 'side_peek', addMenu: true },
  { type: 'gallery', label: 'Gallery', icon: 'dbViewGallery', propertiesKey: 'gallery_properties', defaultPeek: 'center_peek', addMenu: true },
  { type: 'list', label: 'List', icon: 'dbViewList', propertiesKey: 'list_properties', defaultPeek: 'side_peek', addMenu: true },
  { type: 'chart', label: 'Chart', icon: 'dbViewChart', propertiesKey: null, defaultPeek: 'side_peek', addMenu: true },
  { type: 'dashboard', label: 'Dashboard', icon: 'dbViewDashboard', propertiesKey: null, defaultPeek: 'side_peek', addMenu: true },
  { type: 'timeline', label: 'Timeline', icon: 'dbViewTimeline', propertiesKey: 'timeline_properties', defaultPeek: 'side_peek', addMenu: true },
  { type: 'feed', label: 'Feed', icon: 'dbViewFeed', propertiesKey: 'feed_properties', defaultPeek: 'center_peek', addMenu: true },
  { type: 'map', label: 'Map', icon: 'dbViewMap', propertiesKey: null, defaultPeek: 'center_peek', addMenu: true },
  { type: 'calendar', label: 'Calendar', icon: 'dbViewCalendar', propertiesKey: 'calendar_properties', defaultPeek: 'center_peek', addMenu: true },
  { type: 'form', label: 'Form', icon: 'dbViewForm', propertiesKey: null, defaultPeek: 'side_peek', addMenu: true },
  // wiki "Home": the wiki page's own content; never offered in add-view / layout pickers
  { type: 'page', label: 'Home', icon: 'home', propertiesKey: null, defaultPeek: 'side_peek', addMenu: false },
];

/** Layout picker order inside View settings › Layout (3 columns). */
export const LAYOUT_PICKER_ORDER = ['table', 'board', 'timeline', 'calendar', 'list', 'gallery', 'chart', 'feed', 'map', 'dashboard'];

export function viewTypeMeta(type: string | undefined): ViewTypeMeta {
  return VIEW_TYPES.find((v) => v.type === type) ?? VIEW_TYPES[0];
}

export function propertiesKeyFor(type: string | undefined): string {
  return viewTypeMeta(type).propertiesKey ?? 'table_properties';
}

export const PEEK_MODES = [
  { id: 'side_peek', label: 'Side peek', icon: 'sidePeek' },
  { id: 'center_peek', label: 'Center peek', icon: 'centerPeek' },
  { id: 'full_page', label: 'Full page', icon: 'fullPage' },
] as const;

export const LOAD_LIMITS = [10, 25, 50, 100] as const;
export const DEFAULT_LOAD_LIMIT = 25;
export const DEFAULT_COLUMN_WIDTH = 200;
export const DEFAULT_TITLE_WIDTH = 280;
