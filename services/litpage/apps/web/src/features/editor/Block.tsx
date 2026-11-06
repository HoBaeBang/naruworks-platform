// Block rendering: dispatch by type and apply the lit-selectable wrapper class (lit-selectable.<type>-block),
// spacing, selection halo and children lists. New block types register in blockRegistry.
import { memo, useMemo, type ComponentType, type ReactNode } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { useBlock, useRecords } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useEditor } from './editorState.ts';
import { spacingFor } from './spacing.ts';
import { SELF_COLORED_BLOCKS } from './blocks/registry.ts';

export interface BlockProps {
  block: BlockRecord;
  depth: number;
  readOnly: boolean;
  /** index among siblings for numbered lists */
  index: number;
  siblings: string[];
}

export const blockRegistry: Partial<Record<string, ComponentType<BlockProps>>> = {};

export function registerBlock(types: string[], comp: ComponentType<BlockProps>) {
  for (const t of types) blockRegistry[t] = comp;
}

function UnknownBlock({ block }: BlockProps) {
  return <div className="nc-unsupported-block">Unsupported block type: {block.type}</div>;
}

export const Block = memo(function Block({ id, depth, readOnly, index, siblings, prevId, nextId }: { id: string; depth: number; readOnly: boolean; index: number; siblings: string[]; prevId?: string; nextId?: string }) {
  const block = useBlock(id);
  const selected = useEditor((s) => s.selectedBlocks.includes(id));
  if (!block || !block.alive) return null;
  const prev = prevId ? records.get<BlockRecord>('block', prevId) : undefined;
  const next = nextId ? records.get<BlockRecord>('block', nextId) : undefined;
  const parentType = depth > 0 ? records.get<BlockRecord>('block', block.parent_id)?.type : undefined;
  const sp = spacingFor(block, prev, next, index === 0, depth > 0, parentType);
  const Comp = blockRegistry[block.type] ?? UnknownBlock;
  const color = block.format?.block_color as string | undefined;
  // callouts paint their own box; every other block gets the color on its row wrapper
  const colorClass = SELF_COLORED_BLOCKS.has(block.type) ? '' : color && color !== 'default' ? (color.endsWith('_background') ? `lit-bg-${color.replace('_background', '')}` : `lit-color-${color}`) : '';
  return (
    <div
      className={`lit-selectable lit-${block.type}-block ${selected ? 'nc-selected' : ''}`}
      data-block-id={id}
      dir={((block.format as any)?.block_text_direction as string | undefined) || 'auto'}
      style={{ ['--nc-pad-top' as any]: `${sp.top}px`, ['--nc-pad-bottom' as any]: `${sp.bottom}px` }}
    >
      <div className={`nc-block-color ${colorClass}`}>
        <Comp block={block} depth={depth} readOnly={readOnly} index={index} siblings={siblings} />
      </div>
      {selected && <div className="lit-selectable-halo" />}
    </div>
  );
});

/** Ordered children of a block (skips dead/missing records). */
export function BlockList({ parentId, ids, depth, readOnly, className }: { parentId: string; ids: string[] | undefined; depth: number; readOnly: boolean; className?: string }) {
  const kids = useRecords<BlockRecord>('block', ids);
  const alive = useMemo(() => (ids ?? []).filter((_, i) => kids[i]?.alive !== false && kids[i]), [ids, kids]);
  return (
    <div className={`nc-block-list ${className ?? ''}`} data-parent-id={parentId}>
      {alive.map((id, i) => (
        <Block key={id} id={id} depth={depth} readOnly={readOnly} index={i} siblings={alive} prevId={alive[i - 1]} nextId={alive[i + 1]} />
      ))}
    </div>
  );
}

/** Indented children container used by text, list items, toggles, quotes and callouts. */
export function BlockChildren({ block, depth, readOnly, indent = true }: { block: BlockRecord; depth: number; readOnly: boolean; indent?: boolean }): ReactNode {
  if (!block.content?.length) return null;
  return (
    <div className={`nc-block-children ${indent ? 'indent' : ''}`}>
      <BlockList parentId={block.id} ids={block.content} depth={depth + 1} readOnly={readOnly} />
    </div>
  );
}
