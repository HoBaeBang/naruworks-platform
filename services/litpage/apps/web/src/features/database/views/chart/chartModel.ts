// Chart view data model. collection_view.format.chart_config shapes follow the validator.
// validator (48106 chunk: chartFormat keys, groups_reducer / number_reducer / results_reducer) and the 
// transactions in + -*.json.
import type { BlockRecord, PropertySchema } from '@nc/shared/records.ts';
import { aggregateRows, computeGroups, type GroupBy, type GroupResult, type GroupValue, type QueryContext, type SavedGroup, type Schema } from '@nc/shared/database/index.ts';

export type ChartType = 'column' | 'bar' | 'line' | 'donut' | 'number';
export type MainSort = 'manual' | 'results-advanced' | 'x-ascending' | 'x-descending' | 'y-ascending' | 'y-descending';
export type ChartColorTheme = 'auto' | 'blue' | 'colorful' | 'gray' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'yellow';
export type ChartHeight = 'small' | 'medium' | 'large' | 'extra_large';

export interface ChartAggregation {
  aggregator: string | { operator: 'count_per_group' | 'percent_per_group'; groupName: string };
  property?: string;
}

export type ChartGroupBy = GroupBy;

export interface ReferenceLine {
  id: string;
  value: number;
  label: string;
  color: string;
  dashStyle: 'Dash' | 'Solid';
}

export interface ChartFormat {
  axisHideEmptyGroups?: boolean;
  mainSort?: MainSort;
  donutDataLabels?: 'name' | 'name_and_value' | 'none' | 'value';
  donutHideValue?: boolean;
  axisShowDataLabels?: boolean;
  axisGridLine?: 'both' | 'horizontal' | 'none' | 'vertical';
  axisLabel?: 'both' | 'none' | 'x_axis' | 'y_axis';
  axisGroupStyle?: 'normal' | 'percent' | 'side_by_side';
  axisCumulative?: boolean;
  colorTheme?: ChartColorTheme;
  height?: ChartHeight;
  hideLegend?: boolean;
  legendPosition?: 'bottom' | 'off' | 'side';
  hideLineFillArea?: boolean;
  smoothLine?: boolean;
  hideTitle?: boolean;
  valueLabel?: string;
  showValueLabel?: boolean;
  caption?: string;
  showCaption?: boolean;
  numberColor?: string;
  numberFormatOverride?: string;
  numberPrecisionOverride?: string;
  referenceLines?: ReferenceLine[];
  yAxisMin?: number;
  yAxisMax?: number;
  hideNegativeValues?: boolean;
  /** "Color by value": larger values darker (bars / donut, single-color themes) */
  weightColorValue?: boolean;
}

/** Group visibility of a chart: main groups and stacked “Group by” subgroups. */
export interface ChartSavedGroups { groups?: SavedGroup[]; subgroups?: SavedGroup[] }

export function chartSavedGroupsOf(format: Record<string, unknown> | undefined): ChartSavedGroups {
  return { groups: (format?.collection_groups as SavedGroup[] | undefined) ?? [], subgroups: (format?.chart_subgroups as SavedGroup[] | undefined) ?? [] };
}

export type ChartDataConfig =
  | {
    type: 'groups_reducer';
    groupBy: ChartGroupBy;
    aggregationConfig: { aggregation: ChartAggregation; seriesFormat?: { displayType: 'bar' | 'column' | 'line' }; stackOptions?: { groupBy: ChartGroupBy } };
  }
  | { type: 'number_reducer'; aggregationConfig: { aggregation: ChartAggregation } }
  | { type: 'results_reducer'; nameProperty: string; valueProperty: string; valueSeriesFormat?: { displayType: string } };

export interface ChartConfig {
  type: ChartType;
  dataConfig: ChartDataConfig;
  chartFormat?: ChartFormat;
}

export const CHART_HEIGHT: Record<ChartHeight, number> = { small: 300, medium: 400, large: 600, extra_large: 800 };
export const CHART_TYPE_LABEL: Record<ChartType, string> = { column: 'Vertical bar', bar: 'Horizontal bar', line: 'Line', donut: 'Donut', number: 'Number' };
export const CHART_TYPE_ORDER: ChartType[] = ['column', 'bar', 'line', 'donut', 'number'];
/** “Colorful” palette order for the chart theme. */
export const COLORFUL = ['blue', 'yellow', 'green', 'purple', 'orange', 'pink', 'teal', 'red', 'brown', 'gray'];

/** Property types the X axis / donut slices can group by. */
const GROUPABLE = new Set(['select', 'multi_select', 'status', 'checkbox', 'person', 'created_by', 'last_edited_by', 'date', 'created_time', 'last_edited_time', 'number', 'text', 'title', 'url', 'email', 'phone_number', 'relation', 'formula', 'rollup', 'auto_increment_id']);
const NUMERIC_RESULT = new Set(['number']);

export function isGroupableForChart(p: PropertySchema | undefined): boolean {
  if (!p || !GROUPABLE.has(p.type)) return false;
  if (p.type === 'formula') {
    const t = (p as { formula2?: { result_type?: { type?: string } } }).formula2?.result_type?.type;
    return !t || ['text', 'number', 'checkbox', 'person', 'date'].includes(t);
  }
  return true;
}

export function isNumericProperty(p: PropertySchema | undefined): boolean {
  if (!p) return false;
  if (NUMERIC_RESULT.has(p.type)) return true;
  if (p.type === 'formula') return (p as { formula2?: { result_type?: { type?: string } } }).formula2?.result_type?.type === 'number';
  if (p.type === 'rollup') {
    const a = typeof p.aggregation === 'string' ? p.aggregation : 'x';
    return ['count', 'count_values', 'unique', 'empty', 'not_empty', 'sum', 'average', 'median', 'min', 'max', 'range'].includes(a) || p.target_property_type === 'number';
  }
  return false;
}

/** Default X axis: first select / multi-select / status property (schema order), then person/date/checkbox, else the title. */
export function pickChartGroupProperty(schema: Schema): string | undefined {
  const ids = Object.keys(schema);
  for (const pref of [['select', 'multi_select', 'status'], ['person', 'date', 'checkbox', 'created_time', 'created_by']]) {
    const hit = ids.find((id) => pref.includes(schema[id].type));
    if (hit) return hit;
  }
  return schema.title ? 'title' : ids[0];
}

export function groupByFor(propId: string, schema: Schema, sort: 'manual' | 'ascending' = 'manual'): ChartGroupBy {
  const p = schema[propId];
  const gb: ChartGroupBy = { property: propId, type: p?.type ?? 'text', hideEmptyGroups: false, sort: { type: sort } };
  if (p && ['date', 'created_time', 'last_edited_time'].includes(p.type)) gb.groupBy = 'month';
  if (p && p.type === 'number') gb.groupBy = { type: 'unique' };
  if (p && (p.type === 'text' || p.type === 'title')) gb.groupBy = 'exact';
  return gb;
}

/** New-chart config. */
export function defaultChartConfig(schema: Schema): ChartConfig {
  const pid = pickChartGroupProperty(schema);
  if (!pid) return { type: 'number', dataConfig: { type: 'number_reducer', aggregationConfig: { aggregation: { aggregator: 'count' } } }, chartFormat: { axisHideEmptyGroups: false, mainSort: 'manual' } };
  return {
    chartFormat: { axisHideEmptyGroups: false, mainSort: 'manual' },
    type: 'column',
    dataConfig: { type: 'groups_reducer', groupBy: groupByFor(pid, schema), aggregationConfig: { aggregation: { aggregator: 'count' }, seriesFormat: { displayType: 'column' } } },
  };
}

/** /Vertical bar chart … /Number chart → the chart a new view starts with (slash item ids → chart types). */
const SLASH_CHART_TYPES: Record<string, ChartType> = { bar: 'column', vertical_bar: 'column', column: 'column', horizontal_bar: 'bar', line: 'line', donut: 'donut', number: 'number' };
export function newChartConfig(schema: Schema, slashType?: string): ChartConfig {
  const base = defaultChartConfig(schema);
  const t = slashType ? SLASH_CHART_TYPES[slashType] : undefined;
  return t && t !== base.type ? switchChartType(base, t, schema) : base;
}

export function chartConfigOf(format: Record<string, unknown> | undefined, schema: Schema): ChartConfig {
  const c = format?.chart_config as ChartConfig | undefined;
  if (!c || !c.type || !c.dataConfig) return defaultChartConfig(schema);
  return c;
}

/** Switch chart type the way chart-type picker rewrites chart_config (chunk 83065 helpers). */
export function switchChartType(cfg: ChartConfig, type: ChartType, schema: Schema): ChartConfig {
  const fmt: ChartFormat = { ...(cfg.chartFormat ?? {}) };
  if (type === 'number') {
    return { type: 'number', dataConfig: { type: 'number_reducer', aggregationConfig: { aggregation: { aggregator: 'count' } } }, chartFormat: fmt };
  }
  let groupBy: ChartGroupBy | undefined = cfg.dataConfig.type === 'groups_reducer' ? cfg.dataConfig.groupBy : undefined;
  const aggregation: ChartAggregation = cfg.dataConfig.type === 'groups_reducer' ? cfg.dataConfig.aggregationConfig.aggregation : { aggregator: 'count' };
  if (!groupBy || !schema[groupBy.property]) {
    const pid = pickChartGroupProperty(schema);
    if (!pid) return cfg;
    groupBy = groupByFor(pid, schema, type === 'donut' ? 'ascending' : 'manual');
  }
  if (type === 'donut') {
    const optionLike = ['select', 'multi_select', 'status'].includes(schema[groupBy.property]?.type ?? '');
    const donutFmt: ChartFormat = { ...fmt, mainSort: optionLike ? 'y-descending' : fmt.mainSort ?? 'y-descending' };
    if (!donutFmt.donutDataLabels || donutFmt.donutDataLabels === 'none') donutFmt.donutDataLabels = 'value';
    return { type: 'donut', dataConfig: { type: 'groups_reducer', groupBy: { ...groupBy, sort: { type: 'ascending' } }, aggregationConfig: { aggregation } }, chartFormat: donutFmt };
  }
  const prevStack = cfg.dataConfig.type === 'groups_reducer' && cfg.type !== 'donut' ? cfg.dataConfig.aggregationConfig.stackOptions : undefined;
  if (cfg.type === 'donut') {
    if (fmt.donutDataLabels && fmt.donutDataLabels !== 'none') fmt.axisShowDataLabels = true;
    else if (fmt.donutDataLabels === 'none') fmt.axisShowDataLabels = false;
    groupBy = { ...groupBy, sort: { type: 'manual' } };
  }
  return {
    chartFormat: fmt,
    type,
    dataConfig: { type: 'groups_reducer', groupBy, aggregationConfig: { aggregation, seriesFormat: { displayType: type }, ...(prevStack ? { stackOptions: prevStack } : {}) } },
  };
}

// ---------- computation ----------

export interface ChartPart {
  key: string;
  label: string;
  color?: string;
  value: number;
  display: string;
  rows: BlockRecord[];
}

export interface ChartPoint extends ChartPart {
  uncategorized: boolean;
  /** the X axis group's value (drilldown "Save as view in…" turns it into a filter) */
  groupValue?: GroupValue;
  /** stacked series values (same order as ChartData.series) */
  parts?: ChartPart[];
}

export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
  uncategorized: boolean;
}

export interface ChartData {
  kind: 'groups' | 'number' | 'error';
  points: ChartPoint[];
  series: ChartSeries[];
  total: number;
  /** rows behind the chart (donut center for counts) */
  rowCount: number;
  number?: { value: number | null; display: string; title: string };
  error?: string;
  xName: string;
  yName: string;
  /** values are integers (counts) → integer ticks */
  integer: boolean;
  /** number format of the aggregated property (for tick/label formatting) */
  numberFormat?: string;
  /** donut center caption ("Total", "Total Estimate", …) */
  caption: string;
}

export const AGG_LABEL: Record<string, string> = {
  count: 'Count', count_values: 'Count values', unique: 'Distinct', empty: 'Empty', not_empty: 'Not empty', sum: 'Sum', average: 'Average',
  median: 'Median', min: 'Min', max: 'Max', range: 'Range', checked: 'Checked', unchecked: 'Unchecked', percent_empty: 'Percent empty',
  percent_not_empty: 'Percent with values', percent_checked: 'Percent checked', percent_unchecked: 'Percent unchecked', earliest_date: 'Earliest date', latest_date: 'Latest date',
};

/** Donut center / value captions ("Total", "Total Estimate", "Average Estimate", …). */
export function aggregationCaption(agg: ChartAggregation, schema: Schema): string {
  const a = typeof agg.aggregator === 'string' ? agg.aggregator : agg.aggregator.operator;
  const name = agg.property ? schema[agg.property]?.name ?? '' : '';
  if (a === 'count' && !agg.property) return 'Total';
  if (a === 'sum') return `Total ${name}`;
  if (a === 'unique') return `Distinct ${name}`;
  if (['average', 'median', 'min', 'max'].includes(a)) return `${AGG_LABEL[a]} ${name}`;
  return `${AGG_LABEL[a] ?? a} ${name}`.trim();
}

/** Y axis "What to show" label: "Count" or "Sum · Estimate" style. */
export function aggregationLabel(agg: ChartAggregation, schema: Schema): string {
  const a = typeof agg.aggregator === 'string' ? agg.aggregator : agg.aggregator.operator;
  if (a === 'count' && !agg.property) return 'Count';
  const name = agg.property ? schema[agg.property]?.name ?? 'Deleted property' : '';
  return name ? `${name} (${AGG_LABEL[a] ?? a})` : AGG_LABEL[a] ?? a;
}

/** Number chart default title: "Count all" / "{Aggregation} of {property}". */
export function numberChartTitle(agg: ChartAggregation, schema: Schema): string {
  const a = typeof agg.aggregator === 'string' ? agg.aggregator : agg.aggregator.operator;
  if (a === 'count' && !agg.property) return 'Count all';
  const name = agg.property ? schema[agg.property]?.name ?? '' : '';
  return `${AGG_LABEL[a] ?? a} of ${name}`;
}

function aggregate(rows: BlockRecord[], agg: ChartAggregation, schema: Schema, ctx: QueryContext): { value: number; display: string } {
  const a = typeof agg.aggregator === 'string' ? agg.aggregator : agg.aggregator.operator;
  if (a === 'count' && !agg.property) return { value: rows.length, display: rows.length.toLocaleString('en-US') };
  if (agg.property && !schema[agg.property]) return { value: 0, display: '0' };
  const r = aggregateRows(rows, { aggregator: agg.aggregator as never, property: agg.property }, schema, ctx);
  const v = r.value ?? 0;
  return { value: Number.isFinite(v) ? v : 0, display: r.display || String(v) };
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Kinds whose natural group order is meaningful (dates, numbers, checkbox, status option order). */
function orderedKind(p: PropertySchema | undefined): boolean {
  if (!p) return false;
  if (['date', 'created_time', 'last_edited_time', 'number', 'checkbox', 'status', 'auto_increment_id'].includes(p.type)) return true;
  if (p.type === 'formula') {
    const t = (p as { formula2?: { result_type?: { type?: string } } }).formula2?.result_type?.type;
    return t === 'date' || t === 'number' || t === 'checkbox';
  }
  return false;
}

/** Group order before mainSort: chart "manual" = A→Z with "No X" last; "ascending" puts "No X" first. */
function orderGroups(groups: GroupResult[], gb: ChartGroupBy, schema: Schema): GroupResult[] {
  const p = schema[gb.property];
  const sortType = gb.sort?.type ?? 'manual';
  const unc = groups.filter((g) => g.uncategorized);
  let rest = groups.filter((g) => !g.uncategorized);
  if (!orderedKind(p)) rest = [...rest].sort((a, b) => collator.compare(a.label, b.label));
  if (sortType === 'descending') rest = rest.reverse();
  return sortType === 'ascending' ? [...unc, ...rest] : [...rest, ...unc];
}

/** Every group of the X axis (and of the stacked "Group by") in chart order, hidden ones flagged — the settings list. */
export function chartGroupLists(rows: BlockRecord[], cfg: ChartConfig, schema: Schema, ctx: QueryContext, saved: ChartSavedGroups = {}): { main: GroupResult[]; stack: GroupResult[] } {
  const dc = cfg.dataConfig;
  if (dc.type !== 'groups_reducer' || !schema[dc.groupBy.property]) return { main: [], stack: [] };
  const main = orderGroups(computeGroups(rows, { ...dc.groupBy, hideEmptyGroups: false, sort: undefined }, schema, ctx, { saved: saved.groups }), dc.groupBy, schema);
  const sgb = cfg.type !== 'donut' ? dc.aggregationConfig.stackOptions?.groupBy : undefined;
  const stack = sgb && schema[sgb.property] ? orderGroups(computeGroups(rows, { ...sgb, hideEmptyGroups: false, sort: undefined }, schema, ctx, { saved: saved.subgroups }), sgb, schema).filter((g) => g.rows.length > 0) : [];
  return { main, stack };
}

export function computeChart(rows: BlockRecord[], cfg: ChartConfig, schema: Schema, ctx: QueryContext, saved: ChartSavedGroups = {}): ChartData {
  const base: ChartData = { kind: 'groups', points: [], series: [], total: 0, rowCount: rows.length, xName: '', yName: 'Count', integer: true, caption: 'Total' };
  const dc = cfg.dataConfig;
  if (dc.type === 'number_reducer') {
    const agg = dc.aggregationConfig.aggregation;
    if (agg.property && !schema[agg.property]) return { ...base, kind: 'error', error: 'This field has been deleted. Please choose another field.' };
    const r = aggregate(rows, agg, schema, ctx);
    return { ...base, kind: 'number', number: { value: r.value, display: r.display, title: numberChartTitle(agg, schema) } };
  }
  if (dc.type !== 'groups_reducer') return { ...base, kind: 'error', error: 'This chart configuration is not supported.' };
  const gb = dc.groupBy;
  const prop = schema[gb.property];
  if (!prop) return { ...base, kind: 'error', error: 'This field has been deleted. Please choose another field.' };
  if (!isGroupableForChart(prop)) return { ...base, kind: 'error', error: 'This field type is not supported. Please choose another field' };
  const agg = dc.aggregationConfig.aggregation;
  if (agg.property && !schema[agg.property]) return { ...base, kind: 'error', error: 'Previously selected field is no longer valid with the current aggregation. Please make another selection.' };
  const aName = typeof agg.aggregator === 'string' ? agg.aggregator : agg.aggregator.operator;
  const integer = (aName === 'count' || aName === 'count_values' || aName === 'unique' || aName === 'empty' || aName === 'not_empty' || aName === 'checked' || aName === 'unchecked');
  // hidden groups (settings › Visible / Hidden groups) stay out of the chart
  const lists = chartGroupLists(rows, cfg, schema, ctx, saved);
  const groups = lists.main.filter((g) => !g.hidden);
  const stackGroups = lists.stack.filter((g) => !g.hidden);

  let points: ChartPoint[] = groups.map((g) => {
    const r = aggregate(g.rows, agg, schema, ctx);
    const pt: ChartPoint = { key: g.id, label: g.label, color: g.color, value: r.value, display: r.display, rows: g.rows, uncategorized: !!g.uncategorized, groupValue: g.value };
    if (stackGroups.length) {
      const inGroup = new Set(g.rows.map((x) => x.id));
      pt.parts = stackGroups.map((s) => {
        const sub = s.rows.filter((x) => inGroup.has(x.id));
        const sr = aggregate(sub, agg, schema, ctx);
        return { key: s.id, label: s.label, color: s.color, value: sub.length ? sr.value : 0, display: sub.length ? sr.display : '0', rows: sub };
      });
      if (integer || aName === 'sum') {
        pt.value = pt.parts.reduce((a, p) => a + p.value, 0);
        pt.display = pt.value.toLocaleString('en-US');
      }
    }
    return pt;
  });
  if (cfg.chartFormat?.axisHideEmptyGroups) points = points.filter((p) => p.value !== 0);
  const ms = cfg.chartFormat?.mainSort ?? 'manual';
  if (ms === 'x-descending') points = [...points].reverse();
  if (ms === 'y-ascending' || ms === 'y-descending') {
    const dir = ms === 'y-ascending' ? 1 : -1;
    points = points.map((p, i) => ({ p, i })).sort((a, b) => (a.p.value - b.p.value) * dir || a.i - b.i).map((x) => x.p);
  }
  points = points.slice(0, 200);
  const total = points.reduce((a, p) => a + p.value, 0);
  const numberFormat = agg.property ? (schema[agg.property]?.number_format as string | undefined) : undefined;
  return {
    ...base,
    points,
    series: stackGroups.map((s) => ({ key: s.id, label: s.label, color: s.color, uncategorized: !!s.uncategorized })),
    total,
    xName: prop.name,
    yName: aggregationLabel(agg, schema),
    integer,
    numberFormat,
    caption: aggregationCaption(agg, schema),
  };
}

/** Axis ticks: 5 ticks (Highcharts tickAmount-), step from {1, 2, 2.5, 5} × 10^n, integer steps for counts. */
export function niceTicks(minV: number, maxV: number, integer: boolean, count = 4): number[] {
  let lo = Math.min(0, minV);
  let hi = Math.max(0, maxV);
  if (hi - lo <= 0) hi = lo + (integer ? count : 1);
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, Math.ceil(step));
  lo = Math.floor(lo / step) * step;
  while (lo + count * step < hi) step = integer ? step + 1 : step * 2;
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round((lo + i * step) * 1e9) / 1e9);
  return out;
}

/** Color token of a chart color name (accent-secondary tokens; gray/default/empty are chart-specific greys). */
export function chartColorVar(name: string | undefined): string {
  switch (name) {
    case 'blue': return 'var(--lp-blue-bg-accent-secondary)';
    case 'brown': return 'var(--lp-brown-bg-accent-secondary)';
    case 'green': return 'var(--lp-green-bg-accent-secondary)';
    case 'orange': return 'var(--lp-orange-bg-accent-secondary)';
    case 'pink': return 'var(--lp-pink-bg-accent-secondary)';
    case 'purple': return 'var(--lp-purple-bg-accent-secondary)';
    case 'red': return 'var(--lp-red-bg-accent-secondary)';
    case 'teal': return 'var(--lp-teal-bg-accent-secondary)';
    case 'yellow': return 'var(--lp-yellow-bg-accent-secondary)';
    case 'gray': return 'var(--nc-chart-gray)';
    case 'lightgray': return 'var(--nc-chart-default)';
    case 'empty': return 'var(--nc-chart-empty)';
    default: return 'var(--nc-chart-default)';
  }
}

/** Color of the i-th category / series under a color theme ("auto" uses option colors when the property has them). */
export function pointColor(theme: ChartColorTheme | undefined, i: number, optionColor: string | undefined, uncategorized: boolean, hasOptionColors: boolean): string {
  if (uncategorized) return chartColorVar('empty');
  const t = theme ?? 'auto';
  if (t === 'auto') {
    if (hasOptionColors) return chartColorVar(optionColor || 'default');
    return chartColorVar('blue');
  }
  if (t === 'colorful') return chartColorVar(COLORFUL[i % COLORFUL.length]);
  return chartColorVar(t);
}

/** Series color (line charts / stacked segments): auto → option colors when present, else the colorful palette. */
export function seriesColor(theme: ChartColorTheme | undefined, i: number, optionColor: string | undefined, uncategorized: boolean): string {
  if (uncategorized) return chartColorVar('empty');
  const t = theme ?? 'auto';
  if (t === 'auto') return optionColor ? chartColorVar(optionColor) : chartColorVar(COLORFUL[i % COLORFUL.length]);
  if (t === 'colorful') return chartColorVar(COLORFUL[i % COLORFUL.length]);
  return chartColorVar(t);
}

export function formatTick(v: number, numberFormat?: string): string {
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1e9) s = `${+(v / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) s = `${+(v / 1e6).toFixed(1)}M`;
  else if (abs >= 1e4) s = `${+(v / 1e3).toFixed(1)}K`;
  else s = (Math.round(v * 100) / 100).toLocaleString('en-US');
  if (numberFormat === 'percent') return `${Math.round(v * 10000) / 100}%`;
  return s;
}
