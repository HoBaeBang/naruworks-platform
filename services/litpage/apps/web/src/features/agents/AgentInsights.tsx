
// (runs, completion rate, credits, average credits per run, active users), runs per day by outcome, credits per day
// and runs by trigger — then "All chats" (status, trigger, user, credits, model) with Export as CSV (Full access).
// Charts: one axis, thin bars with 2px gaps and 4px rounded tops, recessive grid, hover tooltips, a legend for the
// stacked series, status colors only for outcomes, and a table view of every chart.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { formatDateTime, timeAgo } from '../../lib/format.ts';
import { t } from '../shell/i18n.ts';
import { agentApi, toastError, type AgentDetail, type RunJson } from './agentsApi.ts';
import { runTitle, StatusChip } from './AgentActivity.tsx';

interface InsightsData {
  totalRuns: number;
  byStatus: Record<string, number>;
  byTrigger: { label: string; count: number }[];
  totalCredits: number;
  avgCredits: number;
  activeUsers: number;
  completionRate: number;
  days: { day: string; runs: number; credits: number; failed: number; success: number; users: number }[];
  period: number;
  chats: RunJson[];
}

const PERIODS = [7, 30, 90] as const;

function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

interface Series { id: string; label: string; color: string; values: number[] }


function BarChart({ days, series, unit, testId }: { days: string[]; series: Series[]; unit: (n: number) => string; testId: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 168;
  const pad = { l: 32, r: 4, t: 8, b: 22 };
  const totals = days.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = H - pad.t - pad.b;
  const slot = days.length ? plotW / days.length : 0;
  const barW = Math.max(2, Math.min(24, slot - Math.max(2, slot * 0.3)));
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 64))));
  return (
    <div ref={ref} className="nc-agent-chart" data-testid={testId} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={series.map((s) => s.label).join(', ')}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="nc-agent-chart-grid" />
              <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" className="nc-agent-chart-tick">{Number.isInteger(v) ? v : v.toFixed(1)}</text>
            </g>
          ))}
          {days.map((day, i) => {
            const cx = pad.l + slot * i + slot / 2;
            let base = 0;
            const segs = series.map((s) => ({ s, v: s.values[i] ?? 0 })).filter((x) => x.v > 0);
            return (
              <g key={day}>
                {segs.map(({ s, v }, j) => {
                  const top = y(base + v);
                  const bottom = y(base);
                  base += v;
                  const last = j === segs.length - 1;
                  // 2px surface gap between stacked segments; the top segment gets the 4px rounded data-end
                  const h = Math.max(1, bottom - top - (j > 0 ? 2 : 0));
                  const yy = top;
                  const r = last ? Math.min(4, h, barW / 2) : 0;
                  const x0 = cx - barW / 2;
                  const d = r > 0
                    ? `M${x0},${yy + h}V${yy + r}Q${x0},${yy} ${x0 + r},${yy}H${x0 + barW - r}Q${x0 + barW},${yy} ${x0 + barW},${yy + r}V${yy + h}Z`
                    : `M${x0},${yy + h}V${yy}H${x0 + barW}V${yy + h}Z`;
                  return <path key={s.id} d={d} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.55} />;
                })}
                {i % labelEvery === 0 && <text x={cx} y={H - 6} textAnchor="middle" className="nc-agent-chart-tick">{dayLabel(day)}</text>}
                <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
          <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} className="nc-agent-chart-axis" />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="nc-agent-chart-tip" role="tooltip" style={{ left: Math.min(width - 170, Math.max(0, pad.l + slot * hover + slot / 2 - 80)) }}>
          <div className="ttl">{dayLabel(days[hover], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          {series.map((s) => (
            <div key={s.id} className="row">
              {series.length > 1 && <span className="sw" style={{ background: s.color }} />}
              <span className="lbl">{s.label}</span>
              <span className="val">{unit(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="nc-agent-legend">
      {series.map((s) => (
        <span key={s.id} className="item"><span className="sw" style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}


function HBars({ rows }: { rows: { label: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="nc-agent-hbars" data-testid="agent-insights-triggers" onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => (
        <div key={r.label} className="nc-agent-hbar" onMouseEnter={() => setHover(i)} title={`${r.label}: ${r.count}`}>
          <span className="lbl nc-ellipsis">{r.label}</span>
          <span className="track">
            <span className="bar" style={{ width: `${Math.max(2, (r.count / max) * 100)}%`, opacity: hover === null || hover === i ? 1 : 0.55 }} />
          </span>
          <span className="val">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function DataTable({ days, series, unit }: { days: string[]; series: Series[]; unit: (n: number) => string }) {
  return (
    <div className="nc-agent-table-wrap">
      <table className="nc-agent-table">
        <thead><tr><th>{t('lp.agents.date', 'Date')}</th>{series.map((s) => <th key={s.id}>{s.label}</th>)}</tr></thead>
        <tbody>
          {days.map((d, i) => <tr key={d}><td>{dayLabel(d, { year: 'numeric', month: 'short', day: 'numeric' })}</td>{series.map((s) => <td key={s.id}>{unit(s.values[i] ?? 0)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export function AgentInsights({ d }: { d: AgentDetail }) {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    agentApi.insights(d.agent.id, days)
      .then((r: InsightsData) => alive && setData(r))
      .catch((e: Error) => alive && setError(e?.message || 'error'));
    return () => {
      alive = false;
    };
  }, [d.agent.id, days]);
  const series = useMemo(() => {
    if (!data) return null;
    const success = data.days.map((x) => x.success);
    const failed = data.days.map((x) => x.failed);
    const other = data.days.map((x) => Math.max(0, x.runs - x.success - x.failed));
    return {
      runs: [
        { id: 'success', label: t('lp.agents.successful', 'Successful'), color: 'var(--lp-green-icon-accent)', values: success },
        { id: 'other', label: t('lp.agents.other', 'Other'), color: 'var(--lp-blue-icon-accent)', values: other },
        { id: 'failed', label: t('lp.agents.failed_09fe', 'Failed'), color: 'var(--lp-red-icon-accent)', values: failed },
      ] as Series[],
      credits: [{ id: 'credits', label: t('lp.agents.credits', 'Credits'), color: 'var(--lp-blue-icon-accent)', values: data.days.map((x) => x.credits) }] as Series[],
      users: [{ id: 'users', label: t('lp.agents.active_users', 'Active users'), color: 'var(--lp-blue-icon-accent)', values: data.days.map((x) => x.users) }] as Series[],
    };
  }, [data]);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await agentApi.exportCsv(d.agent.id, days);
      const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toastError(e);
    } finally {
      setExporting(false);
    }
  };
  const n = (v: number) => String(v);
  const dayKeys = data?.days.map((x) => x.day) ?? [];
  return (
    <div className="nc-agent-insights" data-testid="agent-insights">
      <div className="nc-agent-insights-head">
        <div className="nc-agent-pills" role="tablist" aria-label={t('lp.agents.period', 'Period')}>
          {PERIODS.map((p) => (
            <div key={p} role="tab" aria-selected={days === p} className={`nc-agent-pill ${days === p ? 'on' : ''}`} data-period={p} onClick={() => setDays(p)}>{t('lp.agents.last_days', 'Last {count} days', { count: p })}</div>
          ))}
        </div>
        <div className="nc-agent-activity-actions">
          <div role="button" aria-pressed={asTable} className={`nc-agent-icon-btn ${asTable ? 'on' : ''}`} aria-label={t('lp.agents.show_as_table', 'Show as table')} data-tooltip={t('lp.agents.show_as_table', 'Show as table')} onClick={() => setAsTable(!asTable)}>
            <Icon name="viewTable" size={16} />
          </div>
          {d.role === 'editor' && (
            <button type="button" className="nc-btn outline small" data-testid="agent-insights-export" disabled={exporting || !d.available} onClick={() => void exportCsv()}>
              <Icon name="download" size={14} />
              <span>{t('lp.agents.export_to_csv', 'Download CSV')}</span>
            </button>
          )}
        </div>
      </div>
      {error && <div className="nc-agent-empty"><div className="ttl">{error}</div></div>}
      {!data && !error && <div className="nc-agent-loading small" aria-busy="true" />}
      {data && series && (
        <>
          <div className="nc-agent-tiles" data-testid="agent-insights-tiles">
            <Tile label={t('lp.agents.total_runs', 'Total runs')} value={String(data.totalRuns)} />
            <Tile label={t('lp.agents.completion_rate', 'Completion rate')} value={data.totalRuns ? `${data.completionRate}%` : '—'} />
            <Tile label={t('lp.agents.total_credits', 'Total credits')} value={String(data.totalCredits)} />
            <Tile label={t('lp.agents.avg_credits_per_run', 'Avg credits per run')} value={data.totalRuns ? String(data.avgCredits) : '—'} />
            <Tile label={t('lp.agents.active_users', 'Active users')} value={String(data.activeUsers)} />
          </div>
          <div className="nc-agent-card">
            <div className="nc-agent-card-head">
              <div className="nc-agent-card-title">{t('lp.agents.runs_per_day', 'Runs per day')}</div>
              <Legend series={series.runs} />
            </div>
            {asTable ? <DataTable days={dayKeys} series={series.runs} unit={n} /> : <BarChart days={dayKeys} series={series.runs} unit={n} testId="agent-insights-runs" />}
          </div>
          <div className="nc-agent-card-grid">
            <div className="nc-agent-card">
              <div className="nc-agent-card-head"><div className="nc-agent-card-title">{t('lp.agents.credits_per_day', 'Credits per day')}</div></div>
              {asTable ? <DataTable days={dayKeys} series={series.credits} unit={n} /> : <BarChart days={dayKeys} series={series.credits} unit={n} testId="agent-insights-credits" />}
            </div>
            <div className="nc-agent-card">
              <div className="nc-agent-card-head"><div className="nc-agent-card-title">{t('lp.agents.active_users_per_day', 'Active users per day')}</div></div>
              {asTable ? <DataTable days={dayKeys} series={series.users} unit={n} /> : <BarChart days={dayKeys} series={series.users} unit={n} testId="agent-insights-users" />}
            </div>
          </div>
          <div className="nc-agent-card">
            <div className="nc-agent-card-head"><div className="nc-agent-card-title">{t('lp.agents.runs_by_trigger', 'Runs by trigger')}</div></div>
            {data.byTrigger.length ? <HBars rows={data.byTrigger} /> : <div className="nc-agent-muted pad">{t('lp.agents.no_runs_in_this_period', 'No runs in this period')}</div>}
          </div>
          <div className="nc-agent-card">
            <div className="nc-agent-card-head"><div className="nc-agent-card-title">{t('lp.agents.all_chats', 'All chats')}</div></div>
            {data.chats.length ? (
              <div className="nc-agent-table-wrap">
                <table className="nc-agent-table" data-testid="agent-insights-chats">
                  <thead>
                    <tr>
                      <th>{t('lp.agents.title', 'Title')}</th>
                      <th>{t('lp.agents.status', 'Status')}</th>
                      <th>{t('lp.agents.trigger', 'Trigger')}</th>
                      <th>{t('lp.agents.user', 'User')}</th>
                      <th className="num">{t('lp.agents.credits', 'Credits')}</th>
                      <th>{t('lp.agents.model', 'Model')}</th>
                      <th>{t('lp.agents.created', 'Created')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.chats.map((r) => (
                      <tr key={r.id}>
                        <td className="nc-ellipsis" style={{ maxWidth: 220 }}>{runTitle(r)}</td>
                        <td><StatusChip r={r} /></td>
                        <td>{r.kind === 'chat' ? t('lp.agents.chat', 'Chat') : r.triggerLabel}</td>
                        <td>{r.actorName || '—'}</td>
                        <td className="num">{r.credits}</td>
                        <td>{r.model ?? '—'}</td>
                        <td title={formatDateTime(r.createdTime)}>{timeAgo(r.createdTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="nc-agent-muted pad">{t('lp.agents.no_runs_in_this_period', 'No runs in this period')}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="nc-agent-tile">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
    </div>
  );
}
