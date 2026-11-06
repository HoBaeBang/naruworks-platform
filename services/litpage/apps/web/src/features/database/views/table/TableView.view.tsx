// Table view: 36px header row, 37px row pitch, title 280px and other columns 200px, resizable and reorderable
// columns, frozen columns, wrap per column, row gutter (checkbox at −36), OPEN quick action, groups,
// “+ New page”, calculation footer, and load limit.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { AGGREGATION_LABELS, DEFAULT_COLUMN_WIDTH, DEFAULT_TITLE_WIDTH, aggregateRows, groupAssignment, savedGroupsFrom, savedGroupsOf, type AggregationResult, type AggregationSpec, type ConditionalColors, type GroupResult } from '@nc/shared/database/index.ts';
import { registerView, type ViewProps } from '../../viewRegistry.ts';
import { conditionalBg, useConditionalColors, useViewQuery } from '../../data.ts';
import { useDatabaseContext } from '../../DatabaseContext.tsx';
import { PropertyCell, PropertyIcon } from '../../properties/PropertyCell.tsx';
import { calculateMenuDef, openAddPropertyMenu, openPropertyHeaderMenu } from '../../properties/PropertyMenus.tsx';
import { encodeAssignment, moveRow, moveViewProperty, setAggregation, setSavedGroups, updateViewProperty, viewProperties, setValue, type ViewPropEntry } from '../../actions.ts';
import { openPropertyVisibility } from '../../chrome/ViewSettings.tsx';
import { openRowMenu } from '../../chrome/RowMenu.tsx';
import { GroupHeader, HiddenGroups, useCollapsedGroups, groupColorVars } from '../../chrome/Groups.tsx';
import { openMenu } from '../../../../components/Menu.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { RichTextEditable } from '../../../editor/RichTextEditable.tsx';
import { PageIcon, iconOf } from '../../../shell/PageIcon.tsx';
import { useLocation } from '../../../../lib/router.ts';
import type { Tx } from '../../../../lib/store/transactions.ts';
import { makeQueryContext } from '../../data.ts';
import { highlightText } from '../highlight.tsx';
import { NewSubitemRow, SubitemCount, SubitemToggle, subitemInfoFor, type SubitemRowInfo } from '../../subitemsUi.tsx';
import { useIsExpanded } from '../../subitems.ts';
import { canEditRow } from '../../access.ts';
import { PropertyCommentButton, propertyDiscussions } from '../../propertyComments.tsx';
import { useCellSelection } from './cellSelection.tsx';
import { endRowDrag, startRowDrag } from '../../rowPageDrag.ts';
import '../../layout/layout.css';
import '../../dbv.css';
import './table.css';

interface Column extends ViewPropEntry {
  prop: PropertySchema;
  w: number;
  wrap: boolean;
  frozen: boolean;
  left: number;
}

const GUTTER = 8; // header/rows start 8px inside the bleed padding

function useColumns(view: CollectionViewRecord, collection: CollectionRecord, liveWidths: Record<string, number>): Column[] {
  const fmt = (view.format ?? {}) as Record<string, any>;
  const tableWrap = fmt.table_wrap !== false;
  const frozenIdx = typeof fmt.table_frozen_column_index === 'number' ? fmt.table_frozen_column_index : -1;
  const entries = viewProperties(view, collection.schema).filter((e) => e.visible);
  let left = 0;
  return entries.map((e, i) => {
    const prop = collection.schema[e.property];
    const w = liveWidths[e.property] ?? (typeof e.width === 'number' ? e.width : e.property === 'title' ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH);
    const col: Column = { ...e, prop, w, wrap: e.wrap ?? tableWrap, frozen: i <= frozenIdx, left };
    left += w;
    return col;
  });
}

function TableView({ block, view, collection, readOnly }: ViewProps) {
  const db = useDatabaseContext();
  // locked database / Can edit content: rows editable, columns (views + schema) not
  const structureRO = db?.structureReadOnly ?? readOnly;
  // properties belong to the data source: a linked view of a source the person can't edit offers no property changes
  const schemaRO = db?.schemaReadOnly ?? structureRO;
  const canAdd = db?.canAddRows ?? !readOnly;
  const search = db?.search ?? '';
  const result = useViewQuery(collection, view, { search });
  // sub-items: nested rows (Nested in toggle) or a count next to parents (Flattened list)
  const sub = result.subitems;
  const isOpen = useIsExpanded(view.id);
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const columns = useColumns(view, collection, liveWidths);
  const fmt = (view.format ?? {}) as Record<string, any>;
  const verticalLines = fmt.hide_table_vertical_lines !== true;
  const totalWidth = columns.reduce((a, c) => a + c.w, 0);
  const inline = db?.inline ?? true;
  const limitFmt = fmt.inline_collection_first_load_limit as { type: string; limit: number } | undefined;
  const firstLimit = inline ? (limitFmt?.type === 'load_limit' ? limitFmt.limit : 50) : Infinity;
  const [limit, setLimit] = useState(firstLimit);
  useEffect(() => setLimit(firstLimit), [firstLimit, view.id]);
  const hasFilter = !!search || !!(fmt.property_filters?.length) || !!(view.query2?.filter as any)?.filters?.length;
  const selection = db?.selection ?? [];
  const bleed = db?.bleed ?? { left: 0, right: 0, width: null };
  const location = useLocation();
  const peekId = location.peek?.pageId;

  const [dragCol, setDragCol] = useState<{ id: string; x: number; over: number | null } | null>(null);
  const [dragRow, setDragRow] = useState<{ id: string; overId: string | null; before: boolean; overGroup?: GroupResult } | null>(null);

  const allIds = result.rows.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selection.includes(id));
  const someSelected = selection.length > 0 && !allSelected;

  const startResize = (e: React.MouseEvent, col: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.w;
    let w = startW;
    const move = (ev: MouseEvent) => {
      w = Math.max(100, Math.round(startW + ev.clientX - startX));
      setLiveWidths((m) => ({ ...m, [col.property]: w }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      if (w !== startW) updateViewProperty(view, collection.schema, col.property, { width: w }, 'resizeColumn');
      setLiveWidths((m) => {
        const n = { ...m };
        delete n[col.property];
        return n;
      });
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const autofit = (col: Column) => {
    const cells = document.querySelectorAll<HTMLElement>(`[data-table-view="${view.id}"] [data-col="${CSS.escape(col.property)}"] .nc-cell-measure`);
    let max = 100;
    cells.forEach((c) => (max = Math.max(max, c.scrollWidth + 20)));
    updateViewProperty(view, collection.schema, col.property, { width: Math.min(800, Math.ceil(max)) }, 'autofitColumn');
  };

  const startColumnDrag = (e: React.MouseEvent, col: Column, headerEl: HTMLElement) => {
    if (structureRO || e.button !== 0) return;
    const startX = e.clientX;
    let moved = false;
    const rowEl = headerEl.closest('.lit-table-view-header-row') as HTMLElement | null;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4) return;
      moved = true;
      const cells = [...(rowEl?.querySelectorAll<HTMLElement>('.lit-table-view-header-cell') ?? [])];
      let over = cells.length;
      for (let i = 0; i < cells.length; i++) {
        const r = cells[i].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          over = i;
          break;
        }
      }
      setDragCol({ id: col.property, x: ev.clientX - startX, over });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDragCol((d) => {
        if (d && moved && d.over !== null) {
          const entries = viewProperties(view, collection.schema);
          const visibleIds = entries.filter((x) => x.visible).map((x) => x.property);
          const target = visibleIds.filter((id) => id !== col.property)[Math.min(d.over > visibleIds.indexOf(col.property) ? d.over - 1 : d.over, visibleIds.length - 1)];
          let toIndex = target ? entries.findIndex((x) => x.property === target) : entries.length;
          const from = entries.findIndex((x) => x.property === col.property);
          if (d.over >= visibleIds.length) toIndex = entries.length;
          else if (from < toIndex && d.over > visibleIds.indexOf(col.property)) toIndex = toIndex;
          if (d.over !== visibleIds.indexOf(col.property) && d.over !== visibleIds.indexOf(col.property) + 1) moveViewProperty(view, collection.schema, col.property, from < toIndex ? toIndex - (d.over >= visibleIds.length ? 1 : 0) : toIndex);
        }
        return null;
      });
      if (!moved) headerEl.classList.add('menu-open');
      if (!moved) openPropertyHeaderMenu(headerEl, {
        collectionId: collection.id, propId: col.property, view, block, readOnly: schemaRO,
        onClose: () => headerEl.classList.remove('menu-open'),
        onAddFilter: (pid) => db?.addFilter(pid),
        onInsert: (side) => openAddPropertyMenu(headerEl, { collectionId: collection.id, view, ...(side === 'left' ? { beforePropId: col.property } : { afterPropId: col.property }) }),
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const groups = result.groups;
  const collapsed = useCollapsedGroups(view.id);

  // Rows narrower than the header's min-width end in an empty filler cell; rows are then 37px + 1px border
  // rows use a 38px pitch in narrow tables and 37px in wide tables
  const tableRef = useRef<HTMLDivElement>(null);
  const [narrowByWidth, setNarrow] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(false);
  const [headWidth, setHeadWidth] = useState(0);
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const measure = () => {
      // the header grows past its columns + "+ •••" only when its min-width forces filler space
      const head = el.querySelector<HTMLElement>('.lit-table-view-header-row');
      const add = head?.querySelector<HTMLElement>('.nc-th-add');
      setNarrow(!!head && head.offsetWidth > totalWidth + (add?.offsetWidth ?? 0) + 0.5);
      setHeadWidth(head?.offsetWidth ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const head = el.querySelector<HTMLElement>('.lit-table-view-header-row');
    if (head) ro.observe(head);
    return () => ro.disconnect();
  }, [totalWidth, inline, pendingAdd]);
  const narrow = narrowByWidth || pendingAdd;

  const rowMinWidth = inline ? 700 : 'calc(100% - 200px)';
  const headerRow = (
    <div className="lit-table-view-header-row" style={{ minWidth: rowMinWidth }}>
      <div className="nc-table-gutter-sticky">
        <div className={`nc-row-checkbox-wrap header ${selection.length ? 'visible' : ''}`}>
          <label className="nc-row-checkbox-label">
            <span className={`nc-row-checkbox ${allSelected ? 'checked' : someSelected ? 'partial' : ''}`} onClick={() => db?.setSelection(allSelected ? [] : allIds)}>
              {allSelected && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}
              {someSelected && <span className="nc-row-checkbox-dash" />}
            </span>
          </label>
        </div>
      </div>
      {columns.map((col, i) => (
        <div
          key={col.property}
          className={`lit-table-view-header-cell ${col.frozen ? 'frozen' : ''} ${dragCol?.id === col.property ? 'dragging' : ''} ${dragCol?.over === i && dragCol.id !== col.property ? 'drop-before' : ''}`}
          data-col={col.property}
          style={{ width: col.w, ...(col.frozen ? { position: 'sticky', left: col.left + GUTTER, zIndex: 3 } : {}), ...(dragCol?.id === col.property ? { transform: `translateX(${dragCol.x}px)` } : {}) }}
        >
          <div
            role="button"
            aria-haspopup="dialog"
            className="nc-th-button"
            onMouseDown={(e) => startColumnDrag(e, col, e.currentTarget.parentElement as HTMLElement)}
          >
            <div className="nc-th-content">
              <span className="nc-th-icon-stack">
                <span className="nc-th-icon"><PropertyIcon prop={col.prop} size={16} /></span>
                <span className="nc-th-drag"><Icon name="dragHandle" size={14} /></span>
              </span>
              <span className="nc-th-name" data-tooltip={col.prop.name.length > 18 ? col.prop.name : undefined}>{col.prop.name}</span>
            </div>
          </div>
          {!structureRO && (
            <div className="nc-th-resize-wrap">
              <div className="nc-th-resize" onMouseDown={(e) => startResize(e, col)} onDoubleClick={() => autofit(col)} />
            </div>
          )}
        </div>
      ))}
      {dragCol?.over === columns.length && <div className="nc-th-drop-end" />}
      {!structureRO && (
        <div className="nc-th-add">
          {columns.length <= 1 && Object.keys(collection.schema).length <= 1 ? (!schemaRO && (
            <div role="button" className="nc-add-property-btn" data-testid="add-column-button" aria-haspopup="dialog" onClick={(e) => openAddPropertyMenu(e.currentTarget, { collectionId: collection.id, view })}>
              <Plus size={13} aria-hidden className="nc-add-property-plus" />
              <span>Add property</span>
            </div>
          )) : (
            <>
              {/* while “+ Add property” is open, the new column occupies a 378px slot and pushes “•••” after it */}
              {schemaRO ? null : pendingAdd ? <div className="nc-th-pending" /> : (
                <div role="button" className="nc-th-icon-btn" data-testid="add-column-button" aria-label="Add property" data-tooltip="Add property" onClick={(e) => { setPendingAdd(true); openAddPropertyMenu(e.currentTarget, { collectionId: collection.id, view, onClose: () => setPendingAdd(false) }); }}>
                  <Icon name="plusSmall" size={16} />
                </div>
              )}
              <div role="button" className="nc-th-icon-btn lit-table-view-add-column" aria-label="Display or conceal fields" data-tooltip="Display or conceal fields" onClick={(e) => openPropertyVisibility(e.currentTarget, view, collection)}>
                <Icon name="ellipsisSmall" size={16} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  const colorsOf = useConditionalColors(view, collection);
  // cell selection + fill handle / ⌘D / ⌘R 
  const cellSelection = useCellSelection(tableRef, { collection, readOnly });
  const renderRows = (rows: BlockRecord[], group?: GroupResult) => {
    const shown = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
    return (
      <>
        {shown.flatMap(function tree(row: BlockRecord): ReactNode[] {
          const info = subitemInfoFor(row, sub?.depth[row.id] ?? 0, sub, view, isOpen);
          const kids = info?.open ? sub!.children[row.id] ?? [] : [];
          const el = (
          <TableRow
            key={row.id}
            row={row}
            subitem={info}
            subitemCount={sub?.mode === 'flattened' ? sub.counts[row.id] ?? 0 : 0}
            contextRow={!!sub?.context.includes(row.id)}
            columns={columns}
            collection={collection}
            view={view}
            readOnly={readOnly && !canEditRow(row.id)}
            minWidth={pendingAdd && headWidth ? headWidth : rowMinWidth}
            verticalLines={verticalLines}
            selected={selection.includes(row.id)}
            peeking={peekId === row.id}
            colors={colorsOf(row)}
            dropIndicator={dragRow && dragRow.overId === row.id && dragRow.id !== row.id ? (dragRow.before ? 'before' : 'after') : null}
            onDragStart={(e) => {
              setDragRow({ id: row.id, overId: null, before: true, overGroup: group });
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', row.id);
              // dropped on the page outside the database, the row(s) become page blocks 
              startRowDrag(e, selection.includes(row.id) ? selection : [row.id]);
            }}
            onDragOver={(e, before) => {
              if (!dragRow) return;
              e.preventDefault();
              setDragRow({ ...dragRow, overId: row.id, before, overGroup: group });
            }}
            onDrop={() => {
              if (!dragRow || dragRow.id === row.id) return setDragRow(null);
              const gb = result.groupBy;
              moveRow(view, collection.id, dragRow.id, dragRow.before ? { before: row.id } : { after: row.id }, (tx) => {
                if (gb && group && dragRow.overGroup) assignGroupInTx(tx, dragRow.id, gb.property, collection, group);
              });
              setDragRow(null);
            }}
            onDragEnd={() => { setDragRow(null); endRowDrag(); }}
          />
          );
          if (!info?.open) return [el];
          return [el, ...kids.flatMap(tree), ...(canAdd ? [<NewSubitemRow key={`new-sub-${row.id}`} parent={row} view={view} depth={info.depth + 1} className="nc-table-subitem-new" />] : [])];
        })}
        {rows.length > shown.length && (
          <div role="button" className="nc-table-load-more" data-testid="collection-load-more" onClick={() => setLimit((l) => l + (Number.isFinite(firstLimit) ? firstLimit : 50))}>
            <Icon name="arrowDown" size={14} />
            <span>Load more</span>
          </div>
        )}
        {canAdd && <NewRowButton onClick={() => db?.addRow({ group: group ?? null, position: 'end', editTitle: true })} />}
      </>
    );
  };

  const emptyPlaceholders = !result.total && !hasFilter && !groups?.length;
  const body = (
    <>
      {emptyPlaceholders ? (
        <EmptyPlaceholderRows count={inline ? 3 : 5} columns={columns} readOnly={!canAdd} onAdd={() => db?.addRow({ position: 'end', editTitle: true })} />
      ) : groups ? (
        <>
          {groups.filter((g) => !g.hidden).map((g) => (
            <div key={g.id} className="nc-table-group" style={groupColorVars(g)}>
              <GroupHeader group={g} view={view} collection={collection} readOnly={readOnly} collapsed={collapsed.has(g.id)} onToggle={() => collapsed.toggle(g.id)} onAdd={() => db?.addRow({ group: g, position: 'end', editTitle: true })} sticky />
              {!collapsed.has(g.id) && (
                <div className="nc-table-group-body">
                  {headerRow}
                  {renderRows(g.rows, g)}
                  <CalcFooter columns={columns} view={view} collection={collection} rows={g.rows} readOnly={structureRO} />
                </div>
              )}
            </div>
          ))}
          <HiddenGroups groups={groups.filter((g) => g.hidden)} view={view} collection={collection} onShow={(g) => setSavedGroups(view, savedGroupsFrom(groups.map((x) => (x.id === g.id ? { ...x, hidden: false } : x)), result.groupBy!.property, savedGroupsOf(view)), { action: 'showGroup' })} />
        </>
      ) : (
        <>
          {renderRows(result.rows)}
        </>
      )}
    </>
  );

  return (
    <div
      className="lit-table-view"
      data-table-view={view.id}
      style={{ paddingInlineStart: bleed.left, paddingInlineEnd: bleed.right, paddingBottom: inline ? 0 : 180 } as CSSProperties}
    >
      <div ref={tableRef} className={`nc-table ${verticalLines ? 'vlines' : ''} ${narrow ? 'narrow' : ''}`} style={{ ['--nc-table-width' as any]: `${totalWidth}px` }}>
        {!groups && headerRow}
        {body}
        {!groups && !emptyPlaceholders && <CalcFooter columns={columns} view={view} collection={collection} rows={result.rows} aggregations={result.aggregations} readOnly={structureRO} />}
        {cellSelection}
      </div>
    </div>
  );
}

function assignGroupInTx(tx: Tx, rowId: string, propId: string, collection: CollectionRecord, group: GroupResult) {
  const prop = collection.schema[propId];
  if (!prop) return;
  const a = groupAssignment(group, prop);
  if (!a) return;
  tx.set('block', rowId, ['properties', propId], encodeAssignment(prop, a.kind, a.value, collection.space_id));
}

function NewRowButton({ onClick, label = 'New page' }: { onClick: () => void; label?: string }) {
  return (
    <div className="nc-table-add-row-wrap">
      <div role="button" className="lit-table-view-add-row" onClick={onClick}>
        <Icon name="plusSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />
        <span>{label}</span>
      </div>
    </div>
  );
}

function EmptyPlaceholderRows({ count, columns, readOnly, onAdd }: { count: number; columns: Column[]; readOnly: boolean; onAdd: () => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="nc-table-empty" onMouseLeave={() => setHover(0)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          role="button"
          className="lit-table-view-empty-placeholder"
          style={i === count - 1 ? { marginBottom: 6 } : undefined}
          onMouseEnter={() => setHover(i)}
          onClick={() => !readOnly && onAdd()}
        >
          <span className="nc-empty-placeholder-cells">
            {columns.map((c, ci) => (
              <div key={c.property} className="nc-empty-placeholder-cell" style={{ width: c.w }}>
                {ci === 0 && i === hover && !readOnly && (
                  <div className="nc-empty-placeholder-new">
                    <Icon name="plusSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />
                    New page
                  </div>
                )}
              </div>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function TableRow({ row, columns, collection, view, readOnly, minWidth, verticalLines, selected, peeking, colors, dropIndicator, onDragStart, onDragOver, onDrop, onDragEnd, subitem, subitemCount = 0, contextRow }: {
  row: BlockRecord; columns: Column[]; collection: CollectionRecord; view: CollectionViewRecord; readOnly: boolean; minWidth: number | string; verticalLines: boolean; selected: boolean; peeking: boolean;
  subitem?: SubitemRowInfo | null; subitemCount?: number; contextRow?: boolean;
  colors?: ConditionalColors | null;
  dropIndicator: 'before' | 'after' | null;
  onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent, before: boolean) => void; onDrop: () => void; onDragEnd: () => void;
}) {
  const db = useDatabaseContext();
  const fmt = (view.format ?? {}) as Record<string, any>;
  const showIcon = fmt.show_page_icon !== false;
  const editing = db?.editingTitle === row.id;
  return (
    <div
      className={`lit-selectable lit-page-block lit-collection-item nc-table-row-outer ${selected ? 'selected' : ''} ${peeking ? 'peeking' : ''} ${contextRow ? 'nc-subitem-context' : ''}`}
      data-block-id={row.id}
      onContextMenu={(e) => {
        e.preventDefault();
        openRowMenu({ x: e.clientX, y: e.clientY }, { rowIds: db?.selection.includes(row.id) ? db.selection : [row.id], collection, view });
      }}
      onDragOver={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(e, e.clientY < r.top + r.height / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {dropIndicator && <div className={`nc-row-drop-indicator ${dropIndicator}`} />}
      <div className="nc-table-gutter-sticky">
        {/* row gutter: “+”, drag handle, and checkbox */}
        <div className="nc-row-gutter">
          {/* DOM order checkbox, drag handle, “+”; row-reverse lays them out right to left */}
          <div className={`nc-row-checkbox-wrap ${selected ? 'visible' : ''}`}>
            <label className="nc-row-checkbox-label">
              <span className={`nc-row-checkbox ${selected ? 'checked' : ''}`} onClick={() => db?.setSelection((s) => (s.includes(row.id) ? s.filter((x) => x !== row.id) : [...s, row.id]))}>
                {selected && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}
              </span>
            </label>
          </div>
          {!readOnly && (
            <div
              role="button"
              className="nc-row-drag"
              aria-label="Drag to send, click to launch menu"
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onClick={(e) => openRowMenu(e.currentTarget, { rowIds: [row.id], collection, view })}
            >
              <Icon name="dragHandle" size={14} />
            </div>
          )}
          {!readOnly && (
            <div
              role="button"
              className="nc-row-add"
              aria-label="Add a row below (Option-click adds one above)"
              data-tooltip="Click to add below"
              data-tooltip-sub="Option-click to add a block above"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => db?.addRow(e.altKey ? { before: row.id, editTitle: true } : { after: row.id, editTitle: true })}
            >
              <Plus size={16} aria-hidden className="nc-gutter-plus" />
            </div>
          )}
        </div>
      </div>
      <div className="lit-table-view-row" style={{ minWidth }}>
        {columns.map((col) => (
          <div
            key={col.property}
            className={`lit-table-view-cell ${verticalLines ? '' : 'no-vline'} ${col.frozen ? 'frozen' : ''} ${col.wrap ? 'wrap' : 'nowrap'} type-${col.prop.type}`}
            data-col={col.property}
            style={{ width: col.w, ...(col.frozen ? { position: 'sticky', left: col.left + GUTTER, zIndex: 2 } : {}), ...((colors?.cells[col.property] ?? colors?.row) ? { background: conditionalBg(colors?.cells[col.property] ?? colors?.row) } : {}) }}
          >
            {col.property === 'title' ? (
              <TitleCell row={row} view={view} collection={collection} readOnly={readOnly} wrap={col.wrap} showIcon={showIcon} editing={editing} width={col.w} peeking={peeking} subitem={subitem} subitemCount={subitemCount} />
            ) : (
              <>
                <PropertyCell row={row} schema={collection.schema} propId={col.property} readOnly={readOnly} view={view} wrap={col.wrap} className="nc-cell-measure" rowIds={db?.selection.includes(row.id) && db.selection.length > 1 ? db.selection : undefined} />
                {/* 💬 on a property value: hover a cell with a value; threads show their count */}
                {cellCommentable(row, collection, col.property) && <PropertyCommentButton page={row} col={collection} propId={col.property} />}
              </>
            )}
          </div>
        ))}
      </div>
      {selected && <div className="lit-selectable-halo" />}
    </div>
  );
}

//: no comments on Name, formulas, rollups, buttons, unique IDs; checkboxes are commented from the page
const NO_CELL_COMMENTS = new Set(['title', 'formula', 'rollup', 'button', 'auto_increment_id', 'checkbox', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by']);

/** A table cell offers 💬 when its property can be commented and it has a value (or already has threads). */
function cellCommentable(row: BlockRecord, collection: CollectionRecord, propId: string): boolean {
  const prop = collection.schema[propId];
  if (!prop || NO_CELL_COMMENTS.has(prop.type)) return false;
  if (propertyDiscussions(row, propId).length) return true;
  const v = row.properties?.[propId] as unknown[] | undefined;
  return Array.isArray(v) && v.length > 0 && JSON.stringify(v) !== '[[""]]';
}

function TitleCell({ row, view, collection, readOnly, wrap, showIcon, editing, width, peeking, subitem, subitemCount = 0 }: { row: BlockRecord; view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean; wrap: boolean; showIcon: boolean; editing: boolean; width: number; peeking: boolean; subitem?: SubitemRowInfo | null; subitemCount?: number }) {
  const db = useDatabaseContext();
  const [edit, setEdit] = useState(editing);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) setEdit(true);
  }, [editing]);
  useEffect(() => {
    if (!edit) return;
    const el = ref.current?.querySelector<HTMLElement>('[contenteditable]');
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  }, [edit]);
  const title = (row.properties?.title as RichText | undefined) ?? [];
  const peekMode = db?.peekMode ?? 'side_peek';
  const openLabel = peeking ? 'Close' : 'Open';
  return (
    <div className={`nc-title-cell ${wrap ? 'wrap' : 'nowrap'} ${edit && !readOnly ? 'editing' : ''} ${subitem ? 'nested' : ''}`} ref={ref} onClick={() => !readOnly && !edit && setEdit(true)}>
      {subitem && <SubitemToggle info={subitem} />}
      {showIcon && (
        <div className="lit-record-icon nc-title-cell-icon" onClick={(e) => { e.stopPropagation(); db?.openRow(row.id); }}>
          {/* no icon: outline page glyph is about 14x18, larger than an 18px emoji slot */}
          {iconOf(row) ? <PageIcon block={row} size={18} /> : <Icon name={row.content?.length ? 'page' : 'dbPageEmpty'} size={21} />}
        </div>
      )}
      {edit && !readOnly ? (
        <RichTextEditable
          blockId={row.id}
          property="title"
          value={title}
          className="nc-title-cell-leaf editing"
          placeholder=""
          onChange={(next) => setValue(row.id, 'title', next, { coalesce: `title:${row.id}` })}
          onBlur={() => {
            setEdit(false);
            if (db?.editingTitle === row.id) db.setEditingTitle(null);
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' && !e.nativeEvent.isComposing) || e.key === 'Escape') {
              e.preventDefault();
              (e.currentTarget as HTMLElement).blur();
            }
          }}
        />
      ) : (
        <>
          <div className="nc-title-cell-text nc-cell-measure" style={subitemCount > 0 ? { flex: '0 1 auto' } : undefined}>{title.length ? highlightText(title.map((d) => d[0]).join(''), db?.search) : <span className="nc-title-cell-untitled" />}</div>
          {subitemCount > 0 && <SubitemCount count={subitemCount} />}
        </>
      )}
      {width >= 80 && !edit && (
        <div className="nc-open-quick-action">
          <div className="quickActionContainer">
            <div
              role="button"
              className="nc-open-button"
              aria-label={peeking ? 'Close side preview' : peekMode === 'center_peek' ? 'Open in center preview' : peekMode === 'full_page' ? 'Open as entry' : 'Open in side preview'}
              onClick={(e) => {
                e.stopPropagation();
                db?.openRow(row.id);
              }}
            >
              <Icon name={peekMode === 'center_peek' ? 'centerPeek' : peekMode === 'full_page' ? 'arrowExpandDiagonal' : 'peekSideFill'} size={14} />
              {width >= 100 && <span>{openLabel}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CALC_SHORT: Record<string, string> = {
  count: 'COUNT', count_values: 'VALUES', unique: 'UNIQUE', empty: 'EMPTY', not_empty: 'NOT EMPTY', percent_empty: 'EMPTY', percent_not_empty: 'NOT EMPTY',
  sum: 'SUM', average: 'AVERAGE', median: 'MEDIAN', min: 'MIN', max: 'MAX', range: 'RANGE', earliest_date: 'EARLIEST', latest_date: 'LATEST', date_range: 'RANGE',
  checked: 'CHECKED', unchecked: 'UNCHECKED', percent_checked: 'CHECKED', percent_unchecked: 'UNCHECKED', count_per_group: 'COUNT', percent_per_group: 'PERCENT',
};

/** Calculation row (also under the timeline's table, — `always` shows the "Calculate" placeholders before * any calculation is set, since that table has no header menus). */
export function CalcFooter({ columns, view, collection, rows, aggregations, readOnly, always }: { columns: Pick<Column, 'property' | 'prop' | 'w'>[]; view: CollectionViewRecord; collection: CollectionRecord; rows: BlockRecord[]; aggregations?: Record<string, AggregationResult>; readOnly?: boolean; always?: boolean }) {
  const specs = ((view.query2?.aggregations ?? []) as AggregationSpec[]).filter((a) => a.property);
  const local = useMemo(() => {
    if (aggregations || !specs.length) return {} as Record<string, AggregationResult>;
    const ctx = makeQueryContext();
    const out: Record<string, AggregationResult> = {};
    for (const spec of specs) if (spec.property && collection.schema[spec.property]) out[spec.property] = aggregateRows(rows, spec, collection.schema, ctx);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregations, rows, JSON.stringify(specs), collection]);
  const res = aggregations ?? local;
  // has no footer row (and no hover "Calculate" placeholders) until a column has a calculation — set one from
  // the header menu › Calculate (4, table / table-hover: block 239px tall)
  if (!specs.length && !always) return null;
  return (
    <div className={`nc-table-calc-row ${specs.length ? 'has-calc' : ''}`}>
      {columns.map((col) => {
        const r = res[col.property];
        const agg = r?.aggregator;
        return (
          <div key={col.property} className="nc-table-calc-cell" data-col={col.property} style={{ width: col.w }}>
            <div
              role="button"
              className={`nc-table-calc-button ${r ? 'set' : ''}`}
              onClick={(e) => !readOnly && openMenu(e.currentTarget, calculateMenuDef(col.prop, agg ?? 'none', (a) => setAggregation(view, col.property, a as any)), { placement: 'top-end' })}
            >
              {r && agg !== 'none' ? (
                <>
                  <span className="nc-table-calc-label">{CALC_SHORT[agg!] ?? (AGGREGATION_LABELS[agg!]?.short ?? agg)}</span>
                  <span className="nc-table-calc-value">{r.display}</span>
                </>
              ) : (
                <span className="nc-table-calc-placeholder">Calculate <Icon name="arrowChevronSingleDownSmall" size={12} /></span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

registerView('table', TableView);
export { TableView };
