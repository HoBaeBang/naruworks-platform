// Table of contents. One anchor per heading, 30px tall
// (padding 6px 2px), texSec with a thin underline under the text, margin-left 0/24/48/72px for H1–H4, hover
// background rgba(67, 20, 7, 0.05), href /p/<page>#<blockId>. Indented headings (inside toggles/lists) are excluded
// (help center); headings inside columns are included. format.block_color tints the entries.
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { HEADING_TYPES } from '@nc/shared/blocks.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { getBlock } from '../../../lib/blocks.ts';
import { pageUrl } from '../../../lib/router.ts';
import { pageIdOfBlock, setOpen } from '../commands.ts';
import { registerBlockMenu } from './registry.ts';
import { blockElement } from './shared.tsx';

const LEVEL: Record<string, number> = { header: 0, sub_header: 1, sub_sub_header: 2, header_4: 3 };

export function collectHeadings(pageId: string | undefined): BlockRecord[] {
  const page = getBlock(pageId);
  const out: BlockRecord[] = [];
  const walk = (ids: string[] | undefined) => {
    for (const id of ids ?? []) {
      const b = records.get<BlockRecord>('block', id);
      if (!b || !b.alive) continue;
      if (HEADING_TYPES.has(b.type)) out.push(b);
      else if (b.type === 'column_list' || b.type === 'column') walk(b.content);
    }
  };
  walk(page?.content);
  return out;
}

export function scrollToBlock(blockId: string) {
  // open collapsed toggle-heading ancestors first
  let cur = getBlock(getBlock(blockId)?.parent_id);
  for (let i = 0; i < 20 && cur && cur.parent_table === 'block'; i++) {
    if (cur.type === 'toggle' || cur.format?.toggleable) setOpen(cur.id, true);
    cur = getBlock(cur.parent_id);
  }
  requestAnimationFrame(() => {
    const el = blockElement(blockId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('nc-flash');
    setTimeout(() => el.classList.remove('nc-flash'), 1200);
  });
}

function TableOfContents({ block }: BlockProps) {
  useTableVersion(['block']);
  const pageId = pageIdOfBlock(block.id);
  const headings = collectHeadings(pageId);
  const color = (block.format?.block_color as string | undefined) ?? 'default';
  const colored = color !== 'default';
  return (
    <div className="nc-bpad">
      <div className={`nc-toc-2 ${colored ? 'colored' : ''}`}>
        {headings.length === 0 && <div className="nc-toc-empty-2">Add headings to create a table of contents.</div>}
        {headings.map((h) => (
          <a
            key={h.id}
            href={`${pageId ? pageUrl(pageId) : ''}#${h.id.replace(/-/g, '')}`}
            className="nc-toc-item-2"
            style={{ marginInlineStart: (LEVEL[h.type] ?? 0) * 24 }}
            onClick={(e) => {
              e.preventDefault();
              scrollToBlock(h.id);
            }}
          >
            <span className="t">{toPlainText(h.properties?.title) || 'Untitled'}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

registerBlock(['table_of_contents'], TableOfContents);
registerBlockMenu(['table_of_contents'], ({ color }) => [color]);
