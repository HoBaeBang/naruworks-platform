import { HELP_URL } from '@nc/shared/brand.ts';
// Settings › People: Members / Guests / Groups tabs with
// counts, search toggle, Add members, and the 35/20/20/25% user table (scrolls inside a 450px viewport).
// Roles change through api('setMemberRole') / api('removeMember'); groups live in space.settings.groups and change
// through api('createGroup' | 'updateGroup' | 'deleteGroup') (group owners, "Let every member create groups").
// Guests can be upgraded to members (Guests / Suggestions), temporary members expire, Recently left (Enterprise)
// transfers a former member's private pages (api/modules/workspace.ts).
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { api } from '../../../lib/api.ts';
import { useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { syncRecords } from '../../../lib/store/sync.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { openTeamspaceSettings } from '../../shell/teamspaces.tsx';
import { t } from '../../shell/i18n.ts';
import { Button, Dropdown, Group, Row, SectionPage, Switch, UserAvatar, confirmDialog, openSubDialog } from '../ui.tsx';
import { canCreateTeamspace, policyTooltip, saveSpaceSettings, spaceApi, spaceSetting, useSpaceAccess } from '../spaceSettings.ts';
import { useSettingsFocus } from '../searchIndex.ts';
import { navigate } from '../../../lib/router.ts';
import { transactions } from '../../../lib/store/transactions.ts';
import { RecentlyLeftAgents } from '../../agents/AgentsAdmin.tsx';

type Tab = 'members' | 'guests' | 'groups' | 'suggestions' | 'recently-left';
type SpaceRole = 'owner' | 'membership_admin' | 'editor' | 'restricted_member';

export interface PermissionGroup {
  id: string;
  name: string;
  member_ids: string[];
  /** group owners manage members, rename, delete */
  owner_ids?: string[];
  created_time: number;
  created_by_id: string;
}

function groupOwners(g: PermissionGroup): string[] {
  return g.owner_ids ?? (g.created_by_id ? [g.created_by_id] : []);
}

function roleLabel(role: string): string {
  if (role === 'owner') return t('lp.settings.workspace_owner_7abc', 'Workspace owner');
  if (role === 'membership_admin') return t('lp.settings.membership_admin_51e1', 'Membership admin');
  if (role === 'restricted_member') return t('lp.settings.restricted_member', 'Restricted member');
  return t('lp.settings.member_6853', 'Member');
}

function user(id: string): UserRecord | undefined {
  return records.get<UserRecord>('lit_user', id);
}

function displayName(u: UserRecord | undefined): string {
  return u?.name || u?.email || '';
}

function toastError(e: unknown) {
  useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
}

export function PeopleSection() {
  const { space, uid, admin, owner, plan } = useSpaceAccess();
  const focus = useSettingsFocus();
  const [tab, setTab] = useState<Tab>(focus.section === 'members' && (focus.tab === 'guests' || focus.tab === 'groups') ? focus.tab : 'members');
  useEffect(() => {
    if (focus.section === 'members' && (focus.tab === 'members' || focus.tab === 'guests' || focus.tab === 'groups')) setTab(focus.tab);
  }, [focus.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [guests, setGuests] = useState<{ userId: string; pageIds: string[] }[] | null>(null);
  const ver = useTableVersion(['lit_user', 'team', 'block']);

  useEffect(() => {
    // People › Guests is for workspace owners and membership admins (server: getWorkspaceGuests)
    if (!space?.id || !admin) return;
    let off = false;
    api<{ guests: { userId: string; pageIds: string[] }[]; recordMap: any }>('getWorkspaceGuests', { spaceId: space.id })
      .then((res) => {
        if (off) return;
        records.mergeRecordMap(res.recordMap);
        setGuests(res.guests);
      })
      .catch(() => !off && setGuests([]));
    return () => { off = true; };
  }, [space?.id, admin]);

  const teams = useMemo(
    () => records.all<TeamRecord>('team').filter((tm) => tm.space_id === space?.id && tm.alive !== false && !tm.archived_by),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [space?.id, ver],
  );
  if (!space) return null;
  const groups = spaceSetting<PermissionGroup[]>(space, 'groups', []);
  const members = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none');
  const needle = q.trim().toLowerCase();
  const matches = (u: UserRecord | undefined) => !needle || displayName(u).toLowerCase().includes(needle) || (u?.email ?? '').toLowerCase().includes(needle);

  const enterprise = plan === 'enterprise';
  const suggestions = suggestedGuests(space, guests ?? []);
  const anyTemporary = members.some((p) => typeof (p as any).expires_at === 'number');
  const memberRows = members
    .map((p) => ({ id: p.user_id!, role: p.role as string, u: user(p.user_id!), expires: (p as any).expires_at as number | undefined }))
    .filter((r) => matches(r.u))
    .sort((a, b) => {
      const c = displayName(a.u).localeCompare(displayName(b.u), undefined, { sensitivity: 'base' });
      return sortAsc ? c : -c;
    });

  return (
    <SectionPage
      title={t('lp.settings.people', 'People')}
      subtitle={t('lp.settings.control_workspace_membership_and_roles', 'Control workspace membership and roles')}
      link={HELP_URL ? { label: t('lp.settings.learn_more', 'Learn more'), href: HELP_URL } : undefined}
    >
      <div className="nc-set-people">
        <div className="nc-set-people-top">
          <a
            className="nc-set-dir-link"
            href={`/${space.domain}/people`}
            onClick={(e) => {
              e.preventDefault();
              useUI.getState().set({ settingsOpen: false });
              navigate(`/${space.domain}/people`);
            }}
          >
            <span>{t('lp.settings.open_the_people_directory', 'Open the people directory')}</span>
            <Icon name="arrowDiagonalUpRightFill" size={12} />
          </a>
        </div>
        <div className="nc-set-people-head">
          <div className="nc-set-tabs" role="tablist">
            {([
              ['members', t('lp.settings.members', 'Members'), members.length],
              ...(admin ? [['guests', t('lp.settings.guests_3c23', 'Guests'), guests?.length ?? 0]] : []),
              ['groups', t('lp.settings.groups', 'Groups'), groups.length],
              ...(admin && !enterprise && suggestions.length ? [['suggestions', t('lp.settings.suggestions', 'Suggestions'), suggestions.length]] : []),
              ...(owner && enterprise ? [['recently-left', t('lp.settings.recently_left', 'Recently left'), undefined]] : []),
            ] as [Tab, string, number | undefined][]).map(([k, label, n]) => (
              <div key={k} role="tab" tabIndex={0} aria-selected={tab === k} className={`nc-set-tab-pill ${tab === k ? 'selected' : ''}`} onClick={() => setTab(k)}>
                <span>{label}</span>
                {n !== undefined && <span className="count">{n}</span>}
              </div>
            ))}
          </div>
          <div className="nc-set-people-actions">
            {searchOpen ? (
              <div className="nc-set-input nc-set-people-search">
                <Icon name="magnifyingGlassSmall" size={16} />
                <input
                  autoFocus
                  aria-label={t('lp.settings.search_here', 'Search here...')}
                  placeholder={t('lp.settings.search_here', 'Search here...')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onBlur={() => { if (!q) setSearchOpen(false); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setSearchOpen(false); } }}
                />
              </div>
            ) : (
              <span role="button" tabIndex={0} className="nc-set-icon-btn lg" aria-label={t('lp.settings.search_here', 'Search here...')} onClick={() => setSearchOpen(true)}>
                <Icon name="magnifyingGlass" size={20} />
              </span>
            )}
            {tab === 'groups'
              ? (admin || !spaceSetting(space, 'restrict_group_creation', false))
                ? <Button variant="primary" onClick={() => openCreateGroup(space)}>{t('lp.settings.add_a_group', 'Add a group')}</Button>
                : <span data-tooltip={t('lp.settings.permission_groups_can_be_added_only', 'Permission groups can be added only by membership admins and workspace owners.')}><Button variant="primary" disabled>{t('lp.settings.add_a_group', 'Add a group')}</Button></span>
              : tab === 'members' || tab === 'guests' ? <Button variant="primary" onClick={() => openAddMembers(space, admin, owner)}>{t('lp.settings.add_members', 'Add members')}</Button> : null}
          </div>
        </div>

        {tab === 'members' && (
          <div className="nc-set-utable" role="table">
            <div className="nc-set-utable-head" role="row">
              <div className="c-user" role="columnheader">
                <span role="button" className="sort" onClick={() => setSortAsc((s) => !s)}>
                  {t('lp.settings.user', 'User')}
                  <Icon name={sortAsc ? 'arrowStraightUpFill' : 'arrowStraightDownFill'} size={12} />
                </span>
              </div>
              <div className="c-col" role="columnheader">{t('lp.settings.teams', 'Teams')}</div>
              <div className="c-col" role="columnheader">{t('lp.settings.groups', 'Groups')}</div>
              <div className="c-role" role="columnheader">{t('lp.settings.role', 'Role')}</div>
            </div>
            <div className="nc-set-utable-body">
              {memberRows.map((r) => (
                <MemberRow key={r.id} space={space} userId={r.id} role={r.role} me={uid} admin={admin} owner={owner} teams={teams} groups={groups} expires={anyTemporary ? r.expires ?? null : undefined} />
              ))}
              {!memberRows.length && <div className="nc-set-empty">{t('lp.settings.no_people_match_your_search', 'No people match your search')}</div>}
            </div>
          </div>
        )}

        {tab === 'guests' && admin && (
          <GuestsTable space={space} admin={admin} guests={(guests ?? []).filter((g) => matches(user(g.userId)))} loading={guests === null} onRemoved={(id) => setGuests((gs) => (gs ?? []).filter((g) => g.userId !== id))} />
        )}

        {tab === 'groups' && <GroupsTab space={space} admin={admin} owner={owner} me={uid} groups={groups.filter((g) => !needle || g.name.toLowerCase().includes(needle) || g.member_ids.some((id) => matches(user(id))))} />}
        {tab === 'suggestions' && <SuggestionsTab space={space} rows={suggestions.filter((g) => matches(user(g.userId)))} onUpgraded={(ids) => setGuests((gs) => (gs ?? []).filter((g) => !ids.includes(g.userId)))} />}
        {tab === 'recently-left' && <RecentlyLeftTab space={space} />}
      </div>
      {owner && <ProfileSettings space={space} />}
    </SectionPage>
  );
}

// ---------------------------------------------------------------------------------------------- members

function MemberRow({ space, userId, role, me, admin, owner, teams, groups, expires }: {
  space: SpaceRecord; userId: string; role: string; me: string; admin: boolean; owner: boolean; teams: TeamRecord[]; groups: PermissionGroup[];
  /** undefined: no temporary members in the workspace (no column); null: permanent member */
  expires?: number | null;
}) {
  const u = user(userId);
  const myTeams = teams.filter((tm) => tm.membership?.some((m) => m.user_id === userId));
  const myGroups = groups.filter((g) => g.member_ids.includes(userId));
  // membership admins can't change owners; nobody changes their own role from here except owners demoting themselves
  const canEdit = admin && (owner || role !== 'owner');

  const listMenu = (anchor: HTMLElement, items: MenuItemDef[]) => openMenu(anchor, { width: 240, maxHeight: 320, sections: [{ items }] }, { placement: 'bottom-start' });

  const roleMenu = (anchor: HTMLElement) => {
    const pick = async (r: SpaceRole) => {
      if (r === role) return;
      try {
        await spaceApi('setMemberRole', { spaceId: space.id, userId, role: r });
      } catch (e) {
        toastError(e);
      }
    };
    const remove = async () => {
      const self = userId === me;
      const ok = await confirmDialog({
        title: self
          ? t('lp.settings.you_re_about_to_leave_the', 'You’re about to leave the {workspaceName} workspace. Continue?', { workspaceName: space.name })
          : t('lp.settings.remove_from', 'Remove {name} from {workspaceName}?', { name: displayName(u), workspaceName: space.name }),
        description: self ? undefined : t('lp.settings.they_will_lose_access_to_all', 'They will lose access to all pages in this workspace, including their private pages.'),
        confirmLabel: self ? t('lp.settings.leave', 'Leave') : t('lp.settings.remove_from_the_workspace', 'Remove from the workspace'),
        danger: true,
      });
      if (!ok) return;
      try {
        if (self) {
          await api('leaveSpace', { spaceId: space.id });
          location.href = '/';
        } else {
          await spaceApi('removeMember', { spaceId: space.id, userId });
        }
      } catch (e) {
        toastError(e);
      }
    };
    const opt = (r: SpaceRole, caption: string, disabled?: boolean): MenuItemDef => ({
      label: roleLabel(r),
      description: caption,
      checked: role === r || (r === 'editor' && !['owner', 'membership_admin', 'restricted_member'].includes(role)),
      disabled,
      onSelect: () => { void pick(r); },
    });
    openMenu(anchor, {
      width: 290,
      sections: [
        {
          items: [
            opt('owner', t('lp.settings.can_invite_people_and_update_settings', 'Can invite people and update settings for the workspace'), !owner),
            opt('membership_admin', t('lp.settings.can_control_who_s_in_the', 'Can control who’s in the workspace and its groups')),
            opt('editor', t('lp.settings.can_t_invite_people_or_update', 'Can’t invite people or update settings for the workspace')),
            // Enterprise: restricted members only see what's shared with them
            ...(space.plan_type === 'enterprise' ? [opt('restricted_member', t('lp.settings.full_members_have_more_permissions_than', 'Full members have more permissions than restricted members.'))] : []),
          ],
        },
        ...(owner && role !== 'owner' && userId !== me ? [{
          items: [{
            label: typeof expires === 'number' ? t('lp.settings.edit_expiration_date', 'Edit expiration date') : t('lp.settings.make_temporary_member', 'Make temporary member'),
            icon: 'calendarRange',
            onSelect: () => { openSubDialog((close) => <ExpirationBody space={space} userId={userId} current={typeof expires === 'number' ? expires : null} close={close} />); },
          }],
        }] : []),
        {
          items: [{
            label: userId === me ? t('lp.settings.leave_workspace', 'Leave workspace') : t('lp.settings.remove_from_the_workspace', 'Remove from the workspace'),
            danger: true,
            onSelect: () => { void remove(); },
          }],
        },
      ],
    }, { placement: 'bottom-end' });
  };

  return (
    <div className="nc-set-utable-row" role="row" data-user-id={userId}>
      <div className="c-user" role="cell">
        <div className="nc-set-user">
          <UserAvatar user={u} size={28} />
          <div className="nc-set-user-text">
            <div className="nc-set-user-name" title={displayName(u)}>{displayName(u)}</div>
            <div className="nc-set-user-email" title={u?.email}>{u?.email}</div>
          </div>
        </div>
      </div>
      <div className="c-col" role="cell">
        {myTeams.length ? (
          <span
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            className="nc-set-cell-btn"
            onClick={(e) => listMenu(e.currentTarget, myTeams.map((tm) => ({ label: tm.name || t('lp.settings.untitled', 'Untitled'), icon: 'teamspace', onSelect: () => { setTimeout(() => openTeamspaceSettings(tm.id, 'members'), 0); } })))}
          >
            {t('lp.settings.count_plural_one_other_7ce3', '{count, plural, one {# workspace team} other {# workspace teams}}', { count: myTeams.length })}
            <Icon name="arrowChevronSingleDownSmall" size={14} />
          </span>
        ) : <span className="nc-set-cell-btn muted" aria-disabled="true">{t('lp.settings.none', 'None')}</span>}
      </div>
      <div className="c-col" role="cell">
        {myGroups.length ? (
          <span
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            className="nc-set-cell-btn"
            onClick={(e) => listMenu(e.currentTarget, myGroups.map((g) => ({ label: g.name || t('lp.settings.untitled', 'Untitled'), icon: 'people' })))}
          >
            {t('lp.settings.count_plural_one_other_184a', '{count, plural, one {# member group} other {# member groups}}', { count: myGroups.length })}
            <Icon name="arrowChevronSingleDownSmall" size={14} />
          </span>
        ) : <span className="nc-set-cell-btn muted" aria-disabled="true">{t('lp.settings.none', 'None')}</span>}
      </div>
      <div className="c-role" role="cell">
        <span
          role="button"
          tabIndex={canEdit ? 0 : -1}
          aria-haspopup="dialog"
          aria-disabled={!canEdit || undefined}
          className={`nc-set-cell-btn ${canEdit ? '' : 'plain'}`}
          onClick={(e) => { if (canEdit) roleMenu(e.currentTarget); }}
        >
          {typeof expires === 'number' ? t('lp.settings.temporary_member', 'Temporary member') : roleLabel(role)}
          {canEdit && <Icon name="arrowChevronSingleDownSmall" size={14} />}
        </span>
        {typeof expires === 'number' && <span className="nc-set-expiry" data-tooltip={t('lp.settings.expiration', 'Expiration')}>{t('lp.settings.text_2bc0', '{date, date, medium}', { date: expires })}</span>}
      </div>
    </div>
  );
}

function ExpirationBody({ space, userId, current, close }: { space: SpaceRecord; userId: string; current: number | null; close: () => void }) {
  const iso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(current ? iso(current) : iso(Date.now() + 30 * 86_400_000));
  const [err, setErr] = useState('');
  const save = async (value: number | null) => {
    try {
      await spaceApi('setMemberExpiration', { spaceId: space.id, userId, expiry: value });
      close();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <h3>{t('lp.settings.edit_expiration_date', 'Edit expiration date')}</h3>
      <div className="desc">{t('lp.settings.loses_access_to_the_workspace_at', '{name} loses access to the workspace at the end of this day (up to one year).', { name: displayName(user(userId)) })}</div>
      <div className="nc-set-input"><input type="date" value={date} min={iso(Date.now() + 86_400_000)} max={iso(Date.now() + 365 * 86_400_000)} onChange={(e) => setDate(e.target.value)} /></div>
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="primary" disabled={!date} onClick={() => void save(new Date(`${date}T23:59:59`).getTime())}>{t('lp.settings.save', 'Save')}</Button>
        {current && <Button onClick={() => void save(null)}>{t('lp.settings.make_permanent_member', 'Make permanent member')}</Button>}
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- guests

function GuestsTable({ space, admin, guests, loading, onRemoved }: { space: SpaceRecord; admin: boolean; guests: { userId: string; pageIds: string[] }[]; loading: boolean; onRemoved: (id: string) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  if (loading) return <div className="nc-set-empty">{t('lp.settings.loading', 'Loading…')}</div>;
  if (!guests.length) return <div className="nc-set-empty">{t('lp.settings.no_guests', 'No guests')}<div className="nc-set-muted">{t('lp.settings.no_guests_in_this_workspace_yet', 'No guests in this workspace yet. Guests are people outside the workspace you share pages with.')}</div></div>;
  const remove = async (userId: string, pageIds: string[]) => {
    const ok = await confirmDialog({
      title: t('lp.settings.remove_from_all_pages', 'Remove {name} from all pages?', { name: displayName(user(userId)) }),
      confirmLabel: t('lp.settings.remove_from_the_workspace', 'Remove from the workspace'),
      danger: true,
    });
    if (!ok) return;
    try {
      await spaceApi('removeGuest', { spaceId: space.id, userId, pageIds });
      onRemoved(userId);
    } catch (e) {
      toastError(e);
    }
  };
  const upgradeRestricted = async (ids: string[]) => {
    const ok = await confirmDialog({
      title: t('lp.settings.convert_count_plural_one_other_into', 'Convert {count} {count, plural, one {guest} other {guests}} into restricted members', { count: ids.length }),
      description: t('lp.settings.turn_these_guests_into_restricted_member', 'Turn these guests into restricted members who have partial access to the workspace.'),
      confirmLabel: t('lp.settings.upgrade_guests', 'Upgrade guests'),
    });
    if (!ok) return;
    try {
      await spaceApi('upgradeGuests', { spaceId: space.id, userIds: ids, role: 'restricted_member' });
      for (const id of ids) onRemoved(id);
      setSel([]);
    } catch (e) {
      toastError(e);
    }
  };
  const upgrade = async (ids: string[]) => {
    const ok = await confirmDialog({
      title: t('lp.settings.count_plural_one_other_7449', '{count, plural, one {Move # guest to member?} other {Move # guests to members?}}', { count: ids.length }),
      description: t('lp.settings.they_ll_become_members_of_with', 'They’ll become members of {workspaceName}, with access to everything members can see. Paid plans bill a seat for each member.', { workspaceName: space.name }),
      confirmLabel: t('lp.settings.upgrade', 'Upgrade'),
    });
    if (!ok) return;
    try {
      await spaceApi('upgradeGuests', { spaceId: space.id, userIds: ids });
      for (const id of ids) onRemoved(id);
      setSel([]);
      useUI.getState().toast(t('lp.settings.count_plural_one_other_536e', '{count, plural, one {Moved # guest to member} other {Moved # guests to members}}', { count: ids.length }));
    } catch (e) {
      toastError(e);
    }
  };
  const all = guests.map((g) => g.userId);
  return (
    <>
      {admin && sel.length > 0 && (
        <div className="nc-set-toolbar nc-set-bulkbar">
          <span className="nc-set-muted">{t('lp.settings.count_plural_one_other_7829', '{count, plural, one {# chosen} other {# chosen}}', { count: sel.length })}</span>
          <Button variant="primary" small onClick={() => void upgrade(sel)}>{t('lp.settings.count_plural_one_other_0722', '{count, plural, one {Move # guest to member} other {Move # guests to members}}', { count: sel.length })}</Button>
          <Button small onClick={() => setSel([])}>{t('lp.settings.clear', 'Clear')}</Button>
        </div>
      )}
      <div className="nc-set-utable" role="table">
        <div className="nc-set-utable-head" role="row">
          <div className="c-user" role="columnheader">
            {admin && <input type="checkbox" aria-label={t('lp.settings.select_all', 'Select all')} checked={sel.length === all.length} onChange={(e) => setSel(e.target.checked ? all : [])} />}
            {t('lp.settings.user', 'User')}
          </div>
          <div className="c-wide" role="columnheader">{t('lp.settings.access', 'Access')}</div>
          <div className="c-role" role="columnheader" />
        </div>
        <div className="nc-set-utable-body">
          {guests.map((g) => {
            const u = user(g.userId);
            const pages = g.pageIds.map((id) => records.get<BlockRecord>('block', id)).filter(Boolean) as BlockRecord[];
            return (
              <div key={g.userId} className="nc-set-utable-row" role="row" data-user-id={g.userId}>
                <div className="c-user" role="cell">
                  <div className="nc-set-user">
                    {admin && <input type="checkbox" aria-label={displayName(u)} checked={sel.includes(g.userId)} onChange={(e) => setSel((l) => (e.target.checked ? [...l, g.userId] : l.filter((x) => x !== g.userId)))} />}
                    <UserAvatar user={u} size={28} />
                    <div className="nc-set-user-text">
                      <div className="nc-set-user-name">{displayName(u)}</div>
                      <div className="nc-set-user-email">{u?.email}</div>
                    </div>
                  </div>
                </div>
                <div className="c-wide" role="cell">
                  <span
                    role="button"
                    tabIndex={0}
                    className="nc-set-cell-btn"
                    onClick={(e) => openMenu(e.currentTarget, {
                      width: 260,
                      maxHeight: 320,
                      sections: [{ items: pages.map((p) => ({ label: titleOf(p), icon: 'page', onSelect: () => { useUI.getState().set({ settingsOpen: false }); location.assign(`/${space.domain}/${p.id.replace(/-/g, '')}`); } })) }],
                    }, { placement: 'bottom-start' })}
                  >
                    {pages.length ? t('lp.settings.count_plural_one_other_5c04', '{count, plural, one {# page item} other {# page items}}', { count: pages.length }) : t('lp.settings.no_pages', 'No pages')}
                    <Icon name="arrowChevronSingleDownSmall" size={14} />
                  </span>
                </div>
                <div className="c-role" role="cell">
                  {admin && (
                    <span className="nc-set-btn-row">
                      <Button small onClick={() => void upgrade([g.userId])}>{t('lp.settings.upgrade', 'Upgrade')}</Button>
                      <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.more', 'More')} onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                        width: 220,
                        sections: [{
                          items: [
                            ...(space.plan_type === 'enterprise' ? [{ label: t('lp.settings.make_restricted_member', 'Make restricted member'), description: t('lp.settings.they_ll_join_this_workspace_as', 'They’ll join this workspace as a restricted member.'), icon: 'personPlus', onSelect: () => { void upgradeRestricted([g.userId]); } }] : []),
                            { label: t('lp.settings.remove_from_the_workspace', 'Remove from the workspace'), icon: 'personRemove', danger: true, onSelect: () => { void remove(g.userId, g.pageIds); } },
                          ],
                        }],
                      }, { placement: 'bottom-end' })}
                      >
                        <Icon name="ellipsisSmall" size={16} />
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Suggestions (non-Enterprise): guests who would be better off as members — on an approved email domain (allowed
 *  domains or a workspace owner's domain) or with access to several pages. */
function suggestedGuests(space: SpaceRecord | undefined, guests: { userId: string; pageIds: string[] }[]): { userId: string; pageIds: string[]; reason: string }[] {
  if (!space) return [];
  const domains = new Set<string>(spaceSetting<string[]>(space, 'allowed_email_domains', []));
  for (const p of space.permissions ?? []) {
    if ((p.role as string) !== 'owner' || !p.user_id) continue;
    const d = (user(p.user_id)?.email ?? '').split('@')[1];
    if (d && !/^(gmail|googlemail|outlook|hotmail|yahoo|icloud|naver|daum|kakao)\./.test(d)) domains.add(d);
  }
  const out: { userId: string; pageIds: string[]; reason: string }[] = [];
  for (const g of guests) {
    const d = (user(g.userId)?.email ?? '').split('@')[1] ?? '';
    if (d && domains.has(d)) out.push({ ...g, reason: t('lp.settings.approved_email_domain', 'Verified email domain') });
    else if (g.pageIds.length >= 3) out.push({ ...g, reason: t('lp.settings.has_access_to_pages', 'Has access to {count} pages', { count: g.pageIds.length }) });
  }
  return out;
}

function SuggestionsTab({ space, rows, onUpgraded }: { space: SpaceRecord; rows: { userId: string; pageIds: string[]; reason: string }[]; onUpgraded: (ids: string[]) => void }) {
  if (!rows.length) return <div className="nc-set-empty">{t('lp.settings.nothing_found', 'Nothing found')}</div>;
  const upgrade = async (ids: string[]) => {
    try {
      await spaceApi('upgradeGuests', { spaceId: space.id, userIds: ids });
      onUpgraded(ids);
      useUI.getState().toast(t('lp.settings.count_plural_one_other_536e', '{count, plural, one {Moved # guest to member} other {Moved # guests to members}}', { count: ids.length }));
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="nc-set-utable" role="table">
      <div className="nc-set-utable-head" role="row">
        <div className="c-user" role="columnheader">{t('lp.settings.user', 'User')}</div>
        <div className="c-wide" role="columnheader">{t('lp.settings.reason', 'Reason')}</div>
        <div className="c-role" role="columnheader" />
      </div>
      <div className="nc-set-utable-body">
        {rows.map((g) => (
          <div key={g.userId} className="nc-set-utable-row" role="row" data-user-id={g.userId}>
            <div className="c-user" role="cell">
              <div className="nc-set-user">
                <UserAvatar user={user(g.userId)} size={28} />
                <div className="nc-set-user-text">
                  <div className="nc-set-user-name">{displayName(user(g.userId))}</div>
                  <div className="nc-set-user-email">{user(g.userId)?.email}</div>
                </div>
              </div>
            </div>
            <div className="c-wide" role="cell"><span className="nc-set-cell-btn plain">{g.reason}</span></div>
            <div className="c-role" role="cell"><Button small variant="primary" onClick={() => void upgrade([g.userId])}>{t('lp.settings.upgrade', 'Upgrade')}</Button></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Recently left (Enterprise): people who left in the last 30 days and still have private pages to hand over. */
function RecentlyLeftTab({ space }: { space: SpaceRecord }) {
  const [rows, setRows] = useState<{ userId: string; leftTime: number; privatePages: number }[] | null>(null);
  const load = () => api<any>('getRecentlyLeft', { spaceId: space.id }).then((r) => { records.mergeRecordMap(r.recordMap); setRows(r.people); }).catch((e) => { toastError(e); setRows([]); });
  useEffect(() => { void load(); }, [space.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const members = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
  const transfer = (anchor: HTMLElement, from: string) => openMenu(anchor, {
    width: 280,
    maxHeight: 320,
    search: t('lp.settings.search_by_name_or_email', 'Find by name or email'),
    sections: [{
      title: t('lp.settings.transfer_private_pages_to', 'Transfer private pages to'),
      items: members.map((id) => ({
        label: displayName(user(id)), text: `${displayName(user(id))} ${user(id)?.email ?? ''}`, icon: <UserAvatar user={user(id)} size={20} />,
        onSelect: () => {
          void spaceApi<{ count: number }>('transferPrivatePages', { spaceId: space.id, fromUserId: from, toUserId: id })
            .then((r) => { useUI.getState().toast(t('lp.settings.count_plural_one_other_to', '{count, plural, one {Transferred # page} other {Transferred # pages}} to {name}', { count: r.count, name: displayName(user(id)) })); void load(); })
            .catch(toastError);
        },
      })),
    }],
  }, { placement: 'bottom-end' });
  return (
    <div>
      <div className="nc-set-row-desc" style={{ marginBottom: 12 }}>{t('lp.settings.former_members_with_pages_you_can', 'Former members with pages you can transfer are listed here for 30 days after they leave')}</div>
      {rows === null ? <div className="nc-set-empty">{t('lp.settings.loading', 'Loading…')}</div> : !rows.length ? <div className="nc-set-empty">{t('lp.settings.no_users_left_recently', 'No users left recently')}</div> : (
        <div className="nc-set-utable" role="table">
          <div className="nc-set-utable-head" role="row">
            <div className="c-user" role="columnheader">{t('lp.settings.user', 'User')}</div>
            <div className="c-col" role="columnheader">{t('lp.settings.left_workspace', 'Left workspace')}</div>
            <div className="c-col" role="columnheader">{t('lp.settings.pages_to_move', 'Pages to move')}</div>
            <div className="c-role" role="columnheader" />
          </div>
          <div className="nc-set-utable-body">
            {rows.map((r) => (
              <div key={r.userId} className="nc-set-utable-row" role="row" data-user-id={r.userId}>
                <div className="c-user" role="cell"><div className="nc-set-user"><UserAvatar user={user(r.userId)} size={28} /><div className="nc-set-user-text"><div className="nc-set-user-name">{displayName(user(r.userId))}</div><div className="nc-set-user-email">{user(r.userId)?.email}</div></div></div></div>
                <div className="c-col" role="cell"><span className="nc-set-cell-btn plain">{new Date(r.leftTime).toLocaleDateString()}</span></div>
                <div className="c-col" role="cell"><span className="nc-set-cell-btn plain">{t('lp.settings.count_plural_one_other_5c04', '{count, plural, one {# page item} other {# page items}}', { count: r.privatePages })}</span></div>
                <div className="c-role" role="cell"><Button small onClick={(e) => transfer(e.currentTarget, r.userId)}>{t('lp.settings.transfer_private_pages', 'Transfer private pages')}</Button></div>
              </div>
            ))}
          </div>
        </div>
      )}
      <RecentlyLeftAgents spaceId={space.id} />
    </div>
  );
}

/** People directory / hover cards / recent activity on profiles (workspace switches; the people directory and hover cards read them). */
function ProfileSettings({ space }: { space: SpaceRecord }) {
  return (
    <Group title={t('lp.settings.profiles', 'Profiles')}>
      <Row
        id="people-directory"
        label={t('lp.settings.people_directory', 'People directory')}
        description={t('lp.settings.turn_on_member_profiles_and_a', 'Turn on member profiles and a people directory in this workspace')}
        control={<Switch label="People directory" checked={spaceSetting<boolean>(space, 'people_profiles_enabled', true) !== false} onChange={(v) => saveSpaceSettings(space.id, { people_profiles_enabled: v })} />}
      />
      <Row
        id="hover-cards"
        label={t('lp.settings.hover_cards', 'Hover cards')}
        description={t('lp.settings.hovering_over_a_name_reveals_that', 'Hovering over a name reveals that person’s profile details')}
        control={<Switch label="Hover cards" checked={spaceSetting<boolean>(space, 'hover_cards_enabled', true) !== false} onChange={(v) => saveSpaceSettings(space.id, { hover_cards_enabled: v })} />}
      />
      <Row
        id="people-activity"
        label={t('lp.settings.add_recent_activity_to_each_person', 'Add recent activity to each person’s profile')}
        description={t('lp.settings.list_the_pages_someone_has_recently', 'List the pages someone has recently created or edited, plus their latest comments')}
        control={<Switch label="Display recent activity on member profiles" checked={spaceSetting<boolean>(space, 'people_activity_enabled', true) !== false} onChange={(v) => saveSpaceSettings(space.id, { people_activity_enabled: v })} />}
      />
    </Group>
  );
}

function titleOf(b: BlockRecord): string {
  const title = (b.properties as any)?.title as [string, unknown?][] | undefined;
  return title?.map((x) => x[0]).join('') || t('lp.settings.untitled', 'Untitled');
}

// ---------------------------------------------------------------------------------------------- groups

function GroupsTab({ space, admin, me, groups }: { space: SpaceRecord; admin: boolean; owner: boolean; me: string; groups: PermissionGroup[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const memberIds = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
  const canManage = (g: PermissionGroup) => admin || groupOwners(g).includes(me);
  const update = async (g: PermissionGroup, patch: { name?: string; memberIds?: string[]; ownerIds?: string[] }) => {
    try {
      await spaceApi('updateGroup', { spaceId: space.id, groupId: g.id, ...patch });
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (g: PermissionGroup) => {
    const ok = await confirmDialog({ title: `${t('lp.settings.delete_group', 'Delete group')} “${g.name}”?`, confirmLabel: t('lp.settings.delete_group', 'Delete group'), danger: true });
    if (!ok) return;
    try {
      await spaceApi('deleteGroup', { spaceId: space.id, groupId: g.id });
    } catch (e) {
      toastError(e);
    }
  };
  const teamFromGroup = (g: PermissionGroup) => {
    const sv = records.all<any>('space_view').find((v) => v.space_id === space.id && v.parent_id === me);
    if (!canCreateTeamspace(space, me) || !sv) {
      useUI.getState().toast(policyTooltip.createTeamspace());
      return;
    }
    const id = newId();
    const now = Date.now();
    const membership = [{ user_id: me, role: 'owner' as const, added_time: now }, ...g.member_ids.filter((u) => u !== me).map((u) => ({ user_id: u, role: 'member' as const, added_time: now }))];
    transactions.run(space.id, 'createTeamFromGroup', (tx) => {
      tx.set('team', id, [], { id, space_id: space.id, name: g.name, description: '', icon: '', team_pages: [], parent_id: space.id, parent_table: 'space', alive: true, membership, settings: { type: 'open', default_page_role: 'editor' }, created_time: now, created_by_id: me });
      tx.listAfter('space_view', sv.id, ['joined_teams'], id);
    }, {});
    useUI.getState().toast(t('lp.settings.created_team', 'Created team {name}', { name: g.name }));
  };
  return (
    <div className="nc-set-groups">
      <div className="nc-set-row-desc" style={{ marginBottom: 12 }}>{t('lp.settings.all_your_groups_live_here_use', 'All your groups live here. Use them to grant access and update team membership for many people at once.')}</div>
      {!groups.length && <div className="nc-set-empty">{t('lp.settings.no_groups_so_far', 'No groups so far')}</div>}
      {groups.map((g) => {
        const expanded = open === g.id;
        const manage = canManage(g);
        const owners = groupOwners(g);
        return (
          <div key={g.id} className="nc-set-group-card" data-group={g.name}>
            <div className="nc-set-group-card-head" role="button" tabIndex={0} onClick={() => setOpen(expanded ? null : g.id)}>
              <span className="nc-set-group-icon">{(g.name || 'G').slice(0, 1).toUpperCase()}</span>
              <span className="nc-set-user-name" style={{ flex: 1 }}>{g.name || t('lp.settings.untitled', 'Untitled')}</span>
              <span className="nc-set-user-email">{t('lp.settings.count_plural_one_other_82b2', '{count, plural, one {# user} other {# users}}', { count: g.member_ids.length })}</span>
              {manage && (
                <span
                  role="button"
                  className="nc-set-icon-btn"
                  aria-label={t('lp.settings.group_settings', 'Group settings')}
                  onClick={(e) => {
                    e.stopPropagation();
                    openMenu(e.currentTarget as HTMLElement, {
                      width: 240,
                      sections: [{
                        items: [
                          { label: t('lp.settings.change_the_group_name', 'Change the group name'), icon: 'pencilSmall', onSelect: () => { openRenameGroup(g, (name) => void update(g, { name })); } },
                          { label: t('lp.settings.create_a_team_from_this_group', 'Create a team from this group'), icon: 'teamspace', disabled: !canCreateTeamspace(space, me), onSelect: () => teamFromGroup(g) },
                          { label: t('lp.settings.delete_group', 'Delete group'), icon: 'trashSmall', danger: true, onSelect: () => { void remove(g); } },
                        ],
                      }],
                    }, { placement: 'bottom-end' });
                  }}
                >
                  <Icon name="ellipsisSmall" size={16} />
                </span>
              )}
              <Icon name="arrowChevronSingleDownSmall" size={14} style={{ transform: expanded ? 'rotate(180deg)' : undefined, color: 'var(--lp-icon-secondary)' }} />
            </div>
            {expanded && (
              <div className="nc-set-group-card-body">
                {g.member_ids.map((id) => (
                  <div key={id} className="nc-set-user" data-member={id}>
                    <UserAvatar user={user(id)} size={22} />
                    <span style={{ flex: 1 }}>{displayName(user(id))}</span>
                    {owners.includes(id) && <span className="nc-set-badge gray">{t('lp.settings.owner', 'Owner')}</span>}
                    {manage && (
                      <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.more', 'More')} onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                        width: 220,
                        sections: [{
                          items: [
                            owners.includes(id)
                              ? { label: t('lp.settings.remove_group_owner', 'Remove group owner'), icon: 'personRemove', onSelect: () => { void update(g, { ownerIds: owners.filter((x) => x !== id) }); } }
                              : { label: t('lp.settings.set_group_as_owner', 'Set group as owner'), icon: 'personPlus', onSelect: () => { void update(g, { ownerIds: [...owners, id] }); } },
                            { label: t('lp.settings.remove_from_the_group', 'Remove from the group'), icon: 'xMarkSmall', danger: true, onSelect: () => { void update(g, { memberIds: g.member_ids.filter((x) => x !== id), ownerIds: owners.filter((x) => x !== id) }); } },
                          ],
                        }],
                      }, { placement: 'bottom-end' })}
                      >
                        <Icon name="ellipsisSmall" size={16} />
                      </span>
                    )}
                  </div>
                ))}
                {manage && (
                  <div>
                    <Button
                      small
                      icon="plusSmall"
                      onClick={(e) => {
                        const rest = memberIds.filter((id) => !g.member_ids.includes(id));
                        openMenu(e.currentTarget, {
                          width: 260,
                          maxHeight: 320,
                          search: t('lp.settings.search_by_name_or_email', 'Find by name or email'),
                          sections: [{ items: rest.map((id) => ({ label: displayName(user(id)), text: `${displayName(user(id))} ${user(id)?.email ?? ''}`, icon: <UserAvatar user={user(id)} size={20} />, onSelect: () => { void update(g, { memberIds: [...g.member_ids, id] }); } })) }],
                        }, { placement: 'bottom-start' });
                      }}
                    >
                      {t('lp.settings.add_members', 'Add members')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {admin && (
        <Row
          id="group-creation"
          label={t('lp.settings.any_member_can_create_groups', 'Any member can create groups')}
          description={t('lp.settings.if_this_is_off_group_creation', 'If this is off, group creation is limited to workspace owners and membership admins')}
          control={<Switch label="Let every member create groups" checked={!spaceSetting(space, 'restrict_group_creation', false)} onChange={(v) => saveSpaceSettings(space.id, { restrict_group_creation: !v })} />}
        />
      )}
    </div>
  );
}

function openCreateGroup(space: SpaceRecord) {
  openRenameGroup(null, (name) => {
    void spaceApi('createGroup', { spaceId: space.id, name }).catch(toastError);
  });
}

function openRenameGroup(g: PermissionGroup | null, onDone: (name: string) => void) {
  openSubDialog((close) => <GroupNameBody initial={g?.name ?? ''} create={!g} close={close} onDone={onDone} />);
}

function GroupNameBody({ initial, create, close, onDone }: { initial: string; create: boolean; close: () => void; onDone: (name: string) => void }) {
  const [v, setV] = useState(initial);
  const submit = () => {
    const name = v.trim();
    if (!name) return;
    onDone(name);
    close();
  };
  return (
    <>
      <h3>{create ? t('lp.settings.add_a_group', 'Add a group') : t('lp.settings.change_the_group_name', 'Change the group name')}</h3>
      <div className="nc-set-input">
        <input autoFocus placeholder={t('lp.settings.untitled', 'Untitled')} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      </div>
      <div className="actions">
        <Button variant="primary" disabled={!v.trim()} onClick={submit}>{create ? t('lp.settings.create_group', 'Create group') : t('lp.settings.save', 'Save')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- add members

const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

function openAddMembers(space: SpaceRecord, admin: boolean, owner = false) {
  openSubDialog((close) => <AddMembersBody space={space} admin={admin} owner={owner} close={close} />);
}

function AddMembersBody({ space, admin, owner, close }: { space: SpaceRecord; admin: boolean; owner: boolean; close: () => void }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<SpaceRole | 'temporary'>('editor');
  const [expiry, setExpiry] = useState(() => new Date(Date.now() + 30 * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const live = records.get<SpaceRecord>('space', space.id) ?? space;
  const linkOn = spaceSetting(live, 'invite_link_enabled', true);
  const code = live.invite_link_code;
  const link = code ? `${location.origin}/invite/${code}` : '';

  // Preferences › Profile discoverability: invitees who allow it show their account name and photo (server decides)
  const [known, setKnown] = useState<Record<string, { name?: string; profilePhoto?: string }>>({});
  useEffect(() => {
    const unknown = emails.filter((e) => !(e in known));
    if (!unknown.length) return;
    let live = true;
    api<{ invitees: { email: string; name?: string; profilePhoto?: string }[] }>('lookupInvitees', { spaceId: space.id, emails: unknown })
      .then((r) => { if (live) setKnown((k) => ({ ...k, ...Object.fromEntries(r.invitees.map((x) => [x.email, { name: x.name, profilePhoto: x.profilePhoto }])) })); })
      .catch(() => {});
    return () => { live = false; };
  }, [emails.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitDraft = (text = draft) => {
    const parts = text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const good = parts.filter((p) => EMAIL_RE.test(p));
    if (good.length) setEmails((list) => [...new Set([...list, ...good])]);
    setDraft(parts.filter((p) => !EMAIL_RE.test(p)).join(' '));
  };
  const submit = async () => {
    const all = [...new Set([...emails, ...draft.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s))])];
    if (!all.length) {
      setErr(t('lp.settings.enter_at_least_one_valid_email', 'Enter at least one valid email address.'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      if (admin) {
        const res = await api<{ userIds: string[] }>('inviteMembers', { spaceId: space.id, emails: all, role: role === 'temporary' ? 'editor' : role });
        // Temporary member: a member with an expiration date (People › Edit expiration date)
        if (role === 'temporary') for (const id of res.userIds) await api('setMemberExpiration', { spaceId: space.id, userId: id, expiry: new Date(`${expiry}T23:59:59`).getTime() });
        await syncRecords([{ table: 'space', id: space.id }, ...res.userIds.map((id) => ({ table: 'lit_user', id }))]);
        useUI.getState().toast(t('lp.settings.count_plural_one_other_1694', '{count, plural, one {Added # user} other {Added # users}}', { count: res.userIds.length }));
      } else {
        await spaceApi('requestMembers', { spaceId: space.id, emails: all });
        useUI.getState().toast(t('lp.settings.request_sent_to_workspace_owners', 'Request sent to workspace owners'));
      }
      close();
    } catch (e: any) {
      setErr(e?.message ?? 'We hit a problem while processing that request.');
      setBusy(false);
    }
  };
  return (
    <div className="nc-set-add-members">
      <h3>{t('lp.settings.add_members', 'Add members')}</h3>
      <div className="nc-set-input nc-set-chip-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
        {emails.map((em) => {
          const who = known[em];
          return (
            <span key={em} className="nc-set-chip" title={who?.name ? em : undefined} data-email={em}>
              {who?.name ? <><UserAvatar user={{ name: who.name, email: em, profile_photo: who.profilePhoto }} size={16} />{who.name}</> : em}
              <span role="button" className="x" aria-label="Remove" onClick={() => setEmails((l) => l.filter((x) => x !== em))}><Icon name="xMarkSmall" size={14} /></span>
            </span>
          );
        })}
        <input
          autoFocus
          aria-label={t('lp.settings.search_by_name_or_email', 'Find by name or email')}
          placeholder={emails.length ? '' : t('lp.settings.email_comma_separated', 'Email, comma separated')}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (/[\s,;]$/.test(v)) commitDraft(v);
            else setDraft(v);
          }}
          onPaste={(e) => {
            e.preventDefault();
            commitDraft(`${draft} ${e.clipboardData.getData('text')}`);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (draft.trim()) commitDraft();
              else void submit();
            }
            if (e.key === 'Backspace' && !draft && emails.length) setEmails((l) => l.slice(0, -1));
          }}
        />
      </div>
      {admin ? (
        <div className="nc-set-row">
          <div className="nc-set-row-text"><div className="nc-set-row-label">{t('lp.settings.role', 'Role')}</div></div>
          <div className="nc-set-row-control">
            <Dropdown
              width={290}
              value={role}
              onChange={setRole}
              options={[
                { value: 'editor', label: roleLabel('editor'), description: t('lp.settings.can_t_invite_people_or_update', 'Can’t invite people or update settings for the workspace') },
                { value: 'membership_admin', label: roleLabel('membership_admin'), description: t('lp.settings.can_control_who_s_in_the', 'Can control who’s in the workspace and its groups') },
                { value: 'owner', label: roleLabel('owner'), description: t('lp.settings.can_invite_people_and_update_settings', 'Can invite people and update settings for the workspace') },
                ...(owner ? [{ value: 'temporary' as const, label: t('lp.settings.temporary_member', 'Temporary member'), description: t('lp.settings.member_access_that_ends_on_an', 'Member access that ends on an expiration date (up to one year)') }] : []),
                ...(space.plan_type === 'enterprise' ? [{ value: 'restricted_member' as const, label: roleLabel('restricted_member'), description: t('lp.settings.full_members_have_more_permissions_than', 'Full members have more permissions than restricted members.') }] : []),
              ]}
            />
          </div>
        </div>
      ) : (
        <div className="desc">{t('lp.settings.only_workspace_owners_can_add_members', 'Only workspace owners can add members. Your request will be sent to them for approval.')}</div>
      )}
      {admin && role === 'temporary' && (
        <div className="nc-set-row">
          <div className="nc-set-row-text"><div className="nc-set-row-label">{t('lp.settings.expiration', 'Expiration')}</div></div>
          <div className="nc-set-row-control"><div className="nc-set-input"><input type="date" aria-label={t('lp.settings.expiration', 'Expiration')} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div></div>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>{admin ? t('lp.settings.invite', 'Invite') : t('lp.settings.send_request', 'Send request')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
      {admin && <InviteLinkBox space={live} link={link} enabled={linkOn} />}
    </div>
  );
}

function InviteLinkBox({ space, link, enabled }: { space: SpaceRecord; link: string; enabled: boolean }) {
  const [, force] = useState(0);
  const toggle = async (v: boolean) => {
    try {
      await spaceApi('setInviteLinkEnabled', { spaceId: space.id, enabled: v });
      force((n) => n + 1);
    } catch (e) {
      toastError(e);
    }
  };
  const reset = async () => {
    try {
      await spaceApi('resetInviteLink', { spaceId: space.id });
      force((n) => n + 1);
      useUI.getState().toast(t('lp.settings.invite_link_reset', 'Invitation link reset'));
    } catch (e) {
      toastError(e);
    }
  };
  const live = records.get<SpaceRecord>('space', space.id) ?? space;
  const url = live.invite_link_code ? `${location.origin}/invite/${live.invite_link_code}` : link;
  const on = spaceSetting(live, 'invite_link_enabled', true);
  return (
    <div className="nc-set-invite-box">
      <div className="nc-set-row-text">
        <div className="nc-set-row-label">{t('lp.settings.invite_link_for_adding_members', 'Invite link for adding members')}</div>
        <div className="nc-set-row-desc">
          {t('lp.settings.the_invite_link_is_visible_only', 'The invite link is visible only to people with permission to invite members')}
          {' · '}
          <a href="#" onClick={(e) => { e.preventDefault(); void reset(); }}>{t('lp.settings.reset_link', 'Reset link')}</a>
        </div>
      </div>
      <Button
        disabled={!on || !url}
        icon="link"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete'));
        }}
      >
        {t('lp.settings.copy_link', 'Copy link')}
      </Button>
      <Switch label="Invite link" checked={on && enabled !== false} onChange={(v) => void toggle(v)} />
    </div>
  );
}
