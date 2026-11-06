
// original order; numbers and dates sort by value), filter long tables, copy as CSV, and "Save as database" turns the
// table into a private database (aiTableToDatabase). While the answer streams the table stays static.
import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { api } from '../../lib/api.ts';
import { openPage } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { parseInline } from './md.ts';


function plain(md: string): string {
  return parseInline(md).map((s) => (s.cite ? '' : s.text)).join('').trim();
}

function sortKey(v: string): { n: number | null; s: string } {
  const t = v.replace(/[,$€£₩¥%\s]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) return { n: Number(t), s: v.toLowerCase() };
  const d = /^\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : NaN;
  return { n: Number.isNaN(d) ? null : d, s: v.toLowerCase() };
}

function csv(rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export function AiTable({ header, rows, streaming, render }: { header: string[]; rows: string[][]; streaming?: boolean; render: (md: string) => ReactNode }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const plainRows = useMemo(() => rows.map((r) => header.map((_, i) => plain(r[i] ?? ''))), [rows, header]);
  const order = useMemo(() => {
    let idx = rows.map((_, i) => i);
    const ql = q.trim().toLowerCase();
    if (ql) idx = idx.filter((i) => plainRows[i].some((c) => c.toLowerCase().includes(ql)));
    if (sort) {
      idx = [...idx].sort((a, b) => {
        const x = sortKey(plainRows[a][sort.col] ?? '');
        const y = sortKey(plainRows[b][sort.col] ?? '');
        const c = x.n !== null && y.n !== null ? x.n - y.n : x.s.localeCompare(y.s, undefined, { numeric: true });
        return c * sort.dir;
      });
    }
    return idx;
  }, [rows, plainRows, sort, q]);
  const interactive = !streaming;
  const toggleSort = (col: number) => {
    if (!interactive) return;
    setSort((cur) => (!cur || cur.col !== col ? { col, dir: 1 } : cur.dir === 1 ? { col, dir: -1 } : null));
  };
  const copy = () => {
    void navigator.clipboard?.writeText(csv([header.map(plain), ...order.map((i) => plainRows[i])])).catch(() => {});
    useUI.getState().toast('Copied table as CSV');
  };
  const save = async () => {
    const spaceId = useSession.getState().spaceId;
    if (!spaceId || busy) return;
    setBusy(true);
    try {
      const r = await api<{ pageId: string; rows: number }>('aiTableToDatabase', { spaceId, header: header.map(plain), rows: order.map((i) => plainRows[i]) });
      useUI.getState().toast(`Saved as a database with ${r.rows} row${r.rows === 1 ? '' : 's'}`, { label: 'Open', run: () => openPage(r.pageId) });
    } catch (e) {
      useUI.getState().toast((e as Error)?.message || 'Couldn’t save the table.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nc-ai-table-wrap" data-testid="ai-table">
      {interactive && (
        <div className="nc-ai-table-tools">
          {rows.length > 8 && (
            <div className="nc-ai-table-filter">
              <Icon name="search" size={12} />
              <input value={q} placeholder="Filter" aria-label="Filter rows" onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <span className="nc-ai-table-count">{order.length === rows.length ? `${rows.length} row${rows.length === 1 ? '' : 's'}` : `${order.length} of ${rows.length} rows`}</span>
          <div role="button" className="nc-ai-table-btn" aria-label="Copy table as CSV" data-tooltip="Copy as CSV" onClick={copy}><Icon name="duplicate" size={14} /></div>
          <div role="button" className="nc-ai-table-btn" aria-disabled={busy} data-testid="ai-table-save" data-tooltip="Save as database" aria-label="Save as database" onClick={() => void save()}><Icon name="viewTable" size={14} /><span>Save as database</span></div>
        </div>
      )}
      <table className="nc-ai-table">
        <thead>
          <tr>
            {header.map((c, i) => (
              <th key={i} aria-sort={sort?.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className={interactive ? 'sortable' : undefined} onClick={() => toggleSort(i)}>
                <span className="nc-ai-th">
                  {render(c)}
                  {sort?.col === i && <Icon name={sort.dir === 1 ? 'arrowUp' : 'arrowDown'} size={12} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((ri) => (
            <tr key={ri}>{header.map((_, ci) => <td key={ci}>{render(rows[ri][ci] ?? '')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
