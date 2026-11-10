// Dragging blocks out of the page onto a page in the sidebar moves them into that page: the row lights up
// while the pointer is over it, and on drop the blocks go to the end of that page ("Moved to <page>", like Move to).
// Only regular pages the user can edit accept blocks, and never a page that is itself being dragged (or inside one).
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { getBlock, moveBlocksIn, run } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { pageTitle } from '../page/pageActions.ts';
import { useEditor } from './editorState.ts';

let lit: HTMLElement | null = null;

function highlight(el: HTMLElement | null) {
  if (lit === el) return;
  lit?.classList.remove('drop-inside');
  lit = el;
  el?.classList.add('drop-inside');
}

function canReceive(pageId: string, ids: string[]): boolean {
  const p = getBlock(pageId);
  if (!p || p.type !== 'page' || p.alive === false) return false;
  if (!roleAtLeast(records.role('block', pageId), 'read_and_write')) return false;
  for (let cur: typeof p | undefined = p, i = 0; cur && i < 60; cur = cur.parent_table === 'block' ? getBlock(cur.parent_id) : undefined, i++) {
    if (ids.includes(cur.id)) return false;
  }
  return true;
}

/** Over the sidebar: the page row under the pointer that can take the dragged blocks (its row lights up) or '' for * anywhere else in the sidebar (no drop there); null when the pointer is not over the sidebar. */
export function sidebarPageAt(x: number, y: number, ids: string[]): string | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!hit?.closest?.('.lit-sidebar-container')) {
    highlight(null);
    return null;
  }
  const item = hit.closest('.nc-sb-item') as HTMLElement | null;
  const pageId = item?.closest<HTMLElement>('.nc-sb-page[data-block-id]')?.dataset.blockId ?? null;
  const ok = !!item && !!pageId && canReceive(pageId, ids);
  highlight(ok ? item : null);
  return ok ? pageId : '';
}

export function clearSidebarDrop() {
  highlight(null);
}

/** Other drop targets for dragged blocks outside the page flow (e.g. a database view taking pages as items, * features/database/rowPageDrag.ts): called on every move; return a target or null. */
export interface ExternalBlockDrop { key: string; drop: (ids: string[]) => void }
export const externalBlockDropTargets: ((x: number, y: number, ids: string[]) => ExternalBlockDrop | null)[] = [];

export function moveBlocksToPage(ids: string[], pageId: string) {
  const p = getBlock(pageId);
  if (!p) return;
  const rest = (p.content ?? []).filter((id) => !ids.includes(id));
  run('blockDrag.moveToPage', (tx) => {
    moveBlocksIn(tx, ids, { parentId: pageId, parentTable: 'block', after: rest[rest.length - 1] });
    // an inline database dragged into the sidebar becomes a full-page database there 
    for (const id of ids) if (getBlock(id)?.type === 'collection_view') tx.update('block', id, [], { type: 'collection_view_page' });
  });
  useEditor.getState().clearBlockSelection();
  useUI.getState().toast(`Moved to ${pageTitle(p) || 'New page'}`);
}
