// Sidebar page tree rows (lit-selectable lit-page-block > a[role=treeitem]) with hover toggle/actions,
// lazy child loading, row ••• menu and drag & drop (reorder, re-parent, drop onto pages / sections).


import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { BlockRecord, SpaceViewRecord } from '@nc/shared/records.ts';
import { PAGE_LIKE } from '@nc/shared/blocks.ts';
import { isArchivedRecord } from '@nc/shared/archive.ts';
import { useBlock, useRecord, useRecords } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { currentSpaceView, useSession } from '../../../lib/store/session.ts';
import { getLocation, openPage, openPeek, pageUrl, useLocation } from '../../../lib/router.ts';
import { api } from '../../../lib/api.ts';
import { getBlock, moveBlocksIn, run } from '../../../lib/blocks.ts';
import { Icon } from '../../../components/Icon.tsx';
import { PageIcon } from '../PageIcon.tsx';
import { newPage, pageTitle } from '../../page/pageActions.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { t } from '../i18n.ts';
import { openPageRowMenu, startInlineRename } from './menus.tsx';
import { useSidebarExpand } from './model.ts';

/** Where a row is rendered — decides reorder semantics for drag & drop. */
export type TreeCtx =
  | { kind: 'private' }
  | { kind: 'shared' }
  | { kind: 'favorites' }
  | { kind: 'recents' }
  | { kind: 'team'; teamId: string }
  | { kind: 'page'; parentId: string };

export const INDENT = 8;

/** Page a "Link to page" block (type alias, format.alias_pointer) points at. */
export function aliasTargetId(b: BlockRecord | undefined): string | undefined {
  if (b?.type !== 'alias') return undefined;
  const id = (b.format as { alias_pointer?: { id?: string } } | undefined)?.alias_pointer?.id;
  return id ? String(id) : undefined;
}


export function isOutlineChild(c: BlockRecord | undefined, target?: BlockRecord): boolean {
  if (!c || !c.alive || isArchivedRecord(c)) return false;
  if (PAGE_LIKE.has(c.type) || c.type === 'collection_view') return true;
  if (c.type !== 'alias') return false;
  const t = target ?? records.get<BlockRecord>('block', aliasTargetId(c));
  return !!t && t.alive && !isArchivedRecord(t) && PAGE_LIKE.has(t.type);
}

export function outlineChildren(block: BlockRecord | undefined): string[] {
  if (!block || block.type === 'collection_view_page' || block.type === 'collection_view') return [];
  return (block.content ?? []).filter((id) => isOutlineChild(records.get<BlockRecord>('block', id)));
}

const requested = new Set<string>();

export function ensureChildrenLoaded(pageId: string) {
  const b = getBlock(pageId);
  if (!b || requested.has(pageId)) return;
  const missing = (b.content ?? []).some((id) => {
    const c = records.get<BlockRecord>('block', id);
    const target = aliasTargetId(c);
    return !c || (!!target && !records.has('block', target));
  });
  if (!missing) return;
  requested.add(pageId);
  void api('getSidebarChildren', { blockIds: [pageId] }).then((res) => records.mergeRecordMap(res.recordMap)).catch(() => requested.delete(pageId));
}

// ---------------- drag & drop ----------------
export type DropZone = 'before' | 'after' | 'inside';
interface DragState {
  dragging: string | null;
  over: { key: string; zone: DropZone } | null;
  set: (p: Partial<DragState>) => void;
}
export const useSidebarDrag = create<DragState>((set) => ({ dragging: null, over: null, set: (p) => set(p) }));

function isAncestor(ancestorId: string, id: string): boolean {
  let cur = getBlock(id);
  for (let i = 0; i < 60 && cur; i++) {
    if (cur.id === ancestorId) return true;
    if (cur.parent_table !== 'block') return false;
    cur = getBlock(cur.parent_id);
  }
  return false;
}

function privatePermissions(page: BlockRecord) {
  const uid = useSession.getState().userId ?? '';
  return page.permissions?.length ? undefined : [{ type: 'user_permission', role: 'editor', user_id: uid }];
}

/** Move page `id` relative to `target` (a row in ctx) or into it. */
export function dropPage(id: string, targetId: string, zone: DropZone, ctx: TreeCtx) {
  if (id === targetId) return;
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  const target = getBlock(targetId);
  const page = getBlock(id);
  if (!target || !page || !sv) return;
  // a "Link to page" row is a block of its page: it can be reordered there or moved into another page only
  if (page.type === 'alias' && zone !== 'inside' && ctx.kind !== 'page') return;
  if (zone === 'inside') {
    if (isAncestor(id, targetId) || target.type === 'collection_view_page' || target.type === 'collection_view') return;
    const last = target.content?.[target.content.length - 1];
    run('sidebar.dropInside', (tx) => moveBlocksIn(tx, [id], { parentId: targetId, parentTable: 'block', after: last === id ? undefined : last }));
    return;
  }
  const rel = zone === 'before' ? { before: targetId } : { after: targetId };
  if (ctx.kind === 'favorites') {
    if (!sv.bookmarked_pages.includes(targetId)) return;
    run('sidebar.reorderFavorites', (tx) => {
      if (zone === 'before') tx.listBefore('space_view', sv.id, ['bookmarked_pages'], id, targetId);
      else tx.listAfter('space_view', sv.id, ['bookmarked_pages'], id, targetId);
    });
    return;
  }
  if (ctx.kind === 'recents') return;
  if (ctx.kind === 'page') {
    if (isAncestor(id, ctx.parentId)) return;
    run('sidebar.reorder', (tx) => moveBlocksIn(tx, [id], { parentId: ctx.parentId, parentTable: 'block', ...rel }));
    return;
  }
  if (ctx.kind === 'team') {
    run('sidebar.reorder', (tx) => moveBlocksIn(tx, [id], { parentId: ctx.teamId, parentTable: 'team', ...rel }));
    return;
  }
  if (ctx.kind === 'private' || ctx.kind === 'shared') {
    const inPrivate = sv.private_pages.includes(targetId);
    run('sidebar.reorder', (tx) => {
      moveBlocksIn(tx, [id], {
        parentId: sv.space_id, parentTable: 'space', ...rel,
        list: inPrivate ? { table: 'space_view', id: sv.id, path: ['private_pages'] } : { table: 'space', id: sv.space_id, path: ['pages'] },
      });
      if (inPrivate) {
        const perms = privatePermissions(page);
        if (perms) tx.update('block', id, [], { permissions: perms });
      }
    });
  }
}

/** Drop onto a section header / team row: move into Private, a teamspace, or add to Favorites. */
export function dropIntoContainer(id: string, container: { kind: 'private' } | { kind: 'favorites' } | { kind: 'team'; teamId: string }) {
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  const alias = getBlock(id);
  // a "Link to page" row stands for the page it links to (Favorites); it never becomes a top-level page itself
  if (alias?.type === 'alias') {
    const linked = aliasTargetId(alias);
    if (container.kind === 'favorites' && linked) dropIntoContainer(linked, container);
    return;
  }
  const page = alias;
  if (!sv || !page) return;
  if (container.kind === 'favorites') {
    if (!sv.bookmarked_pages.includes(id)) run('addToFavorites', (tx) => tx.listBefore('space_view', sv.id, ['bookmarked_pages'], id));
    return;
  }
  if (container.kind === 'team') {
    run('sidebar.moveToTeam', (tx) => moveBlocksIn(tx, [id], { parentId: container.teamId, parentTable: 'team', first: true }));
    return;
  }
  run('sidebar.moveToPrivate', (tx) => {
    moveBlocksIn(tx, [id], { parentId: sv.space_id, parentTable: 'space', first: true, list: { table: 'space_view', id: sv.id, path: ['private_pages'] } });
    const perms = privatePermissions(page);
    if (perms) tx.update('block', id, [], { permissions: perms });
  });
}

function zoneFor(e: React.DragEvent, el: HTMLElement, allowInside: boolean, allowReorder: boolean): DropZone | null {
  const r = el.getBoundingClientRect();
  const y = e.clientY - r.top;
  if (!allowReorder) return allowInside ? 'inside' : null;
  if (!allowInside) return y < r.height / 2 ? 'before' : 'after';
  if (y < r.height * 0.25) return 'before';
  if (y > r.height * 0.75) return 'after';
  return 'inside';
}

export function draggedPageId(e: React.DragEvent): string | null {
  return useSidebarDrag.getState().dragging ?? (e.dataTransfer.types.includes('text/x-nc-page') ? 'external' : null);
}

// ---------------- row ----------------
// Rows subscribe only to their own block, its child blocks (when expanded) and its collection — not the whole
// block table — so typing in the editor doesn't re-render the sidebar.
export const PageTreeItem = memo(PageTreeItemImpl, (a, b) =>
  a.pageId === b.pageId && a.depth === b.depth && a.section === b.section && a.ctx.kind === b.ctx.kind &&
  (a.ctx as { teamId?: string }).teamId === (b.ctx as { teamId?: string }).teamId &&
  (a.ctx as { parentId?: string }).parentId === (b.ctx as { parentId?: string }).parentId);

function PageTreeItemImpl({ pageId, depth, ctx, section }: { pageId: string; depth: number; ctx: TreeCtx; section: string }) {
  // `pageId` is the row's block: a page / database, or a "Link to page" block shown as the page it links to
  const rowBlock = useBlock(pageId);
  const linkedId = aliasTargetId(rowBlock);
  const linked = useBlock(linkedId);
  const isLink = !!linkedId;
  const block = isLink ? linked : rowBlock;
  const nodeId = block?.id ?? pageId;
  useRecord('collection', block?.collection_id);
  const { route } = useLocation();
  const expandKey = `${section}:${pageId}`;
  const expanded = useSidebarExpand((s) => !!s.expanded[expandKey]);
  const childRecs = useRecords<BlockRecord>('block', expanded ? block?.content : undefined);
  // links among the children: watch the pages they point at so the row appears once they load
  const childLinks = useRecords<BlockRecord>('block', expanded ? childRecs.map((c) => aliasTargetId(c)).filter((x): x is string => !!x) : undefined);
  const setExpanded = (v: boolean) => useSidebarExpand.getState().setExpanded(expandKey, v);
  const over = useSidebarDrag((s) => (s.over?.key === `${section}:${pageId}` ? s.over.zone : null));
  const [renaming, setRenaming] = useState(false);
  const rowRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (expanded) ensureChildrenLoaded(nodeId);
  }, [expanded, nodeId]);
  useEffect(() => {
    // the linked page itself may not be loaded yet (the sidebar loads children lazily)
    if (rowBlock?.type === 'alias' && rowBlock.parent_table === 'block' && linkedId && !linked) ensureChildrenLoaded(rowBlock.parent_id);
  }, [rowBlock?.type, rowBlock?.parent_id, linkedId, linked]);

  if (!rowBlock || !rowBlock.alive) return null;
  if (!block || !block.alive || (isLink && !isOutlineChild(rowBlock, block))) return null;
  const isDbInline = block.type === 'collection_view';
  const title = pageTitle(block) || (isDbInline || block.type === 'collection_view_page' ? t('lp.shell.untitled', 'Untitled') : t('lp.shell.new_page', 'New page'));
  const linkTargets = new Map(childLinks.filter((c): c is BlockRecord => !!c).map((c) => [c.id, c]));
  const kids = (block?.content ?? []).filter((_, i) => {
    const c = childRecs[i];
    return isOutlineChild(c, c?.type === 'alias' ? linkTargets.get(aliasTargetId(c) ?? '') : undefined);
  });
  const selected = route.name === 'page' && route.pageId === nodeId;
  const isDb = isDbInline || block.type === 'collection_view_page';
  const canNest = !isDb;
  const reorderable = ctx.kind !== 'recents';
  const menuLabel = ctx.kind === 'favorites'
    ? t('lp.shell.rename_remove_and_other_options', 'Rename, remove, and other options…')
    : t('lp.shell.duplicate_delete_and_other_options', 'Duplicate, delete, and other options…');

  const onDragOver = (e: React.DragEvent) => {
    const dragging = useSidebarDrag.getState().dragging;
    if (!dragging || dragging === pageId || dragging === nodeId || isAncestor(dragging, nodeId)) return;
    const zone = zoneFor(e, e.currentTarget as HTMLElement, canNest, reorderable);
    if (!zone) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const key = `${section}:${pageId}`;
    const cur = useSidebarDrag.getState().over;
    if (cur?.key !== key || cur.zone !== zone) useSidebarDrag.getState().set({ over: { key, zone } });
  };
  const onDrop = (e: React.DragEvent) => {
    const dragging = useSidebarDrag.getState().dragging;
    const zone = useSidebarDrag.getState().over?.zone;
    useSidebarDrag.getState().set({ over: null, dragging: null });
    if (!dragging || !zone) return;
    e.preventDefault();
    e.stopPropagation();
    // dropping into a link row puts the page into the linked page; before / after = next to the link block
    dropPage(dragging, zone === 'inside' ? nodeId : pageId, zone, ctx);
    if (zone === 'inside') setExpanded(true);
  };

  return (
    <div className={`lit-selectable lit-page-block nc-sb-page${isLink ? ' nc-sb-link' : ''}`} data-block-id={pageId} data-link-target={isLink ? nodeId : undefined}>
      <a
        ref={rowRef}
        role="treeitem"
        aria-expanded={expanded}
        aria-selected={selected}
        href={pageUrl(nodeId)}
        className={`nc-sb-item ${selected ? 'selected' : ''} ${over ? `drop-${over}` : ''}`}
        draggable={!renaming}
        onClick={(e) => {
          e.preventDefault();
          if (renaming) return;
          if (e.altKey) openPeek(nodeId, 'side_peek');
          else if (e.metaKey || e.ctrlKey) window.open(pageUrl(nodeId), '_blank');
          else {
            openPage(nodeId);
            if (window.innerWidth < 600) useUI.getState().setSidebarOpen(false);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openPageRowMenu(nodeId, { x: e.clientX, y: e.clientY }, undefined, { inFavorites: ctx.kind === 'favorites', rowEl: rowRef.current });
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData('text/x-nc-page', nodeId);
          e.dataTransfer.setData('text/uri-list', location.origin + pageUrl(nodeId));
          e.dataTransfer.setData('text/plain', location.origin + pageUrl(nodeId));
          useSidebarDrag.getState().set({ dragging: pageId, over: null });
        }}
        onDragEnd={() => useSidebarDrag.getState().set({ dragging: null, over: null })}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            const cur = useSidebarDrag.getState().over;
            if (cur?.key === `${section}:${pageId}`) useSidebarDrag.getState().set({ over: null });
          }
        }}
        onDrop={onDrop}
      >
        <div className="nc-sb-item-inner" style={{ paddingInlineStart: 8 + depth * INDENT }}>
          <div className="nc-sb-item-icon">
            <div className="nc-sb-icon-grid">
              <div className="nc-sb-toggle-layer">
                <div
                  role="button"
                  aria-label={expanded ? t('lp.shell.close', 'Close') : t('lp.shell.open', 'Open')}
                  className="nc-sb-toggle"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setExpanded(!expanded);
                  }}
                >
                  <Icon name="arrowChevronSingleDownFillSmall" size={12} style={{ transform: expanded ? 'none' : 'rotateZ(-90deg)', transition: 'transform 200ms ease-out', color: 'var(--lp-icon-tertiary)' }} />
                </div>
              </div>
              <div className="nc-sb-icon-layer">
                <PageIcon block={block} size={20} fallback={isDbInline || block.type === 'collection_view_page' ? 'viewTable' : 'page'} />
                {isLink && <span className="nc-sb-link-arrow" aria-hidden><Icon name="arrowDiagonalUpRightSmall" size={10} strokeWidth={2.4} /></span>}
              </div>
            </div>
          </div>
          <div className="nc-sb-item-title">
            {renaming ? (
              <InlineRename pageId={nodeId} onDone={() => setRenaming(false)} />
            ) : (
              <div className="notranslate nc-ellipsis">{title}</div>
            )}
          </div>
          <div className="nc-sb-item-actions">
            <div className="nc-sb-item-actions-inner">
              {canNest && (
                <div
                  role="button"
                  aria-label={t('lp.shell.create_a_subpage', 'Create a subpage')}
                  className="nc-sb-mini-btn"
                  data-tooltip={t('lp.shell.create_a_subpage', 'Create a subpage')}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setExpanded(true);
                    newPage({ kind: 'block', parentId: nodeId, after: block.content?.[block.content.length - 1] });
                  }}
                >
                  <Icon name="plusSmall" size={16} />
                </div>
              )}
              <div
                role="button"
                aria-label={menuLabel}
                className="nc-sb-mini-btn lit-sidebar-page-menu"
                data-tooltip={menuLabel}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openPageRowMenu(nodeId, e.currentTarget as HTMLElement, undefined, { inFavorites: ctx.kind === 'favorites', rowEl: rowRef.current });
                }}
              >
                <Icon name="ellipsisSmall" size={16} />
              </div>
            </div>
          </div>
        </div>
      </a>
      {expanded && isDb && (
        <div role="group" className="nc-sb-children">
          {(block.view_ids ?? []).length ? (
            (block.view_ids ?? []).map((vid) => <DbViewRow key={vid} viewId={vid} pageId={nodeId} depth={depth + 1} />)
          ) : (
            <EmptyRow depth={depth + 1} label={t('lp.shell.no_pages_inside', 'Empty')} />
          )}
        </div>
      )}
      {expanded && canNest && (
        <div role="group" className="nc-sb-children">
          {kids.length ? (
            kids.map((id) => <PageTreeItem key={id} pageId={id} depth={depth + 1} ctx={{ kind: 'page', parentId: nodeId }} section={section} />)
          ) : (
            <EmptyRow depth={depth + 1} label={t('lp.shell.no_pages_inside', 'Empty')} />
          )}
        </div>
      )}
    </div>
  );
}


function DbViewRow({ viewId, pageId, depth }: { viewId: string; pageId: string; depth: number }) {
  const view = useRecord<{ name?: string; type?: string }>('collection_view', viewId);
  if (!view) return null;
  return (
    <div className="nc-sb-page">
      <a
        role="treeitem"
        href={`${pageUrl(pageId)}?v=${viewId.replace(/-/g, '')}`}
        className="nc-sb-item"
        onClick={(e) => {
          e.preventDefault();
          openPage(pageId);
          window.dispatchEvent(new CustomEvent('nc:select-view', { detail: { blockId: pageId, viewId } }));
        }}
      >
        <div className="nc-sb-item-inner" style={{ paddingInlineStart: 8 + depth * INDENT }}>
          <div className="nc-sb-item-icon"><span className="nc-sb-view-dot" /></div>
          <div className="nc-sb-item-title"><div className="notranslate nc-ellipsis">{view.name || t('lp.shell.untitled', 'Untitled')}</div></div>
        </div>
      </a>
    </div>
  );
}

export function EmptyRow({ depth, label }: { depth: number; label: ReactNode }) {
  return (
    <div className="nc-sb-empty" style={{ paddingInlineStart: 8 + depth * INDENT + 30 }}>
      {label}
    </div>
  );
}

function InlineRename({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const [v, setV] = useState(() => pageTitle(getBlock(pageId)));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    startInlineRename(pageId, v);
    onDone();
  };
  return (
    <input
      ref={ref}
      className="nc-sb-rename"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        else if (e.key === 'Escape') onDone();
      }}
      onBlur={commit}
    />
  );
}

/** True when the current route is this page (or one of its descendants, for ancestor highlighting). */
export function isCurrentPage(pageId: string): boolean {
  const { route } = getLocation();
  return route.name === 'page' && route.pageId === pageId;
}
