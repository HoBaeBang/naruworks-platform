// Columns (column_list > column). Flex row; each column wrapper
// padding 12px 0 and width calc(r·100% − r·(n−1)·46px) (2 → calc(50% − 23px) … 5 → calc(20% − 36.8px));
// 46px gutters whose 4px bar (inset 21px, var(--lp-border-primary-transparent)) fades in on hover (200ms) with cursor col-resize;
// dragging writes format.column_ratio on the two neighbours at drag end (ColumnDivider.handleDragEnd, e.g.
// 0.375 / 0.625). Text inside columns keeps its 6px padding. Emptied columns are removed and a single
// remaining column is unwrapped; empty columns are omitted.
import { Fragment, useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { registerBlock, BlockList, type BlockProps } from '../Block.tsx';
import { useRecords } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { getBlock, moveBlocksIn, run } from '../../../lib/blocks.ts';
import type { Tx } from '../../../lib/store/transactions.ts';

const GAP = 46;

function ratiosOf(cols: BlockRecord[]): number[] {
  const raw = cols.map((c) => {
    const r = c.format?.column_ratio as number | undefined;
    return typeof r === 'number' && r > 0 ? r : 1 / cols.length;
  });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((r) => r / sum);
}

/** Remove empty columns / unwrap single-column lists inside `tx` (used after moves and as a render-time fixup). */
export function normalizeColumnList(tx: Tx, listId: string): boolean {
  const list = getBlock(listId);
  if (!list || !list.alive || list.type !== 'column_list') return false;
  const cols = (list.content ?? []).map((id) => getBlock(id)).filter((c): c is BlockRecord => !!c && c.alive);
  const isEmpty = (c: BlockRecord) => !(c.content ?? []).some((id) => {
    const k = getBlock(id);
    return !k || k.alive; // unknown (not loaded) children count as content
  });
  const empty = cols.filter(isEmpty);
  if (!empty.length && cols.length > 1) return false;
  const keep = cols.filter((c) => !isEmpty(c));
  for (const c of empty) {
    tx.update('block', c.id, [], { alive: false });
    tx.listRemove('block', listId, ['content'], c.id);
  }
  if (keep.length <= 1) {
    // unwrap: the remaining column's blocks take the list's place
    const kids = keep[0]?.content?.filter((id) => getBlock(id)?.alive) ?? [];
    if (kids.length) moveBlocksIn(tx, kids, { parentId: list.parent_id, parentTable: list.parent_table as any, after: listId });
    for (const c of keep) tx.update('block', c.id, [], { alive: false });
    tx.update('block', listId, [], { alive: false });
    tx.listRemove('block', list.parent_id, ['content'], listId);
    return true;
  }
  // re-balance the remaining ratios so they still sum to 1
  const r = ratiosOf(keep);
  keep.forEach((c, i) => tx.update('block', c.id, ['format'], { column_ratio: r[i] }));
  return true;
}

function ColumnList({ block, depth, readOnly }: BlockProps) {
  const cols = useRecords<BlockRecord>('block', block.content);
  const live = cols.filter((c): c is BlockRecord => !!c && c.alive);
  const kidsKey = live.map((c) => `${c.id}:${(c.content ?? []).join(',')}`).join('|');
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ gap: number; ratios: number[] } | null>(null);
  const ratios = drag?.ratios ?? ratiosOf(live);
  const n = live.length;

  // fix-up for columns emptied by moves/deletes performed elsewhere (separate undo step)
  useEffect(() => {
    if (readOnly || !live.length) return;
    const needs = live.length === 1 || live.some((c) => !(c.content ?? []).some((id) => { const k = records.get<BlockRecord>('block', id); return !k || k.alive; }));
    if (!needs) return;
    const t = setTimeout(() => run('columns.normalize', (tx) => { normalizeColumnList(tx, block.id); }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kidsKey, readOnly]);

  const startResize = (e: React.PointerEvent, gap: number) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const total = el.getBoundingClientRect().width - (n - 1) * GAP;
    const base = ratiosOf(live);
    const x0 = e.clientX;
    const a = gap;
    const b = gap + 1;
    const min = Math.min(0.5, 60 / Math.max(1, total));
    let current = base;
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / total;
      const pair = base[a] + base[b];
      const na = Math.max(min, Math.min(pair - min, base[a] + d));
      current = base.slice();
      current[a] = na;
      current[b] = pair - na;
      setDrag({ gap, ratios: current });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      setDrag(null);
      if (current === base) return;
      run('ColumnDivider.handleDragEnd', (tx) => {
        tx.update('block', live[a].id, ['format'], { column_ratio: current[a] });
        tx.update('block', live[b].id, ['format'], { column_ratio: current[b] });
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div className="nc-columns-2" ref={ref}>
        {live.map((c, i) => {
          const r = ratios[i] ?? 1 / n;
          return (
            <Fragment key={c.id}>
              {i > 0 && (
                <div className={`nc-column-gap ${drag?.gap === i - 1 ? 'active' : ''}`} onPointerDown={(e) => startResize(e, i - 1)} role="separator" aria-orientation="vertical">
                  <div className="bar" />
                </div>
              )}
              <div className={`nc-column-wrap-2 ${drag ? 'resizing' : ''}`} style={{ width: `calc(${(r * 100).toFixed(4)}% - ${(r * (n - 1) * GAP).toFixed(4)}px)` }}>
                <div className="lit-selectable lit-column-block nc-column-2" data-block-id={c.id}>
                  <BlockList parentId={c.id} ids={c.content} depth={depth + 1} readOnly={readOnly} />
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

registerBlock(['column_list'], ColumnList);
