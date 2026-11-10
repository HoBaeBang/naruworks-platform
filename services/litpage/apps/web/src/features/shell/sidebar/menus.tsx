import { HELP_URL } from '@nc/shared/brand.ts';


import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { BlockRecord, SpaceRecord, SpaceViewRecord, TeamRecord, UserRootRecord } from '@nc/shared/records.ts';
import { openMenu, type MenuDef, type MenuItemDef } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import type { Anchor } from '../../../components/overlay.tsx';
import { records } from '../../../lib/store/records.ts';
import { currentSpaceView, useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { navigate, openPeek, pageUrl, spaceDomain } from '../../../lib/router.ts';
import { getBlock, run, setTitle } from '../../../lib/blocks.ts';
import { copyPageLink, duplicatePage, isFavorite, newPage, pageTitle, toggleFavorite, trashPage } from '../../page/pageActions.ts';
import { openMoveToDialog } from '../../page/MoveTo.tsx';
import { openRenamePopover } from '../../page/RenamePopover.tsx';
import { createDatabaseIn } from '../../database/createDatabase.ts';
import { getLocale, t } from '../i18n.ts';
import {
  DEFAULT_LIMIT, MAX_TABS, SECTION_LIMITS, findSection, findShortcut, layoutOf, newSectionId, setActiveTabId, updateLayout,
  useSidebarMode, type SectionType, type SidebarLayout, type SidebarSection, type SidebarTab,
} from './model.ts';
import { openNewPageDestinationPicker } from './newPagePreview.tsx';
import { tabName } from './labels.ts';
import { openCreateTeamspaceDialog, openTeamspaceSettings, leaveTeamspace, openTeamspaceAddMembers, duplicateTeamspace, canTurnIntoTeamspace, turnIntoTeamspace } from '../teamspaces.tsx';
import { openCreateWorkspaceDialog, openJoinOrCreateWorkspaceDialog } from './WorkspaceDialogs.tsx';
import { canCreateTeamspace, policyTooltip } from '../../settings/spaceSettings.ts';
import { litPresets, presetById, presetConfig, presetTab, workspaceSidebarPresets, type SidebarPreset } from '../../settings/sidebarPresets.ts';
import { confirmDialog } from '../../page/confirm.tsx';
import { canTurnIntoWiki, isWikiPage, turnIntoWiki, undoWiki } from '../../page/wiki.tsx';

const me = () => useSession.getState().userId ?? '';

/** Menu items close every overlay after onSelect — open follow-up dialogs/popovers on the next tick. */
const defer = (fn: () => void) => () => {
  setTimeout(fn, 0);
};

/** Hover-revealed buttons disappear once the menu backdrop covers them: anchor menus to a rect snapshot. */
export function snap(anchor: Anchor): Anchor {
  return anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
}


export function markOpen(anchor: Anchor): () => void {
  if (!(anchor instanceof HTMLElement)) return () => undefined;
  anchor.setAttribute('aria-expanded', 'true');
  return () => anchor.setAttribute('aria-expanded', 'false');
}


function shifted(anchor: Anchor, dx: number): Anchor {
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor instanceof DOMRect ? anchor : new DOMRect(anchor.x, anchor.y, anchor.width ?? 0, anchor.height ?? 0);
  return new DOMRect(r.x + dx, r.y, r.width, r.height);
}

export function formatEditedTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const locale = getLocale();
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return t('lp.shell.today_at', 'Today at {time}', { time });
  if (new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()) return t('lp.shell.yesterday_at', 'Yesterday at {time}', { time });
  return `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}, ${time}`;
}

function LastEditedFooter({ block }: { block: BlockRecord }) {
  const user = records.get('lit_user', block.last_edited_by_id) as { name?: string; email?: string; profile_photo?: string } | undefined;
  const name = user?.name || user?.email || t('lp.shell.unknown', 'Unknown');
  return (
    <div className="nc-sb-menu-footer">
      <div className="nc-sb-menu-footer-title">{t('lp.shell.last_edited', 'Last edited')}</div>
      <div className="nc-sb-menu-footer-user">
        <span className="nc-sb-menu-avatar">{user?.profile_photo ? <img src={user.profile_photo} alt="" /> : name.slice(0, 1).toUpperCase()}</span>
        <span className="nc-sb-menu-footer-name nc-ellipsis">{name}</span>
      </div>
      <div className="nc-sb-menu-footer-time">{formatEditedTime(block.last_edited_time)}</div>
    </div>
  );
}


export function openPageRowMenu(pageId: string, anchor: Anchor, _onRename?: () => void, opts?: { inFavorites?: boolean; rowEl?: HTMLElement | null }) {
  const block = getBlock(pageId);
  if (!block) return;
  const fav = isFavorite(pageId);
  const rowEl = opts?.rowEl ?? (anchor instanceof HTMLElement ? (anchor.closest('.nc-sb-item') as HTMLElement | null) : null);
  const rename = () => {
    const el = rowEl ?? (document.querySelector(`.nc-sb-page[data-block-id="${pageId}"] .nc-sb-item`) as HTMLElement | null);
    if (el) openRenamePopover(pageId, el);
  };
  const favoriteItem: MenuItemDef = fav
    ? { label: t('lp.shell.remove_from_favorites', 'Remove from saved pages'), icon: 'starSlash', onSelect: () => toggleFavorite(pageId) }
    : { label: t('lp.shell.add_to_favorites', 'Save this page'), icon: 'star', onSelect: () => toggleFavorite(pageId) };
  const editItems: MenuItemDef[] = opts?.inFavorites
    ? [
        { label: t('lp.shell.copy_link', 'Copy link'), icon: 'link', onSelect: () => copyPageLink(pageId) },
        { label: t('lp.shell.rename', 'Rename'), icon: 'compose', shortcut: '⌘⇧R', onSelect: defer(rename) },
        { label: t('lp.shell.move_to', 'Move to'), icon: 'arrowTurnUpRight', shortcut: '⌘⇧P', onSelect: defer(() => openMoveToDialog([pageId], rowEl ?? snap(anchor))) },
      ]
    : [
        { label: t('lp.shell.copy_link', 'Copy link'), icon: 'link', onSelect: () => copyPageLink(pageId) },
        { label: t('lp.shell.duplicate', 'Duplicate'), icon: 'duplicate', shortcut: '⌘D', onSelect: () => void duplicatePage(pageId) },
        { label: t('lp.shell.rename', 'Rename'), icon: 'compose', shortcut: '⌘⇧R', onSelect: defer(rename) },
        { label: t('lp.shell.move_to', 'Move to'), icon: 'arrowTurnUpRight', shortcut: '⌘⇧P', onSelect: defer(() => openMoveToDialog([pageId], rowEl ?? snap(anchor))) },
        { label: t('lp.shell.send_to_trash', 'Send to Trash'), icon: 'trash', onSelect: () => trashPage(pageId) },
      ];
  const def: MenuDef = {
    width: 265,
    sections: [
      { title: t('lp.shell.page', 'Page'), items: [favoriteItem] },
      { items: editItems },
      {
        items: [
          
          ...(isWikiPage(block)
            ? [{ label: t('lp.shell.undo_wiki', 'Undo wiki'), icon: 'arrowSquarePathUpDown', disabled: records.role('block', pageId) !== 'editor', onSelect: defer(() => void undoWiki(pageId)) }]
            : block.type === 'page' && block.parent_table !== 'collection'
              ? [{ label: t('lp.shell.change_to_wiki', 'Change to wiki'), icon: 'arrowSquarePathUpDown', disabled: !canTurnIntoWiki(block), onSelect: () => void turnIntoWiki(pageId) }]
              : []),
          ...(!opts?.inFavorites && canTurnIntoTeamspace(pageId) ? [{ label: t('lp.shell.change_to_team_172a', 'Change to team'), icon: 'teamspace', onSelect: defer(() => void turnIntoTeamspace(pageId)) }] : []),
        ],
      },
      {
        items: [
          { label: t('lp.shell.open_in_a_new_tab', 'Open in a new tab'), icon: 'arrowDiagonalUpRight', shortcut: '⌘⇧↵', onSelect: () => window.open(pageUrl(pageId), '_blank') },
          { label: t('lp.shell.show_in_side_preview', 'Show in side preview'), icon: 'peekSide', shortcut: '⌥Click', onSelect: () => openPeek(pageId, 'side_peek') },
        ],
      },
    ],
    footer: <LastEditedFooter block={block} />,
  };
  openMenu(snap(anchor), def, { placement: anchor instanceof HTMLElement ? 'right-start' : 'bottom-start' });
}

/** Kept for API compatibility (inline rename commits). */
export function startInlineRename(pageId: string, title: string) {
  run('renamePage', (tx) => setTitle(tx, pageId, title ? [[title]] : []));
}

// ---------------- section menus ----------------
function moveToTabSubmenu(layout: SidebarLayout, currentTabId: string, onMove: (tabId: string | 'new') => void): MenuDef {
  return {
    width: 220,
    sections: [
      { items: layout.tabs.map((tab) => ({ label: tabName(tab), checked: tab.id === currentTabId, onSelect: () => (tab.id === currentTabId ? undefined : onMove(tab.id)) })) },
      { items: [{ label: t('lp.shell.new_tab', 'New tab'), icon: 'plus', disabled: layout.tabs.length >= MAX_TABS, onSelect: () => onMove('new') }] },
    ],
  };
}

function moveItemToTab(kind: 'section' | 'shortcut', itemId: string, target: string | 'new') {
  let targetName = '';
  updateLayout((l) => {
    const loc = kind === 'section' ? findSection(l, itemId) : findShortcut(l, itemId);
    if (!loc) return;
    const list = kind === 'section' ? loc.tab.sections : loc.tab.shortcuts;
    const [item] = list.splice(loc.index, 1);
    let tab = l.tabs.find((x) => x.id === target);
    if (target === 'new' || !tab) {
      tab = { id: `tab-${Date.now().toString(36)}`, icon: 'custom', shortcuts: [], sections: [] };
      l.tabs.push(tab);
    }
    if (kind === 'section') tab.sections.push(item as SidebarSection);
    else tab.shortcuts.push(item as any);
    targetName = tabName(tab);
  });
  useUI.getState().toast(
    kind === 'section'
      ? t('lp.shell.section_moved_to', 'Section moved to {tabName}', { tabName: targetName })
      : t('lp.shell.shortcut_moved_to', 'Shortcut moved to {tabName}', { tabName: targetName }),
  );
}

export function openSectionMenu(sectionId: string, anchor: Anchor) {
  const layout = layoutOf(currentSpaceView());
  const loc = findSection(layout, sectionId);
  if (!loc) return;
  const sec = loc.tab.sections[loc.index];
  const count = loc.tab.sections.length;
  const limit = sec.limit ?? DEFAULT_LIMIT[sec.type] ?? 5;
  const sortable: SectionType[] = ['shared', 'private'];
  const top: MenuItemDef[] = [];
  if (sortable.includes(sec.type)) {
    const sort = sec.sort ?? 'manual';
    top.push({
      label: t('lp.shell.sort', 'Sort'), icon: 'arrowUpDown',
      right: <span className="nc-menu-value">{sort === 'manual' ? t('lp.shell.manual', 'Manual') : t('lp.shell.last_edited', 'Last edited')}</span>,
      submenu: () => ({
        width: 220,
        sections: [{
          items: (['manual', 'last_edited'] as const).map((s) => ({
            label: s === 'manual' ? t('lp.shell.manual', 'Manual') : t('lp.shell.last_edited', 'Last edited'),
            checked: sort === s,
            onSelect: () => updateLayout((l) => { const f = findSection(l, sectionId); if (f) f.tab.sections[f.index].sort = s; }),
          })),
        }],
      }),
    });
  }
  {
    top.push({
      label: t('lp.shell.show', 'Show'), icon: 'number',
      right: <span className="nc-menu-value">{limit}</span>,
      submenu: () => ({
        width: 220,
        sections: [{
          items: SECTION_LIMITS.map((n) => ({
            label: t('lp.shell.items', '{limit} items', { limit: n }),
            checked: limit === n,
            onSelect: () => updateLayout((l) => { const f = findSection(l, sectionId); if (f) f.tab.sections[f.index].limit = n; }),
          })),
        }],
      }),
    });
  }
  if (sec.type === 'teamspaces') {
    
    const allowed = canCreateTeamspace(records.get<SpaceRecord>('space', useSession.getState().spaceId), useSession.getState().userId);
    const label = t('lp.shell.new_team', 'New team');
    top.push({ label: allowed ? label : <span data-tooltip={policyTooltip.createTeamspace()}>{label}</span>, text: label, icon: 'plus', disabled: !allowed, onSelect: defer(() => openCreateTeamspaceDialog()) });
  }
  if (sec.type === 'chats') top.push({ label: t('lp.shell.mark_all_as_read', 'Clear all unread'), icon: 'checkmark', onSelect: () => undefined });

  const arrange: MenuItemDef[] = [];
  if (loc.index > 0) arrange.push({ label: t('lp.shell.move_up', 'Move up'), icon: 'arrowStraightUp', onSelect: () => moveSection(sectionId, -1) });
  if (loc.index < count - 1) arrange.push({ label: t('lp.shell.move_down', 'Move down'), icon: 'arrowStraightDown', onSelect: () => moveSection(sectionId, 1) });
  arrange.push({ label: t('lp.shell.move_to_a_tab', 'Move to a tab'), icon: 'arrowTurnUpRight', submenu: () => moveToTabSubmenu(layout, loc.tab.id, (target) => moveItemToTab('section', sectionId, target)) });
  arrange.push({ label: t('lp.shell.remove_section', 'Remove section'), icon: 'xMark', onSelect: () => removeSection(sectionId) });
  const def: MenuDef = {
    width: 220,
    sections: [
      ...(top.length ? [{ items: top }] : []),
      { items: arrange },
      { items: [{ label: t('lp.shell.customize_sidebar', 'Customize sidebar'), icon: 'sliders', onSelect: () => useSidebarMode.getState().set(true) }] },
    ],
  };
  openMenu(snap(anchor), def, { placement: 'right-start' });
}

export function moveSection(sectionId: string, delta: number) {
  updateLayout((l) => {
    const f = findSection(l, sectionId);
    if (!f) return;
    const arr = f.tab.sections;
    const j = f.index + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[f.index], arr[j]] = [arr[j], arr[f.index]];
  });
}

export function removeSection(sectionId: string) {
  updateLayout((l) => {
    const f = findSection(l, sectionId);
    if (f) f.tab.sections.splice(f.index, 1);
  });
}

export function moveShortcut(shortcutId: string, delta: number) {
  updateLayout((l) => {
    const f = findShortcut(l, shortcutId);
    if (!f) return;
    const arr = f.tab.shortcuts;
    const j = f.index + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[f.index], arr[j]] = [arr[j], arr[f.index]];
  });
}

export function removeShortcut(shortcutId: string) {
  updateLayout((l) => {
    const f = findShortcut(l, shortcutId);
    if (f) f.tab.shortcuts.splice(f.index, 1);
  });
}

export function openShortcutMenu(shortcutId: string, anchor: Anchor) {
  const layout = layoutOf(currentSpaceView());
  const loc = findShortcut(layout, shortcutId);
  if (!loc) return;
  const items: MenuItemDef[] = [];
  if (loc.index > 0) items.push({ label: t('lp.shell.move_up', 'Move up'), icon: 'arrowStraightUp', onSelect: () => moveShortcut(shortcutId, -1) });
  if (loc.index < loc.tab.shortcuts.length - 1) items.push({ label: t('lp.shell.move_down', 'Move down'), icon: 'arrowStraightDown', onSelect: () => moveShortcut(shortcutId, 1) });
  items.push({ label: t('lp.shell.move_to_a_tab', 'Move to a tab'), icon: 'arrowTurnUpRight', submenu: () => moveToTabSubmenu(layout, loc.tab.id, (target) => moveItemToTab('shortcut', shortcutId, target)) });
  
  if (loc.tab.shortcuts[loc.index]?.type === 'new_page') {
    // opened after this menu closes (selecting an item closes every open overlay)
    items.push({ label: t('lp.shell.create_page_in', 'Create page in…'), icon: 'arrowTurnUpRight', onSelect: () => { const at = snap(anchor); setTimeout(() => openNewPageDestinationPicker(shortcutId, at), 0); } });
  }
  items.push({ label: t('lp.shell.remove_shortcut', 'Remove shortcut'), icon: 'xMark', onSelect: () => removeShortcut(shortcutId) });
  openMenu(snap(anchor), {
    width: 240,
    sections: [{ items }, { items: [{ label: t('lp.shell.customize_sidebar', 'Customize sidebar'), icon: 'sliders', onSelect: () => useSidebarMode.getState().set(true) }] }],
  }, { placement: 'right-start' });
}

// ---------------- tab menu (click on the active tab) ----------------
export function openTabMenu(tabId: string, anchor: Anchor, onRename: () => void) {
  const layout = layoutOf(currentSpaceView());
  openMenu(anchor, {
    width: 240,
    sections: [
      {
        items: [
          { label: t('lp.shell.rename', 'Rename'), icon: 'pencilLine', onSelect: onRename },
          resetTabItem(tabId),
          { label: t('lp.shell.delete_tab', 'Delete tab'), icon: 'trash', disabled: layout.tabs.length <= 1, onSelect: () => void confirmDeleteTab(tabId) },
        ],
      },
      {
        items: [
          layout.hideTabNames
            ? { label: t('lp.shell.show_tab_labels', 'Show tab labels'), icon: 'eye', onSelect: () => updateLayout((l) => { l.hideTabNames = false; }) }
            : { label: t('lp.shell.hide_tab_labels', 'Hide tab labels'), icon: 'eyeSlash', onSelect: () => updateLayout((l) => { l.hideTabNames = true; }) },
          { label: t('lp.shell.customize_sidebar', 'Customize sidebar'), icon: 'sliders', onSelect: () => useSidebarMode.getState().set(true) },
        ],
      },
    ],
  }, { placement: 'bottom-start' });
}

export function deleteTab(tabId: string) {
  const layout = layoutOf(currentSpaceView());
  const tab = layout.tabs.find((x) => x.id === tabId);
  if (!tab || layout.tabs.length <= 1) return;
  const name = tabName(tab);
  updateLayout((l) => {
    l.tabs = l.tabs.filter((x) => x.id !== tabId);
  });
  setActiveTabId(layout.tabs.find((x) => x.id !== tabId)!.id);
  useUI.getState().toast(t('lp.shell.tab_deleted', '“{tabName}” tab deleted', { tabName: name }));
}


export function addTab(anchor?: Anchor) {
  const layout = layoutOf(currentSpaceView());
  if (layout.tabs.length >= MAX_TABS) {
    useUI.getState().toast(t('lp.shell.you_ve_reached_the_sidebar_tab', 'You’ve reached the sidebar tab limit (6)'));
    return;
  }
  const space = records.get<SpaceRecord>('space', useSession.getState().spaceId);
  const ws = workspaceSidebarPresets(space);
  const custom = [...ws.optional, ...ws.default].filter((p, i, arr) => !p.litpage && arr.findIndex((x) => x.id === p.id) === i);
  if (!anchor) return addTabFrom(null);
  const presetItem = (p: SidebarPreset) => ({
    label: p.name || tabName({ id: p.id.replace(/^litpage:/, ''), icon: p.icon, shortcuts: [], sections: [] }),
    icon: p.icon === 'chat' ? 'chatBubble' : p.icon === 'meetings' ? 'meetings' : p.icon === 'home' ? 'home' : 'squareGrid2X2',
    onSelect: () => addTabFrom(p),
  });
  openMenu(anchor, {
    width: 260,
    search: t('lp.shell.search_presets', 'Search presets…'),
    sections: [
      { items: [{ label: t('lp.shell.blank_tab', 'Blank tab'), icon: 'plus', onSelect: () => addTabFrom(null) }] },
      { title: t('lp.shell.litpage_presets', 'Litpage presets'), items: litPresets().map(presetItem) },
      ...(custom.length ? [{ title: t('lp.shell.workspace_presets', 'Workspace presets'), items: custom.map(presetItem) }] : []),
    ],
  }, { placement: 'bottom-start' });
}

function addTabFrom(p: SidebarPreset | null) {
  const id = `tab-${Date.now().toString(36)}`;
  const tab: SidebarTab = p
    ? { ...presetTab(p), id, presetId: p.id }
    : { id, icon: 'custom', shortcuts: [], sections: [{ id: newSectionId(), type: 'recents', limit: 5 }] };
  updateLayout((l) => {
    l.tabs.push(tab);
  });
  setActiveTabId(id);
  if (p) useUI.getState().toast(t('lp.shell.tab_added', '{tabName} tab added', { tabName: tabName(tab) }));
}

/** Preset a tab came from: its presetId, or the built-in Home / Chat / Meetings tabs by id. */
function presetOfTab(tab: SidebarTab): SidebarPreset | null {
  const space = records.get<SpaceRecord>('space', useSession.getState().spaceId);
  const cfg = presetConfig(space);
  const id = tab.presetId ?? (['home', 'chat', 'meetings'].includes(tab.id) ? `litpage:${tab.id}` : null);
  return id ? presetById(cfg, id) ?? null : null;
}

function resetTabItem(tabId: string): MenuItemDef {
  const tab = layoutOf(currentSpaceView()).tabs.find((x) => x.id === tabId);
  const preset = tab ? presetOfTab(tab) : null;
  return {
    label: t('lp.shell.reset_tab', 'Reset tab'), icon: 'undo',
    description: preset ? t('lp.shell.reapply_the_preset_to_this_tab', 'Reapply the {presetName} preset to this tab', { presetName: preset.name || tabName(tab!) }) : undefined,
    onSelect: () => updateLayout((l) => {
      const tb = l.tabs.find((x) => x.id === tabId);
      if (!tb) return;
      if (preset) {
        const fresh = presetTab(preset);
        tb.shortcuts = fresh.shortcuts;
        tb.sections = fresh.sections;
        tb.icon = fresh.icon;
      } else {
        tb.shortcuts = [];
        tb.sections = [{ id: newSectionId(), type: 'recents', limit: 5 }];
      }
    }),
  };
}

async function confirmDeleteTab(tabId: string) {
  const tab = layoutOf(currentSpaceView()).tabs.find((x) => x.id === tabId);
  if (!tab) return;
  const sc = tab.shortcuts.length;
  const se = tab.sections.length;
  if (sc + se > 0) {
    const desc = sc && se
      ? t('lp.shell.deleting_this_tab_also_deletes_shortcutc', 'Deleting this tab also deletes {shortcutCount, plural, one {# shortcut} other {# shortcuts}} and {sectionCount, plural, one {# section} other {# sections}}.', { shortcutCount: sc, sectionCount: se })
      : sc
        ? t('lp.shell.deleting_this_tab_also_deletes_shortcutc_9a9c', 'Deleting this tab also deletes {shortcutCount, plural, one {# shortcut} other {# shortcuts}}.', { shortcutCount: sc })
        : t('lp.shell.deleting_this_tab_also_deletes_sectionco', 'Deleting this tab also deletes {sectionCount, plural, one {# section} other {# sections}}.', { sectionCount: se });
    const ok = await confirmDialog({ message: t('lp.shell.delete_tab_61f5', 'Delete “{tabName}” tab?', { tabName: tabName(tab) }), description: desc, confirmLabel: t('lp.shell.delete_tab', 'Delete tab') });
    if (!ok) return;
  }
  deleteTab(tabId);
}

// ---------------- header "New…" menu ----------------
export function createPrivateDatabase() {
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  if (!sv) return;
  let blockId = '';
  run('createDatabase', (tx) => {
    const res = createDatabaseIn(tx, { parentId: sv.space_id, parentTable: 'space', inline: false, viewType: 'table', list: { table: 'space_view', id: sv.id, path: ['private_pages'] } });
    blockId = res.blockId;
    tx.update('block', blockId, [], { permissions: [{ type: 'user_permission', role: 'editor', user_id: me() }] });
  });
  if (blockId) navigate(pageUrl(blockId));
}

export function createMeetingNote() {
  
  void import('../../meetings/entry.ts').then((m) => m.createMeetingNoteFlow());
}

export function openNewMenu(anchor: Anchor) {
  const { spaceId } = useSession.getState();
  const domain = spaceDomain(spaceId);
  
  const settings = (records.get<SpaceRecord>('space', spaceId)?.settings ?? {}) as Record<string, unknown>;
  
  openMenu(shifted(anchor, -6), {
    width: 180,
    sections: [{
      items: [
        { label: t('lp.shell.page', 'Page'), icon: 'pageEmpty', onSelect: () => newPage({ kind: 'private' }) },
        ...(settings.ai_enabled !== false ? [{ label: t('lp.shell.chat', 'Chat'), icon: 'chatBubble', onSelect: () => navigate(`/${domain}/chat`) }] : []),
        ...(settings.meeting_notes_enabled !== false ? [{ label: t('lp.shell.ai_meeting_notes', 'AI meeting notes'), icon: 'microphone', onSelect: createMeetingNote }] : []),
        { label: t('lp.shell.database', 'Database'), icon: 'viewTable', onSelect: createPrivateDatabase },
      ],
    }],
  }, { placement: 'bottom-start', offset: 4, onClose: markOpen(anchor) });
}

// ---------------- footer menus ----------------
export function openAppsMenu(anchor: Anchor) {
  const domain = spaceDomain(useSession.getState().spaceId);
  
  openMenu(shifted(anchor, -8), {
    width: 240,
    sections: [{
      items: [
        { label: t('lp.shell.library', 'Library'), icon: 'bookshelf', onSelect: () => navigate(`/${domain}/library`) },
        { label: t('lp.shell.ai_meeting_notes', 'AI meeting notes'), icon: 'libPaperMic', onSelect: () => navigate(`/${domain}/library/meetings`) },
        { label: t('lp.shell.skills', 'Skills'), icon: 'libPaperSkill', onSelect: () => navigate(`/${domain}/library/skills`) },
        { label: t('lp.shell.my_tasks', 'My Tasks'), icon: 'checkmarkSquare', onSelect: () => openMyTasks() },
        { label: t('lp.shell.marketplace', 'Marketplace'), icon: 'templates', onSelect: () => navigate(`/${domain}/marketplace`) },
        { label: t('lp.shell.trash', 'Trash'), icon: 'trash', onSelect: () => useUI.getState().set({ trashOpen: true }) },
      ],
    }],
  }, { placement: 'top-start', offset: 6, onClose: markOpen(anchor) });
}


export function openMyTasks() {
  navigate(`/${spaceDomain(useSession.getState().spaceId)}/tasks`);
}

export const RELEASES: { label: string; date: string; url: string }[] = HELP_URL ? [
  { label: 'Agents, rebuilt to do more for less', date: '2026-10-19', url: HELP_URL },
  { label: 'Litpage 3.8', date: '2026-10-13', url: HELP_URL },
  { label: 'Litpage 3.7', date: '2026-09-15', url: HELP_URL },
] : [];

export const APP_VERSION = 'Litpage 0.1.0';


const SEEN_KEY = 'nc:whatsNewSeen';
const latestRelease = () => RELEASES[0]?.date ?? '';
function readSeen(): string {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    if (v) return v;
    localStorage.setItem(SEEN_KEY, latestRelease());
  } catch {
    /* storage unavailable */
  }
  return latestRelease();
}
export const useWhatsNew = create<{ seen: string; markSeen: () => void }>((set) => ({
  seen: readSeen(),
  markSeen: () => {
    try {
      localStorage.setItem(SEEN_KEY, latestRelease());
    } catch {
      /* storage unavailable */
    }
    set({ seen: latestRelease() });
  },
}));
export const useHasUnseenRelease = () => useWhatsNew((s) => s.seen < latestRelease());

export function openHelpMenu(anchor: Anchor) {
  const seen = useWhatsNew.getState().seen;
  const menu: MenuDef = {
    width: 260,
    initialActive: -1, 
    className: 'nc-sb-help-menu',
    sections: [
      {
        items: [
          ...(HELP_URL ? [
            { label: t('lp.shell.documentation', 'Documentation'), icon: 'book', onSelect: () => window.open(HELP_URL!, '_blank') },
            { label: t('lp.shell.chat_with_a_litpage_expert', 'Chat with a Litpage expert'), icon: 'phone', onSelect: () => window.open(HELP_URL!, '_blank') },
            { label: t('lp.shell.get_support', 'Get support'), icon: 'bubbleRight', onSelect: () => window.open(HELP_URL!, '_blank') },
            { label: t('lp.shell.contact_sales', 'Contact sales'), icon: 'personCircle', onSelect: () => window.open(HELP_URL!, '_blank') },
          ] : []),
          { label: t('lp.shell.more_4bab', 'More'), icon: 'ellipsis', submenu: () => helpMoreMenu() },
        ],
      },
      {
        title: t('lp.shell.what_s_new', 'What’s new?'),
        items: [
          ...RELEASES.map((r) => {
            const isNew = r.date > seen;
            return {
              label: isNew ? <span className="nc-sb-release"><span className="nc-sb-new-badge">{t('lp.shell.new_6403', 'New')}</span>{r.label}</span> : r.label,
              text: r.label,
              // sh-help-menu.html: 6px dot (graIcoSec, blue when unseen) on a 2px × 30px graBacTer line, rows 31px
              icon: <span className="nc-sb-timeline"><span className="line" /><span className={`dot ${isNew ? 'blue' : ''}`} /></span>,
              onSelect: () => window.open(r.url, '_blank'),
            };
          }),
          ...(HELP_URL ? [{ label: t('lp.shell.see_all_releases', 'See all releases'), icon: <span className="nc-sb-releases-icon"><Icon name="boxOpenSparkle" size={16} /></span>, onSelect: () => window.open(HELP_URL!, '_blank') }] : []),
        ],
      },
    ],
  };
  useWhatsNew.getState().markSeen();
  
  openMenu(anchor, menu, { placement: 'top-start', offset: 0, onClose: markOpen(anchor) });
}

function helpMoreMenu(): MenuDef {
  return {
    width: 207,
    sections: [
      {
        items: [
          { label: t('lp.shell.keyboard_shortcuts', 'Keyboard shortcuts'), shortcut: '⌘⌥/', onSelect: () => useUI.getState().set({ shortcutsOpen: true }) },
          { label: t('lp.shell.x_formerly_twitter', 'X, formerly Twitter'), onSelect: () => window.open('https://x.com/LitHQ', '_blank') },
          ...(HELP_URL ? [{ label: t('lp.shell.terms_privacy', 'Terms & privacy'), onSelect: () => window.open(HELP_URL!, '_blank') }] : []),
          { label: t('lp.shell.status', 'Status'), onSelect: () => window.open('https://www.lit-status.com', '_blank') },
          { label: t('lp.shell.local_backups', 'Local backups'), onSelect: () => useUI.getState().toast(t('lp.shell.local_backups_are_only_available_in', 'Local backups are only available in the desktop app')) },
          {
            label: t('lp.shell.empty_page_cache', 'Empty page cache'),
            onSelect: () => {
              try {
                for (const k of Object.keys(localStorage)) if (k.startsWith('nc:lastPage') || k.startsWith('nc:sb:expanded')) localStorage.removeItem(k);
              } catch {
                /* ignore */
              }
              location.reload();
            },
          },
        ],
      },
    ],
    footer: <div className="nc-sb-version">{APP_VERSION}<br />{t('lp.shell.updated_just_now', 'Updated just now')}</div>,
  };
}

// ---------------- workspace switcher ----------------
export function memberCount(space: SpaceRecord | undefined): number {
  return space?.permissions?.filter((p) => p.type === 'user_permission' && p.role !== 'none').length ?? 1;
}

export function planLabel(space: SpaceRecord | undefined): string {
  switch (space?.plan_type) {
    case 'free':
      return t('lp.shell.free_plan', 'Free Plan');
    case 'business':
      return t('lp.shell.business_plan', 'Business Plan');
    case 'enterprise':
      return t('lp.shell.enterprise_plan', 'Enterprise Plan');
    default:
      return t('lp.shell.plus_plan', 'Plus Plan');
  }
}

export function userSpaces(): { view: SpaceViewRecord; space: SpaceRecord }[] {
  const root = records.get<UserRootRecord>('user_root', useSession.getState().userId);
  return (root?.space_views ?? [])
    .map((id) => records.get<SpaceViewRecord>('space_view', id))
    .filter((v): v is SpaceViewRecord => !!v && v.alive !== false)
    .map((view) => ({ view, space: records.get<SpaceRecord>('space', view.space_id)! }))
    .filter((x) => !!x.space);
}

export function switchWorkspace(spaceId: string) {
  const s = records.get<SpaceRecord>('space', spaceId);
  useSession.getState().setSpace(spaceId);
  navigate(`/${s?.domain ?? ''}`);
}

export function openAccountOptionsMenu(anchor: Anchor) {
  openMenu(anchor, {
    width: 254,
    sections: [{
      items: [
        { label: t('lp.shell.hide_suggested_workspaces', 'Hide suggested workspaces'), icon: 'xMarkCircleSmall', onSelect: () => undefined },
        { label: t('lp.shell.start_or_join_a_workspace', 'Start or join a workspace'), icon: 'plus', onSelect: defer(() => openJoinOrCreateWorkspaceDialog()) },
        { label: t('lp.shell.log_out', 'Log out'), icon: 'arrowRightFromRectangle', onSelect: () => void useSession.getState().logout() },
      ],
    }],
  }, { placement: 'right-start', backdrop: 'transparent' });
}

// ---------------- teamspace row ••• ----------------
export function openTeamspaceMenu(team: TeamRecord, anchor: Anchor) {
  const uid = me();
  const space = records.get<SpaceRecord>('space', team.space_id);
  const members = team.membership?.length ?? 0;
  const isDefault = !!space?.default_team_ids?.includes(team.id);
  const canLeave = members > 1 && !isDefault && team.membership?.some((m) => m.user_id === uid);
  openMenu(snap(anchor), {
    width: 282,
    sections: [
      { items: [{ label: t('lp.shell.add_members', 'Add members'), icon: 'inviteMember', onSelect: defer(() => openTeamspaceAddMembers(team.id)) }] },
      {
        items: [
          { label: t('lp.shell.team_settings', 'Team settings'), icon: 'gear', onSelect: defer(() => openTeamspaceSettings(team.id)) },
          {
            label: t('lp.shell.duplicate_team', 'Duplicate team'), icon: 'duplicate',
            description: t('lp.shell.copies_over_settings_like_permissions_le', 'Copies over settings like permissions, leaving out pages and members'),
            onSelect: () => duplicateTeamspace(team.id),
          },
          { label: t('lp.shell.leave_team', 'Leave team'), icon: 'handWave', disabled: !canLeave, onSelect: () => leaveTeamspace(team.id) },
        ],
      },
    ],
  }, { placement: 'right-start' });
}

export function pageTitleOrUntitled(id: string): ReactNode {
  return pageTitle(getBlock(id)) || t('lp.shell.untitled', 'Untitled');
}
