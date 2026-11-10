// Page ••• menu, top to bottom:
// Search actions… · Copy link · Copy page contents · Duplicate · Move to · Version history · Updates & analytics |
// Appearance & layout › | Use with AI › | Suggest edits · Notify me (Comments) › | Lock page · Move to Trash | More › |
// footer: Last edited (avatar, name, time). Switches are live components so toggles update in place.
import type { BlockRecord, CollectionRecord, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { isSpaceAdmin, isSpaceMember } from '@nc/shared/permissions.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { MenuSectionTitle, openMenu, type MenuDef, type MenuItemDef } from '../../components/Menu.tsx';
import { getBlock, me, run, setFormat } from '../../lib/blocks.ts';
import { api } from '../../lib/api.ts';
import { useBlock, useRecord } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { useUI } from '../../lib/store/ui.ts';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';
import { isDatabaseRow, notifyLevelItems, notifyLevelLabel, notifyLevelToast, type NotifyLevel } from '../shell/inbox/notifyLevels.ts';
import { copyPageLink, duplicatePage, trashPage } from './pageActions.ts';
import { openMoveToDialog } from './MoveTo.tsx';
import { openExportDialog } from './ExportDialog.tsx';
import { openVersionHistory, versionTimestamp } from './VersionHistory.tsx';
import { startPresentation } from './PresentMode.tsx';
import { pageToMarkdown } from './exportPage.ts';
import { archivePage, archiveState, unarchivePage } from './archive.tsx';
import { canTurnIntoWiki, isWikiPage, turnIntoWiki, undoWiki } from './wiki.tsx';
import { isSuggesting, useSuggest } from '../comments/suggest.ts';
import { openImport } from '../import/ImportModal.tsx';
import { openMergeCsv } from '../import/MergeCsv.tsx';
import { backlinksMode, setBacklinksMode } from './Backlinks.tsx';
import { connectionsMenuItem } from '../developer/PageConnections.tsx';
import { markAsMeetingInstructions } from '../meetings/instructions.tsx';
import { collectionAccess } from '../database/access.ts';

type FormatKey = 'page_small_text' | 'page_full_width' | 'block_locked' | 'page_floating_table_of_contents' | 'page_discussions';

/** Current boolean of a page setting (TOC and page discussions default to on). */
export function pageSetting(page: BlockRecord | undefined, key: FormatKey): boolean {
  const f = (page?.format ?? {}) as any;
  if (key === 'page_floating_table_of_contents') return f.page_floating_table_of_contents !== false;
  if (key === 'page_discussions') return (f.page_section_visibility?.comments ?? 'section_show') !== 'section_hide';
  return !!f[key];
}

export function togglePageSetting(pageId: string, key: FormatKey) {
  const page = getBlock(pageId);
  if (!page) return;
  const on = pageSetting(page, key);
  if (key === 'page_discussions') {
    const cur = ((page.format as any)?.page_section_visibility ?? {}) as Record<string, string>;
    run('toggle.page_discussions', (tx) => setFormat(tx, pageId, { page_section_visibility: { ...cur, comments: on ? 'section_hide' : 'section_show' } } as any));
    return;
  }
  if (key === 'page_floating_table_of_contents') {
    run('toggle.toc', (tx) => setFormat(tx, pageId, { page_floating_table_of_contents: on ? false : null } as any));
    return;
  }
  if (key === 'block_locked') {
    run('toggle.block_locked', (tx) => setFormat(tx, pageId, { block_locked: !on, block_locked_by: !on ? me() : null } as any));
    return;
  }
  run(`toggle.${key}`, (tx) => setFormat(tx, pageId, { [key]: !on } as any));
}

function Switch({ pageId, k }: { pageId: string; k: FormatKey }) {
  const page = useBlock(pageId);
  const on = pageSetting(page, k);
  return <span role="switch" aria-checked={on} className={`nc-toggle ${on ? 'on' : ''}`} />;
}

function FontCards({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  const cur = (page?.format?.page_font as string | undefined) ?? 'default';
  const card = (font: 'default' | 'serif' | 'mono', label: string) => (
    <div
      role="menuitem"
      key={font}
      className={`nc-font-choice ${cur === font ? 'active' : ''}`}
      onClick={() => run('setPageFont', (tx) => setFormat(tx, pageId, { page_font: font === 'default' ? null : font } as any))}
    >
      <div className={`sample ${font}`}>Ag</div>
      <div className="label">{label}</div>
    </div>
  );
  // a titled menu section (title row 15.9px incl. the hidden spinner slot, tiles 92×61)
  return (
    <div className="nc-menu-section titled nc-font-section">
      <MenuSectionTitle>{t('lp.page.font_style', 'Font style')}</MenuSectionTitle>
      <div className="nc-font-row">
        {card('default', t('lp.page.default', 'Default'))}
        {card('serif', t('lp.page.serif', 'Serif'))}
        {card('mono', t('lp.page.mono', 'Mono'))}
      </div>
    </div>
  );
}

function MenuFooter({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  const editor = useRecord<UserRecord>('lit_user', page?.last_edited_by_id);
  if (!page) return null;
  const words = countWords(pageId);
  // same structure as the block menu footer (a menu section)
  return (
    <div className="nc-menu-section nc-block-menu-footer nc-page-menu-footer">
      <div className="nc-block-menu-footer-row">
        <div className="nc-block-menu-footer-col">
          <div className="title">Last edited</div>
          <div className="who">
            <UserAvatar userId={page.last_edited_by_id} size={24} />
            <span className="name nc-ellipsis">{userName(editor)}</span>
          </div>
          <div className="when">{versionTimestamp(page.last_edited_time)}</div>
        </div>
        <div className="count">{words === 1 ? '1 word' : `${words.toLocaleString('en-US')} words`}</div>
      </div>
    </div>
  );
}

function SuggestStop({ pageId }: { pageId: string }) {
  const on = useSuggest((st) => !!st.pages[pageId]) && isSuggesting(pageId);
  return on ? <span className="nc-menu-right-label">{t('lp.page.stop', 'Stop')}</span> : null;
}

// levels: features/shell/inbox/notifyLevels.ts (database rows add All updates / Important updates)
const notifyCache = new Map<string, NotifyLevel>();

function NotifyLabel({ pageId }: { pageId: string }) {
  const level = notifyCache.get(pageId);
  return <span className="nc-menu-right-label">{notifyLevelLabel(level)}</span>;
}

function setNotify(pageId: string, level: NotifyLevel) {
  notifyCache.set(pageId, level);
  void api('setPageNotifySettings', { pageId, level }).then((r) => records.mergeRecordMap(r.recordMap)).catch(() => {});
  useUI.getState().toast(notifyLevelToast(level));
}

const LANGUAGES = ['English', 'Korean', 'Japanese', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Vietnamese', 'Indonesian', 'Thai', 'Russian'];

export function translatePage(pageId: string, language: string) {
  window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { pageId, skill: 'Translate', language, prompt: `Translate this page to ${language}` } }));
  useUI.getState().toast(`Translating to ${language}…`);
}

export function openPageMenu(pageId: string, anchor: HTMLElement) {
  const page = getBlock(pageId);
  if (!page) return;
  if (!notifyCache.has(pageId)) {
    void api('getPageNotifySettings', { pageId }).then((r) => { notifyCache.set(pageId, r.level); records.mergeRecordMap(r.recordMap); }).catch(() => {});
  }
  const role = records.role('block', pageId);
  const canEdit = role === 'editor' || role === 'read_and_write';
  const isDb = page.type === 'collection_view_page' || page.type === 'collection_view';
  const archived = archiveState(pageId);
  const wiki = isWikiPage(page);
  // data source whose page layout "Customize layout" edits: a full-page database's, or a database page's own
  const layoutSource = page.parent_table === 'collection' ? page.parent_id : isDb && page.collection_id && !wiki ? page.collection_id : null;
  const KEEP = Symbol('keep');
  const keep = (fn: () => void) => Object.assign(() => { fn(); return false; }, { [KEEP]: true });
  // Menu closes every overlay after onSelect — run actions that open dialogs/popovers after that.
  const item = (label: string, icon: string, extra: Partial<MenuItemDef> = {}): MenuItemDef => {
    const fn = extra.onSelect;
    const onSelect = fn && !(fn as any)[KEEP] ? () => { setTimeout(() => fn(), 0); } : fn;
    return { label, icon, ...extra, onSelect };
  };

  // submenus: role=menu/menuitem; the first row opens focused with the keyboard focus ring
  // (the submenu takes focus from the search field) — except Appearance, whose focus lands on the font tiles
  const appearance = (): MenuDef => ({
    width: 300,
    role: 'menu',
    className: 'nc-page-submenu nc-appearance-menu',
    initialActive: -1,
    header: <FontCards pageId={pageId} />,
    sections: [{
      title: 'Appearance',
      items: [
        item(t('lp.page.small_text', 'Small text'), 'textSmall', { right: <Switch pageId={pageId} k="page_small_text" />, onSelect: keep(() => togglePageSetting(pageId, 'page_small_text')), disabled: !canEdit }),
        // a wiki's home has no Full width / Contents list
        ...(wiki ? [] : [
          item(t('lp.page.full_width', 'Full width'), 'arrowExpandHorizontal', { shortcut: undefined, right: <Switch pageId={pageId} k="page_full_width" />, onSelect: keep(() => togglePageSetting(pageId, 'page_full_width')), disabled: !canEdit }),
          item(t('lp.page.contents_list', 'Contents list'), 'tableOfContents', { right: <Switch pageId={pageId} k="page_floating_table_of_contents" />, onSelect: keep(() => togglePageSetting(pageId, 'page_floating_table_of_contents')), disabled: !canEdit }),
        ]),
        item(t('lp.page.page_discussions', 'Page discussions'), 'commentFilled', { right: <Switch pageId={pageId} k="page_discussions" />, onSelect: keep(() => togglePageSetting(pageId, 'page_discussions')), disabled: !canEdit }),
        // backlinks turned off from their popover come back here
        ...(backlinksMode(page) === 'off' ? [item(t('lp.page.show_backlinks', 'Show backlinks'), 'arrowTurnUpRight', { onSelect: () => setBacklinksMode(pageId, 'popover'), disabled: !canEdit })] : []),
        item(t('lp.page.inline_comments', 'Inline comments'), 'commentFilled', {
          disabled: !canEdit,
          submenu: () => {
            const cur = (getBlock(pageId)?.format as any)?.page_section_visibility?.margin_comments === 'minimal' ? 'minimal' : 'inline';
            const set = (v: 'inline' | 'minimal') => {
              const b = getBlock(pageId);
              const sv = ((b?.format as any)?.page_section_visibility ?? {}) as Record<string, string>;
              run('setInlineComments', (tx) => setFormat(tx, pageId, { page_section_visibility: { ...sv, margin_comments: v } } as any));
            };
            return { width: 220, sections: [{ items: [
              { label: t('lp.page.default', 'Default'), description: 'Show comments to the right of the page', checked: cur === 'inline', onSelect: () => set('inline') },
              { label: t('lp.page.minimal', 'Minimal'), description: 'Show an icon and comment count', checked: cur === 'minimal', onSelect: () => set('minimal') },
            ] }] };
          },
        }),
        // the layout of database pages (features/database/layout): on a full-page database (not a
        // wiki's home) and on its pages; needs edit access to the database structure (openLayoutBuilder checks the lock)
        ...(layoutSource ? [item(t('lp.page.customize_layout', 'Customize layout'), 'layout', { onSelect: () => { void import('../database/layout/openLayoutBuilder.ts').then((m) => m.openLayoutBuilder(layoutSource)); }, disabled: !collectionAccess(layoutSource).canEditStructure })] : []),
      ],
    }],
  });

  const useWithAi = (): MenuDef => ({
    width: 300,
    role: 'menu',
    className: 'nc-page-submenu',
    sections: [{ items: [
      // registers the page as a skill (features/ai handles nc:ask-ai action 'use-as-skill' and reports the result)
      item('Use as an AI skill', 'aiFace', { onSelect: () => { window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { pageId, action: 'use-as-skill' } })); } }),
      item('Use as agent guidance', 'page', { onSelect: () => aiAction(pageId, 'use-as-agent-instructions', 'Set as Litpage Agent instructions') }),
      // marks the page as AI meeting instructions + adds it to the person's Instructions menu (features/meetings)
      item('Use for AI meeting guidance', 'paperMicrophone', { onSelect: () => void markAsMeetingInstructions(pageId) }),
    ] }],
  });

  const notify = (): MenuDef => {
    const cur = notifyCache.get(pageId) ?? (page.created_by_id === me() ? 'all_comments' : 'replies_and_mentions');
    return {
      width: 300,
      role: 'menu',
      className: 'nc-page-submenu',
      sections: [{ items: notifyLevelItems(isDatabaseRow(page), cur, (lv) => setNotify(pageId, lv)) }],
    };
  };

  const more = (): MenuDef => ({
    width: 280,
    role: 'menu',
    className: 'nc-page-submenu',
    sections: [
      { items: [
        item(t('lp.page.present', 'Present'), 'present', { badge: 'Beta', shortcut: '⌘⌥P', description: undefined, onSelect: () => startPresentation(pageId) }),
        item(t('lp.page.translate', 'Translate'), 'translate', { submenu: () => ({ width: 240, search: 'Search languages…', sections: [{ items: LANGUAGES.map((l) => ({ label: l, onSelect: () => translatePage(pageId, l) })) }] }) }),
        item(t('lp.page.undo', 'Undo'), 'undo', { shortcut: '⌘Z', disabled: !transactions.canUndo(), onSelect: () => { transactions.undo(); } }),
        // imports land inside this page; databases also take rows from a CSV
        item(t('lp.page.import', 'Import'), 'import', { onSelect: () => openImport({ pageId }), disabled: !canEdit }),
        ...(isDb && page.collection_id ? [item(t('lp.page.combine_with_csv', 'Combine with CSV'), 'fileCsv', { keywords: ['csv', 'import', 'excel'], onSelect: () => openMergeCsv(pageId), disabled: !canEdit })] : []),
        // hidden when Settings › Security › Disable export (or the teamspace's) applies to this user
        ...(exportBlocked(page) ? [] : [item(t('lp.page.export', 'Export'), 'export', { description: undefined, onSelect: () => openExportDialog(pageId) })]),
        // Turn into wiki (full access, plain pages) / Undo wiki
        ...(wiki
          ? [item(t('lp.page.undo_wiki', 'Undo wiki'), 'arrowSquarePathUpDown', { onSelect: () => void undoWiki(pageId), disabled: role !== 'editor' })]
          : isDb || page.parent_table === 'collection' ? [] : [item(t('lp.page.change_to_wiki', 'Change to wiki'), 'arrowSquarePathUpDown', { keywords: ['wiki', 'knowledge base', 'verification', 'owner'], onSelect: () => void turnIntoWiki(pageId), disabled: !canTurnIntoWiki(page) })]),
      ] },
      { items: [
        // connections that reach this page, add / disconnect one (features/developer/PageConnections.tsx)
        connectionsMenuItem(pageId, item),
      ] },
      { items: [item(t('lp.page.switch_to_the_mac_app', 'Switch to the Mac app'), 'litLogo', { onSelect: () => useUI.getState().toast('The desktop app isn’t installed') })] },
    ],
  });

  const def: MenuDef = {
    width: 256,
    maxHeight: '80vh',
    search: t('lp.page.search_actions', 'Search actions…'),
    searchIcon: true,
    initialActive: -1,
    sections: [
      { items: [
        item(t('lp.page.copy_link', 'Copy link'), 'link', { shortcut: '⌘⌥L', onSelect: () => copyPageLink(pageId) }),
        item(t('lp.page.copy_the_page_content', 'Copy the page content'), 'clipboard', { onSelect: () => { void navigator.clipboard?.writeText(pageToMarkdown(pageId)); useUI.getState().toast('Page contents copied'); } }),
        // databases: Duplicate with content / without content (schema and views only)
        isDb
          ? item(t('lp.page.duplicate', 'Duplicate'), 'duplicate', { shortcut: '⌘D', submenu: () => ({ width: 240, role: 'menu', className: 'nc-page-submenu', sections: [{ items: [
            { label: t('lp.page.duplicate_with_page_content', 'Duplicate with page content'), onSelect: () => void duplicateDatabase(pageId, true) },
            { label: t('lp.page.duplicate_without_page_content', 'Duplicate without page content'), onSelect: () => void duplicateDatabase(pageId, false) },
          ] }] }) })
          : item(t('lp.page.duplicate', 'Duplicate'), 'duplicate', { shortcut: '⌘D', onSelect: () => void duplicatePage(pageId) }),
        item(t('lp.page.move_to', 'Move to'), 'arrowTurnUpRight', { shortcut: '⌘⇧P', onSelect: () => openMoveToDialog([pageId], anchor), disabled: !canEdit }),
        item(t('lp.page.version_history', 'Version history'), 'stack', { keywords: ['page history', 'history', 'restore', 'snapshot'], onSelect: () => openVersionHistory(pageId), disabled: !canEdit }),
        item(t('lp.page.updates_analytics', 'Updates & analytics'), 'clock', { keywords: ['analytics', 'views', 'updates', 'activity'], onSelect: () => useUI.getState().set({ rightPanel: 'updates' }) }),
      ] },
      { items: [item(t('lp.page.appearance_layout', 'Appearance & layout'), 'textFormat', { keywords: ['font', 'serif', 'mono', 'small text', 'full width', 'contents list', 'page discussions', 'inline comments', 'customize page', 'style'], submenu: appearance })] },
      { items: [item(t('lp.page.use_in_ai', 'Use in AI'), 'aiFace', { keywords: ['skill', 'agent', 'instructions'], submenu: useWithAi })] },
      { items: [
        // toggles suggest mode (features/comments/suggest.ts listens); "Stop" while suggesting
        item(t('lp.page.suggest_edits', 'Suggest edits'), 'commentPencil', { right: <SuggestStop pageId={pageId} />, onSelect: () => { window.dispatchEvent(new CustomEvent('nc:suggest-edits', { detail: { pageId } })); }, disabled: !canEdit && role !== 'comment_only' }),
        item(t('lp.page.notify_me', 'Notify me'), 'bell', { keywords: ['notifications', 'follow', 'subscribe', 'all comments', 'replies', 'mentions'], right: <NotifyLabel pageId={pageId} />, submenu: notify }),
      ] },
      { items: [
        // full-page databases: "Lock database" freezes views and properties, data entry stays open
        item(isDb ? t('lp.page.lock_database', 'Lock database') : t('lp.page.lock_page', 'Lock page'), 'lockOpen', { right: <Switch pageId={pageId} k="block_locked" />, onSelect: keep(() => togglePageSetting(pageId, 'block_locked')), disabled: role !== 'editor' && role !== 'read_and_write' }),
        // Archive / Unarchive (beta on Business / Enterprise): anyone who can edit; pages archived through an
        // ancestor are unarchived there. Unarchive stays available on every plan.
        ...(archived && !archived.direct ? [] : archived
          ? [item(t('lp.page.unarchive', 'Unarchive'), 'archive', { keywords: ['archive', 'restore'], onSelect: () => unarchivePage(pageId), disabled: !canEdit })]
          : archiveAvailable(page) ? [item(t('lp.page.archive', 'Archive'), 'archive', { keywords: ['archive', 'hide', 'old'], onSelect: () => archivePage(pageId), disabled: !canEdit })] : []),
        item(t('lp.page.send_to_trash', 'Send to Trash'), 'trash', { keywords: ['delete', 'remove'], onSelect: () => trashPage(pageId), disabled: !canEdit || (isDb && !!page.format?.block_locked), description: isDb && page.format?.block_locked ? t('lp.page.unlock_this_database_before_moving_it', 'Unlock this database before moving it to Trash.') : undefined }),
      ] },
      { items: [item(t('lp.page.more', 'More'), 'ellipsis', { keywords: ['present', 'translate', 'undo', 'import', 'export', 'pdf', 'markdown', 'html', 'wiki', 'connections', 'mac app'], submenu: more })] },
    ],
    footer: <MenuFooter pageId={pageId} />,
  };
  // the menu opens 8px below the ••• button, right edge 2px inside its right
  // edge; the button keeps its pressed background while the menu is open
  const r = anchor.getBoundingClientRect();
  anchor.classList.add('nc-pressed');
  openMenu(new DOMRect(r.left - 2, r.top, r.width, r.height), def, { placement: 'bottom-end', offset: 8, onClose: () => anchor.classList.remove('nc-pressed') });
}

/** Page archive is a Business / Enterprise feature (beta). */
function archiveAvailable(page: BlockRecord): boolean {
  const plan = records.get<SpaceRecord>('space', page.space_id)?.plan_type;
  return plan === 'business' || plan === 'enterprise';
}

/** Export is off for this user: workspace or teamspace "Disable export" (owners/admins exempt), guests without full access. */
export function exportBlocked(page: BlockRecord): boolean {
  const space = records.get<SpaceRecord>('space', page.space_id);
  const uid = me();
  if (!space || isSpaceAdmin(space, uid)) return false;
  if (space.disable_export) return true;
  if (!isSpaceMember(space, uid)) return records.role('block', page.id) !== 'editor';
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 100 && cur; i++) {
    if (cur.parent_table === 'team') return !!(records.get<TeamRecord>('team', cur.parent_id)?.settings as Record<string, unknown> | undefined)?.disable_export;
    if (cur.parent_table === 'collection') cur = getBlock(records.get<CollectionRecord>('collection', cur.parent_id)?.parent_id);
    else if (cur.parent_table === 'block') cur = getBlock(cur.parent_id);
    else break;
  }
  return false;
}

async function duplicateDatabase(pageId: string, withContent: boolean) {
  try {
    const res = await api<{ blockId: string; recordMap: any }>('duplicateDatabase', { blockId: pageId, withContent });
    records.mergeRecordMap(res.recordMap);
    useUI.getState().toast('Duplicated');
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? 'Could not duplicate');
  }
}

function aiAction(pageId: string, action: string, toast: string) {
  window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { pageId, action } }));
  useUI.getState().toast(toast);
}

export function countWords(pageId: string): number {
  let n = 0;
  const walk = (id: string, root: boolean) => {
    const b = getBlock(id);
    if (!b || !b.alive) return;
    if (!root && (b.type === 'page' || b.type === 'collection_view_page')) return;
    const text = toPlainText(b.properties?.title);
    // Han / Hiragana / Katakana characters count one word each; other text counts space-separated words
    // tokens without a letter or digit ("=", "—") are not words ("const answer = 42;" → 3)
    if (!root) n += (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0) + text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    for (const c of b.content ?? []) walk(c, false);
  };
  walk(pageId, true);
  return n;
}
