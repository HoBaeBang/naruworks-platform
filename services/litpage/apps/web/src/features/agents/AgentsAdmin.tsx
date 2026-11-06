
// Agent administration covers owners, owners plus groups, and disabled states, the default and allowed models for Custom Agents, Claude Fable 5, every
// agent in the workspace (search, status filter, owner, model, triggers, credits, last run) with Disable / Enable,
// Transfer ownership, the pages an agent can reach (Enterprise: remove them) and "Give yourself access", and agents
// whose owners left the workspace. Settings are space.settings.* written through transactions (owners only, and the
// server enforces it); the agent actions go through api/modules/agents.ts.
import { useEffect, useMemo, useState } from 'react';
import type { SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { timeAgo } from '../../lib/format.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { spaceMembers } from '../search/filterMenus.tsx';
import { Badge, Button, Dropdown, Group, Row, Switch, Upsell, openSubDialog } from '../settings/ui.tsx';
import { saveSpaceSettings, useSpaceAccess } from '../settings/spaceSettings.ts';
import { agentApi, openAgent, toastError, type AgentAnalyticsData } from './agentsApi.ts';
import { AgentIcon } from './AgentsSection.tsx';
import { openChecklist } from './ui.tsx';
import './agents.css';

type Policy = 'all' | 'owners' | 'owners_groups' | 'disabled';

interface AdminAgent {
  id: string;
  name: string;
  icon: string | null;
  status: 'active' | 'paused' | 'disabled' | 'deleted';
  pausedReason: string | null;
  createdByName: string;
  owner: string | null;
  ownerName: string;
  ownerLeft: boolean;
  lastRunTime: number | null;
  model: string;
  connections: number;
  credits: number;
  triggers: number;
  myRole: string;
  resources: number;
  
  ownerless?: boolean;
}

interface AdminData {
  agents: AdminAgent[];
  policy: { policy: Policy; groups: string[] };
  enterprise: boolean;
  available: boolean;
  models: { id: string; name: string; version: string; adminEnable: boolean }[];
  modelPolicy: { allowed: string[]; defaultModel: string; fable: boolean };
  groups: { id: string; name: string; memberCount: number }[];
}

const STATUS: Record<AdminAgent['status'], [string, string]> = {
  active: ['aiSettings.customAgents.status.active', 'Active'],
  paused: ['library.customAgentsDirectory.card.status.paused', 'Paused'],
  disabled: ['aiSettings.customAgents.status.disabled', 'Disabled'],
  deleted: ['aiSettings.customAgents.status.deleted', 'Deleted'],
};

function closeSettings() {
  useUI.getState().set({ settingsOpen: false });
}

export function AgentsAdmin() {
  
  const { space, owner } = useSpaceAccess();
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [orphans, setOrphans] = useState<{ id: string; name: string; icon: string | null; ownerName: string; disableTime: number | null; status: string }[]>([]);
  const load = async () => {
    if (!space || !owner) return;
    try {
      setData(await agentApi.adminList(space.id));
      // handing over agents whose owners left is a workspace owner's job (server: transferAgentOwnership)
      setOrphans(owner ? (await agentApi.orphaned(space.id)).agents : []);
    } catch (e) {
      setError((e as Error)?.message || 'error');
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space?.id, owner]);
  const settings = (space?.settings ?? {}) as Record<string, unknown>;
  const policy: Policy = (['owners', 'owners_groups', 'disabled'] as const).includes(settings.agent_creation as never) ? (settings.agent_creation as Policy) : 'all';
  const policyGroups = Array.isArray(settings.agent_creation_groups) ? (settings.agent_creation_groups as string[]) : [];
  const allowed = Array.isArray(settings.ai_agent_allowed_models) ? (settings.ai_agent_allowed_models as string[]) : [];
  const defaultModel = typeof settings.ai_agent_default_model === 'string' ? (settings.ai_agent_default_model as string) : 'auto';
  const fable = settings.ai_fable_enabled === true;
  const save = (patch: Record<string, unknown>) => space && saveSpaceSettings(space.id, patch);
  const models = (data?.models ?? []).filter((m) => !m.adminEnable || fable);
  const groups = data?.groups ?? [];
  const shown = useMemo(() => (data?.agents ?? [])
    .filter((a) => !q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((a) => !statuses.length || statuses.includes(a.status)), [data, q, statuses]);
  if (!space) return null;
  if (!data?.available && data) {
    return <Upsell text={t('lp.agents.using_this_agent_requires_an_upgrade', 'Using this agent requires an upgrade to {productName}', { productName: 'Business' }).replace('this agent', 'Custom Agents')} onClick={() => useUI.getState().openSettings('plans')} />;
  }
  return (
    <div className="nc-agents-admin" data-testid="agents-admin">
      <Group plain title={t('lp.agents.agents', 'Agents')}>
        <Row
          id="agent-creation"
          label={t('lp.agents.who_s_allowed_to_build_agents', 'Who’s allowed to build agents')}
          description={policy === 'disabled' ? t('lp.agents.agent_creation_is_disabled_right_now', 'Agent creation is disabled right now. Choose another option to turn it on.') : t('lp.agents.decide_which_people_in_this_workspace', 'Decide which people in this workspace may build AI agents')}
          control={(
            <Dropdown<Policy>
              label={t('lp.agents.who_s_allowed_to_build_agents', 'Who’s allowed to build agents')}
              value={policy}
              disabled={!owner}
              width={300}
              onChange={(v) => save({ agent_creation: v })}
              options={[
                { value: 'all', label: t('lp.agents.every_workspace_member', 'Every workspace member') },
                { value: 'owners', label: t('lp.agents.workspace_owners_only', 'Workspace owners') },
                { value: 'owners_groups', label: t('lp.agents.only_workspace_owners_and_groups_you', 'Only workspace owners and groups you add') },
                { value: 'disabled', label: t('lp.agents.disabled', 'Disabled') },
              ]}
            />
          )}
        />
        {policy === 'owners_groups' && (
          <Row
            id="agent-creation-groups"
            label={t('lp.agents.set_who_s_allowed_to_build', 'Set who’s allowed to build custom agents')}
            description={policyGroups.length
              ? groups.filter((g) => policyGroups.includes(g.id)).map((g) => g.name).join(', ')
              : t('lp.agents.no_groups_are_enabled_for_creating', 'No groups are enabled for creating agents')}
            control={(
              <Button small disabled={!owner} onClick={(e) => openChecklist(e.currentTarget, {
                items: groups.map((g) => ({ id: g.id, label: g.name, hint: t('lp.agents.count_plural_one_other_f62c', '{count, plural, one {# person} other {# people}}', { count: g.memberCount }) })),
                selected: policyGroups,
                search: t('lp.agents.type_a_group_name_to_add', 'Type a group name to add…'),
                onChange: (ids) => save({ agent_creation_groups: ids }),
              })}
              >
                {t('lp.agents.add_groups', 'Add groups')}
              </Button>
            )}
          />
        )}
        <Row
          id="agent-default-model"
          label={t('lp.agents.custom_agent_default_model', 'Custom agent default model')}
          description={t('lp.agents.new_custom_agents_will_use_this', 'New custom agents will use this model at first. Their builders can switch it anytime.')}
          control={(
            <Dropdown
              label={t('lp.agents.custom_agent_default_model', 'Custom agent default model')}
              value={defaultModel}
              disabled={!owner}
              onChange={(v) => save({ ai_agent_default_model: v })}
              options={[{ value: 'auto', label: t('lp.agents.auto', 'Auto') }, ...models.map((m) => ({ value: m.id, label: `${m.name} ${m.version}`, disabled: !!allowed.length && !allowed.includes(m.id) }))]}
            />
          )}
        />
        <Row
          id="agent-allowed-models"
          label={t('lp.agents.custom_agent_model_allowlist', 'Custom agent model allowlist')}
          description={t('lp.agents.only_the_models_you_allow_here', 'Only the models you allow here are available to custom agents. Restricted ones appear dimmed in the model picker, and agents on Auto pick only from allowed models.')}
          control={(
            <Button small disabled={!owner} onClick={(e) => openChecklist(e.currentTarget, {
              items: models.map((m) => ({ id: m.id, label: `${m.name} ${m.version}` })),
              selected: allowed,
              allLabel: t('lp.agents.all_models', 'All models'),
              onChange: (ids) => save({ ai_agent_allowed_models: ids, ...(ids.length && defaultModel !== 'auto' && !ids.includes(defaultModel) ? { ai_agent_default_model: 'auto' } : {}) }),
            })}
            >
              {allowed.length ? t('lp.agents.count_plural_one_other_f218', '{count, plural, one {# allowed model} other {# allowed models}}', { count: allowed.length }) : t('lp.agents.all_models', 'All models')}
              <Icon name="arrowChevronSingleDownSmall" size={14} />
            </Button>
          )}
        />
        {}
        {(!data || data.models.some((m) => m.adminEnable)) && (
          <Row
            id="agent-fable"
            label={t('lp.agents.claude_fable_5', 'Claude Fable 5')}
            description={t('lp.agents.let_litpage_ai_and_custom_agents', 'Let Litpage AI and Custom agents use Claude Fable 5 for the hardest, longest work. Anthropic keeps prompts and responses for this model for a period.')}
            control={<Switch label={t('lp.agents.claude_fable_5', 'Claude Fable 5')} checked={fable} disabled={!owner} onChange={(v) => save({ ai_fable_enabled: v })} />}
          />
        )}
      </Group>
      {!owner && <div className="nc-set-row-desc">{t('lp.agents.only_workspace_owners_can_change_these', 'Only workspace owners can change these settings.')}</div>}
      {owner && error && <div className="nc-set-row-desc">{error}</div>}
      {owner && data && orphans.length > 0 && (
        <Group plain title={t('lp.agents.agents_without_an_owner', 'Agents without an owner')} description={t('lp.agents.their_owners_left_the_workspace_transfer', 'Their owners left the workspace. Transfer them to keep them running.')}>
          {orphans.map((a) => (
            <Row
              key={a.id}
              leading={<AgentIcon icon={a.icon} size={24} />}
              label={a.name}
              description={[a.ownerName ? t('lp.agents.owned_by', 'Owned by {name}', { name: a.ownerName }) : '', orphanNote(a)].filter(Boolean).join(' · ') || undefined}
              control={<Button small onClick={(e) => transfer(a.id, e.currentTarget, load)}>{t('lp.agents.transfer_ownership', 'Transfer ownership')}</Button>}
            />
          ))}
        </Group>
      )}
      {owner && data && (
        <Group plain title={t('lp.agents.this_workspace_s_custom_agents', 'This workspace’s custom agents')}>
          <div className="nc-agents-admin-tools">
            <div className="nc-set-input" style={{ maxWidth: 260 }}>
              <input value={q} placeholder={t('lp.agents.search_by_name', 'Find by name…')} aria-label={t('lp.agents.search_by_name', 'Find by name…')} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div role="button" className={`nc-agent-pill ${statuses.length ? 'on' : ''}`} onClick={(e) => openChecklist(e.currentTarget, {
              items: (Object.keys(STATUS) as AdminAgent['status'][]).map((s) => ({ id: s, label: t(...STATUS[s]) })),
              selected: statuses,
              onChange: setStatuses,
            })}
            >
              {t('lp.agents.status', 'Status')}{statuses.length ? `: ${statuses.map((s) => t(...STATUS[s as AdminAgent['status']])).join(', ')}` : ''}
              <Icon name="chevronDown" size={12} />
            </div>
          </div>
          <div className="nc-agent-table-wrap">
            <table className="nc-agent-table" aria-label={t('lp.agents.custom_agents_table', 'Custom agent list')} data-testid="agents-admin-table">
              <thead>
                <tr>
                  <th>{t('lp.agents.agent', 'Agent')}</th>
                  <th>{t('lp.agents.status', 'Status')}</th>
                  <th>{t('lp.agents.owner', 'Owner')}</th>
                  <th>{t('lp.agents.model', 'Model')}</th>
                  <th className="num">{t('lp.agents.triggers', 'Triggers')}</th>
                  <th className="num">{t('lp.agents.credits', 'Credits')}</th>
                  <th>{t('lp.agents.last_run_333c', 'Last run')}</th>
                  <th aria-label={t('lp.agents.agent_menu', 'Agent menu')} />
                </tr>
              </thead>
              <tbody>
                {(all ? shown : shown.slice(0, 10)).map((a) => (
                  <tr key={a.id} data-agent-id={a.id}>
                    <td>
                      <span className="nc-agents-admin-name">
                        <AgentIcon icon={a.icon} size={18} />
                        <span className="nc-ellipsis">{a.name}</span>
                      </span>
                    </td>
                    <td><Badge tone={a.status === 'active' ? 'blue' : a.status === 'paused' ? 'yellow' : 'gray'}>{t(...STATUS[a.status])}</Badge></td>
                    <td>{a.ownerName || a.createdByName || '—'}{a.ownerLeft && <span className="nc-agent-badge gray">{t('lp.agents.left', 'Left')}</span>}</td>
                    <td>{a.model}</td>
                    <td className="num">{a.triggers}</td>
                    <td className="num">{a.credits}</td>
                    <td>{a.lastRunTime ? timeAgo(a.lastRunTime) : '—'}</td>
                    <td>
                      <div role="button" aria-label={t('lp.agents.agent_menu', 'Agent menu')} className="nc-agent-icon-btn small" onClick={(e) => agentMenu(a, data.enterprise, e.currentTarget, load, owner)}>
                        <Icon name="ellipsisSmall" size={16} />
                      </div>
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={8} className="nc-agent-muted">{t('lp.agents.no_agents', 'No agents')}</td></tr>}
              </tbody>
            </table>
          </div>
          {shown.length > 10 && !all && <Button small onClick={() => setAll(true)}>{t('lp.agents.show_all', 'Show all')}</Button>}
        </Group>
      )}
    </div>
  );
}

function transfer(agentId: string, anchor: HTMLElement, done: () => void) {
  const members = spaceMembers();
  openMenu(anchor, {
    width: 280,
    search: t('lp.agents.search_people', 'Search people…'),
    emptyText: t('lp.agents.no_matching_members', 'No matching members'),
    sections: [{
      title: t('lp.agents.transfer_to', 'Transfer to'),
      items: members.map((u: UserRecord) => ({
        label: u.name || u.email,
        text: `${u.name} ${u.email}`,
        description: u.name ? u.email : undefined,
        onSelect: () => void agentApi.transfer(agentId, u.id).then((r) => {
          useUI.getState().toast(t('lp.agents.transferred_to', 'Transferred to {name}', { name: r.ownerName }));
          done();
        }).catch((e) => toastError(e)),
      })),
    }],
  }, { placement: 'bottom-end' });
}

function agentMenu(a: AdminAgent, enterprise: boolean, anchor: HTMLElement, done: () => void, owner = false) {
  const canOpen = a.myRole !== 'none' && a.status !== 'deleted';
  openMenu(anchor, {
    width: 260,
    sections: [
      {
        items: [
          ...(canOpen ? [{ label: t('lp.agents.open_agent', 'Open agent'), icon: 'openAsPage', onSelect: () => { closeSettings(); openAgent(a.id); } }] : []),
          {
            label: t('lp.agents.pages_it_can_access', 'Pages it can access'),
            icon: 'agentShield',
            onSelect: () => void setTimeout(() => openResources(a, enterprise), 0),
          },
          // only agents nobody owns any more (their owners left), by a workspace owner
          ...(owner && a.ownerless && a.status !== 'deleted' ? [{ label: t('lp.agents.transfer_ownership', 'Transfer ownership'), icon: 'users', onSelect: () => void setTimeout(() => transfer(a.id, anchor, done), 0) }] : []),
          ...(enterprise && a.myRole === 'none' && a.status !== 'deleted'
            ? [{ label: t('lp.agents.change_permissions', 'Change permissions'), icon: 'lock', onSelect: () => void agentApi.adminJoin(a.id).then(() => { closeSettings(); openAgent(a.id); }).catch((e) => toastError(e)) }]
            : []),
        ],
      },
      ...(a.status !== 'deleted'
        ? [{
          items: [a.status === 'disabled'
            ? { label: t('lp.agents.enable_custom_agent', 'Turn on custom agent'), icon: 'agentPlay', onSelect: () => void agentApi.setEnabled(a.id, true).then(done).catch((e) => toastError(e)) }
            : { label: t('lp.agents.disable_custom_agent', 'Turn off custom agent'), icon: 'agentPause', danger: true, onSelect: () => void agentApi.setEnabled(a.id, false).then(done).catch((e) => toastError(e)) }],
        }]
        : []),
    ],
  }, { placement: 'bottom-end' });
}

function openResources(a: Pick<AdminAgent, 'id' | 'name'>, enterprise: boolean, onChanged?: () => void) {
  openSubDialog((close) => <Resources a={a} enterprise={enterprise} close={close} onChanged={onChanged} />);
}

function Resources({ a, enterprise, close, onChanged }: { a: Pick<AdminAgent, 'id' | 'name'>; enterprise: boolean; close: () => void; onChanged?: () => void }) {
  const [res, setRes] = useState<{ grants: { blockId: string; role: string; title: string; addedBy: string }[]; workspaceAccess: boolean; web: boolean } | null>(null);
  const load = () => void agentApi.adminResources(a.id).then(setRes).catch((e) => toastError(e));
  const revoke = (blockId: string) => void agentApi.adminRevoke(a.id, blockId).then(() => { load(); onChanged?.(); }).catch((e) => toastError(e));
  useEffect(load, [a.id]);
  const spaceName = records.get<SpaceRecord>('space', useSession.getState().spaceId)?.name;
  return (
    <div className="nc-agents-admin-res" data-testid="agents-admin-resources">
      <div className="ttl">{t('lp.agents.what_can_access', 'What {name} can access', { name: a.name })}</div>
      {!res && <div className="nc-agent-muted">{t('lp.agents.loading', 'Loading…')}</div>}
      {res && (
        <div className="nc-agent-list">
          {res.grants.map((g) => (
            <div key={g.blockId} className="nc-agent-row">
              <div className="nc-agent-row-icon"><Icon name="page" size={16} /></div>
              <div className="nc-agent-row-main">
                <div className="nc-agent-row-title">{g.title}</div>
                <div className="nc-agent-row-sub">{g.role === 'editor' ? 'Full access' : g.role === 'read_and_write' ? 'Can edit' : g.role === 'comment_only' ? 'Can comment' : 'Can view'}{g.addedBy ? ` · ${t('lp.agents.added_by', 'Added by {name}', { name: g.addedBy })}` : ''}</div>
              </div>
              {enterprise && <Button small variant="danger" onClick={() => revoke(g.blockId)}>{t('lp.agents.remove', 'Remove')}</Button>}
            </div>
          ))}
          {res.workspaceAccess && (
            <div className="nc-agent-row">
              <div className="nc-agent-row-icon"><Icon name="building" size={16} /></div>
              <div className="nc-agent-row-main"><div className="nc-agent-row-title">{t('lp.agents.pages_open_to_all_of', 'Pages open to all of {spaceName}', { spaceName: spaceName ?? '' })}</div></div>
              {enterprise && <Button small variant="danger" onClick={() => revoke('workspace')}>{t('lp.agents.remove', 'Remove')}</Button>}
            </div>
          )}
          {res.web && <div className="nc-agent-row"><div className="nc-agent-row-icon"><Icon name="agentWeb" size={16} /></div><div className="nc-agent-row-main"><div className="nc-agent-row-title">{t('lp.agents.web_access', 'Web access')}</div></div></div>}
          {!res.grants.length && !res.workspaceAccess && !res.web && <div className="nc-agent-muted">{t('lp.agents.this_agent_can_t_access_any', 'This agent can’t access any pages.')}</div>}
        </div>
      )}
      <div className="nc-agents-admin-res-foot"><Button onClick={close}>{t('lp.agents.done', 'Done')}</Button></div>
    </div>
  );
}


function orphanNote(a: { status: string; disableTime: number | null }): string {
  if (a.status === 'disabled') return t('lp.agents.no_owner', 'No owner');
  if (!a.disableTime) return '';
  const days = Math.max(0, Math.ceil((a.disableTime - Date.now()) / 86_400_000));
  return t('lp.agents.stops_running_in_days_plural_one', 'Stops running in {days, plural, one {# day} other {# days}}', { days });
}


export function RecentlyLeftAgents({ spaceId }: { spaceId: string }) {
  const [agents, setAgents] = useState<{ id: string; name: string; icon: string | null; ownerName: string; disableTime: number | null; status: string }[]>([]);
  const load = () => void agentApi.orphaned(spaceId).then((r) => setAgents(r.agents)).catch(() => setAgents([]));
  useEffect(load, [spaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!agents.length) return null;
  return (
    <div className="nc-agents-left" data-testid="recently-left-agents">
      <Group plain title={t('lp.agents.custom_agents', 'Custom agents')} description={t('lp.agents.their_owners_left_the_workspace_transfer', 'Their owners left the workspace. Transfer them to keep them running.')}>
        {agents.map((a) => (
          <Row
            key={a.id}
            leading={<AgentIcon icon={a.icon} size={24} />}
            label={a.name}
            description={[a.ownerName ? t('lp.agents.owned_by', 'Owned by {name}', { name: a.ownerName }) : '', orphanNote(a)].filter(Boolean).join(' · ') || undefined}
            control={<Button small onClick={(e) => transfer(a.id, e.currentTarget, load)}>{t('lp.agents.transfer_ownership', 'Transfer ownership')}</Button>}
          />
        ))}
      </Group>
    </div>
  );
}


export function SharedWithAgentFilter({ spaceId, value, onChange, onRefresh }: { spaceId: string; value: string | null; onChange: (agentId: string | null) => void; onRefresh: () => void }) {
  const [agents, setAgents] = useState<{ id: string; name: string; icon: string | null; status: string }[]>([]);
  useEffect(() => {
    let off = false;
    agentApi.adminList(spaceId).then((r: { agents: { id: string; name: string; icon: string | null; status: string }[] }) => { if (!off) setAgents(r.agents.filter((a) => a.status !== 'deleted')); }).catch(() => {});
    return () => { off = true; };
  }, [spaceId]);
  if (!agents.length) return null;
  const picked = agents.find((a) => a.id === value);
  const menu = (anchor: HTMLElement) => openMenu(anchor, {
    width: 280,
    maxHeight: 360,
    search: t('lp.agents.search_agents', 'Search agents…'),
    sections: [
      {
        title: t('lp.agents.shared_with_an_agent', 'Shared with an agent'),
        items: agents.map((a) => ({
          label: a.name, text: a.name, icon: <AgentIcon icon={a.icon} size={18} />, checked: a.id === value,
          onSelect: () => onChange(a.id === value ? null : a.id),
        })),
      },
      ...(value ? [{ items: [{ label: t('lp.agents.clear', 'Clear'), icon: 'close', onSelect: () => onChange(null) }] }] : []),
    ],
  }, { placement: 'bottom-start' });
  return (
    <>
      <div role="button" tabIndex={0} data-filter="shared-with" className={`nc-set-fpill ${picked ? 'active' : ''}`} onClick={(e) => menu(e.currentTarget)}>
        {picked ? <><b>{t('lp.agents.shared_with', 'Shared with')}</b>: {picked.name}</> : t('lp.agents.shared_with', 'Shared with')}
        <Icon name="arrowChevronSingleDownSmall" size={12} />
      </div>
      {picked && (
        <div role="button" tabIndex={0} className="nc-set-fpill" data-testid="content-search-agent-access" onClick={() => openResources(picked, true, onRefresh)}>
          <Icon name="agentShield" size={14} />{t('lp.agents.manage_access', 'Manage access')}
        </div>
      )}
    </>
  );
}


export function AgentAnalytics({ days }: { days: number }) {
  const spaceId = useSession((s) => s.spaceId);
  const [data, setData] = useState<AgentAnalyticsData | null>(null);
  useEffect(() => {
    let off = false;
    if (!spaceId) return;
    agentApi.adminAnalytics(spaceId, days).then((r) => { if (!off) setData(r); }).catch(() => { if (!off) setData(null); });
    return () => { off = true; };
  }, [spaceId, days]);
  if (!data || !data.agents.length) return null;
  const used = data.agents.filter((a) => a.runs + a.chats > 0);
  const unused = data.agents.filter((a) => a.runs + a.chats === 0);
  return (
    <div className="nc-set-chartcard" data-testid="analytics-agents">
      <div className="hdr">{t('lp.agents.custom_agents', 'Custom agents')}</div>
      <div className="sub">{t('lp.agents.of_total_plural_one_other_used', '{used} of {total, plural, one {# agent} other {# agents}} used in the last {days} days · {runs, plural, one {# run} other {# runs}} · {chats, plural, one {# chat} other {# chats}} · {credits, plural, one {# credit} other {# credits}}', { used: data.totals.used, total: data.totals.agents, days: data.days, runs: data.totals.runs, chats: data.totals.chats, credits: data.totals.credits })}</div>
      {used.length > 0 && (
        <table className="nc-set-table nc-set-atable">
          <thead>
            <tr>
              <th style={{ width: '40%' }}>{t('lp.agents.agent', 'Agent')}</th>
              <th>{t('lp.agents.runs', 'Runs')}</th>
              <th>{t('lp.agents.chats', 'Chats')}</th>
              <th>{t('lp.agents.people', 'People')}</th>
              <th>{t('lp.agents.credits', 'Credits')}</th>
              <th>{t('lp.agents.last_run_333c', 'Last run')}</th>
            </tr>
          </thead>
          <tbody>
            {used.slice(0, 20).map((a) => (
              <tr key={a.id} data-agent-id={a.id}>
                <td className="primary"><span className="nc-agents-admin-name"><AgentIcon icon={a.icon} size={18} /><span className="nc-ellipsis">{a.name}</span></span></td>
                <td>{a.runs}{a.failed ? <span className="nc-agent-muted"> · {t('lp.agents.failed', '{n} failed', { n: a.failed })}</span> : null}</td>
                <td>{a.chats}</td>
                <td>{a.people}</td>
                <td>{a.credits}</td>
                <td>{a.lastRunTime ? timeAgo(a.lastRunTime) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unused.length > 0 && (
        <div className="nc-agents-unused" data-testid="analytics-agents-unused">
          <span className="nc-agent-muted">{t('lp.agents.not_used_in_this_period', 'Not used in this period:')}</span>
          {unused.slice(0, 30).map((a) => <span key={a.id} className="nc-agents-unused-item"><AgentIcon icon={a.icon} size={14} />{a.name}</span>)}
          {unused.length > 30 && <span className="nc-agent-muted">+{unused.length - 30}</span>}
        </div>
      )}
    </div>
  );
}
