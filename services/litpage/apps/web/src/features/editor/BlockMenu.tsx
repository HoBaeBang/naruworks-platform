// Block action menu (⋮⋮ handle click / ⌘/):

import type { BlockRecord } from '@nc/shared/records.ts';
import { BLOCK_LABELS, TEXT_BLOCKS } from '@nc/shared/blocks.ts';
import { COLOR_LABELS, COLOR_NAMES } from '@nc/shared/colors.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { openMenu, type MenuDef, type MenuItemDef, type MenuSectionDef } from '../../components/Menu.tsx';
import { getBlock, run, setFormat } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { formatDateTime } from '../../lib/format.ts';
import { deleteBlocks, duplicateBlocks, pageIdOfBlock, turnInto, setOpen } from './commands.ts';
import { useEditor } from './editorState.ts';
import { copyPageLink } from '../page/pageActions.ts';
import { openMoveToDialog } from '../page/MoveTo.tsx';
import { rememberColor } from './textHandlers.ts';
import { startCommentOnBlock } from '../comments/comments.tsx';
import { blockDuplicateItem, blockMenuItems } from './blocks/registry.ts';
import { turnIntoItems } from './inline/turnInto.ts';
import { Icon } from '../../components/Icon.tsx';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { recentColors } from './inline/format.ts';
import { PREF, setPref } from './prefs.ts';
import { ColorSwatch } from './colorSwatch.tsx';
import { presentFrom } from './slashItems.ts';
import { showTextDirectionControls } from '../settings/userSettings.ts';
import { developerMenuSection } from '../settings/developerMode.ts';
import { useSkills } from '../ai/aiStores.ts';

function blockLabel(b: BlockRecord): string {
  if (b.format?.toggleable) return `Toggle ${BLOCK_LABELS[b.type] ?? 'block'}`.replace('Toggle Heading', 'Toggle heading');
  return BLOCK_LABELS[b.type] ?? 'Block';
}

export function turnIntoMenu(ids: string[]): MenuDef {
  const b = getBlock(ids[0]);
  // shared catalog with the text action menu, plus “Synced block” for block menus
  return {
    width: 220,
    maxHeight: '70vh',
    role: 'menu',
    sections: [{
      items: turnIntoItems({ includeSynced: true }).map((t) => ({
        label: t.label, icon: t.icon,
        checked: !!b && b.type === t.type && !!b.format?.toggleable === !!t.format?.toggleable && !t.columns && !t.pickParent,
        right: t.pickParent ? <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} /> : undefined,
        onSelect: () => {
          const anchor = (document.querySelector(`[data-block-id="${ids[0]}"]`) as HTMLElement | null)?.getBoundingClientRect();
          t.apply(ids, anchor);
        },
      })),
    }],
  };
}

function convertToPage(id: string) {
  const b = getBlock(id);
  if (!b) return;
  run('turnIntoPage', (tx) => {
    tx.update('block', id, [], { type: 'page' });
    tx.update('block', id, ['format'], { block_color: undefined });
  });
}

export { ColorSwatch };

function colorLabel(c: string): string {
  const base = c.replace('_background', '') as (typeof COLOR_NAMES)[number];
  return `${COLOR_LABELS[base] ?? base} ${c.endsWith('_background') ? 'background' : 'text'}`;
}

export function colorMenu(ids: string[]): MenuDef {
  const apply = (c: string) => {
    rememberColor(c);
    run('setBlockColor', (tx) => { for (const id of ids) setFormat(tx, id, { block_color: c === 'default' ? undefined : c }); });
    // callouts remember their color for new callouts on this device (calloutBlockBackground)
    if (ids.some((id) => getBlock(id)?.type === 'callout')) setPref(PREF.calloutColor, c);
  };
  // “Last used” appears only after this device has used a color; there are no checkmarks
  const last = recentColors()[0];
  return {
    width: 220,
    maxHeight: '70vh',
    role: 'menu',
    sections: [
      ...(last ? [{ title: 'Last used', items: [{ label: colorLabel(last), icon: <ColorSwatch color={last} />, shortcut: '⌘⇧H', onSelect: () => apply(last) }] }] : []),
      { title: 'Text color', items: COLOR_NAMES.map((c) => ({ label: `${COLOR_LABELS[c]} text`, icon: <ColorSwatch color={c} />, onSelect: () => apply(c) })) },
      { title: 'Background color', items: COLOR_NAMES.map((c) => ({ label: `${COLOR_LABELS[c]} background`, icon: <ColorSwatch color={c === 'default' ? 'default_background' : `${c}_background`} />, onSelect: () => apply(c === 'default' ? 'default' : `${c}_background`) })) },
    ],
  };
}

/** Words and characters of the selected blocks and their nested blocks, using the same word rule as the page menu. */
function selectionCounts(ids: string[]): { words: number; chars: number } {
  let words = 0;
  let chars = 0;
  const walk = (id: string, root: boolean) => {
    const b = getBlock(id);
    if (!b || b.alive === false) return;
    if (!root && (b.type === 'page' || b.type === 'collection_view_page')) return;
    const text = toPlainText(b.properties?.title);
    chars += text.length;
    words += (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0)
      + text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    if (b.type !== 'page' && b.type !== 'collection_view_page') for (const c of b.content ?? []) walk(c, false);
  };
  for (const id of ids) walk(id, true);
  return { words, chars };
}

export function blockActionMenu(ids: string[]): MenuDef {
  const b = getBlock(ids[0]);
  if (!b) return { sections: [] };
  const multi = ids.length > 1;
  const textual = TEXT_BLOCKS.has(b.type) || b.type === 'page';
  const editor = records.get('lit_user', b.last_edited_by_id) as any;
  const { words, chars } = selectionCounts(ids);
  const countable = ids.some((id) => { const x = getBlock(id); return !!x && (TEXT_BLOCKS.has(x.type) || x.type === 'page' || !!x.content?.length); });
  const actions: MenuItemDef[] = [
    { label: 'Copy block URL', icon: 'link', shortcut: '⌘⌃L', onSelect: () => copyPageLink(pageIdOfBlock(b.id) ?? b.id, b.id) },
    blockDuplicateItem({ ids, block: b }) ?? { label: 'Duplicate', icon: 'duplicate', shortcut: '⌘D', onSelect: () => { duplicateBlocks(ids); } },
    { label: 'Move to', icon: 'arrowTurnUpRight', shortcut: '⌘⇧P', onSelect: () => openMoveToDialog(ids, document.querySelector(`[data-block-id="${b.id}"]`) as HTMLElement) },
    { label: 'Delete', icon: 'trash', shortcut: 'Del', onSelect: () => deleteBlocks(ids) },
  ];
  const turnIntoItem: MenuItemDef = { label: 'Turn into', icon: 'arrowSquarePathUpDown', submenu: () => turnIntoMenu(ids) };
  const colorItem: MenuItemDef = { label: 'Color', icon: 'blockColor', submenu: () => colorMenu(ids) };
  // Text direction (Settings › Preferences › Always show text direction controls, or an RTL language): format.block_text_direction
  const directionItem: MenuItemDef | null = textual && showTextDirectionControls() ? {
    label: 'Text direction', icon: 'textDirection',
    submenu: () => ({
      width: 200,
      sections: [{
        items: ([['auto', 'Auto-detect'], ['ltr', 'Read left to right'], ['rtl', 'Read right to left']] as const).map(([d, label]) => ({
          label, checked: ((getBlock(b.id)?.format as any)?.block_text_direction ?? 'auto') === d,
          onSelect: () => run('setTextDirection', (tx) => { for (const id of ids) setFormat(tx, id, { block_text_direction: d === 'auto' ? undefined : d }); }),
        })),
      }],
    }),
  } : null;
  // per-type first section registered by block modules (code: Caption/Copy code/Wrap…, table: Header row…)
  const custom = !multi ? blockMenuItems({ ids, block: b, turnInto: turnIntoItem, color: colorItem }) : null;
  const sections: MenuDef['sections'] = [
    {
      title: multi ? `${ids.length} blocks` : blockLabel(b),
      items: [...(custom ?? [...(textual ? [turnIntoItem] : []), colorItem]), ...(directionItem ? [directionItem] : [])],
    },
    { items: actions },
    {
      items: [
        { label: 'Comment', icon: 'commentFilled', shortcut: '⌘⇧M', onSelect: () => startCommentOnBlock(b.id) },
        { label: 'Suggest edits', icon: 'commentPencil', shortcut: '⌘⇧⌥X', onSelect: () => void import('../comments/suggest.ts').then((m) => m.startSuggestingFrom(b.id)) },
      ],
    },
    { items: [{ label: 'Start presenting here', icon: 'playButton', badge: 'Beta', shortcut: '⌘⌥P', onSelect: () => presentFrom(b.id) }] },
    // Settings › Developer › Enable developer features: Copy block / database / data source ID 
    ...(!multi && developerMenuSection(b.id) ? [developerMenuSection(b.id)!] : []),
    {
      items: [
        { label: 'Ask AI', icon: 'aiFace', shortcut: '⌘J', onSelect: () => window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { blockId: b.id } })) },
        { label: 'Skills', icon: 'paperBolt', submenu: () => blockSkillsMenu(b.id) },
      ],
    },
  ];
  // "Search actions…" also reaches the Turn into targets and the colors (catalog: action, block and color names)
  const searchSections = (): MenuSectionDef[] => {
    const out: MenuSectionDef[] = [];
    if (textual || custom?.includes(turnIntoItem)) {
      out.push({ title: 'Turn into', items: turnIntoMenu(ids).sections[0].items.map((it) => ({ ...it, keywords: ['turn into', 'turn', 'convert'] })) });
    }
    if (!custom || custom.includes(colorItem)) {
      out.push({ title: 'Color', items: colorMenu(ids).sections.filter((sec) => sec.title !== 'Last used').flatMap((sec) => sec.items).map((it) => ({ ...it, keywords: ['color', 'colour', ...(String(it.label).startsWith('Gray') ? ['grey'] : [])] })) });
    }
    return out;
  };
  return {
    width: 265,
    maxHeight: '70vh',
    search: 'Search actions…',
    initialActive: -1, // “Search actions…” menus open with no highlighted row
    sections,
    searchSections,
    // footer = one more menu section: "Last edited" 12/16 500,
    // avatar 24 + name 12/16 500, time 12/16, then the counts 12/16 tertiary with 4px margins
    footer: !multi ? (
      <div className="nc-menu-section nc-block-menu-footer">
        <div className="nc-block-menu-footer-row">
          <div className="nc-block-menu-footer-col">
            <div className="title">Last edited</div>
            <div className="who">
              <UserAvatar userId={b.last_edited_by_id} size={24} />
              <span className="name nc-ellipsis">{editor ? userName(editor) : 'Unknown'}</span>
            </div>
            <div className="when">{formatDateTime(b.last_edited_time)}</div>
          </div>
          {textual && <div className="count">{words} words, {chars} characters</div>}
        </div>
      </div>
    ) : countable ? (
      <div className="nc-menu-section nc-block-menu-footer">
        <div className="nc-block-menu-footer-row">
          <div className="count">{words} words, {chars} characters</div>
        </div>
      </div>
    ) : undefined,
  };
}

/** The ⋮⋮ handle's box for a block (the menu anchors to it): 18×24 at block.x-28, centered on the first line. */
function handleRect(el: HTMLElement): DOMRect {
  const handle = document.querySelector<HTMLElement>('.nc-block-gutter .nc-block-handle');
  const g = handle?.closest('.nc-block-gutter');
  if (handle && g && useEditor.getState().hoverBlock === el.dataset.blockId) return handle.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const leaf = el.querySelector<HTMLElement>('[data-content-editable-leaf]');
  let top = r.top;
  if (leaf && leaf.closest('.lit-selectable') === el) {
    const lr = leaf.getBoundingClientRect();
    const cs = getComputedStyle(leaf);
    top = lr.top + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.lineHeight) || 24) / 2 - 12;
  } else if (r.height < 24) top = r.top + (r.height - 24) / 2;
  return new DOMRect(r.left - 28, top, 18, 24);
}

export function openBlockMenu(ids: string[], anchor: HTMLElement | DOMRect, opts?: { atPointer?: boolean }) {
  useEditor.getState().selectBlocks(ids, ids[0]);
  void useSkills.getState().load().catch(() => {}); // ⋮⋮ › Skills lists the user's own skills (cached ~15s)
  // The menu sits 5px left of the 18×24 handle, vertically centered
  // on it (justify-content: center) and clamped to the viewport. Anchors wider than a handle (⌘/, the selection
  // menu's •••) are mapped to the block's handle position. A right-click opens it at the pointer.
  let rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  if (rect.width > 40 && !opts?.atPointer) {
    const el = document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${ids[0]}"]`);
    if (el) rect = handleRect(el);
  }
  useEditor.setState({ blockMenuFor: ids[0] });
  openMenu(rect, blockActionMenu(ids), {
    placement: opts?.atPointer ? 'bottom-start' : 'left',
    offset: opts?.atPointer ? 0 : 5,
    onClose: () => {
      if (useEditor.getState().blockMenuFor === ids[0]) useEditor.setState({ blockMenuFor: null });
      // keep the selection highlighted only while the menu is open
      const s = useEditor.getState();
      if (s.selectedBlocks.join() === ids.join()) s.clearBlockSelection();
    },
  });
}

export function openBlockMenuFor(blockId: string, el: HTMLElement) {
  openBlockMenu([blockId], el.getBoundingClientRect());
}

/** ⋮⋮ › Skills: built-in skills and the user's enabled page skills, plus "Manage skills". Each runs on the block via `nc:ask-ai`. */
function blockSkillsMenu(blockId: string): MenuDef {
  const ask = (detail: Record<string, unknown>) => () => { window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { blockId, ...detail } })); };
  const builtin = ['Improve writing', 'Proofread', 'Explain', 'Reformat', 'Summarize', 'Translate', 'Make shorter', 'Make longer'];
  const mine = useSkills.getState().enabled.filter((x) => !x.builtin && x.inPage);
  return {
    sections: [
      { items: builtin.map((s) => ({ label: s, icon: 'sparkle', onSelect: ask({ skill: s }) })) },
      ...(mine.length ? [{ title: 'Your skills', items: mine.map((x) => ({ label: x.name, icon: 'paperBolt', description: x.description || undefined, onSelect: ask({ skill: x.name, skillId: x.id }) })) }] : []),
      { items: [{ label: 'Manage skills', icon: 'sliders', onSelect: ask({ skill: 'manage' }) }] },
    ],
  };
}
