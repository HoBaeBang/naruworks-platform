// Sub-items UI pieces shared by the table / list / board / gallery views: the nesting toggle, the flattened-list count
// indicator, the "New nested item" row and the card property list (/007).
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { childIdsOf, subitemSettingsOf, type SubitemQueryResult } from '@nc/shared/database/index.ts';
import { records } from '../../lib/store/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { titleOf } from './advanced/context.ts';
import { addSubitem, useSubitemExpansion } from './subitems.ts';
import { useDatabaseContext } from './DatabaseContext.tsx';
import './subitems.css';

export const SUBITEM_INDENT = 24;

export interface SubitemRowInfo {
  depth: number;
  /** sub-items shown under this row when expanded */
  count: number;
  open: boolean;
  onToggle: () => void;
}

/** Toggle + indentation in front of a nested row's title (rows without sub-items show the toggle on hover). */
export function SubitemToggle({ info }: { info: SubitemRowInfo }) {
  return (
    <>
      {info.depth > 0 && <span className="nc-subitem-indent" style={{ width: info.depth * SUBITEM_INDENT }} aria-hidden />}
      <span
        role="button"
        className={`nc-subitem-toggle ${info.open ? 'open' : ''} ${info.count ? 'has-children' : ''}`}
        aria-label={info.open ? 'Collapse sub-items' : 'Expand sub-items'}
        aria-expanded={info.open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          info.onToggle();
        }}
      >
        <Icon name="triangleRight" size={12} />
      </span>
    </>
  );
}

/** Flattened list: "▸ N" next to a parent's title (tooltip "N sub-items"). */
export function SubitemCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="nc-subitem-count" data-tooltip={`${count} ${count === 1 ? 'sub-item' : 'sub-items'}`}>
      <Icon name="listToggle" size={12} />
      <span>{count}</span>
    </span>
  );
}

/** "+ New nested item" placeholder row under an expanded parent. */
export function NewSubitemRow({ parent, view, depth, className }: { parent: BlockRecord; view: CollectionViewRecord; depth: number; className?: string }) {
  const db = useDatabaseContext();
  return (
    <div className={`nc-subitem-new ${className ?? ''}`} style={{ paddingInlineStart: depth * SUBITEM_INDENT + 8 }}>
      <div role="button" className="nc-subitem-new-btn" onClick={() => {
        const id = addSubitem(parent, view);
        if (id) db?.setEditingTitle(id);
      }}>
        <Icon name="plusSmall" size={16} />
        <span>New nested item</span>
      </div>
    </div>
  );
}

/** Row info for a row of a nested view (null when the view doesn't nest sub-items). */
export function subitemInfoFor(row: BlockRecord, depth: number, sub: SubitemQueryResult | undefined, view: CollectionViewRecord, isOpen: (id: string) => boolean): SubitemRowInfo | null {
  if (!sub || sub.mode !== 'show') return null;
  return {
    depth,
    count: sub.children[row.id]?.length ?? 0,
    open: isOpen(row.id),
    onToggle: () => useSubitemExpansion.getState().toggle(view.id, row.id),
  };
}

/** Card property: "N sub-items" toggle listing the sub-items on a board / gallery / calendar card. */
export function CardSubitems({ row, view, collection, openRow }: { row: BlockRecord; view: CollectionViewRecord; collection: CollectionRecord; openRow: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const settings = subitemSettingsOf(view, collection);
  const kids = settings?.mode === 'show' ? childIdsOf(row, settings).map((id) => records.get<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && b.alive !== false) : [];
  if (!kids.length) return null;
  return (
    <div className="nc-card-subitems" onClick={(e) => e.stopPropagation()}>
      <div role="button" className={`nc-card-subitems-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <Icon name="triangleRight" size={10} />
        <span>{`${kids.length} ${kids.length === 1 ? 'sub-item' : 'sub-items'}`}</span>
      </div>
      {open && kids.map((k) => (
        <div key={k.id} role="link" className="nc-card-subitem" onClick={() => openRow(k.id)}>
          <PageIcon block={k} size={14} fallback="page" />
          <span className="nc-card-subitem-title">{titleOf(k) || 'Untitled'}</span>
        </div>
      ))}
    </div>
  );
}
