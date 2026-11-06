// “Modify” the current block, ⌘Enter on a focused or selected block: check a to-do,
// open/close a toggle, open a page, show an image/embed/PDF/video in full screen, edit a block equation.
// Space on a selected image opens/closes its full screen viewer.
import { getBlock } from '../../lib/blocks.ts';
import { isOpen, setOpen } from './commands.ts';
import { toggleTodo } from './textHandlers.ts';

const PAGE_TYPES = new Set(['page', 'collection_view_page']);
const FULLSCREEN_TYPES = new Set(['image', 'video', 'pdf', 'embed', 'figma', 'loom', 'maps', 'miro', 'drive', 'tweet', 'codepen', 'excalidraw', 'framer', 'gist', 'typeform', 'whimsical']);

/** Returns true when the block had a modify action. */
export function modifyBlock(blockId: string): boolean {
  const b = getBlock(blockId);
  if (!b) return false;
  if (b.type === 'to_do') {
    toggleTodo(blockId);
    return true;
  }
  if (b.type === 'toggle' || b.format?.toggleable) {
    setOpen(blockId, !isOpen(blockId));
    return true;
  }
  if (PAGE_TYPES.has(b.type) || b.type === 'alias') {
    const target = b.type === 'alias' ? ((b.format?.alias_pointer as { id?: string } | undefined)?.id ?? null) : b.id;
    if (target) void import('../../lib/router.ts').then((r) => r.openPage(target));
    return true;
  }
  if (b.type === 'equation') {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"] .nc-equation-2, [data-block-id="${blockId}"] .nc-blk-placeholder`);
    if (el) void import('./blocks/equation.block.tsx').then((m) => m.openEquationEditor(blockId, el));
    return true;
  }
  if (FULLSCREEN_TYPES.has(b.type)) {
    void import('./blocks/media.block.tsx').then((m) => m.openFullScreen(blockId));
    return true;
  }
  return false;
}
