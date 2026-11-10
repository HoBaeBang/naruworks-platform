// Links to a block — "Copy link to block" / ⌥⇧L  and block mentions  — are the page URL plus
// "#<block id>". Opening one scrolls the page to that block (collapsed toggle ancestors open first) and flashes it.
import { useEffect } from 'react';
import { compactId, expandId } from '@nc/shared/ids.ts';
import { getBlock } from '../../lib/blocks.ts';
import { getLocation, openPage, useLocation } from '../../lib/router.ts';
import { pageIdOfBlock, setOpen } from './commands.ts';
import { blockElement } from './blocks/shared.tsx';

let lastReveal = { id: '', at: 0 };

/** Scroll to a block of the open page and flash it. Waits (up to ~2s) for the block to be rendered. */
export function revealBlock(blockId: string) {
  const now = Date.now();
  if (lastReveal.id === blockId && now - lastReveal.at < 800) return;
  lastReveal = { id: blockId, at: now };
  for (let cur = getBlock(getBlock(blockId)?.parent_id), i = 0; cur && cur.parent_table === 'block' && i < 30; cur = getBlock(cur.parent_id), i++) {
    if (cur.type === 'toggle' || cur.format?.toggleable) setOpen(cur.id, true);
  }
  let tries = 0;
  const attempt = () => {
    const el = blockElement(blockId);
    if (!el) {
      if (tries++ < 40) setTimeout(attempt, 50);
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('nc-flash');
    void el.offsetWidth; // restart the animation when the same block is revealed again
    el.classList.add('nc-flash');
    setTimeout(() => el.classList.remove('nc-flash'), 1200);
  };
  requestAnimationFrame(attempt);
}

/** Follow a link to a block: on its page already → just scroll there (and put the block in the URL), else navigate. */
export function openBlockLink(pageId: string, blockId: string) {
  const loc = getLocation();
  const here = (loc.route.name === 'page' && loc.route.pageId === pageId) || loc.peek?.pageId === pageId;
  if (!here) {
    openPage(pageId, { blockId });
    return;
  }
  revealBlock(blockId);
  if (loc.route.name === 'page' && loc.route.pageId === pageId) history.replaceState(history.state, '', `${location.pathname}${location.search}#${compactId(blockId)}`);
}

/** Page editors: when the URL names one of this page's blocks ("#<32 hex>"), bring it into view once it is loaded. */
export function useBlockLinkScroll(pageId: string) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!/^[0-9a-f]{32}$/i.test(hash)) return;
    const blockId = expandId(hash.toLowerCase());
    if (blockId === pageId) return;
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      if (getBlock(blockId) && pageIdOfBlock(blockId) === pageId) revealBlock(blockId);
      else if (tries++ < 50) setTimeout(attempt, 100); // the page's blocks may still be loading
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [hash, pageId]);
}
