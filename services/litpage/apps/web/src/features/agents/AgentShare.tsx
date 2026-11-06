import { HELP_URL } from '@nc/shared/brand.ts';


// is shared further. Only Full access can change sharing (the server enforces it and keeps one Full access member);
// everyone else sees the list read-only.
import { useEffect, useMemo, useState } from 'react';
import { AGENT_ROLE_CAPTION, AGENT_ROLE_LABEL, type AgentRole } from '@nc/shared/agents.ts';
import type { SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { isRestrictedMember } from '@nc/shared/permissions.ts';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { openKeepMenu } from '../database/automations/keepMenu.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { Avatar, spaceMembers } from '../search/filterMenus.tsx';
import { agentApi, agentUrl, applyAnswer, toastError, type AgentDetail, type SharingRow } from './agentsApi.ts';
import { useAgentPage } from './agentPage.ts';

const ROLES: AgentRole[] = ['editor', 'read_and_write', 'reader'];

type Perm = { type: SharingRow['type']; user_id?: string; group_id?: string; role: AgentRole };

function toPerms(rows: SharingRow[]): Perm[] {
  return rows.map((r) => ({ type: r.type, user_id: r.userId, group_id: r.groupId, role: r.role }));
}

function roleMenu(anchor: HTMLElement, current: AgentRole, onPick: (r: AgentRole) => void, opts: { onRemove?: () => void; guest?: boolean } = {}) {
  openKeepMenu(anchor, {
    width: 280,
    sections: [
      {
        items: ROLES.map((r) => ({
          label: t(`nc.agents.role.${r}`, AGENT_ROLE_LABEL[r]),
          description: t(`nc.agents.roleCaption.${r}`, AGENT_ROLE_CAPTION[r]),
          checked: r === current,
          disabled: opts.guest && r === 'reader',
          onSelect: () => onPick(r),
        })),
      },
      ...(opts.onRemove ? [{ items: [{ label: t('lp.agents.remove', 'Remove'), danger: true, onSelect: opts.onRemove }] }] : []),
    ],
  }, { placement: 'bottom-end' });
}

function SharePanel({ d, close }: { d: AgentDetail; close: () => void }) {
  const [rows, setRows] = useState<SharingRow[] | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string; memberCount: number }[]>([]);
  const [warnings, setWarnings] = useState<AgentDetail['warnings']>(d.warnings);
  const [canShare, setCanShare] = useState(d.role === 'editor');
  const [q, setQ] = useState('');
  const [inviteRole, setInviteRole] = useState<AgentRole>('reader');
  const [picked, setPicked] = useState<{ kind: 'user' | 'group'; id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const spaceId = useSession((s) => s.spaceId);
  const me = useSession((s) => s.userId);
  const spaceName = (records.get('space', spaceId) as { name?: string } | undefined)?.name ?? '';
  useEffect(() => {
    let alive = true;
    agentApi.sharing(d.agent.id).then((r) => {
      if (!alive) return;
      applyAnswer({ recordMap: r.recordMap });
      setRows(r.sharing);
      setGroups(r.groups);
      setWarnings(r.warnings);
      setCanShare(r.role === 'editor' || d.isAdmin);
    }).catch((e) => {
      toastError(e);
      if (alive) setRows([]);
    });
    return () => {
      alive = false;
    };
  }, [d.agent.id, d.isAdmin]);
  const save = async (next: Perm[]) => {
    setBusy(true);
    try {
      const r = await agentApi.setPermissions(d.agent.id, next);
      applyAnswer(r);
      setRows(r.sharing);
      void useAgentPage.getState().refresh();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  // restricted members (and guests, who aren't members) can't be invited to Custom Agents
  const members = useMemo(() => {
    const space = records.get<SpaceRecord>('space', useSession.getState().spaceId);
    return spaceMembers().filter((u) => !isRestrictedMember(space, u.id));
  }, []);
  const candidates = useMemo(() => {
    if (!rows) return [];
    const has = new Set(rows.map((r) => r.userId ?? r.groupId));
    const needle = q.trim().toLowerCase();
    const users = members.filter((u: UserRecord) => !has.has(u.id) && !picked.some((p) => p.id === u.id) && (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)))
      .map((u) => ({ kind: 'user' as const, id: u.id, name: u.name || u.email, sub: u.email, user: u }));
    const gs = groups.filter((g) => !has.has(g.id) && !picked.some((p) => p.id === g.id) && (!needle || g.name.toLowerCase().includes(needle)))
      .map((g) => ({ kind: 'group' as const, id: g.id, name: g.name, sub: t('lp.agents.count_plural_one_other_f62c', '{count, plural, one {# person} other {# people}}', { count: g.memberCount }), user: undefined }));
    return [...gs, ...users].slice(0, 8);
  }, [rows, members, groups, q, picked]);
  const invite = async () => {
    if (!rows || !picked.length) return;
    const next = [...toPerms(rows), ...picked.map((p) => (p.kind === 'user' ? { type: 'user_permission' as const, user_id: p.id, role: inviteRole } : { type: 'group_permission' as const, group_id: p.id, role: inviteRole }))];
    if (await save(next)) {
      setPicked([]);
      setQ('');
    }
  };
  const everyone = rows?.find((r) => r.type === 'space_permission');
  const people = rows?.filter((r) => r.type !== 'space_permission') ?? [];
  const copyLink = () => {
    void navigator.clipboard?.writeText(`${location.origin}${agentUrl(d.agent.id)}`).catch(() => {});
    useUI.getState().toast(t('lp.agents.the_link_is_on_your_clipboard', 'The link is on your clipboard'));
  };
  const reach: string[] = [];
  if (warnings.privatePages.length) reach.push(t('lp.agents.access_to_private_count_plural_one', 'Can open {count} private {count, plural, one {page} other {pages}}', { count: warnings.privatePages.length }));
  if (warnings.workspaceAccess) reach.push(t('lp.agents.can_access_pages_open_to_all', 'Can access pages open to all of {spaceName}', { spaceName }));
  if (warnings.connections.length) reach.push(t('lp.agents.connections_7e16', 'Connections: {names}', { names: warnings.connections.join(', ') }));
  if (warnings.web) reach.push(t('lp.agents.web_access', 'Web access'));
  return (
    <PopoverSurface width={420} maxHeight="80vh" className="nc-agent-share">
      <div className="nc-agent-share-body" data-testid="agent-share-menu">
        <div className="nc-agent-share-title">{t('lp.agents.share', 'Share')}</div>
        {canShare && (
          <div className="nc-agent-share-invite">
            <div className="nc-agent-share-input">
              {picked.map((p) => (
                <span key={p.id} className="nc-agent-chip">{p.name}<span role="button" aria-label={t('lp.agents.remove', 'Remove')} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}><Icon name="close" size={10} /></span></span>
              ))}
              <input
                autoFocus
                value={q}
                aria-label={t('lp.agents.add_people_or_groups', 'Add people or groups')}
                placeholder={picked.length ? '' : t('lp.agents.add_people_or_groups', 'Add people or groups')}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && candidates[0] && q.trim()) {
                    e.preventDefault();
                    setPicked([...picked, { kind: candidates[0].kind, id: candidates[0].id, name: candidates[0].name }]);
                    setQ('');
                  } else if (e.key === 'Backspace' && !q && picked.length) setPicked(picked.slice(0, -1));
                }}
              />
            </div>
            <div role="button" className="nc-agent-role" onClick={(e) => roleMenu(e.currentTarget, inviteRole, setInviteRole)}>
              {t(`nc.agents.role.${inviteRole}`, AGENT_ROLE_LABEL[inviteRole])}
              <Icon name="arrowChevronSingleDownSmall" size={12} />
            </div>
            <button type="button" className="nc-btn primary small" data-testid="agent-share-invite" disabled={!picked.length || busy} onClick={() => void invite()}>{t('lp.agents.invite', 'Invite')}</button>
          </div>
        )}
        {canShare && (q.trim() || picked.length === 0) && candidates.length > 0 && q.trim() && (
          <div className="nc-agent-share-candidates" role="listbox">
            {candidates.map((c) => (
              <div key={c.id} role="option" aria-selected={false} className="nc-agent-picker-row" onClick={() => { setPicked([...picked, { kind: c.kind, id: c.id, name: c.name }]); setQ(''); }}>
                {c.kind === 'user' ? <Avatar user={c.user} size={20} /> : <Icon name="users" size={18} />}
                <span className="nc-ellipsis">{c.name}</span>
                <span className="nc-agent-picker-hint">{c.sub}</span>
              </div>
            ))}
          </div>
        )}
        {reach.length > 0 && (
          <div className="nc-agent-share-warn" data-testid="agent-share-warning">
            <Icon name="agentShield" size={16} />
            <div>
              <div className="ttl">{t('lp.agents.people_given_can_interact_on_this', 'People given ‘Can interact’ on this agent receive everything listed below.')}</div>
              <ul>{reach.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        )}
        <div className="nc-agent-share-section">{t('lp.agents.people_who_can_access_this', 'People who can access this')}</div>
        {rows === null && <div className="nc-agent-muted pad">{t('lp.agents.loading', 'Loading…')}</div>}
        {people.map((r) => {
          const u = r.userId ? records.get<UserRecord>('lit_user', r.userId) : undefined;
          const key = r.userId ?? r.groupId ?? r.type;
          const remove = () => void save(toPerms(rows!.filter((x) => x !== r)));
          return (
            <div key={key} className="nc-agent-share-row" data-share-row={key}>
              {r.type === 'user_permission' ? <Avatar user={u ?? { name: r.name }} size={28} /> : <span className="nc-agent-share-group"><Icon name="users" size={16} /></span>}
              <div className="nc-agent-share-main">
                <div className="nc-ellipsis">{r.name}{r.userId === me ? ` ${t('lp.agents.you', '(You)')}` : ''}{r.guest && <span className="nc-agent-badge gray">{t('lp.agents.guest', 'Guest')}</span>}</div>
                <div className="nc-agent-row-sub nc-ellipsis">{r.type === 'group_permission' ? t('lp.agents.count_plural_one_other_f62c', '{count, plural, one {# person} other {# people}}', { count: r.memberCount ?? 0 }) : r.email}</div>
              </div>
              <div role="button" className={`nc-agent-role ${canShare ? '' : 'readonly'}`} onClick={(e) => canShare && roleMenu(e.currentTarget, r.role, (role) => void save(toPerms(rows!.map((x) => (x === r ? { ...x, role } : x)))), { onRemove: remove, guest: r.guest })}>
                {t(`nc.agents.role.${r.role}`, AGENT_ROLE_LABEL[r.role])}
                {canShare && <Icon name="arrowChevronSingleDownSmall" size={12} />}
              </div>
            </div>
          );
        })}
        <div className="nc-agent-share-section">{t('lp.agents.general_access', 'General access')}</div>
        <div className="nc-agent-share-row" data-share-row="space">
          <span className="nc-agent-share-group"><Icon name={everyone ? 'building' : 'lock'} size={16} /></span>
          <div className="nc-agent-share-main">
            <div role="button" className={`nc-agent-share-general ${canShare ? '' : 'readonly'}`} onClick={(e) => canShare && openKeepMenu(e.currentTarget, {
              width: 280,
              sections: [{
                items: [
                  { label: t('lp.agents.only_invited_people', 'Only invited people'), checked: !everyone, onSelect: () => void save(toPerms(rows!.filter((x) => x.type !== 'space_permission'))) },
                  { label: t('lp.agents.everyone_at', 'Everyone at {spaceName}', { spaceName }), checked: !!everyone, onSelect: () => !everyone && void save([...toPerms(rows!), { type: 'space_permission', role: 'reader' }]) },
                ],
              }],
            }, { placement: 'bottom-start' })}>
              {everyone ? t('lp.agents.everyone_at', 'Everyone at {spaceName}', { spaceName }) : t('lp.agents.only_invited_people', 'Only invited people')}
              {canShare && <Icon name="arrowChevronSingleDownSmall" size={12} />}
            </div>
            <div className="nc-agent-row-sub">{everyone ? t('lp.agents.every_member_of_the_workspace_can', 'Every member of the workspace can find and use this agent') : t('lp.agents.only_the_people_and_groups_above', 'Only the people and groups above can use this agent')}</div>
          </div>
          {everyone && (
            <div role="button" className={`nc-agent-role ${canShare ? '' : 'readonly'}`} onClick={(e) => canShare && roleMenu(e.currentTarget, everyone.role, (role) => void save(toPerms(rows!.map((x) => (x === everyone ? { ...x, role } : x)))))}>
              {t(`nc.agents.role.${everyone.role}`, AGENT_ROLE_LABEL[everyone.role])}
              {canShare && <Icon name="arrowChevronSingleDownSmall" size={12} />}
            </div>
          )}
        </div>
        <div className="nc-agent-share-foot">
          {HELP_URL && <span role="button" className="nc-agent-link" onClick={() => { close(); window.open(HELP_URL!, '_blank', 'noopener'); }}>
            <Icon name="questionMarkCircle" size={14} /> {t('lp.agents.sharing_information', 'Sharing information')}
          </span>}
          <button type="button" className="nc-btn outline small" data-testid="agent-share-copy" onClick={copyLink}>
            <Icon name="link" size={14} />
            <span>{t('lp.agents.copy_link', 'Copy link')}</span>
          </button>
        </div>
      </div>
    </PopoverSurface>
  );
}

export function openAgentShare(d: AgentDetail, anchor: HTMLElement) {
  openOverlay((close) => <SharePanel d={d} close={close} />, { anchor, placement: 'bottom-end', offset: 6 });
}
