import { describe, expect, it } from 'vitest';
import type { BlockRecord, PropertySchema } from '@nc/shared/records.ts';
import { computeChart, defaultChartConfig, niceTicks, pickChartGroupProperty, switchChartType, type ChartConfig } from './chartModel.ts';

// The Tasks data source: Tags options in schema order.
const schema: Record<string, PropertySchema> = {
  '>fhI': { name: 'Done', type: 'checkbox' },
  '_<{]': { name: 'Estimate', type: 'number' },
  '_OC^': {
    name: 'Tags', type: 'multi_select',
    options: [
      { id: '1', value: 'UI', color: 'orange' }, { id: '2', value: 'Web', color: 'blue' }, { id: '3', value: 'Backend', color: 'gray' },
      { id: '4', value: 'Bug', color: 'yellow' }, { id: '5', value: 'Planning', color: 'red' }, { id: '6', value: 'Docs', color: 'pink' },
    ],
  },
  'sW^f': { name: 'Priority', type: 'select', options: [] },
  title: { name: 'Name', type: 'title' },
} as never;

const row = (id: string, tags: string, est: number): BlockRecord => ({
  id, type: 'page', parent_id: 'c', parent_table: 'collection', alive: true, space_id: 's', version: 1,
  properties: { title: [[id]], '_OC^': tags ? [[tags]] : undefined, '_<{]': [[String(est)]] } as never,
} as never);

// 6 pages and 8 tag assignments: Web has 2, five tags have 1 each, and one page has no tags.
const rows = [row('a', 'Web,UI', 1), row('b', 'Web,Backend', 2), row('c', 'Bug', 3), row('d', 'Docs', 4), row('e', 'Planning', 5), row('f', '', 6)];
const ctx = { getRecord: () => undefined, rowsOf: () => [], now: Date.UTC(2026, 9, 20) } as never;

describe('chart model', () => {
  it('defaults to a column chart of the first select-like property (captured db-d195-add-chart.json)', () => {
    expect(pickChartGroupProperty(schema)).toBe('_OC^');
    expect(defaultChartConfig(schema)).toEqual({
      chartFormat: { axisHideEmptyGroups: false, mainSort: 'manual' },
      type: 'column',
      dataConfig: { type: 'groups_reducer', groupBy: { property: '_OC^', type: 'multi_select', hideEmptyGroups: false, sort: { type: 'manual' } }, aggregationConfig: { aggregation: { aggregator: 'count' }, seriesFormat: { displayType: 'column' } } },
    });
  });

  it('manual order is A→Z with "No Tags" last; y-descending keeps ties in that order (screens db-422 / db-452)', () => {
    const cfg = defaultChartConfig(schema);
    const manual = computeChart(rows, cfg, schema, ctx);
    expect(manual.points.map((p) => `${p.label}:${p.value}`)).toEqual(['Backend:1', 'Bug:1', 'Docs:1', 'Planning:1', 'UI:1', 'Web:2', 'No Tags:1']);
    const desc = computeChart(rows, { ...cfg, chartFormat: { ...cfg.chartFormat, mainSort: 'y-descending' } }, schema, ctx);
    expect(desc.points.map((p) => p.label)).toEqual(['Web', 'Backend', 'Bug', 'Docs', 'Planning', 'UI', 'No Tags']);
    expect(desc.points[0].color).toBe('blue');
  });

  it('donut counts pages in the center and slices by assignments (db-446: "6 Total", 2 = 25%)', () => {
    const donut = switchChartType(defaultChartConfig(schema), 'donut', schema);
    expect(donut).toEqual({
      chartFormat: { axisHideEmptyGroups: false, mainSort: 'y-descending', donutDataLabels: 'value' },
      type: 'donut',
      dataConfig: { type: 'groups_reducer', groupBy: { property: '_OC^', type: 'multi_select', hideEmptyGroups: false, sort: { type: 'ascending' } }, aggregationConfig: { aggregation: { aggregator: 'count' } } },
    });
    const data = computeChart(rows, donut, schema, ctx);
    expect(data.rowCount).toBe(6);
    expect(data.total).toBe(8);
    expect(data.points.map((p) => p.label)).toEqual(['Web', 'No Tags', 'Backend', 'Bug', 'Docs', 'Planning', 'UI']);
    expect(data.caption).toBe('Total');
  });

  it('number chart counts all rows with Litpage\'s default title', () => {
    const num = switchChartType(defaultChartConfig(schema), 'number', schema) as ChartConfig;
    expect(num.dataConfig).toEqual({ type: 'number_reducer', aggregationConfig: { aggregation: { aggregator: 'count' } } });
    const data = computeChart(rows, num, schema, ctx);
    expect(data.number?.value).toBe(6);
    expect(data.number?.title).toBe('Count all');
  });

  it('sums a number property per group and omits zero groups', () => {
    const cfg = defaultChartConfig(schema);
    if (cfg.dataConfig.type !== 'groups_reducer') throw new Error('groups');
    const sum: ChartConfig = { ...cfg, chartFormat: { ...cfg.chartFormat, axisHideEmptyGroups: true }, dataConfig: { ...cfg.dataConfig, aggregationConfig: { ...cfg.dataConfig.aggregationConfig, aggregation: { aggregator: 'sum', property: '_<{]' } } } };
    const data = computeChart(rows, sum, schema, ctx);
    expect(data.points.find((p) => p.label === 'Web')?.value).toBe(3);
    expect(data.integer).toBe(false);
    expect(data.yName).toBe('Estimate (Sum)');
  });

  it('stacks series by a second property', () => {
    const cfg = defaultChartConfig(schema);
    if (cfg.dataConfig.type !== 'groups_reducer') throw new Error('groups');
    const stacked: ChartConfig = { ...cfg, dataConfig: { ...cfg.dataConfig, aggregationConfig: { ...cfg.dataConfig.aggregationConfig, stackOptions: { groupBy: { property: '>fhI', type: 'checkbox', sort: { type: 'manual' } } } } } };
    const data = computeChart(rows, stacked, schema, ctx);
    expect(data.series.map((s) => s.label)).toEqual(['Unchecked']);
    expect(data.points.find((p) => p.label === 'Web')?.parts?.[0].value).toBe(2);
  });

  it('ticks: five ticks with integer steps for counts (0–4 for a max of 2, like the captures)', () => {
    expect(niceTicks(0, 2, true)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0, 7, true)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0, 9, true)).toEqual([0, 3, 6, 9, 12]);
    expect(niceTicks(0, 0.8, false)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(-3, 5, true)[0]).toBeLessThanOrEqual(-3);
  });
});
