// Library table: header row 36px with property icons (drag handle on hover,
// resize handle on the right edge), rows 36px + 1px divider, ▶ toggles for sub-pages, hover checkbox and
// "Open" (side peek) button. Metrics: (lit-table-view*).
import { Fragment, useMemo, useRef, useState } from 'react';
import type { BlockRecord, SpaceViewRecord } from '@nc/shared/records.ts';
import { useBlock, useCurrentSpaceView, useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { openPage, openPeek, pageUrl } from '../../../lib/router.ts';
import { Icon } from '../../../components/Icon.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { TeamIcon } from '../../shell/sidebar/TeamIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { t } from '../../shell/i18n.ts';
import {
  COL_ICON, COL_KIND, DEFAULT_WIDTH, colLabel, dateValue, groupOf, libraryTime, personValue, sourceOf, useLibraryViews, userName, userOf,
  type ColKey, type LibView, type PageTab, type Row,
} from './model.ts';
import { LibAvatar, openColumnMenu } from './menus.tsx';
import { subPages, useLibraryPrefetch } from './data.ts';
import { BulkBar } from './BulkBar.tsx';

const SUB_INDENT = 24;

function widthOf(view: LibView, c: ColKey) {
  return view.widths[c] ?? DEFAULT_WIDTH[c];
}

export function LibraryTable({ tab, view, rows, columns, empty }: { tab: PageTab; view: LibView; rows: Row[]; columns: ColKey[]; empty?: React.ReactNode }) {
  const sv = useCurrentSpaceView();
  useTableVersion(['block', 'lit_user', 'team', 'collection']);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [liveWidths, setLiveWidths] = useState<Partial<Record<ColKey, number>>>({});
  const [dragCol, setDragCol] = useState<ColKey | null>(null);
  const [overCol, setOverCol] = useState<ColKey | null>(null);

  const w = (c: ColKey) => liveWidths[c] ?? widthOf(view, c);
  const total = 8 + columns.reduce((n, c) => n + w(c), 0);

  // prefetch sub-page and parent records for visible rows (+ expanded children)
  const visibleIds = useMemo(() => {
    const out: string[] = [];
    const walk = (id: string, depth: number) => {
      out.push(id);
      if (expanded[id] && depth < 6) for (const c of subPages(records.get<BlockRecord>('block', id))) walk(c, depth + 1);
    };
    for (const r of rows.slice(0, 300)) walk(r.id, 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, expanded, records.all('block').length]);
  useLibraryPrefetch(visibleIds);

  const startResize = (c: ColKey, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = w(c);
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = Math.max(c === 'title' ? 140 : 80, Math.round(startW + ev.clientX - startX));
      setLiveWidths((x) => ({ ...x, [c]: last }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useLibraryViews.getState().update(tab, (v) => { v.widths[c] = last; });
      setLiveWidths((x) => {
        const n = { ...x };
        delete n[c];
        return n;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dropColumn = (target: ColKey) => {
    if (!dragCol || dragCol === target || dragCol === 'title') return;
    useLibraryViews.getState().update(tab, (v) => {
      const arr = v.visible.filter((c) => c !== dragCol);
      const i = arr.indexOf(target);
      arr.splice(i < 0 ? arr.length : i, 0, dragCol);
      v.visible = arr;
    });
  };

  const header = (
    <div className="lit-table-view-header-row nc-lib-header" style={{ minWidth: total }}>
      {columns.map((c) => (
        <div
          key={c}
          className={`lit-table-view-header-cell nc-lib-hcell ${overCol === c && dragCol && dragCol !== c ? 'drop-target' : ''}`}
          style={{ width: w(c) }}
          draggable={c !== 'title'}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/x-nc-library-col', c);
            setDragCol(c);
          }}
          onDragEnd={() => {
            setDragCol(null);
            setOverCol(null);
          }}
          onDragOver={(e) => {
            if (!dragCol) return;
            e.preventDefault();
            if (overCol !== c) setOverCol(c);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dropColumn(c);
            setDragCol(null);
            setOverCol(null);
          }}
        >
          <div role="button" aria-haspopup="dialog" className="nc-lib-hbtn" onClick={(e) => openColumnMenu(tab, c, e.currentTarget as HTMLElement)}>
            <div className="nc-lib-hicon">
              <span className="nc-lib-hicon-glyph"><Icon name={COL_ICON[c]} size={16} /></span>
              <span className="nc-lib-hicon-drag"><Icon name="dragHandleFillSmall" size={16} /></span>
            </div>
            <div className="nc-ellipsis">{colLabel(c)}</div>
            {view.sort?.col === c && <Icon name={view.sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={14} style={{ color: 'var(--lp-icon-secondary)', marginInlineStart: 2 }} />}
          </div>
          <div className="nc-lib-resize" onPointerDown={(e) => startResize(c, e)} />
        </div>
      ))}
      <div className="nc-lib-header-fill" />
    </div>
  );

  const renderRows = (list: Row[]) => list.map((r) => (
    <TableRow
      key={r.id}
      row={r}
      depth={0}
      tab={tab}
      view={view}
      columns={columns}
      w={w}
      sv={sv}
      expanded={expanded}
      setExpanded={(id, v) => setExpanded((x) => ({ ...x, [id]: v }))}
      selected={selected}
      setSelected={(id, v) => setSelected((x) => ({ ...x, [id]: v }))}
    />
  ));

  let body;
  if (view.group) {
    const groups = new Map<string, { label: string; rows: Row[] }>();
    for (const r of rows) {
      const g = groupOf(records.get<BlockRecord>('block', r.id), r, view.group, sv);
      if (!groups.has(g.key)) groups.set(g.key, { label: g.label, rows: [] });
      groups.get(g.key)!.rows.push(r);
    }
    const keys = [...groups.keys()];
    if (COL_KIND[view.group] === 'date') keys.sort();
    body = keys.map((k) => {
      const g = groups.get(k)!;
      const collapsed = !!collapsedGroups[k];
      return (
        <Fragment key={k}>
          <div className="nc-lib-group-head" style={{ minWidth: total }} role="button" aria-expanded={!collapsed} onClick={() => setCollapsedGroups((x) => ({ ...x, [k]: !collapsed }))}>
            <span className="nc-lib-group-caret" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}><Icon name="arrowChevronSingleDownFillSmall" size={12} /></span>
            <span className="nc-lib-group-label">{g.label}</span>
            <span className="nc-lib-group-count">{g.rows.length}</span>
          </div>
          {!collapsed && renderRows(g.rows)}
        </Fragment>
      );
    });
  } else {
    body = renderRows(rows);
  }

  const selectedIds = Object.keys(selected).filter((id) => selected[id] && records.get<BlockRecord>('block', id)?.alive !== false);
  return (
    <div className="lit-scroller horizontal lit-collection-view-body nc-lib-body">
      <div className="lit-table-view nc-lib-table">
        {selectedIds.length > 0 && <BulkBar tab={tab} ids={selectedIds} onClear={() => setSelected({})} onSelectAll={() => setSelected(Object.fromEntries(rows.map((r) => [r.id, true])))} />}
        {header}
        <div className="nc-lib-rows">{body}</div>
        {empty && <div className="nc-lib-empty-row" style={{ width: total }}>{empty}</div>}
      </div>
    </div>
  );
}

function TableRow({ row, depth, tab, view, columns, w, sv, expanded, setExpanded, selected, setSelected }: {
  row: Row;
  depth: number;
  tab: PageTab;
  view: LibView;
  columns: ColKey[];
  w: (c: ColKey) => number;
  sv: SpaceViewRecord | undefined;
  expanded: Record<string, boolean>;
  setExpanded: (id: string, v: boolean) => void;
  selected: Record<string, boolean>;
  setSelected: (id: string, v: boolean) => void;
}) {
  const b = useBlock(row.id);
  if (!b || b.alive === false) return null;
  const kids = subPages(b);
  const hasKids = kids.length > 0;
  const isOpen = !!expanded[row.id];
  const isSel = !!selected[row.id];
  const open = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) window.open(pageUrl(row.id), '_blank');
    else if (e.altKey) openPeek(row.id, 'side_peek');
    else openPage(row.id);
  };
  void tab;
  return (
    <>
      <div className={`lit-selectable lit-page-block lit-collection-item nc-lib-item ${isSel ? 'selected' : ''}`} data-block-id={row.id}>
        <div className="lit-table-view-row nc-lib-row">
          <label className="nc-lib-rowcheck" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={isSel} onChange={(e) => setSelected(row.id, e.target.checked)} />
            <span className={`nc-lib-check ${isSel ? 'on' : ''}`}>{isSel && <Icon name="check" size={12} />}</span>
          </label>
          {columns.map((c) => (
            <div key={c} className={`lit-table-view-cell nc-lib-cell ${view.wrap[c] ? 'wrap' : ''}`} style={{ width: w(c) }}>
              {c === 'title' ? (
                <div className="nc-lib-title-cell">
                  <div className="nc-lib-toggle-slot" style={{ marginInlineStart: depth * SUB_INDENT }}>
                    {hasKids && (
                      <div
                        role="button"
                        aria-label={isOpen ? t('lp.home.close', 'Close') : t('lp.home.open', 'Open')}
                        aria-expanded={isOpen}
                        className="nc-lib-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(row.id, !isOpen);
                        }}
                      >
                        <Icon name="libCaretRight" size={12} style={{ transform: isOpen ? 'rotateZ(90deg)' : 'none', transition: 'transform 200ms ease-out' }} />
                      </div>
                    )}
                  </div>
                  <div role="button" className="nc-lib-title" onClick={open}>
                    <span className="nc-lib-title-icon"><PageIcon block={b} size={22} fallback={b.type === 'collection_view_page' ? 'viewTable' : 'page'} /></span>
                    <span className="nc-lib-title-text notranslate">{pageTitle(b) || t('lp.home.untitled', 'Untitled')}</span>
                  </div>
                  <div
                    role="button"
                    className="nc-lib-open"
                    aria-label={t('lp.home.show_in_side_preview', 'Show in side preview')}
                    data-tooltip={t('lp.home.show_in_side_preview', 'Show in side preview')}
                    onClick={(e) => {
                      e.stopPropagation();
                      openPeek(row.id, 'side_peek');
                    }}
                  >
                    <Icon name="peekSide" size={14} />
                    <span>{t('lp.home.open', 'Open')}</span>
                  </div>
                </div>
              ) : (
                <CellValue b={b} row={row} col={c} sv={sv} />
              )}
            </div>
          ))}
          <div className="nc-lib-row-fill" />
        </div>
      </div>
      {isOpen && kids.map((id) => (
        <TableRow
          key={id}
          row={{ id }}
          depth={depth + 1}
          tab={tab}
          view={view}
          columns={columns}
          w={w}
          sv={sv}
          expanded={expanded}
          setExpanded={setExpanded}
          selected={selected}
          setSelected={setSelected}
        />
      ))}
    </>
  );
}

function CellValue({ b, row, col, sv }: { b: BlockRecord; row: Row; col: ColKey; sv: SpaceViewRecord | undefined }) {
  const kind = COL_KIND[col];
  if (kind === 'person') {
    const u = userOf(personValue(b, col));
    if (!u) return <div className="nc-lib-cell-inner" />;
    return (
      <div className="nc-lib-cell-inner nc-lib-person">
        <LibAvatar user={u} />
        <span className="nc-ellipsis notranslate">{userName(u)}</span>
      </div>
    );
  }
  if (kind === 'date') {
    const ts = dateValue(b, row, col);
    return <div className="nc-lib-cell-inner nc-lib-date">{libraryTime(ts)}</div>;
  }
  if (kind === 'source') {
    const s = sourceOf(b, sv);
    if (s.kind === 'none') return <div className="nc-lib-cell-inner" />;
    const go = () => {
      if (s.kind === 'page' || s.kind === 'database') {
        if (s.id) openPage(s.id);
      }
    };
    return (
      <div className="nc-lib-cell-inner">
        <div role="button" className={`nc-lib-source ${s.kind === 'page' || s.kind === 'database' ? 'link' : ''}`} onClick={go}>
          <span className="nc-lib-source-icon">
            {s.kind === 'private' && <Icon name="lock" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />}
            {s.kind === 'team' && <TeamIcon team={s.team} size={20} />}
            {(s.kind === 'page' || s.kind === 'database') && (
              s.block && (s.block.format?.page_icon as string | undefined)
                ? <PageIcon block={s.block} size={20} />
                : <Icon name={s.kind === 'database' || s.block?.type === 'collection_view_page' ? 'viewTable' : 'page'} size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
            )}
          </span>
          <span className="nc-lib-source-label notranslate">{s.label}</span>
        </div>
      </div>
    );
  }
  return <div className="nc-lib-cell-inner" />;
}
