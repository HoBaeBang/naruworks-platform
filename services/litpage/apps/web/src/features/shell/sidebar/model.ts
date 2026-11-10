// Sidebar layout (2026 "simplified" sidebar): tabs (Home / Chat / Meetings / custom), each with shortcuts
// (New chat, Library…) and sections (Upcoming events, Recents, Favorites, Teamspaces, Shared, Private…).
// Persisted per user & workspace in space_view.settings.sidebar_layout (preference writes skip undo history).
import { useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { newId } from '@nc/shared/ids.ts';
import type { SpaceRecord, SpaceViewRecord } from '@nc/shared/records.ts';
import { useCurrentSpace, useCurrentSpaceView } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { layoutFromPresets } from '../../settings/sidebarPresets.ts';
import { currentSpaceView, useSession } from '../../../lib/store/session.ts';
import { run } from '../../../lib/blocks.ts';

export type ShortcutType =
  | 'new_chat' | 'library' | 'new_meeting_note' | 'new_page' | 'new_database' | 'page' | 'chat_thread'
  | 'settings' | 'meeting_notes' | 'skills' | 'my_tasks' | 'lit_calendar' | 'marketplace';

export type SectionType =
  | 'upcoming_events' | 'recents' | 'favorites' | 'teamspaces' | 'shared' | 'private'
  | 'chats' | 'pinned_chats' | 'agents' | 'ai_meeting_notes' | 'lit_apps' | 'developer' | 'teamspace' | 'database_view';

export interface SidebarShortcut {
  id: string;
  type: ShortcutType;
  pageId?: string;
  
  destination?: { kind: 'page' | 'database'; id: string };
}

export interface SidebarSection {
  id: string;
  type: SectionType;
  limit?: number;
  sort?: 'manual' | 'last_edited';
  teamId?: string;
  blockId?: string;
  /** database_view sections: the view whose rows the section lists */
  viewId?: string;
}

export type TabIcon = 'home' | 'chat' | 'meetings' | 'custom';

export interface SidebarTab {
  id: string;
  icon: TabIcon;
  /** custom name (default tabs use the localized default name when unset) */
  name?: string;
  
  presetId?: string;
  shortcuts: SidebarShortcut[];
  sections: SidebarSection[];
}

export interface SidebarLayout {
  version: 1;
  tabs: SidebarTab[];
  hideTabNames?: boolean;
}

export const SECTION_LIMITS = [5, 10, 15, 20, 50, 100];
export const DEFAULT_LIMIT: Partial<Record<SectionType, number>> = { favorites: 100, chats: 20, pinned_chats: 20 };
export const MAX_TABS = 6;

export function defaultLayout(): SidebarLayout {
  return {
    version: 1,
    tabs: [
      {
        id: 'home', icon: 'home',
        shortcuts: [{ id: 'sc-new-chat', type: 'new_chat' }, { id: 'sc-library', type: 'library' }],
        sections: [
          { id: 'sec-upcoming', type: 'upcoming_events', limit: 5 },
          { id: 'sec-recents', type: 'recents', limit: 5 },
          { id: 'sec-favorites', type: 'favorites', limit: 100 },
          { id: 'sec-teamspaces', type: 'teamspaces', limit: 5 },
          { id: 'sec-shared', type: 'shared', limit: 5, sort: 'last_edited' },
          { id: 'sec-private', type: 'private', limit: 5, sort: 'manual' },
        ],
      },
      { id: 'chat', icon: 'chat', shortcuts: [{ id: 'sc-chat-new', type: 'new_chat' }], sections: [{ id: 'sec-agents', type: 'agents', limit: 10 }, { id: 'sec-chats', type: 'chats', limit: 20 }] },
      {
        id: 'meetings', icon: 'meetings',
        shortcuts: [{ id: 'sc-new-meeting', type: 'new_meeting_note' }],
        sections: [{ id: 'sec-meet-upcoming', type: 'upcoming_events', limit: 5 }],
      },
    ],
  };
}

function normalize(raw: unknown): SidebarLayout | null {
  const l = raw as SidebarLayout | undefined;
  if (!l || l.version !== 1 || !Array.isArray(l.tabs) || !l.tabs.length) return null;
  return {
    version: 1,
    hideTabNames: !!l.hideTabNames,
    tabs: l.tabs.map((t) => ({
      id: String(t.id),
      icon: (['home', 'chat', 'meetings', 'custom'] as TabIcon[]).includes(t.icon) ? t.icon : 'custom',
      name: t.name || undefined,
      presetId: typeof t.presetId === 'string' ? t.presetId : undefined,
      shortcuts: Array.isArray(t.shortcuts) ? t.shortcuts.filter((s) => s && s.type) : [],
      sections: Array.isArray(t.sections) ? t.sections.filter((s) => s && s.type) : [],
    })),
  };
}

export function layoutOf(sv: SpaceViewRecord | undefined): SidebarLayout {
  
  return normalize(sv?.settings?.sidebar_layout) ?? normalize(layoutFromPresets(records.get<SpaceRecord>('space', sv?.space_id))) ?? defaultLayout();
}

export function useSidebarLayout(): SidebarLayout {
  const sv = useCurrentSpaceView();
  const space = useCurrentSpace();
  const raw = sv?.settings?.sidebar_layout;
  const presets = (space?.settings as Record<string, unknown> | undefined)?.sidebar_presets;
  return useMemo(() => layoutOf(sv), [raw, presets]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function saveLayout(next: SidebarLayout) {
  const sv = currentSpaceView();
  if (!sv) return;
  run('sidebar.updateLayout', (tx) => tx.set('space_view', sv.id, ['settings', 'sidebar_layout'], next), { skipHistory: true });
}

/** Mutate a copy of the current layout and persist it. */
export function updateLayout(fn: (l: SidebarLayout) => void) {
  const l = structuredClone(layoutOf(currentSpaceView()));
  fn(l);
  saveLayout(l);
}

export function findSection(l: SidebarLayout, sectionId: string): { tab: SidebarTab; index: number } | null {
  for (const tab of l.tabs) {
    const index = tab.sections.findIndex((s) => s.id === sectionId);
    if (index >= 0) return { tab, index };
  }
  return null;
}

export function findShortcut(l: SidebarLayout, shortcutId: string): { tab: SidebarTab; index: number } | null {
  for (const tab of l.tabs) {
    const index = tab.shortcuts.findIndex((s) => s.id === shortcutId);
    if (index >= 0) return { tab, index };
  }
  return null;
}

export function newSectionId() {
  return `sec-${newId().slice(0, 8)}`;
}
export function newShortcutId() {
  return `sc-${newId().slice(0, 8)}`;
}

// ---------- active tab (device-local, per workspace) ----------
const tabListeners = new Set<() => void>();
function tabKey() {
  return `nc:sb:tab:${useSession.getState().spaceId ?? ''}`;
}
export function getActiveTabId(): string {
  try {
    return localStorage.getItem(tabKey()) || 'home';
  } catch {
    return 'home';
  }
}
export function setActiveTabId(id: string) {
  try {
    localStorage.setItem(tabKey(), id);
  } catch {
    /* ignore */
  }
  for (const fn of tabListeners) fn();
}
export function useActiveTabId(layout: SidebarLayout): string {
  const id = useSyncExternalStore(
    (cb) => {
      tabListeners.add(cb);
      return () => tabListeners.delete(cb);
    },
    getActiveTabId,
  );
  return layout.tabs.some((t) => t.id === id) ? id : layout.tabs[0]?.id ?? 'home';
}


interface ExpandState {
  collapsed: Record<string, boolean>;
  expanded: Record<string, boolean>;
  setCollapsed: (key: string, v: boolean) => void;
  setExpanded: (key: string, v: boolean) => void;
}

function readJSON<T>(key: string, fb: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
}
function writeJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export const useSidebarExpand = create<ExpandState>((set, get) => ({
  collapsed: readJSON('nc:sb:collapsed', {}),
  expanded: readJSON('nc:sb:expanded', {}),
  setCollapsed: (key, v) => {
    const next = { ...get().collapsed };
    if (v) next[key] = true;
    else delete next[key];
    writeJSON('nc:sb:collapsed', next);
    set({ collapsed: next });
  },
  setExpanded: (key, v) => {
    const next = { ...get().expanded };
    if (v) next[key] = true;
    else delete next[key];
    writeJSON('nc:sb:expanded', next);
    set({ expanded: next });
  },
}));

// ---------- customize mode ----------
export const useSidebarMode = create<{ customizing: boolean; set: (v: boolean) => void }>((set) => ({
  customizing: false,
  set: (v) => set({ customizing: v }),
}));
