// Quick Find extras: keyword shortcuts ("home", "settings", "inbox", "trash", "library", "templates", "people",
// "meetings" …) and people results (opens the person's profile).
import type { ReactNode, MouseEvent } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, spaceDomain } from '../../lib/router.ts';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';
import { newPage } from '../page/pageActions.ts';
import { createPrivateDatabase } from '../shell/sidebar/menus.tsx';
import { toggleDarkMode } from '../shell/shortcuts.ts';

interface QuickNavRow {
  id: string;
  kind: 'action';
  navigate: { pageId: string };
  action: { label: string; icon: string; run: () => void; caption?: string };
}

const domain = () => spaceDomain(useSession.getState().spaceId);

interface Shortcut { id: string; label: string; aliases: string[]; caption?: string; icon: string; run: () => void }

/** Search action results (New page / New chat / New database / Litpage AI / Settings / Import / Templates / Library /
 *  Inbox, theme) plus the shell destinations people type (home, trash, people …). */
function shortcuts(): Shortcut[] {
  const dark = useUI.getState().resolvedDark;
  return [
    { id: 'new-page', label: t('lp.search.new_page', 'New page'), aliases: [t('lp.search.create_page', 'Create page'), t('lp.search.page', 'Page')], caption: t('lp.search.start_a_blank_page', 'Start a blank page.'), icon: 'pageEmpty', run: () => void newPage({ kind: 'private' }) },
    { id: 'new-chat', label: t('lp.search.new_chat', 'New chat'), aliases: [t('lp.search.start_a_new_chat', 'Open a fresh chat'), t('lp.search.ai_chat', 'AI chat')], caption: t('lp.search.begin_a_fresh_chat_with_ai', 'Begin a fresh chat with AI.'), icon: 'chatBubble', run: () => navigate(`/${domain()}/chat`) },
    { id: 'new-database', label: t('lp.search.new_database', 'New database'), aliases: [t('lp.search.create_database', 'Create database'), t('lp.search.database', 'Database')], caption: t('lp.search.set_up_a_blank_database', 'Set up a blank database.'), icon: 'viewTable', run: () => createPrivateDatabase() },
    { id: 'ai', label: t('lp.search.litpage_ai', 'Litpage AI'), aliases: [t('lp.search.ai', 'ai')], icon: 'aiFace', run: () => navigate(`/${domain()}/chat`) },
    { id: 'home', label: t('lp.search.home', 'Home'), aliases: ['start'], icon: 'home', run: () => navigate(`/${domain()}`) },
    { id: 'settings', label: t('lp.search.settings', 'Settings'), aliases: ['preferences'], caption: t('lp.search.adjust_account_details_and_preferences', 'Adjust account details and preferences'), icon: 'gear', run: () => useUI.getState().openSettings() },
    { id: 'import', label: t('lp.search.import_data', 'Import data'), aliases: ['import'], caption: t('lp.search.bring_content_into_litpage_from_files', 'Bring content into Litpage from files or other tools.'), icon: 'import', run: () => useUI.getState().set({ importOpen: true }) },
    { id: 'templates', label: t('lp.search.templates', 'Templates'), aliases: [t('lp.search.gallery', 'gallery'), 'marketplace'], caption: t('lp.search.browse_litpage_community_templates', 'Browse Litpage community templates'), icon: 'templates', run: () => navigate(`/${domain()}/marketplace`) },
    { id: 'library', label: t('lp.search.library', 'Library'), aliases: [t('lp.search.library_0029', 'library')], caption: t('lp.search.browse_every_page_connected_to_you', 'Browse every page connected to you'), icon: 'library', run: () => navigate(`/${domain()}/library`) },
    { id: 'inbox', label: t('lp.search.inbox', 'Inbox'), aliases: [t('lp.search.updates', 'updates'), t('lp.search.notifications', 'notifications')], icon: 'inbox', run: () => useUI.getState().set({ inboxOpen: true }) },
    { id: 'theme', label: t('lp.search.toggle_theme', 'Toggle theme'), aliases: [t('lp.search.dark_mode', 'Dark mode'), t('lp.search.light_mode', 'Light mode'), t('lp.search.theme', 'Theme')], caption: dark ? t('lp.search.use_the_light_appearance', 'Use the light appearance.') : t('lp.search.use_the_dark_appearance', 'Use the dark appearance.'), icon: dark ? 'sun' : 'moon', run: () => toggleDarkMode() },
    { id: 'trash', label: t('lp.search.trash', 'Trash'), aliases: ['deleted'], icon: 'trash', run: () => useUI.getState().set({ trashOpen: true }) },
    { id: 'people', label: t('lp.search.people_directory', 'People Directory'), aliases: ['people', 'directory', 'members'], icon: 'users', run: () => navigate(`/${domain()}/people`) },
    { id: 'meetings', label: t('lp.search.meetings', 'Meetings'), aliases: ['calendar'], icon: 'meetings', run: () => navigate(`/${domain()}/meetings`) },
    { id: 'tasks', label: t('lp.search.my_tasks', 'My Tasks'), aliases: ['tasks'], icon: 'checkmarkSquare', run: () => navigate(`/${domain()}/tasks`) },
    { id: 'shortcuts', label: t('lp.search.keyboard_shortcuts', 'Keyboard shortcuts'), aliases: ['shortcuts', 'keyboard'], icon: 'keyboard', run: () => useUI.getState().set({ shortcutsOpen: true }) },
  ];
}

/** Action rows for a query (2+ characters; the title or one of its aliases starts with the query). */
export function quickNavRows(query: string): QuickNavRow[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2 || /["“”]/.test(q)) return [];
  return shortcuts()
    .filter((s) => s.label.toLowerCase().startsWith(q) || s.aliases.some((a) => a.toLowerCase().startsWith(q)))
    .slice(0, 4)
    .map((s) => ({ id: `action:${s.id}`, kind: 'action' as const, navigate: { pageId: '' }, action: { label: s.label, icon: s.icon, run: s.run, caption: s.caption } }));
}

export function renderSpecialRow(
  row: { id: string; kind?: 'action' | 'person'; action?: { label: string; icon: string; caption?: string }; userId?: string },
  active: boolean,
  onHover: () => void,
  onOpen: (e: MouseEvent) => void,
): ReactNode {
  let icon: ReactNode;
  let title: ReactNode;
  let sub: ReactNode = null;
  if (row.kind === 'person') {
    const u = records.get<UserRecord>('lit_user', row.userId);
    icon = <UserAvatar userId={row.userId ?? null} size={20} />;
    title = userName(u);
    sub = u?.email ? <span className="nc-qf-inline-path notranslate">{u.email}</span> : null;
  } else {
    icon = <Icon name={row.action?.icon ?? 'arrowRight'} size={20} style={{ color: 'var(--lp-icon-secondary)' }} />;
    title = row.action?.label;
  }
  const caption = row.kind === 'action' && row.id !== 'action:ai' ? row.action?.caption : undefined;
  return (
    <a key={row.id} href="#" className="nc-qf-link" data-row-kind={row.kind} onClick={(e) => { e.preventDefault(); onOpen(e); }}>
      <div role="option" aria-selected={active} className={`notranslate search-query-result-item nc-qf-row recent ${active ? 'active' : ''}`} onMouseMove={onHover}>
        <div className="nc-qf-row-inner">
          <div className="nc-qf-row-icon">{icon}</div>
          <div className="nc-qf-row-main">
            <div className="nc-qf-title-line">
              <div className={`nc-qf-title notranslate${row.kind === 'action' ? ' nc-qf-action-title' : ''}`}>{title}</div>
              {sub && <span className="nc-qf-dash">—</span>}
              {sub}
            </div>
            {caption && <div className="nc-qf-meta nc-qf-action-caption">{caption}</div>}
          </div>
          <div className="nc-qf-row-end">
            <span className="nc-qf-enter" style={{ visibility: active ? 'visible' : 'hidden' }}><Icon name="arrowTurnDownLeftSmall" size={14} /></span>
          </div>
        </div>
      </div>
    </a>
  );
}
