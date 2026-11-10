// Insert AI output (Markdown) into pages as real blocks — always through transactions so it syncs,
// is permission-checked by the server and can be undone with ⌘Z in one step.
import { newId } from '@nc/shared/ids.ts';
import type { ParentTable } from '@nc/shared/records.ts';
import { concat, length, slice, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import { createBlockIn, deleteBlocksIn, getBlock, run, setTitle } from '../../lib/blocks.ts';
import type { Tx } from '../../lib/store/transactions.ts';
import { markdownToPlan, type PlannedBlock } from './mdBlocks.ts';
import type { SourceRef } from './aiApi.ts';

export { markdownToPlan, inlineToRichText, codeLanguage, type PlannedBlock } from './mdBlocks.ts';

function createPlanned(tx: Tx, blocks: PlannedBlock[], parentId: string, parentTable: ParentTable, after?: string): string[] {
  const ids: string[] = [];
  let prev = after;
  for (const b of blocks) {
    const id = newId();
    createBlockIn(tx, { id, type: b.type, parentId, parentTable, after: prev, title: b.title, properties: b.properties, format: b.format as any });
    if (b.children?.length) createPlanned(tx, b.children, id, 'block');
    ids.push(id);
    prev = id;
  }
  return ids;
}

/** Create planned blocks as the children of `parentId` (appended). */
export function createPlannedInto(tx: Tx, blocks: PlannedBlock[], parentId: string): string[] {
  const parent = getBlock(parentId);
  return createPlanned(tx, blocks, parentId, 'block', parent?.content?.[parent.content.length - 1]);
}


/** Insert Markdown as blocks after `afterId` (same parent). Returns the new block ids. */
export function insertMarkdownAfter(afterId: string, md: string, opts?: { sources?: SourceRef[]; action?: string }): string[] {
  const after = getBlock(afterId);
  if (!after) return [];
  let ids: string[] = [];
  run(opts?.action ?? 'ai.insertBelow', (tx) => {
    ids = createPlanned(tx, markdownToPlan(md, opts?.sources), after.parent_id, after.parent_table as ParentTable, afterId);
  });
  return ids;
}

/** Append Markdown at the end of a page (or any block container). */
export function appendMarkdown(parentId: string, md: string, opts?: { sources?: SourceRef[]; action?: string }): string[] {
  const parent = getBlock(parentId);
  if (!parent) return [];
  const last = parent.content?.[parent.content.length - 1];
  let ids: string[] = [];
  run(opts?.action ?? 'ai.appendToPage', (tx) => {
    ids = createPlanned(tx, markdownToPlan(md, opts?.sources), parentId, 'block', last);
  });
  return ids;
}

/** Replace a block (e.g. the empty line AI was started from) with the generated blocks. */
export function replaceBlockWithMarkdown(blockId: string, md: string, opts?: { sources?: SourceRef[]; keepIfEmpty?: boolean }): string[] {
  const b = getBlock(blockId);
  if (!b) return [];
  const plan = markdownToPlan(md, opts?.sources);
  if (!plan.length) return [];
  let ids: string[] = [];
  run('ai.accept', (tx) => {
    // reuse the block itself for the first planned block when both are text-like (keeps focus/position)
    const [first, ...rest] = plan;
    if (first.type !== 'table' && !first.children?.length && b.type === 'text' && !(b.content?.length)) {
      tx.update('block', blockId, [], { type: first.type });
      if (first.format) tx.update('block', blockId, ['format'], first.format);
      if (first.properties) for (const [k, v] of Object.entries(first.properties)) tx.set('block', blockId, ['properties', k], v);
      setTitle(tx, blockId, first.title ?? []);
      ids = [blockId, ...createPlanned(tx, rest, b.parent_id, b.parent_table as ParentTable, blockId)];
    } else {
      ids = createPlanned(tx, plan, b.parent_id, b.parent_table as ParentTable, blockId);
      if (!opts?.keepIfEmpty) deleteBlocksIn(tx, [blockId]);
    }
  });
  return ids;
}

/**
 * Replace characters [start, end) of a text block with AI output. A single-paragraph result is
 * spliced inline (keeping the text around the selection); a multi-block result replaces the selected
 * text with its first paragraph and inserts the remaining blocks after the block.
 */
export function replaceSelection(blockId: string, start: number, end: number, md: string, property = 'title'): string[] {
  const b = getBlock(blockId);
  if (!b) return [];
  const plan = markdownToPlan(md);
  if (!plan.length) return [];
  if (property !== 'title') {
    // captions / table cells: splice the text inline (one rich-text run, paragraphs joined by line breaks)
    const value = (b.properties?.[property] as RichText | undefined) ?? [];
    const flat: RichText = [];
    plan.forEach((pb, i) => {
      if (i) flat.push(['\n']);
      flat.push(...(pb.title ?? []));
    });
    run('ai.replaceSelection', (tx) => {
      tx.set('block', blockId, ['properties', property], concat(slice(value, 0, start), flat, slice(value, end)));
    });
    return [blockId];
  }
  const title = (b.properties?.title as RichText | undefined) ?? [];
  const wholeBlock = start <= 0 && end >= length(title);
  let ids: string[] = [blockId];
  run('ai.replaceSelection', (tx) => {
    const [first, ...rest] = plan;
    const inlineFirst = first.type === 'text' || first.type === b.type || (wholeBlock && first.type !== 'table' && first.type !== 'divider');
    if (inlineFirst) {
      const next = concat(slice(title, 0, start), first.title ?? [], slice(title, end));
      if (wholeBlock && first.type !== b.type && first.type !== 'text') {
        tx.update('block', blockId, [], { type: first.type });
        if (first.properties) for (const [k, v] of Object.entries(first.properties)) tx.set('block', blockId, ['properties', k], v);
      }
      setTitle(tx, blockId, next);
      if (first.children?.length) createPlanned(tx, first.children, blockId, 'block', b.content?.[b.content.length - 1]);
      ids = [blockId, ...createPlanned(tx, rest, b.parent_id, b.parent_table as ParentTable, blockId)];
    } else {
      setTitle(tx, blockId, concat(slice(title, 0, start), slice(title, end)));
      ids = [blockId, ...createPlanned(tx, plan, b.parent_id, b.parent_table as ParentTable, blockId)];
      if (wholeBlock && !(b.content?.length)) {
        deleteBlocksIn(tx, [blockId]);
        ids = ids.slice(1);
      }
    }
  });
  return ids;
}

/** Replace whole blocks (block-menu "Ask AI" on selected blocks) with the AI output. */
export function replaceBlocks(blockIds: string[], md: string): string[] {
  const first = getBlock(blockIds[0]);
  if (!first) return [];
  const plan = markdownToPlan(md);
  if (!plan.length) return [];
  let ids: string[] = [];
  run('ai.replaceBlocks', (tx) => {
    ids = createPlanned(tx, plan, first.parent_id, first.parent_table as ParentTable, blockIds[blockIds.length - 1]);
    deleteBlocksIn(tx, blockIds);
  });
  return ids;
}

/** Replace the children of a container block (AI block regeneration) in one undoable transaction. */
export function setChildrenFromMarkdown(parentId: string, md: string, extraFormat?: Record<string, unknown>): string[] {
  const parent = getBlock(parentId);
  if (!parent) return [];
  let ids: string[] = [];
  run('aiBlock.generate', (tx) => {
    const old = (parent.content ?? []).filter((id) => getBlock(id));
    if (old.length) deleteBlocksIn(tx, old);
    ids = createPlanned(tx, markdownToPlan(md), parentId, 'block');
    if (extraFormat) tx.update('block', parentId, ['format'], extraFormat);
  });
  return ids;
}

/** Plain text → Markdown-safe text (used when selection text is sent back as context). */
export function richTextToMarkdown(rt: RichText | undefined): string {
  if (!rt) return '';
  return rt
    .map((d) => {
      let s = d[0];
      const anns = (d[1] ?? []) as Annotation[];
      if (anns.some((a) => a[0] === 'p' || a[0] === 'u' || a[0] === 'd' || a[0] === 'e')) return s === '‣' ? '' : s;
      if (anns.some((a) => a[0] === 'c')) s = `\`${s}\``;
      if (anns.some((a) => a[0] === 'b')) s = `**${s}**`;
      if (anns.some((a) => a[0] === 'i')) s = `*${s}*`;
      if (anns.some((a) => a[0] === 's')) s = `~~${s}~~`;
      const link = anns.find((a) => a[0] === 'a');
      if (link) s = `[${s}](${link[1]})`;
      return s;
    })
    .join('');
}
