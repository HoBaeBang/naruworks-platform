// Editor commands: block-level keyboard behaviors (Enter / Backspace / Delete / Tab / turn into …) expressed as
// transactions and focus requests. Rules cover keyboard behavior,
// shortcuts and user actions:
// Enter text → new text · heading end → text, middle → heading + text · list item → same type (to-do unchecked)
// empty list item → text (nested → outdent) · closed toggle → sibling toggle · OPEN toggle/toggle heading → child
// closed toggle heading → sibling text · quote → top-level text · callout → child text · code → newline
// Backspace at start converts list, to-do, toggle, quote, or callout blocks to text;
// heading or text backspace merges into the previous block
import type { BlockRecord, BlockType } from '@nc/shared/records.ts';
import { concat, length, slice, splitAt, type RichText } from '@nc/shared/richtext.ts';
import { TEXT_BLOCKS, HEADING_TYPES, LIST_TYPES, PAGE_LIKE, canHaveChildren } from '@nc/shared/blocks.ts';
import { newId } from '@nc/shared/ids.ts';
import { createBlockIn, deleteBlocksIn, getBlock, indentIn, moveBlocksIn, outdentIn, previousSibling, run, setTitle, siblingsOf, touch } from '../../lib/blocks.ts';
import { useEditor, leavesInOrder } from './editorState.ts';
import { records } from '../../lib/store/records.ts';
import { stickyFormat } from './prefs.ts';

export function titleOf(id: string): RichText {
  return (getBlock(id)?.properties?.title as RichText | undefined) ?? [];
}

function sel(blockId: string, offset: number) {
  return { blockId, offset };
}

/** Blocks whose left decoration is removed by Backspace at the start (they turn into text). */
const DECORATED = new Set<BlockType>(['bulleted_list', 'numbered_list', 'to_do', 'toggle', 'quote', 'callout']);

function isToggleBlock(b: BlockRecord): boolean {
  return b.type === 'toggle' || (HEADING_TYPES.has(b.type) && !!b.format?.toggleable);
}

/** Type (and props) of the block created by Enter after `b`. */
function nextTypeFor(b: BlockRecord): { type: BlockType; properties?: Record<string, unknown> } {
  if (b.type === 'to_do') return { type: 'to_do', properties: { checked: [['No']] } };
  if (LIST_TYPES.has(b.type)) return { type: b.type };
  return { type: 'text' };
}

function isNestedInList(b: BlockRecord): boolean {
  if (b.parent_table !== 'block') return false;
  const parent = getBlock(b.parent_id);
  return !!parent && !PAGE_LIKE.has(parent.type) && parent.type !== 'column' && parent.type !== 'column_list' && parent.parent_table === 'block' && LIST_TYPES.has(parent.type);
}

/** Enter at (start, end) inside block `blockId` (selection is replaced). */
export function splitBlock(blockId: string, start: number, end: number) {
  const b = getBlock(blockId);
  if (!b) return;
  const title = titleOf(blockId);
  const len = length(title);
  const empty = len === 0;

  // empty list item / quote / callout: nested → outdent, otherwise → plain text (kb-bullets)
  if (empty && (DECORATED.has(b.type) || (HEADING_TYPES.has(b.type) && b.format?.toggleable))) {
    if (LIST_TYPES.has(b.type) && isNestedInList(b)) {
      run('Text.handleUntab', (tx) => outdentIn(tx, blockId), { selectionBefore: sel(blockId, 0), selectionAfter: sel(blockId, 0) });
      useEditor.getState().requestFocus(blockId, 0);
      return;
    }
    run('Text.handleEnter', (tx) => {
      tx.update('block', blockId, [], { type: 'text' });
      if (b.format?.toggleable || b.format?.page_icon) tx.update('block', blockId, ['format'], { toggleable: undefined });
      touch(tx, blockId);
    }, { selectionBefore: sel(blockId, 0), selectionAfter: sel(blockId, 0) });
    useEditor.getState().requestFocus(blockId, 0);
    return;
  }

  const newBlockId = newId();
  const next = nextTypeFor(b);

  // caret at the very start of a non-empty block → empty block above, caret stays (block keeps its id)
  if (start === 0 && end === 0 && !empty) {
    run('Text.handleEnter', (tx) => {
      createBlockIn(tx, { id: newBlockId, type: next.type, properties: next.properties, parentId: b.parent_id, parentTable: b.parent_table as any, before: blockId });
    }, { selectionBefore: sel(blockId, 0), selectionAfter: sel(blockId, 0) });
    useEditor.getState().requestFocus(blockId, 0);
    return;
  }

  const [before, afterRaw] = splitAt(title, start);
  const after = slice(afterRaw, end - start);
  const open = isToggleBlock(b) && isOpen(blockId);
  const hasKids = (b.content?.length ?? 0) > 0;
  let where: 'child' | 'sibling' = 'sibling';
  let type = next.type;
  let props = next.properties;
  if (isToggleBlock(b)) {
    // open toggle (list or heading) → first child text; closed → sibling (toggle list keeps its type)
    if (open) { where = 'child'; type = 'text'; props = undefined; }
  } else if (b.type === 'callout') {
    where = 'child';
  } else if (b.type === 'quote') {
    where = 'sibling';
  } else if (hasKids && !HEADING_TYPES.has(b.type)) {
    // a block with nested children: the new block appears directly below = first child
    where = 'child';
  }
  run('Text.handleEnter', (tx) => {
    setTitle(tx, blockId, before);
    if (where === 'child') {
      createBlockIn(tx, { id: newBlockId, type, properties: props, parentId: blockId, parentTable: 'block', first: true, title: after });
    } else {
      createBlockIn(tx, { id: newBlockId, type, properties: props, parentId: b.parent_id, parentTable: b.parent_table as any, after: blockId, title: after });
    }
  }, { selectionBefore: sel(blockId, start), selectionAfter: sel(newBlockId, 0) });
  useEditor.getState().requestFocus(newBlockId, 0);
}

const OPEN_KEY = 'nc:toggle:';
export function isOpen(blockId: string): boolean {
  try {
    return localStorage.getItem(OPEN_KEY + blockId) === '1';
  } catch {
    return false;
  }
}
export function setOpen(blockId: string, open: boolean) {
  try {
    if (open) localStorage.setItem(OPEN_KEY + blockId, '1');
    else localStorage.removeItem(OPEN_KEY + blockId);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('nc:toggle', { detail: { blockId, open } }));
}

/** ⌘⌥T: open every toggle of the page, or close them all when all are open. */
export function toggleAllToggles(pageId: string) {
  const ids: string[] = [];
  const walk = (id: string) => {
    const b = getBlock(id);
    if (!b || b.alive === false) return;
    if (id !== pageId && isToggleBlock(b)) ids.push(id);
    if (id === pageId || !PAGE_LIKE.has(b.type)) for (const c of b.content ?? []) walk(c);
  };
  walk(pageId);
  const anyClosed = ids.some((id) => !isOpen(id));
  for (const id of ids) setOpen(id, anyClosed);
}

/** Previous/next editable leaf in document order (for merges and arrow navigation). */
export function neighborLeaf(blockId: string, dir: -1 | 1, property = 'title'): HTMLElement | null {
  const leaves = leavesInOrder();
  const i = leaves.findIndex((l) => l.dataset.blockId === blockId && (l.dataset.property ?? 'title') === property);
  if (i < 0) return null;
  return leaves[i + dir] ?? null;
}

/** Block rendered right before `blockId` in document order (any type), for Backspace onto non-text blocks. */
function previousRenderedBlock(blockId: string): string | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>('.lit-page-content .lit-selectable[data-block-id]'));
  const i = els.findIndex((el) => el.dataset.blockId === blockId);
  for (let j = i - 1; j >= 0; j--) {
    const el = els[j];
    if (el.contains(els[i])) continue; // ancestors
    const t = getBlock(el.dataset.blockId)?.type;
    if (t === 'column' || t === 'column_list') continue;
    return el.dataset.blockId ?? null;
  }
  return null;
}

/** Backspace at offset 0 with a collapsed caret. */
export function backspaceAtStart(blockId: string) {
  const b = getBlock(blockId);
  if (!b) return;
  // decorated blocks (lists, to-do, toggle, quote, callout, toggle headings) first revert to text
  if (DECORATED.has(b.type) || (HEADING_TYPES.has(b.type) && b.format?.toggleable)) {
    run('textBackspaceActions.annotatedContentBlockBackspaceAtBeginning', (tx) => {
      tx.update('block', blockId, [], { type: 'text' });
      if (b.format?.toggleable) tx.update('block', blockId, ['format'], { toggleable: undefined });
      touch(tx, blockId);
    }, { selectionBefore: sel(blockId, 0), selectionAfter: sel(blockId, 0) });
    useEditor.getState().requestFocus(blockId, 0);
    return;
  }
  // nested text block without a previous sibling → outdent first
  const parent = b.parent_table === 'block' ? getBlock(b.parent_id) : undefined;
  if (b.type === 'text' && parent && parent.parent_table === 'block' && !PAGE_LIKE.has(parent.type) && parent.type !== 'column' && parent.type !== 'column_list' && previousSibling(b) === undefined) {
    run('Text.handleUntab', (tx) => outdentIn(tx, blockId), { selectionBefore: sel(blockId, 0), selectionAfter: sel(blockId, 0) });
    useEditor.getState().requestFocus(blockId, 0);
    return;
  }
  const prevLeaf = neighborLeaf(blockId, -1);
  const prevBlockId = previousRenderedBlock(blockId);
  // previous block is a non-text block (divider, image, database…): an empty block is removed and the previous block
  // gets selected; otherwise the previous block is selected
  if (prevBlockId && (!prevLeaf || prevLeaf.dataset.blockId !== prevBlockId) && prevBlockId !== pageIdOfBlock(blockId)) {
    const pb = getBlock(prevBlockId);
    if (pb && !TEXT_BLOCKS.has(pb.type) && !(prevLeaf && prevLeaf.closest(`[data-block-id="${prevBlockId}"]`))) {
      if (length(titleOf(blockId)) === 0 && !(b.content?.length)) run('textBackspaceActions.deleteEmptyBlock', (tx) => deleteBlocksIn(tx, [blockId]));
      useEditor.getState().selectBlocks([prevBlockId], prevBlockId);
      return;
    }
  }
  const prevId = prevLeaf?.dataset.blockId;
  const prevProp = prevLeaf?.dataset.property ?? 'title';
  if (!prevLeaf || !prevId || prevProp !== 'title') return;
  const prev = getBlock(prevId);
  if (!prev) return;
  if (PAGE_LIKE.has(prev.type) && prev.id === pageIdOfBlock(blockId)) {
    // merging into the page title
    const t = titleOf(blockId);
    const prevLen = length(titleOf(prevId));
    run('textBackspaceActions.mergeIntoTitle', (tx) => {
      setTitle(tx, prevId, concat(titleOf(prevId), t));
      const kids = b.content ?? [];
      if (kids.length) moveBlocksIn(tx, kids, { parentId: b.parent_id, parentTable: b.parent_table as any, after: blockId });
      deleteBlocksIn(tx, [blockId]);
    }, { selectionBefore: sel(blockId, 0), selectionAfter: sel(prevId, prevLen) });
    useEditor.getState().requestFocus(prevId, prevLen);
    return;
  }
  if (!TEXT_BLOCKS.has(prev.type) || prev.type === 'code') {
    if (length(titleOf(blockId)) === 0 && !(b.content?.length)) {
      run('textBackspaceActions.deleteEmptyBlock', (tx) => deleteBlocksIn(tx, [blockId]));
    }
    useEditor.getState().requestFocus(prevId, 'end');
    return;
  }
  const prevLen = length(titleOf(prevId));
  run('textBackspaceActions.textBackspaceWithinContent', (tx) => {
    setTitle(tx, prevId, concat(titleOf(prevId), titleOf(blockId)));
    // children of the merged block move to follow the previous block's own children
    const kids = b.content ?? [];
    if (kids.length) {
      if (canHaveChildren(prev.type, prev.format?.toggleable)) {
        const prevKids = getBlock(prevId)?.content ?? [];
        moveBlocksIn(tx, kids, { parentId: prevId, parentTable: 'block', after: prevKids[prevKids.length - 1] });
      } else {
        moveBlocksIn(tx, kids, { parentId: b.parent_id, parentTable: b.parent_table as any, after: blockId });
      }
    }
    deleteBlocksIn(tx, [blockId]);
  }, { selectionBefore: sel(blockId, 0), selectionAfter: sel(prevId, prevLen) });
  useEditor.getState().requestFocus(prevId, prevLen);
}

/** Delete at the end of the text: pull the next block's text in. */
export function deleteAtEnd(blockId: string) {
  const nextLeaf = neighborLeaf(blockId, 1);
  const nextId = nextLeaf?.dataset.blockId;
  if (!nextId || (nextLeaf?.dataset.property ?? 'title') !== 'title') return;
  const next = getBlock(nextId);
  if (!next || !TEXT_BLOCKS.has(next.type) || next.type === 'code') return;
  const len = length(titleOf(blockId));
  run('Text.handleDelete', (tx) => {
    setTitle(tx, blockId, concat(titleOf(blockId), titleOf(nextId)));
    const kids = next.content ?? [];
    if (kids.length) moveBlocksIn(tx, kids, { parentId: next.parent_id, parentTable: next.parent_table as any, after: nextId });
    deleteBlocksIn(tx, [nextId]);
  }, { selectionBefore: sel(blockId, len), selectionAfter: sel(blockId, len) });
  useEditor.getState().requestFocus(blockId, len);
}

export function indent(blockId: string, offset: number) {
  let moved = false;
  run('Text.handleTab', (tx) => {
    moved = indentIn(tx, blockId);
  }, { selectionBefore: sel(blockId, offset), selectionAfter: sel(blockId, offset) });
  const parent = getBlock(getBlock(blockId)?.parent_id);
  if (moved && parent && isToggleBlock(parent)) setOpen(parent.id, true);
  useEditor.getState().requestFocus(blockId, offset);
}

export function outdent(blockId: string, offset: number) {
  run('Text.handleUntab', (tx) => {
    outdentIn(tx, blockId);
  }, { selectionBefore: sel(blockId, offset), selectionAfter: sel(blockId, offset) });
  useEditor.getState().requestFocus(blockId, offset);
}

export function turnInto(blockId: string, type: BlockType, format?: Record<string, unknown>, focus = true) {
  const b = getBlock(blockId);
  if (!b) return;
  // sticky per-device defaults (prefs.ts): Quote size, code language / wrap
  const sticky = type !== b.type && (type === 'quote' || type === 'code') ? stickyFormat(type) : {};
  run('turnInto', (tx) => {
    tx.update('block', blockId, [], { type });
    if (format) tx.update('block', blockId, ['format'], format);
    else if (sticky.format) tx.update('block', blockId, ['format'], sticky.format);
    if (type === 'to_do' && !b.properties?.checked) tx.set('block', blockId, ['properties', 'checked'], [['No']]);
    if (type === 'code' && !b.properties?.language) tx.set('block', blockId, ['properties', 'language'], sticky.properties?.language ?? [['JavaScript']]);
    if (HEADING_TYPES.has(b.type) && !HEADING_TYPES.has(type) && b.format?.toggleable && !format) tx.update('block', blockId, ['format'], { toggleable: undefined });
    touch(tx, blockId);
  });
  if (focus && TEXT_BLOCKS.has(type)) useEditor.getState().requestFocus(blockId, 'end');
}

/** Insert a new block after `afterId` (same parent) and focus it. */
export function insertAfter(afterId: string, type: BlockType = 'text', opts?: { title?: RichText; format?: any; properties?: any; focus?: boolean; extra?: any }): string {
  const after = getBlock(afterId);
  const id = newId();
  if (!after) return id;
  run('insertBlock', (tx) => {
    createBlockIn(tx, {
      id, type, parentId: after.parent_id, parentTable: after.parent_table as any, after: afterId,
      title: opts?.title, format: opts?.format, properties: opts?.properties, extra: opts?.extra,
    });
  });
  if (opts?.focus !== false && TEXT_BLOCKS.has(type)) useEditor.getState().requestFocus(id, 'end');
  return id;
}

/** Append a text block at the end of a page (click below content). */
export function appendToPage(pageId: string): string {
  const page = getBlock(pageId);
  const last = page?.content?.[page.content.length - 1];
  const lastBlock = getBlock(last);
  if (lastBlock && lastBlock.type === 'text' && length(titleOf(last!)) === 0 && (lastBlock.content?.length ?? 0) === 0) {
    useEditor.getState().requestFocus(last!, 0);
    return last!;
  }
  const id = newId();
  run('appendBlock', (tx) => {
    createBlockIn(tx, { id, type: 'text', parentId: pageId, parentTable: 'block', after: last });
  });
  useEditor.getState().requestFocus(id, 0);
  return id;
}

export function deleteBlocks(ids: string[]) {
  if (!ids.length) return;
  const first = getBlock(ids[0]);
  const prevLeaf = first ? neighborLeaf(ids[0], -1) : null;
  run('selectableBlockActions.removeBlocksWithMaybeConfirmation', (tx) => deleteBlocksIn(tx, ids));
  useEditor.getState().clearBlockSelection();
  if (prevLeaf?.dataset.blockId && !ids.includes(prevLeaf.dataset.blockId)) useEditor.getState().requestFocus(prevLeaf.dataset.blockId, 'end', { property: prevLeaf.dataset.property ?? 'title' });
}

export function duplicateBlocks(ids: string[]): string[] {
  const out: string[] = [];
  run('duplicateBlocks', (tx) => {
    let after = ids[ids.length - 1];
    for (const id of ids) {
      const nid = cloneTree(tx, id, null, after);
      if (nid) {
        out.push(nid);
        after = nid;
      }
    }
  });
  return out;
}

/** Per-type duplication hooks: database blocks write related records in the same transaction and return fields of the copy to replace. */
export const cloneHooks = new Map<string, (tx: any, source: BlockRecord, newId: string) => Record<string, unknown>>();

function cloneTree(tx: any, id: string, parentId: string | null, after?: string): string | null {
  const b = getBlock(id);
  if (!b) return null;
  const nid = newId();
  const { version: _v, content, ...rest } = b;
  const value: any = { ...rest, id: nid, created_time: Date.now(), last_edited_time: Date.now(), copied_from: id };
  delete value.discussions;
  const hook = cloneHooks.get(b.type);
  if (hook) Object.assign(value, hook(tx, b, nid));
  if (parentId) value.parent_id = parentId;
  tx.set('block', nid, [], { ...value, content: [] });
  if (!parentId) {
    if (b.parent_table === 'block') tx.listAfter('block', b.parent_id, ['content'], nid, after);
  }
  for (const c of content ?? []) {
    const cid = cloneTree(tx, c, nid);
    if (cid) tx.listAfter('block', nid, ['content'], cid);
  }
  return nid;
}

/** ⌘⇧↑ / ⌘⇧↓: move blocks among their siblings; first or last of a nested list moves out or in. */
export function moveBlockUpDown(blockId: string, dir: -1 | 1, ids: string[] = [blockId]) {
  const b = getBlock(ids[0]);
  if (!b || b.parent_table !== 'block') return;
  const sibs = siblingsOf(b);
  const first = sibs.indexOf(ids[0]);
  const last = sibs.indexOf(ids[ids.length - 1]);
  if (first < 0 || last < 0) return;
  run('moveBlock', (tx) => {
    if (dir < 0) {
      if (first > 0) moveBlocksIn(tx, ids, { parentId: b.parent_id, parentTable: 'block', before: sibs[first - 1] });
      else {
        const parent = getBlock(b.parent_id);
        if (parent && parent.parent_table === 'block' && !PAGE_LIKE.has(parent.type)) moveBlocksIn(tx, ids, { parentId: parent.parent_id, parentTable: 'block', before: parent.id });
      }
    } else if (last < sibs.length - 1) {
      moveBlocksIn(tx, ids, { parentId: b.parent_id, parentTable: 'block', after: sibs[last + 1] });
    } else {
      const parent = getBlock(b.parent_id);
      if (parent && parent.parent_table === 'block' && !PAGE_LIKE.has(parent.type)) moveBlocksIn(tx, ids, { parentId: parent.parent_id, parentTable: 'block', after: parent.id });
    }
  });
}

export function pageIdOfBlock(blockId: string): string | undefined {
  let cur = getBlock(blockId);
  for (let i = 0; i < 60 && cur; i++) {
    if (PAGE_LIKE.has(cur.type) || cur.parent_table !== 'block') return cur.id;
    cur = getBlock(cur.parent_id);
  }
  return cur?.id;
}

export { records };
