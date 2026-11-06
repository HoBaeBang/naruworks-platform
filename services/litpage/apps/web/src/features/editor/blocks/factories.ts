// Creation of non-text blocks with the record shapes used by the editor:

// callout v2 = callout{format.callout_version:2, content:[text]}
// synced = transclusion_container{content:[text]}
// tabs = tab{content:[text×3]} (each text block = one tab: title = tab name, children = tab content)
// table = table{format.table_block_column_order:[4-char ids], table_block_column_format:{id:{width}}, content:[table_row×3]}
// html = embed{format.embed_variant:"html_artifact"}
// Slash items that differ generic `place` are overridden through registry.ts.
import type { BlockRecord, BlockType } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { length, type RichText } from '@nc/shared/richtext.ts';
import { TEXT_BLOCKS } from '@nc/shared/blocks.ts';
import { createBlockIn, getBlock, moveBlocksIn, run, setTitle, touch } from '../../../lib/blocks.ts';
import type { Tx } from '../../../lib/store/transactions.ts';
import { useEditor } from '../editorState.ts';
import { setOpen, titleOf } from '../commands.ts';
import type { SlashContext } from '../slashItems.ts';
import { containerWidthOf, requestPlaceholderOpen } from './shared.tsx';
import { stickyFormat } from '../prefs.ts';

/** Four-character column id for a simple table. */
export function columnId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-.:;<=>?@[]^_`{|}~';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Whether the slash block can be replaced in place (empty text-like block). */
function replaceable(ctx: SlashContext, b: BlockRecord | undefined): boolean {
  return !!b && ctx.empty && (b.type === 'text' || TEXT_BLOCKS.has(b.type)) && b.type !== 'code' && length(titleOf(b.id)) === 0 && !(b.content?.length);
}

/** Create a block tree where the slash command was typed, replacing the empty block or inserting after it. */
export function insertTree(ctx: SlashContext, build: (tx: Tx, where: { parentId: string; parentTable: any; after: string }) => string, userAction = 'actionRegistry.createInsertAction'): string {
  const b = getBlock(ctx.blockId);
  if (!b) return '';
  let id = '';
  run(userAction, (tx) => {
    id = build(tx, { parentId: b.parent_id, parentTable: b.parent_table, after: ctx.blockId });
    if (replaceable(ctx, b)) {
      tx.update('block', ctx.blockId, [], { alive: false });
      tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
    }
  });
  return id;
}

/* ---------------------------------------------------------------- callout v2 */

export function createCallout(ctx: SlashContext) {
  const textId = newId();
  insertTree(ctx, (tx, w) => {
    const id = newId();
    // sticky per-device icon/color (prefs.ts: calloutBlockIcon / calloutBlockBackground, default 💡 + gray_background)
    createBlockIn(tx, { id, type: 'callout', parentId: w.parentId, parentTable: w.parentTable, after: w.after, format: { callout_version: 2, ...stickyFormat('callout').format }, content: [textId] });
    createBlockIn(tx, { id: textId, type: 'text', parentId: id, parentTable: 'block', list: null });
    return id;
  });
  useEditor.getState().requestFocus(textId, 0);
}

/** Turn existing blocks into one v2 callout each (the block's text moves into the callout's first child). */
export function turnIntoCallout(ids: string[]) {
  let focus = '';
  run('turnInto', (tx) => {
    for (const id of ids) {
      const b = getBlock(id);
      if (!b) continue;
      if (b.type === 'callout') continue;
      const textId = newId();
      const title = (b.properties?.title as RichText | undefined) ?? [];
      createBlockIn(tx, { id: textId, type: 'text', parentId: id, parentTable: 'block', first: true, title });
      const kids = b.content ?? [];
      if (kids.length) moveBlocksIn(tx, kids, { parentId: id, parentTable: 'block', after: textId });
      tx.update('block', id, [], { type: 'callout' });
      const sticky = stickyFormat('callout').format ?? {};
      tx.update('block', id, ['format'], { callout_version: 2, page_icon: (b.format?.page_icon as string | undefined) ?? sticky.page_icon, block_color: (b.format?.block_color as string | undefined) ?? sticky.block_color, toggleable: undefined });
      setTitle(tx, id, []);
      touch(tx, id);
      focus ||= textId;
    }
  });
  if (focus && ids.length === 1) useEditor.getState().requestFocus(focus, 'end');
}

/* ---------------------------------------------------------------- synced block */

export function createSyncedBlock(ctx: SlashContext) {
  const textId = newId();
  insertTree(ctx, (tx, w) => {
    const id = newId();
    createBlockIn(tx, { id, type: 'transclusion_container', parentId: w.parentId, parentTable: w.parentTable, after: w.after, content: [textId] });
    createBlockIn(tx, { id: textId, type: 'text', parentId: id, parentTable: 'block', list: null });
    return id;
  });
  useEditor.getState().requestFocus(textId, 0);
}

/** Wrap blocks into a new synced block ("Turn into → Synced block"). */
export function wrapInSyncedBlock(ids: string[]) {
  const first = getBlock(ids[0]);
  if (!first) return;
  const id = newId();
  run('turnIntoTransclusionContainer', (tx) => {
    createBlockIn(tx, { id, type: 'transclusion_container', parentId: first.parent_id, parentTable: first.parent_table as any, before: ids[0] });
    moveBlocksIn(tx, ids, { parentId: id, parentTable: 'block' });
  });
  useEditor.getState().selectBlocks([id], id);
}

/* ---------------------------------------------------------------- tabs */

export function createTabs(ctx: SlashContext) {
  const tabs = [newId(), newId(), newId()];
  const id = insertTree(ctx, (tx, w) => {
    const tid = newId();
    createBlockIn(tx, { id: tid, type: 'tab', parentId: w.parentId, parentTable: w.parentTable, after: w.after, format: {}, content: tabs });
    for (const t of tabs) createBlockIn(tx, { id: t, type: 'text', parentId: tid, parentTable: 'block', list: null, format: {} });
    return tid;
  });
  if (id) useEditor.getState().selectBlocks([id], id);
}

/* ---------------------------------------------------------------- simple table */

export function createSimpleTable(ctx: SlashContext, opts?: { rows?: number; cols?: number }) {
  const nCols = opts?.cols ?? 3;
  const nRows = opts?.rows ?? 3;
  const cols = Array.from({ length: nCols }, () => columnId());
  const rows = Array.from({ length: nRows }, () => newId());
  // widths fill the column where the table is placed
  const avail = containerWidthOf(ctx.blockId) - 1;
  const width = Math.max(120, avail / nCols);
  insertTree(ctx, (tx, w) => {
    const id = newId();
    createBlockIn(tx, {
      id, type: 'table', parentId: w.parentId, parentTable: w.parentTable, after: w.after, content: rows,
      format: { table_block_column_order: cols, table_block_column_format: Object.fromEntries(cols.map((c) => [c, { width }])) },
    });
    for (const r of rows) createBlockIn(tx, { id: r, type: 'table_row', parentId: id, parentTable: 'block', list: null, format: {} });
    return id;
  });
  useEditor.getState().requestFocus(rows[0], 0, { property: cols[0] });
}

/* ---------------------------------------------------------------- generic */

/** Insert a block of `type` (replacing the empty slash block) and optionally emit the placeholder-open event. */
export function insertBlock(ctx: SlashContext, type: BlockType | string, opts?: { format?: Record<string, unknown>; properties?: Record<string, unknown>; openPicker?: boolean; select?: boolean; textAfter?: boolean }): string {
  const id = insertTree(ctx, (tx, w) => createBlockIn(tx, { type: type as BlockType, parentId: w.parentId, parentTable: w.parentTable, after: w.after, format: opts?.format as any, properties: opts?.properties }));
  if (!id) return id;
  if (opts?.textAfter) {
    const b = getBlock(id);
    const next = b ? (getBlock(b.parent_id)?.content ?? [])[(getBlock(b.parent_id)?.content ?? []).indexOf(id) + 1] : undefined;
    const nextBlock = getBlock(next);
    if (!nextBlock || nextBlock.type !== 'text' || length(titleOf(nextBlock.id)) > 0) {
      const tid = newId();
      run('insertBlock', (tx) => { createBlockIn(tx, { id: tid, type: 'text', parentId: b!.parent_id, parentTable: b!.parent_table as any, after: id }); });
      useEditor.getState().requestFocus(tid, 0);
    } else useEditor.getState().requestFocus(nextBlock.id, 0);
  }
  useEditor.setState({ hoverBlock: null });
  if (opts?.openPicker) requestPlaceholderOpen(id);
  else if (opts?.select) useEditor.getState().selectBlocks([id], id);
  return id;
}

/** Toggle headings 1–3 are created closed; typing continues in the heading. */
export function createToggleHeading(ctx: SlashContext, type: 'header' | 'sub_header' | 'sub_sub_header' | 'header_4') {
  const b = getBlock(ctx.blockId);
  if (!b) return;
  if (ctx.empty && (b.type === 'text' || TEXT_BLOCKS.has(b.type))) {
    run('turnInto', (tx) => {
      tx.update('block', ctx.blockId, [], { type });
      tx.update('block', ctx.blockId, ['format'], { toggleable: true });
      touch(tx, ctx.blockId);
    });
    setOpen(ctx.blockId, false);
    useEditor.getState().requestFocus(ctx.blockId, 'end');
    return;
  }
  const id = newId();
  run('insertBlock', (tx) => {
    createBlockIn(tx, { id, type, parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId, format: { toggleable: true } });
  });
  setOpen(id, false);
  useEditor.getState().requestFocus(id, 0);
}
