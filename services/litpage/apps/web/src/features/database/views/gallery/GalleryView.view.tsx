// Gallery view: responsive grid, 16px gap, cards with a 10px radius and ring,
// cards radius 10 with ring, preview 9:16 of the width (146.25 at medium), 15px/500 title, "+ New page" tile,
// groups, load limit, drag to reorder.
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import type { GroupResult } from '@nc/shared/database/index.ts';
import { registerView, type ViewProps } from '../../viewRegistry.ts';
import { conditionalBg, useConditionalColors, useViewQuery } from '../../data.ts';
import { useDatabaseContext } from '../../DatabaseContext.tsx';
import { moveRow, viewProperties } from '../../actions.ts';
import { GroupHeader, useCollapsedGroups } from '../../chrome/Groups.tsx';
import { openRowMenu } from '../../chrome/RowMenu.tsx';
import { CardBody, CardCover, cardCoverConfig } from '../cards.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import './gallery.css';

const SIZES: Record<string, number> = { small: 180, medium: 260, large: 320 };

function GalleryView({ view, collection, readOnly }: ViewProps) {
  const db = useDatabaseContext();
  const result = useViewQuery(collection, view, { search: db?.search ?? '' });
  const fmt = (view.format ?? {}) as Record<string, any>;
  const cover = cardCoverConfig(view, 'gallery');
  const min = SIZES[cover.size] ?? 260;
  const entries = viewProperties(view, collection.schema);
  const props = entries.filter((e) => e.visible && e.property !== 'title').map((e) => e.property);
  const showTitle = entries.find((e) => e.property === 'title')?.visible !== false;
  const limitFmt = fmt.inline_collection_first_load_limit as { type: string; limit: number } | undefined;
  const first = db?.inline === false ? Infinity : limitFmt?.type === 'load_limit' ? limitFmt.limit : 50;
  const [limit, setLimit] = useState(first);
  useEffect(() => setLimit(first), [first, view.id]);
  const [drag, setDrag] = useState<string | null>(null);
  const collapsed = useCollapsedGroups(view.id);
  const bleed = db?.bleed ?? { left: 0, right: 0, width: null };

  const colorsOf = useConditionalColors(view, collection);
  const grid = (rows: BlockRecord[], group?: GroupResult) => (
    <>
      <div className="nc-gallery-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, ['--nc-gallery-preview' as any]: `${(min * 9) / 16}px` }}>
        {(Number.isFinite(limit) ? rows.slice(0, limit) : rows).map((row) => (
          <div
            key={row.id}
            className={`lit-selectable lit-page-block lit-collection-item nc-gallery-card-wrap ${drag === row.id ? 'dragging' : ''}`}
            data-block-id={row.id}
            draggable={!readOnly}
            onDragStart={() => setDrag(row.id)}
            onDragOver={(e) => drag && e.preventDefault()}
            onDrop={() => { if (drag && drag !== row.id) moveRow(view, collection.id, drag, { before: row.id }); setDrag(null); }}
            onDragEnd={() => setDrag(null)}
          >
            <div role="presentation" className="nc-gallery-card" style={colorsOf(row)?.row ? { background: conditionalBg(colorsOf(row)?.row) } : undefined} onClick={() => db?.openRow(row.id)} onContextMenu={(e) => { e.preventDefault(); openRowMenu({ x: e.clientX, y: e.clientY }, { rowIds: [row.id], collection, view }); }}>
              <CardCover row={row} cover={cover} view={view} collection={collection} readOnly={readOnly} />
              <CardBody row={row} view={view} collection={collection} props={props} showTitle={showTitle} readOnly={readOnly} editing={db?.editingTitle === row.id} onDoneEditing={() => db?.setEditingTitle(null)} />
              {!readOnly && (
                <div className="nc-card-hover-pill" onClick={(e) => e.stopPropagation()}>
                  <span role="button" className="nc-card-pill-btn" data-tooltip="Edit" onClick={() => db?.setEditingTitle(row.id)}><Icon name="pencilLine" size={14} /></span>
                  <span role="button" className="nc-card-pill-btn" data-tooltip="Rename, remove, send, and more…" onClick={(e) => openRowMenu(e.currentTarget, { rowIds: [row.id], collection, view })}><Icon name="ellipsisSmall" size={14} /></span>
                </div>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <div role="button" className="nc-gallery-new" onClick={() => db?.addRow({ group: group ?? null, position: 'end', editTitle: true })}>
            <Icon name="plus" size={15} />
            <span>New page</span>
          </div>
        )}
      </div>
      {rows.length > limit && (
        <div role="button" className="nc-gallery-load-more" onClick={() => setLimit((l) => l + (Number.isFinite(first) ? first : 50))}>
          <Icon name="arrowDown" size={16} />
          <span>Load more</span>
        </div>
      )}
    </>
  );

  return (
    <div className="lit-gallery-view" style={{ paddingInlineStart: bleed.left + 8, paddingInlineEnd: bleed.right }}>
      {result.groups ? (
        result.groups.filter((g) => !g.hidden).map((g) => (
          <div key={g.id} className="nc-gallery-group">
            <GroupHeader group={g} view={view} collection={collection} readOnly={readOnly} collapsed={collapsed.has(g.id)} onToggle={() => collapsed.toggle(g.id)} onAdd={() => db?.addRow({ group: g, position: 'end', editTitle: true })} />
            {!collapsed.has(g.id) && grid(g.rows, g)}
          </div>
        ))
      ) : (
        grid(result.rows)
      )}
    </div>
  );
}

registerView('gallery', GalleryView);
export { GalleryView };
