// Simple table (table > table_row). Cells have a 1px solid
// var(--lp-border-primary), text padding 7px 9px, 14px/20px, tr height 34px; widths format.table_block_column_format
// (new tables fill the column: 3 × 239.67px on a 720px page); table starts 14px right of the block edge.
// Header row / column (format.table_block_column_header / table_block_row_header): var(--lp-table-header-bg),
// weight 500. Hover: column grips 18×6 above each column, row grips 6×18 left of each row, "+" bars right
// (16×H, add column) and below (W×16, add row) 8px away, "+" corner. Column menu: Color, Insert left/right,
// Duplicate, Clear contents, and Delete. Cell range selection uses 2px rgb(129, 140, 248)
// rectangle; Escape in a cell selects it. Color precedence cell > row > column.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { COLOR_LABELS, COLOR_NAMES } from '@nc/shared/colors.ts';
import { length, toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { RichTextEditable, type LeafApi } from '../RichTextEditable.tsx';
import { commitText, toggleMark } from '../textHandlers.ts';
import { openMenu, type MenuDef, type MenuItemDef } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { useRecords } from '../../../lib/hooks.ts';
import { createBlockIn, getBlock, run, setFormat, setProperty, touch } from '../../../lib/blocks.ts';
import { transactions } from '../../../lib/store/transactions.ts';
import type { Tx } from '../../../lib/store/transactions.ts';
import { useEditor } from '../editorState.ts';
import { neighborLeaf } from '../commands.ts';
import { columnId, createSimpleTable } from './factories.ts';
import { registerBlockMenu, overrideSlashItem } from './registry.ts';
import { LiveSwitch, containerWidthOf, toast } from './shared.tsx';
import { createViewIn } from '../../database/createDatabase.ts';
import { colorToken } from '../../../lib/colorToken.ts';

const DEFAULT_COL_WIDTH = 120;
const MIN_COL_WIDTH = 32;

interface CellSel {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

type ColFormat = Record<string, { width?: number; color?: string }>;

function colOrder(b: BlockRecord): string[] {
  return (b.format?.table_block_column_order as string[] | undefined) ?? [];
}

function colFormat(b: BlockRecord): ColFormat {
  return (b.format?.table_block_column_format as ColFormat | undefined) ?? {};
}

function widthOf(b: BlockRecord, col: string): number {
  return colFormat(b)[col]?.width ?? DEFAULT_COL_WIDTH;
}

function liveRows(b: BlockRecord): BlockRecord[] {
  return (b.content ?? []).map((id) => getBlock(id)).filter((r): r is BlockRecord => !!r && r.alive && r.type === 'table_row');
}

function colorStyle(color: string | undefined): React.CSSProperties | undefined {
  if (!color || color === 'default') return undefined;
  const base = color.replace('_background', '');
  const p = base === 'teal' ? 'gre' : base.slice(0, 3);
  return color.endsWith('_background') ? { background: `var(${colorToken(p, 'bg-secondary')})` } : { color: `var(${colorToken(p, 'text-secondary')})` };
}

/* ------------------------------------------------------------------ structural edits */

function insertColumn(tableId: string, at: number, opts?: { copyFrom?: string }) {
  const b = getBlock(tableId);
  if (!b) return;
  const order = colOrder(b);
  const id = columnId();
  const fmt = colFormat(b);
  const next = [...order.slice(0, at), id, ...order.slice(at)];
  run('table.insertColumn', (tx) => {
    const nf: ColFormat = { ...fmt };
    if (opts?.copyFrom) nf[id] = { ...(fmt[opts.copyFrom] ?? {}) };
    setFormat(tx, tableId, { table_block_column_order: next, table_block_column_format: nf });
    if (opts?.copyFrom) for (const r of liveRows(b)) {
      const v = r.properties?.[opts.copyFrom];
      if (v) setProperty(tx, r.id, id, v);
    }
  });
  return id;
}

function deleteColumn(tableId: string, col: string) {
  const b = getBlock(tableId);
  if (!b) return;
  const order = colOrder(b);
  if (order.length <= 1) return deleteTableBlock(tableId);
  const fmt = { ...colFormat(b) };
  delete fmt[col];
  run('table.deleteColumn', (tx) => {
    setFormat(tx, tableId, { table_block_column_order: order.filter((c) => c !== col), table_block_column_format: fmt });
    for (const r of liveRows(b)) if (r.properties?.[col]) tx.set('block', r.id, ['properties', col], undefined);
  });
}

function insertRow(tableId: string, index: number, opts?: { copyFrom?: string }): string {
  const b = getBlock(tableId);
  if (!b) return '';
  const rows = liveRows(b);
  const id = newId();
  run('table.insertRow', (tx) => {
    const src = opts?.copyFrom ? getBlock(opts.copyFrom) : undefined;
    const props = src?.properties ? structuredClone(src.properties) : undefined;
    const before = rows[index]?.id;
    createBlockIn(tx, {
      id, type: 'table_row', parentId: tableId, parentTable: 'block', properties: props as any, format: src?.format ? structuredClone(src.format) : {},
      ...(before ? { before } : { after: rows[rows.length - 1]?.id }),
    });
  });
  return id;
}

function deleteRow(tableId: string, rowId: string) {
  const b = getBlock(tableId);
  if (!b) return;
  if (liveRows(b).length <= 1) return deleteTableBlock(tableId);
  run('table.deleteRow', (tx) => {
    tx.listRemove('block', tableId, ['content'], rowId);
    tx.update('block', rowId, [], { alive: false });
  });
}

function deleteTableBlock(tableId: string) {
  const b = getBlock(tableId);
  if (!b) return;
  run('deleteBlocks', (tx) => {
    tx.listRemove('block', b.parent_id, ['content'], tableId);
    tx.update('block', tableId, [], { alive: false });
  });
}

function clearCells(tableId: string, rows: string[], cols: string[]) {
  run('table.clearContents', (tx) => {
    for (const rid of rows) {
      const r = getBlock(rid);
      for (const c of cols) if (r?.properties?.[c] && length(r.properties[c] as RichText)) setProperty(tx, rid, c, []);
    }
  });
  void tableId;
}

/* ------------------------------------------------------------------ merged cells  */
// format.table_block_merges = [{ row, col, rows, cols }]: the anchor cell (top-left row/column id) spans `rows` × `cols`.
interface Merge { row: string; col: string; rows: number; cols: number }
interface Span { r: number; c: number; rs: number; cs: number }

function mergesOf(b: BlockRecord): Merge[] {
  const m = (b.format as Record<string, unknown> | undefined)?.table_block_merges;
  return Array.isArray(m) ? (m as Merge[]).filter((x) => x && typeof x.row === 'string' && typeof x.col === 'string') : [];
}

/** Merges in the table's current row/column order (spans clamped to the grid; anchors that no longer exist dropped). */
function spansOf(b: BlockRecord, rows: BlockRecord[], cols: string[]): Span[] {
  const out: Span[] = [];
  for (const m of mergesOf(b)) {
    const r = rows.findIndex((x) => x.id === m.row);
    const c = cols.indexOf(m.col);
    if (r < 0 || c < 0) continue;
    const rs = Math.max(1, Math.min(m.rows, rows.length - r));
    const cs = Math.max(1, Math.min(m.cols, cols.length - c));
    if (rs > 1 || cs > 1) out.push({ r, c, rs, cs });
  }
  return out;
}

function spanAt(spans: Span[], r: number, c: number): Span | undefined {
  return spans.find((s) => r >= s.r && r < s.r + s.rs && c >= s.c && c < s.c + s.cs);
}

/** Merge cells: the top-left cell keeps its content, the others are cleared (help: "Merge cells"). */
function mergeCells(tableId: string, sel: CellSel) {
  const b = getBlock(tableId);
  if (!b) return;
  const rows = liveRows(b);
  const cols = colOrder(b);
  const r0 = Math.min(sel.r0, sel.r1), r1 = Math.max(sel.r0, sel.r1);
  const c0 = Math.min(sel.c0, sel.c1), c1 = Math.max(sel.c0, sel.c1);
  if (r0 === r1 && c0 === c1) return;
  const spans = spansOf(b, rows, cols);
  const keep = mergesOf(b).filter((m) => {
    const s = spans.find((x) => rows[x.r]?.id === m.row && cols[x.c] === m.col);
    return !s || s.r + s.rs - 1 < r0 || s.r > r1 || s.c + s.cs - 1 < c0 || s.c > c1;
  });
  run('table.mergeCells', (tx) => {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r === r0 && c === c0) continue;
        const row = rows[r];
        if (row && length(row.properties?.[cols[c]] as RichText | undefined)) setProperty(tx, row.id, cols[c], []);
      }
    }
    setFormat(tx, tableId, { table_block_merges: [...keep, { row: rows[r0].id, col: cols[c0], rows: r1 - r0 + 1, cols: c1 - c0 + 1 }] } as any);
  });
}

function unmergeCells(tableId: string, anchorRow: string, anchorCol: string) {
  const b = getBlock(tableId);
  if (!b) return;
  run('table.unmergeCells', (tx) => setFormat(tx, tableId, { table_block_merges: mergesOf(b).filter((m) => !(m.row === anchorRow && m.col === anchorCol)) } as any));
}

/** ⌘D fill down / ⌘R fill right: the first row (column) of the selection is over the rest. */
function fillCells(tableId: string, sel: CellSel, dir: 'down' | 'right') {
  const b = getBlock(tableId);
  if (!b) return;
  const rows = liveRows(b);
  const cols = colOrder(b);
  const r0 = Math.min(sel.r0, sel.r1), r1 = Math.max(sel.r0, sel.r1);
  const c0 = Math.min(sel.c0, sel.c1), c1 = Math.max(sel.c0, sel.c1);
  if ((dir === 'down' && r0 === r1) || (dir === 'right' && c0 === c1)) return;
  run(dir === 'down' ? 'table.fillDown' : 'table.fillRight', (tx) => {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if ((dir === 'down' && r === r0) || (dir === 'right' && c === c0)) continue;
        const src = dir === 'down' ? rows[r0] : rows[r];
        const srcCol = dir === 'down' ? cols[c] : cols[c0];
        const v = (src?.properties?.[srcCol] as RichText | undefined) ?? [];
        if (rows[r]) setProperty(tx, rows[r].id, cols[c], v);
      }
    }
  });
}

function moveColumn(tableId: string, from: number, to: number) {
  const b = getBlock(tableId);
  if (!b || from === to) return;
  const order = colOrder(b).slice();
  const [c] = order.splice(from, 1);
  order.splice(to > from ? to - 1 : to, 0, c);
  run('table.moveColumn', (tx) => setFormat(tx, tableId, { table_block_column_order: order }));
}

function moveRow(tableId: string, from: number, to: number) {
  const b = getBlock(tableId);
  if (!b) return;
  const rows = liveRows(b);
  const row = rows[from];
  if (!row || from === to || to === from + 1) return;
  run('table.moveRow', (tx) => {
    tx.listRemove('block', tableId, ['content'], row.id);
    const anchor = rows[to];
    if (anchor) tx.listBefore('block', tableId, ['content'], row.id, anchor.id);
    else tx.listAfter('block', tableId, ['content'], row.id, rows[rows.length - 1].id);
  });
}

export function fitTableToWidth(tableId: string) {
  const b = getBlock(tableId);
  if (!b) return;
  const order = colOrder(b);
  const avail = containerWidthOf(tableId) - 1;
  const total = order.reduce((s, c) => s + widthOf(b, c), 0) || 1;
  const fmt = { ...colFormat(b) };
  for (const c of order) fmt[c] = { ...(fmt[c] ?? {}), width: Math.max(MIN_COL_WIDTH, (widthOf(b, c) / total) * avail) };
  run('table.fitToWidth', (tx) => setFormat(tx, tableId, { table_block_column_format: fmt }));
}

/** "Change to database": header row (or "Column N") becomes the schema, first column the title. */
export function turnTableIntoDatabase(tableId: string) {
  const b = getBlock(tableId);
  if (!b) return;
  const order = colOrder(b);
  const rows = liveRows(b);
  const header = !!b.format?.table_block_column_header;
  const names = order.map((c, i) => (header ? toPlainText(rows[0]?.properties?.[c] as RichText | undefined) : '') || (i === 0 ? 'Name' : `Column ${i + 1}`));
  const propIds = order.map((_, i) => (i === 0 ? 'title' : columnId()));
  const schema: Record<string, any> = {};
  order.forEach((_, i) => { schema[propIds[i]] = { name: names[i], type: i === 0 ? 'title' : 'text' }; });
  const dataRows = header ? rows.slice(1) : rows;
  const collectionId = newId();
  run('table.turnIntoDatabase', (tx: Tx) => {
    tx.set('collection', collectionId, [], {
      id: collectionId, name: [], schema, format: { collection_page_properties: propIds.filter((p) => p !== 'title').map((p) => ({ property: p, visible: true })) },
      parent_id: tableId, parent_table: 'block', alive: true, space_id: tx.spaceId, template_pages: [],
    });
    const viewId = createViewIn(tx, tableId, 'table', schema);
    for (const r of dataRows) {
      const props: Record<string, any> = {};
      order.forEach((c, i) => { const v = r.properties?.[c]; if (v && length(v as RichText)) props[propIds[i]] = v; });
      createBlockIn(tx, { type: 'page', parentId: collectionId, parentTable: 'collection', list: null, properties: props });
    }
    for (const r of rows) tx.update('block', r.id, [], { alive: false });
    tx.update('block', tableId, [], { type: 'collection_view', collection_id: collectionId, view_ids: [viewId], content: [] });
    tx.update('block', tableId, ['format'], { table_block_column_order: undefined, table_block_column_format: undefined, table_block_column_header: undefined, table_block_row_header: undefined });
    touch(tx, tableId);
  });
}

/* ------------------------------------------------------------------ menus */

function colorSubmenu(current: string | undefined, apply: (c: string | undefined) => void): () => MenuDef {
  const swatch = (c: string, bg: boolean) => (
    <div className={`nc-color-swatch ${bg ? `lit-bg-${c}` : `lit-color-${c}`}`} style={{ boxShadow: 'inset 0 0 0 1px var(--lp-border-primary-transparent)' }}>{bg ? '' : 'A'}</div>
  );
  return () => ({
    width: 220,
    sections: [
      { title: 'Text color', items: COLOR_NAMES.map((c) => ({ label: `${COLOR_LABELS[c]} text`, icon: swatch(c, false), checked: (current ?? 'default') === c, onSelect: () => apply(c === 'default' ? undefined : c) })) },
      { title: 'Background color', items: COLOR_NAMES.map((c) => ({ label: `${COLOR_LABELS[c]} background`, icon: swatch(c, true), checked: current === `${c}_background`, onSelect: () => apply(c === 'default' ? undefined : `${c}_background`) })) },
    ],
  });
}

function columnMenu(tableId: string, colIdx: number): MenuDef {
  const b = getBlock(tableId)!;
  const col = colOrder(b)[colIdx];
  const fmt = colFormat(b);
  const items: MenuItemDef[] = [
    {
      label: 'Color', icon: 'blockColor',
      submenu: colorSubmenu(fmt[col]?.color, (c) => run('table.columnColor', (tx) => setFormat(tx, tableId, { table_block_column_format: { ...colFormat(getBlock(tableId)!), [col]: { ...(colFormat(getBlock(tableId)!)[col] ?? {}), color: c } } }))),
    },
    { label: 'Insert left', icon: 'arrowStraightLeft', onSelect: () => { insertColumn(tableId, colIdx); } },
    { label: 'Insert right', icon: 'arrowStraightRight', onSelect: () => { insertColumn(tableId, colIdx + 1); } },
    { label: 'Duplicate', icon: 'duplicate', shortcut: '⌘D', onSelect: () => { insertColumn(tableId, colIdx + 1, { copyFrom: col }); } },
    { label: 'Clear contents', icon: 'xMarkCircleFill', onSelect: () => clearCells(tableId, liveRows(b).map((r) => r.id), [col]) },
    { label: 'Delete', icon: 'trash', onSelect: () => deleteColumn(tableId, col) },
  ];
  return { width: 265, search: 'Search actions…', sections: [{ items }] };
}

function rowMenu(tableId: string, rowIdx: number): MenuDef {
  const b = getBlock(tableId)!;
  const row = liveRows(b)[rowIdx];
  const items: MenuItemDef[] = [
    {
      label: 'Color', icon: 'blockColor',
      submenu: colorSubmenu(row?.format?.block_color as string | undefined, (c) => run('table.rowColor', (tx) => setFormat(tx, row.id, { block_color: c }))),
    },
    { label: 'Insert above', icon: 'arrowStraightUp', onSelect: () => { insertRow(tableId, rowIdx); } },
    { label: 'Insert below', icon: 'arrowStraightDown', onSelect: () => { insertRow(tableId, rowIdx + 1); } },
    { label: 'Duplicate', icon: 'duplicate', shortcut: '⌘D', onSelect: () => { insertRow(tableId, rowIdx + 1, { copyFrom: row.id }); } },
    { label: 'Clear contents', icon: 'xMarkCircleFill', onSelect: () => clearCells(tableId, [row.id], colOrder(b)) },
    { label: 'Delete', icon: 'trash', onSelect: () => deleteRow(tableId, row.id) },
  ];
  return { width: 265, search: 'Search actions…', sections: [{ items }] };
}

function cellMenu(tableId: string, sel: CellSel): MenuDef {
  const b = getBlock(tableId)!;
  const rows = liveRows(b);
  const order = colOrder(b);
  const rIds = rows.slice(Math.min(sel.r0, sel.r1), Math.max(sel.r0, sel.r1) + 1).map((r) => r.id);
  const cIds = order.slice(Math.min(sel.c0, sel.c1), Math.max(sel.c0, sel.c1) + 1);
  const first = getBlock(rIds[0]);
  const cur = (first?.format?.cell_format as any)?.[cIds[0]]?.color as string | undefined;
  return {
    width: 265,
    sections: [{
      items: [
        {
          label: 'Color', icon: 'blockColor',
          submenu: colorSubmenu(cur, (c) => run('table.cellColor', (tx) => {
            for (const rid of rIds) {
              const r = getBlock(rid);
              const cf = { ...((r?.format?.cell_format as Record<string, { color?: string }> | undefined) ?? {}) };
              for (const cid of cIds) cf[cid] = { ...(cf[cid] ?? {}), color: c };
              setFormat(tx, rid, { cell_format: cf });
            }
          })),
        },
        ...mergeItems(tableId, sel),
        { label: 'Clear contents', icon: 'xMarkCircleFill', onSelect: () => clearCells(tableId, rIds, cIds) },
      ],
    }],
  };
}

/** "Merge cells" for a rectangular range, "Unmerge cells" on a merged cell. */
function mergeItems(tableId: string, sel: CellSel): MenuItemDef[] {
  const b = getBlock(tableId)!;
  const rows = liveRows(b);
  const cols = colOrder(b);
  const spans = spansOf(b, rows, cols);
  const multi = sel.r0 !== sel.r1 || sel.c0 !== sel.c1;
  const merged = spanAt(spans, Math.min(sel.r0, sel.r1), Math.min(sel.c0, sel.c1));
  const exactlyMerged = merged && Math.min(sel.r0, sel.r1) === merged.r && Math.min(sel.c0, sel.c1) === merged.c
    && (!multi || (Math.max(sel.r0, sel.r1) === merged.r + merged.rs - 1 && Math.max(sel.c0, sel.c1) === merged.c + merged.cs - 1));
  const out: MenuItemDef[] = [];
  if (exactlyMerged) out.push({ label: 'Unmerge cells', icon: 'tableSplit', onSelect: () => unmergeCells(tableId, rows[merged.r].id, cols[merged.c]) });
  else if (multi) out.push({ label: 'Merge cells', icon: 'tableMerge', onSelect: () => mergeCells(tableId, sel) });
  return out;
}

/* ------------------------------------------------------------------ cells */

function TableCell({ table, row, col, r, c, readOnly, onEscape, onNavigate }: { table: BlockRecord; row: BlockRecord; col: string; r: number; c: number; readOnly: boolean; onEscape: () => void; onNavigate: (dir: 'next' | 'prev' | 'down' | 'up', api: LeafApi, e: React.KeyboardEvent) => boolean }) {
  const value = (row.properties?.[col] as RichText | undefined) ?? [];
  const onChange = useMemo(() => (next: RichText, info: { caret: number }) => commitText(row.id, col, next, info.caret), [row.id, col]);
  return (
    <RichTextEditable
      blockId={row.id}
      property={col}
      value={value}
      readOnly={readOnly}
      className="lit-table-cell-text content-editable-leaf-rtl"
      placeholder=" "
      onChange={onChange}
      onPaste={(e, api) => {
        e.preventDefault();
        const plain = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
        if (!plain) return;
        const sel = api.selection() ?? { start: 0, end: 0 };
        const cur = toPlainText(api.value());
        const nextText = cur.slice(0, sel.start) + plain + cur.slice(sel.end);
        commitText(row.id, col, nextText ? [[nextText]] : [], sel.start + plain.length, { coalesce: false, action: 'paste' });
        useEditor.getState().requestFocus(row.id, sel.start + plain.length, { property: col });
      }}
      onKeyDown={(e, api) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && !e.altKey && !e.shiftKey && ['b', 'i', 'u', 'e'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          toggleMark(row.id, col, api, ({ b: ['b'], i: ['i'], u: ['_'], e: ['c'] } as Record<string, any>)[e.key.toLowerCase()]);
          return;
        }
        if (mod && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) transactions.redo();
          else transactions.undo();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onEscape();
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          onNavigate(e.shiftKey ? 'prev' : 'next', api, e);
          return;
        }
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (e.shiftKey) {
            const sel = api.selection() ?? { start: 0, end: 0 };
            const cur = toPlainText(api.value());
            const t = cur.slice(0, sel.start) + '\n' + cur.slice(sel.end);
            commitText(row.id, col, [[t]], sel.start + 1, { coalesce: false });
            useEditor.getState().requestFocus(row.id, sel.start + 1, { property: col });
          } else onNavigate('down', api, e);
          return;
        }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !mod) {
          const line = api.caretLine();
          if ((e.key === 'ArrowUp' && line.first) || (e.key === 'ArrowDown' && line.last)) {
            if (onNavigate(e.key === 'ArrowUp' ? 'up' : 'down', api, e)) e.preventDefault();
          }
          return;
        }
        if (e.key === 'ArrowLeft' && !e.shiftKey && api.atStart()) {
          const prev = neighborLeaf(row.id, -1, col);
          if (prev) {
            e.preventDefault();
            useEditor.getState().requestFocus(prev.dataset.blockId!, 'end', { property: prev.dataset.property ?? 'title' });
          }
          return;
        }
        if (e.key === 'ArrowRight' && !e.shiftKey && api.atEnd()) {
          const next = neighborLeaf(row.id, 1, col);
          if (next) {
            e.preventDefault();
            useEditor.getState().requestFocus(next.dataset.blockId!, 0, { property: next.dataset.property ?? 'title' });
          }
        }
        void table;
        void r;
        void c;
      }}
    />
  );
}

/* ------------------------------------------------------------------ table */

interface Geo {
  colX: number[];
  colW: number[];
  rowY: number[];
  rowH: number[];
  w: number;
  h: number;
}

function TableBlock({ block, readOnly }: BlockProps) {
  const rowRecs = useRecords<BlockRecord>('block', block.content);
  const rows = rowRecs.filter((r): r is BlockRecord => !!r && r.alive && r.type === 'table_row');
  const cols = colOrder(block);
  const fmt = colFormat(block);
  const colHeader = !!block.format?.table_block_column_header;
  const rowHeader = !!block.format?.table_block_row_header;
  const spans = spansOf(block, rows, cols);
  const tableRef = useRef<HTMLTableElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [sel, setSel] = useState<CellSel | null>(null);
  const [highlight, setHighlight] = useState<CellSel | null>(null);
  const [liveW, setLiveW] = useState<{ col: string; w: number } | null>(null);
  const [dragInd, setDragInd] = useState<{ kind: 'row' | 'col'; pos: number } | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;

  const width = (c: string) => (liveW && liveW.col === c ? liveW.w : fmt[c]?.width ?? DEFAULT_COL_WIDTH);

  // geometry for grips / handles / selection rectangles
  useLayoutEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    const measure = () => {
      const tr = t.getBoundingClientRect();
      // a row without merged cells gives the column boxes; with merges everywhere, the widths add up
      const fullRow = Array.from(t.rows).find((row) => row.cells.length === cols.length && Array.from(row.cells).every((cell) => cell.colSpan === 1));
      const colX: number[] = [];
      const colW: number[] = [];
      if (fullRow) for (const cell of Array.from(fullRow.cells)) {
        const r = cell.getBoundingClientRect();
        colX.push(r.left - tr.left);
        colW.push(r.width);
      } else {
        let x = 0;
        for (const c of cols) { colX.push(x); colW.push(width(c)); x += width(c); }
      }
      const rowY: number[] = [];
      const rowH: number[] = [];
      for (const row of Array.from(t.rows)) {
        const r = row.getBoundingClientRect();
        rowY.push(r.top - tr.top);
        rowH.push(r.height);
      }
      setGeo({ colX, colW, rowY, rowH, w: tr.width, h: tr.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    return () => ro.disconnect();
  }, [rows.length, cols.join(','), liveW?.w, JSON.stringify(mergesOf(block))]);

  // cell-range keyboard & clipboard while a selection is active
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      const s = selRef.current;
      if (!s) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.isContentEditable || active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;
      const rIdx = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)];
      if (e.key === 'Escape') {
        e.preventDefault();
        setSel(null);
        useEditor.getState().selectBlocks([block.id], block.id);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
        const [r0, r1] = rIdx(s.r0, s.r1);
        const [c0, c1] = rIdx(s.c0, s.c1);
        clearCells(block.id, rows.slice(r0, r1 + 1).map((r) => r.id), cols.slice(c0, c1 + 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setSel(null);
        const row = rows[s.r1];
        if (row) useEditor.getState().requestFocus(row.id, 'end', { property: cols[s.c1] });
      } else if (mod && !e.shiftKey && !e.altKey && (e.code === 'KeyD' || e.code === 'KeyR')) {
        // ⌘D fill down / ⌘R fill right 
        e.preventDefault();
        e.stopPropagation();
        if (!readOnly) fillCells(block.id, s, e.code === 'KeyD' ? 'down' : 'right');
      } else if (e.key.startsWith('Arrow') && !mod) {
        e.preventDefault();
        const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const nr = Math.max(0, Math.min(rows.length - 1, s.r1 + dr));
        const nc = Math.max(0, Math.min(cols.length - 1, s.c1 + dc));
        setSel(e.shiftKey ? { ...s, r1: nr, c1: nc } : { r0: nr, c0: nc, r1: nr, c1: nc });
      } else if (e.key.length === 1 && !mod && !e.altKey) {
        // typing replaces the anchor cell's content
        const row = rows[s.r0];
        const col = cols[s.c0];
        if (!row || !col) return;
        e.preventDefault();
        setSel(null);
        run('Text.handleMutation', (tx) => setProperty(tx, row.id, col, [[e.key]]));
        useEditor.getState().requestFocus(row.id, 1, { property: col });
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      const s = selRef.current;
      if (!s || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
      const [r0, r1] = [Math.min(s.r0, s.r1), Math.max(s.r0, s.r1)];
      const [c0, c1] = [Math.min(s.c0, s.c1), Math.max(s.c0, s.c1)];
      const grid = rows.slice(r0, r1 + 1).map((r) => cols.slice(c0, c1 + 1).map((c) => toPlainText(r.properties?.[c] as RichText | undefined)));
      e.clipboardData?.setData('text/plain', grid.map((l) => l.join('\t')).join('\n'));
      const esc = (t: string) => t.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);
      e.clipboardData?.setData('text/html', `<table>${grid.map((l) => `<tr>${l.map((t) => `<td>${esc(t)}</td>`).join('')}</tr>`).join('')}</table>`);
      e.preventDefault();
      if (e.type === 'cut') clearCells(block.id, rows.slice(r0, r1 + 1).map((r) => r.id), cols.slice(c0, c1 + 1));
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(`[data-table-id="${block.id}"]`) && !(e.target as HTMLElement).closest?.('.lit-overlay-container')) setSel(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('copy', onCopy, true);
    window.addEventListener('cut', onCopy, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('copy', onCopy, true);
      window.removeEventListener('cut', onCopy, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [sel, rows, cols, block.id]);

  const focusCell = (r: number, c: number, where: 'start' | 'end' = 'end') => {
    const row = rows[r];
    if (row && cols[c]) useEditor.getState().requestFocus(row.id, where, { property: cols[c] });
  };

  const navigate = (r: number, c: number) => (dir: 'next' | 'prev' | 'down' | 'up'): boolean => {
    if (dir === 'next') {
      if (c + 1 < cols.length) focusCell(r, c + 1, 'end');
      else if (r + 1 < rows.length) focusCell(r + 1, 0, 'end');
      else {
        // Tab in the last cell adds a row
        const id = insertRow(block.id, rows.length);
        setTimeout(() => useEditor.getState().requestFocus(id, 0, { property: cols[0] }), 0);
      }
      return true;
    }
    if (dir === 'prev') {
      if (c > 0) focusCell(r, c - 1, 'end');
      else if (r > 0) focusCell(r - 1, cols.length - 1, 'end');
      return true;
    }
    if (dir === 'down') {
      if (r + 1 < rows.length) { focusCell(r + 1, c, 'end'); return true; }
      const after = neighborAfterTable(block.id);
      if (after) useEditor.getState().requestFocus(after.dataset.blockId!, 0, { property: after.dataset.property ?? 'title' });
      return !!after;
    }
    if (r > 0) { focusCell(r - 1, c, 'end'); return true; }
    return false;
  };

  // drag-select a rectangle of cells (mousedown in one cell, move into another)
  const onCellMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    if (e.button !== 0 || readOnly) return;
    if (e.shiftKey && selRef.current) {
      e.preventDefault();
      setSel({ ...selRef.current, r1: r, c1: c });
      return;
    }
    setSel(null);
    const start = { r, c };
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('td[data-r]') as HTMLElement | null;
      if (!el || !el.closest(`[data-table-id="${block.id}"]`)) return;
      const rr = Number(el.dataset.r);
      const cc = Number(el.dataset.c);
      if (!moved && rr === start.r && cc === start.c) return;
      if (!moved) {
        moved = true;
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      window.getSelection()?.removeAllRanges();
      setSel({ r0: start.r, c0: start.c, r1: rr, c1: cc });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startColResize = (e: React.PointerEvent, col: string) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const w0 = fmt[col]?.width ?? DEFAULT_COL_WIDTH;
    const x0 = e.clientX;
    let w = w0;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: PointerEvent) => {
      w = Math.max(MIN_COL_WIDTH, w0 + ev.clientX - x0);
      setLiveW({ col, w });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      setLiveW(null);
      if (Math.abs(w - w0) > 0.5) run('table.resizeColumn', (tx) => setFormat(tx, block.id, { table_block_column_format: { ...colFormat(getBlock(block.id)!), [col]: { ...(colFormat(getBlock(block.id)!)[col] ?? {}), width: Math.round(w) } } }));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const autoFit = (col: string) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    ctx.font = '14px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    let max = 0;
    for (const r of rows) for (const line of toPlainText(r.properties?.[col] as RichText | undefined).split('\n')) max = Math.max(max, ctx.measureText(line).width);
    const w = Math.max(MIN_COL_WIDTH, Math.ceil(max + 20));
    run('table.autoFitColumn', (tx) => setFormat(tx, block.id, { table_block_column_format: { ...colFormat(getBlock(block.id)!), [col]: { ...(colFormat(getBlock(block.id)!)[col] ?? {}), width: w } } }));
  };

  // grip: click = menu, drag = reorder
  const startGrip = (e: React.PointerEvent, kind: 'row' | 'col', idx: number) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let target = idx;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      const t = tableRef.current?.getBoundingClientRect();
      if (!t || !geo) return;
      if (kind === 'col') {
        const x = ev.clientX - t.left;
        target = geo.colX.findIndex((cx, i) => x < cx + geo.colW[i] / 2);
        if (target < 0) target = cols.length;
        setDragInd({ kind, pos: target < cols.length ? geo.colX[target] : geo.w });
      } else {
        const y = ev.clientY - t.top;
        target = geo.rowY.findIndex((ry, i) => y < ry + geo.rowH[i] / 2);
        if (target < 0) target = rows.length;
        setDragInd({ kind, pos: target < rows.length ? geo.rowY[target] : geo.h });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragInd(null);
      if (!moved) {
        const range: CellSel = kind === 'col' ? { r0: 0, c0: idx, r1: rows.length - 1, c1: idx } : { r0: idx, c0: 0, r1: idx, c1: cols.length - 1 };
        setHighlight(range);
        openMenu(el, kind === 'col' ? columnMenu(block.id, idx) : rowMenu(block.id, idx), { placement: kind === 'col' ? 'right-start' : 'right-start', offset: 6, onClose: () => setHighlight(null) });
        return;
      }
      if (kind === 'col') moveColumn(block.id, idx, target);
      else moveRow(block.id, idx, target);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // corner "+": click adds a row and a column; drag adds/removes trailing rows/columns in steps
  const startCorner = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let addedC = 0;
    let addedR = 0;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const wantC = Math.round(dx / DEFAULT_COL_WIDTH);
      const wantR = Math.round(dy / 34);
      while (addedC < wantC) { insertColumn(block.id, colOrder(getBlock(block.id)!).length); addedC++; }
      while (addedC > wantC) {
        const order = colOrder(getBlock(block.id)!);
        const last = order[order.length - 1];
        const empty = liveRows(getBlock(block.id)!).every((r) => !length(r.properties?.[last] as RichText | undefined));
        if (!empty || order.length <= 1) break;
        deleteColumn(block.id, last);
        addedC--;
      }
      while (addedR < wantR) { insertRow(block.id, liveRows(getBlock(block.id)!).length); addedR++; }
      while (addedR > wantR) {
        const rs = liveRows(getBlock(block.id)!);
        const last = rs[rs.length - 1];
        const empty = colOrder(getBlock(block.id)!).every((c) => !length(last?.properties?.[c] as RichText | undefined));
        if (!empty || rs.length <= 1) break;
        deleteRow(block.id, last.id);
        addedR--;
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        insertColumn(block.id, cols.length);
        insertRow(block.id, rows.length);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const rectFor = (s: CellSel | null) => {
    if (!s || !geo) return null;
    const r0 = Math.min(s.r0, s.r1);
    const r1 = Math.max(s.r0, s.r1);
    const c0 = Math.min(s.c0, s.c1);
    const c1 = Math.max(s.c0, s.c1);
    if (geo.colX[c0] === undefined || geo.rowY[r0] === undefined) return null;
    return {
      left: geo.colX[c0] - 0.5, top: geo.rowY[r0] - 0.5,
      width: geo.colX[c1] + geo.colW[c1] - geo.colX[c0] + 1, height: geo.rowY[r1] + geo.rowH[r1] - geo.rowY[r0] + 1,
    };
  };
  const selRect = rectFor(sel) ?? rectFor(highlight);
  const inSel = (r: number, c: number) => !!sel && r >= Math.min(sel.r0, sel.r1) && r <= Math.max(sel.r0, sel.r1) && c >= Math.min(sel.c0, sel.c1) && c <= Math.max(sel.c0, sel.c1) && !(sel.r0 === sel.r1 && sel.c0 === sel.c1 && false);

  return (
    <div className="nc-bpad0">
      <div className="nc-table-scroller lit-scroller horizontal nc-blk-hoverable" data-table-id={block.id}>
        <div className="nc-table-inner" ref={innerRef} onMouseLeave={() => setHover(null)}>
          <table className="nc-stable" ref={tableRef} style={{ width: cols.reduce((s, c) => s + width(c), 0) }}>
            <colgroup>{cols.map((c) => <col key={c} style={{ width: width(c) }} />)}</colgroup>
            <tbody>
              {rows.map((row, r) => (
                <tr key={row.id} className="lit-table-row" data-block-id={row.id} style={colorStyle(row.format?.block_color as string | undefined)}>
                  {cols.map((col, c) => {
                    const span = spanAt(spans, r, c);
                    if (span && (span.r !== r || span.c !== c)) return null; // covered by a merged cell
                    const header = (colHeader && r === 0) || (rowHeader && c === 0);
                    const cellColor = (row.format?.cell_format as any)?.[col]?.color as string | undefined;
                    const w = span ? cols.slice(c, c + span.cs).reduce((sum, x) => sum + width(x), 0) : width(col);
                    const style: React.CSSProperties = { width: w, minWidth: w, maxWidth: w, ...colorStyle(fmt[col]?.color), ...colorStyle(row.format?.block_color as string | undefined), ...colorStyle(cellColor) };
                    return (
                      <td
                        key={col}
                        dir="ltr"
                        data-r={r}
                        data-c={c}
                        rowSpan={span?.rs}
                        colSpan={span?.cs}
                        data-merged={span ? `${span.rs}x${span.cs}` : undefined}
                        className={`${header ? 'header' : ''} ${inSel(r, c) && sel && !(sel.r0 === sel.r1 && sel.c0 === sel.c1) ? 'cell-selected' : ''}`}
                        style={style}
                        onMouseEnter={() => setHover({ r, c })}
                        onMouseDown={(e) => onCellMouseDown(e, r, c)}
                        onContextMenu={(e) => {
                          if (!sel || readOnly) return;
                          e.preventDefault();
                          openMenu({ x: e.clientX, y: e.clientY }, cellMenu(block.id, sel));
                        }}
                      >
                        <div className="lit-table-cell">
                          <TableCell
                            table={block}
                            row={row}
                            col={col}
                            r={r}
                            c={c}
                            readOnly={readOnly}
                            onEscape={() => {
                              (document.activeElement as HTMLElement | null)?.blur?.();
                              setSel({ r0: r, c0: c, r1: r, c1: c });
                            }}
                            onNavigate={(dir) => navigate(r, c)(dir)}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && geo && (
            <>
              {cols.map((col, c) => (
                <div key={`rz-${col}`} className={`nc-table-col-resizer ${liveW?.col === col ? 'active' : ''}`} style={{ left: (geo.colX[c] ?? 0) + (geo.colW[c] ?? 0), height: geo.h }} onPointerDown={(e) => startColResize(e, col)} onDoubleClick={() => autoFit(col)} />
              ))}
              {cols.map((col, c) => (
                <div
                  key={`cg-${col}`}
                  role="button"
                  aria-label="Drag to reposition, click for options"
                  className={`nc-table-grip col ${hover?.c === c ? 'show' : ''} ${highlight && highlight.c0 === c && highlight.c1 === c && highlight.r0 === 0 ? 'active' : ''}`}
                  style={{ left: (geo.colX[c] ?? 0) + (geo.colW[c] ?? 0) / 2 - 9, top: -3 }}
                  onPointerDown={(e) => startGrip(e, 'col', c)}
                  onMouseEnter={() => setHover((h) => ({ r: h?.r ?? 0, c }))}
                >
                  <Icon name="dragHandleHorizontal" size={10} />
                </div>
              ))}
              {rows.map((row, r) => (
                <div
                  key={`rg-${row.id}`}
                  role="button"
                  aria-label="Drag to reposition, click for options"
                  className={`nc-table-grip row ${hover?.r === r ? 'show' : ''} ${highlight && highlight.r0 === r && highlight.r1 === r && highlight.c0 === 0 ? 'active' : ''}`}
                  style={{ top: (geo.rowY[r] ?? 0) + (geo.rowH[r] ?? 0) / 2 - 9, left: -3 }}
                  onPointerDown={(e) => startGrip(e, 'row', r)}
                  onMouseEnter={() => setHover((h) => ({ c: h?.c ?? 0, r }))}
                >
                  <Icon name="dragHandle" size={10} />
                </div>
              ))}
              <div role="button" aria-label="Add column" className="nc-table-add col" style={{ left: geo.w + 8, top: 0, height: geo.h }} onMouseDown={(e) => e.preventDefault()} onClick={() => insertColumn(block.id, cols.length)}>
                <Icon name="plusFillSmall" size={12} />
              </div>
              <div role="button" aria-label="Add row" className="nc-table-add row" style={{ left: 0, top: geo.h + 8, width: geo.w }} onMouseDown={(e) => e.preventDefault()} onClick={() => insertRow(block.id, rows.length)}>
                <Icon name="plusFillSmall" size={12} />
              </div>
              <div role="button" aria-label="Add row and column" className="nc-table-add corner" style={{ left: geo.w - 8, top: geo.h - 8 }} onPointerDown={startCorner}>
                <Icon name="plusFillSmall" size={10} />
              </div>
            </>
          )}
          {selRect && <div className="nc-table-sel-rect" style={selRect} />}
          {dragInd && geo && (
            <div className="nc-drop-indicator" style={dragInd.kind === 'col' ? { left: dragInd.pos - 2, top: 0, width: 4, height: geo.h } : { left: 0, top: dragInd.pos - 2, width: geo.w, height: 4 }} />
          )}
        </div>
      </div>
    </div>
  );
}

function neighborAfterTable(tableId: string): HTMLElement | null {
  const el = document.querySelector(`.lit-page-content [data-block-id="${tableId}"]`);
  if (!el) return null;
  const leaves = Array.from(document.querySelectorAll<HTMLElement>('.lit-page-content [data-content-editable-leaf="true"]')).filter((l) => l.isContentEditable);
  return leaves.find((l) => !el.contains(l) && (el.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null;
}

registerBlock(['table'], TableBlock);

// Table block menu: Change to database, Expand to full width,
// Header row (switch), Header column (switch), then the shared items.
registerBlockMenu(['table'], ({ block }) => {
  return [
    { label: 'Change to database', icon: 'arrowSquarePathUpDown', onSelect: () => turnTableIntoDatabase(block.id) },
    { label: 'Expand to full width', icon: 'arrowExpandHorizontal', onSelect: () => fitTableToWidth(block.id) },
    { label: 'Header row', icon: 'tableHeaderRow', right: <LiveSwitch blockId={block.id} get={(b) => !!b.format?.table_block_column_header} />, onSelect: () => { const on = !!getBlock(block.id)?.format?.table_block_column_header; run('actionRegistry.createToggleAction', (tx) => setFormat(tx, block.id, { table_block_column_header: !on })); return false; } },
    { label: 'Header column', icon: 'tableHeaderColumn', right: <LiveSwitch blockId={block.id} get={(b) => !!b.format?.table_block_row_header} />, onSelect: () => { const on = !!getBlock(block.id)?.format?.table_block_row_header; run('actionRegistry.createToggleAction', (tx) => setFormat(tx, block.id, { table_block_row_header: !on })); return false; } },
  ];
});

overrideSlashItem('table', (ctx) => createSimpleTable(ctx));

export { toast };
