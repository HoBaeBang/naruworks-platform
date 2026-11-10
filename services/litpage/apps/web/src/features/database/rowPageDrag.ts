// Pages ↔ database items by dragging:
// • page blocks dragged (⋮⋮) onto a database view become items of the view's data source — content, icon and cover
// stay, the title becomes the Name; the database lights up while the pointer is over it (editor hook
// externalBlockDropTargets in features/editor/dragToSidebar.ts);
// • text blocks (paragraphs, to-dos, list items, toggles, headings) dragged there become items too, their text the
// Name; @date and @person mentions fill the first Date / Person property;
// • a table row dragged out of the database onto the page becomes a page block there (its database property values
// stay on the record, out of sight).
// Both need edit access to the page and to the database's data source (the server checks the same).
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { encodeDate, encodePeople } from '@nc/shared/database/index.ts';
import { getBlock, moveBlocksIn, run } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { externalBlockDropTargets } from '../editor/dragToSidebar.ts';
import { collectionAccess } from './access.ts';

// ---------------------------------------------------------------- pages → database items

let lit: HTMLElement | null = null;
// a data attribute, not a class: React re-renders the database's className while the pointer moves over it
function highlight(el: HTMLElement | null) {
  if (lit === el) return;
  if (lit) delete lit.dataset.dropTarget;
  lit = el;
  if (el) el.dataset.dropTarget = 'true';
}

function canAddTo(collectionId: string): boolean {
  return collectionAccess(collectionId).canEditContent;
}

/** Blocks that become database items: pages, and text blocks that turn into pages. */
const TEXT_TYPES = new Set(['text', 'to_do', 'bulleted_list', 'numbered_list', 'toggle', 'header', 'sub_header', 'sub_sub_header', 'quote', 'callout']);

/** Blocks a database can take: plain pages and text blocks (no databases), not the database itself or one of its * ancestors. */
function movablePages(ids: string[], dbBlockId: string): boolean {
  if (!ids.length) return false;
  for (const id of ids) {
    const b = getBlock(id);
    if (!b || (b.type !== 'page' && !TEXT_TYPES.has(b.type)) || b.parent_table !== 'block') return false;
    if (!roleAtLeast(records.role('block', id), 'read_and_write')) return false;
    for (let cur = getBlock(dbBlockId), i = 0; cur && i < 60; cur = cur.parent_table === 'block' ? getBlock(cur.parent_id) : undefined, i++) {
      if (cur.id === id) return false;
    }
  }
  return true;
}

/** Mentions in a text block's title: the first date and every person. */
function mentionsOf(title: RichText | undefined): { date?: Record<string, unknown>; people: string[] } {
  const out: { date?: Record<string, unknown>; people: string[] } = { people: [] };
  for (const seg of (title ?? []) as unknown[]) {
    const anns = Array.isArray(seg) && Array.isArray(seg[1]) ? (seg[1] as unknown[]) : [];
    for (const a of anns) {
      if (!Array.isArray(a)) continue;
      if (a[0] === 'd' && a[1] && !out.date) out.date = a[1] as Record<string, unknown>;
      if (a[0] === 'u' && typeof a[1] === 'string') out.people.push(a[1]);
    }
  }
  return out;
}

export function movePagesIntoDatabase(ids: string[], collectionId: string, viewId?: string) {
  const c = records.get<CollectionRecord>('collection', collectionId);
  if (!c) return;
  const dateProp = Object.entries(c.schema).find(([, p]) => p.type === 'date')?.[0];
  const personProp = Object.entries(c.schema).find(([, p]) => p.type === 'person')?.[0];
  run('dragPagesIntoDatabase', (tx) => {
    // text blocks turn into pages first (their children become the page's content)
    for (const id of ids) {
      const b = getBlock(id);
      if (!b || b.type === 'page') continue;
      const title = (b.properties?.title as RichText | undefined) ?? [];
      const m = mentionsOf(title);
      const props: Record<string, unknown> = { title };
      if (dateProp && m.date) props[dateProp] = encodeDate(m.date as never);
      if (personProp && m.people.length) props[personProp] = encodePeople(m.people);
      tx.update('block', id, [], { type: 'page', properties: props });
    }
    moveBlocksIn(tx, ids, { parentId: collectionId, parentTable: 'collection' });
    // a view in manual order shows them at the end
    const v = viewId ? records.get<CollectionViewRecord>('collection_view', viewId) : undefined;
    if (v && (v.page_sort ?? []).length) tx.set('collection_view', v.id, ['page_sort'], [...(v.page_sort ?? []).filter((x) => !ids.includes(x)), ...ids]);
  });
  useUI.getState().toast(`Moved to ${toPlainText(c.name as never) || 'Untitled'}`);
}

externalBlockDropTargets.push((x, y, ids) => {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  // only the rows area takes pages: over the title / tabs / toolbar the blocks still reorder around the database
  const db = hit?.closest('.lit-collection-view-body')?.closest<HTMLElement>('.nc-db[data-db-collection]') ?? null;
  const collectionId = db?.dataset.dbCollection;
  const blockId = db?.dataset.dbBlock;
  if (!db || !collectionId || !blockId || !movablePages(ids, blockId) || !canAddTo(collectionId)) {
    highlight(null);
    return null;
  }
  highlight(db);
  const viewId = db.dataset.dbView;
  return { key: `db:${collectionId}`, drop: (dropped) => { highlight(null); movePagesIntoDatabase(dropped, collectionId, viewId); } };
});
window.addEventListener('pointerup', () => highlight(null), true);

// ---------------------------------------------------------------- database items → pages

const ROW_TYPE = 'application/x-nc-db-rows';
let draggingRows: string[] | null = null;
let indicator: HTMLDivElement | null = null;

/** Table rows started dragging (TableView): they may leave the database for the page. */
export function startRowDrag(e: React.DragEvent, rowIds: string[]) {
  draggingRows = rowIds;
  try {
    e.dataTransfer.setData(ROW_TYPE, JSON.stringify(rowIds));
  } catch {
    /* some browsers restrict custom types: the module state is enough */
  }
}

export function endRowDrag() {
  draggingRows = null;
  showIndicator(null);
}

function showIndicator(r: { left: number; top: number; width: number } | null) {
  if (!r) {
    indicator?.remove();
    indicator = null;
    return;
  }
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'nc-row-to-page-indicator';
    document.body.appendChild(indicator);
  }
  indicator.style.left = `${r.left}px`;
  indicator.style.top = `${r.top}px`;
  indicator.style.width = `${r.width}px`;
}

/** Where on the page the rows would land: before / after a top-level block of the page under the pointer, else at * the end of the page (not over a database, the sidebar or a menu). */
function pageDropTarget(x: number, y: number): { pageId: string; anchor?: string; where: 'before' | 'after'; rect?: DOMRect } | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!hit || hit.closest('.nc-db, .lit-overlay-container, .lit-sidebar-container')) return null;
  const scroller = hit.closest<HTMLElement>('.nc-page-scroller[data-page-id]');
  const pageId = scroller?.dataset.pageId;
  if (!scroller || !pageId) return null;
  const tops = [...scroller.querySelectorAll<HTMLElement>('.lit-page-content > .nc-block-list > .lit-selectable[data-block-id]')];
  for (const el of tops) {
    const r = el.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) return { pageId, anchor: el.dataset.blockId, where: y < r.top + r.height / 2 ? 'before' : 'after', rect: r };
  }
  const last = tops[tops.length - 1];
  return { pageId, anchor: last?.dataset.blockId, where: 'after', rect: last?.getBoundingClientRect() };
}

export function moveRowsToPage(rowIds: string[], target: { pageId: string; anchor?: string; where: 'before' | 'after' }) {
  const page = getBlock(target.pageId);
  if (!page || !roleAtLeast(records.role('block', page.id), 'read_and_write')) return;
  const rows = rowIds.map((id) => getBlock(id)).filter((b): b is BlockRecord => !!b && b.parent_table === 'collection');
  if (!rows.length) return;
  const anchor = target.anchor ?? page.content?.[page.content.length - 1];
  run('dragRowsOutOfDatabase', (tx) => {
    moveBlocksIn(tx, rows.map((r) => r.id), { parentId: page.id, parentTable: 'block', ...(target.where === 'before' && anchor ? { before: anchor } : { after: anchor }) });
  });
  useUI.getState().toast(rows.length === 1 ? 'Moved out of the database' : `Moved ${rows.length} pages out of the database`);
}

document.addEventListener('dragover', (e) => {
  if (!draggingRows) return;
  const t = pageDropTarget(e.clientX, e.clientY);
  if (!t) return showIndicator(null);
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (t.rect) showIndicator({ left: t.rect.left, top: (t.where === 'before' ? t.rect.top : t.rect.bottom) - 2, width: t.rect.width });
  else showIndicator(null);
});

document.addEventListener('drop', (e) => {
  const ids = draggingRows;
  if (!ids) return;
  const t = pageDropTarget(e.clientX, e.clientY);
  showIndicator(null);
  if (!t) return;
  e.preventDefault();
  draggingRows = null;
  moveRowsToPage(ids, t);
});
