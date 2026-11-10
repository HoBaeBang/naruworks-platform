import { HELP_URL } from '@nc/shared/brand.ts';
// Chart view settings: chart type, X axis, Y axis, style, donut data, number, database, filters, and sharing.
import { useState, type ReactNode } from 'react';
import * as L from 'lucide-react';
import type { PropertySchema } from '@nc/shared/records.ts';
import { savedGroupsFrom, type GroupResult } from '@nc/shared/database/index.ts';
import { NUMBER_FORMATS } from '@nc/shared/formula/index.ts';
import { Icon, registerIcons } from '../../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { useUI } from '../../../../lib/store/ui.ts';
import { PropertyIcon } from '../../properties/PropertyCell.tsx';
import { viewIcon, viewLink } from '../../chrome/ViewTabs.tsx';
import type { ViewSettingsMainProps } from '../../viewRegistry.ts';
import { NUMBER_FORMAT_LABEL, PRECISIONS, collectionName } from '../../advanced/index.ts';
import { SettingsRow, SettingsToggle, openNestedMenu, overlayParentOf, setFormat } from '../../advanced/viewKit.tsx';
import { makeQueryContext, useViewQuery } from '../../data.ts';
import { setSavedGroups } from '../../actions.ts';
import { GroupToken } from '../../chrome/Groups.tsx';
import { openChartExport } from './ChartExport.tsx';
import {
  AGG_LABEL, CHART_TYPE_LABEL, CHART_TYPE_ORDER, aggregationLabel, chartColorVar, chartConfigOf, chartGroupLists, chartSavedGroupsOf, groupByFor, isGroupableForChart, isNumericProperty, numberChartTitle, switchChartType,
  type ChartAggregation, type ChartColorTheme, type ChartConfig, type ChartFormat, type ChartGroupBy, type ChartHeight, type ChartType, type MainSort, type ReferenceLine,
} from './chartModel.ts';

registerIcons({
  ncChartXWhat: L.CornerDownRight, ncChartSort: L.ArrowLeftRight, ncChartYWhat: L.ArrowUp, ncChartGroup: L.Rows2, ncChartRange: L.MoveVertical,
  ncChartRefLines: L.Ellipsis, ncChartColor: L.Palette, ncChartStyle: L.Brush, ncChartTitle: L.CaseSensitive, ncChartCalc: L.Binary,
  ncChartHeight: L.MoveVertical, ncChartRangeH: L.MoveHorizontal, ncChartSlice: L.ChartPie,
});

const CHART_TYPE_ICON: Record<ChartType, string> = { column: 'chartBarXAxis', bar: 'chartBarYAxis', line: 'chartLine', donut: 'donutChart', number: 'number' };
const THEMES: { id: ChartColorTheme; label: string }[] = [
  { id: 'auto', label: 'Auto' }, { id: 'colorful', label: 'Colorful' }, { id: 'gray', label: 'Colorless' }, { id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' },
  { id: 'orange', label: 'Orange' }, { id: 'pink', label: 'Pink' }, { id: 'purple', label: 'Purple' }, { id: 'red', label: 'Red' }, { id: 'teal', label: 'Teal' }, { id: 'yellow', label: 'Yellow' },
];
const HEIGHTS: { id: ChartHeight; label: string }[] = [{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }, { id: 'extra_large', label: 'Extra large' }];
const NUMBER_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const REF_COLORS = ['gray', 'lightgray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const NUMERIC_AGGS = ['sum', 'average', 'median', 'min', 'max', 'range'];
const DATE_KINDS = ['date', 'created_time', 'last_edited_time'];

function Section({ title, children, divider }: { title?: ReactNode; children: ReactNode; divider?: boolean }) {
  return (
    <div className={`nc-menu-section ${divider ? 'with-divider' : ''}`}>
      {title && <div className="nc-menu-section-title">{title}</div>}
      {children}
    </div>
  );
}

function sub(anchor: HTMLElement, items: MenuItemDef[], width = 250, search?: string) {
  return openNestedMenu(anchor, { width, search, sections: [{ items }] }, { placement: 'bottom-end', offset: 2 });
}

function Swatch({ color }: { color: string }) {
  return <span className="nc-chart-swatch" style={{ background: color }} />;
}

/** Calculations offered for a property in "Calculate" / "Choose what to display" submenus. */
export function aggregationsFor(p: PropertySchema | undefined): string[] {
  if (!p) return ['count'];
  if (isNumericProperty(p)) return [...NUMERIC_AGGS, 'count_values', 'unique'];
  if (p.type === 'checkbox') return ['checked', 'unchecked', 'percent_checked', 'percent_unchecked'];
  if (DATE_KINDS.includes(p.type)) return ['count_values', 'unique', 'empty', 'not_empty', 'earliest_date', 'latest_date'];
  return ['count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'];
}

function sortLabel(ms: MainSort | undefined, xProp: PropertySchema | undefined, yName: string): string {
  const name = xProp?.name ?? '';
  const date = !!xProp && DATE_KINDS.includes(xProp.type);
  const num = !!xProp && (xProp.type === 'number' || isNumericProperty(xProp));
  switch (ms ?? 'manual') {
    case 'x-ascending': return date ? 'Old → New' : num ? `${name} Ascending` : `${name} A → Z`;
    case 'x-descending': return date ? 'New → Old' : num ? `${name} Descending` : `${name} Z → A`;
    case 'y-ascending': return `${yName} Low → High`;
    case 'y-descending': return `${yName} High → Low`;
    default: return 'Manual';
  }
}

/** Visible groups / Hidden groups with 👁 toggles. */
function GroupVisibility({ groups, ro, onToggle, onAll }: { groups: GroupResult[]; ro: boolean; onToggle: (g: GroupResult) => void; onAll: (hide: boolean) => void }) {
  if (!groups.length) return null;
  const shown = groups.filter((g) => !g.hidden);
  const hidden = groups.filter((g) => g.hidden);
  const row = (g: GroupResult) => (
    <div key={g.id} className="nc-menu-item nc-vis-row nc-chart-group-row" data-group-key={g.id}>
      <div className="nc-menu-item-inner">
        <div className="nc-menu-label"><GroupToken group={g} /></div>
        <span role="button" className={`nc-vis-eye ${ro ? 'disabled' : ''}`} aria-label={g.hidden ? 'Show group' : 'Hide group'} onClick={() => !ro && onToggle(g)}><Icon name={g.hidden ? 'eyeSlash' : 'eye'} size={16} /></span>
      </div>
    </div>
  );
  const head = (label: string, action: string, hide: boolean) => (
    <div className="nc-chart-groups-head"><span>{label}</span>{!ro && <span role="button" className="nc-vs-section-action" onClick={() => onAll(hide)}>{action}</span>}</div>
  );
  return (
    <div className="nc-chart-groups" data-testid="chart-groups">
      {shown.length > 0 && head('Visible groups', 'Hide all', true)}
      {shown.map(row)}
      {hidden.length > 0 && head('Hidden groups', 'Show all', false)}
      {hidden.map(row)}
    </div>
  );
}

export function ChartSettingsMain({ block, view, collection, readOnly, go }: ViewSettingsMainProps) {
  const schema = collection.schema;
  const cfg = chartConfigOf(view.format as Record<string, unknown> | undefined, schema);
  const fmt: ChartFormat = cfg.chartFormat ?? {};
  const ro = readOnly;
  const save = (next: ChartConfig, action = 'chartSettings.setChartConfig') => setFormat(view, { chart_config: next }, action);
  const setFmt = (patch: Partial<ChartFormat>) => save({ ...cfg, chartFormat: { ...fmt, ...patch } });
  const dc = cfg.dataConfig;
  const groups = dc.type === 'groups_reducer' ? dc : undefined;
  const xProp = groups ? schema[groups.groupBy.property] : undefined;
  const agg: ChartAggregation = dc.type === 'groups_reducer' || dc.type === 'number_reducer' ? dc.aggregationConfig.aggregation : { aggregator: 'count' };
  const yName = aggregationLabel(agg, schema);
  const stackGb = groups?.aggregationConfig.stackOptions?.groupBy;
  // groups of the X axis / slices and of the stacked "Group by", with their visibility
  const q = useViewQuery(collection, view);
  const saved = chartSavedGroupsOf(view.format as Record<string, unknown> | undefined);
  const lists = groups ? chartGroupLists(q.rows, cfg, schema, makeQueryContext(), saved) : { main: [], stack: [] };
  const toggleMain = (list: GroupResult[], hide: (g: GroupResult) => boolean) => {
    if (!groups) return;
    setSavedGroups(view, savedGroupsFrom(list.map((g) => ({ ...g, hidden: hide(g) })), groups.groupBy.property, saved.groups), { action: 'chartSettings.setGroupVisibility' });
  };
  const toggleStack = (list: GroupResult[], hide: (g: GroupResult) => boolean) => {
    if (!stackGb) return;
    setFormat(view, { chart_subgroups: savedGroupsFrom(list.map((g) => ({ ...g, hidden: hide(g) })), stackGb.property, saved.subgroups) }, 'chartSettings.setSubgroupVisibility');
  };
  const mainVisibility = (
    <GroupVisibility groups={lists.main} ro={ro} onToggle={(g) => toggleMain(lists.main, (x) => (x.id === g.id ? !x.hidden : !!x.hidden))} onAll={(hide) => toggleMain(lists.main, () => hide)} />
  );

  const setGroups = (patch: Partial<NonNullable<typeof groups>>) => {
    if (!groups) return;
    save({ ...cfg, dataConfig: { ...groups, ...patch } as ChartConfig['dataConfig'] });
  };
  const setAgg = (a: ChartAggregation) => {
    if (dc.type === 'groups_reducer') save({ ...cfg, dataConfig: { ...dc, aggregationConfig: { ...dc.aggregationConfig, aggregation: a } } });
    else if (dc.type === 'number_reducer') save({ ...cfg, dataConfig: { ...dc, aggregationConfig: { aggregation: a } } });
  };

  const groupablePropItems = (current: string | undefined, onPick: (id: string) => void, exclude?: string): MenuItemDef[] => {
    const ids = ['title', ...Object.keys(schema).filter((k) => k !== 'title')].filter((id) => schema[id] && id !== exclude && isGroupableForChart(schema[id]));
    return ids.map((id) => ({ id, label: schema[id].name, icon: <PropertyIcon prop={schema[id]} size={16} />, checked: id === current, onSelect: () => onPick(id) }));
  };

  const pickX = (e: React.MouseEvent<HTMLElement>) => sub(e.currentTarget, groupablePropItems(groups?.groupBy.property, (id) => {
    if (!groups) return;
    const gb: ChartGroupBy = groupByFor(id, schema, groups.groupBy.sort?.type === 'ascending' ? 'ascending' : 'manual');
    const stack = groups.aggregationConfig.stackOptions?.groupBy.property === id ? undefined : groups.aggregationConfig.stackOptions;
    setGroups({ groupBy: gb, aggregationConfig: { ...groups.aggregationConfig, stackOptions: stack } });
  }), 260, 'Search properties...');

  const yItems = (onPick: (a: ChartAggregation) => void, opts?: { none?: boolean }): MenuItemDef[] => {
    const out: MenuItemDef[] = [];
    if (opts?.none) out.push({ id: 'none', label: 'None', checked: !agg.property, onSelect: () => onPick({ aggregator: 'count' }) });
    else out.push({ id: 'count', label: 'Count', icon: 'number', checked: !agg.property && agg.aggregator === 'count', onSelect: () => onPick({ aggregator: 'count' }) });
    const ids = ['title', ...Object.keys(schema).filter((k) => k !== 'title')].filter((id) => schema[id] && !['button'].includes(schema[id].type));
    for (const id of ids) {
      const p = schema[id];
      out.push({
        id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: agg.property === id,
        submenu: () => ({ width: 220, sections: [{ items: aggregationsFor(p).map((a) => ({ id: a, label: a === 'unique' ? 'Distinct values' : AGG_LABEL[a] ?? a, checked: agg.property === id && agg.aggregator === a, onSelect: () => onPick({ aggregator: a, property: id }) })) }] }),
      });
    }
    return out;
  };

  const sortItems = (): MenuItemDef[] => {
    const cur = fmt.mainSort ?? 'manual';
    return (['manual', 'x-ascending', 'x-descending', 'y-ascending', 'y-descending'] as MainSort[]).map((m) => ({ id: m, label: sortLabel(m, xProp, yName), checked: cur === m, onSelect: () => setFmt({ mainSort: m }) }));
  };

  const colorRow = () => (
    <SettingsRow icon="ncChartColor" label="Color" value={THEMES.find((t) => t.id === (fmt.colorTheme ?? 'auto'))?.label} disabled={ro} onClick={(e) => sub(e.currentTarget, THEMES.map((t) => ({
      id: t.id, label: t.label, checked: (fmt.colorTheme ?? 'auto') === t.id, onSelect: () => setFmt({ colorTheme: t.id }),
      icon: t.id === 'auto' || t.id === 'colorful' ? <span className="nc-chart-swatch multi" /> : <Swatch color={chartColorVar(t.id === 'gray' ? 'gray' : t.id)} />,
    })))} />
  );

  const styleMenu = (e: React.MouseEvent<HTMLElement>) => {
    const items: MenuItemDef[] = [
      { id: 'height', label: 'Height', right: <span className="nc-menu-value">{HEIGHTS.find((h) => h.id === (fmt.height ?? 'medium'))?.label}</span>, submenu: () => ({ width: 200, sections: [{ items: HEIGHTS.map((h) => ({ id: h.id, label: h.label, checked: (fmt.height ?? 'medium') === h.id, onSelect: () => setFmt({ height: h.id }) })) }] }) },
    ];
    if (cfg.type !== 'donut') {
      items.push(
        { id: 'grid', label: 'Grid line', right: <span className="nc-menu-value">{({ none: 'None', horizontal: 'Horizontal', vertical: 'Vertical', both: 'Both' })[fmt.axisGridLine ?? 'horizontal']}</span>, submenu: () => ({ width: 200, sections: [{ items: (['none', 'horizontal', 'vertical', 'both'] as const).map((g) => ({ id: g, label: ({ none: 'None', horizontal: 'Horizontal', vertical: 'Vertical', both: 'Both' })[g], checked: (fmt.axisGridLine ?? 'horizontal') === g, onSelect: () => setFmt({ axisGridLine: g }) })) }] }) },
        { id: 'axisname', label: 'Axis name', right: <span className="nc-menu-value">{({ none: 'None', x_axis: 'X axis', y_axis: 'Y axis', both: 'Both' })[fmt.axisLabel ?? 'none']}</span>, submenu: () => ({ width: 200, sections: [{ items: (['none', 'x_axis', 'y_axis', 'both'] as const).map((g) => ({ id: g, label: ({ none: 'None', x_axis: 'X axis', y_axis: 'Y axis', both: 'Both' })[g], checked: (fmt.axisLabel ?? 'none') === g, onSelect: () => setFmt({ axisLabel: g }) })) }] }) },
        { id: 'labels', label: 'Data labels', checked: fmt.axisShowDataLabels !== false, onSelect: () => setFmt({ axisShowDataLabels: fmt.axisShowDataLabels === false }) },
      );
      if (cfg.type === 'line') {
        items.push(
          { id: 'smooth', label: 'Smooth line', checked: !!fmt.smoothLine, onSelect: () => setFmt({ smoothLine: !fmt.smoothLine }) },
          { id: 'fill', label: 'Gradient area', checked: !fmt.hideLineFillArea, onSelect: () => setFmt({ hideLineFillArea: !fmt.hideLineFillArea }) },
          { id: 'cumulative', label: 'Cumulative', checked: !!fmt.axisCumulative, onSelect: () => setFmt({ axisCumulative: !fmt.axisCumulative }) },
        );
      }
      if (stackGb) {
        items.push({ id: 'groupstyle', label: 'Group style', right: <span className="nc-menu-value">{({ normal: 'Stacked', side_by_side: 'Not stacked', percent: 'Percent' })[fmt.axisGroupStyle ?? 'normal']}</span>, submenu: () => ({ width: 200, sections: [{ items: (['normal', 'side_by_side', 'percent'] as const).map((g) => ({ id: g, label: ({ normal: 'Stacked', side_by_side: 'Not stacked', percent: 'Percent' })[g], checked: (fmt.axisGroupStyle ?? 'normal') === g, onSelect: () => setFmt({ axisGroupStyle: g }) })) }] }) });
      }
    } else {
      items.push(
        { id: 'donutlabels', label: 'Data labels', right: <span className="nc-menu-value">{({ none: 'None', value: 'Value (%)', name: 'Name', name_and_value: 'Label and value (%)' })[fmt.donutDataLabels ?? 'value']}</span>, submenu: () => ({ width: 220, sections: [{ items: (['none', 'value', 'name', 'name_and_value'] as const).map((g) => ({ id: g, label: ({ none: 'None', value: 'Value (%)', name: 'Name', name_and_value: 'Label and value (%)' })[g], checked: (fmt.donutDataLabels ?? 'value') === g, onSelect: () => setFmt({ donutDataLabels: g }) })) }] }) },
        { id: 'showvalue', label: 'Show value', checked: !fmt.donutHideValue, onSelect: () => setFmt({ donutHideValue: !fmt.donutHideValue }) },
      );
    }
    // "Color by metric": bars / donut drawn in one color get darker with larger values
    const theme = fmt.colorTheme ?? 'auto';
    if ((cfg.type === 'donut' || ((cfg.type === 'column' || cfg.type === 'bar') && !stackGb)) && theme !== 'auto' && theme !== 'colorful') {
      items.push({ id: 'weight', label: 'Color by metric', checked: !!fmt.weightColorValue, onSelect: () => setFmt({ weightColorValue: !fmt.weightColorValue }) });
    }
    if (cfg.type === 'donut' || stackGb || cfg.type === 'line') {
      items.push({ id: 'legend', label: 'Legend', right: <span className="nc-menu-value">{fmt.hideLegend || fmt.legendPosition === 'off' ? 'Off' : fmt.legendPosition === 'side' ? 'Side' : 'Bottom'}</span>, submenu: () => ({ width: 200, sections: [{ items: (['bottom', 'side', 'off'] as const).map((g) => ({ id: g, label: ({ bottom: 'Bottom', side: 'Side', off: 'Off' })[g], checked: (fmt.hideLegend ? 'off' : fmt.legendPosition ?? 'bottom') === g, onSelect: () => setFmt({ legendPosition: g, hideLegend: g === 'off' }) })) }] }) });
    }
    sub(e.currentTarget, items, 260);
  };

  const rangeEditor = (e: React.MouseEvent<HTMLElement>) => openOverlay((close) => (
    <PopoverSurface width={260}>
      <RangeEditor min={fmt.yAxisMin} max={fmt.yAxisMax} onChange={(min, max) => setFmt({ yAxisMin: min, yAxisMax: max })} onReset={() => { setFmt({ yAxisMin: undefined, yAxisMax: undefined }); close(); }} />
    </PopoverSurface>
  ), { anchor: e.currentTarget, placement: 'bottom-end', parent: overlayParentOf(e.currentTarget) });

  const refEditor = (e: React.MouseEvent<HTMLElement>) => openOverlay(() => (
    <PopoverSurface width={320}>
      <RefLinesEditor lines={fmt.referenceLines ?? []} onChange={(lines) => setFmt({ referenceLines: lines.length ? lines : undefined })} />
    </PopoverSurface>
  ), { anchor: e.currentTarget, placement: 'bottom-end', parent: overlayParentOf(e.currentTarget) });

  const rangeValue = fmt.yAxisMin !== undefined || fmt.yAxisMax !== undefined ? 'Custom' : 'Auto';
  const refValue = (fmt.referenceLines ?? []).length === 1 ? '1 line' : `${(fmt.referenceLines ?? []).length} lines`;
  const isBar = cfg.type === 'bar';

  const categoryRows = (
    <>
      <SettingsRow icon="ncChartXWhat" label="Choose what to display" value={xProp?.name ?? 'None'} disabled={ro} onClick={pickX} />
      {xProp && DATE_KINDS.includes(xProp.type) && groups && (
        <SettingsRow icon="calendar" label="Group by" value={({ day: 'Day', week: 'Week', month: 'Month', year: 'Year', relative: 'Relative' } as Record<string, string>)[String(groups.groupBy.groupBy ?? 'month')] ?? 'Month'} disabled={ro} onClick={(e) => sub(e.currentTarget, (['day', 'week', 'month', 'year'] as const).map((g) => ({ id: g, label: g[0].toUpperCase() + g.slice(1), checked: (groups.groupBy.groupBy ?? 'month') === g, onSelect: () => setGroups({ groupBy: { ...groups.groupBy, groupBy: g } }) })))} />
      )}
      <SettingsRow icon="ncChartSort" label="Sort by" value={sortLabel(fmt.mainSort, xProp, yName)} disabled={ro} onClick={(e) => sub(e.currentTarget, sortItems(), 260)} />
      <SettingsToggle label={<span className="nc-chart-row-label"><Icon name="eyeOff" size={20} />Hide zero values</span>} on={!!fmt.axisHideEmptyGroups} disabled={ro} onChange={(v) => setFmt({ axisHideEmptyGroups: v })} />
      {mainVisibility}
    </>
  );
  const valueRows = (
    <>
      <SettingsRow icon="ncChartYWhat" label="Choose what to display" value={yName} disabled={ro} onClick={(e) => sub(e.currentTarget, yItems(setAgg), 260, 'Search properties...')} />
      <SettingsRow icon="ncChartGroup" label="Group by" value={stackGb ? schema[stackGb.property]?.name ?? 'None' : 'None'} disabled={ro || !groups} onClick={(e) => groups && sub(e.currentTarget, [
        { id: 'none', label: 'None', checked: !stackGb, onSelect: () => setGroups({ aggregationConfig: { ...groups.aggregationConfig, stackOptions: undefined } }) },
        ...groupablePropItems(stackGb?.property, (id) => {
          save({ ...cfg, chartFormat: { ...fmt, axisGroupStyle: fmt.axisGroupStyle ?? 'normal' }, dataConfig: { ...groups, aggregationConfig: { ...groups.aggregationConfig, stackOptions: { groupBy: groupByFor(id, schema) } } } });
        }, groups.groupBy.property),
      ], 260, 'Search properties...')} />
      {stackGb && <GroupVisibility groups={lists.stack} ro={ro} onToggle={(g) => toggleStack(lists.stack, (x) => (x.id === g.id ? !x.hidden : !!x.hidden))} onAll={(hide) => toggleStack(lists.stack, () => hide)} />}
      <SettingsRow icon={isBar ? 'ncChartRangeH' : 'ncChartRange'} label="Range" value={rangeValue} disabled={ro} onClick={rangeEditor} />
      <SettingsRow icon="ncChartRefLines" label="Reference lines" value={refValue} disabled={ro} onClick={refEditor} />
    </>
  );

  const exportChart = () => {
    const svg = document.querySelector(`[data-chart-view-id="${view.id}"] svg.nc-chart-svg`) as SVGSVGElement | null;
    if (!svg) return useUI.getState().toast('Nothing to export');
    openChartExport(svg, view.name || 'chart');
  };

  return (
    <>
      <Section>
        <SettingsRow icon={viewIcon(view.type)} label="Layout" value="Chart" onClick={() => go('layout')} />
      </Section>
      <Section divider title="Chart type">
        <div className="nc-chart-types" role="radiogroup" aria-label="Chart type">
          {CHART_TYPE_ORDER.map((t) => (
            <div key={t} role="radio" aria-checked={cfg.type === t} aria-label={CHART_TYPE_LABEL[t]} data-tooltip={CHART_TYPE_LABEL[t]} className={`nc-chart-type ${cfg.type === t ? 'on' : ''} ${ro ? 'disabled' : ''}`} onClick={() => !ro && cfg.type !== t && save(switchChartType(cfg, t, schema))}>
              <Icon name={CHART_TYPE_ICON[t]} size={20} />
            </div>
          ))}
        </div>
      </Section>
      {cfg.type === 'number' ? (
        <>
          <Section>
            <SettingsToggle label={<span className="nc-chart-row-label"><Icon name="ncChartTitle" size={20} />Chart title</span>} on={!fmt.hideTitle} disabled={ro} onChange={(v) => setFmt({ hideTitle: !v })} />
            {!fmt.hideTitle && <TitleInput value={fmt.valueLabel ?? ''} placeholder={numberChartTitle(agg, schema)} disabled={ro} onChange={(v) => save({ ...cfg, chartFormat: { ...fmt, valueLabel: v || undefined } }, 'chartSettings.setChartFormat.valueLabel')} />}
          </Section>
          <Section title="Data">
            <SettingsRow icon="number" label="Choose what to display" value={agg.property ? schema[agg.property]?.name ?? 'None' : 'None'} disabled={ro} onClick={(e) => sub(e.currentTarget, [
              { id: 'none', label: 'None', checked: !agg.property, onSelect: () => setAgg({ aggregator: 'count' }) },
              ...['title', ...Object.keys(schema).filter((k) => k !== 'title')].filter((id) => schema[id] && schema[id].type !== 'button').map((id) => ({
                id, label: schema[id].name, icon: <PropertyIcon prop={schema[id]} size={16} />, checked: agg.property === id,
                onSelect: () => setAgg({ aggregator: aggregationsFor(schema[id])[0], property: id }),
              })),
            ], 260, 'Search properties...')} />
            <SettingsRow icon="ncChartCalc" label="Calculate" value={!agg.property ? 'Count all' : AGG_LABEL[String(agg.aggregator)] ?? String(agg.aggregator)} chevron={!!agg.property} disabled={ro || !agg.property} onClick={(e) => agg.property && sub(e.currentTarget, aggregationsFor(schema[agg.property]).map((a) => ({ id: a, label: a === 'unique' ? 'Distinct values' : AGG_LABEL[a] ?? a, checked: agg.aggregator === a, onSelect: () => setAgg({ aggregator: a, property: agg.property }) })))} />
            <SettingsRow icon="sliders" label="Format" value={fmt.numberFormatOverride ? NUMBER_FORMAT_LABEL[fmt.numberFormatOverride] ?? fmt.numberFormatOverride : 'Inherit'} disabled={ro} onClick={(e) => sub(e.currentTarget, [
              { id: 'inherit', label: 'Inherit', checked: !fmt.numberFormatOverride, onSelect: () => setFmt({ numberFormatOverride: undefined }) },
              {
                id: 'format', label: 'Number format', submenu: () => ({ width: 250, search: 'Filter formats…', sections: [{ items: NUMBER_FORMATS.map((f) => ({ id: f, label: NUMBER_FORMAT_LABEL[f] ?? f, checked: fmt.numberFormatOverride === f, onSelect: () => setFmt({ numberFormatOverride: f }) })) }] }),
              },
              {
                id: 'precision', label: 'Decimal places', submenu: () => ({ width: 200, sections: [{ items: PRECISIONS.map((p) => ({ id: p.id, label: p.label, checked: (fmt.numberPrecisionOverride ?? 'precision_uncapped') === p.id, onSelect: () => setFmt({ numberPrecisionOverride: p.id }) })) }] }),
              },
            ], 240)} />
          </Section>
          <Section title="Style">
            <SettingsRow icon="ncChartColor" label="Color" value={fmt.numberColor ? fmt.numberColor[0].toUpperCase() + fmt.numberColor.slice(1) : 'Default'} disabled={ro} onClick={(e) => sub(e.currentTarget, NUMBER_COLORS.map((c) => ({ id: c, label: c === 'default' ? 'Default' : c[0].toUpperCase() + c.slice(1), checked: (fmt.numberColor ?? 'default') === c, icon: <Swatch color={c === 'default' ? 'var(--lp-text-primary)' : c === 'gray' ? 'var(--lp-text-secondary)' : chartColorVar(c)} />, onSelect: () => setFmt({ numberColor: c === 'default' ? undefined : c }) })))} />
            <SettingsRow icon="ncChartHeight" label="Height" value={HEIGHTS.find((h) => h.id === (fmt.height ?? 'medium'))?.label} disabled={ro} onClick={(e) => sub(e.currentTarget, HEIGHTS.map((h) => ({ id: h.id, label: h.label, checked: (fmt.height ?? 'medium') === h.id, onSelect: () => setFmt({ height: h.id }) })))} />
          </Section>
        </>
      ) : cfg.type === 'donut' ? (
        <>
          <Section title="Data">
            <SettingsRow icon="donutChart" label="Choose what to display" value={xProp?.name ?? 'None'} disabled={ro} onClick={pickX} />
            <SettingsRow icon="ncChartSlice" label="Slice by" value={yName} disabled={ro} onClick={(e) => sub(e.currentTarget, yItems(setAgg), 260, 'Search properties...')} />
            <SettingsRow icon="ncChartSort" label="Sort by" value={sortLabel(fmt.mainSort, xProp, yName)} disabled={ro} onClick={(e) => sub(e.currentTarget, sortItems(), 260)} />
            {mainVisibility}
          </Section>
          <Section title="Style">
            {colorRow()}
            <SettingsRow icon="ncChartStyle" label="More style settings" disabled={ro} onClick={styleMenu} />
          </Section>
        </>
      ) : (
        <>
          <Section title="X axis">{isBar ? valueRows : categoryRows}</Section>
          <Section title="Y axis">{isBar ? categoryRows : valueRows}</Section>
          <Section title="Style">
            {colorRow()}
            <SettingsRow icon="ncChartStyle" label="More style settings" disabled={ro} onClick={styleMenu} />
          </Section>
        </>
      )}
      <Section divider>
        <SettingsRow icon="databaseEmbed" label="Database" value={collectionName(collection)} chevron={false} />
        <SettingsRow icon="filter" label="Filter" onClick={() => go('filter')} />
        <SettingsRow icon="archive" label="Show archived entries" chevron={false} disabled />
      </Section>
      <Section divider>
        {cfg.type !== 'number' && (
          <SettingsRow icon="download" label="Store chart as…" chevron={false} onClick={() => exportChart()} />
        )}
        <SettingsRow icon="link" label="Copy link to layout" chevron={false} onClick={() => { void navigator.clipboard?.writeText(viewLink(block, view.id)); useUI.getState().toast('Copied link to view'); }} />
      </Section>
      <Section divider>
        {HELP_URL && <SettingsRow icon="questionMarkCircle" label="Explore charts" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
      </Section>
    </>
  );
}

function TitleInput({ value, placeholder, disabled, onChange }: { value: string; placeholder: string; disabled: boolean; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="nc-chart-title-input" data-menu-keys="ignore">
      <input className="nc-input-el" value={v} placeholder={placeholder} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onChange(v.trim())} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

function RangeEditor({ min, max, onChange, onReset }: { min?: number; max?: number; onChange: (min?: number, max?: number) => void; onReset: () => void }) {
  const [lo, setLo] = useState(min === undefined ? '' : String(min));
  const [hi, setHi] = useState(max === undefined ? '' : String(max));
  const commit = (l: string, h: string) => {
    const a = l.trim() === '' ? undefined : Number(l);
    const b = h.trim() === '' ? undefined : Number(h);
    onChange(Number.isFinite(a as number) ? a : undefined, Number.isFinite(b as number) ? b : undefined);
  };
  return (
    <div className="nc-chart-range" data-menu-keys="ignore">
      <div className="nc-menu-section-title">Choose a custom range</div>
      <div className="nc-chart-range-row">
        <input className="nc-input-el" inputMode="decimal" placeholder="Min" value={lo} onChange={(e) => setLo(e.target.value)} onBlur={() => commit(lo, hi)} />
        <span>–</span>
        <input className="nc-input-el" inputMode="decimal" placeholder="Max" value={hi} onChange={(e) => setHi(e.target.value)} onBlur={() => commit(lo, hi)} />
      </div>
      <div role="button" className="nc-chart-range-reset" onClick={onReset}>Reset</div>
    </div>
  );
}

function RefLinesEditor({ lines, onChange }: { lines: ReferenceLine[]; onChange: (lines: ReferenceLine[]) => void }) {
  const [list, setList] = useState<ReferenceLine[]>(lines);
  const update = (next: ReferenceLine[]) => {
    setList(next);
    onChange(next);
  };
  return (
    <div className="nc-chart-refs" data-menu-keys="ignore">
      <div className="nc-menu-section-title">Reference lines</div>
      {!list.length && <div className="nc-chart-refs-empty">Reference lines mark targets and thresholds on a chart.</div>}
      {list.map((r, i) => (
        <div key={r.id} className="nc-chart-ref">
          <input className="nc-input-el" style={{ width: 70 }} inputMode="decimal" placeholder="Value" defaultValue={String(r.value)} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) update(list.map((x, j) => (j === i ? { ...x, value: v } : x))); }} />
          <input className="nc-input-el" placeholder="Label" defaultValue={r.label} onBlur={(e) => update(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <div role="button" className="nc-chart-ref-color" aria-label="Color" onClick={(e) => openNestedMenu(e.currentTarget, { width: 180, sections: [{ items: REF_COLORS.map((c) => ({ id: c, label: c === 'gray' ? 'Black' : c[0].toUpperCase() + c.slice(1), icon: <Swatch color={chartColorVar(c)} />, checked: r.color === c, onSelect: () => update(list.map((x, j) => (j === i ? { ...x, color: c } : x))) })) }] })}><Swatch color={chartColorVar(r.color)} /></div>
          <div role="button" className="nc-chart-ref-style" onClick={() => update(list.map((x, j) => (j === i ? { ...x, dashStyle: x.dashStyle === 'Dash' ? 'Solid' : 'Dash' } : x)))}>{r.dashStyle === 'Dash' ? 'Dash' : 'Solid'}</div>
          <div role="button" className="nc-chart-ref-del" aria-label="Delete" onClick={() => update(list.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></div>
        </div>
      ))}
      {list.length < 10 ? (
        <div role="button" className="nc-chart-ref-add" onClick={() => update([...list, { id: crypto.randomUUID(), value: 0, label: '', color: 'gray', dashStyle: 'Dash' }])}><Icon name="plus" size={14} />Create a reference line</div>
      ) : <div className="nc-chart-refs-empty">This chart allows up to 10 reference lines</div>}
    </div>
  );
}

