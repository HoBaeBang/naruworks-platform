import { HELP_URL } from '@nc/shared/brand.ts';
// Share menu. Share tab: invite by email (members or guests) with a role, people with access (role
// dropdown with "Current access … via …" and Remove), General access (Only people invited / Everyone at
// <workspace> / Anyone on the web with link + role + Link expires), Copy link. Publish tab: "Publish to web"
// card → published state (site URL, Link expires, Search engine indexing, Duplicate as template, Unpublish,
// View site). Permission edits are transactions on block.permissions; invites go through the server.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { afterSaved } from '../comments/comments.tsx';
import type { BlockRecord, Permission, Role, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { pageSlug } from '@nc/shared/ids.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { openMenu, type MenuDef, type MenuItemDef, type MenuSectionDef } from '../../components/Menu.tsx';
import { CONTENT_EDITOR_CAPTION, CONTENT_EDITOR_LABEL, DatabaseShareSection, dbRoleExtras, dbRoleLabel, rolesForPage } from '../database/permissions/share.tsx';
import { ShareGroupRows, ShareGroupSuggestions, UnlinkedBanner, canRemoveInherited, changeInheritedAccess, hideInSearchSection, requestGuestsInstead, restrictGeneralAccess } from '../shell/access/shareAccess.tsx';
import { ShareAgentRows, ShareAgentSuggestions, openAgentAccessSettings } from '../agents/ShareAgents.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api } from '../../lib/api.ts';
import { getBlock, me, run } from '../../lib/blocks.ts';
import { useBlock, useRecord } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';
import { copyPageLink, pageTitle } from './pageActions.ts';
import { confirmDialog } from './confirm.tsx';
import { Toggle } from './ExportDialog.tsx';
import { openEmbedCode, openSiteSettings, siteSettingsOf } from './SiteSettings.tsx';
import { getPref, setPref } from '../editor/prefs.ts';
import './share.css';

type PageRole = 'editor' | 'read_and_write' | 'content_only_editor' | 'comment_only' | 'reader';

export const ROLE_LABEL: Record<string, string> = {
  editor: t('lp.page.full_access', 'Full access'),
  read_and_write: t('lp.page.can_edit', 'Can edit'),
  comment_only: t('lp.page.can_comment', 'Can comment'),
  reader: t('lp.page.can_view', 'Can view'),
  none: t('lp.page.no_access', 'No access'),
  // databases only (features/database/permissions/share.tsx)
  content_only_editor: t('userPermissionsMenu.canEditContentItem.label', CONTENT_EDITOR_LABEL),
};
const ROLE_CAPTION: Record<string, string> = {
  editor: t('lp.page.editing_suggestions_comments_and_sharing', 'Editing, suggestions, comments, and sharing'),
  read_and_write: t('lp.page.editing_suggestions_and_comments', 'Editing, suggestions, and comments'),
  comment_only: t('lp.page.suggest_or_comment', 'Suggest or comment'),
  reader: '',
  content_only_editor: t('userPermissionsMenu.canEditContentItem.caption', CONTENT_EDITOR_CAPTION),
};
const ROLES: PageRole[] = ['editor', 'read_and_write', 'comment_only', 'reader'];

interface SharingModel {
  pageId: string;
  myRole: Role;
  canManage: boolean;
  users: { userId: string; role: PageRole; sourceId: string; inherited: boolean; isGuest: boolean; isRestricted?: boolean; sourceTitle: string }[];
  memberIds: string[];
  /** restricted members among memberIds and why the viewer can't add them directly (null = can) */
  restrictedIds?: string[];
  restrictedAddProblem?: string | null;
  generalAccess: { kind: 'private' | 'workspace' | 'public' | 'team'; role: Role; expiry?: number | null; expired?: boolean; sourceId: string | null; implicit?: boolean; teamName?: string; teamIcon?: string; memberCount?: number };
  published: null | { pageId: string; inherited: boolean; sourceTitle: string; allowDuplicate: boolean; searchIndexing: boolean; expiry: number | null; publishedTime: number | null };
  space: { id: string; name: string; domain: string; icon?: string; allowPublic: boolean };
}

export function publicPath(pageId: string): string {
  const b = getBlock(pageId);
  // a site root with a custom short link (Site customization › Site link)
  const slug = siteSettingsOf(b).slug;
  if (slug && (b?.permissions ?? []).some((p) => p.type === 'public_permission' && p.published)) return `/public/${slug}`;
  return `/public/${pageSlug(pageTitle(b), pageId)}`;
}
export function siteHost(): string {
  return location.host;
}

/** The page itself or nearest ancestor published to the web (Share › Publish), with its permission. */
export function publishedRoot(page: BlockRecord | undefined): { block: BlockRecord; perm: Permission } | null {
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 40 && cur; i++) {
    const perm = (cur.permissions ?? []).find((p) => p.type === 'public_permission' && p.published && (!p.expiry_time || p.expiry_time > Date.now()));
    if (perm) return { block: cur, perm };
    if (cur.parent_table === 'block') cur = getBlock(cur.parent_id);
    else if (cur.parent_table === 'collection') cur = getBlock((records.get('collection', cur.parent_id) as any)?.parent_id);
    else break;
  }
  return null;
}

export type ShareState = 'private' | 'shared' | 'workspace' | 'public' | 'published';

/** Share button state (topbar icon + tooltip), computed from the loaded page and ancestors. */
export function shareStateOf(page: BlockRecord | undefined): ShareState {
  if (!page) return 'private';
  const chain: BlockRecord[] = [];
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 40 && cur; i++) {
    chain.push(cur);
    if (cur.parent_table === 'block') cur = getBlock(cur.parent_id);
    else if (cur.parent_table === 'collection') cur = getBlock((records.get('collection', cur.parent_id) as any)?.parent_id);
    else break;
  }
  const live = (p: Permission) => !p.expiry_time || p.expiry_time > Date.now();
  const perms = chain.flatMap((b) => b.permissions ?? []);
  if (perms.some((p) => p.type === 'public_permission' && p.published && live(p))) return 'published';
  if (perms.some((p) => p.type === 'public_permission' && live(p))) return 'public';
  if (perms.some((p) => p.type === 'space_permission' && p.role !== 'none')) return 'workspace';
  const root = chain[chain.length - 1];
  if (root && (root.parent_table === 'team' || (root.parent_table === 'space' && !root.permissions?.length))) return 'workspace';
  const uid = useSession.getState().userId;
  if (perms.some((p) => p.type === 'user_permission' && p.user_id && p.user_id !== uid)) return 'shared';
  return 'private';
}

const STATE_ICON: Record<ShareState, string | null> = { private: 'lock', shared: null, workspace: null, public: 'globe', published: 'browser' };
const STATE_TIP: Record<ShareState, string> = {
  private: t('lp.page.private_to_you', 'Private to you'),
  shared: t('lp.page.limited_to_invited_people', 'Limited to invited people'),
  workspace: t('lp.page.open_to_all_workspace_members', 'Open to all workspace members'),
  public: t('lp.page.open_to_everyone_who_has_the', 'Open to everyone who has the link'),
  published: t('lp.page.live_on_the_web', 'Live on the web'),
};

/** Topbar "Share" button (icon reflects private / public link / published). */
export function ShareButton({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  const ref = useRef<HTMLDivElement>(null);
  const state = shareStateOf(page);
  const icon = STATE_ICON[state];
  return (
    <div
      ref={ref}
      role="button"
      aria-label={t('lp.page.share', 'Share')}
      aria-haspopup="dialog"
      className="nc-btn lit-topbar-share-menu"
      data-share-state={state}
      data-tooltip={STATE_TIP[state]}
      style={{ fontWeight: 400, gap: 6, color: 'var(--lp-text-primary)' }}
      onClick={() => ref.current && openShareMenu(pageId, ref.current)}
    >
      {icon === 'lock' ? <NarrowLock /> : icon && <Icon name={icon} size={16} style={{ color: 'var(--lp-icon-primary)' }} />}
      {t('lp.page.share', 'Share')}
    </div>
  );
}

/** Padlock drawn in a narrow 12×20 box: the topbar Share button uses a 12.06×20 lock (button 71.3px wide =
 *  8 + 12.06 + 6 + "Share" + 8). */
function NarrowLock() {
  return (
    <LockKeyhole size={20} aria-hidden style={{ width: 12.06, height: 20, display: 'block', flexShrink: 0, color: 'var(--lp-icon-primary)' }} />
  );
}

export function openShareMenu(pageId: string, anchor: HTMLElement, tab: 'share' | 'publish' = 'share') {
  // the Share button keeps its pressed background while the menu is open
  anchor.classList.add('nc-pressed');
  openOverlay((close) => <ShareMenu pageId={pageId} close={close} initialTab={tab} />, { anchor, placement: 'bottom-end', offset: 8, onClose: () => anchor.classList.remove('nc-pressed') });
}

/** Opens the share menu anchored at the topbar Share button (banner "Site settings", menus). */
export function openShareMenuFromTopbar(pageId: string, tab: 'share' | 'publish' = 'share') {
  const el = document.querySelector<HTMLElement>('.lit-topbar-share-menu');
  if (el) openShareMenu(pageId, el, tab);
  else openOverlay((close) => <ShareMenu pageId={pageId} close={close} initialTab={tab} />, { placement: 'center', backdrop: 'dim' });
}

function setPermissions(pageId: string, next: Permission[], action: string) {
  run(action, (tx) => tx.update('block', pageId, [], { permissions: next }));
}

function ShareMenu({ pageId, close, initialTab }: { pageId: string; close: () => void; initialTab: 'share' | 'publish' }) {
  const page = useBlock(pageId);
  const [tab, setTab] = useState<'share' | 'publish'>(initialTab);
  const [model, setModel] = useState<SharingModel | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const res = await api('getPageSharing', { pageId });
      records.mergeRecordMap(res.recordMap);
      setModel(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load sharing settings');
    }
  }, [pageId]);
  // reload whenever the page's permissions change (own edits, other clients)
  const permKey = JSON.stringify(page?.permissions ?? []);
  useEffect(() => {
    // read the server's view only after our own permission edits were saved
    let alive = true;
    afterSaved(() => { if (alive) void refresh(); });
    return () => { alive = false; };
  }, [refresh, permKey]);

  return (
    <PopoverSurface width={456} maxHeight="90vh" className="lit-share-menu nc-share-menu" style={{ borderRadius: 12 }}>
      <div className="nc-share-head">
        <div className="hide-scrollbar nc-share-tabs" role="tablist">
          {(['share', 'publish'] as const).map((k) => (
            <div key={k} className={`nc-share-tab ${tab === k ? 'active' : ''}`}>
              <div role="tab" aria-selected={tab === k} className={`nc-tab ${k === 'publish' ? 'lit-share-menu-publish-tab' : ''}`} onClick={() => setTab(k)}>
                {k === 'share' ? t('lp.page.share', 'Share') : t('lp.page.publish', 'Publish')}
              </div>
            </div>
          ))}
        </div>
        {HELP_URL && <a href={HELP_URL} target="_blank" rel="noreferrer" role="button" className="nc-share-learn">
          <Icon name="questionMark" size={16} style={{ color: 'var(--lp-icon-tertiary)', marginInlineEnd: 6 }} />
          <span>{t('lp.page.sharing_information', 'Sharing information')}</span>
        </a>}
      </div>
      {error && <div className="nc-share-error">{error}</div>}
      {!model ? (
        <div className="nc-share-loading" />
      ) : tab === 'share' ? (
        <ShareTab model={model} page={page} refresh={refresh} close={close} />
      ) : (
        <PublishTab model={model} page={page} />
      )}
    </PopoverSurface>
  );
}

// ------------------------------------------------------------------ Share tab

function ShareTab({ model, page, refresh, close }: { model: SharingModel; page: BlockRecord | undefined; refresh: () => Promise<void>; close: () => void }) {
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [inviteRole, setInviteRole] = useState<PageRole>('editor');
  const [focused, setFocused] = useState(false);
  const uid = useSession((s) => s.userId);
  const pageId = model.pageId;
  const perms = page?.permissions ?? [];
  const list = parseEmails(emails);
  const memberMatches = emails.trim() && !emails.includes(',')
    ? model.memberIds.map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u && u.id !== uid && !model.users.some((x) => x.userId === u.id) && `${u.name} ${u.email}`.toLowerCase().includes(emails.trim().toLowerCase())).slice(0, 5)
    : [];

  const invite = async (extra?: { userIds?: string[] }) => {
    if (!list.length && !extra?.userIds?.length) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api('invitePagePermissions', { pageId, emails: extra?.userIds ? [] : list, userIds: extra?.userIds, role: inviteRole });
      records.mergeRecordMap(res.recordMap);
      setEmails('');
      const first = userName(records.get<UserRecord>('lit_user', res.userIds[0]));
      useUI.getState().toast(res.userIds.length > 1
        ? t('lp.page.gave_access_to_and_numadditionalinvites', 'Gave access to {firstInvitee} and {numAdditionalInvites, plural, one {{numAdditionalInvites} more person} other {{numAdditionalInvites} more people}}', { firstInvitee: first, numAdditionalInvites: res.userIds.length - 1 })
        : t('lp.page.shared_with', 'Shared with {firstInvitee}', { firstInvitee: first }));
      await refresh();
    } catch (e: any) {
      // guests only by request (Settings › Security): share with members, request the guests (features/shell/access/shareAccess.tsx)
      if (await requestGuestsInstead(e, { pageId, emails: list, role: inviteRole, memberIds: model.memberIds })) { setEmails(''); await refresh(); return; }
      // restricted members need a workspace owner's approval (Security › Who can add restricted members to pages)
      if (await requestRestrictedInstead(e, { pageId, emails: extra?.userIds ? [] : list, userIds: extra?.userIds ?? [], role: inviteRole, model })) { setEmails(''); await refresh(); return; }
      setErr(e?.message ?? t('lp.page.couldn_t_process_the_invite', 'Couldn’t process the invite'));
    } finally {
      setBusy(false);
    }
  };

  const changeUserRole = (userId: string, role: PageRole | 'remove') => {
    const rest = perms.filter((p) => !(p.type === 'user_permission' && p.user_id === userId));
    if (role === 'remove') {
      if (userId === uid) {
        void confirmDialog({ message: t('lp.page.remove_your_own_access_to_this', 'Remove your own access to this page?'), confirmLabel: t('lp.page.remove', 'Remove') })
          .then((ok) => { if (ok) setPermissions(pageId, rest, 'removeUserPermission'); });
        return;
      }
      setPermissions(pageId, rest, 'removeUserPermission');
      return;
    }
    // keep a database's "Can also create pages" flag when only the role changes
    const keepCreate = perms.some((p) => p.type === 'user_permission' && p.user_id === userId && p.can_create_pages_in_collection) && (role === 'reader' || role === 'comment_only');
    setPermissions(pageId, [...rest, { type: 'user_permission', role, user_id: userId, added_timestamp: Date.now(), ...(keepCreate ? { can_create_pages_in_collection: true } : {}) }], 'updateUserPermission');
  };

  const setGeneral = (kind: 'private' | 'workspace' | 'public', role?: Role) => {
    if (restrictGeneralAccess(model, kind, role)) return; // inherited general access → "Change and unlink"
    let next = perms.filter((p) => p.type !== 'space_permission' && !(p.type === 'public_permission' && !p.published));
    if (kind === 'workspace') next.push({ type: 'space_permission', role: (role ?? 'read_and_write') as Role, added_timestamp: Date.now() });
    if (kind === 'public') {
      const prev = perms.find((p) => p.type === 'public_permission' && !p.published);
      next.push({ type: 'public_permission', role: (role ?? 'reader') as Role, added_timestamp: Date.now(), ...(prev?.expiry_time ? { expiry_time: prev.expiry_time } : {}) });
    }
    if (kind === 'private' && !next.some((p) => p.type === 'user_permission' && p.user_id === me())) {
      next = [...next, { type: 'user_permission', role: 'editor', user_id: me(), added_timestamp: Date.now() }];
    }
    setPermissions(pageId, next, 'updateGeneralAccess');
  };

  const setLinkExpiry = (ms: number | null) => {
    setPermissions(pageId, perms.map((p) => (p.type === 'public_permission' && !p.published ? { ...p, expiry_time: ms ?? undefined } : p)), 'updateLinkExpiry');
  };

  const roleMenu = (anchor: HTMLElement, cur: string, onPick: (r: PageRole | 'remove') => void, opts?: { remove?: boolean; current?: string; allowed?: PageRole[]; extra?: MenuSectionDef[] }) => {
    const sections = [];
    if (opts?.current) sections.push({ title: 'Current access', items: [{ label: ROLE_LABEL[cur] ?? cur, description: opts.current, disabled: true, render: () => (
      <div className="nc-menu-item-inner" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, cursor: 'default' }}>
        <div style={{ fontSize: 14 }}>{ROLE_LABEL[cur]}</div>
        <div style={{ fontSize: 12, color: 'var(--lp-text-secondary)' }} dangerouslySetInnerHTML={{ __html: opts.current! }} />
      </div>
    ) }] as MenuItemDef[] });
    sections.push({
      title: opts?.current ? 'User access' : undefined,
      items: (opts?.allowed ?? (rolesForPage(page) as PageRole[])).map((r) => ({ label: ROLE_LABEL[r], description: ROLE_CAPTION[r] || undefined, checked: r === cur, onSelect: () => onPick(r) })) as MenuItemDef[],
    });
    if (opts?.extra) sections.push(...opts.extra);
    if (opts?.remove) sections.push({ items: [{ label: t('lp.page.remove', 'Remove'), icon: 'trash', onSelect: () => onPick('remove') }] as MenuItemDef[] });
    openInnerMenu(anchor, { width: 280, sections }, { placement: 'bottom-end' });
  };

  const ga = model.generalAccess;
  const spaceName = model.space.name || 'workspace';
  const gaItems: { kind: 'private' | 'workspace' | 'public'; label: string; icon: string }[] = [
    { kind: 'private', label: t('lp.page.only_invited_people', 'Only invited people'), icon: 'lockFill' },
    { kind: 'workspace', label: t('lp.page.everyone_at', 'Everyone at {workspaceName}', { workspaceName: spaceName }), icon: 'workspace' },
    { kind: 'public', label: t('lp.page.anyone_online_who_has_the_link', 'Anyone online who has the link'), icon: 'globe' },
  ];
  const gaKind = ga.kind === 'team' ? 'workspace' : ga.kind;
  const gaCur = gaItems.find((g) => g.kind === gaKind)!;
  const gaInheritedFrom = ga.sourceId && ga.sourceId !== pageId ? getBlock(ga.sourceId) : undefined;
  const expiryLabel = ga.kind === 'public' && ga.expiry ? (ga.expired ? 'Expired' : `Expires ${new Date(ga.expiry).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`) : t('lp.page.never', 'Never');
  const plan = (records.get<SpaceRecord>('space', model.space.id)?.plan_type ?? 'free') as string;

  return (
    <div className="nc-share-body">
      <div className="nc-share-invite-row">
        <div className={`nc-share-invite-input ${focused ? 'focused' : ''}`}>
          <input
            autoFocus
            placeholder={t('lp.page.emails_or_groups_separated_by_commas', 'Emails or groups, separated by commas')}
            value={emails}
            disabled={!model.canManage}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => { setEmails(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void invite(); } }}
          />
          {list.length > 0 && (
            <div role="button" className="nc-share-invite-role" onClick={(e) => roleMenu(e.currentTarget, inviteRole, (r) => r !== 'remove' && setInviteRole(r))}>
              {ROLE_LABEL[inviteRole]}<Icon name="chevronDown" size={12} />
            </div>
          )}
        </div>
        {/* the blue button stays solid with an empty field; it just does nothing then */}
        <button
          role="button"
          className="nc-dialog-btn primary nc-share-invite-btn"
          disabled={!model.canManage || busy}
          data-tooltip={!model.canManage ? t('lp.page.only_people_with_full_access_can', 'Only people with full access can add others.') : undefined}
          onClick={() => void invite()}
        >
          {t('lp.page.share', 'Share')}
        </button>
      </div>
      <div className="nc-share-spacer" />
      {memberMatches.length > 0 && (
        <div className="nc-share-suggestions">
          {memberMatches.map((u) => {
            const restricted = !!model.restrictedIds?.includes(u.id);
            // Security › "Who can add restricted members to pages" = Workspace owners: the person can't be added from here
            const blocked = restricted && !!model.restrictedAddProblem && !/approve/i.test(model.restrictedAddProblem);
            const tip = restricted && model.restrictedAddProblem
              ? blocked
                ? t('lp.page.your_permissions_don_t_allow_adding', 'Your permissions don’t allow adding restricted members to this page')
                : t('lp.page.a_workspace_owner_must_approve_this', 'A workspace owner must approve this restricted member first')
              : undefined;
            return (
              <div key={u.id} role="button" aria-disabled={blocked || undefined} data-tooltip={tip} className={`nc-share-row hoverable${blocked ? ' disabled' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { if (!blocked) void invite({ userIds: [u.id] }); }}>
                <UserAvatar userId={u.id} size={24} />
                <div className="who">
                  <div className="name nc-ellipsis">
                    <span className="nc-ellipsis">{userName(u)}</span>
                    {restricted && <RestrictedBadge user={u} />}
                  </div>
                  <div className="email nc-ellipsis">{u.email}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ShareGroupSuggestions model={model} query={emails} role={inviteRole} onInvited={() => { setEmails(''); void refresh(); }} />
      <ShareAgentSuggestions pageId={pageId} query={emails} onInvited={() => setEmails('')} />
      {err && <div className="nc-share-error inline">{err}</div>}
      <UnlinkedBanner model={model} />
      <div className="nc-share-people">
        {model.users.map((u) => {
          const user = records.get<UserRecord>('lit_user', u.userId);
          const via = u.sourceId === pageId ? 'user access' : 'access';
          return (
            <div key={u.userId} role="button" className="nc-share-row person" data-user-id={u.userId}>
              <UserAvatar userId={u.userId} size={32} />
              <div className="who">
                <div className="name nc-ellipsis">
                  {/* "Name (You)" is one inline run (a space, not the 6px flex gap) */}
                  <span className="nc-ellipsis">{userName(user)}{u.userId === uid && <span className="you"> {t('lp.page.you', '(You)')}</span>}</span>
                  {u.isGuest && <span className="guest">{t('lp.page.guest', 'Guest')}</span>}
                  {u.isRestricted && user && <RestrictedBadge user={user} />}
                </div>
                <div className="email nc-ellipsis">{user?.email}</div>
              </div>
              <div
                role="button"
                className={`nc-share-role ${model.canManage ? '' : 'disabled'}`}
                onClick={(e) => model.canManage && roleMenu(e.currentTarget, u.role, (r) => (u.inherited && u.userId !== uid ? void changeInheritedAccess(pageId, { userId: u.userId }, r) : changeUserRole(u.userId, r)), {
                  remove: !u.inherited || canRemoveInherited(u.userId), current: `via <b>${via} on ${escapeHtml(u.sourceTitle || 'Untitled')}</b>`, extra: u.inherited ? undefined : dbRoleExtras(page, { type: 'user', userId: u.userId }),
                })}
              >
                <span className="nc-ellipsis">{(!u.inherited && dbRoleLabel(page, { type: 'user', userId: u.userId })) || ROLE_LABEL[u.role]}</span>
                <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
              </div>
            </div>
          );
        })}
        <ShareGroupRows model={model} />
        <ShareAgentRows pageId={pageId} canManage={model.canManage} />
      </div>
      <div className="nc-share-spacer" />
      <div className="nc-share-general">
        <div className="nc-share-section-title">{t('lp.page.general_access', 'General access')}</div>
        <div role="button" className="nc-share-row general lit-block-permission-settings-workspace-access">
          <div className="nc-share-ga-icon"><Icon name={ga.kind === 'team' ? 'peopleShared' : gaCur.icon} size={18} style={{ color: 'var(--lp-icon-secondary)' }} /></div>
          <div className="who">
            <div
              role="button"
              className={`nc-share-ga-btn ${model.canManage ? '' : 'disabled'}`}
              onClick={(e) => model.canManage && openInnerMenu(e.currentTarget, {
                width: 280,
                sections: [{ items: gaItems.map((g) => ({
                  label: g.label, icon: g.icon, checked: g.kind === gaKind,
                  disabled: g.kind === 'public' && !model.space.allowPublic,
                  onSelect: () => setGeneral(g.kind, g.kind === 'workspace' ? 'read_and_write' : g.kind === 'public' ? 'reader' : undefined),
                })) }],
              }, { placement: 'bottom-start' })}
            >
              <span>{ga.kind === 'team' ? t('lp.page.people_in', 'People in {teamName}', { teamName: ga.teamName ?? '' }) : gaCur.label}</span>
              <Icon name="chevronDown" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
            {gaInheritedFrom && <div className="email">From {pageTitle(gaInheritedFrom) || 'Untitled'}</div>}
            {ga.kind === 'public' && <div className="email">{t('lp.page.whoever_has_the_link_sees_the', 'Whoever has the link sees the content along with contributor names.')}</div>}
          </div>
          {gaKind !== 'private' && ga.kind !== 'team' && (
            <div role="button" className={`nc-share-role ${model.canManage ? '' : 'disabled'}`}
              onClick={(e) => model.canManage && roleMenu(e.currentTarget, ga.role, (r) => r !== 'remove' && setGeneral(gaKind, r), { allowed: gaKind === 'public' ? ['read_and_write', 'comment_only', 'reader'] : (rolesForPage(page) as PageRole[]), extra: gaKind === 'workspace' && ga.sourceId === pageId ? [...(dbRoleExtras(page, { type: 'space' }) ?? []), ...hideInSearchSection(pageId)] : undefined })}>
              <span>{(gaKind === 'workspace' && ga.sourceId === pageId && dbRoleLabel(page, { type: 'space' })) || (ROLE_LABEL[ga.role] ?? ga.role)}</span>
              <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
          )}
        </div>
        {ga.kind === 'public' && (
          <div className="nc-share-row sub">
            <div className="label">{t('lp.page.link_expires', 'Link expires')}{plan === 'free' && <span className="nc-plan-badge">Plus</span>}</div>
            <div role="button" className={`nc-share-role ${model.canManage && plan !== 'free' ? '' : 'disabled'}`}
              data-tooltip={plan === 'free' ? 'Upgrade to Plus to set link expiration' : undefined}
              onClick={(e) => model.canManage && plan !== 'free' && expiryMenu(e.currentTarget, setLinkExpiry)}>
              <span>{expiryLabel}</span>
              <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
          </div>
        )}
      </div>
      {ga.kind === 'public' && ga.role === 'comment_only' && (
        // anyone on the web with the link (and signed in) can comment
        <div className="nc-share-public-comments" role="note">
          <Icon name="comment" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
          <span>{t('lp.page.anyone_on_the_web_can_comment', 'Anyone on the web can comment on this page')}</span>
        </div>
      )}
      <DatabaseShareSection page={page} canManage={model.canManage} />
      <div className="nc-share-footer">
        <div role="button" className="nc-share-advanced" onClick={(e) => openAgentAccessSettings(e.currentTarget, pageId, model.canManage)}>
          <Icon name="gear" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
          <span>{t('lp.page.advanced', 'Advanced')}</span>
        </div>
        <button role="button" className="nc-dialog-btn outline nc-share-copy" onClick={() => { copyPageLink(pageId); close(); }}>
          <Icon name="link" size={17} className="nc-share-copy-icon" style={{ color: 'var(--lp-icon-secondary)' }} />
          {t('lp.page.copy_link', 'Copy link')}
        </button>
      </div>
      <AgentAccessBanner />
    </div>
  );
}

/** "Control agent access in Advanced": blue 44px card under the footer
 *  row until dismissed (remembered per user on this device). */
function AgentAccessBanner() {
  const [hidden, setHidden] = useState(() => getPref<boolean>('shareMenuAgentAccessBannerDismissed') === true);
  if (hidden) return null;
  return (
    <div className="nc-share-banner-wrap">
      <div className="nc-share-banner">
        <div className="text">{t('lp.page.adjust_agent_permissions_under_advanced', 'Adjust agent permissions under Advanced')}</div>
        <div
          role="button"
          aria-label={t('lp.page.dismiss', 'Dismiss')}
          className="dismiss"
          onClick={() => { setPref('shareMenuAgentAccessBannerDismissed', true); setHidden(true); }}
        >
          <Icon name="close" size={14} />
        </div>
      </div>
    </div>
  );
}

/** A dropdown inside the Share menu: picking an item closes only the dropdown (the Share menu stays open). */
function openInnerMenu(anchor: HTMLElement, def: MenuDef, opts?: Parameters<typeof openMenu>[2]) {
  let close: () => void = () => {};
  const wrap = (items: MenuItemDef[]): MenuItemDef[] => items.map((it) => (it.onSelect && !it.submenu
    ? { ...it, onSelect: () => { close(); setTimeout(() => void it.onSelect!(), 0); return false; } }
    : it));
  close = openMenu(anchor, { ...def, sections: def.sections.map((sec) => ({ ...sec, items: wrap(sec.items) })) }, opts);
}

function expiryMenu(anchor: HTMLElement, onPick: (ms: number | null) => void) {
  const now = Date.now();
  openInnerMenu(anchor, {
    width: 220,
    sections: [{ items: [
      { label: t('lp.page.never', 'Never'), onSelect: () => onPick(null) },
      { label: t('lp.page.in_one_hour', 'In one hour'), onSelect: () => onPick(now + 3600_000) },
      { label: t('lp.page.in_one_day', 'In one day'), onSelect: () => onPick(now + 86400_000) },
      { label: t('lp.page.in_one_week', 'In one week'), onSelect: () => onPick(now + 7 * 86400_000) },
    ] }],
  }, { placement: 'bottom-end' });
}

function parseEmails(s: string): string[] {
  return s.split(/[,\s;]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------ Publish tab

export function publishPage(pageId: string, publish: boolean) {
  const page = getBlock(pageId);
  if (!page) return;
  const perms = page.permissions ?? [];
  const rest = perms.filter((p) => !(p.type === 'public_permission' && p.published));
  if (!publish) {
    setPermissions(pageId, rest, 'unpublishPage');
    return;
  }
  setPermissions(pageId, [...rest, {
    type: 'public_permission', role: 'reader', published: true, published_time: Date.now(), published_by_id: me(), added_timestamp: Date.now(),
    allow_duplicate: false, allow_search_engine_indexing: false,
  }], 'publishPage');
}

/** Settings › Security › Disable publishing (workspace) or the teamspace's own setting. */
function publishBlockedBy(page: BlockRecord | undefined): 'workspace' | 'team' | null {
  if (!page) return null;
  const space = records.get<SpaceRecord>('space', page.space_id);
  if (space?.disable_public_access) return 'workspace';
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 40 && cur; i++) {
    if (cur.parent_table === 'team') return (records.get<TeamRecord>('team', cur.parent_id)?.settings as Record<string, unknown> | undefined)?.disable_public_access ? 'team' : null;
    cur = cur.parent_table === 'block' ? getBlock(cur.parent_id) : cur.parent_table === 'collection' ? getBlock((records.get('collection', cur.parent_id) as any)?.parent_id) : undefined;
  }
  return null;
}

function updatePublished(pageId: string, patch: Partial<Permission>) {
  const page = getBlock(pageId);
  if (!page) return;
  setPermissions(pageId, (page.permissions ?? []).map((p) => (p.type === 'public_permission' && p.published ? { ...p, ...patch } : p)), 'updatePublishSettings');
}

function PublishTab({ model, page }: { model: SharingModel; page: BlockRecord | undefined }) {
  const pageId = model.pageId;
  const title = pageTitle(page) || 'Untitled';
  const pub = model.published;
  const creator = useRecord<UserRecord>('lit_user', page?.created_by_id);
  void creator;
  if (!model.canManage && !pub) {
    return (
      <div className="nc-publish-body center">
        <div className="nc-publish-title">{t('lp.page.full_access_is_required_to_publish', 'Full access is required to publish')}</div>
        <div className="nc-publish-sub">{t('lp.page.to_change_this_reach_out_to', 'To change this, reach out to someone who has full access')}</div>
      </div>
    );
  }
  if (!pub && publishBlockedBy(page)) {
    const by = publishBlockedBy(page);
    return (
      <div className="nc-publish-body center">
        <div className="nc-publish-title">{by === 'team' ? t('lp.page.publishing_is_disabled_in_this_team', 'Publishing is disabled in this team') : t('lp.page.this_workspace_doesn_t_allow_publishing', 'This workspace doesn’t allow publishing')}</div>
        <div className="nc-publish-sub">{by === 'team' ? t('lp.page.ask_a_team_owner_to_change', 'Ask a team owner to change this setting') : t('lp.page.to_change_this_reach_out_to_ac70', 'To change this, reach out to a workspace owner')}</div>
      </div>
    );
  }
  if (page && !page.alive) {
    return (
      <div className="nc-publish-body center">
        <div className="nc-publish-title">{t('lp.page.you_can_t_publish_a_page', 'You can’t publish a page that’s in Trash')}</div>
        <div className="nc-publish-sub">{t('lp.page.to_put_this_page_on_the', 'To put this page on the web, restore it first')}</div>
      </div>
    );
  }
  if (!pub) {
    return (
      <div className="nc-publish-body center">
        <div className="nc-publish-heading">
          <div className="nc-publish-title">{t('lp.page.publish_to_the_web', 'Publish to the web')}</div>
          <div className="nc-publish-sub">
            {t('lp.page.build_your_own_site_on_litpage', 'Build your own site on Litpage')}
            {HELP_URL && <a role="button" aria-label={t('lp.page.how_litpage_sites_work', 'How Litpage sites work')} href={HELP_URL} target="_blank" rel="noreferrer" className="nc-publish-help">
              <Icon name="questionMark" size={14} style={{ color: 'var(--lp-icon-tertiary)' }} />
            </a>}
          </div>
        </div>
        <div className="nc-publish-preview" aria-hidden>
          <div className="bar"><i /><i /><i /></div>
          <div className="sep" />
          <div className="mini-top">
            <span className="nc-ellipsis">{title}</span>
            <span style={{ flex: 1 }} />
            <Icon name="search" size={12} />
            <Icon name="ellipsis" size={12} />
            <span className="pill">{t('lp.page.get_litpage_for_free', 'Get Litpage for free')}</span>
          </div>
          <div className="sep" />
          <div style={{ height: 62 }} />
          <div className="page-title nc-ellipsis">{title}</div>
          <div style={{ height: 48 }} />
          <div className="fade" />
        </div>
        <div role="button" className="nc-publish-btn" onClick={() => publishPage(pageId, true)}>{t('lp.page.publish', 'Publish')}</div>
        <div className="nc-publish-note">
          <Icon name="info" size={16} style={{ color: 'var(--lp-icon-tertiary)', flexShrink: 0 }} />
          <span>{t('lp.page.after_this_page_goes_live_on', 'After this page goes live on the web, anyone holding the link can read it and see the names of contributors.')}</span>
        </div>
      </div>
    );
  }
  const url = `${location.origin}${publicPath(pub.pageId)}`;
  const expiry = pub.expiry ? new Date(pub.expiry) : null;
  const plan = (records.get<SpaceRecord>('space', model.space.id)?.plan_type ?? 'plus') as string;
  return (
    <div className="nc-publish-body">
      {pub.inherited && <div className="nc-publish-inherited">{t('lp.page.sharing_and_publishing_here_are_managed', 'Sharing and publishing here are managed on {pageTitle}.', { pageTitle: pub.sourceTitle || 'Untitled' })}</div>}
      <div className="nc-publish-url">
        <Icon name="globe" size={16} style={{ color: 'var(--lp-icon-secondary)', flexShrink: 0 }} />
        <a className="nc-ellipsis" href={url} target="_blank" rel="noreferrer">{url.replace(/^https?:\/\//, '')}</a>
        <div role="button" className="nc-icon-btn" aria-label={t('lp.page.copy_the_site_link', 'Copy the site link')} data-tooltip={t('lp.page.copy_the_site_link', 'Copy the site link')}
          onClick={() => { void navigator.clipboard?.writeText(url); useUI.getState().toast('Link copied'); }}>
          <Icon name="link" size={16} />
        </div>
      </div>
      <div className="nc-publish-settings">
        <div className="nc-setting-row">
          <div className="label">{t('lp.page.link_expires', 'Link expires')}</div>
          <div role="button" className="nc-select-btn" onClick={(e) => expiryMenu(e.currentTarget, (ms) => updatePublished(pub.pageId, { expiry_time: ms ?? undefined }))}>
            {expiry ? expiry.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('lp.page.never', 'Never')}
            <Icon name="chevronDown" size={14} />
          </div>
        </div>
        <div className="nc-setting-row">
          <div className="label">{t('lp.page.web_search_indexing', 'Web search indexing')}</div>
          <Toggle on={pub.searchIndexing} label={t('lp.page.show_up_in_search_engines', 'Show up in search engines')} onChange={(v) => updatePublished(pub.pageId, { allow_search_engine_indexing: v })} />
        </div>
        <div className="nc-setting-row" data-tooltip={t('lp.page.let_people_make_their_own_copy', 'Let people make their own copy of this page')}>
          <div className="label">{t('lp.page.duplicate_as_a_template', 'Duplicate as a template')}</div>
          <Toggle on={pub.allowDuplicate} label={t('lp.page.duplicate_as_a_template', 'Duplicate as a template')} onChange={(v) => updatePublished(pub.pageId, { allow_duplicate: v })} />
        </div>
        <div role="button" className="nc-setting-row clickable" data-tooltip={t('lp.page.put_this_page_on_external_websites', 'Put this page on external websites as an embed')} onClick={(e) => openEmbedCode(e.currentTarget, url)}>
          <div className="label">{t('lp.page.embed_page', 'Embed page')}</div>
          <Icon name="chevronRight" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
        {/* site customization: Plus and above; on the site root (inherited pages edit their root) */}
        <div role="button" className={`nc-setting-row clickable ${model.canManage ? '' : 'disabled'}`}
          data-tooltip={!model.canManage ? t('lp.page.full_access_is_required_to_update', 'Full access is required to update this page’s settings') : undefined}
          onClick={() => {
            if (!model.canManage) return;
            if (plan === 'free') { useUI.getState().toast(t('lp.page.upgrade_to_customize_everything', 'Upgrade to customize everything')); return; }
            openSiteSettings(pub.pageId);
          }}>
          <div className="label">{t('lp.page.customize_site_appearance', 'Customize site appearance')}{plan === 'free' && <span className="nc-plan-badge">Plus</span>}</div>
          <Icon name="chevronRight" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
        <div role="button" className="nc-setting-row clickable" onClick={() => useUI.getState().openSettings('public-pages')}>
          <div className="label">{t('lp.page.manage_every_site_and_link', 'Manage every site and link')}</div>
          <Icon name="chevronRight" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
      </div>
      <div className="nc-publish-actions">
        <button className="nc-dialog-btn outline" disabled={!model.canManage}
          data-tooltip={!model.canManage ? t('lp.page.unpublishing_requires_full_access_to_the', 'Unpublishing requires full access to the page') : undefined}
          onClick={async () => {
            const ok = await confirmDialog({ message: t('lp.page.take_this_site_offline', 'Take this site offline?'), description: t('lp.page.will_be_taken_off_the_web', '{pageTitle} will be taken off the web.', { pageTitle: pub.sourceTitle || title }), confirmLabel: t('lp.page.unpublish', 'Unpublish') });
            if (ok) publishPage(pub.pageId, false);
          }}>
          {t('lp.page.unpublish', 'Unpublish')}
        </button>
        <button className="nc-dialog-btn primary" onClick={() => window.open(url, '_blank')}>{t('lp.page.view_site', 'View site')}</button>
      </div>
    </div>
  );
}

/** "Restricted member" tag next to a person in the people list and invite suggestions. */
function RestrictedBadge({ user }: { user: UserRecord }) {
  const who = user.name && user.email ? `${user.name} (${user.email})` : user.name || user.email || '';
  return (
    <span className="guest restricted" data-tooltip={t('lp.page.this_workspace_lists_as_a_restricted', 'This workspace lists { userNameAndEmail} as a restricted member', { userNameAndEmail: who })}>
      {t('lp.page.restricted_member', 'Restricted member')}
    </span>
  );
}

/** Share with restricted members when owners must approve: everyone else is shared with right away, the restricted
 *  members are requested (toast "Requested access for …"). Returns true when it handled the error. */
async function requestRestrictedInstead(err: unknown, ctx: { pageId: string; emails: string[]; userIds: string[]; role: string; model: SharingModel }): Promise<boolean> {
  if (!/workspace owner must approve/i.test((err as Error)?.message ?? '')) return false;
  const restricted = new Set(ctx.model.restrictedIds ?? []);
  const byEmail = new Map(ctx.model.memberIds.map((id) => [records.get<UserRecord>('lit_user', id)?.email?.toLowerCase() ?? '', id] as const));
  const ids = [...ctx.userIds, ...ctx.emails.map((e) => byEmail.get(e.toLowerCase()) ?? '').filter(Boolean)];
  const asked = ids.filter((id) => restricted.has(id));
  if (!asked.length) return false;
  const others = ids.filter((id) => !restricted.has(id));
  const unknownEmails = ctx.emails.filter((e) => !byEmail.has(e.toLowerCase()));
  try {
    if (others.length || unknownEmails.length) {
      const r = await api<{ recordMap?: unknown }>('invitePagePermissions', { pageId: ctx.pageId, userIds: others, emails: unknownEmails, role: ctx.role });
      if (r.recordMap) records.mergeRecordMap(r.recordMap as never);
    }
    await api('requestRestrictedMemberAccess', { pageId: ctx.pageId, userIds: asked, role: ctx.role });
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? t('lp.page.couldn_t_process_the_invite', 'Couldn’t process the invite'));
    return true;
  }
  const first = userName(records.get<UserRecord>('lit_user', asked[0]));
  useUI.getState().toast(asked.length > 1
    ? t('lp.page.asked_for_approval_to_add_and', 'Asked for approval to add {firstInvitee} and {numAdditionalInvites, plural, one {{numAdditionalInvites} more person} other {{numAdditionalInvites} more people}}', { firstInvitee: first, numAdditionalInvites: asked.length - 1 })
    : t('lp.page.access_requested_for', 'Access requested for {firstInvitee}', { firstInvitee: first }));
  return true;
}
