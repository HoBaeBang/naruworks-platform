// Static miniature of a template page (gallery cards): cover, icon, title and the first blocks / database rows,
// drawn from the outline returned by listTemplates (no screenshots needed).
import type { OutlineBlock, OutlineDb, TemplateInfo } from './api.ts';

function MiniDb({ db }: { db: OutlineDb }) {
  if (db.view === 'board') {
    const groups = new Map<string, string[]>();
    const gi = Math.max(1, db.columns.findIndex((c) => c.type === 'status' || c.type === 'select'));
    for (const r of db.rows) {
      const k = r.cells[gi] || '—';
      groups.set(k, [...(groups.get(k) ?? []), r.cells[0]]);
    }
    return (
      <div className="nc-tthumb-board">
        {[...groups].slice(0, 3).map(([g, items]) => (
          <div key={g} className="nc-tthumb-col">
            <span className="nc-tthumb-pill">{g}</span>
            {items.slice(0, 3).map((x, i) => <div key={i} className="nc-tthumb-card">{x}</div>)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="nc-tthumb-table">
      <div className="nc-tthumb-tr head">{db.columns.map((c, i) => <div key={i} className="nc-tthumb-td">{c.name}</div>)}</div>
      {db.rows.slice(0, 5).map((r, ri) => (
        <div key={ri} className="nc-tthumb-tr">
          {r.cells.map((c, ci) => (
            <div key={ci} className="nc-tthumb-td">{ci === 0 && r.icon ? <span className="ico">{r.icon}</span> : null}{c}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MiniBlock({ b }: { b: OutlineBlock }) {
  switch (b.t) {
    case 'header':
      return <div className="nc-tthumb-h1">{b.x}</div>;
    case 'sub_header':
      return <div className="nc-tthumb-h2">{b.x}</div>;
    case 'sub_sub_header':
    case 'header_4':
      return <div className="nc-tthumb-h3">{b.x}</div>;
    case 'to_do':
      return <div className="nc-tthumb-line"><span className={`nc-tthumb-check ${b.c ? 'on' : ''}`} />{b.x}</div>;
    case 'bulleted_list':
      return <div className="nc-tthumb-line"><span className="nc-tthumb-dot" />{b.x}</div>;
    case 'numbered_list':
      return <div className="nc-tthumb-line"><span className="nc-tthumb-num">1.</span>{b.x}</div>;
    case 'toggle':
      return <div className="nc-tthumb-line"><span className="nc-tthumb-tri">▸</span>{b.x}</div>;
    case 'callout':
      return <div className="nc-tthumb-callout">{b.x}</div>;
    case 'quote':
      return <div className="nc-tthumb-quote">{b.x}</div>;
    case 'divider':
      return <div className="nc-tthumb-hr" />;
    case 'page':
      return <div className="nc-tthumb-line link"><span className="ico">{b.i ?? '📄'}</span><u>{b.x}</u></div>;
    case 'table':
      return <div className="nc-tthumb-grid" />;
    case 'column_list':
      return <div className="nc-tthumb-cols"><div /><div /></div>;
    case 'collection_view':
      return b.db ? <MiniDb db={b.db} /> : null;
    default:
      return b.x ? <div className="nc-tthumb-text">{b.x}</div> : <div className="nc-tthumb-gap" />;
  }
}

export function TemplateThumb({ tpl, size = 'md' }: { tpl: TemplateInfo; size?: 'sm' | 'md' | 'lg' }) {
  const o = tpl.outline;
  return (
    <div className={`nc-tthumb ${size}`} aria-hidden>
      {tpl.cover && <div className="nc-tthumb-cover" style={{ backgroundImage: `url("${tpl.cover}")` }} />}
      <div className="nc-tthumb-page">
        <div className="nc-tthumb-icon">{tpl.icon}</div>
        <div className="nc-tthumb-title">{o?.db?.name || tpl.name}</div>
        {o?.db ? <MiniDb db={o.db} /> : (o?.blocks ?? []).slice(0, 12).map((b, i) => <MiniBlock key={i} b={b} />)}
      </div>
    </div>
  );
}
