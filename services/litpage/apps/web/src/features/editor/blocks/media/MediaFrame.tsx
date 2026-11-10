// Shared frame for image / video / embed / pdf blocks: alignment (format.block_alignment), width
// (format.block_width, or full content width), left/right resize pills (+ bottom pill for height-resizable
// embeds), hover action bar, and caption.
import { useRef, type ReactNode } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { openMenu } from '../../../../components/Menu.tsx';
import { run, setFormat } from '../../../../lib/blocks.ts';
import { ActionBar, ActionButton, Caption, ResizeHandles, useResize } from '../shared.tsx';

export type Align = 'left' | 'center' | 'right';

export function alignOf(b: BlockRecord): Align {
  const a = b.format?.block_alignment as Align | undefined;
  return a ?? 'center';
}

export function setAlign(blockId: string, a: Align) {
  run('setBlockAlignment', (tx) => setFormat(tx, blockId, { block_alignment: a }));
}

export function AlignButton({ block }: { block: BlockRecord }) {
  const a = alignOf(block);
  const icon = a === 'left' ? 'alignmentLeft' : a === 'right' ? 'alignmentRight' : 'alignmentCenter';
  return (
    <ActionButton
      icon={icon}
      tooltip="Alignment"
      label="Align block"
      onClick={(e) => openMenu(e.currentTarget, {
        width: 180,
        sections: [{
          items: (['left', 'center', 'right'] as const).map((x) => ({
            label: x === 'left' ? 'Left' : x === 'center' ? 'Center' : 'Right',
            icon: x === 'left' ? 'alignmentLeft' : x === 'center' ? 'alignmentCenter' : 'alignmentRight',
            checked: a === x,
            onSelect: () => setAlign(block.id, x),
          })),
        }],
      })}
    />
  );
}

export interface LiveSize {
  w?: number;
  h?: number;
}

export function MediaFrame({ block, readOnly, children, bar, heightResizable, aspect, defaultWidth, minWidth, className }: {
  block: BlockRecord;
  readOnly: boolean;
  children: (live: LiveSize | null) => ReactNode;
  bar?: ReactNode;
  heightResizable?: boolean;
  aspect?: number | null;
  /** width when format.block_width is unset ('100%' by default) */
  defaultWidth?: number | string;
  minWidth?: number;
  className?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const align = alignOf(block);
  const { live, start } = useResize({ blockId: block.id, frame, align, aspect, minWidth: minWidth ?? 80, minHeight: 80 });
  const fullWidth = !!block.format?.block_page_width || !!block.format?.block_full_width;
  const w = live?.w ?? (fullWidth ? undefined : (block.format?.block_width as number | undefined));
  const width = w != null ? `${w}px` : defaultWidth ?? '100%';
  return (
    <div className={`nc-bpad ${live ? 'nc-resizing' : ''}`}>
      <div className="nc-media-align" style={{ justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}>
        <div ref={frame} className={`nc-media-frame nc-blk-hoverable ${className ?? ''}`} style={{ width, maxWidth: '100%' }}>
          {children(live)}
          {!readOnly && <ResizeHandles onStart={start} height={heightResizable} />}
          {!readOnly && bar && <ActionBar>{bar}</ActionBar>}
        </div>
      </div>
      <Caption block={block} readOnly={readOnly} />
    </div>
  );
}
