// Chart view: vertical bar, horizontal bar, line, donut, or number, drawn as SVG.
// Charts render with Highcharts and use rounded bars.
// ends, dotted var(--lp-border-primary) grid, 12px var(--lp-text-secondary) labels, 5 ticks, data labels on top, legend "— Tags"
// for lines, donut ring 20px with "1 (12.5%)" outside labels + center total, number chart title + big value.
// Colors: option colors → accent-secondary tokens; "No X" groups → light grey; themes Auto/Colorful/single.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, PropertySchema } from '@nc/shared/records.ts';
import { registerView, registerViewSettingsMain, type ViewProps } from '../../viewRegistry.ts';
import { viewCreationHooks } from '../../actions.ts';
import { makeQueryContext } from '../../data.ts';
import { useViewKit } from '../../advanced/viewKit.tsx';
import {
  CHART_HEIGHT, chartConfigOf, chartSavedGroupsOf, computeChart, defaultChartConfig, formatTick, niceTicks, pointColor, seriesColor, chartColorVar,
  type ChartConfig, type ChartData, type ChartPoint,
} from './chartModel.ts';
import { ChartSettingsMain } from './ChartSettings.tsx';
import { openChartDrilldown } from './ChartDrilldown.tsx';
import './chart.css';

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(s: string, px = 12, weight = 400): number {
  if (typeof document === 'undefined') return s.length * px * 0.55;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * px * 0.55;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  measureCtx.font = `${weight} ${px}px ${family}`;
  return measureCtx.measureText(s).width;
}

function truncate(s: string, maxW: number, px = 12): string {
  if (textWidth(s, px) <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${s.slice(0, mid)}…`, px) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${s.slice(0, lo)}…` : '…';
}

interface Tip { x: number; y: number; title: string; lines: { color?: string; label: string; value: string }[] }

interface ChartProps {
  data: ChartData;
  cfg: ChartConfig;
  width: number;
  height: number;
  hasOptionColors: boolean;
  stackHasOptionColors: boolean;
  onTip: (t: Tip | null) => void;
  onPick: (p: ChartPoint, e: React.MouseEvent) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** legend items switched off by a click (series keys / donut slice keys; not saved, Highcharts) */
  legendOff: Set<string>;
  onLegend: (key: string) => void;
}

/** "Color by value": with a single-color theme, larger values are drawn darker. */
function weightOpacity(cfg: ChartConfig, values: number[]): (v: number) => number | undefined {
  const fmt = cfg.chartFormat ?? {};
  const theme = fmt.colorTheme ?? 'auto';
  if (!fmt.weightColorValue || theme === 'auto' || theme === 'colorful' || !values.length) return () => undefined;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (v) => (hi === lo ? 1 : Math.round((0.3 + (0.7 * (v - lo)) / (hi - lo)) * 100) / 100);
}

/** Rounded-end bar path (radius on the value end only). */
function barPath(x: number, y: number, w: number, h: number, r: number, horizontal: boolean, negative: boolean): string {
  if (w <= 0 || h <= 0) return '';
  const rr = Math.min(r, horizontal ? h / 2 : w / 2, horizontal ? w : h);
  if (!horizontal && !negative) return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
  if (!horizontal && negative) return `M${x},${y} V${y + h - rr} Q${x},${y + h} ${x + rr},${y + h} H${x + w - rr} Q${x + w},${y + h} ${x + w},${y + h - rr} V${y} Z`;
  if (horizontal && !negative) return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
  return `M${x + w},${y} H${x + rr} Q${x},${y} ${x},${y + rr} V${y + h - rr} Q${x},${y + h} ${x + rr},${y + h} H${x + w} Z`;
}

function Legend({ items, y, width, off, onToggle }: { items: { key?: string; label: string; color: string; line?: boolean }[]; y: number; width: number; off?: Set<string>; onToggle?: (key: string) => void }) {
  const widths = items.map((it) => (it.line ? 16 : 8) + 6 + textWidth(it.label, 14));
  const total = widths.reduce((a, w) => a + w, 0) + Math.max(0, items.length - 1) * 24;
  let x = Math.max(0, (width - total) / 2);
  return (
    <g className="nc-chart-legend">
      {items.map((it, i) => {
        const x0 = x;
        x += widths[i] + 24;
        // clicking a legend item hides / shows that group 
        const toggle = it.key !== undefined && onToggle ? () => onToggle(it.key!) : undefined;
        const isOff = !!it.key && !!off?.has(it.key);
        return (
          <g key={i} transform={`translate(${x0},${y})`} className={`nc-chart-legend-item ${toggle ? 'toggle' : ''} ${isOff ? 'off' : ''}`} data-legend-key={it.key} onClick={toggle} role={toggle ? 'button' : undefined} aria-pressed={toggle ? !isOff : undefined}>
            <rect x={-4} y={-11} width={widths[i] + 8} height={22} fill="transparent" />
            {it.line ? <line x1={0} x2={14} y1={0} y2={0} stroke={it.color} strokeWidth={2} /> : <rect x={0} y={-4} width={8} height={8} rx={2} fill={it.color} />}
            <text x={it.line ? 20 : 14} y={0} dy="0.35em" className="nc-chart-legend-text">{it.label}</text>
          </g>
        );
      })}
    </g>
  );
}

function axisLabelFlags(cfg: ChartConfig) {
  const l = cfg.chartFormat?.axisLabel ?? 'none';
  return { x: l === 'both' || l === 'x_axis', y: l === 'both' || l === 'y_axis' };
}

/** Vertical bar + line charts (shared category axis along x). */
function CategoryChart({ data: all, cfg, width, height, hasOptionColors, stackHasOptionColors, onTip, onPick, svgRef, legendOff, onLegend }: ChartProps) {
  const fmt = cfg.chartFormat ?? {};
  const isLine = cfg.type === 'line';
  // series switched off in the legend count as empty (their legend item stays, dimmed)
  const data = legendOff.size && all.series.length ? withoutSeries(all, legendOff) : all;
  const stacked = data.series.length > 0;
  const groupStyle = fmt.axisGroupStyle ?? 'normal';
  const percent = stacked && groupStyle === 'percent';
  const side = stacked && groupStyle === 'side_by_side';
  const showLabels = fmt.axisShowDataLabels !== false;
  const grid = fmt.axisGridLine ?? 'horizontal';
  const names = axisLabelFlags(cfg);
  let values = data.points.map((p) => p.value);
  if (isLine && fmt.axisCumulative) {
    let acc = 0;
    values = values.map((v) => (acc += v));
  }
  const seriesVals = stacked ? data.points.map((p) => (p.parts ?? []).map((s) => (percent ? (p.value ? s.value / p.value : 0) : s.value))) : [];
  const maxV = percent ? 1 : side ? Math.max(0, ...seriesVals.flat()) : stacked && isLine ? Math.max(0, ...seriesVals.flat()) : Math.max(0, ...values);
  const minV = Math.min(0, ...(stacked ? seriesVals.flat() : values));
  let ticks = niceTicks(minV, maxV, data.integer && !percent);
  if (fmt.yAxisMin !== undefined || fmt.yAxisMax !== undefined) {
    const lo = fmt.yAxisMin ?? ticks[0];
    const hi = fmt.yAxisMax ?? ticks[ticks.length - 1];
    ticks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);
  }
  const tMin = ticks[0];
  const tMax = ticks[ticks.length - 1];
  const tickText = ticks.map((t) => (percent ? `${Math.round(t * 100)}%` : formatTick(t, data.numberFormat)));
  const legendItems = stacked
    ? data.series.map((s, i) => ({ key: s.key, label: s.label, color: seriesColor(fmt.colorTheme, i, s.color, s.uncategorized), line: isLine }))
    : isLine ? [{ label: data.xName, color: seriesColor(fmt.colorTheme === 'auto' || !fmt.colorTheme ? 'blue' : fmt.colorTheme, 0, undefined, false), line: true }] : [];
  const weight = weightOpacity(cfg, data.points.map((p) => p.value));
  const showLegend = legendItems.length > 0 && !fmt.hideLegend && fmt.legendPosition !== 'off';
  const legendH = showLegend ? 36 : 0;
  const top = 28;
  const bottom = 29 + legendH + (names.x ? 22 : 0);
  const left = 10 + Math.ceil(Math.max(...tickText.map((t) => textWidth(t)))) + 14 + (names.y ? 22 : 0);
  const right = 2;
  const plotW = Math.max(10, width - left - right);
  const plotH = Math.max(10, height - top - bottom);
  const n = Math.max(1, data.points.length);
  const slot = plotW / n;
  const y = (v: number) => top + plotH - ((Math.max(tMin, Math.min(tMax, v)) - tMin) / (tMax - tMin || 1)) * plotH;
  const y0 = y(Math.max(tMin, 0));
  const barW = Math.max(2, Math.min(16, slot * (side ? 0.8 / Math.max(1, data.series.length) : 0.6)));
  const lineColor = (i: number) => (stacked ? seriesColor(fmt.colorTheme, i, data.series[i]?.color, !!data.series[i]?.uncategorized) : seriesColor(fmt.colorTheme === 'auto' || !fmt.colorTheme ? 'blue' : fmt.colorTheme, 0, undefined, false));
  const cx = (i: number) => left + slot * i + slot / 2;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 48))));
  const tipFor = (p: ChartPoint, e: React.MouseEvent) => {
    const box = (e.currentTarget as Element).closest('svg')!.getBoundingClientRect();
    onTip({
      x: e.clientX - box.left, y: e.clientY - box.top, title: p.label,
      lines: stacked ? (p.parts ?? []).filter((s) => s.value).map((s) => ({ color: lineColor(data.series.findIndex((x) => x.key === s.key)), label: s.label, value: s.display })) : [{ label: data.yName, value: p.display }],
    });
  };

  const linePath = (pts: { x: number; y: number }[]) => {
    if (!pts.length) return '';
    if (!fmt.smoothLine || pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
    }
    return d;
  };

  return (
    <svg ref={svgRef} className="nc-chart-svg" width={width} height={height} role="img" aria-label="Chart">
      <defs>
        {(isLine ? (stacked ? data.series : [{ key: 'main' }]) : []).map((s, i) => (
          <linearGradient key={s.key} id={`nc-chart-fill-${i}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={lineColor(i)} stopOpacity={0.18} />
            <stop offset="100%" stopColor={lineColor(i)} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {/* grid */}
      {(grid === 'horizontal' || grid === 'both') && ticks.map((t, i) => (i === 0 && t === 0 ? null : <line key={`g${i}`} x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className="nc-chart-grid" />))}
      {(grid === 'vertical' || grid === 'both') && data.points.map((_, i) => <line key={`v${i}`} x1={left + slot * i} x2={left + slot * i} y1={top} y2={top + plotH} className="nc-chart-grid" />)}
      {/* y axis labels */}
      {ticks.map((t, i) => <text key={`t${i}`} x={left - 14 + (names.y ? 0 : 0)} y={y(t)} dy="0.35em" textAnchor="end" className="nc-chart-tick">{tickText[i]}</text>)}
      {names.y && <text transform={`translate(12,${top + plotH / 2}) rotate(-90)`} textAnchor="middle" className="nc-chart-axisname">{data.yName}</text>}
      {/* baseline */}
      <line x1={left} x2={left + plotW} y1={y0} y2={y0} className="nc-chart-axis" />
      {isLine && data.points.map((_, i) => <line key={`k${i}`} x1={left + slot * (i + 1)} x2={left + slot * (i + 1)} y1={top + plotH} y2={top + plotH + 5} className="nc-chart-axis" />)}
      {/* reference lines */}
      {(fmt.referenceLines ?? []).map((r) => (
        <g key={r.id} className="nc-chart-refline">
          <line x1={left} x2={left + plotW} y1={y(r.value)} y2={y(r.value)} stroke={chartColorVar(r.color === 'gray' ? 'gray' : r.color)} strokeDasharray={r.dashStyle === 'Dash' ? '6 4' : undefined} strokeWidth={1.5} />
          {r.label && <text x={left + plotW - 4} y={y(r.value) - 6} textAnchor="end" className="nc-chart-tick">{r.label}</text>}
        </g>
      ))}
      {/* series */}
      {!isLine && data.points.map((p, i) => {
        if (stacked && !side) {
          let accPos = 0;
          let accNeg = 0;
          return (
            <g key={p.key} className="nc-chart-point" onMouseMove={(e) => tipFor(p, e)} onMouseLeave={() => onTip(null)} onClick={(e) => onPick(p, e)}>
              <rect x={cx(i) - slot / 2} y={top} width={slot} height={plotH} fill="transparent" />
              {(p.parts ?? []).map((s, si) => {
                const v = percent ? (p.value ? s.value / p.value : 0) : s.value;
                if (!v) return null;
                const from = v >= 0 ? accPos : accNeg;
                const to = from + v;
                if (v >= 0) accPos = to; else accNeg = to;
                const ya = y(from);
                const yb = y(to);
                const isTop = (p.parts ?? []).slice(si + 1).every((x) => !x.value);
                return <path key={s.key} d={isTop ? barPath(cx(i) - barW / 2, Math.min(ya, yb), barW, Math.abs(yb - ya), 2, false, v < 0) : `M${cx(i) - barW / 2},${Math.min(ya, yb)} h${barW} v${Math.abs(yb - ya)} h${-barW} Z`} fill={seriesColor(fmt.colorTheme, si, s.color, !!data.series[si]?.uncategorized)} />;
              })}
              {showLabels && p.value !== 0 && <text x={cx(i)} y={y(percent ? 1 : accPos) - 7} textAnchor="middle" className="nc-chart-label">{percent ? '100%' : p.display}</text>}
            </g>
          );
        }
        if (side) {
          const k = data.series.length;
          return (
            <g key={p.key} className="nc-chart-point" onMouseMove={(e) => tipFor(p, e)} onMouseLeave={() => onTip(null)} onClick={(e) => onPick(p, e)}>
              <rect x={cx(i) - slot / 2} y={top} width={slot} height={plotH} fill="transparent" />
              {(p.parts ?? []).map((s, si) => {
                const bx = cx(i) - (k * barW) / 2 + si * barW;
                const yb = y(s.value);
                return (
                  <g key={s.key}>
                    <path d={barPath(bx + 1, Math.min(yb, y0), barW - 2, Math.abs(y0 - yb), 2, false, s.value < 0)} fill={seriesColor(fmt.colorTheme, si, s.color, !!data.series[si]?.uncategorized)} />
                    {showLabels && s.value !== 0 && <text x={bx + barW / 2} y={yb - 7} textAnchor="middle" className="nc-chart-label">{s.display}</text>}
                  </g>
                );
              })}
            </g>
          );
        }
        const yb = y(p.value);
        return (
          <g key={p.key} className="nc-chart-point" onMouseMove={(e) => tipFor(p, e)} onMouseLeave={() => onTip(null)} onClick={(e) => onPick(p, e)}>
            <rect x={cx(i) - slot / 2} y={top} width={slot} height={plotH} fill="transparent" />
            <path d={barPath(cx(i) - barW / 2, Math.min(yb, y0), barW, Math.abs(y0 - yb), 2, false, p.value < 0)} fill={pointColor(fmt.colorTheme, i, p.color, p.uncategorized, hasOptionColors)} fillOpacity={weight(p.value)} />
            {showLabels && <text x={cx(i)} y={p.value < 0 ? yb + 16 : yb - 7} textAnchor="middle" className="nc-chart-label">{p.display}</text>}
          </g>
        );
      })}
      {isLine && (stacked ? data.series.map((s, si) => ({ key: s.key, vals: data.points.map((p) => p.parts?.[si]?.value ?? 0), si })) : [{ key: 'main', vals: values, si: 0 }]).map(({ key, vals, si }) => {
        const pts = vals.map((v, i) => ({ x: cx(i), y: y(v) }));
        const d = linePath(pts);
        return (
          <g key={key}>
            {!fmt.hideLineFillArea && pts.length > 0 && <path d={`${d} L${pts[pts.length - 1].x},${y0} L${pts[0].x},${y0} Z`} fill={`url(#nc-chart-fill-${si})`} />}
            <path d={d} fill="none" stroke={lineColor(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {pts.length === 1 && <circle cx={pts[0].x} cy={pts[0].y} r={3} fill={lineColor(si)} />}
            {showLabels && vals.map((v, i) => <text key={i} x={pts[i].x} y={pts[i].y - 9} textAnchor="middle" className="nc-chart-label">{stacked ? data.points[i].parts?.[si]?.display : (fmt.axisCumulative ? formatTick(v, data.numberFormat) : data.points[i].display)}</text>)}
          </g>
        );
      })}
      {isLine && data.points.map((p, i) => (
        <rect key={`h${p.key}`} x={cx(i) - slot / 2} y={top} width={slot} height={plotH} fill="transparent" className="nc-chart-point" onMouseMove={(e) => tipFor(p, e)} onMouseLeave={() => onTip(null)} onClick={(e) => onPick(p, e)} />
      ))}
      {/* x labels */}
      {data.points.map((p, i) => (i % labelEvery === 0 ? <text key={`x${p.key}`} x={cx(i)} y={top + plotH + 15} dy="0.35em" textAnchor="middle" className="nc-chart-xlabel">{truncate(p.label, slot * labelEvery - 6)}</text> : null))}
      {names.x && <text x={left + plotW / 2} y={top + plotH + 38} textAnchor="middle" className="nc-chart-axisname">{data.xName}</text>}
      {showLegend && <Legend items={legendItems} y={height - legendH / 2 - 2} width={width} off={legendOff} onToggle={stacked ? onLegend : undefined} />}
    </svg>
  );
}

/** Stacked data with some series switched off: their parts count as zero (totals follow). */
function withoutSeries(data: ChartData, off: Set<string>): ChartData {
  return {
    ...data,
    points: data.points.map((p) => {
      if (!p.parts) return p;
      const parts = p.parts.map((s) => (off.has(s.key) ? { ...s, value: 0, display: '0', rows: [] } : s));
      const value = parts.reduce((a, s) => a + s.value, 0);
      return { ...p, parts, value, display: data.integer ? value.toLocaleString('en-US') : p.display };
    }),
  };
}

/** Horizontal bars: categories along y (labels right-aligned), values along x. */
function BarChart({ data: all, cfg, width, height, hasOptionColors, onTip, onPick, svgRef, legendOff, onLegend }: ChartProps) {
  const fmt = cfg.chartFormat ?? {};
  const data = legendOff.size && all.series.length ? withoutSeries(all, legendOff) : all;
  const stacked = data.series.length > 0;
  const percent = stacked && fmt.axisGroupStyle === 'percent';
  const showLabels = fmt.axisShowDataLabels !== false;
  const grid = fmt.axisGridLine ?? 'horizontal';
  const values = data.points.map((p) => p.value);
  let ticks = niceTicks(Math.min(0, ...values), percent ? 1 : Math.max(0, ...values), data.integer && !percent);
  if (fmt.yAxisMin !== undefined || fmt.yAxisMax !== undefined) {
    const lo = fmt.yAxisMin ?? ticks[0];
    const hi = fmt.yAxisMax ?? ticks[ticks.length - 1];
    ticks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);
  }
  const tMin = ticks[0];
  const tMax = ticks[ticks.length - 1];
  const legendItems = stacked ? data.series.map((s, i) => ({ key: s.key, label: s.label, color: seriesColor(fmt.colorTheme, i, s.color, s.uncategorized) })) : [];
  const weight = weightOpacity(cfg, data.points.map((p) => p.value));
  const showLegend = legendItems.length > 0 && !fmt.hideLegend && fmt.legendPosition !== 'off';
  const legendH = showLegend ? 36 : 0;
  const labelW = Math.min(160, Math.ceil(Math.max(20, ...data.points.map((p) => textWidth(p.label)))));
  const left = 10 + labelW + 16;
  const right = 40;
  const top = 8;
  const bottom = 30 + legendH;
  const plotW = Math.max(10, width - left - right);
  const plotH = Math.max(10, height - top - bottom);
  const n = Math.max(1, data.points.length);
  const slot = plotH / n;
  const barH = Math.max(2, Math.min(16, slot * 0.6));
  const x = (v: number) => left + ((Math.max(tMin, Math.min(tMax, v)) - tMin) / (tMax - tMin || 1)) * plotW;
  const x0 = x(Math.max(tMin, 0));
  const cy = (i: number) => top + slot * i + slot / 2;
  const tipFor = (p: ChartPoint, e: React.MouseEvent) => {
    const box = (e.currentTarget as Element).closest('svg')!.getBoundingClientRect();
    onTip({ x: e.clientX - box.left, y: e.clientY - box.top, title: p.label, lines: stacked ? (p.parts ?? []).filter((s) => s.value).map((s) => ({ label: s.label, value: s.display })) : [{ label: data.yName, value: p.display }] });
  };
  return (
    <svg ref={svgRef} className="nc-chart-svg" width={width} height={height} role="img" aria-label="Chart">
      {(grid === 'horizontal' || grid === 'both') && Array.from({ length: n + 1 }, (_, i) => <line key={`g${i}`} x1={left} x2={left + plotW} y1={top + slot * i} y2={top + slot * i} className="nc-chart-grid" />)}
      {(grid === 'vertical' || grid === 'both') && ticks.map((t, i) => <line key={`v${i}`} x1={x(t)} x2={x(t)} y1={top} y2={top + plotH} className="nc-chart-grid" />)}
      <line x1={x0} x2={x0} y1={top} y2={top + plotH} className="nc-chart-axis" />
      {ticks.map((t, i) => <text key={`t${i}`} x={x(t)} y={top + plotH + 16} dy="0.35em" textAnchor="middle" className="nc-chart-tick">{percent ? `${Math.round(t * 100)}%` : formatTick(t, data.numberFormat)}</text>)}
      {(fmt.referenceLines ?? []).map((r) => (
        <g key={r.id}>
          <line x1={x(r.value)} x2={x(r.value)} y1={top} y2={top + plotH} stroke={chartColorVar(r.color)} strokeDasharray={r.dashStyle === 'Dash' ? '6 4' : undefined} strokeWidth={1.5} />
          {r.label && <text x={x(r.value) + 4} y={top + 10} className="nc-chart-tick">{r.label}</text>}
        </g>
      ))}
      {data.points.map((p, i) => (
        <g key={p.key} className="nc-chart-point" onMouseMove={(e) => tipFor(p, e)} onMouseLeave={() => onTip(null)} onClick={(e) => onPick(p, e)}>
          <rect x={left} y={cy(i) - slot / 2} width={plotW} height={slot} fill="transparent" />
          <text x={left - 14} y={cy(i)} dy="0.35em" textAnchor="end" className="nc-chart-xlabel">{truncate(p.label, labelW)}</text>
          {stacked ? (() => {
            let acc = 0;
            return (p.parts ?? []).map((s, si) => {
              const v = percent ? (p.value ? s.value / p.value : 0) : s.value;
              if (!v) return null;
              const xa = x(acc);
              acc += v;
              const xb = x(acc);
              const last = (p.parts ?? []).slice(si + 1).every((q) => !q.value);
              return <path key={s.key} d={last ? barPath(xa, cy(i) - barH / 2, xb - xa, barH, 2, true, false) : `M${xa},${cy(i) - barH / 2} h${xb - xa} v${barH} h${xa - xb} Z`} fill={seriesColor(fmt.colorTheme, si, s.color, !!data.series[si]?.uncategorized)} />;
            });
          })() : <path d={barPath(Math.min(x(p.value), x0), cy(i) - barH / 2, Math.abs(x(p.value) - x0), barH, 2, true, p.value < 0)} fill={pointColor(fmt.colorTheme, i, p.color, p.uncategorized, hasOptionColors)} fillOpacity={weight(p.value)} />}
          {showLabels && <text x={(stacked ? x(percent ? 1 : p.value) : x(p.value)) + (p.value < 0 ? -8 : 8)} y={cy(i)} dy="0.35em" textAnchor={p.value < 0 ? 'end' : 'start'} className="nc-chart-label">{percent ? '100%' : p.display}</text>}
        </g>
      ))}
      {showLegend && <Legend items={legendItems} y={height - legendH / 2 - 2} width={width} off={legendOff} onToggle={stacked ? onLegend : undefined} />}
    </svg>
  );
}

function DonutChart({ data, cfg, width, height, hasOptionColors, onTip, onPick, svgRef, legendOff, onLegend }: ChartProps) {
  const fmt = cfg.chartFormat ?? {};
  const allPts = data.points.filter((p) => p.value > 0);
  // slices switched off in the legend leave the ring (legend item stays, dimmed)
  const pts = allPts.filter((p) => !legendOff.has(p.key));
  const total = pts.reduce((a, p) => a + p.value, 0);
  const colorOf = (p: ChartPoint) => pointColor(fmt.colorTheme === 'auto' || !fmt.colorTheme ? (hasOptionColors ? 'auto' : 'colorful') : fmt.colorTheme, data.points.indexOf(p), p.color, p.uncategorized, hasOptionColors);
  const legendItems = allPts.map((p) => ({ key: p.key, label: p.label, color: colorOf(p) }));
  const weight = weightOpacity(cfg, pts.map((p) => p.value));
  const showLegend = !fmt.hideLegend && fmt.legendPosition !== 'off' && allPts.length > 0;
  const legendH = showLegend ? 44 : 0;
  const labelsMode = fmt.donutDataLabels ?? 'value';
  const cx = width / 2;
  const cy = (height - legendH) / 2 + 4;
  const outer = Math.max(30, Math.min(125, (height - legendH) / 2 - 50, width / 2 - 120));
  const inner = outer - Math.max(12, Math.round(outer * 0.155));
  const agg = cfg.dataConfig.type === 'groups_reducer' ? cfg.dataConfig.aggregationConfig.aggregation : { aggregator: 'count' };
  const isCount = (typeof agg.aggregator === 'string' ? agg.aggregator : '') === 'count' && !agg.property;
  const centerValue = isCount ? data.rowCount : total;
  let a0 = -Math.PI / 2;
  const arcs = pts.map((p, i) => {
    const frac = total ? p.value / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const arc = { p, i, a0, a1, frac };
    a0 = a1;
    return arc;
  });
  const pathOf = (s: number, e: number) => {
    if (e - s >= Math.PI * 2 - 1e-6) {
      return `M${cx},${cy - outer} A${outer},${outer} 0 1 1 ${cx - 0.01},${cy - outer} L${cx - 0.01},${cy - inner} A${inner},${inner} 0 1 0 ${cx},${cy - inner} Z`;
    }
    const large = e - s > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    return `M${p(outer, s)} A${outer},${outer} 0 ${large} 1 ${p(outer, e)} L${p(inner, e)} A${inner},${inner} 0 ${large} 0 ${p(inner, s)} Z`;
  };
  const pctText = (f: number) => `${Math.round(f * 1000) / 10}%`;
  const label = (p: ChartPoint, f: number) => (labelsMode === 'name' ? p.label : labelsMode === 'name_and_value' ? `${p.label}: ${p.display} (${pctText(f)})` : `${p.display} (${pctText(f)})`);
  return (
    <svg ref={svgRef} className="nc-chart-svg" width={width} height={height} role="img" aria-label="Chart">
      {arcs.map(({ p, i, a0: s, a1: e, frac }) => {
        const mid = (s + e) / 2;
        const lx1 = cx + (outer + 6) * Math.cos(mid);
        const ly1 = cy + (outer + 6) * Math.sin(mid);
        const lx2 = cx + (outer + 26) * Math.cos(mid);
        const ly2 = cy + (outer + 26) * Math.sin(mid);
        const right = Math.cos(mid) >= 0;
        return (
          <g key={p.key} className="nc-chart-point" onMouseMove={(ev) => {
            const box = (ev.currentTarget as Element).closest('svg')!.getBoundingClientRect();
            onTip({ x: ev.clientX - box.left, y: ev.clientY - box.top, title: p.label, lines: [{ label: data.yName, value: `${p.display} (${pctText(frac)})` }] });
          }} onMouseLeave={() => onTip(null)} onClick={(ev) => onPick(p, ev)}>
            <path d={pathOf(s, e)} fill={colorOf(p)} fillOpacity={weight(p.value)} className="nc-chart-slice" />
            {labelsMode !== 'none' && (
              <>
                <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} className="nc-chart-leader" />
                <text x={lx2 + (right ? 4 : -4)} y={ly2} dy="0.35em" textAnchor={right ? 'start' : 'end'} className="nc-chart-label">{label(p, frac)}</text>
              </>
            )}
          </g>
        );
      })}
      {!fmt.donutHideValue && (
        <g className="nc-chart-donut-center">
          <text x={cx} y={cy - 6} textAnchor="middle" dy="0.35em" className="nc-chart-donut-value" style={{ fontSize: Math.max(20, Math.min(64, inner * 0.62)) }}>{centerValue.toLocaleString('en-US')}</text>
          <text x={cx} y={cy + Math.min(64, inner * 0.62) * 0.55 + 6} textAnchor="middle" dy="0.35em" className="nc-chart-donut-caption">{data.caption}</text>
        </g>
      )}
      {showLegend && <Legend items={legendItems} y={height - legendH / 2} width={width} off={legendOff} onToggle={onLegend} />}
    </svg>
  );
}

const NUMBER_COLOR: Record<string, string> = {
  blue: 'var(--lp-blue-text-accent, var(--lp-blue-bg-accent-secondary))', brown: 'var(--lp-brown-text-accent, var(--lp-brown-bg-accent-secondary))', gray: 'var(--lp-text-secondary)', lightgray: 'var(--lp-text-tertiary)',
  green: 'var(--lp-green-text-accent, var(--lp-green-bg-accent-secondary))', orange: 'var(--lp-orange-text-accent, var(--lp-orange-bg-accent-secondary))', pink: 'var(--lp-pink-text-accent, var(--lp-pink-bg-accent-secondary))',
  purple: 'var(--lp-purple-text-accent, var(--lp-purple-bg-accent-secondary))', red: 'var(--lp-red-text-accent, var(--lp-red-bg-accent-secondary))', yellow: 'var(--lp-yellow-text-accent, var(--lp-yellow-bg-accent-secondary))',
};

function NumberChart({ data, cfg, height }: { data: ChartData; cfg: ChartConfig; height: number }) {
  const fmt = cfg.chartFormat ?? {};
  const num = data.number;
  const title = fmt.valueLabel || num?.title || '';
  const size = Math.max(40, Math.min(120, height * 0.19));
  return (
    <div className="nc-chart-number" style={{ height }}>
      {!fmt.hideTitle && <div className="nc-chart-number-title">{title}</div>}
      <div className="nc-chart-number-value" style={{ fontSize: size, color: fmt.numberColor ? NUMBER_COLOR[fmt.numberColor] : undefined }}>{num?.value === null || !num ? 'No data' : num.display}</div>
      {fmt.showCaption && fmt.caption && <div className="nc-chart-number-caption">{fmt.caption}</div>}
    </div>
  );
}

function ChartView(props: ViewProps) {
  const kit = useViewKit(props);
  const { view, collection } = kit;
  const schema = collection.schema;
  const cfg = useMemo(() => chartConfigOf(view.format as Record<string, unknown> | undefined, schema), [view.format, schema]);
  const ctx = makeQueryContext();
  // hidden groups (View settings › X axis / Data › Hidden groups) stay out of the chart
  const saved = useMemo(() => chartSavedGroupsOf(view.format as Record<string, unknown> | undefined), [view.format]);
  const data = useMemo(() => computeChart(kit.rows, cfg, schema, ctx, saved), [kit.rows, cfg, schema, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [legendOff, setLegendOff] = useState<Set<string>>(() => new Set());
  const onLegend = (key: string) => setLegendOff((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [tip, setTip] = useState<Tip | null>(null);
  const bleed = kit.db?.bleed ?? { left: 0, right: 0 };
  const height = CHART_HEIGHT[cfg.chartFormat?.height ?? 'medium'];

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.floor(el.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gbProp: PropertySchema | undefined = cfg.dataConfig.type === 'groups_reducer' ? schema[cfg.dataConfig.groupBy.property] : undefined;
  const hasOptionColors = !!gbProp && ['select', 'multi_select', 'status'].includes(gbProp.type);
  const stackProp = cfg.dataConfig.type === 'groups_reducer' ? schema[cfg.dataConfig.aggregationConfig.stackOptions?.groupBy?.property ?? ''] : undefined;
  const stackHasOptionColors = !!stackProp && ['select', 'multi_select', 'status'].includes(stackProp.type);

  // clicking a bar / slice / point opens its drilldown: the pages behind it as a table 
  const onPick = (p: ChartPoint, e: React.MouseEvent) => {
    const rows: BlockRecord[] = p.rows;
    if (!rows.length) return;
    void e;
    setTip(null);
    openChartDrilldown({ point: p, data, cfg, block: kit.block, view, collection, openRow: (id) => kit.openRow(id) });
  };

  let body: ReactNode;
  if (data.kind === 'error') body = <div className="nc-chart-error" style={{ height }}>{data.error}</div>;
  else if (cfg.type === 'number') body = <NumberChart data={data} cfg={cfg} height={height} />;
  else if (!kit.rows.length || !data.points.length) body = <div className="nc-chart-error" style={{ height }}>No data</div>;
  else {
    const p: ChartProps = { data, cfg, width, height, hasOptionColors, stackHasOptionColors, onTip: setTip, onPick, svgRef, legendOff, onLegend };
    body = cfg.type === 'bar' ? <BarChart {...p} /> : cfg.type === 'donut' ? <DonutChart {...p} /> : <CategoryChart {...p} />;
  }

  return (
    <div className="nc-chart lit-chart-view" data-chart-type={cfg.type} data-chart-view-id={view.id} style={{ paddingInlineStart: bleed.left ? bleed.left + 8 : 0, paddingInlineEnd: bleed.right ? bleed.right + 8 : 0 }}>
      <div className="nc-chart-box" ref={boxRef}>
        {body}
        {tip && (
          <div className="nc-chart-tip" style={{ left: Math.min(tip.x + 12, width - 180), top: Math.max(0, tip.y - 12) }}>
            <div className="nc-chart-tip-title">{tip.title}</div>
            {tip.lines.map((l, i) => (
              <div key={i} className="nc-chart-tip-line">
                {l.color && <span className="sw" style={{ background: l.color }} />}
                <span className="lbl">{l.label}</span>
                <span className="val">{l.value}</span>
              </div>
            ))}
            <div className="nc-chart-tip-hint">Click to inspect data</div>
          </div>
        )}
      </div>
    </div>
  );
}

registerView('chart', ChartView);
registerViewSettingsMain('chart', ChartSettingsMain);

/** New chart views use a default chart_config and flattened subitems. */
viewCreationHooks.chart = (tx, viewId, collection) => {
  tx.update('collection_view', viewId, ['format'], { chart_config: defaultChartConfig(collection.schema), subitem_display_mode: 'flattened' });
};
