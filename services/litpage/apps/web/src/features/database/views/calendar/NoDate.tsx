// "No date (N)": calendar and
// timeline views show a gray toolbar button counting the pages of the view (its filters applied) whose date is empty.
// It opens a 320px popup — "Find an entry…", the hint "Click or drag an item onto the calendar to set a date." / "Click to add to
// the timeline", the pages with an "Open" button — where a click gives the page today's date and, on a calendar,
// dragging a page onto a day gives it that day. 20 pages at a time, more on scroll; "No results" when none match.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { useViewQuery } from '../../data.ts';
import { registerToolbarLeading, type ToolbarLeadingProps } from '../../viewRegistry.ts';
import { useDatabaseContext } from '../../DatabaseContext.tsx';
import { run, setProperty } from '../../../../lib/blocks.ts';
import { openPage, openPeek } from '../../../../lib/router.ts';
import { titleOf } from '../../advanced/index.ts';
import { dateByProperty, dateValue, isoOfDay, rowDayRange, todayNum } from '../../advanced/viewKit.tsx';
import '../../dbv.css';

export const NO_DATE_DRAG_TYPE = 'application/x-nc-nodate-row';
const PAGE = 20;

type Kind = 'calendar' | 'timeline';

function dateProps(view: CollectionViewRecord, collection: CollectionRecord): { prop?: string; end?: string } {
  if (view.type === 'timeline') return { prop: dateByProperty(view, collection.schema, 'timeline_by'), end: dateByProperty(view, collection.schema, 'timeline_by_end') };
  return { prop: dateByProperty(view, collection.schema, 'calendar_by') };
}

/** Give a page a date (today unless `day` is a day number): the view's date property, and its end property when the * view separates start and end dates. */
export function setRowDay(rowId: string, view: CollectionViewRecord, collection: CollectionRecord, day = todayNum()) {
  const { prop, end } = dateProps(view, collection);
  if (!prop || collection.schema[prop]?.type !== 'date') return;
  const v = dateValue({ type: 'date', start_date: isoOfDay(day) });
  run('collectionEmptyOrganizeByMenu.addDate', (tx) => {
    setProperty(tx, rowId, prop, v);
    if (end && end !== prop && collection.schema[end]?.type === 'date') setProperty(tx, rowId, end, v);
  });
}

function emptyRows(rows: BlockRecord[], prop: string | undefined): BlockRecord[] {
  if (!prop) return [];
  return rows.filter((r) => !rowDayRange(r, prop));
}

function NoDatePopup({ kind, view, collection, close, onOpen }: { kind: Kind; view: CollectionViewRecord; collection: CollectionRecord; close: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const { prop } = dateProps(view, collection);
  const result = useViewQuery(collection, view, { search: q });
  const rows = useMemo(() => emptyRows(result.rows, prop), [result.rows, prop]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setLimit(PAGE), [q]);
  const prompt = kind === 'calendar' ? 'Click or drag an item onto the calendar to set a date.' : 'Click to place it on the timeline';
  return (
    <PopoverSurface width={320} className="nc-nodate-popup" maxHeight="min(480px, 70vh)">
      <div className="nc-vs-search" data-menu-keys="ignore">
        <div className="nc-input focused"><input autoFocus placeholder="Find an entry…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div
        ref={listRef}
        className="lit-scroller vertical nc-nodate-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 40 && limit < Math.min(rows.length, 200)) setLimit((n) => n + PAGE);
        }}
      >
        <div className="nc-menu-section">
          <div className="nc-menu-section-title">{prompt}</div>
          {rows.slice(0, limit).map((r) => (
            <div
              key={r.id}
              role="menuitem"
              className="nc-menu-item nc-nodate-row"
              draggable={kind === 'calendar'}
              onDragStart={(e) => {
                e.dataTransfer.setData(NO_DATE_DRAG_TYPE, r.id);
                e.dataTransfer.effectAllowed = 'move';
                // let the calendar under the popup receive the drop
                setTimeout(close, 0);
              }}
              onClick={() => { setRowDay(r.id, view, collection); close(); }}
            >
              <div className="nc-menu-item-inner">
                <span className="nc-nodate-icon"><PageIcon block={r} size={20} fallback="page" /></span>
                <div className="nc-menu-label nc-ellipsis">{titleOf(r) || 'Untitled'}</div>
                <span role="button" className="nc-nodate-open" onClick={(e) => { e.stopPropagation(); close(); onOpen(r.id); }}>Open</span>
              </div>
            </div>
          ))}
          {!rows.length && <div className="nc-menu-empty">No results</div>}
        </div>
      </div>
    </PopoverSurface>
  );
}

function NoDateButton({ view, collection, readOnly }: ToolbarLeadingProps) {
  const db = useDatabaseContext();
  const { prop } = dateProps(view, collection);
  const result = useViewQuery(collection, view, {});
  const count = useMemo(() => emptyRows(result.rows, prop).length, [result.rows, prop]);
  if (readOnly || !prop || collection.schema[prop]?.type !== 'date' || !count) return null;
  const kind: Kind = view.type === 'timeline' ? 'timeline' : 'calendar';
  const open = (id: string) => {
    if (db) db.openRow(id);
    else if (view.type === 'calendar') openPeek(id, 'center_peek');
    else openPage(id);
  };
  return (
    <div
      role="button"
      className="nc-db-tool nc-nodate-button"
      aria-haspopup="dialog"
      onClick={(e) => openOverlay((close) => <NoDatePopup kind={kind} view={view} collection={collection} close={close} onOpen={open} />, { anchor: e.currentTarget, placement: 'bottom-start', offset: 4 })}
    >
      No date ({count >= 100 ? '99+' : count})
    </div>
  );
}

registerToolbarLeading('calendar', NoDateButton);
registerToolbarLeading('timeline', NoDateButton);
