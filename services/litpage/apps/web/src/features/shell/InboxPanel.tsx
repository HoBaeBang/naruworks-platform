// Inbox (⌘⌥U).
// Docked panel next to the sidebar (x = sidebar width, 390px, full height, z 201, --lp-shadow-basic-large), not dimmed.
// Header: Inbox · Pin · Close («) · Prioritize with AI · Filter notifications · More actions (28×28).
// Feed grouped Today / This week / Last week / Older; inside a section notifications about the same page are one
// item (inbox/grouping.ts: "A, B commented in Page", "N discussions"); request items carry Approve / Deny
// (inbox/rows.tsx). Items: 24px avatar, 14px text (bold actor + page mention), date + blue unread dot, hover action
// bar (notification settings / mark read / archive).
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, NotificationRecord, UserRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, openPage, pageUrl, spaceDomain } from '../../lib/router.ts';
import { compactId } from '@nc/shared/ids.ts';
import { focusDiscussion } from '../comments/comments.tsx';
import { useTableVersion } from '../../lib/hooks.ts';
import { run } from '../../lib/blocks.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { t } from './i18n.ts';
import { pageTitle } from '../page/pageActions.ts';
import { ALL_TYPES, INBOX_MAX_WIDTH, INBOX_MIN_WIDTH, useInboxState, type InboxStatus, type InboxType } from './inbox/inboxState.ts';
import { notifyLevelItems, isDatabaseRow } from './inbox/notifyLevels.ts';
import { groupFeed, type FeedItem, type InboxItem, type TimeGroup } from './inbox/grouping.ts';
import { Avatar, FeedRow, itemDate, PageMention, rich, type RowHandlers } from './inbox/rows.tsx';
import { desktopPushState, enableDesktopPush, installDesktopPush } from './inbox/desktopPush.ts';
import '../search/icons.tsx';
import './inbox.css';

// ---------------- unread badge (sidebar) ----------------
let countTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshInboxCount(): Promise<void> {
  const { spaceId, status } = useSession.getState();
  if (!spaceId || status !== 'ready') return;
  try {
    const res = await api<{ count: number }>('countUnreadInbox', { spaceId });
    useUI.getState().set({ inboxUnread: res.count } as never);
  } catch {
    /* ignore (offline / server restarting) */
  }
}

function scheduleCountRefresh() {
  if (countTimer) clearTimeout(countTimer);
  countTimer = setTimeout(() => void refreshInboxCount(), 300);
}

// realtime: notification records pushed over the websocket → refresh the badge
records.subscribeAll((keys) => {
  if (keys.some((k) => k.startsWith('notification:'))) scheduleCountRefresh();
});
let lastSpace: string | null = null;
useSession.subscribe((s) => {
  if (s.status === 'ready' && s.spaceId && s.spaceId !== lastSpace) {
    lastSpace = s.spaceId;
    void refreshInboxCount();
  }
});
if (useSession.getState().status === 'ready') {
  lastSpace = useSession.getState().spaceId;
  void refreshInboxCount();
}
installDesktopPush();

function groupLabel(g: TimeGroup) {
  switch (g) {
    case 'today':
      return t('lp.shell.today', 'Today');
    case 'thisWeek':
      return t('lp.shell.this_week', 'This week');
    case 'lastWeek':
      return t('lp.shell.last_week', 'Last week');
    default:
      return t('lp.shell.older', 'Older');
  }
}

// ---------------- panel ----------------
interface WorkspaceUpdate {
  pageId: string;
  editorId: string;
  time: number;
  created: boolean;
}

const getN = (id: string) => records.get<NotificationRecord>('notification', id);

export function InboxPanel() {
  const spaceId = useSession((s) => s.spaceId);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const sidebarWidth = useUI((s) => s.sidebarWidth);
  const { status, types, pinned, width } = useInboxState();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [updates, setUpdates] = useState<WorkspaceUpdate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const ver = useTableVersion(['notification', 'block', 'discussion', 'comment']);
  const left = sidebarOpen && window.innerWidth >= 600 ? sidebarWidth : 0;
  const close = () => useUI.getState().set({ inboxOpen: false });

  const load = async () => {
    if (!spaceId) return;
    try {
      const res = await api('getInbox', { spaceId, status, types: types.length === ALL_TYPES.length ? undefined : types });
      records.mergeRecordMap(res.recordMap);
      setItems(res.items ?? []);
      setUpdates(res.updates ?? []);
      useUI.getState().set({ inboxUnread: res.unreadCount } as never);
    } catch {
      /* keep */
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, status, types.join(',')]);

  // new notifications arriving while the panel is open
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | null = null;
    const unsub = records.subscribeAll((keys) => {
      if (!keys.some((k) => k.startsWith('notification:'))) return;
      if (tm) clearTimeout(tm);
      tm = setTimeout(() => void load(), 400);
    });
    return () => {
      unsub();
      if (tm) clearTimeout(tm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, status, types.join(',')]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pinned && !document.querySelector('.lit-overlay-container .nc-overlay')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);

  useEffect(() => {
    const onReload = () => void load();
    window.addEventListener('nc:inbox-reload', onReload);
    return () => window.removeEventListener('nc:inbox-reload', onReload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, status, types.join(',')]);

  // client-side view of the current filter (optimistic read/archive changes re-filter immediately)
  const visible = items.filter((it) => {
    const n = getN(it.id);
    if (!n) return false;
    if (status === 'unread') return !n.read && !n.archived;
    if (status === 'archived') return n.archived;
    return !n.archived;
  });

  const sections = useMemo(
    () => groupFeed(visible, getN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible.map((v) => v.id).join(','), ver],
  );

  // per-item changes are record transactions (optimistic, synced like any other record write)
  const markRead = (ids: string[], read: boolean) => {
    run(read ? 'readNotification' : 'unreadNotification', (tx) => { for (const id of ids) tx.update('notification', id, [], { read }); }, { skipHistory: true });
    scheduleCountRefresh();
  };
  const archive = (ids: string[], archived: boolean) => {
    run(archived ? 'archiveNotification' : 'unarchiveNotification', (tx) => { for (const id of ids) tx.update('notification', id, [], { archived }); }, { skipHistory: true });
    scheduleCountRefresh();
  };

  const openItem = (it: FeedItem, opts?: { discussionId?: string }) => {
    const list = it.ids.map(getN).filter(Boolean) as NotificationRecord[];
    const unread = list.filter((n) => !n.read).map((n) => n.id);
    if (unread.length) markRead(unread, true);
    const n = list[0];
    const a = (n?.activity ?? {}) as { team_id?: string };
    if (!it.pageId && a.team_id) {
      navigate(`/${spaceDomain(spaceId)}/library/teamspaces`);
      if (!useInboxState.getState().pinned) close();
      return;
    }
    const pageId = it.pageId ?? n?.navigable_block_id;
    if (!pageId) return;
    const blockId = n?.navigable_block_id && n.navigable_block_id !== pageId ? n.navigable_block_id : undefined;
    // comments and mentions in comments open their thread (jump to the exact comment)
    const discussionId = opts?.discussionId ?? list.find((x) => x.discussion_id)?.discussion_id;
    if (discussionId) {
      const hash = blockId ? `#${compactId(blockId)}` : '';
      navigate(`${pageUrl(pageId).replace(/#.*$/, '')}?d=${compactId(discussionId)}${hash}`);
      // once the page shows the thread's line, open the thread itself
      let tries = 0;
      const open = () => {
        const d = records.get<{ id: string; parent_id: string; version: number }>('discussion', discussionId);
        if (d && document.querySelector(`.lit-frame [data-block-id="${d.parent_id}"], .lit-frame [data-page-discussions="${d.parent_id}"]`)) focusDiscussion(discussionId, true);
        else if (tries++ < 30) setTimeout(open, 150);
      };
      setTimeout(open, 100);
    } else openPage(pageId, { blockId });
    if (!useInboxState.getState().pinned) close();
  };

  const handlers: RowHandlers = {
    onOpen: openItem,
    onRead: (ids, read) => markRead(ids, read),
    onArchive: (ids, archived) => archive(ids, archived),
    onNotifySettings: (anchor, pageId) => openNotifySettings(anchor, pageId),
  };

  const headerBtn = (label: string, icon: string, onClick: (el: HTMLElement) => void, extra?: string) => (
    <div role="button" aria-label={label} data-tooltip={label} className={`nc-inbox-head-btn ${extra ?? ''}`} onClick={(e) => onClick(e.currentTarget as HTMLElement)}>
      <Icon name={icon} size={20} />
    </div>
  );

  const noTypes = status !== 'workspace' && types.length === 0;
  const empty = loaded && ((status !== 'workspace' && visible.length === 0) || (status === 'workspace' && updates.length === 0));

  return (
    <>
      {!pinned && <div role="presentation" className="nc-inbox-catcher" style={{ left }} onMouseDown={close} />}
      <div role="region" aria-labelledby="nc-inbox-title" className={`nc-inbox-panel ${pinned ? 'pinned' : ''}`} style={{ left, width }}>
        <InboxResizer width={width} />
        <div className="nc-inbox-col">
          <div className="nc-inbox-header">
            <div className="nc-inbox-title-wrap">
              <h2 id="nc-inbox-title" className="nc-inbox-title">{t('lp.shell.inbox', 'Inbox')}</h2>
            </div>
            <div className="nc-inbox-head-actions">
              {headerBtn(pinned ? t('lp.shell.unpin', 'Unpin') : t('lp.shell.pin', 'Pin'), pinned ? 'pinSlash' : 'pin', () => useInboxState.getState().set({ pinned: !pinned }), pinned ? 'on' : '')}
              {headerBtn(t('lp.shell.close', 'Close'), 'arrowChevronDoubleBackward', close)}
              {headerBtn(t('lp.shell.use_ai_to_prioritize', 'Use AI to prioritize'), 'aiFace', () => prioritizeWithAi())}
              {headerBtn(t('lp.shell.filter_notifications', 'Filter notifications'), 'filter', (el) => openFilterMenu(el), status !== 'all' || types.length !== ALL_TYPES.length ? 'on' : '')}
              {headerBtn(t('lp.shell.more_actions', 'More actions'), 'ellipsis', (el) => openMoreMenu(el, spaceId))}
            </div>
          </div>
          <div className={`nc-inbox-divider ${scrolled ? 'shadow' : ''}`} />
          <div className="lit-scroller vertical nc-inbox-scroller" onScroll={(e) => setScrolled((e.currentTarget as HTMLElement).scrollTop > 0)}>
            <div className="nc-inbox-feed-wrap">
              {status === 'workspace' ? (
                <section className="notranslate nc-inbox-feed" role="feed">
                  {updates.map((u) => <UpdateRow key={`${u.pageId}:${u.time}`} u={u} onOpen={() => { openPage(u.pageId); if (!pinned) close(); }} />)}
                </section>
              ) : (
                <section className="notranslate nc-inbox-feed" role="feed">
                  {sections.map((g, gi) => (
                    <div key={g.group}>
                      {gi > 0 && <div style={{ height: 8 }} />}
                      <div className="nc-inbox-group">{groupLabel(g.group)}</div>
                      {g.items.map((it) => <FeedRow key={it.key} item={it} h={handlers} />)}
                    </div>
                  ))}
                </section>
              )}
              {empty && (noTypes ? <NoTypesState /> : <EmptyState status={status} />)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** "Prioritize with AI": opens the Litpage AI panel (nc:ai-open) with a "which should I handle first?" prompt and
 *  the unread Inbox items as context; without a model key the panel shows its connect state. */
function prioritizeWithAi() {
  const me = useSession.getState().userId;
  const unread = records.all<NotificationRecord>('notification')
    .filter((n) => n.user_id === me && !n.read && !n.archived)
    .sort((a, b) => b.created_time - a.created_time)
    .slice(0, 30)
    .map((n) => {
      const actor = records.get<UserRecord>('lit_user', n.actor_id);
      const a = (n.activity ?? {}) as { page_id?: string; text?: string; message?: string };
      const page = records.get<BlockRecord>('block', a.page_id ?? n.navigable_block_id);
      const quote = a.text || a.message;
      return `- ${n.type.replace(/_/g, ' ')} from ${actor?.name || actor?.email || 'someone'}${page ? ` in “${pageTitle(page) || 'Untitled'}”` : ''}${quote ? `: ${String(quote).slice(0, 160)}` : ''}`;
    });
  const query = `${t('lp.shell.which_of_my_unread_notifications_should', 'Which of my unread notifications should I handle first?')}${unread.length ? `\n\n${unread.join('\n')}` : ''}`;
  window.dispatchEvent(new CustomEvent('nc:ai-open', { detail: { query } }));
}

/** Inbox resize handle: a 12px separator ("Resize with left and right arrow keys") on the panel's right edge with a
 * 1px secondary-border line; drag or ←/→ (10px) between 320 and 600. */
function InboxResizer({ width }: { width: number }) {
  const setWidth = (w: number) => useInboxState.getState().set({ width: Math.max(INBOX_MIN_WIDTH, Math.min(INBOX_MAX_WIDTH, Math.round(w))) });
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-valuenow={Math.round(((width - INBOX_MIN_WIDTH) / (INBOX_MAX_WIDTH - INBOX_MIN_WIDTH)) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t('lp.shell.press_the_left_or_right_arrow', 'Press the left or right arrow key to resize')}
      className="nc-inbox-resizer"
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        const onMove = (ev: PointerEvent) => setWidth(startW + (ev.clientX - startX));
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + 10); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(width - 10); }
      }}
    />
  );
}

function EmptyState({ status }: { status: InboxStatus }) {
  return (
    <div className="nc-inbox-empty-state">
      <Icon name="inbox" size={36} style={{ color: 'var(--lp-icon-tertiary)' }} />
      <div className="nc-inbox-empty-title">
        {status === 'archived'
          ? t('lp.shell.anything_you_archive_lands_here', 'Anything you archive lands here')
          : status === 'workspace'
            ? t('lp.shell.no_workspace_activity', 'No workspace activity')
            : t('lp.shell.you_re_up_to_date', 'You’re up to date')}
      </div>
      {status !== 'all' && (
        <div role="button" className="nc-inbox-empty-btn" onClick={(e) => openFilterMenu(e.currentTarget as HTMLElement)}>
          {t('lp.shell.edit_filter', 'Edit filter')}
        </div>
      )}
    </div>
  );
}

function NoTypesState() {
  const { status } = useInboxState();
  return (
    <div className="nc-inbox-empty-state">
      <Icon name="filter" size={32} style={{ color: 'var(--lp-icon-tertiary)' }} />
      <div className="nc-inbox-empty-title">{t('lp.shell.you_haven_t_picked_any_notification', 'You haven’t picked any notification types')}</div>
      <div className="nc-inbox-empty-sub">
        {status === 'archived'
          ? t('lp.shell.archived_notifications_appear_once_you_p', 'Archived notifications appear once you pick one or more types')
          : status === 'unread'
            ? t('lp.shell.unread_notifications_appear_once_you_pic', 'Unread notifications appear once you pick one or more types')
            : t('lp.shell.notifications_appear_once_you_pick_one', 'Notifications appear once you pick one or more types')}
      </div>
      <div role="button" className="nc-inbox-empty-btn" onClick={() => useInboxState.getState().set({ types: ALL_TYPES })}>
        {t('lp.shell.show_every_type', 'Show every type')}
      </div>
    </div>
  );
}

function UpdateRow({ u, onOpen }: { u: WorkspaceUpdate; onOpen: () => void }) {
  const editor = records.get<UserRecord>('lit_user', u.editorId);
  const body = rich('lp.shell.numberofauthors_plural_one_updated_other', '{numberOfAuthors, plural, one {{authorOrAuthors} updated {pageTitle}} other {{authorOrAuthors} updated {pageTitle}}}', {
    authorOrAuthors: <span className="nc-inbox-actor">{editor?.name || editor?.email || t('lp.shell.someone', 'Someone')}</span>,
    pageTitle: <PageMention pageId={u.pageId} />,
  }, { numberOfAuthors: 1 });
  return (
    <article className="nc-inbox-row read">
      <a role="link" href={pageUrl(u.pageId)} className="nc-inbox-link" onClick={(e) => { e.preventDefault(); onOpen(); }}>
        <div className="nc-inbox-item-inner">
          <div className="nc-inbox-item-content">
            <div className="nc-inbox-item-grid">
              <div className="nc-inbox-item-left">
                <Avatar user={editor} />
                <div className="nc-inbox-item-text"><div className="nc-inbox-headline">{body}</div></div>
              </div>
              <div className="nc-inbox-time"><span>{itemDate(u.time)}</span></div>
            </div>
          </div>
        </div>
      </a>
      <div className="nc-inbox-sep" />
    </article>
  );
}

// ---------------- menus ----------------
/** Header buttons stay pressed while their popover is open. */
function pressed(el: HTMLElement) {
  el.classList.add('open');
  return () => el.classList.remove('open');
}

function openFilterMenu(anchor: HTMLElement) {
  openOverlay(() => <FilterMenu />, { anchor: anchor.getBoundingClientRect(), placement: 'bottom-start', offset: 4, onClose: pressed(anchor) });
}

function FilterMenu() {
  const { status, types, set } = useInboxState();
  const statuses: { k: InboxStatus; label: string; icon: string }[] = [
    { k: 'all', label: t('lp.shell.unread_read', 'Unread & read'), icon: 'inbox' },
    { k: 'unread', label: t('lp.shell.unread', 'Unread'), icon: 'markUnread' },
    { k: 'archived', label: t('lp.shell.archived', 'Archived'), icon: 'archiveBox' },
    { k: 'workspace', label: t('lp.shell.all_workspace_activity', 'Activity across this workspace'), icon: 'clock' },
  ];
  const typeRows: { k: InboxType; label: string; icon: string }[] = [
    { k: 'access', label: t('lp.shell.access', 'Access'), icon: 'lockOpen' },
    { k: 'discussions', label: t('lp.shell.discussions', 'Discussions'), icon: 'chatBubbleText' },
    { k: 'mentions', label: t('lp.shell.mentions', 'Mentions'), icon: 'at' },
    { k: 'automations', label: t('lp.shell.automations_runs', 'Automations & runs'), icon: 'aiFace' },
    { k: 'updates', label: t('lp.shell.updates', 'Updates'), icon: 'sparkleBurst' },
    { k: 'workspace', label: t('lp.shell.workspace', 'Workspace'), icon: 'building' },
  ];
  return (
    <PopoverSurface width={260} className="nc-inbox-filter-menu">
      <div className="nc-menu-section" role="radiogroup">
        <div className="nc-menu-section-title">{t('lp.shell.status', 'Status')}</div>
        {statuses.map((s) => (
          <div key={s.k} role="menuitemradio" aria-checked={status === s.k} className="nc-menu-item" onClick={() => set({ status: s.k })}>
            <div className="nc-menu-item-inner">
              <span className={`nc-inbox-radio ${status === s.k ? 'on' : ''}`} />
              <div className="nc-menu-icon"><Icon name={s.icon} size={20} /></div>
              <div className="nc-menu-label nc-ellipsis">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="nc-menu-section">
        <div className="nc-menu-section-title">{t('lp.shell.type', 'Type')}</div>
        {typeRows.map((r) => {
          const on = types.includes(r.k);
          return (
            <div
              key={r.k}
              role="menuitemcheckbox"
              aria-checked={on}
              className="nc-menu-item"
              onClick={() => set({ types: on ? types.filter((x) => x !== r.k) : [...types, r.k] })}
            >
              <div className="nc-menu-item-inner">
                <span className={`nc-inbox-checkbox ${on ? 'on' : ''}`}>{on && <Icon name="check" size={12} />}</span>
                <div className="nc-menu-icon"><Icon name={r.icon} size={20} /></div>
                <div className="nc-menu-label nc-ellipsis">{r.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </PopoverSurface>
  );
}

function openMoreMenu(anchor: HTMLElement, spaceId: string | null) {
  const after = () => { void refreshInboxCount(); window.dispatchEvent(new Event('nc:inbox-reload')); };
  const push = desktopPushState();
  openMenu(anchor.getBoundingClientRect(), {
    width: 220,
    sections: [{
      items: [
        { label: t('lp.shell.mark_all_as_read', 'Clear all unread'), icon: 'check', onSelect: () => void api('markAllNotificationsReadInSpace', { spaceId }).then(after) },
        { label: t('lp.shell.archive_read', 'Archive read'), icon: 'archiveBox', onSelect: () => void api('archiveReadNotifications', { spaceId }).then(after) },
        { label: t('lp.shell.archive_all', 'Archive all'), icon: 'archiveBox', onSelect: () => void api('archiveAllNotifications', { spaceId }).then(after) },
      ],
    }, ...(push === 'default' ? [{
      items: [{ label: t('lp.shell.enable_desktop_notifications', 'Enable desktop notifications'), icon: 'bell', onSelect: () => void enableDesktopPush().then((ok) => useUI.getState().toast(ok ? t('lp.shell.desktop_notifications_are_on', 'Desktop notifications are on') : t('lp.shell.notifications_are_blocked_by_your_browse', 'Notifications are blocked by your browser'))) }],
    }] : [])],
  }, { placement: 'bottom-start', onClose: pressed(anchor) });
}

/** Hover bar › bell: the page's "Notify me" level (database pages add All updates / Important updates). */
function openNotifySettings(anchor: HTMLElement, pageId: string) {
  void api('getPageNotifySettings', { pageId })
    .then((r: { level?: string; recordMap?: unknown }) => {
      const level = r.level ?? 'replies_and_mentions';
      const set = (lv: string) => void api('setPageNotifySettings', { pageId, level: lv }).then((x) => records.mergeRecordMap(x.recordMap)).catch(() => {});
      const items = notifyLevelItems(isDatabaseRow(records.get<BlockRecord>('block', pageId)), level, set);
      openMenu(anchor.getBoundingClientRect(), {
        width: 260,
        sections: [{ title: t('lp.shell.page_notification_settings', 'Page alert settings'), items }],
      }, { placement: 'bottom-end' });
    })
    .catch(() => {});
}
