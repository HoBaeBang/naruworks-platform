// Slash menu catalog. Each item converts the empty current block or inserts a new block below.
// Search keywords come from static fuzzy keyword parsing and catalog aliases such as /toc, /col2, /turnbullet, /moveto, and /grey.
import { createElement, type ReactNode } from 'react';
import type { BlockType } from '@nc/shared/records.ts';
import { COLOR_NAMES, COLOR_LABELS } from '@nc/shared/colors.ts';
import { newId } from '@nc/shared/ids.ts';
import { TEXT_BLOCKS } from '@nc/shared/blocks.ts';
import { createBlockIn, getBlock, run, setFormat, touch } from '../../lib/blocks.ts';
import { useEditor } from './editorState.ts';
import { duplicateBlocks, deleteBlocks, insertAfter, setOpen, titleOf, turnInto } from './commands.ts';
import { length } from '@nc/shared/richtext.ts';
import { copyPageLink } from '../page/pageActions.ts';
import { pageIdOfBlock } from './commands.ts';
import { insertDatabase } from '../database/createDatabase.ts';
import { openMoveToDialog } from '../page/MoveTo.tsx';
import { applySlashOverrides, extraSlashItems } from './blocks/registry.ts';
import { useUI } from '../../lib/store/ui.ts';
import { ColorSwatch } from './colorSwatch.tsx';
import { stickyFormat } from './prefs.ts';
import { turnIntoItems } from './inline/turnInto.ts';

/** Stable ids of the slash "Turn into" items (block modules override some by id, e.g. turn-callout). */
const TURN_IDS: Record<string, string> = {
  Text: 'turn-text', 'Heading 1': 'turn-h1', 'Heading 2': 'turn-h2', 'Heading 3': 'turn-h3', 'Heading 4': 'turn-h4',
  'Bulleted list': 'turn-bullet', 'Numbered list': 'turn-number', 'To-do list': 'turn-todo', 'Toggle list': 'turn-toggle',
  Code: 'turn-code', Quote: 'turn-quote', Callout: 'turn-callout',
};

export interface SlashContext {
  blockId: string;
  /** true when the block is empty after removing the "/query" text */
  empty: boolean;
  anchor: DOMRect;
  /** character offset where the "/" was typed (inline items insert there) */
  offset?: number;
  property?: string;
}

export interface SlashItem {
  id: string;
  label: string;
  section: string;
  icon: string | ReactNode;
  hint?: string;
  badge?: string;
  /** Static fuzzy keywords plus catalog aliases. */
  keywords?: string[];
  /** shortcut shown on the right (Actions: ⌘D, Del …) */
  shortcut?: string;
  /** Listed only when the query matches, including actions such as Comment. */
  searchOnly?: boolean;
  /** "Turn into" items: the target type (checkmark on the current block's type) */
  turnType?: BlockType;
  turnToggleable?: boolean;
  apply: (ctx: SlashContext) => void;
}

/** Convert the current empty block or insert a new block after it. */
export function place(ctx: SlashContext, type: BlockType, opts?: { format?: any; properties?: any; focus?: boolean; extra?: any; addTextAfter?: boolean }): string {
  const b = getBlock(ctx.blockId);
  let id = ctx.blockId;
  if (ctx.empty && b && (b.type === 'text' || TEXT_BLOCKS.has(b.type))) {
    run('slash.convert', (tx) => {
      tx.update('block', ctx.blockId, [], { type, ...(opts?.extra ?? {}) });
      if (opts?.format) tx.update('block', ctx.blockId, ['format'], opts.format);
      if (opts?.properties) for (const [k, v] of Object.entries(opts.properties)) tx.set('block', ctx.blockId, ['properties', k], v);
      touch(tx, ctx.blockId);
    });
  } else {
    id = insertAfter(ctx.blockId, type, { format: opts?.format, properties: opts?.properties, focus: false, extra: opts?.extra });
  }
  if (TEXT_BLOCKS.has(type) && opts?.focus !== false) useEditor.getState().requestFocus(id, 'end');
  else if (opts?.addTextAfter) insertAfter(id, 'text');
  return id;
}

// `id` is the item's stable key (block modules' overrideSlashItem, usage stats), not an i18n message id
const t = (id: string, label: string, section: string, icon: SlashItem['icon'], apply: SlashItem['apply'], extra?: Partial<SlashItem>): SlashItem => ({ id, label, section, icon, apply, ...extra });

// Toggles and toggle headings created from the slash menu start closed;
// the "> " markdown shortcut creates them open.
const textType = (type: BlockType, format?: any, properties?: any) => (ctx: SlashContext) => {
  if (ctx.empty) {
    turnInto(ctx.blockId, type, format);
    if (properties) run('slash.props', (tx) => { for (const [k, v] of Object.entries(properties)) tx.set('block', ctx.blockId, ['properties', k], v); });
    if (type === 'toggle' || format?.toggleable) setOpen(ctx.blockId, false);
  } else {
    insertAfter(ctx.blockId, type, { format, properties });
  }
};

function subPage(ctx: SlashContext) {
  const b = getBlock(ctx.blockId);
  if (!b) return;
  const id = newId();
  run('slash.page', (tx) => {
    if (ctx.empty && b.type === 'text') {
      tx.update('block', ctx.blockId, [], { alive: false });
      tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
      createBlockIn(tx, { id, type: 'page', parentId: b.parent_id, parentTable: 'block', after: undefined, before: nextOf(b.parent_id, ctx.blockId) });
    } else {
      createBlockIn(tx, { id, type: 'page', parentId: b.parent_id, parentTable: 'block', after: ctx.blockId });
    }
  });
  void import('../../lib/router.ts').then((r) => r.openPage(id));
}

function nextOf(parentId: string, id: string): string | undefined {
  const p = getBlock(parentId);
  const i = p?.content?.indexOf(id) ?? -1;
  return i >= 0 ? p?.content?.[i + 1] : undefined;
}

const media = (type: BlockType) => (ctx: SlashContext) => {
  const id = place(ctx, type, { focus: false, addTextAfter: false });
  useEditor.setState({ hoverBlock: null });
  window.dispatchEvent(new CustomEvent('nc:open-block-placeholder', { detail: { blockId: id } }));
};

const columns = (n: number) => (ctx: SlashContext) => {
  const b = getBlock(ctx.blockId);
  if (!b) return;
  const listId = newId();
  const colIds = Array.from({ length: n }, () => newId());
  const firstText = newId();
  run('slash.columns', (tx) => {
    createBlockIn(tx, { id: listId, type: 'column_list', parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId });
    colIds.forEach((cid, i) => {
      createBlockIn(tx, { id: cid, type: 'column', parentId: listId, parentTable: 'block', format: { column_ratio: 1 / n } });
      createBlockIn(tx, { id: i === 0 ? firstText : newId(), type: 'text', parentId: cid, parentTable: 'block' });
    });
    if (ctx.empty && b.type === 'text') {
      tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
      tx.update('block', ctx.blockId, [], { alive: false });
    }
  });
  useEditor.getState().requestFocus(firstText, 0);
};

const color = (c: string) => (ctx: SlashContext) => {
  run('slash.color', (tx) => setFormat(tx, ctx.blockId, { block_color: c === 'default' ? undefined : c }));
  void import('./inline/format.ts').then((m) => m.pushRecentColor(c));
  useEditor.getState().requestFocus(ctx.blockId, 'end');
};

/** 20px row icon for color items: a tinted “A” for text colors, a filled square for backgrounds. */
function colorIcon(c: string): ReactNode {
  return createElement(ColorSwatch, { color: c });
}

const EMBEDS = [
  'Google Drive', 'Tweet', 'GitHub Gist', 'Google Maps', 'Figma', 'Abstract', 'Invision', 'Mixpanel', 'Framer', 'Whimsical', 'Miro',
  'Sketch', 'Excalidraw', 'PDF', 'Loom', 'Typeform', 'CodePen', 'Replit', 'Hex', 'Deepnote', 'Trello', 'Slack', 'Pitch', 'OneDrive',
  'Dropbox', 'Amplitude', 'Claap', 'Box', 'Linear', 'Lucidchart', 'Lucidspark', 'Eraser', 'ClickUp', 'Plus', 'Dovetail', 'Streak Share',
  'Shortcut', 'SendOwl', 'Amplitude - EU', 'Zendesk', 'Jira preview (Data center)', 'Google Contacts', 'Discord', 'Microsoft Contacts',
  'PagerDuty', 'Asana', 'GitLab', 'Zoom', 'Adobe XD', 'Jira', 'GitHub',
];
/** extra search words for embeds (catalog …: /drive, /gist, /maps, /repl …) */
const EMBED_KEYWORDS: Record<string, string[]> = {
  'Google Drive': ['drive', 'docs', 'sheets', 'slides'], Tweet: ['twitter', 'x'], 'GitHub Gist': ['gist', 'github'], 'Google Maps': ['maps', 'map'],
  Replit: ['repl'], PDF: ['pdf'], Loom: ['video'], Jira: ['jira'], GitHub: ['github'],
};

/** [label, icon, kind, fuzzySearchKeywords] for the “Import” section. */
const IMPORTS: [string, string, string, string][] = [
  ['CSV', 'fileCsv', 'csv', 'CSV Import'], ['Plain text and Markdown', 'textJustifyLeft', 'markdown', 'Plain text Markdown upload'],
  ['Asana', 'puzzle', 'asana', 'Asana task project upload'], ['Confluence', 'puzzle', 'confluence', 'Confluence Import'],
  ['Google Docs', 'file', 'google_docs', 'Google Docs upload'], ['Trello', 'puzzle', 'trello', 'Trello Import'],
  ['Dropbox Paper', 'puzzle', 'dropbox_paper', 'Dropbox Paper upload'], ['Evernote', 'puzzle', 'evernote', 'Evernote Import'],
  ['Workflowy', 'puzzle', 'workflowy', 'Workflowy Import'], ['Word', 'file', 'word', 'Word Import docx'],
  ['Monday', 'puzzle', 'monday', 'Monday Import'], ['Quip', 'puzzle', 'quip', 'Quip Import'],
  ['ZIP', 'zipFile', 'zip', 'ZIP package upload'], ['PDF', 'filePdf', 'pdf', 'PDF Import'],
];

const kw = (s: string) => s.split(/\s+/).filter(Boolean);

/** Slash "Import" items open the import flow. The page area  owns `nc:open-import`; until a listener marks the * event handled the editor opens the Import modal itself (imports land inside the current page). */
export function openImportFlow(kind: string, ctx?: SlashContext) {
  const detail = { kind, blockId: ctx?.blockId, pageId: ctx ? pageIdOfBlock(ctx.blockId) : undefined, handled: false };
  window.dispatchEvent(new CustomEvent('nc:open-import', { detail }));
  if (!detail.handled) useUI.getState().set({ importOpen: true });
}

/** "Start presenting here" (slash Actions, ⋮⋮ menu, ⌘⌥P): `nc:present` for the page area; falls back to the presentation * mode module when no listener handled it. */
export function presentFrom(blockId: string | undefined, pageId?: string) {
  const pid = pageId ?? (blockId ? pageIdOfBlock(blockId) : undefined);
  if (!pid) return;
  // next tick: the menu that picked "Start presenting here" closes its overlays first (it would close the slides too)
  setTimeout(() => {
    const detail = { pageId: pid, blockId, handled: false };
    window.dispatchEvent(new CustomEvent('nc:present', { detail }));
    if (!detail.handled) void import('../page/PresentMode.tsx').then((m) => m.startPresentation(pid, blockId));
  }, 0);
}

export function slashCatalog(): SlashItem[] {
  const items: SlashItem[] = [
    t('ai-meeting-notes', 'AI meeting notes', 'Suggested', 'paperMicrophone', media('meeting_notes'), { keywords: kw('meeting notes ai meeting notes transcription dictation audio speech record voice aimn meet') }),
    t('html-suggested', 'HTML', 'Suggested', 'aiBlock', media('html'), { hint: 'Embeds', badge: 'New', keywords: kw('html embed web page') }),

    t('text', 'Text', 'Basic blocks', 'textNormal', textType('text'), { keywords: ['plain', 'paragraph'] }),
    t('h1', 'Heading 1', 'Basic blocks', 'textH1', textType('header'), { hint: '#', keywords: ['h1', 'title', 'big', 'heading'] }),
    t('h2', 'Heading 2', 'Basic blocks', 'textH2', textType('sub_header'), { hint: '##', keywords: kw('sub heading 2 h2 two subtitle') }),
    t('h3', 'Heading 3', 'Basic blocks', 'textH3', textType('sub_sub_header'), { hint: '###', keywords: kw('third heading h3') }),
    t('h4', 'Heading 4', 'Basic blocks', 'textH4', textType('header_4'), { hint: '####', keywords: kw('fourth heading h4') }),
    t('bulleted', 'Bulleted list', 'Basic blocks', 'listBullet', textType('bulleted_list'), { hint: '-', keywords: ['ul', 'bullet', 'list'] }),
    t('numbered', 'Numbered list', 'Basic blocks', 'listNumber', textType('numbered_list'), { hint: '1.', keywords: ['ol', 'number', 'num', 'list'] }),
    t('todo', 'Task list', 'Basic blocks', 'checklist', textType('to_do', undefined, { checked: [['No']] }), { hint: '[]', keywords: kw('todo to-do checkbox list do task') }),
    t('toggle', 'Toggle list', 'Basic blocks', 'listToggle', textType('toggle'), { hint: '>', keywords: kw('toggle collapse reveal details') }),
    t('page', 'Page', 'Basic blocks', 'page', subPage, { keywords: ['subpage', 'new page'] }),
    t('callout', 'Callout', 'Basic blocks', 'calloutBlock', textType('callout', { page_icon: '💡', block_color: 'gray_background' }), { keywords: ['note', 'info', 'warning'] }),
    t('quote', 'Quote', 'Basic blocks', 'quote', (ctx) => textType('quote', stickyFormat('quote').format)(ctx), { hint: '"', keywords: ['“”', 'blockquote', 'citation'] }),
    t('table', 'Table', 'Basic blocks', 'viewTable', (ctx) => insertSimpleTable(ctx), { keywords: ['grid', 'simple table'] }),
    t('divider', 'Divider', 'Basic blocks', 'dashLong', (ctx) => { place(ctx, 'divider', { focus: false }); insertAfter(ctx.empty ? ctx.blockId : ctx.blockId, 'text'); }, { hint: '---', keywords: kw('horizontal rule divider line hr section separator div —-') }),
    t('link-to-page', 'Page link', 'Basic blocks', 'docSend', (ctx) => window.dispatchEvent(new CustomEvent('nc:link-to-page', { detail: ctx })), { keywords: ['ltp', 'link', 'alias', 'reference'] }),

    t('image', 'Image', 'Media', 'photo', media('image'), { keywords: kw('image picture gif giphy photo img png jpg unsplash') }),
    t('video', 'Video', 'Media', 'playButton', media('video'), { keywords: ['youtube', 'vimeo', 'movie'] }),
    t('audio', 'Audio', 'Media', 'volumeOn', media('audio'), { keywords: ['sound', 'music', 'mp3'] }),
    t('code', 'Code', 'Media', 'code', (ctx) => { const st = stickyFormat('code'); place(ctx, 'code', { properties: { language: st.properties?.language ?? [['JavaScript']] }, format: st.format }); }, { hint: '```', keywords: ['snippet', 'programming'] }),
    t('file', 'File', 'Media', 'paperClip', media('file'), { keywords: ['upload', 'attach', 'attachment'] }),
    t('bookmark', 'Web bookmark', 'Media', 'bookmark', media('bookmark'), { keywords: ['web', 'link', 'bookmark', 'book', 'url', 'preview'] }),

    ...([
      ['table', 'Table view', 'viewTable', ''], ['board', 'Board view', 'viewBoard', 'kanban'], ['gallery', 'Gallery view', 'squareGrid2X2', ''],
      ['list', 'List view', 'listDash', ''], ['feed', 'Feed view', 'newspaper', ''], ['dashboard', 'Dashboard view', 'viewDashboard', 'create dashboard dash'],
      ['calendar', 'Calendar view', 'viewCalendar', ''], ['timeline', 'Timeline view', 'viewTimeline', ''], ['map', 'Map view', 'map', ''],
    ] as const).map(([vt, label, icon, extra]) => t(`db-${vt}`, label, 'Database', icon, (ctx) => insertDatabase(ctx, { viewType: vt, inline: true }), {
      badge: vt === 'dashboard' || vt === 'map' ? 'New' : undefined, keywords: ['database', 'view', vt, ...kw(extra)],
    })),
    ...([
      ['bar', 'Column bar chart', 'chartBarXAxis'], ['horizontal_bar', 'Row bar chart', 'chartBarYAxis'], ['line', 'Line chart', 'chartLine'],
      ['donut', 'Donut chart', 'donutChart'], ['number', 'Number chart', 'number'],
    ] as const).map(([ct, label, icon]) => t(`chart-${ct}`, label, 'Database', icon, (ctx) => insertDatabase(ctx, { viewType: 'chart', chartType: ct, inline: true }), { keywords: ['chart', 'graph'] })),
    t('form', 'Form', 'Database', 'inlineBlockDouble', (ctx) => insertDatabase(ctx, { viewType: 'form', inline: true }), { keywords: ['survey', 'questions'] }),
    t('db-inline', 'Database - Inline', 'Database', 'databaseEmbed', (ctx) => insertDatabase(ctx, { viewType: 'table', inline: true }), { keywords: kw('database inline db table') }),
    t('db-page', 'Database full page', 'Database', 'viewTable', (ctx) => insertDatabase(ctx, { viewType: 'table', inline: false }), { keywords: kw('full database db') }),
    t('linked-view', 'Linked data source view', 'Database', 'collectionArrow', (ctx) => insertDatabase(ctx, { viewType: 'table', inline: true, linked: true }), { keywords: kw('create linked view of data source database db lv linked') }),

    t('toc', 'Contents list', 'Advanced blocks', 'tableOfContents', (ctx) => place(ctx, 'table_of_contents', { focus: false, addTextAfter: ctx.empty, format: stickyFormat('table_of_contents').format }), { keywords: ['toc', 'outline'] }),
    t('equation', 'Block equation', 'Advanced blocks', 'sumSquare', media('equation'), { keywords: kw('latex math block equation $$ formula tex') }),
    t('button', 'Button', 'Advanced blocks', 'arrowInRectangleRight', media('button'), { keywords: kw('button workflow template copy') }),
    t('breadcrumb', 'Breadcrumb', 'Advanced blocks', 'docHashtag', (ctx) => place(ctx, 'breadcrumb', { focus: false, addTextAfter: ctx.empty }), { keywords: ['bread', 'path'] }),
    t('tabs', 'Tabs', 'Advanced blocks', 'tabs', media('tabs'), { badge: 'New', keywords: kw('tabs switch panels') }),
    t('synced', 'Mirrored block', 'Advanced blocks', 'blockSync', (ctx) => place(ctx, 'transclusion_container', { focus: false }), { keywords: kw('mirrored block reference portal embed group sync') }),
    t('toggle-h1', 'Toggle heading 1', 'Advanced blocks', 'textH1Toggle', textType('header', { toggleable: true }), { hint: '# >', keywords: kw('collapsible heading one h1') }),
    t('toggle-h2', 'Toggle heading 2', 'Advanced blocks', 'textH2Toggle', textType('sub_header', { toggleable: true }), { hint: '## >', keywords: kw('collapsible heading two h2') }),
    t('toggle-h3', 'Toggle heading 3', 'Advanced blocks', 'textH3Toggle', textType('sub_sub_header', { toggleable: true }), { hint: '### >', keywords: kw('collapsible heading three h3') }),
    t('col2', '2 columns', 'Advanced blocks', 'rectangleSplit2', columns(2), { keywords: kw('two columns split layout col2') }),
    t('col3', '3 columns', 'Advanced blocks', 'rectangleSplit3', columns(3), { keywords: kw('three columns split layout col3') }),
    t('col4', '4 columns', 'Advanced blocks', 'rectangleSplit4', columns(4), { keywords: kw('four columns split layout col4') }),
    t('col5', '5 columns', 'Advanced blocks', 'rectangleSplit5', columns(5), { keywords: kw('five columns split layout col5') }),
    t('ai-meeting-notes-2', 'AI meeting notes', 'Advanced blocks', 'paperMicrophone', media('meeting_notes'), { keywords: kw('meeting notes ai meeting notes transcription dictation audio speech record voice aimn meet') }),
    t('mermaid', 'Code - Mermaid', 'Advanced blocks', 'whaleTail', (ctx) => place(ctx, 'code', { properties: { language: [['Mermaid']] } }), { keywords: kw('diagram flowchart mermaid code') }),
    t('ai-block', 'AI Block', 'Advanced blocks', 'aiBlock', media('ai_block'), { keywords: kw('ask assistant prompt ai content') }),

    t('mention-person', 'Mention someone', 'Inline', 'personCircle', (ctx) => window.dispatchEvent(new CustomEvent('nc:inline-trigger', { detail: { ...ctx, trigger: '@' } })), { keywords: ['mention', 'person', 'people', 'user', '@'] }),
    t('mention-page', 'Mention pages and data sources', 'Inline', 'page', (ctx) => window.dispatchEvent(new CustomEvent('nc:inline-trigger', { detail: { ...ctx, trigger: '@' } })), { keywords: ['mention', 'page', 'link', 'database'] }),
    t('date', 'Date or reminder', 'Inline', 'clock', (ctx) => window.dispatchEvent(new CustomEvent('nc:inline-trigger', { detail: { ...ctx, trigger: '@' } })), { keywords: ['date', 'reminder', 'remind', 'today', 'now', 'time'] }),
    t('emoji', 'Emoji', 'Inline', 'emojiFace', (ctx) => window.dispatchEvent(new CustomEvent('nc:inline-trigger', { detail: { ...ctx, trigger: ':', full: true } })), { keywords: ['emoji', 'icon', 'emoticon'] }),
    t('inline-equation', 'Inline equation', 'Inline', 'squareRoot', (ctx) => window.dispatchEvent(new CustomEvent('nc:inline-equation', { detail: ctx })), { keywords: kw('latex math inline equation $ tex formula') }),

    t('embed', 'Embed', 'Embeds', 'linkCapture', media('embed'), { keywords: ['iframe', 'embed'] }),
    t('html', 'HTML', 'Embeds', 'aiBlock', media('html'), { badge: 'New', keywords: kw('html embed web page') }),
    ...EMBEDS.map((name) => t(`embed-${name}`, name, 'Embeds', name === 'PDF' ? 'filePdf' : 'globe', (ctx) => {
      const id = place(ctx, name === 'PDF' ? 'pdf' : 'embed', { focus: false, format: { embed_provider: name } });
      window.dispatchEvent(new CustomEvent('nc:open-block-placeholder', { detail: { blockId: id } }));
    }, { keywords: ['embed', ...(EMBED_KEYWORDS[name] ?? [])] })),
    ...['Asana', 'GitLab', 'GitHub'].map((name) => t(`synced-db-${name}`, name, 'Synced Databases', 'refresh', () => useUI.getState().toast(`${name} sync requires connecting an integration.`), { keywords: ['sync', 'synced database', `${name.toLowerCase()} sync`] })),
    ...IMPORTS.map(([name, icon, kind, words]) => t(`import-${name}`, name, 'Import', icon, (ctx) => openImportFlow(kind, ctx), { badge: name === 'Google Docs' ? 'New' : undefined, keywords: kw(words) })),

    // “Turn into” uses the block menu catalog from inline/turnInto.ts. The slash
    // search reaches them as "/turn", "/turninto", "/turnbullet", "/turncallout", "/turnintotoggleh1" (…078).
    ...turnIntoItems({ includeSynced: true }).map((ti) => t(TURN_IDS[ti.label] ?? `turn-${ti.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, ti.label, 'Turn into', ti.icon, (ctx) => ti.apply([ctx.blockId], ctx.anchor), {
      turnType: ti.columns || ti.pickParent ? undefined : ti.type, turnToggleable: !!ti.format?.toggleable,
      keywords: ['turn into', 'turninto', 'turn', 'convert', `turn into ${ti.label.toLowerCase()}`, ...turnAliases(ti.label)],
    })),

    t('copy-link', 'Copy block link', 'Actions', 'link', (ctx) => copyPageLink(pageIdOfBlock(ctx.blockId) ?? ctx.blockId, ctx.blockId), { shortcut: '⌘⌃L', keywords: ['copy link', 'link', 'url', 'anchor'] }),
    t('duplicate', 'Duplicate', 'Actions', 'duplicate', (ctx) => duplicateBlocks([ctx.blockId]), { shortcut: '⌘D', keywords: ['copy', 'clone', 'dup'] }),
    t('move-to', 'Move to', 'Actions', 'arrowTurnUpRight', (ctx) => openMoveToDialog([ctx.blockId], ctx.anchor), { shortcut: '⌘⇧P', keywords: ['moveto', 'move', 'move block'] }),
    t('delete', 'Delete', 'Actions', 'trash', (ctx) => deleteBlocks([ctx.blockId]), { shortcut: 'Del', keywords: ['remove', 'trash'] }),
    // hidden in the unfiltered menu, reachable by search such as “/comment”
    t('comment', 'Comment', 'Actions', 'commentFilled', (ctx) => void import('../comments/comments.tsx').then((m) => m.startCommentOnBlock(ctx.blockId)), { shortcut: '⌘⇧M', searchOnly: true, keywords: ['comment', 'discussion', 'note'] }),
    t('present', 'Start presenting here', 'Actions', 'playButton', (ctx) => presentFrom(ctx.blockId), { badge: 'Beta', shortcut: '⌘⌥P', keywords: ['present', 'presentation', 'slides', 'slideshow'] }),
    t('ask-ai', 'Ask AI', 'Actions', 'aiFace', (ctx) => window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: ctx })), { shortcut: '⌘J', keywords: ['ai', 'litpage ai', 'assistant'] }),
    // "/skill": pick a skill and run it on this block (features/ai handles nc:ai-skill-menu —)
    t('ai-skill', 'Skills', 'Actions', 'paperBolt', (ctx) => window.dispatchEvent(new CustomEvent('nc:ai-skill-menu', { detail: ctx })), { keywords: ['skill', 'skills', 'ai skill', 'run skill'] }),

    ...COLOR_NAMES.map((c) => t(`color-${c}`, `${COLOR_LABELS[c]} text`, 'Text color', colorIcon(c), color(c === 'default' ? 'default' : c), {
      keywords: ['color', 'colour', 'text color', 'font color', ...(c === 'gray' ? ['grey'] : [])],
    })),
    ...COLOR_NAMES.map((c) => t(`bg-${c}`, `${COLOR_LABELS[c]} background`, 'Background color', colorIcon(c === 'default' ? 'default_background' : `${c}_background`), color(c === 'default' ? 'default' : `${c}_background`), {
      // Search title override: “Color Background”
      keywords: ['color', 'colour', 'background', 'highlight', ...(c === 'gray' ? ['grey', 'grey background'] : [])],
    })),
  ];
  // block modules (editor/blocks/*.block.tsx) replace how some items create their block (callout v2, tabs, embeds…);
  // other areas add items through registerSlashItems (AI image, skills …)
  return applySlashOverrides([...items, ...extraSlashItems()]);
}

/** Compact aliases of a Turn into target: "Bulleted list" → turnbullet, turnintobulletedlist … (…078). */
function turnAliases(label: string): string[] {
  const l = label.toLowerCase();
  const compact = l.replace(/[^a-z0-9]+/g, '');
  const first = l.split(/[^a-z0-9]+/)[0];
  const out = [`turn${compact}`, `turninto${compact}`, `turn${first}`, `turninto${first}`];
  const th = /^toggle heading (\d)$/.exec(l);
  if (th) out.push(`turnintotoggleh${th[1]}`, `turntoggleh${th[1]}`, `turnintoth${th[1]}`);
  const h = /^heading (\d)$/.exec(l);
  if (h) out.push(`turnintoh${h[1]}`, `turnh${h[1]}`);
  return out;
}

function insertSimpleTable(ctx: SlashContext) {
  const b = getBlock(ctx.blockId);
  if (!b) return;
  const tableId = newId();
  const cols = [newId(), newId(), newId()];
  const rowIds = [newId(), newId(), newId()];
  run('slash.table', (tx) => {
    createBlockIn(tx, {
      id: tableId, type: 'table', parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId,
      format: { table_block_column_order: cols, table_block_column_header: false, table_block_row_header: false, table_block_column_format: {} },
    });
    for (const rid of rowIds) createBlockIn(tx, { id: rid, type: 'table_row', parentId: tableId, parentTable: 'block', properties: {} });
    if (ctx.empty && b.type === 'text' && length(titleOf(ctx.blockId)) === 0) {
      tx.listRemove('block', b.parent_id, ['content'], ctx.blockId);
      tx.update('block', ctx.blockId, [], { alive: false });
    }
  });
  useEditor.getState().requestFocus(rowIds[0], 0, { property: cols[0] });
}
