// Page-level actions shared by the sidebar, topbar ••• menu and page links.
import type { BlockRecord, SpaceViewRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { api } from '../../lib/api.ts';
import { createPageIn, deleteBlocksIn, getBlock, listLocation, run } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { currentSpaceView } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { getLocation, navigate, openPage, pageUrl, spaceDomain } from '../../lib/router.ts';
import { loadPage } from './usePageLoader.ts';

export function isFavorite(pageId: string): boolean {
  return !!currentSpaceView()?.bookmarked_pages?.includes(pageId);
}

export function toggleFavorite(pageId: string) {
  const sv = currentSpaceView();
  if (!sv) return;
  const fav = sv.bookmarked_pages?.includes(pageId);
  run(fav ? 'removeFromFavorites' : 'addToFavorites', (tx) => {
    if (fav) tx.listRemove('space_view', sv.id, ['bookmarked_pages'], pageId);
    else tx.listBefore('space_view', sv.id, ['bookmarked_pages'], pageId);
  });
}

export async function duplicatePage(pageId: string) {
  const res = await api('duplicateBlock', { blockId: pageId });
  if (res.blockId) {
    await loadPage(res.blockId, true);
    const p = getBlock(pageId);
    if (p?.parent_table === 'block') await loadPage(p.parent_id, true);
    useUI.getState().toast('Duplicated');
  }
  return res.blockId as string;
}

export function trashPage(pageId: string) {
  const page = getBlock(pageId);
  if (!page) return;
  const sv = currentSpaceView();
  run('deletePage', (tx) => {
    deleteBlocksIn(tx, [pageId]);
    if (sv?.bookmarked_pages?.includes(pageId)) tx.listRemove('space_view', sv.id, ['bookmarked_pages'], pageId);
  });
  const { route } = getLocation();
  if (route.name === 'page' && route.pageId === pageId) {
    if (page.parent_table === 'block') openPage(page.parent_id);
    else navigate(`/${spaceDomain(page.space_id)}`);
  }
  useUI.getState().toast(`Sent "${toPlainText(page.properties?.title) || 'Untitled'}" to Trash`, {
    label: 'Undo',
    run: () => restorePage(pageId),
  });
}

export function restorePage(pageId: string) {
  const page = getBlock(pageId);
  if (!page) return;
  run('restorePage', (tx) => {
    tx.update('block', pageId, [], { alive: true, deleted_time: undefined, deleted_by_id: undefined });
    const parent = page.parent_table === 'block' ? getBlock(page.parent_id) : undefined;
    if (page.parent_table === 'block') {
      if (parent && parent.alive) tx.listAfter('block', page.parent_id, ['content'], pageId);
    } else if (page.parent_table === 'team') {
      tx.listAfter('team', page.parent_id, ['team_pages'], pageId);
    } else if (page.parent_table === 'space') {
      const isPrivate = page.permissions?.some((p) => p.type === 'user_permission') && !page.permissions?.some((p) => p.type === 'space_permission');
      const sv = currentSpaceView();
      if (isPrivate && sv) tx.listBefore('space_view', sv.id, ['private_pages'], pageId);
      else tx.listAfter('space', page.parent_id, ['pages'], pageId);
    }
  });
}

export function newPage(where: Parameters<typeof createPageIn>[1], opts?: { open?: boolean; title?: string; icon?: string }): string {
  let id = '';
  run('createPage', (tx) => {
    id = createPageIn(tx, where, { title: opts?.title ? [[opts.title]] : [], icon: opts?.icon });
  });
  if (opts?.open !== false) openPage(id);
  return id;
}

export function copyPageLink(pageId: string, blockId?: string) {
  const url = location.origin + pageUrl(pageId, { blockId });
  void navigator.clipboard?.writeText(url);
  useUI.getState().toast('Link copied');
}

export function pageTitle(block: BlockRecord | undefined): string {
  if (!block) return '';
  if (block.type === 'collection_view_page' || block.type === 'collection_view') {
    const col = records.get('collection', block.collection_id) as any;
    const t = toPlainText(col?.name);
    if (t) return t;
  }
  return toPlainText(block.properties?.title);
}

export function privatePages(): string[] {
  return (currentSpaceView() as SpaceViewRecord | undefined)?.private_pages ?? [];
}

export { listLocation };
