// Table cell selection + fill: drag across cells (or Shift+click) to select a block of cells — a blue
// box with a small fill handle at its bottom-right corner. Dragging the handle up or down copies the selected values
// into the rows it covers (repeating the pattern); ⌘D / Ctrl+D fills down first selected row, ⌘R / Ctrl+R
// fills right first selected column (same property types), Delete / Backspace clears, Esc deselects.
// Rows and columns come rendered table (DOM order = what the person sees after sorts and filters).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CollectionRecord } from '@nc/shared/records.ts';
import { records } from '../../../../lib/store/records.ts';
import { run } from '../../../../lib/blocks.ts';
import type { BlockRecord } from '@nc/shared/records.ts';

interface Pos { row: number; col: number }
interface Sel { a: Pos; b: Pos }

const NO_FILL = new Set(['title', 'formula', 'rollup', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'auto_increment_id', 'button', 'verification']);

function grid(table: HTMLElement) {
  const rows = [...table.querySelectorAll<HTMLElement>('.nc-table-row-outer[data-block-id]')];
  const cols = rows[0] ? [...rows[0].querySelectorAll<HTMLElement>('.lit-table-view-cell[data-col]')].map((c) => c.dataset.col!) : [];
  return { rows, ids: rows.map((r) => r.dataset.blockId!), cols };
}

function posOf(table: HTMLElement, cell: HTMLElement): Pos | null {
  const row = cell.closest<HTMLElement>('.nc-table-row-outer[data-block-id]');
  const col = cell.dataset.col;
  if (!row || !col) return null;
  const g = grid(table);
  const r = g.ids.indexOf(row.dataset.blockId!);
  const c = g.cols.indexOf(col);
  return r < 0 || c < 0 ? null : { row: r, col: c };
}

const norm = (s: Sel) => ({ r0: Math.min(s.a.row, s.b.row), r1: Math.max(s.a.row, s.b.row), c0: Math.min(s.a.col, s.b.col), c1: Math.max(s.a.col, s.b.col) });

/** Copy values into a range of cells in one undoable step. `pick(r, c)` → source [rowId, propId] for target (r, c). */
function fill(collection: CollectionRecord, targets: { rowId: string; propId: string; from: { rowId: string; propId: string } }[], action: string) {
  const schema = collection.schema;
  const ops = targets.filter((t) => {
    const p = schema[t.propId];
    const q = schema[t.from.propId];
    return p && q && p.type === q.type && !NO_FILL.has(p.type) && !(t.rowId === t.from.rowId && t.propId === t.from.propId);
  });
  if (!ops.length) return;
  run(action, (tx) => {
    for (const t of ops) {
      const src = records.get<BlockRecord>('block', t.from.rowId)?.properties?.[t.from.propId];
      tx.set('block', t.rowId, ['properties', t.propId], src === undefined ? null : structuredClone(src));
    }
  });
}

export function useCellSelection(tableRef: RefObject<HTMLDivElement | null>, opts: { collection: CollectionRecord; readOnly: boolean }): ReactNode {
  const [sel, setSel] = useState<Sel | null>(null);
  const [fillTo, setFillTo] = useState<number | null>(null);
  const [box, setBoxState] = useState<{ left: number; top: number; width: number; height: number; fill?: { top: number; height: number } } | null>(null);
  // after every render: only a real change re-renders (no layout loop)
  const boxKey = useRef('');
  const setBox = (b: typeof box) => {
    const k = JSON.stringify(b);
    if (k === boxKey.current) return;
    boxKey.current = k;
    setBoxState(b);
  };
  const anchor = useRef<Pos | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // selecting: press on a cell and drag into another one, or Shift+click
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.lit-table-view-cell[data-col]');
      if (!cell || (e.target as HTMLElement).closest('.nc-fill-handle')) return;
      const p = posOf(table, cell);
      if (!p) {
        setSel(null);
        return;
      }
      if (e.shiftKey && anchor.current) {
        e.preventDefault();
        setSel({ a: anchor.current, b: p });
        return;
      }
      anchor.current = p;
      setSel(null);
      const move = (ev: PointerEvent) => {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.lit-table-view-cell[data-col]');
        if (!el || !table.contains(el)) return;
        const q = posOf(table, el);
        if (q && (q.row !== p.row || q.col !== p.col)) {
          window.getSelection()?.removeAllRanges();
          setSel({ a: p, b: q });
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    table.addEventListener('pointerdown', onDown);
    return () => table.removeEventListener('pointerdown', onDown);
  }, [tableRef]);

  // clicking elsewhere ends the selection
  useEffect(() => {
    if (!sel) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (tableRef.current?.contains(t) && t.closest('.lit-table-view-cell[data-col], .nc-fill-handle')) return;
      setSel(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [sel, tableRef]);

  const apply = useCallback((kind: 'down' | 'right' | 'clear') => {
    const table = tableRef.current;
    if (!sel || !table || optsRef.current.readOnly) return;
    const g = grid(table);
    const n = norm(sel);
    const targets: { rowId: string; propId: string; from: { rowId: string; propId: string } }[] = [];
    if (kind === 'clear') {
      run('clearCells', (tx) => {
        for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) {
          const pid = g.cols[c];
          const p = optsRef.current.collection.schema[pid];
          if (p && !NO_FILL.has(p.type)) tx.set('block', g.ids[r], ['properties', pid], null);
        }
      });
      return;
    }
    for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) {
      const from = kind === 'down' ? { rowId: g.ids[n.r0], propId: g.cols[c] } : { rowId: g.ids[r], propId: g.cols[n.c0] };
      targets.push({ rowId: g.ids[r], propId: g.cols[c], from });
    }
    fill(optsRef.current.collection, targets, kind === 'down' ? 'fillDown' : 'fillRight');
  }, [sel, tableRef]);

  // keyboard on a selection
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.lit-overlay-container .nc-overlay')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        e.stopPropagation();
        apply('down');
      } else if (mod && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        e.stopPropagation();
        apply('right');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        apply('clear');
      } else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, apply]);

  // the blue box (+ the fill preview) cells
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!sel || !table) {
      setBox(null);
      return;
    }
    const g = grid(table);
    const n = norm(sel);
    const tr = table.getBoundingClientRect();
    const cellAt = (r: number, c: number) => g.rows[r]?.querySelector<HTMLElement>(`.lit-table-view-cell[data-col="${CSS.escape(g.cols[c] ?? '')}"]`);
    const tl = cellAt(n.r0, n.c0)?.getBoundingClientRect();
    const br = cellAt(n.r1, n.c1)?.getBoundingClientRect();
    if (!tl || !br) {
      setBox(null);
      return;
    }
    const next: NonNullable<typeof box> = { left: tl.left - tr.left, top: tl.top - tr.top, width: br.right - tl.left, height: br.bottom - tl.top };
    if (fillTo !== null && fillTo !== n.r1 && fillTo !== n.r0) {
      const edge = fillTo > n.r1 ? cellAt(fillTo, n.c0)?.getBoundingClientRect() : cellAt(fillTo, n.c0)?.getBoundingClientRect();
      if (edge) next.fill = fillTo > n.r1 ? { top: br.bottom - tr.top, height: edge.bottom - br.bottom } : { top: edge.top - tr.top, height: tl.top - edge.top };
    }
    setBox(next);
  });

  const startFill = (e: React.PointerEvent) => {
    const table = tableRef.current;
    if (!sel || !table || opts.readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const n = norm(sel);
    let target = n.r1;
    const move = (ev: PointerEvent) => {
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.nc-table-row-outer[data-block-id]');
      if (!row || !table.contains(row)) return;
      const r = grid(table).ids.indexOf(row.dataset.blockId!);
      if (r >= 0) {
        target = r;
        setFillTo(r);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setFillTo(null);
      const g = grid(table);
      if (target > n.r1 || target < n.r0) {
        const height = n.r1 - n.r0 + 1;
        const targets: { rowId: string; propId: string; from: { rowId: string; propId: string } }[] = [];
        const lo = Math.min(target, n.r0);
        const hi = Math.max(target, n.r1);
        for (let r = lo; r <= hi; r++) {
          if (r >= n.r0 && r <= n.r1) continue;
          // the selected rows repeat as a pattern (upwards: aligned on the selection's last row)
          const k = r > n.r1 ? (r - n.r0) % height : (height - 1) - ((n.r1 - r) % height);
          for (let c = n.c0; c <= n.c1; c++) targets.push({ rowId: g.ids[r], propId: g.cols[c], from: { rowId: g.ids[n.r0 + k], propId: g.cols[c] } });
        }
        fill(opts.collection, targets, 'fillHandle');
        setSel({ a: { row: lo, col: n.c0 }, b: { row: hi, col: n.c1 } });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!box) return null;
  return (
    <>
      <div className="nc-cell-sel-box" data-testid="cell-selection" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
        {!opts.readOnly && <div className="nc-fill-handle" role="button" aria-label="Drag to fill" data-testid="fill-handle" onPointerDown={startFill} />}
      </div>
      {box.fill && <div className="nc-cell-fill-preview" style={{ left: box.left, top: box.fill.top, width: box.width, height: box.fill.height }} />}
    </>
  );
}
