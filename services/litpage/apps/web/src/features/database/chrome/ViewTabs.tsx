// View tab bar (pill tabs, drag to reorder, "N more…" overflow, "+" add view) and the add-view / view
// action menus for database views.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, ViewType } from '@nc/shared/records.ts';
import { VIEW_TYPES, viewTypeMeta } from '@nc/shared/database/index.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { Icon } from '../../../components/Icon.tsx';
import { MenuSectionTitle, openMenu } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { openPage, pageUrl } from '../../../lib/router.ts';
import { compactId } from '@nc/shared/ids.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { addView, deleteView, duplicateView, renameView, reorderViews, updateViewFormat } from '../actions.ts';
import { confirmDialog } from '../../page/confirm.tsx';

export function viewIcon(type: string): string {
  return viewTypeMeta(type).icon;
}

export function viewLink(block: BlockRecord, viewId: string): string {
  return `${location.origin}${pageUrl(block.id)}?v=${compactId(viewId)}`;
}

/** "Create another layout" grid (4 columns: Table, Board, Gallery, List / Chart, Dashboard, Timeline, Feed / Map, Calendar, Form). */
/** “Create another layout” grid + “Create a dataset”; one role=grid, with the first cell highlighted when it opens. */
function AddViewGrid({ opts, close }: { opts: { block: BlockRecord; collection?: CollectionRecord; onCreated: (viewId: string, type: ViewType) => void; linked?: boolean }; close: () => void }) {
  // forms only collect into a data source the database owns 
  const linked = opts.linked ?? (!!opts.collection && opts.collection.parent_id !== opts.block.id);
  const types = VIEW_TYPES.filter((v) => v.addMenu && !(linked && v.type === 'form'));
  // keyboard highlight (starts on the first cell; the pointer only adds a hover background — add-view-menu
  // keeps "Table" highlighted after the pointer crossed "Timeline")
  const [active, setActive] = useState(0);
  const create = (type: ViewType) => {
// a new view shows the current tab’s data source; a database can have several sources
    const id = addView(opts.block, type, { afterViewId: opts.block.view_ids?.[opts.block.view_ids.length - 1], collectionId: opts.collection?.id });
    close();
    if (id) opts.onCreated(id, type);
  };
  const activeRef = useRef(active);
  activeRef.current = active;
  // "Create a dataset": a new data source in this database (+ a table tab for it), or a linked one (/016)
  const newDataSource = () => {
    const anchor = document.querySelector<HTMLElement>(`.nc-db-block[data-block-id="${opts.block.id}"] .nc-db-header, .nc-db-page[data-page-id="${opts.block.id}"] .nc-db-header`) ?? document.body;
    void import('../sources/ManageSources.tsx').then((m) => m.openAddDataSource(anchor, opts.block, undefined));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 4-column grid of view types, then the "Create a dataset" row (index types.length)
      const last = types.length;
      const a = activeRef.current;
      let next = a;
      if (e.key === 'ArrowRight') next = Math.min(last, a + 1);
      else if (e.key === 'ArrowLeft') next = Math.max(0, a - 1);
      else if (e.key === 'ArrowDown') next = a === last ? a : a + 4 < last ? a + 4 : last;
      else if (e.key === 'ArrowUp') next = a === last ? Math.floor((last - 1) / 4) * 4 : a >= 4 ? a - 4 : a;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        setActive(next);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (a < types.length) create(types[a].type as ViewType);
        else { close(); newDataSource(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <PopoverSurface width={390} className="nc-add-view-menu">
      <div role="grid">
        <div className="nc-add-view-section">
          <MenuSectionTitle>Create another layout</MenuSectionTitle>
          <div className="nc-add-view-grid">
            {types.map((v, i) => (
              <div
                key={v.type}
                role="gridcell"
                className={`nc-add-view-cell ${active === i ? 'active' : ''}`}
                onClick={() => create(v.type as ViewType)}
              >
                <Icon name={v.icon} size={22} />
                <span className="nc-add-view-label">{v.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="nc-add-view-footer">
          <div role="gridcell" className={`nc-menu-item nc-add-view-source ${active === types.length ? 'active' : ''}`} onClick={() => { close(); newDataSource(); }}>
            <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="squareOnSquarePlus" size={20} /></div><div className="nc-menu-label">Create a dataset</div></div>
          </div>
        </div>
      </div>
    </PopoverSurface>
  );
}

export function openAddViewMenu(anchor: HTMLElement, opts: { block: BlockRecord; collection?: CollectionRecord; onCreated: (viewId: string, type: ViewType) => void; linked?: boolean }) {
  return openOverlay((close) => <AddViewGrid opts={opts} close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

function openRename(anchor: HTMLElement, view: CollectionViewRecord) {
  let name = view.name;
  return openOverlay((close) => (
    <PopoverSurface width={260} className="nc-rename-view">
      <div className="nc-rename-view-body" data-menu-keys="ignore">
        <div className="nc-input focused">
          <input autoFocus defaultValue={view.name} placeholder="View name" onFocus={(e) => e.currentTarget.select()} onChange={(e) => (name = e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) close(); }} />
        </div>
      </div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 4, onClose: () => { if (name.trim() && name !== view.name) renameView(view.id, name.trim()); } });
}

export type TabDisplay = 'text_and_icon' | 'text' | 'icon';

/** View action menu (click on the active tab / title •••). */
export function openViewMenu(anchor: HTMLElement, opts: { block: BlockRecord; view: CollectionViewRecord; collection?: CollectionRecord; readOnly: boolean; onEdit: () => void; onSelect: (id: string) => void; display: TabDisplay; setDisplay: (d: TabDisplay) => void }) {
  const { block, view } = opts;
  const views = block.view_ids ?? [];
  const showTitle = (block.format as any)?.collection_show_title !== false && (view.format as any)?.hide_linked_collection_name !== true;
  return openMenu(anchor, {
    width: 265,
    sections: [
      { items: [
        { id: 'rename', label: 'Rename', icon: 'pencilLine', disabled: opts.readOnly, onSelect: () => { setTimeout(() => openRename(anchor, view), 0); } },
        { id: 'display', label: 'Show as', icon: 'eye', submenu: () => ({ width: 220, footer: <div className="nc-menu-caption">Only applies to you</div>, sections: [{ items: [
          { id: 'ti', label: 'Text and icon', checked: opts.display === 'text_and_icon', onSelect: () => opts.setDisplay('text_and_icon') },
          { id: 't', label: 'Text only', checked: opts.display === 'text', onSelect: () => opts.setDisplay('text') },
          { id: 'i', label: 'Icon only', checked: opts.display === 'icon', onSelect: () => opts.setDisplay('icon') },
        ] }] }) },
        { id: 'edit', label: 'Edit view', icon: 'sliders', onSelect: () => opts.onEdit() },
        { id: 'source', label: 'Database', icon: 'pathRoundEnds', right: <span className="nc-menu-value">{toPlainText(opts.collection?.name as any) || 'Untitled'}</span>, disabled: true },
      ] },
      { items: [
        { id: 'link', label: 'Copy link to layout', icon: 'dbLink', onSelect: () => { void navigator.clipboard?.writeText(viewLink(block, view.id)); useUI.getState().toast('Copied link to view'); } },
// a sidebar section listing this view’s rows; lazy import avoids a cycle
        { id: 'sidebar', label: 'Add layout to sidebar', icon: 'sidebarLeft', onSelect: () => { void import('../../shell/sidebar/Customize.tsx').then((m) => m.addDatabaseViewToSidebar(block.id, view.id)); } },
        { id: 'full', label: 'Launch as full entry', icon: 'arrowDiagonalUpRight', onSelect: () => openPage(block.id) },
        { id: 'title', label: showTitle ? 'Conceal dataset title' : 'Display dataset title', icon: 'eye', disabled: opts.readOnly, onSelect: () => updateViewFormat(view.id, { hide_linked_collection_name: showTitle }) },
      ] },
      ...(opts.readOnly ? [] : [{ items: [
        { id: 'dup', label: 'Duplicate view', icon: 'duplicate', onSelect: () => { const id = duplicateView(block, view.id); if (id) opts.onSelect(id); } },
        ...(views.length > 1 ? [{ id: 'del', label: 'Delete view', icon: 'trash', onSelect: async () => {
          const ok = await confirmDialog({ message: `Delete the view “${view.name}”?`, confirmLabel: 'Delete' });
          if (!ok) return;
          const next = views.find((x) => x !== view.id);
          deleteView(block, view.id);
          if (next) opts.onSelect(next);
        } }] : []),
      ] }]),
      { items: [{ id: 'calendar', label: 'Manage in Calendar', icon: 'viewCalendar', disabled: true }] },
    ],
  }, { placement: 'bottom-start' });
}

export function ViewTabs({ block, views, activeId, collection, readOnly, onSelect, onEditView, onAdded, display, setDisplay, hovered }: {
  block: BlockRecord; views: CollectionViewRecord[]; activeId: string; collection?: CollectionRecord; readOnly: boolean;
  onSelect: (id: string) => void; onEditView: () => void; onAdded: (id: string) => void; display: TabDisplay; setDisplay: (d: TabDisplay) => void; hovered: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(views.length);
  const [drag, setDrag] = useState<{ id: string; over: string | null; before: boolean } | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const meas = measureRef.current;
    if (!wrap || !meas) return;
    const compute = () => {
      const widths = [...meas.children].map((c) => (c as HTMLElement).offsetWidth + 1);
      const total = widths.reduce((a, b) => a + b, 0);
      // everything fits next to the 28px "+" button → no overflow; otherwise reserve room for "N more…"
      if (total + 36 <= wrap.clientWidth) {
        setFit(widths.length);
        return;
      }
      const avail = wrap.clientWidth - 110;
      let used = 0;
      let n = 0;
      for (const w of widths) {
        if (used + w > avail) break;
        used += w;
        n++;
      }
      setFit(Math.max(1, n));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [views.map((v) => `${v.id}:${v.name}:${v.type}`).join('|'), display]);

  const activeIdx = views.findIndex((v) => v.id === activeId);
  let visible = views.slice(0, fit);
  if (activeIdx >= fit && fit > 0) visible = [...views.slice(0, fit - 1), views[activeIdx]];
  const hidden = views.filter((v) => !visible.includes(v));

  const tab = (v: CollectionViewRecord, measuring = false) => {
    const active = v.id === activeId;
    return (
      <div
        key={v.id}
        className={`nc-view-tab-wrap ${drag?.over === v.id ? (drag.before ? 'drop-before' : 'drop-after') : ''}`}
        draggable={!measuring && !readOnly}
        onDragStart={(e) => { setDrag({ id: v.id, over: null, before: true }); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e) => { if (!drag) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrag({ ...drag, over: v.id, before: e.clientX < r.left + r.width / 2 }); }}
        onDrop={(e) => {
          e.preventDefault();
          if (drag && drag.id !== v.id) {
            if (drag.before) reorderViews(block, drag.id, v.id);
            else {
              const ids = block.view_ids ?? [];
              const next = ids[ids.indexOf(v.id) + 1];
              reorderViews(block, drag.id, next && next !== drag.id ? next : undefined);
            }
          }
          setDrag(null);
        }}
        onDragEnd={() => setDrag(null)}
      >
        <div className="lit-collection-view-tab-button">
          <div
            role={measuring ? undefined : 'tab'}
            aria-selected={measuring ? undefined : active}
            aria-haspopup="dialog"
            className={`lit-collection-view-tab ${active ? 'active' : ''}`}
            data-tooltip={measuring ? undefined : v.name}
            data-tooltip-sub={measuring ? undefined : (v.format as any)?.description || `${viewTypeMeta(v.type).label} view of ${toPlainText(collection?.name as any) || 'Untitled'}`}
            onClick={(e) => {
              if (measuring) return;
              if (active) openViewMenu(e.currentTarget, { block, view: v, collection, readOnly, onEdit: onEditView, onSelect, display, setDisplay });
              else onSelect(v.id);
            }}
          >
            {display !== 'text' && <Icon name={viewIcon(v.type)} size={20} className="nc-view-tab-icon" />}
            {display !== 'icon' && <span className="nc-view-tab-name">{v.name || viewTypeMeta(v.type).label}</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="nc-view-tabs" ref={wrapRef}>
      <div className="nc-view-tabs-measure" ref={measureRef} aria-hidden>{views.map((v) => tab(v, true))}</div>
      <div role="tablist" tabIndex={-1} className="nc-view-tablist">
        {visible.map((v) => tab(v))}
        {hidden.length > 0 ? (
          <div
            role="button"
            aria-haspopup="dialog"
            className="nc-view-tabs-more"
            onClick={(e) => openMenu(e.currentTarget, {
              width: 290,
              search: 'Find a layout...',
              sections: [
                { items: views.map((v) => ({ id: v.id, label: v.name, icon: viewIcon(v.type), checked: v.id === activeId, onSelect: () => onSelect(v.id) })) },
                ...(readOnly ? [] : [{ items: [
                  { id: 'new', label: 'New view', icon: 'plus', onSelect: () => { setTimeout(() => openAddViewMenu(e.currentTarget as HTMLElement, { block, collection, onCreated: (id) => onAdded(id) }), 0); } },
                  { id: 'source', label: 'Create a dataset', icon: 'squareOnSquarePlus', onSelect: () => { const a = e.currentTarget as HTMLElement; setTimeout(() => void import('../sources/ManageSources.tsx').then((m) => m.openAddDataSource(a, block)), 0); } },
                ] }]),
              ],
            }, { placement: 'bottom-start' })}
          >
            {hidden.length} more…
          </div>
        ) : (
          !readOnly && (
            <div className={`nc-view-add-wrap ${hovered ? 'visible' : ''}`}>
              <div role="button" className="lit-collection-add-view nc-view-add" aria-label="Add view" aria-haspopup="dialog" data-tooltip="Create another layout" onClick={(e) => openAddViewMenu(e.currentTarget, { block, collection, onCreated: (id) => onAdded(id) })}>
                <Icon name="plusSmall" size={16} />
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
