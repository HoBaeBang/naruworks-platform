// Vertical block spacing:

// text 6/6 · headings top 30/26/22/18, bottom 6 · nested first child top 2 (synced frame 40px), except directly
// under a toggle list item, where it keeps 6
// list items 1/1, 6 at the edges of a list run, 2 on top as the first child of a list item
// quote 8/8 · divider 0/0 (13px box) · callout/toc/embeds 8/8.
import type { BlockRecord } from '@nc/shared/records.ts';
import { HEADING_TYPES, LIST_TYPES } from '@nc/shared/blocks.ts';

const HEAD_TOP: Record<string, number> = { header: 30, sub_header: 26, sub_sub_header: 22, header_4: 18 };

export function spacingFor(b: BlockRecord, prev: BlockRecord | undefined, next: BlockRecord | undefined, isFirstChild: boolean, isNested: boolean, parentType?: string): { top: number; bottom: number } {
  if (HEADING_TYPES.has(b.type)) {
    const top = isFirstChild && isNested ? 2 : HEAD_TOP[b.type] ?? 6;
    return { top, bottom: 6 };
  }
  if (LIST_TYPES.has(b.type)) {
    const prevList = !!prev && LIST_TYPES.has(prev.type);
    const nextList = !!next && LIST_TYPES.has(next.type);
    let top = prevList ? 1 : 6;
    let bottom = nextList ? 1 : 6;
    if (isNested && isFirstChild) top = 2;
    if (isNested && !next) bottom = 0;
    return { top, bottom };
  }
  switch (b.type) {
    case 'divider':
      return { top: 0, bottom: 0 };
    case 'quote':
    case 'callout':
    case 'table_of_contents':
    case 'bookmark':
    case 'embed':
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'pdf':
    case 'equation':
    case 'code':
    case 'table':
    case 'collection_view':
    case 'breadcrumb':
    case 'button':
    case 'column_list':
    case 'transclusion_container':
    case 'transclusion_reference':
    case 'external_object_instance':
    case 'html':
    case 'tab':
    case 'tabs':
    case 'meeting_notes':
    case 'transcription':
    case 'ai_block':
    // embed provider block types: same box as embed
    case 'abstract': case 'codepen': case 'deepnote': case 'drive': case 'excalidraw': case 'figma': case 'framer':
    case 'gist': case 'hex': case 'invision': case 'loom': case 'maps': case 'miro': case 'mixpanel': case 'replit':
    case 'sketch': case 'tweet': case 'typeform': case 'whimsical':
      return { top: isNested && isFirstChild ? 2 : 8, bottom: 8 };
    // sub-page and link-to-page row: block 40px = 6 + 28px link + 6;
    // the empty link_to_page placeholder is 16px = padding 8/8
    case 'page':
    case 'alias':
    case 'collection_view_page':
      return { top: isNested && isFirstChild ? 2 : 6, bottom: 6 };
    case 'link_to_page':
      return { top: 8, bottom: 8 };
    default:
      return { top: isNested && isFirstChild && parentType !== 'toggle' ? 2 : 6, bottom: 6 };
  }
}
