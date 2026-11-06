// Block type metadata shared by client and server.
import type { BlockType } from './records.ts';

/** Blocks whose `properties.title` is edited inline as rich text. */
export const TEXT_BLOCKS = new Set<BlockType>([
  'text', 'header', 'sub_header', 'sub_sub_header', 'header_4', 'bulleted_list', 'numbered_list',
  'to_do', 'toggle', 'quote', 'callout', 'code',
]);

/** Blocks that render their `content` children nested under them in the editor. */
export const NESTING_BLOCKS = new Set<BlockType>([
  'text', 'bulleted_list', 'numbered_list', 'to_do', 'toggle', 'quote', 'callout',
  'header', 'sub_header', 'sub_sub_header', 'header_4', // only when format.toggleable
  'column_list', 'column', 'table', 'transclusion_container', 'tabs', 'tab',
]);

export const PAGE_LIKE = new Set<BlockType>(['page', 'collection_view_page']);

export const HEADING_TYPES = new Set<BlockType>(['header', 'sub_header', 'sub_sub_header', 'header_4']);

export const LIST_TYPES = new Set<BlockType>(['bulleted_list', 'numbered_list', 'to_do', 'toggle']);

export const BLOCK_LABELS: Partial<Record<BlockType, string>> = {
  page: 'Page',
  text: 'Text',
  header: 'Heading 1',
  sub_header: 'Heading 2',
  sub_sub_header: 'Heading 3',
  header_4: 'Heading 4',
  bulleted_list: 'Bulleted list',
  numbered_list: 'Numbered list',
  to_do: 'Task list',
  toggle: 'Toggle list',
  quote: 'Quote',
  callout: 'Callout',
  divider: 'Divider',
  code: 'Code',
  equation: 'Block equation',
  table: 'Table',
  column_list: 'Columns',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  pdf: 'PDF',
  bookmark: 'Web bookmark',
  embed: 'Embed',
  table_of_contents: 'Contents',
  breadcrumb: 'Breadcrumb',
  button: 'Button',
  tabs: 'Tabs',
  transclusion_container: 'Mirrored block',
  collection_view: 'Database',
  collection_view_page: 'Database',
  link_to_page: 'Page link',
  alias: 'Page link',
  tab: 'Tabs',
  html: 'HTML',
  transclusion_reference: 'Mirrored block',
  meeting_notes: 'AI meeting notes',
  transcription: 'AI meeting notes',
  ai_block: 'AI block',
  abstract: 'Abstract', codepen: 'CodePen', deepnote: 'Deepnote', drive: 'Google Drive', excalidraw: 'Excalidraw', figma: 'Figma',
  framer: 'Framer', gist: 'GitHub Gist', hex: 'Hex', invision: 'Invision', loom: 'Loom', maps: 'Google Maps', miro: 'Miro',
  mixpanel: 'Mixpanel', replit: 'Replit', sketch: 'Sketch', tweet: 'Tweet', typeform: 'Typeform', whimsical: 'Whimsical',
};

/** Type a new sibling block gets when pressing Enter at the end of a block of `type`. */
export function typeAfterEnter(type: BlockType, toggleable?: boolean): BlockType {
  if (type === 'bulleted_list' || type === 'numbered_list' || type === 'to_do' || type === 'toggle') return type;
  if (HEADING_TYPES.has(type) && toggleable) return 'text';
  return 'text';
}

export function canHaveChildren(type: BlockType, toggleable?: boolean): boolean {
  if (HEADING_TYPES.has(type)) return !!toggleable;
  return NESTING_BLOCKS.has(type) || PAGE_LIKE.has(type);
}
