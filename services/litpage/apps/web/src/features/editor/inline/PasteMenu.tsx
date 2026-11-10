// "Paste as" menu shown after pasting a bare URL at the caret (header "Paste as",
// Actions: Mention, URL (dismiss and keep the link), Bookmark, and Embed; page URLs offer Mention, Page link, and URL.
// links to a block (…#<block id>): Mention, Synced block, or URL; database links: Mention /
// Connected database view / URL).
// The URL is inserted as linked text first, so dismissing (Esc / click away) keeps a plain link.
import { deleteRange, insertRich, length, type RichText } from '@nc/shared/richtext.ts';
import { expandId, newId } from '@nc/shared/ids.ts';
import { PAGE_LIKE } from '@nc/shared/blocks.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { createBlockIn, deleteBlocksIn, getBlock, moveBlocksIn, run, setTitle } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { commitText } from '../textHandlers.ts';
import { useEditor } from '../editorState.ts';
import { rectsForRange } from '../richTextDom.ts';
import { valueOf } from './format.ts';
import { api } from '../../../lib/api.ts';
import { internalPageId } from './LinkPopups.tsx';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** "Paste as" items contributed by features for URLs they own; the first extension that returns items replaces the default list. */
export const pasteUrlExtensions: ((url: string, range: { blockId: string; property: string; start: number; end: number }) => MenuItemDef[] | null)[] = [];

/** Insert `url` as a link at `offset` and open the "Paste as" menu next to it. */
export function pasteUrlWithMenu(blockId: string, property: string, start: number, end: number, url: string) {
  const value = valueOf(blockId, property);
  let next = deleteRange(value, start, end);
  next = insertRich(next, start, [[url, [['a', url]]]]);
  const linkEnd = start + url.length;
  commitText(blockId, property, next, linkEnd, { coalesce: false, action: 'paste' });
  useEditor.getState().requestFocus(blockId, linkEnd, { property });
  setTimeout(() => {
    const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${blockId}"][data-property="${property}"]`);
    const rects = leaf ? rectsForRange(leaf, start, linkEnd).filter((r) => r.width > 0) : [];
    const last = rects[rects.length - 1];
    const anchor = last ? new DOMRect(last.right, last.top, 0, last.height) : leaf?.getBoundingClientRect() ?? new DOMRect(200, 200, 0, 0);
    const pageId = internalPageId(url);
    const range = { blockId, property, start, end: linkEnd };
    const linked = pageId ? linkedBlock(url, pageId) : undefined;
    const page = pageId ? getBlock(pageId) : undefined;
    const database = !!page?.collection_id && (page.type === 'collection_view_page' || page.type === 'collection_view');
    const extended = pasteUrlExtensions.map((fn) => fn(url, range)).find((x) => x && x.length);
    const items: MenuItemDef[] = extended ? extended : linked
      ? [
          { label: 'Mention', icon: 'arrowDiagonalUpRight', onSelect: () => replaceWithAtom(range, [['‣', [['p', linked.id]]]]) },
          ...(canSyncFrom(linked, blockId) ? [{ label: 'Synced block', icon: 'blockSync', onSelect: () => toSyncedBlock(range, linked.id) }] : []),
          { label: 'URL', icon: 'link', onSelect: () => undefined },
        ]
      : pageId && database
      ? [
          { label: 'Mention', icon: 'arrowDiagonalUpRight', onSelect: () => replaceWithAtom(range, [['‣', [['p', pageId]]]]) },
          { label: 'Connected database view', icon: 'collectionArrow', onSelect: () => void toLinkedView(range, page!) },
          { label: 'URL', icon: 'link', onSelect: () => undefined },
        ]
      : pageId
      ? [
          { label: 'Mention', icon: 'arrowDiagonalUpRight', onSelect: () => replaceWithAtom(range, [['‣', [['p', pageId]]]]) },
          { label: 'Page link', icon: 'docSend', onSelect: () => toBlock(range, 'alias', { alias_pointer: { id: pageId, table: 'block', spaceId: useSession.getState().spaceId } }) },
          { label: 'URL', icon: 'link', onSelect: () => undefined },
        ]
      : [
          { label: 'Mention', icon: 'arrowDiagonalUpRight', onSelect: () => { replaceWithAtom(range, [['‣', [['lm', { href: url, title: hostOf(url) }]]]]); void enrichLinkMention(range.blockId, range.property, url); } },
          { label: 'URL', icon: 'link', onSelect: () => undefined },
          { label: 'Bookmark', icon: 'bookmark', onSelect: () => toBlock(range, 'bookmark', undefined, url) },
          { label: 'Embed', icon: 'linkCapture', onSelect: () => toBlock(range, 'embed', undefined, url) },
        ];
    openMenu(anchor, { width: 240, sections: [{ title: 'Paste as', items }] }, { placement: 'bottom-start', offset: 4 });
  }, 30);
}

/** Link mentions show the page's own title and icon: fetched server-side, then written into the * mention (every ["lm"] of this URL in the block that still has the host-name placeholder). */
async function enrichLinkMention(blockId: string, property: string, url: string) {
  let meta: { title?: string | null; icon_url?: string | null; description?: string | null; provider?: string } | null = null;
  try {
    meta = await api('getLinkMetadata', { url });
  } catch {
    return;
  }
  if (!meta?.title && !meta?.icon_url) return;
  const value = valueOf(blockId, property);
  let changed = false;
  const next: RichText = value.map((d) => {
    const anns = (d[1] ?? []) as any[];
    const lm = anns.find((a) => a[0] === 'lm');
    if (!lm || lm[1]?.href !== url || (lm[1]?.title && lm[1].title !== hostOf(url))) return d;
    changed = true;
    const payload = { ...lm[1], title: meta!.title || lm[1].title, ...(meta!.icon_url ? { icon_url: meta!.icon_url } : {}), ...(meta!.description ? { description: meta!.description.slice(0, 300) } : {}), ...(meta!.provider ? { provider: meta!.provider } : {}) };
    return [d[0], anns.map((a) => (a === lm ? ['lm', payload] : a))] as any;
  });
  if (changed) commitText(blockId, property, next, 0, { coalesce: false, action: 'embedMenu.linkMentionMetadata' });
}

/** "Reload mention": fetch the page's title, icon, or description again for the link mention at `offset`. */
export async function refreshLinkMention(blockId: string, property: string, offset: number, url: string) {
  let meta: { title?: string | null; icon_url?: string | null; description?: string | null; provider?: string } | null = null;
  try {
    meta = await api('getLinkMetadata', { url });
  } catch {
    return;
  }
  const value = valueOf(blockId, property);
  let pos = 0;
  let changed = false;
  const next: RichText = value.map((d) => {
    const at = pos;
    pos += d[0].length;
    const anns = (d[1] ?? []) as any[];
    const lm = anns.find((a) => a[0] === 'lm');
    if (at !== offset || !lm || lm[1]?.href !== url) return d;
    changed = true;
    const payload = { href: url, title: meta?.title || lm[1].title || hostOf(url), ...(meta?.icon_url ? { icon_url: meta.icon_url } : {}), ...(meta?.description ? { description: meta.description.slice(0, 300) } : {}), ...(meta?.provider ? { provider: meta.provider } : {}) };
    return [d[0], anns.map((a) => (a === lm ? ['lm', payload] : a))] as any;
  });
  if (changed) commitText(blockId, property, next, offset + 1, { coalesce: false, action: 'linkMention.reload' });
}

function replaceWithAtom(r: { blockId: string; property: string; start: number; end: number }, atom: RichText) {
  let next = deleteRange(valueOf(r.blockId, r.property), r.start, r.end);
  next = insertRich(next, r.start, atom);
  commitText(r.blockId, r.property, next, r.start + 1, { coalesce: false, action: 'embedMenu.linkMention' });
  useEditor.getState().requestFocus(r.blockId, r.start + 1, { property: r.property });
}

/** The block a workspace link points at with its "#<block id>" part (a block of that page, not the page itself). */
function linkedBlock(url: string, pageId: string): BlockRecord | undefined {
  let hash = '';
  try {
    hash = new URL(url, location.origin).hash.replace(/^#/, '');
  } catch {
    return undefined;
  }
  if (!/^[0-9a-f]{32}$/i.test(hash)) return undefined;
  const id = expandId(hash.toLowerCase());
  const b = getBlock(id);
  if (!b || b.alive === false || id === pageId || PAGE_LIKE.has(b.type)) return undefined;
  return b;
}

/** "Synced block" is offered for a block the user can edit, in this workspace, that is not (inside) the block the link * is pasted into — a synced copy may never sit inside its own original. */
function canSyncFrom(src: BlockRecord, hostId: string): boolean {
  if (src.type === 'transclusion_reference' || src.space_id !== useSession.getState().spaceId) return false;
  if (!roleAtLeast(records.role('block', src.id), 'read_and_write')) return false;
  for (let cur = getBlock(hostId), i = 0; cur && i < 60; cur = cur.parent_table === 'block' ? getBlock(cur.parent_id) : undefined, i++) {
    if (cur.id === src.id) return false;
  }
  return true;
}

/** The linked block becomes the original of a synced block (wrapped unless it already is one) and a synced copy takes * the URL's place: the empty paragraph itself, or a new block below the text. */
function toSyncedBlock(r: { blockId: string; property: string; start: number; end: number }, srcId: string) {
  const b = getBlock(r.blockId);
  const src = getBlock(srcId);
  if (!b || !src) return;
  const rest = deleteRange(valueOf(r.blockId, r.property), r.start, r.end);
  const refId = newId();
  run('embedMenu.createTransclusion', (tx) => {
    let containerId = src.type === 'transclusion_container' ? src.id : '';
    if (!containerId) {
      containerId = newId();
      createBlockIn(tx, { id: containerId, type: 'transclusion_container', parentId: src.parent_id, parentTable: src.parent_table as any, before: src.id });
      moveBlocksIn(tx, [src.id], { parentId: containerId, parentTable: 'block' });
    }
    const emptyHost = r.property === 'title' && length(rest) === 0 && b.type === 'text' && !(b.content?.length);
    createBlockIn(tx, {
      id: refId, type: 'transclusion_reference', parentId: b.parent_id, parentTable: b.parent_table as any, after: r.blockId,
      format: { transclusion_reference_pointer: { id: containerId, table: 'block', spaceId: src.space_id } } as any,
    });
    if (emptyHost) deleteBlocksIn(tx, [r.blockId]);
    else if (r.property === 'title') setTitle(tx, r.blockId, rest);
  });
  useEditor.getState().selectBlocks([refId], refId);
}

/** "Connected database view": a new inline view of the linked database (its first view's layout). */
async function toLinkedView(r: { blockId: string; property: string; start: number; end: number }, db: BlockRecord) {
  const b = getBlock(r.blockId);
  const collectionId = db.collection_id;
  if (!b || !collectionId) return;
  const { createViewIn } = await import('../../database/actions.ts');
  const firstView = records.get<CollectionViewRecord>('collection_view', db.view_ids?.[0]);
  const rest = deleteRange(valueOf(r.blockId, r.property), r.start, r.end);
  run('embedMenu.createLinkedViewOfDatabase', (tx) => {
    const blockId = newId();
    const pointer = { id: collectionId, table: 'collection', spaceId: db.space_id };
    createBlockIn(tx, { id: blockId, type: 'collection_view', parentId: b.parent_id, parentTable: b.parent_table as any, after: r.blockId, format: { collection_pointer: pointer } as any, extra: { collection_id: collectionId, view_ids: [] } });
    const viewId = createViewIn(tx, blockId, (firstView?.type ?? 'table') as any, collectionId, { extraFormat: { collection_pointer: pointer } });
    tx.listAfter('block', blockId, ['view_ids'], viewId);
    if (r.property === 'title' && length(rest) === 0 && b.type === 'text' && !(b.content?.length)) deleteBlocksIn(tx, [r.blockId]);
    else if (r.property === 'title') setTitle(tx, r.blockId, rest);
  });
}

/** Bookmark / Embed / Page link: the URL text is removed; an empty block becomes the new block, else it goes below. */
export function replaceRangeWithBlock(r: { blockId: string; property: string; start: number; end: number }, type: 'bookmark' | 'embed' | 'alias', format?: Record<string, unknown>, url?: string) {
  toBlock(r, type, format, url);
}

function toBlock(r: { blockId: string; property: string; start: number; end: number }, type: 'bookmark' | 'embed' | 'alias', format?: Record<string, unknown>, url?: string) {
  const b = getBlock(r.blockId);
  if (!b) return;
  const rest = deleteRange(valueOf(r.blockId, r.property), r.start, r.end);
  const props = url ? { source: [[url]] } : undefined;
  const fmt = { ...(format ?? {}), ...(url ? { display_source: url } : {}) };
  run(type === 'bookmark' ? 'bookmarkBlockActions.createBookmark' : type === 'embed' ? 'embedBlockActions.initializeEmbedBlock' : 'blockPasteMenu.linkToPage', (tx) => {
    if (r.property === 'title' && length(rest) === 0 && b.type === 'text' && !(b.content?.length)) {
      tx.update('block', r.blockId, [], { type });
      setTitle(tx, r.blockId, []);
      if (props) tx.set('block', r.blockId, ['properties', 'source'], props.source);
      tx.update('block', r.blockId, ['format'], fmt);
    } else {
      if (r.property === 'title') setTitle(tx, r.blockId, rest);
      createBlockIn(tx, { id: newId(), type, parentId: b.parent_id, parentTable: b.parent_table as any, after: r.blockId, properties: props, format: fmt });
    }
  });
}
