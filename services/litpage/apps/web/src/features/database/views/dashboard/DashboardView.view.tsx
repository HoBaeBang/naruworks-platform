// Dashboard view: rows of widgets, each an ordinary view of the same data source.
// source rendered with its registered view component (charts, tables, boards, lists…). keeps widget
// views out of the tab bar (format.dashboard_view_id = dashboard view) and the layout in a `layout` record
// (modules.dashboard_layout_schema rows → widgets); the clone stores the same rows/widgets on the dashboard
// view: format.dashboard_layout = {rows:[{id, height, widgets:[{id, view_id, width?}]}]}.
// View mode vs Edit mode: layout controls are available while editing; new dashboards start in Edit.
// dragging widgets within / across rows or into a new row, widget widths by dragging the handle between
// two widgets, global filters = the dashboard view's own filters applied to every widget whose data
// source has the property; personal in View mode until “Save for everyone”.
// viewState.ts personalMode).
// Dashboard widget menus, empty states, row tooltips, and onboarding cards.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionRecord, CollectionViewRecord, ViewType } from '@nc/shared/records.ts';
import { viewTypeMeta, type FilterGroup, type FilterNode, type PropertyFilterLeaf } from '@nc/shared/database/index.ts';
import { newId } from '@nc/shared/ids.ts';
import { registerToolbarExtra, registerView, viewRegistry, type ToolbarExtraProps, type ViewProps } from '../../viewRegistry.ts';
import { DatabaseContext, useDatabaseContext } from '../../DatabaseContext.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../../components/Menu.tsx';
import { run } from '../../../../lib/blocks.ts';
import { useRecords } from '../../../../lib/hooks.ts';
import { useUI } from '../../../../lib/store/ui.ts';
import { records } from '../../../../lib/store/records.ts';
import { createViewIn, viewCreationHooks } from '../../actions.ts';
import { viewIcon } from '../../chrome/ViewTabs.tsx';
import { openViewSettings } from '../../chrome/ViewSettings.tsx';
import { useViewKit } from '../../advanced/viewKit.tsx';
import { setDashboardMode, useDashboardMode, useEffectiveView, withExtraFilters } from '../../viewState.ts';
import './dashboard.css';

export interface DashboardWidget { id: string; view_id: string; /** relative width in its row (default 1) */ width?: number }
export interface DashboardRow { id: string; height?: number; widgets: DashboardWidget[] }
export interface DashboardLayout { rows: DashboardRow[] }

const MAX_PER_ROW = 4;
const MAX_WIDGETS = 12; //: 4 per row, 12 per dashboard
const DEFAULT_HEIGHT = 460;
const WIDGET_TYPES: ViewType[] = ['chart', 'table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed', 'map'] as ViewType[];

function layoutOf(view: CollectionViewRecord): DashboardLayout {
  const l = (view.format as Record<string, unknown> | undefined)?.dashboard_layout as DashboardLayout | undefined;
  return { rows: (l?.rows ?? []).filter((r) => r && Array.isArray(r.widgets)) };
}

function saveLayout(view: CollectionViewRecord, layout: DashboardLayout, action: string) {
  const rows = layout.rows.filter((r) => r.widgets.length);
  run(action, (tx) => tx.update('collection_view', view.id, ['format'], { dashboard_layout: { rows } }));
}

/** Create a widget view (+ its type defaults) and place it in `rowIndex` (new row when undefined / full). */
export function addWidget(dashboard: CollectionViewRecord, blockId: string, collectionId: string, type: ViewType, place?: { rowIndex?: number; newRowAt?: number }): string {
  const layout = layoutOf(dashboard);
  const total = layout.rows.reduce((a, r) => a + r.widgets.length, 0);
  if (total >= MAX_WIDGETS) {
    useUI.getState().toast('Dashboard full — delete a view to add a new one');
    return '';
  }
  let vid = '';
  run('dashboard.addWidget', (tx) => {
    vid = createViewIn(tx, blockId, type, collectionId, { name: viewTypeMeta(type).label, extraFormat: { dashboard_view_id: dashboard.id } });
    const col = records.get<CollectionRecord>('collection', collectionId);
    if (col) viewCreationHooks[type]?.(tx, vid, col);
    const widget: DashboardWidget = { id: newId(), view_id: vid };
    const rows = layout.rows.map((r) => ({ ...r, widgets: [...r.widgets] }));
    const ri = place?.rowIndex;
    if (ri !== undefined && rows[ri] && rows[ri].widgets.length < MAX_PER_ROW) rows[ri].widgets.push(widget);
    else rows.splice(place?.newRowAt ?? rows.length, 0, { id: newId(), height: DEFAULT_HEIGHT, widgets: [widget] });
    tx.update('collection_view', dashboard.id, ['format'], { dashboard_layout: { rows } });
  });
  return vid;
}

function addWidgetMenu(anchor: HTMLElement, dashboard: CollectionViewRecord, blockId: string, collectionId: string, place?: { rowIndex?: number; newRowAt?: number }, after?: (id: string) => void) {
  openMenu(anchor, {
    width: 240,
    header: <div className="nc-dash-menu-head">Add charts, tables, or lists</div>,
    sections: [{ items: WIDGET_TYPES.map((t) => ({ id: t, label: viewTypeMeta(t).label, icon: viewIcon(t), onSelect: () => { const id = addWidget(dashboard, blockId, collectionId, t, place); if (id) after?.(id); } })) }],
  }, { placement: 'bottom-start' });
}

/** Global filter rules for a widget: same data source → as they are; another source → by property name + type * (rules on properties the widget's source doesn't have are left out). */
function filtersForWidget(nodes: FilterNode[], from: CollectionRecord, to: CollectionRecord | undefined): FilterNode[] {
  if (!to || to.id === from.id) return nodes;
  const mapLeaf = (leaf: PropertyFilterLeaf): PropertyFilterLeaf | null => {
    const p = from.schema[leaf.property];
    const hit = p && Object.entries(to.schema).find(([, q]) => q.name === p.name && q.type === p.type);
    return hit ? { ...leaf, property: hit[0] } : null;
  };
  const walk = (n: FilterNode): FilterNode | null => {
    if ('filters' in n) {
      const inner = n.filters.map(walk).filter((x): x is FilterNode => !!x);
      return inner.length ? { ...n, filters: inner } : null;
    }
    return mapLeaf(n as PropertyFilterLeaf);
  };
  return nodes.map(walk).filter((x): x is FilterNode => !!x);
}

type DropTarget = { kind: 'widget'; ri: number; wi: number; side: 'before' | 'after' } | { kind: 'row'; at: number };

function Widget({ widget, wv, rowIndex, index, rowCount, rowsTotal, props, editing, globalFilters, onMove, onDelete, onDuplicate, dragging, drop, onDragStart, onDragEnd, onDragOverWidget, onDropWidget }: {
  widget: DashboardWidget; wv: CollectionViewRecord; rowIndex: number; index: number; rowCount: number; rowsTotal: number; props: ViewProps;
  editing: boolean; globalFilters: FilterNode[];
  onMove: (dir: 'left' | 'right' | 'up' | 'down' | 'newAbove' | 'newBelow') => void; onDelete: () => void; onDuplicate: (newRow: boolean) => void;
  dragging: boolean; drop: 'before' | 'after' | null; onDragStart: () => void; onDragEnd: () => void; onDragOverWidget: (side: 'before' | 'after') => void; onDropWidget: () => void;
}) {
  const db = useDatabaseContext();
  const Comp = viewRegistry[wv.type];
  const source = records.get<CollectionRecord>('collection', (wv.format as { collection_pointer?: { id?: string } } | undefined)?.collection_pointer?.id ?? props.collection.id) ?? props.collection;
  // the dashboard's filters apply on top of the widget's own (and the person's unsaved ones)
  const nodes = useMemo(() => filtersForWidget(globalFilters, props.collection, source), [globalFilters, props.collection, source]);
  const shown = useMemo(() => withExtraFilters(wv, nodes), [wv, nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctxValue = useMemo(() => (db ? { ...db, view: shown, bleed: { left: 0, right: 0, width: null } } : null), [db, shown]);
  const menu = (e: React.MouseEvent<HTMLElement>) => {
    const items: MenuItemDef[] = [
      { id: 'edit', label: 'Edit view', icon: 'slidersTwo', onSelect: () => openViewSettings(e.currentTarget as HTMLElement, { block: props.block, view: wv, collection: props.collection, readOnly: props.readOnly, inline: true, onSelectView: () => undefined }) },
    ];
    // View mode: the widget's view settings only (its filters / sorts stay yours until saved)
    if (!editing) {
      openMenu(e.currentTarget, { width: 240, sections: [{ items }] }, { placement: 'bottom-end' });
      return;
    }
    items.push(
      { id: 'dup', label: 'Duplicate', icon: 'duplicate', onSelect: () => onDuplicate(false) },
      { id: 'dupRow', label: 'Copy into a new row', icon: 'duplicate', onSelect: () => onDuplicate(true) },
    );
    const moves: MenuItemDef[] = [];
    if (index > 0) moves.push({ id: 'left', label: 'Move left', icon: 'arrowLeft', onSelect: () => onMove('left') });
    if (index < rowCount - 1) moves.push({ id: 'right', label: 'Move right', icon: 'arrowRight', onSelect: () => onMove('right') });
    if (rowIndex > 0) moves.push({ id: 'up', label: 'Send to the row above', icon: 'arrowUp', onSelect: () => onMove('up') });
    if (rowIndex < rowsTotal - 1) moves.push({ id: 'down', label: 'Send to the row below', icon: 'arrowDown', onSelect: () => onMove('down') });
    if (rowCount > 1) {
      moves.push({ id: 'newAbove', label: 'Insert a row above', icon: 'rows', onSelect: () => onMove('newAbove') });
      moves.push({ id: 'newBelow', label: 'Insert a row below', icon: 'rows', onSelect: () => onMove('newBelow') });
    }
    openMenu(e.currentTarget, { width: 240, sections: [{ items }, ...(moves.length ? [{ items: moves }] : []), { items: [{ id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: onDelete }] }] }, { placement: 'bottom-end' });
  };
  return (
    <div
      className={`nc-dash-widget ${dragging ? 'dragging' : ''} ${drop ? `drop-${drop}` : ''}`}
      data-widget-view-id={wv.id}
      data-view-type={wv.type}
      style={{ flex: `${widget.width ?? 1} 1 0` }}
      onDragOver={(e) => {
        if (!editing) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverWidget(e.clientX < r.left + r.width / 2 ? 'before' : 'after');
      }}
      onDrop={(e) => { if (!editing) return; e.preventDefault(); onDropWidget(); }}
    >
      <div
        className={`nc-dash-widget-head ${editing ? 'draggable' : ''}`}
        draggable={editing}
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', widget.id); onDragStart(); }}
        onDragEnd={onDragEnd}
        data-tooltip={editing ? 'Drag to reposition' : undefined}
      >
        <Icon name={viewIcon(wv.type)} size={16} color="var(--lp-icon-secondary)" />
        <span className="nc-dash-widget-title">{wv.name || viewTypeMeta(wv.type).label}</span>
        {!props.readOnly && <div role="button" className="nc-dash-widget-more" aria-label="Widget options" data-tooltip="Widget options" onClick={menu}><Icon name="ellipsis" size={16} /></div>}
      </div>
      <div className="nc-dash-widget-body lit-scroller vertical">
        {Comp && ctxValue ? (
          <DatabaseContext.Provider value={ctxValue}>
            <Comp block={props.block} view={shown} collection={source} readOnly={props.readOnly} />
          </DatabaseContext.Provider>
        ) : <div className="nc-dash-empty-sub">This view type can’t be shown in a dashboard.</div>}
      </div>
    </div>
  );
}

function DashboardView(props: ViewProps) {
  const kit = useViewKit(props);
  const { view, block, collection, readOnly } = kit;
  const layout = layoutOf(view);
  const ids = layout.rows.flatMap((r) => r.widgets.map((w) => w.view_id));
  const views = useRecords<CollectionViewRecord>('collection_view', ids);
  const byId = new Map(views.filter((v): v is CollectionViewRecord => !!v && v.alive !== false).map((v) => [v.id, v]));
  const bleed = kit.db?.bleed ?? { left: 0, right: 0 };
  const [resizing, setResizing] = useState<{ row: number; h: number } | null>(null);
  const [widths, setWidths] = useState<{ row: number; ws: number[] } | null>(null);
  const [drag, setDrag] = useState<{ widgetId: string } | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const rowsRef = useRef(layout.rows);
  rowsRef.current = layout.rows;

  const rows = layout.rows.map((r) => ({ ...r, widgets: r.widgets.filter((w) => byId.has(w.view_id)) })).filter((r) => r.widgets.length);
  // View mode vs Edit mode: people who can change the dashboard switch with "Edit dashboard" / "Done"; an empty
  // dashboard opens in Edit mode
  const canEdit = !readOnly && !(kit.db?.structureReadOnly ?? false);
  const storedMode = useDashboardMode(view.id);
  useEffect(() => {
    if (canEdit && !storedMode && !rows.length) setDashboardMode(view.id, 'edit');
  }, [canEdit, storedMode, rows.length, view.id]);
  const editing = canEdit && (storedMode ?? (rows.length ? 'view' : 'edit')) === 'edit';
  // global filters: the dashboard view's own filter chips / advanced filter (yours in View mode)
  const eff = useEffectiveView(view);
  const globalFilters = useMemo(() => {
    const chips = (((eff.format as { property_filters?: { filter: PropertyFilterLeaf }[] } | undefined)?.property_filters) ?? []).map((f) => f.filter as FilterNode);
    const adv = (eff.query2 as { filter?: FilterGroup } | undefined)?.filter;
    return [...chips, ...(adv?.filters?.length ? [adv] : [])];
  }, [eff]);

  const moveWidget = (widgetId: string, target: DropTarget) => {
    const from = rows.findIndex((r) => r.widgets.some((w) => w.id === widgetId));
    if (from < 0) return;
    const w = rows[from].widgets.find((x) => x.id === widgetId)!;
    if (target.kind === 'widget') {
      const dest = rows[target.ri];
      if (!dest || (target.ri !== from && dest.widgets.length >= MAX_PER_ROW)) return useUI.getState().toast('A row holds up to 4 views');
      if (dest.widgets[target.wi]?.id === widgetId) return;
    }
    mutate((rs) => {
      rs[from].widgets = rs[from].widgets.filter((x) => x.id !== widgetId);
      const moved = { ...w, width: undefined };
      if (target.kind === 'row') rs.splice(target.at, 0, { id: newId(), height: rs[from].height ?? DEFAULT_HEIGHT, widgets: [moved] });
      else {
        const dest = rs[target.ri];
        const anchorId = rows[target.ri].widgets[target.wi]?.id;
        let i = dest.widgets.findIndex((x) => x.id === anchorId);
        if (i < 0) i = dest.widgets.length;
        dest.widgets.splice(target.side === 'after' ? i + 1 : i, 0, moved);
      }
    }, 'dashboard.dragWidget');
  };

  const startWidthDrag = (e: React.PointerEvent, ri: number, wi: number) => {
    e.preventDefault();
    e.stopPropagation();
    const rowEl = (e.currentTarget as HTMLElement).closest('.nc-dash-row') as HTMLElement | null;
    if (!rowEl) return;
    const ws0 = rows[ri].widgets.map((w) => w.width ?? 1);
    const total = ws0.reduce((a, b) => a + b, 0);
    const gaps = (ws0.length - 1) * 16;
    const pxPerW = Math.max(1, (rowEl.getBoundingClientRect().width - gaps) / total);
    const minW = 200 / pxPerW;
    const x0 = e.clientX;
    let ws = ws0;
    const mv = (ev: PointerEvent) => {
      const dw = (ev.clientX - x0) / pxPerW;
      const a = Math.max(minW, Math.min(ws0[wi] + ws0[wi + 1] - minW, ws0[wi] + dw));
      ws = ws0.map((w, i) => (i === wi ? a : i === wi + 1 ? ws0[wi] + ws0[wi + 1] - a : w));
      setWidths({ row: ri, ws });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setWidths(null);
      if (ws !== ws0) mutate((rs) => { rs[ri].widgets = rs[ri].widgets.map((w, i) => ({ ...w, width: Math.round((ws[i] / total) * ws0.length * 1000) / 1000 })); }, 'dashboard.resizeWidget');
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const mutate = (fn: (rows: DashboardRow[]) => void, action: string) => {
    const next = rows.map((r) => ({ ...r, widgets: [...r.widgets] }));
    fn(next);
    saveLayout(view, { rows: next }, action);
  };

  const move = (ri: number, wi: number, dir: 'left' | 'right' | 'up' | 'down' | 'newAbove' | 'newBelow') => mutate((rs) => {
    const [w] = rs[ri].widgets.splice(wi, 1);
    if (dir === 'left') rs[ri].widgets.splice(wi - 1, 0, w);
    else if (dir === 'right') rs[ri].widgets.splice(wi + 1, 0, w);
    else if (dir === 'up' || dir === 'down') {
      const target = rs[ri + (dir === 'up' ? -1 : 1)];
      if (target && target.widgets.length < MAX_PER_ROW) target.widgets.push(w);
      else rs[ri].widgets.splice(wi, 0, w);
    } else rs.splice(dir === 'newAbove' ? ri : ri + 1, 0, { id: newId(), height: rs[ri].height, widgets: [w] });
  }, 'DashboardWidgetMoreMenu.move');

  const remove = (ri: number, wi: number) => {
    const w = rows[ri].widgets[wi];
    run('DashboardWidgetMoreMenu.deleteView', (tx) => {
      tx.update('collection_view', w.view_id, [], { alive: false });
      const next = rows.map((r) => ({ ...r, widgets: r.widgets.filter((x) => x.id !== w.id) })).filter((r) => r.widgets.length);
      tx.update('collection_view', view.id, ['format'], { dashboard_layout: { rows: next } });
    });
  };

  const duplicate = (ri: number, wi: number, newRow: boolean) => {
    const src = byId.get(rows[ri].widgets[wi].view_id);
    if (!src) return;
    if (ids.length >= MAX_WIDGETS) return useUI.getState().toast('Dashboard full — delete a view to duplicate');
    run('DashboardWidgetMoreMenu.duplicateView', (tx) => {
      const nid = newId();
      const { version: _v, ...rest } = src as CollectionViewRecord & { version?: number };
      tx.set('collection_view', nid, [], { ...rest, id: nid, name: `${src.name || viewTypeMeta(src.type).label} (copy)` });
      const w: DashboardWidget = { id: newId(), view_id: nid };
      const next = rows.map((r) => ({ ...r, widgets: [...r.widgets] }));
      if (!newRow && next[ri].widgets.length < MAX_PER_ROW) next[ri].widgets.splice(wi + 1, 0, w);
      else next.splice(ri + 1, 0, { id: newId(), height: next[ri].height, widgets: [w] });
      tx.update('collection_view', view.id, ['format'], { dashboard_layout: { rows: next } });
    });
  };

  const startResize = (e: React.PointerEvent, ri: number) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = rows[ri].height ?? DEFAULT_HEIGHT;
    let h = h0;
    const mv = (ev: PointerEvent) => {
      h = Math.max(160, Math.min(1000, Math.round((h0 + ev.clientY - y0) / 4) * 4));
      setResizing({ row: ri, h });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setResizing(null);
      if (h !== h0) mutate((rs) => { rs[ri].height = h; }, 'dashboard.resizeRow');
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const endDrag = () => { setDrag(null); setDrop(null); };
  const doDrop = () => {
    if (drag && drop) moveWidget(drag.widgetId, drop);
    endDrag();
  };
  // drop zones between rows (Edit mode): a widget dropped there gets a row of its own
  const gap = (at: number) => (editing ? (
    <div
      key={`gap-${at}`}
      className={`nc-dash-gap ${drag ? 'active' : ''} ${drop?.kind === 'row' && drop.at === at ? 'over' : ''}`}
      data-testid="dashboard-drop-row"
      onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (!(drop?.kind === 'row' && drop.at === at)) setDrop({ kind: 'row', at }); }}
      onDrop={(e) => { e.preventDefault(); doDrop(); }}
    />
  ) : null);

  if (!rows.length) {
    return (
      <div className="nc-dash lit-dashboard-view" style={{ paddingInlineStart: bleed.left, paddingInlineEnd: bleed.right }}>
        <div className="nc-dash-empty" data-testid="dashboard-empty">
          <div className="nc-dash-empty-title">Start using your dashboard</div>
          <div className="nc-dash-empty-sub">Combine charts, tables, and lists of this data source in one place.</div>
          <div className="nc-dash-cards">
            <div className="nc-dash-card disabled" onClick={() => useUI.getState().toast('Litpage AI is not available in this workspace')}><div>Ask Litpage AI to build<br />your dashboard</div><Icon name="aiFace" size={28} color="var(--lp-icon-tertiary)" /></div>
            <div role="button" className="nc-dash-card" onClick={(e) => !readOnly && addWidgetMenu(e.currentTarget, view, block.id, collection.id)}><div>Add charts, tables, or lists to<br />your dashboard</div><div className="nc-dash-card-art"><span><Icon name="plus" size={16} /></span><span><Icon name="donutChart" size={16} /></span><span><Icon name="chartBarXAxis" size={16} /></span></div></div>
            <div className="nc-dash-card disabled"><div>Learn about filters across<br />multiple data sources</div><Icon name="filter" size={24} color="var(--lp-icon-tertiary)" /></div>
          </div>
          {!readOnly && <div role="button" className="nc-dash-add-btn" data-testid="dashboard-add" onClick={(e) => addWidgetMenu(e.currentTarget, view, block.id, collection.id)}><Icon name="plus" size={16} />New view</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`nc-dash lit-dashboard-view ${editing ? 'editing' : 'viewing'}`} data-dashboard-mode={editing ? 'edit' : 'view'} style={{ paddingInlineStart: bleed.left, paddingInlineEnd: bleed.right }}>
      {gap(0)}
      {rows.map((r, ri) => {
        const h = resizing?.row === ri ? resizing.h : r.height ?? DEFAULT_HEIGHT;
        const live = widths?.row === ri ? widths.ws : null;
        return [
          <div key={r.id} className="nc-dash-row" style={{ height: h }} data-row-index={ri}>
            {r.widgets.map((w, wi) => [
              <Widget
                key={w.id}
                widget={live ? { ...w, width: live[wi] } : w}
                wv={byId.get(w.view_id)!}
                rowIndex={ri}
                index={wi}
                rowCount={r.widgets.length}
                rowsTotal={rows.length}
                props={props}
                editing={editing}
                globalFilters={globalFilters}
                onMove={(dir) => move(ri, wi, dir)}
                onDelete={() => remove(ri, wi)}
                onDuplicate={(nr) => duplicate(ri, wi, nr)}
                dragging={drag?.widgetId === w.id}
                drop={drop?.kind === 'widget' && drop.ri === ri && drop.wi === wi ? drop.side : null}
                onDragStart={() => setDrag({ widgetId: w.id })}
                onDragEnd={endDrag}
                onDragOverWidget={(side) => { if (!(drop?.kind === 'widget' && drop.ri === ri && drop.wi === wi && drop.side === side)) setDrop({ kind: 'widget', ri, wi, side }); }}
                onDropWidget={doDrop}
              />,
              editing && wi < r.widgets.length - 1 ? (
                <div key={`${w.id}-w`} className="nc-dash-col-resize" role="separator" aria-label="Drag to resize" data-tooltip="Drag to resize" onPointerDown={(e) => startWidthDrag(e, ri, wi)} />
              ) : null,
            ])}
            {editing && r.widgets.length < MAX_PER_ROW && (
              <div role="button" className="nc-dash-row-add" aria-label="Place in row" data-tooltip="Place in row" onClick={(e) => addWidgetMenu(e.currentTarget, view, block.id, collection.id, { rowIndex: ri })}><Icon name="plus" size={16} /></div>
            )}
            {editing && <div className="nc-dash-row-resize" data-tooltip="Drag to resize" onPointerDown={(e) => startResize(e, ri)} />}
          </div>,
          gap(ri + 1),
        ];
      })}
      {editing && (
        <div role="button" className="nc-dash-newrow" aria-label="Place in a new row" data-tooltip="Place in a new row" onClick={(e) => addWidgetMenu(e.currentTarget, view, block.id, collection.id, { newRowAt: rows.length })}><Icon name="plus" size={16} /><span>New view</span></div>
      )}
    </div>
  );
}

function DashboardToolbar({ block, view, collection, readOnly }: ToolbarExtraProps) {
  const db = useDatabaseContext();
  const mode = useDashboardMode(view.id);
  const rows = layoutOf(view).rows.filter((r) => r.widgets.length);
  if (readOnly || db?.structureReadOnly) return null;
  const editing = (mode ?? (rows.length ? 'view' : 'edit')) === 'edit';
  if (!editing) {
    return (
      <div className="nc-db-new-wrap">
        <div role="button" className="nc-dash-tb-add" data-testid="dashboard-edit" onClick={() => setDashboardMode(view.id, 'edit')}><Icon name="pencil" size={14} />Edit dashboard</div>
      </div>
    );
  }
  return (
    <div className="nc-db-new-wrap">
      <div role="button" className="nc-dash-tb-add" onClick={(e) => addWidgetMenu(e.currentTarget, view, block.id, collection.id)}><Icon name="plus" size={14} />New view</div>
      <div role="button" className="nc-dash-tb-done" data-testid="dashboard-done" onClick={() => setDashboardMode(view.id, 'view')}>Done</div>
    </div>
  );
}

registerView('dashboard', DashboardView);
registerToolbarExtra('dashboard', DashboardToolbar);

/** New dashboards: no table properties, empty layout (2: type dashboard, table_properties:null). */
viewCreationHooks.dashboard = (tx, viewId) => {
  tx.update('collection_view', viewId, ['format'], { table_properties: null, dashboard_layout: { rows: [] } });
};
