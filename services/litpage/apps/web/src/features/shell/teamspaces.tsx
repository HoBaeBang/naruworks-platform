import { HELP_URL } from '@nc/shared/brand.ts';
// Teamspaces: create dialog, teamspace settings modal (General / Members / Security), add members, join/leave,
// duplicate. Records: `team` (name, icon, description, membership, settings.type/default_page_role) and the
// user's space_view.joined_teams.
import { useMemo, useState, type ReactNode } from 'react';
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, SpaceRecord, SpaceViewRecord, TeamRecord } from '@nc/shared/records.ts';
import { isRestrictedMember, isSpaceAdmin } from '@nc/shared/permissions.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useRecord, useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { currentSpaceView, useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, pageUrl, spaceDomain } from '../../lib/router.ts';
import { api } from '../../lib/api.ts';
import { confirmDialog } from '../page/confirm.tsx';
import { run } from '../../lib/blocks.ts';
import { openIconPicker } from '../page/IconPicker.tsx';
import { t } from './i18n.ts';
import { TeamIcon } from './sidebar/TeamIcon.tsx';
import { canCreateTeamspace, policyTooltip } from '../settings/spaceSettings.ts';
import { msg, rich } from '../settings/ui.tsx';
import './teamspaces.css';

export type TeamspaceSettingsTab = 'general' | 'members' | 'permissions' | 'security';
type Access = 'default' | 'open' | 'closed' | 'private';

const me = () => useSession.getState().userId ?? '';

function accessLabel(a: Access) {
  switch (a) {
    case 'default':
      return t('lp.shell.default_808d', 'Default');
    case 'closed':
      return t('lp.shell.closed', 'Closed');
    case 'private':
      return t('lp.shell.private', 'Private');
    default:
      return t('lp.shell.open', 'Open');
  }
}
function accessCaption(a: Access) {
  switch (a) {
    case 'default':
      return t('lp.shell.all_workspace_members_are_required_to', 'All workspace members are required to join');
    case 'closed':
      return t('lp.shell.anyone_can_view_this_team_but', 'Anyone can view this team but can’t join');
    case 'private':
      return t('lp.shell.only_members_can_tell_this_team', 'Only members can tell this team exists');
    default:
      return t('lp.shell.visible_to_everyone_and_anyone_can', 'Visible to everyone, and anyone can join');
  }
}
function accessOf(team: TeamRecord, space?: SpaceRecord): Access {
  if (space?.default_team_ids?.includes(team.id)) return 'default';
  const ty = team.settings?.type;
  return ty === 'closed' || ty === 'private' ? ty : 'open';
}

function openAccessMenu(anchor: HTMLElement, current: Access, onPick: (a: Access) => void, allowDefault: boolean) {
  const all: Access[] = allowDefault ? ['default', 'open', 'closed', 'private'] : ['open', 'closed', 'private'];
  openMenu(anchor, {
    width: 300,
    sections: [{
      items: all.map((a) => ({
        label: accessLabel(a),
        description: accessCaption(a),
        icon: a === 'private' ? 'lock' : a === 'closed' ? 'eye' : a === 'default' ? 'building' : 'globe',
        checked: a === current,
        onSelect: () => onPick(a),
      })),
    }],
  }, { placement: 'bottom-start' });
}

// ---------------- create ----------------
export function openCreateTeamspaceDialog(): void {
  // Settings › Teamspaces › Limit teamspace creation to only workspace owners (server-enforced too)
  const space = records.get<SpaceRecord>('space', useSession.getState().spaceId);
  if (!canCreateTeamspace(space, me())) {
    useUI.getState().toast(policyTooltip.createTeamspace());
    return;
  }
  openOverlay((close) => <CreateTeamspace close={close} />, { placement: 'center', backdrop: 'dim' });
}

function CreateTeamspace({ close }: { close: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [icon, setIcon] = useState('');
  const [access, setAccess] = useState<Access>('open');
  const create = () => {
    const spaceId = useSession.getState().spaceId;
    const sv = currentSpaceView() as SpaceViewRecord | undefined;
    if (!name.trim() || !spaceId || !sv) return;
    const id = newId();
    const now = Date.now();
    run('createTeam', (tx) => {
      const team: Omit<TeamRecord, 'version'> = {
        id, space_id: spaceId, name: name.trim(), description: desc.trim(), icon: icon || '', team_pages: [],
        parent_id: spaceId, parent_table: 'space', alive: true,
        membership: [{ user_id: me(), role: 'owner', added_time: now }],
        settings: { type: access === 'default' ? 'open' : access, default_page_role: 'editor' },
        created_time: now, created_by_id: me(),
      };
      tx.set('team', id, [], team);
      tx.listAfter('space_view', sv.id, ['joined_teams'], id);
      if (access === 'default') tx.listAfter('space', spaceId, ['default_team_ids'], id);
    });
    close();
    useUI.getState().toast(t('lp.shell.created_team', 'Created team {name}', { name: name.trim() }));
  };
  return (
    <div className="nc-ts-dialog" role="dialog" aria-label={t('lp.shell.create_a_team', 'Create a team')}>
      <div className="nc-ts-dialog-title">{t('lp.shell.create_a_team', 'Create a team')}</div>
      <div className="nc-ts-dialog-sub">{t('lp.shell.teams_help_your_team_organize_pages', 'Teams help your team organize pages, permissions, and members')}</div>
      <div className="nc-ts-field-label">{t('lp.shell.icon_name', 'Icon & name')}</div>
      <div className="nc-ts-name-row">
        <div role="button" className="nc-ts-icon-btn" onClick={(e) => openIconPicker(e.currentTarget, { current: icon, onPick: (v) => setIcon(v ?? '') })}>
          <TeamIcon team={{ id: 'new', name: name || 'T', icon }} size={22} />
        </div>
        <div className="nc-input" style={{ height: 32, flex: 1 }}>
          <input
            autoFocus
            value={name}
            placeholder={t('lp.shell.example_engineering', 'Example: Engineering')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) create(); }}
          />
        </div>
      </div>
      <div className="nc-ts-field-label">{t('lp.shell.description', 'Description')}</div>
      <div className="nc-input nc-ts-textarea">
        <textarea rows={3} value={desc} placeholder={t('lp.shell.what_will_this_team_be_used', 'What will this team be used for?')} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="nc-ts-field-label">{t('lp.shell.permissions', 'Permissions')}</div>
      <div role="button" className="nc-ts-select" onClick={(e) => openAccessMenu(e.currentTarget as HTMLElement, access, setAccess, true)}>
        <div>
          <div className="nc-ts-select-title">{accessLabel(access)}</div>
          <div className="nc-ts-select-desc">{accessCaption(access)}</div>
        </div>
        <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
      </div>
      <div className="nc-ts-dialog-footer">
        <button className="nc-btn outline" onClick={close}>{t('lp.shell.cancel', 'Cancel')}</button>
        <button className="nc-btn primary" disabled={!name.trim()} onClick={create}>{t('lp.shell.create_team', 'Create team')}</button>
      </div>
    </div>
  );
}

// ---------------- settings modal ----------------
export function openTeamspaceSettings(teamId: string, tab: TeamspaceSettingsTab = 'general'): void {
  openOverlay((close) => <TeamspaceSettings teamId={teamId} initialTab={tab} close={close} />, { placement: 'center', backdrop: 'dim' });
}

export function openTeamspaceAddMembers(teamId: string): void {
  openTeamspaceSettings(teamId, 'members');
}

function TeamspaceSettings({ teamId, initialTab, close }: { teamId: string; initialTab: TeamspaceSettingsTab; close: () => void }) {
  const team = useRecord<TeamRecord>('team', teamId);
  const space = useRecord<SpaceRecord>('space', team?.space_id);
  const [tab, setTab] = useState<TeamspaceSettingsTab>(initialTab);
  if (!team) return null;
  const members = team.membership?.length ?? 0;
  const tabs: [TeamspaceSettingsTab, string][] = [
    ['general', t('lp.shell.general', 'General')],
    ['members', t('lp.shell.members', 'Members')],
    ['permissions', t('lp.shell.permissions', 'Permissions')],
    ['security', t('lp.shell.security', 'Security')],
  ];
  return (
    <div className="nc-ts-modal" role="dialog" aria-label={t('lp.shell.team_settings', 'Team settings')}>
      <div className="nc-ts-modal-header">
        <TeamIcon team={team} size={36} />
        <div style={{ minWidth: 0 }}>
          <div className="nc-ts-modal-name nc-ellipsis">{team.name}</div>
          <div className="nc-ts-modal-caption">
            {accessLabel(accessOf(team, space))} · {t('lp.shell.numberofmembers_plural_one_other', '{numberOfMembers} {numberOfMembers, plural, one {workspace member} other {workspace members}}', { numberOfMembers: members })}
          </div>
        </div>
        <div role="button" className="nc-btn icon-only" style={{ marginInlineStart: 'auto' }} aria-label={t('lp.shell.close', 'Close')} onClick={close}>
          <Icon name="close" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
      </div>
      <div className="nc-ts-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <div key={k} role="tab" aria-selected={tab === k} className={`nc-ts-tab ${tab === k ? 'selected' : ''}`} onClick={() => setTab(k)}>{label}</div>
        ))}
      </div>
      <div className="nc-ts-modal-body lit-scroller vertical">
        {tab === 'general' && <TeamGeneral team={team} space={space} close={close} />}
        {tab === 'members' && <TeamMembers team={team} space={space} />}
        {tab === 'permissions' && <TeamPermissions team={team} space={space} />}
        {tab === 'security' && <TeamSecurity team={team} space={space} />}
      </div>
    </div>
  );
}

function TeamGeneral({ team, space, close }: { team: TeamRecord; space?: SpaceRecord; close: () => void }) {
  const [name, setName] = useState(team.name);
  const [desc, setDesc] = useState(team.description ?? '');
  const isDefault = !!space?.default_team_ids?.includes(team.id);
  const save = (patch: Partial<TeamRecord>) => run('updateTeam', (tx) => tx.update('team', team.id, [], patch));
  return (
    <div>
      <div className="nc-ts-field-label">{t('lp.shell.icon_name', 'Icon & name')}</div>
      <div className="nc-ts-name-row">
        <div role="button" className="nc-ts-icon-btn" onClick={(e) => openIconPicker(e.currentTarget, { current: team.icon, onPick: (v) => save({ icon: v ?? '' }) })}>
          <TeamIcon team={team} size={22} />
        </div>
        <div className="nc-input" style={{ height: 32, flex: 1 }}>
          <input value={name} aria-label={t('lp.shell.edit_the_team_name', 'Edit the team name')} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== team.name && save({ name: name.trim() })} />
        </div>
      </div>
      <div className="nc-ts-field-label">{t('lp.shell.description', 'Description')}</div>
      <div className="nc-input nc-ts-textarea">
        <textarea rows={3} value={desc} placeholder={t('lp.shell.what_will_this_team_be_used', 'What will this team be used for?')} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (team.description ?? '') && save({ description: desc })} />
      </div>
      <div className="nc-ts-section-title">{t('lp.shell.manage_team', 'Manage team')}</div>
      <div className="nc-ts-danger-row">
        <div>
          <div className="nc-ts-row-title">{t('lp.shell.leave_team', 'Leave team')}</div>
          <div className="nc-ts-row-desc">{isDefault ? t('lp.shell.everyone_in_the_workspace_must_be', 'Everyone in the workspace must be a member of a default team') : t('lp.shell.you_will_lose_access_to_pages', 'You will lose access to pages in this team')}</div>
        </div>
        <button className="nc-btn outline danger" disabled={isDefault || (team.membership?.length ?? 0) <= 1} onClick={() => { leaveTeamspace(team.id); close(); }}>
          {t('lp.shell.leave', 'Leave')}
        </button>
      </div>
      <div className="nc-ts-danger-row">
        <div>
          <div className="nc-ts-row-title">{t('lp.shell.archive_team', 'Archive team')}</div>
          <div className="nc-ts-row-desc">{t('lp.shell.hide_this_team_from_every_member', 'Hide this team from every member’s sidebar')}</div>
        </div>
        <button className="nc-btn outline danger" disabled={isDefault} onClick={() => { archiveTeamspace(team.id); close(); }}>
          {t('lp.shell.archive', 'Archive')}
        </button>
      </div>
    </div>
  );
}

function TeamMembers({ team, space }: { team: TeamRecord; space?: SpaceRecord }) {
  useTableVersion(['lit_user']);
  const [q, setQ] = useState('');
  const memberIds = new Set((team.membership ?? []).map((m) => m.user_id));
  const candidates = useMemo(
    () => (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && !memberIds.has(p.user_id)).map((p) => p.user_id!),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [space, team.membership],
  );
  const user = (id: string) => records.get('lit_user', id) as { name?: string; email?: string; profile_photo?: string } | undefined;
  const matches = candidates.filter((id) => {
    const u = user(id);
    const s = `${u?.name ?? ''} ${u?.email ?? ''}`.toLowerCase();
    return !q || s.includes(q.toLowerCase());
  });
  const add = (uid: string) => run('addTeamMember', (tx) => tx.update('team', team.id, [], { membership: [...(team.membership ?? []), { user_id: uid, role: 'member', added_time: Date.now() }] }));
  const setRole = (uid: string, role: 'owner' | 'member') => run('setTeamRole', (tx) => tx.update('team', team.id, [], { membership: (team.membership ?? []).map((m) => (m.user_id === uid ? { ...m, role } : m)) }));
  const remove = (uid: string) => run('removeTeamMember', (tx) => tx.update('team', team.id, [], { membership: (team.membership ?? []).filter((m) => m.user_id !== uid) }));
  
  
  // restricted members to Teamspaces"; they can never be teamspace owners
  const canInvite = canInviteMembers(team, space);
  const restrictedTip = (id: string) => (isRestrictedMember(space, id) && !canAddRestricted(team, space) ? t('lp.shell.you_cannot_add_restricted_members_to', 'You cannot add restricted members to this team.') : undefined);
  const linkOn = (team.settings as Record<string, unknown> | undefined)?.invite_link_enabled !== false;
  return (
    <div>
      {canInvite && (
        <div className="nc-ts-add-row">
          <div className="nc-input" style={{ height: 32, flex: 1 }}>
            <input value={q} placeholder={t('lp.shell.search_for_people', 'Search for people…')} onChange={(e) => setQ(e.target.value)} />
          </div>
          {linkOn && (
            <button className="nc-btn outline nc-ts-copy-link" style={{ height: 32 }} onClick={() => void copyTeamInviteLink(team.id)}>
              <Icon name="link" size={16} />
              {t('lp.shell.copy_invitation_link', 'Copy invitation link')}
            </button>
          )}
        </div>
      )}
      {canInvite && q && matches.length > 0 && (
        <div className="nc-ts-candidates">
          {matches.slice(0, 8).map((id) => {
            const tip = restrictedTip(id);
            return (
              <div key={id} role="button" aria-disabled={tip ? true : undefined} data-tooltip={tip} className={`nc-ts-member-row clickable${tip ? ' disabled' : ''}`} onClick={() => { if (tip) return; add(id); setQ(''); }}>
                <Avatar u={user(id)} />
                <div className="nc-ts-member-name nc-ellipsis">{user(id)?.name || user(id)?.email}</div>
                {isRestrictedMember(space, id) && <RestrictedTag u={user(id)} />}
                <span className="nc-ts-member-email nc-ellipsis">{user(id)?.email}</span>
                <span className="nc-btn primary" style={{ height: 24, fontSize: 12 }}>{t('lp.shell.add_members', 'Add members')}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="nc-ts-table-head"><span>{t('lp.shell.user', 'User')}</span><span>{t('lp.shell.role', 'Role')}</span></div>
      {(team.membership ?? []).map((m) => {
        const u = user(m.user_id);
        return (
          <div key={m.user_id} className="nc-ts-member-row">
            <Avatar u={u} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="nc-ts-member-name nc-ellipsis">{u?.name || u?.email}{m.user_id === me() ? ` ${t('lp.shell.you', '(You)')}` : ''}{isRestrictedMember(space, m.user_id) && <RestrictedTag u={u} />}</div>
              <div className="nc-ts-member-email nc-ellipsis">{u?.email}</div>
            </div>
            <div
              role="button"
              className="nc-ts-role"
              onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                width: 240,
                sections: [
                  {
                    items: [
                      {
                        label: t('lp.shell.team_owner', 'Team owner'), checked: m.role === 'owner', onSelect: () => setRole(m.user_id, 'owner'),
                        // Restricted members are never teamspace owners.
                        disabled: isRestrictedMember(space, m.user_id),
                        description: isRestrictedMember(space, m.user_id) ? t('lp.shell.restricted_members_cannot_own_a_team', 'Restricted members cannot own a team.') : undefined,
                      },
                      { label: t('lp.shell.member', 'Member'), checked: m.role === 'member', onSelect: () => setRole(m.user_id, 'member') },
                    ],
                  },
                  { items: [{ label: t('lp.shell.remove_from_team', 'Remove from team'), danger: true, disabled: (team.membership?.length ?? 0) <= 1, onSelect: () => remove(m.user_id) }] },
                ],
              }, { placement: 'bottom-end' })}
            >
              {m.role === 'owner' ? t('lp.shell.team_owner', 'Team owner') : t('lp.shell.member', 'Member')}
              <Icon name="chevronDown" size={12} />
            </div>
          </div>
        );
      })}
    </div>
  );
}


function RestrictedTag({ u }: { u?: { name?: string; email?: string } }) {
  const who = u?.name && u?.email ? `${u.name} (${u.email})` : u?.name || u?.email || '';
  return (
    <span className="nc-ts-restricted-tag" data-tooltip={t('lp.shell.this_workspace_lists_as_a_restricted', 'This workspace lists { userNameAndEmail} as a restricted member', { userNameAndEmail: who })}>
      {t('lp.shell.restricted_member', 'Restricted member')}
    </span>
  );
}

/** Mirrors the server's member-invite rule (policy.ts memberInviteAllowed + owners/admins). */
function canInviteMembers(team: TeamRecord, space?: SpaceRecord): boolean {
  if (!space || isRestrictedMember(space, me())) return false;
  if (isSpaceAdmin(space, me())) return true;
  const mine = (team.membership ?? []).find((m) => m.user_id === me());
  if (!mine) return false;
  if (mine.role === 'owner') return true;
  return (team.settings?.type ?? 'open') === 'open' || (team.settings as Record<string, unknown> | undefined)?.invite_access !== 'owners';
}

/** Security › "Who can add restricted members to Teamspaces" (policy.ts restrictedTeamAddProblem). */
function canAddRestricted(team: TeamRecord, space?: SpaceRecord): boolean {
  const who = String((space?.settings as Record<string, unknown> | undefined)?.restricted_members_teamspaces ?? 'space_owner_and_team_owner');
  const wsOwner = (space?.permissions ?? []).some((p) => p.user_id === me() && (p.role as string) === 'owner');
  if (who === 'member' || wsOwner) return true;
  return who === 'space_owner_and_team_owner' && (team.membership ?? []).some((m) => m.user_id === me() && m.role === 'owner');
}


async function copyTeamInviteLink(teamId: string) {
  try {
    const r = await api<{ enabled: boolean; path: string | null }>('getTeamInviteLink', { teamId });
    if (!r.enabled || !r.path) {
      useUI.getState().toast(t('lp.shell.that_invite_link_is_disabled_ask', 'That invite link is disabled. Ask an administrator to invite you directly.'));
      return;
    }
    await navigator.clipboard?.writeText(`${location.origin}${r.path}`).catch(() => undefined);
    useUI.getState().toast(t('lp.shell.the_link_is_on_your_clipboard', 'The link is on your clipboard'));
  } catch (e: any) {
    useUI.getState().toast(e?.message || 'Couldn’t copy the invite link');
  }
}

function Avatar({ u }: { u?: { name?: string; email?: string; profile_photo?: string } }) {
  return (
    <div className="nc-avatar" style={{ width: 28, height: 28 }}>
      {u?.profile_photo ? <img src={u.profile_photo} alt="" /> : <span>{(u?.name || u?.email || '?').slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}


// team.settings: type 'open'|'closed'|'private', default_page_role (Teamspace members), workspace_page_role (Everyone

// Enterprise page-security overrides disable_public_access / disable_guests / disable_export (true = stricter,
// false = allowed although the workspace disables it, unset = inherit). Server: authz.ts + policy.ts.

const PAGE_ROLES = ['editor', 'read_and_write', 'comment_only', 'reader'] as const;
const RANK: Record<string, number> = { none: 0, reader: 1, comment_only: 2, read_and_write: 3, editor: 4 };

function canManageTeam(team: TeamRecord, space?: SpaceRecord) {
  return isSpaceAdmin(space, me()) || (team.membership ?? []).some((m) => m.user_id === me() && m.role === 'owner');
}

function SettingRow({ title, desc, children, disabled, tooltip }: { title: string; desc?: ReactNode; children: ReactNode; disabled?: boolean; tooltip?: string }) {
  return (
    <div className={`nc-ts-danger-row ${disabled ? 'disabled' : ''}`}>
      <div>
        <div className="nc-ts-row-title">{title}</div>
        {desc && <div className="nc-ts-row-desc">{desc}</div>}
      </div>
      <span data-tooltip={tooltip}>{children}</span>
    </div>
  );
}

function Picker({ label, disabled, onOpen }: { label: string; disabled?: boolean; onOpen: (el: HTMLElement) => void }) {
  return (
    <div role="button" aria-disabled={disabled || undefined} className={`nc-ts-role ${disabled ? 'disabled' : ''}`} onClick={(e) => { if (!disabled) onOpen(e.currentTarget as HTMLElement); }}>
      {label}{!disabled && <Icon name="chevronDown" size={12} />}
    </div>
  );
}

function TeamPermissions({ team, space }: { team: TeamRecord; space?: SpaceRecord }) {
  const access = accessOf(team, space);
  const admin = isSpaceAdmin(space, me());
  const manage = canManageTeam(team, space);
  const st = (team.settings ?? {}) as Record<string, unknown>;
  const memberRole = String(st.default_page_role ?? 'editor');
  const everyoneRole = String(st.workspace_page_role ?? 'read_and_write');
  const open = (team.settings?.type ?? 'open') === 'open';
  const invite = open ? 'members' : String(st.invite_access ?? 'members');
  const sidebar = String(st.sidebar_edit ?? 'members');
  const save = (patch: Record<string, unknown>) => run('setTeamPermissions', (tx) => tx.update('team', team.id, ['settings'], patch));
  const setAccess = (a: Access) => {
    run('setTeamAccess', (tx) => {
      tx.update('team', team.id, ['settings'], { type: a === 'default' ? 'open' : a });
      if (space) {
        const isDefault = space.default_team_ids?.includes(team.id);
        if (a === 'default' && !isDefault) tx.listAfter('space', space.id, ['default_team_ids'], team.id);
        if (a !== 'default' && isDefault) tx.listRemove('space', space.id, ['default_team_ids'], team.id);
      }
    });
  };
  const roleMenu = (anchor: HTMLElement, cur: string, onPick: (r: string) => void, opts: { withNone?: boolean; max?: number } = {}) => openMenu(anchor, {
    width: 240,
    sections: [{
      items: [...PAGE_ROLES, ...(opts.withNone ? ['none'] as const : [])].map((r) => ({
        label: roleLabel(r),
        checked: cur === r,
        disabled: opts.max !== undefined && (RANK[r] ?? 0) > opts.max,
        description: opts.max !== undefined && (RANK[r] ?? 0) > opts.max ? t('lp.shell.team_members_need_at_least_the', 'Team members need at least the same permissions as workspace members') : undefined,
        onSelect: () => onPick(r),
      })),
    }],
  }, { placement: 'bottom-end' });
  const whoMenu = (anchor: HTMLElement, cur: string, onPick: (v: string) => void) => openMenu(anchor, {
    width: 240,
    sections: [{
      items: [
        { label: t('lp.shell.any_team_member', 'Any team member'), checked: cur !== 'owners', onSelect: () => onPick('members') },
        { label: t('lp.shell.team_owners_only', 'Team owners only'), checked: cur === 'owners', onSelect: () => onPick('owners') },
      ],
    }],
  }, { placement: 'bottom-end' });
  return (
    <div>
      <SettingRow title={t('lp.shell.team_access', 'Team access')} desc={accessCaption(access)}>
        <Picker label={accessLabel(access)} disabled={!manage} onOpen={(el) => openAccessMenu(el, access, setAccess, admin)} />
      </SettingRow>
      <div className="nc-ts-section-title">{t('lp.shell.default_page_permissions', 'Default page permissions')}</div>
      <SettingRow title={t('lp.shell.team_owner', 'Team owner')} desc={t('lp.shell.team_owners_automatically_get_full_acces', 'Team owners automatically get full access to team pages')}>
        <Picker label={roleLabel('editor')} disabled onOpen={() => undefined} />
      </SettingRow>
      <SettingRow title={t('lp.shell.team_members', 'Team members')} desc={t('lp.shell.applies_to_pages_at_the_top', 'Applies to pages at the top level of this team')}>
        <Picker label={roleLabel(memberRole)} disabled={!manage} onOpen={(el) => roleMenu(el, memberRole, (r) => save({ default_page_role: r, ...(RANK[everyoneRole] > RANK[r] ? { workspace_page_role: r } : {}) }))} />
      </SettingRow>
      <SettingRow
        title={t('lp.shell.everyone_else_in_workspace', 'Everyone else in workspace')}
        desc={open ? undefined : t('lp.shell.private_teams_are_accessible_or_joinable', 'Private teams are accessible or joinable by invitation only')}
      >
        <Picker
          label={open ? roleLabel(everyoneRole) : t('lp.shell.can_t_access_join_by_invite', 'Can’t access • Join by invite')}
          disabled={!manage || !open}
          onOpen={(el) => roleMenu(el, everyoneRole, (r) => save({ workspace_page_role: r }), { withNone: true, max: RANK[memberRole] })}
        />
      </SettingRow>
      <div className="nc-ts-section-title">{t('lp.shell.members_sidebar', 'Members & sidebar')}</div>
      <SettingRow
        title={t('lp.shell.who_s_allowed_to_invite_and', 'Who’s allowed to invite and remove team members')}
        desc={open ? t('lp.shell.restricting_who_can_invite_members_requi', 'Restricting who can invite members requires a Closed or Private access level') : undefined}
      >
        <Picker
          label={invite === 'owners' ? t('lp.shell.team_owners_only', 'Team owners only') : t('lp.shell.any_team_member', 'Any team member')}
          disabled={!manage || open}
          onOpen={(el) => whoMenu(el, invite, (v) => save({ invite_access: v }))}
        />
      </SettingRow>
      <SettingRow
        title={t('lp.shell.who_s_allowed_to_change_the', 'Who’s allowed to change the team sidebar')}
        tooltip={RANK[memberRole] < RANK.read_and_write ? t('lp.shell.give_members_can_edit_or_full', 'Give members Can edit or Full access so they can edit the sidebar') : undefined}
      >
        <Picker
          label={sidebar === 'owners' || RANK[memberRole] < RANK.read_and_write ? t('lp.shell.team_owners_only', 'Team owners only') : t('lp.shell.any_team_member', 'Any team member')}
          disabled={!manage || RANK[memberRole] < RANK.read_and_write}
          onOpen={(el) => whoMenu(el, sidebar, (v) => save({ sidebar_edit: v }))}
        />
      </SettingRow>
    </div>
  );
}

function TeamSecurity({ team, space }: { team: TeamRecord; space?: SpaceRecord }) {
  const manage = canManageTeam(team, space);
  const enterprise = space?.plan_type === 'enterprise';
  const wsOwner = (space?.permissions ?? []).some((p) => p.user_id === me() && (p.role as string) === 'owner');
  const st = (team.settings ?? {}) as Record<string, unknown>;
  const rows: { key: 'disable_public_access' | 'disable_guests' | 'disable_export'; title: string; ws: boolean; on: [string, string]; off: [string, string] }[] = [
    {
      key: 'disable_public_access', title: t('lp.shell.turn_off_public_links_forms_and', 'Turn off public links, forms, and site publishing'), ws: !!space?.disable_public_access,
      on: [t('lp.shell.turn_off_public_links_and_stop', 'Turn off public links and stop publishing sites and forms?'), t('lp.shell.people_who_aren_t_workspace_members', 'People who aren’t workspace members or guests will lose access to all pages in this team.')],
      off: [t('lp.shell.allow_public_sharing_of_this_team', 'Allow public sharing of this team’s pages?'), t('lp.shell.this_workspace_blocks_public_pages_by', 'This workspace blocks public pages by default.')],
    },
    {
      key: 'disable_guests', title: t('lp.shell.disable_guests', 'Disable guests'), ws: !!space?.disable_guests,
      on: [t('lp.shell.disable_guests_db37', 'Disable guests?'), t('lp.shell.members_won_t_be_able_to', 'Members won’t be able to invite guests to pages in this team.')],
      off: [t('lp.shell.allow_guests_in_this_team', 'Allow guests in this team?'), t('lp.shell.by_default_guests_can_t_join', 'By default, guests can’t join teams in this workspace.')],
    },
    {
      key: 'disable_export', title: t('lp.shell.disable_export', 'Disable export'), ws: !!space?.disable_export,
      on: [t('lp.shell.disable_export_5b59', 'Disable export?'), t('lp.shell.members_won_t_be_able_to_2af4', 'Members won’t be able to export pages in this team.')],
      off: [t('lp.shell.allow_exporting_this_team_s_pages', 'Allow exporting this team’s pages?'), t('lp.shell.this_workspace_blocks_page_exports_by', 'This workspace blocks page exports by default.')],
    },
  ];
  const flip = async (row: (typeof rows)[number], next: boolean) => {
    const relaxing = row.ws && !next;
    const [title, description] = next ? row.on : row.off;
    const ok = await new Promise<boolean>((resolve) => {
      openOverlay((close) => (
        <div className="nc-ts-dialog" role="dialog" aria-label={title}>
          <div className="nc-ts-dialog-title">{title}</div>
          <div className="nc-ts-dialog-sub">{description}</div>
          <div className="nc-ts-dialog-footer">
            <button className="nc-btn outline" onClick={() => { close(); resolve(false); }}>{t('lp.shell.cancel', 'Cancel')}</button>
            <button className="nc-btn primary" onClick={() => { close(); resolve(true); }}>{relaxing ? t('lp.shell.use_a_different_workspace_setting', 'Use a different workspace setting') : t('lp.shell.yes', 'Yes')}</button>
          </div>
        </div>
      ), { placement: 'center', backdrop: 'dim' });
    });
    if (!ok) return;
    // matching the workspace again = inherit (unset)
    run('setTeamSecurity', (tx) => tx.update('team', team.id, ['settings'], { [row.key]: next === row.ws ? undefined : next }));
  };
  const linkOn = st.invite_link_enabled !== false;
  return (
    <div>
      {}
      <SettingRow title={t('lp.shell.invite_link', 'Invite Link')} desc={t('lp.shell.the_invite_link_is_visible_only', 'The invite link is visible only to people with permission to invite members')}>
        <div
          className={`nc-ts-switch ${linkOn ? 'on' : ''} ${!manage ? 'disabled' : ''}`}
          role="switch"
          aria-checked={linkOn}
          aria-label={t('lp.shell.invite_link', 'Invite Link')}
          aria-disabled={!manage || undefined}
          onClick={() => { if (manage) run('setTeamInviteLink', (tx) => tx.update('team', team.id, ['settings'], { invite_link_enabled: !linkOn })); }}
        >
          <div className="nc-ts-switch-knob" />
        </div>
      </SettingRow>
      <div className="nc-ts-section-title">{t('lp.shell.page_security', 'Page Security')}</div>
      {rows.map((row) => {
        const own = typeof st[row.key] === 'boolean' ? (st[row.key] as boolean) : undefined;
        const value = own ?? row.ws;
        const overriding = own !== undefined && own !== row.ws;
        const lockedRelax = row.ws && !wsOwner; // only workspace owners can loosen a workspace restriction
        const disabled = !enterprise || !manage || (value && lockedRelax);
        return (
          <SettingRow
            key={row.key}
            title={row.title}
            desc={rich(msg(overriding ? 'teamSettingsSecurity.overridesWorkspaceSettings' : 'teamSettingsSecurity.basedOnWorkspaceSettings', overriding ? 'Overriding <underline>workspace rule</underline>' : 'Using <underline>workspace rules</underline>'), {}, {
              underline: (c) => <a href="#" className="nc-ts-link" onClick={(e) => { e.preventDefault(); useUI.getState().openSettings('security'); }}>{c}</a>,
            })}
            tooltip={!enterprise ? t('lp.shell.changing_security_settings_requires_the', 'Changing security settings requires the Enterprise plan') : undefined}
          >
            <div className={`nc-ts-switch ${value ? 'on' : ''} ${disabled ? 'disabled' : ''}`} role="switch" aria-checked={value} aria-label={row.title} aria-disabled={disabled || undefined} onClick={() => { if (!disabled) void flip(row, !value); }}>
              <div className="nc-ts-switch-knob" />
            </div>
          </SettingRow>
        );
      })}
      {HELP_URL && (<a className="nc-ts-learn" href={HELP_URL} target="_blank" rel="noreferrer">{t('lp.shell.how_team_security_works', 'How team security works')}</a>)}
    </div>
  );
}

function roleLabel(r: string) {
  switch (r) {
    case 'none':
      return t('lp.shell.none', 'None');
    case 'read_and_write':
      return t('lp.shell.can_edit', 'Can edit');
    case 'comment_only':
      return t('lp.shell.can_comment', 'Can comment');
    case 'reader':
      return t('lp.shell.can_view', 'Can view');
    default:
      return t('lp.shell.full_access', 'Full access');
  }
}

// ---------------- actions ----------------
export function joinTeamspace(teamId: string): void {
  const team = records.get<TeamRecord>('team', teamId);
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  if (!team || !sv) return;
  run('joinTeam', (tx) => {
    if (!team.membership?.some((m) => m.user_id === me())) tx.update('team', teamId, [], { membership: [...(team.membership ?? []), { user_id: me(), role: 'member', added_time: Date.now() }] });
    if (!sv.joined_teams.includes(teamId)) tx.listAfter('space_view', sv.id, ['joined_teams'], teamId);
  });
}

export function leaveTeamspace(teamId: string): void {
  const team = records.get<TeamRecord>('team', teamId);
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  if (!team || !sv) return;
  run('leaveTeam', (tx) => {
    tx.update('team', teamId, [], { membership: (team.membership ?? []).filter((m) => m.user_id !== me()) });
    tx.listRemove('space_view', sv.id, ['joined_teams'], teamId);
  });
  useUI.getState().toast(t('lp.shell.left', 'Left {name}', { name: team.name }));
}

export function archiveTeamspace(teamId: string): void {
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  run('archiveTeam', (tx) => {
    tx.update('team', teamId, [], { archived_by: me() });
    if (sv?.joined_teams.includes(teamId)) tx.listRemove('space_view', sv.id, ['joined_teams'], teamId);
  });
}

export function duplicateTeamspace(teamId: string): void {
  const team = records.get<TeamRecord>('team', teamId);
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  if (!team || !sv) return;
  if (!canCreateTeamspace(records.get<SpaceRecord>('space', team.space_id), me())) {
    useUI.getState().toast(policyTooltip.createTeamspace());
    return;
  }
  const id = newId();
  const now = Date.now();
  run('duplicateTeam', (tx) => {
    tx.set('team', id, [], {
      id, space_id: team.space_id, name: `${team.name} (1)`, description: team.description ?? '', icon: team.icon ?? '', team_pages: [],
      parent_id: team.space_id, parent_table: 'space', alive: true, membership: [{ user_id: me(), role: 'owner', added_time: now }],
      settings: { ...(team.settings ?? {}) }, created_time: now, created_by_id: me(),
    });
    tx.listAfter('space_view', sv.id, ['joined_teams'], id, teamId);
  });
}

export function openBrowseTeamspaces(): void {
  navigate(`/${spaceDomain(useSession.getState().spaceId)}/library/teamspaces`);
}


/** Page in a teamspace, full access, not a database / row, and teamspace owner or workspace owner/admin. */
export function canTurnIntoTeamspace(pageId: string): boolean {
  const page = records.get<BlockRecord>('block', pageId);
  if (!page || page.type !== 'page' || page.parent_table === 'collection' || records.role('block', pageId) !== 'editor') return false;
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 100 && cur; i++) {
    if (cur.parent_table === 'team') {
      const team = records.get<TeamRecord>('team', cur.parent_id);
      const space = records.get<SpaceRecord>('space', team?.space_id);
      return !!team && (team.membership?.some((m) => m.user_id === me() && m.role === 'owner') || isSpaceAdmin(space, me()));
    }
    if (cur.parent_table !== 'block') return false;
    cur = records.get<BlockRecord>('block', cur.parent_id);
  }
  return false;
}

export async function turnIntoTeamspace(pageId: string): Promise<void> {
  const ok = await confirmDialog({
    message: t('lp.shell.change_to_team', 'Change to team?'),
    description: t('lp.shell.this_moves_the_page_and_everyone', 'This moves the page and everyone who already has access into a new team.'),
    confirmLabel: t('lp.shell.create_team', 'Create team'),
    cancelLabel: t('lp.shell.cancel', 'Cancel'),
    danger: false,
  });
  if (!ok) return;
  try {
    const r = await api<{ teamId: string }>('createTeamFromPage', { pageId });
    await useSession.getState().load();
    useUI.getState().toast(t('lp.shell.turned_into_team', 'Turned into team'));
    navigate(pageUrl(pageId));
    void r.teamId;
  } catch (e: any) {
    useUI.getState().toast(e?.message || 'We hit a problem');
  }
}
