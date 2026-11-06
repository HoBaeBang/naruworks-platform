// “Turn into” catalog shared by the text action menu
// and the block action menu (same list + "Synced block").
import type { BlockType } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { TEXT_BLOCKS } from '@nc/shared/blocks.ts';
import { createBlockIn, getBlock, moveBlocksIn, run, touch } from '../../../lib/blocks.ts';
import { setOpen, turnInto } from '../commands.ts';
import { useEditor } from '../editorState.ts';
import { openPagePicker } from './PagePicker.tsx';
import { turnIntoOverride } from '../blocks/registry.ts';

export interface TurnIntoItem {
  label: string;
  icon: string;
  type: BlockType;
  format?: Record<string, unknown>;
  columns?: number;
  /** "Page in ›": asks for the destination page first */
  pickParent?: boolean;
  apply: (ids: string[], anchor?: DOMRect) => void;
}

const simple = (label: string, icon: string, type: BlockType, format?: Record<string, unknown>): TurnIntoItem => ({
  label, icon, type, format,
  apply: (ids) => {
    // block modules may implement a target differently (callout v2 nests the text, synced block wraps …)
    const custom = turnIntoOverride(type, format);
    if (custom) {
      custom(ids);
      return;
    }
    for (const id of ids) {
      const b = getBlock(id);
      const fmt = format ?? (b?.format?.toggleable ? { toggleable: undefined } : undefined);
      turnInto(id, type, fmt, ids.length === 1);
      if (type === 'toggle' || format?.toggleable) setOpen(id, true);
    }
  },
});

/** Turn a block into a sub-page in place (⌘⌥9, Turn into › Page): title and children move with it. */
export function convertToPage(id: string) {
  const b = getBlock(id);
  if (!b) return;
  run('turnIntoPage', (tx) => {
    tx.update('block', id, [], { type: 'page' });
    if (b.format?.block_color || b.format?.toggleable) tx.update('block', id, ['format'], { block_color: undefined, toggleable: undefined });
    touch(tx, id);
  });
}

/** Turn into N columns. Several selected blocks become one column each; blocks beyond the N-th go into the last column, and columns without a block get an empty text block. */
function convertToColumns(ids: string[], n: number) {
  const b = getBlock(ids[0]);
  if (!b || b.parent_table !== 'block') return;
  const sameParent = ids.filter((x) => getBlock(x)?.parent_id === b.parent_id);
  const listId = newId();
  const cols = Array.from({ length: n }, () => newId());
  run('turnIntoColumns', (tx) => {
    createBlockIn(tx, { id: listId, type: 'column_list', parentId: b.parent_id, parentTable: 'block', after: sameParent[sameParent.length - 1] });
    cols.forEach((cid, i) => {
      createBlockIn(tx, { id: cid, type: 'column', parentId: listId, parentTable: 'block', format: { column_ratio: 1 / n } });
      const mine = i < n - 1 ? sameParent.slice(i, i + 1) : sameParent.slice(i);
      if (mine.length) moveBlocksIn(tx, mine, { parentId: cid, parentTable: 'block' });
      else createBlockIn(tx, { type: 'text', parentId: cid, parentTable: 'block' });
    });
  });
  if (TEXT_BLOCKS.has(b.type)) useEditor.getState().requestFocus(ids[0], 'end');
}

export function turnIntoItems(opts?: { includeSynced?: boolean }): TurnIntoItem[] {
  const items: TurnIntoItem[] = [
    simple('Text', 'textNormal', 'text'),
    simple('Heading 1', 'textH1', 'header'),
    simple('Heading 2', 'textH2', 'sub_header'),
    simple('Heading 3', 'textH3', 'sub_sub_header'),
    simple('Heading 4', 'textH4', 'header_4'),
    { label: 'Page', icon: 'page', type: 'page', apply: (ids) => ids.forEach(convertToPage) },
    {
      label: 'Page in', icon: 'docSend', type: 'page', pickParent: true,
      apply: (ids, anchor) => openPagePicker(anchor ?? new DOMRect(window.innerWidth / 2 - 160, 120, 0, 0), {
        placeholder: 'Turn into page in…',
        exclude: ids,
        onPick: (parentId) => {
          for (const id of ids) convertToPage(id);
          run('turnIntoPageIn', (tx) => {
            const p = getBlock(parentId);
            moveBlocksIn(tx, ids, { parentId, parentTable: 'block', after: p?.content?.[p.content.length - 1] });
          });
        },
      }),
    },
    simple('Bulleted list', 'listBullet', 'bulleted_list'),
    simple('Numbered list', 'listNumber', 'numbered_list'),
    simple('Task list', 'checklist', 'to_do'),
    simple('Toggle list', 'listToggle', 'toggle'),
    simple('Code', 'code', 'code'),
    simple('Quote', 'quote', 'quote'),
    simple('Callout', 'calloutBlock', 'callout', { page_icon: '💡', block_color: 'gray_background' }),
    simple('Block equation', 'sumSquare', 'equation'),
    ...(opts?.includeSynced ? [simple('Synced block', 'blockSync', 'transclusion_container')] : []),
    simple('Toggle heading 1', 'textH1Toggle', 'header', { toggleable: true }),
    simple('Toggle heading 2', 'textH2Toggle', 'sub_header', { toggleable: true }),
    simple('Toggle heading 3', 'textH3Toggle', 'sub_sub_header', { toggleable: true }),
    simple('Toggle heading 4', 'textH4Toggle', 'header_4', { toggleable: true }),
    ...[2, 3, 4, 5].map((n): TurnIntoItem => ({ label: `${n} columns`, icon: `rectangleSplit${n}`, type: 'column_list', columns: n, apply: (ids) => convertToColumns(ids, n) })),
  ];
  return items;
}

/** Label of the current block type in the text action menu's first row ("Normal Text" for text). */
export function blockTypeLabel(type: BlockType, toggleable: boolean): string {
  if (type === 'text') return 'Normal Text';
  const it = turnIntoItems().find((x) => x.type === type && !!x.format?.toggleable === toggleable && !x.columns && !x.pickParent);
  return it?.label ?? 'Turn into';
}
