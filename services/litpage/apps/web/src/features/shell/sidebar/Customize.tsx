
// divider, "Add section", "Add tab" (+ in the tab strip) and the blue "Done" button.
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { openMenu, type MenuDef, type MenuItemDef } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { api } from '../../../lib/api.ts';
import { t } from '../i18n.ts';
import { pageTitle } from '../../page/pageActions.ts';
import { PageIcon } from '../PageIcon.tsx';
import {
  getActiveTabId, newSectionId, newShortcutId, updateLayout, useSidebarMode, type SectionType, type ShortcutType, type SidebarSection, type SidebarShortcut, type SidebarTab,
} from './model.ts';
import { SECTION_ICON, SHORTCUT_ICON, sectionLabel, shortcutLabel } from './labels.ts';
import { newPageShortcutLabel } from './newPagePreview.tsx';
import { openSectionMenu, openShortcutMenu, removeSection, removeShortcut } from './menus.tsx';

const MAX_SHORTCUTS = 25;
const MAX_SECTIONS = 25;

function shortcutText(s: SidebarShortcut): string {
  if (s.type === 'page' && s.pageId) return pageTitle(records.get('block', s.pageId)) || t('lp.shell.untitled', 'Untitled');
  if (s.type === 'new_page') return newPageShortcutLabel(s);
  return shortcutLabel(s.type);
}

function sectionText(s: SidebarSection): string {
  if (s.type === 'teamspace' && s.teamId) return records.get<TeamRecord>('team', s.teamId)?.name ?? sectionLabel(s.type);
  return sectionLabel(s.type);
}

function reorder<T extends { id: string }>(list: T[], fromId: string, toId: string, after: boolean): T[] {
  const arr = [...list];
  const from = arr.findIndex((x) => x.id === fromId);
  if (from < 0) return arr;
  const [item] = arr.splice(from, 1);
  let to = arr.findIndex((x) => x.id === toId);
  if (to < 0) return list;
  if (after) to += 1;
  arr.splice(to, 0, item);
  return arr;
}

export function CustomizeTabBody({ tab }: { tab: SidebarTab }) {
  const [drag, setDrag] = useState<{ kind: 'shortcut' | 'section'; id: string } | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  const rowDnD = (kind: 'shortcut' | 'section', id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-nc-sidebar-item', id);
      setDrag({ kind, id });
    },
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!drag || drag.kind !== kind || drag.id === id) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (over?.id !== id || over.after !== after) setOver({ id, after });
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (!drag || !over) return;
      updateLayout((l) => {
        const tb = l.tabs.find((x) => x.id === tab.id);
        if (!tb) return;
        if (kind === 'shortcut') tb.shortcuts = reorder(tb.shortcuts, drag.id, over.id, over.after);
        else tb.sections = reorder(tb.sections, drag.id, over.id, over.after);
      });
      setDrag(null);
      setOver(null);
    },
  });

  const indicator = (id: string) => (over?.id === id ? (over.after ? 'drop-after' : 'drop-before') : '');

  return (
    <div className="nc-sb-customize">
      <div className="nc-sb-shortcuts">
        {tab.shortcuts.map((s) => (
          <div key={s.id} className={`nc-sb-cust-row ${indicator(s.id)}`} {...rowDnD('shortcut', s.id)}>
            <div className="nc-sb-cust-handle"><Icon name="dragHandleFillSmall" size={16} /></div>
            <div className="nc-sb-row-icon">
              {s.type === 'page' && s.pageId ? <PageIcon block={records.get('block', s.pageId)} size={20} /> : <Icon name={SHORTCUT_ICON[s.type]} size={22} />}
            </div>
            <div className="nc-sb-row-label nc-ellipsis">{shortcutText(s)}</div>
            <div className="nc-sb-cust-actions">
              <div role="button" aria-label={t('lp.shell.open_the_shortcut_menu', 'Open the shortcut menu')} className="nc-sb-mini-btn" onClick={(e) => openShortcutMenu(s.id, e.currentTarget as HTMLElement)}>
                <Icon name="slidersSmall" size={16} />
              </div>
              <div role="button" aria-label={t('lp.shell.remove_from_sidebar', 'Hide from sidebar')} className="nc-sb-mini-btn" onClick={() => removeShortcut(s.id)}>
                <Icon name="xMarkSmall" size={16} />
              </div>
            </div>
          </div>
        ))}
        <div role="button" className="nc-sb-cust-add" onClick={(e) => openAddShortcutMenu(tab, e.currentTarget as HTMLElement)}>
          <Icon name="plusSmall" size={16} />
          <span>{t('lp.shell.add_shortcut', 'Add shortcut')}</span>
        </div>
      </div>
      <div className="nc-sb-cust-divider" />
      <div className="nc-sb-cust-sections">
        {tab.sections.map((s) => (
          <div key={s.id} className={`nc-sb-cust-row ${indicator(s.id)}`} {...rowDnD('section', s.id)}>
            <div className="nc-sb-cust-handle"><Icon name="dragHandleFillSmall" size={16} /></div>
            <div className="nc-sb-row-icon"><Icon name={SECTION_ICON[s.type]} size={22} /></div>
            <div className="nc-sb-row-label nc-ellipsis">{sectionText(s)}</div>
            <div className="nc-sb-cust-actions">
              <div role="button" aria-label={t('lp.shell.open_menu', 'Open menu')} className="nc-sb-mini-btn" onClick={(e) => openSectionMenu(s.id, e.currentTarget as HTMLElement)}>
                <Icon name="slidersSmall" size={16} />
              </div>
              <div role="button" aria-label={t('lp.shell.remove_from_sidebar', 'Hide from sidebar')} className="nc-sb-mini-btn" onClick={() => removeSection(s.id)}>
                <Icon name="xMarkSmall" size={16} />
              </div>
            </div>
          </div>
        ))}
        <div role="button" className="nc-sb-cust-add" onClick={(e) => openAddSectionMenu(tab, e.currentTarget as HTMLElement)}>
          <Icon name="plusSmall" size={16} />
          <span>{t('lp.shell.add_section', 'Add section')}</span>
        </div>
      </div>
    </div>
  );
}

export function DoneButton() {
  return (
    <div className="nc-sb-done-wrap">
      <button className="nc-sb-done" aria-label={t('lp.shell.done', 'Done')} onClick={() => useSidebarMode.getState().set(false)}>
        {t('lp.shell.done', 'Done')}
      </button>
    </div>
  );
}

function addShortcut(tab: SidebarTab, type: ShortcutType, pageId?: string) {
  if (tab.shortcuts.length >= MAX_SHORTCUTS) {
    useUI.getState().toast(t('lp.shell.you_ve_reached_the_limit_of', 'You’ve reached the limit of {maxShortcuts, number} shortcuts for this tab', { maxShortcuts: MAX_SHORTCUTS }));
    return;
  }
  updateLayout((l) => {
    const tb = l.tabs.find((x) => x.id === tab.id);
    tb?.shortcuts.push({ id: newShortcutId(), type, ...(pageId ? { pageId } : {}) });
  });
}

function addSection(tab: SidebarTab, type: SectionType, extra?: Partial<SidebarSection>) {
  if (tab.sections.length >= MAX_SECTIONS) {
    useUI.getState().toast(t('lp.shell.you_ve_reached_the_limit_of_c3a8', 'You’ve reached the limit of {maxSections, number} sections for this tab', { maxSections: MAX_SECTIONS }));
    return;
  }
  updateLayout((l) => {
    const tb = l.tabs.find((x) => x.id === tab.id);
    tb?.sections.push({ id: newSectionId(), type, limit: 5, ...extra });
  });
}

async function pagePickerMenu(onPick: (id: string) => void): Promise<MenuDef> {
  const spaceId = useSession.getState().spaceId;
  let ids: string[] = [];
  try {
    const res = await api('listRecentPages', { spaceId, limit: 15 });
    records.mergeRecordMap(res.recordMap);
    ids = res.pages.map((p: { id: string }) => p.id);
  } catch {
    /* ignore */
  }
  return {
    width: 260,
    search: t('lp.shell.search_pages_d09a', 'Search pages…'),
    sections: [{
      items: ids.map((id) => ({
        label: pageTitle(records.get('block', id)) || t('lp.shell.untitled', 'Untitled'),
        icon: <PageIcon block={records.get('block', id)} size={20} />,
        onSelect: () => onPick(id),
      })),
    }],
  };
}

function openAddShortcutMenu(tab: SidebarTab, anchor: HTMLElement) {
  const item = (type: ShortcutType, extra?: Partial<MenuItemDef>): MenuItemDef => ({ label: shortcutLabel(type), icon: SHORTCUT_ICON[type], onSelect: () => addShortcut(tab, type), ...extra });
  let pages: MenuDef = { sections: [] };
  void pagePickerMenu((id) => addShortcut(tab, 'page', id)).then((m) => { pages = m; });
  openMenu(anchor, {
    width: 240,
    dividers: false,
    search: t('lp.shell.search_shortcuts', 'Search shortcuts…'),
    sections: [
      {
        title: t('lp.shell.create', 'Create'),
        items: [item('new_page'), item('new_meeting_note'), item('new_database')],
      },
      {
        title: t('lp.shell.go_to', 'Go to'),
        items: [
          item('page', { onSelect: undefined, submenu: () => pages }),
          item('chat_thread'),
          item('settings'),
          item('meeting_notes'),
          item('skills'),
          item('my_tasks'),
          item('lit_calendar'),
          item('marketplace'),
        ],
      },
    ],
  }, { placement: 'right-start' });
}

function openAddSectionMenu(tab: SidebarTab, anchor: HTMLElement) {
  const teams = (records.all<TeamRecord>('team') as TeamRecord[]).filter((x) => x.space_id === useSession.getState().spaceId && x.alive !== false);
  const sec = (type: SectionType, extra?: Partial<MenuItemDef>): MenuItemDef => ({ label: sectionLabel(type), icon: SECTION_ICON[type], onSelect: () => addSection(tab, type), ...extra });
  const existing = new Set(tab.sections.map((s) => s.type));
  const builtins: SectionType[] = ['upcoming_events', 'recents', 'favorites', 'teamspaces', 'shared', 'private'].filter((x) => !existing.has(x as SectionType)) as SectionType[];
  openMenu(anchor, {
    width: 240,
    dividers: false,
    search: t('lp.shell.search_sections', 'Search sections…'),
    sections: [
      ...(builtins.length ? [{ title: t('lp.shell.sections', 'Sections'), items: builtins.map((b) => sec(b)) }] : []),
      {
        title: t('lp.shell.pages', 'Pages'),
        items: [
          sec('teamspace', {
            onSelect: undefined,
            submenu: () => ({
              width: 240,
              sections: [{ items: teams.map((team) => ({ label: team.name, icon: 'teamspace', onSelect: () => addSection(tab, 'teamspace', { teamId: team.id }) })) }],
            }),
          }),
          sec('database_view', { submenu: () => databaseViewPicker(), onSelect: undefined }),
        ],
      },
      { title: t('lp.shell.chats', 'Chats'), items: [sec('pinned_chats'), sec('chats'), sec('agents')] },
      { title: t('lp.shell.meetings', 'Meetings'), items: [sec('ai_meeting_notes')] },
      { title: t('lp.shell.apps', 'Apps'), items: [sec('lit_apps')] },
      { title: t('lp.shell.advanced', 'Advanced'), items: [sec('developer')] },
    ],
  }, { placement: 'right-start' });
}

/** "Add section › Database view": databases you can open, newest first (search). */
function databaseViewPicker(): MenuDef {
  const dbs = records.all<BlockRecord>('block')
    .filter((b) => (b.type === 'collection_view_page' || b.type === 'collection_view') && b.alive !== false && b.collection_id && records.role('block', b.id) !== 'none')
    .sort((a, b) => (b.last_edited_time ?? 0) - (a.last_edited_time ?? 0))
    .slice(0, 50);
  return {
    width: 280,
    search: t('lp.shell.search_databases', 'Search databases…'),
    sections: [{
      items: dbs.length
        ? dbs.map((b) => ({
          label: databaseName(b), icon: 'viewTable',
          onSelect: () => addDatabaseViewToSidebar(b.id, b.view_ids?.[0]),
        }))
        : [{ label: t('lp.shell.no_databases_yet', 'No databases yet'), disabled: true }],
    }],
  };
}

function databaseName(b: BlockRecord): string {
  const col = records.get<CollectionRecord>('collection', b.collection_id);
  return toPlainText(col?.name as never) || toPlainText(b.properties?.title) || t('lp.shell.untitled', 'Untitled');
}

/** Add a database view as a sidebar section of the current tab (also used by the view tab menu "Add view to sidebar"). */
export function addDatabaseViewToSidebar(blockId: string, viewId?: string) {
  const tabId = getActiveTabId();
  updateLayout((l) => {
    const tab = l.tabs.find((x) => x.id === tabId) ?? l.tabs[0];
    if (!tab) return;
    if (tab.sections.some((x) => x.type === 'database_view' && x.blockId === blockId && (x.viewId ?? null) === (viewId ?? null))) return;
    tab.sections.push({ id: newSectionId(), type: 'database_view', blockId, viewId, limit: 10 });
  });
  useUI.getState().toast(t('lp.shell.added_to_sidebar', 'Added to sidebar'));
}
