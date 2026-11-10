// Row “•••” and right-click menu: search actions, page actions, and sharing actions.
// (Add to favorites, Edit icon, Edit property ›), Open in ›, Comment, Copy link, Duplicate, Move to,
// Send to trash, and the "Last edited" footer.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { propertyTypeMeta } from '@nc/shared/database/index.ts';
import { records } from '../../../lib/store/records.ts';
import { getBlock, run, setFormat } from '../../../lib/blocks.ts';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import type { Anchor } from '../../../components/overlay.tsx';
import { openPage, openPeek, pageUrl } from '../../../lib/router.ts';
import { formatDateTime } from '../../../lib/format.ts';
import { UserAvatar } from '../../presence/Avatar.tsx';
import { isFavorite, toggleFavorite } from '../../page/pageActions.ts';
import { openMoveToDialog } from '../../page/MoveTo.tsx';
import { startPageComment } from '../../comments/comments.tsx';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { useUI } from '../../../lib/store/ui.ts';
import { deleteRows, duplicateRows } from '../actions.ts';
import { openPropertyEditor, PropertyIcon } from '../properties/PropertyCell.tsx';

const NOT_EDITABLE = new Set(['button', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'auto_increment_id', 'formula', 'rollup', 'location']);

function wordStats(page: BlockRecord): string {
  let words = 0;
  let chars = 0;
  const visit = (id: string, depth: number) => {
    const b = getBlock(id);
    if (!b || depth > 20) return;
    const t = toPlainText(b.properties?.title);
    chars += t.length;
    words += t.split(/\s+/).filter(Boolean).length;
    if (b.type !== 'page' || depth === 0) for (const c of b.content ?? []) visit(c, depth + 1);
  };
  visit(page.id, 0);
  return `${words} word${words === 1 ? '' : 's'}, ${chars} character${chars === 1 ? '' : 's'}`;
}

export function openRowMenu(anchor: Anchor, opts: { rowIds: string[]; collection: CollectionRecord; view?: CollectionViewRecord; onDone?: () => void }) {
  const { rowIds, collection } = opts;
  const rows = rowIds.map((id) => getBlock(id)).filter((b): b is BlockRecord => !!b);
  if (!rows.length) return () => {};
  const first = rows[0];
  const multi = rows.length > 1;
  const editable = Object.entries(collection.schema)
    .filter(([, p]) => !NOT_EDITABLE.has(p.type))
    .sort(([a, pa], [b, pb]) => (a === 'title' ? -1 : b === 'title' ? 1 : pa.name.localeCompare(pb.name)));
  const editor = records.get<UserRecord>('lit_user', first.last_edited_by_id);
  const fav = isFavorite(first.id);
  const pageItems: MenuItemDef[] = [
    ...(!multi ? [{ id: 'fav', label: fav ? 'Remove from favorites' : 'Add to favorites', icon: fav ? 'starFilled' : 'star', onSelect: () => toggleFavorite(first.id) }] : []),
    { id: 'icon', label: 'Edit icon', icon: 'emojiFace', onSelect: () => { openIconPicker(anchor, { current: first.format?.page_icon as string | undefined, onPick: (v) => run('setRowIcons', (tx) => rows.forEach((r) => setFormat(tx, r.id, { page_icon: (v ?? null) as any }))) }); } },
    {
      id: 'edit', label: 'Edit property', icon: 'bulletedList',
      submenu: () => ({
        width: 220,
        search: true,
        sections: [{ items: editable.map(([pid, p]) => ({ id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} style={{ color: 'var(--lp-icon-primary)' }} />, onSelect: () => {
          const target = anchor instanceof HTMLElement ? anchor : null;
          const el = target ?? document.querySelector<HTMLElement>(`[data-block-id="${first.id}"]`);
          if (el) setTimeout(() => openPropertyEditor(el, { rowIds, propId: pid, collectionId: collection.id, view: opts.view }), 0);
        } })) }],
      }),
    },
  ];
  const actions: MenuItemDef[] = [
    ...(!multi ? [
      { id: 'open', label: 'Open in', icon: 'arrowDiagonalUpRight', submenu: () => ({ width: 220, sections: [{ items: [
        { id: 'tab', label: 'New tab', icon: 'arrowDiagonalUpRight', shortcut: '⌘⇧↵', onSelect: () => window.open(pageUrl(first.id), '_blank') },
        { id: 'peek', label: 'Side peek', icon: 'sidePeek', shortcut: '⌥Click', onSelect: () => openPeek(first.id, 'side_peek') },
        { id: 'center', label: 'Center peek', icon: 'centerPeek', onSelect: () => openPeek(first.id, 'center_peek') },
        { id: 'full', label: 'Full page', icon: 'fullPage', onSelect: () => openPage(first.id) },
      ] }] }) } as MenuItemDef,
      { id: 'comment', label: 'Comment', icon: 'commentFilled', shortcut: '⌘⇧M', onSelect: () => { openPeek(first.id, 'side_peek'); setTimeout(() => startPageComment(first.id), 150); } },
    ] : []),
  ];
  const manage: MenuItemDef[] = [
    ...(!multi ? [{ id: 'link', label: 'Copy link', icon: 'link', onSelect: () => { void navigator.clipboard?.writeText(location.origin + pageUrl(first.id)); useUI.getState().toast('Link copied'); } }] : []),
    { id: 'dup', label: 'Duplicate', icon: 'duplicate', shortcut: '⌘D', onSelect: () => { void duplicateRows(rowIds); opts.onDone?.(); } },
    { id: 'move', label: 'Move to', icon: 'arrowTurnUpRight', shortcut: '⌘⇧P', onSelect: () => openMoveToDialog(rowIds, anchor) },
    { id: 'trash', label: 'Send to trash', icon: 'trash', shortcut: 'Del', onSelect: () => { deleteRows(rowIds); opts.onDone?.(); } },
  ];
  return openMenu(anchor, {
    width: 265,
    search: 'Search actions…',
    sections: [{ title: multi ? `${rows.length} pages` : 'Page', items: pageItems }, ...(actions.length ? [{ items: actions }] : []), { items: manage }],
    footer: !multi ? (
      <div className="nc-row-menu-footer">
        <div className="nc-row-menu-footer-title">Last edited</div>
        <div className="nc-row-menu-footer-user">
          <UserAvatar userId={first.last_edited_by_id} size={24} />
          <span>{editor?.name || editor?.email || 'Unknown'}</span>
        </div>
        <div className="nc-row-menu-footer-time">{formatDateTime(first.last_edited_time)}</div>
        <div className="nc-row-menu-footer-stats">{wordStats(first)}</div>
      </div>
    ) : undefined,
  }, { placement: anchor instanceof HTMLElement ? 'bottom-start' : 'bottom-start' });
}

export function rowTypeIcon(type: string) {
  return propertyTypeMeta(type).icon;
}
