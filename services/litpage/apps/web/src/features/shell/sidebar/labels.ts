
import { t } from '../i18n.ts';
import type { SectionType, ShortcutType, SidebarTab } from './model.ts';

export function tabName(tab: SidebarTab): string {
  if (tab.name) return tab.name;
  switch (tab.icon) {
    case 'home':
      return t('lp.shell.home', 'Home');
    case 'chat':
      return t('lp.shell.chat', 'Chat');
    case 'meetings':
      return t('lp.shell.meetings', 'Meetings');
    default:
      return t('lp.shell.new_tab', 'New tab');
  }
}

export const TAB_ICON: Record<string, string> = {
  home: 'sidebarTabHome',
  chat: 'sidebarTabChat',
  meetings: 'sidebarTabMeetings',
  custom: 'sidebarTabCustom',
};

export function shortcutLabel(type: ShortcutType): string {
  switch (type) {
    case 'new_chat':
      return t('lp.shell.new_chat', 'New chat');
    case 'library':
      return t('lp.shell.library', 'Library');
    case 'new_meeting_note':
      return t('lp.shell.create_meeting_note', 'Start meeting note');
    case 'new_page':
      return t('lp.shell.new_page', 'New page');
    case 'new_database':
      return t('lp.shell.new_database', 'New database');
    case 'page':
      return t('lp.shell.page', 'Page');
    case 'chat_thread':
      return t('lp.shell.chat_thread', 'Chat thread');
    case 'settings':
      return t('lp.shell.settings', 'Settings');
    case 'meeting_notes':
      return t('lp.shell.meeting_notes', 'Meeting Notes');
    case 'skills':
      return t('lp.shell.skills', 'Skills');
    case 'my_tasks':
      return t('lp.shell.my_tasks', 'My Tasks');
    case 'lit_calendar':
      return t('lp.shell.calendar', 'Calendar');
    case 'marketplace':
      return t('lp.shell.marketplace', 'Marketplace');
  }
}

export const SHORTCUT_ICON: Record<ShortcutType, string> = {
  new_chat: 'chatBubblePlus',
  library: 'bookshelf',
  new_meeting_note: 'microphone',
  new_page: 'compose',
  new_database: 'viewTable',
  page: 'page',
  chat_thread: 'chatBubble',
  settings: 'gear',
  meeting_notes: 'libPaperMic',
  skills: 'libPaperSkill',
  my_tasks: 'checkmarkSquare',
  lit_calendar: 'calendarAlt',
  marketplace: 'templates',
};

export function sectionLabel(type: SectionType): string {
  switch (type) {
    case 'upcoming_events':
      return t('lp.shell.upcoming_events', 'Upcoming events');
    case 'recents':
      return t('lp.shell.recents', 'Recents');
    case 'favorites':
      return t('lp.shell.favorites', 'Favorites');
    case 'teamspaces':
      return t('lp.shell.teams', 'Teams');
    case 'shared':
      return t('lp.shell.shared', 'Shared');
    case 'private':
      return t('lp.shell.private', 'Private');
    case 'chats':
      return t('lp.shell.chats', 'Chats');
    case 'pinned_chats':
      return t('lp.shell.pinned', 'Pinned');
    case 'agents':
      return t('lp.shell.agents', 'Agents');
    case 'ai_meeting_notes':
      return t('lp.shell.ai_meeting_notes', 'AI meeting notes');
    case 'lit_apps':
      return t('lp.shell.litpage_apps', 'Litpage apps');
    case 'developer':
      return t('lp.shell.developer', 'Developer');
    case 'teamspace':
      return t('lp.shell.team', 'Team');
    case 'database_view':
      return t('lp.shell.database_view', 'Database view');
  }
}

export const SECTION_ICON: Record<SectionType, string> = {
  upcoming_events: 'calendar',
  recents: 'clock',
  favorites: 'star',
  teamspaces: 'building',
  shared: 'people',
  private: 'lock',
  chats: 'chatBubble',
  pinned_chats: 'pin',
  agents: 'aiFace',
  ai_meeting_notes: 'libPaperMic',
  lit_apps: 'squareGrid2X2',
  developer: 'curlyBraces',
  teamspace: 'teamspace',
  database_view: 'viewTable',
};


export const SECTION_CLASS: Record<SectionType, string> = {
  upcoming_events: 'shared',
  recents: 'recents',
  favorites: 'bookmarks',
  teamspaces: 'team',
  shared: 'shared',
  private: 'private',
  chats: 'chats',
  pinned_chats: 'pinned-chats',
  agents: 'agents',
  ai_meeting_notes: 'meetings',
  lit_apps: 'apps',
  developer: 'developer',
  teamspace: 'teamspace',
  database_view: 'database-view',
};

/** Library tab that a section's "View all" / "Open in Library" opens. */
export const SECTION_LIBRARY_TAB: Partial<Record<SectionType, string>> = {
  recents: 'recents',
  favorites: 'favorites',
  teamspaces: 'teamspaces',
  shared: 'shared',
  private: 'private',
  ai_meeting_notes: 'meetings',
};
