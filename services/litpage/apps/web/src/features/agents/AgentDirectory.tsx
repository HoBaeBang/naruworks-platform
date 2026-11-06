
// ("No description"), status (Paused / Disabled), triggers and last run — with Connections / Status filters, the
// Library search, a ••• menu (favorites, settings, insights, copy link, Trash) and "Create new agent".
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { timeAgo } from '../../lib/format.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { PAUSED_REASON_LABEL } from '@nc/shared/agents.ts';
import { openAgent, useAgents, type AgentSummary } from './agentsApi.ts';
import { AgentIcon, openAgentMenu } from './AgentsSection.tsx';
import { openNewAgentModal } from './NewAgentModal.tsx';
import { openChecklist } from './ui.tsx';
import './agents.css';

type Conn = AgentSummary['connections'][number];
type Status = AgentSummary['status'];

const CONN_LABEL: Record<Conn, [string, string]> = {
  litpage: ['nc.agents.litPages', 'Litpage pages and databases'],
  web: ['workflows.lit.permissions.webAccess', 'Web access'],
  mcp: ['nc.agents.customMcp', 'External MCP endpoint'],
  agents: ['workflow.agent.agentAccess.title', 'Litpage agents'],
  people: ['nc.agents.peopleDirectory', 'People Directory'],
};
const STATUS_LABEL: Record<Status, [string, string]> = {
  active: ['aiSettings.customAgents.status.active', 'Active'],
  paused: ['library.customAgentsDirectory.card.status.paused', 'Paused'],
  disabled: ['library.customAgentsDirectory.card.status.disabled', 'Disabled'],
};

export function AgentDirectory({ query }: { query: string }) {
  const spaceId = useSession((s) => s.spaceId);
  const { agents, loaded } = useAgents();
  const [conns, setConns] = useState<Conn[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  useEffect(() => {
    if (spaceId) void useAgents.getState().load(spaceId, true);
  }, [spaceId]);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => agents
    .filter((a) => a.alive)
    .filter((a) => !q || `${a.name} ${a.description ?? ''}`.toLowerCase().includes(q))
    .filter((a) => !conns.length || conns.every((c) => a.connections.includes(c)))
    .filter((a) => !statuses.length || statuses.includes(a.status))
    .sort((x, y) => Number(y.favorite) - Number(x.favorite) || (y.lastRunTime ?? y.createdTime) - (x.lastRunTime ?? x.createdTime)), [agents, q, conns, statuses]);
  const filtered = !!(q || conns.length || statuses.length);
  const pill = (label: string, active: string[], onClick: (el: HTMLElement) => void, testId: string) => (
    <div role="button" className={`nc-agent-pill ${active.length ? 'on' : ''}`} data-testid={testId} onClick={(e) => onClick(e.currentTarget)}>
      {label}{active.length ? `: ${active.join(', ')}` : ''}
      <Icon name="chevronDown" size={12} />
    </div>
  );
  return (
    <div className="nc-agent-dir" data-testid="agent-directory">
      <div className="nc-agent-dir-filters">
        {pill(t('lp.agents.connections', 'Connections'), conns.map((c) => t(...CONN_LABEL[c])), (el) => openChecklist(el, {
          items: (Object.keys(CONN_LABEL) as Conn[]).map((c) => ({ id: c, label: t(...CONN_LABEL[c]) })),
          selected: conns,
          search: t('lp.agents.search_connections', 'Search connections…'),
          onChange: (ids) => setConns(ids as Conn[]),
        }), 'agent-dir-connections')}
        {pill(t('lp.agents.status', 'Status'), statuses.map((s) => t(...STATUS_LABEL[s])), (el) => openChecklist(el, {
          items: (Object.keys(STATUS_LABEL) as Status[]).map((s) => ({ id: s, label: t(...STATUS_LABEL[s]) })),
          selected: statuses,
          onChange: (ids) => setStatuses(ids as Status[]),
        }), 'agent-dir-status')}
        {(conns.length > 0 || statuses.length > 0) && (
          <div role="button" className="nc-agent-add" onClick={() => { setConns([]); setStatuses([]); }}>{t('lp.agents.reset', 'Reset')}</div>
        )}
      </div>
      {!loaded && <div className="nc-agent-loading small" aria-busy="true" />}
      {loaded && filtered && !list.length && (
        <div className="nc-agent-empty">
          <div className="ttl">{t('lp.agents.no_agents_match', 'No agents match')}</div>
          <div role="button" className="nc-agent-link" onClick={() => { setConns([]); setStatuses([]); }}>{t('lp.agents.clear_search', 'Clear search')}</div>
        </div>
      )}
      {loaded && (list.length > 0 || !filtered) && (
        <div className="nc-agent-dir-grid">
          {list.map((a) => (
            <div key={a.id} role="button" tabIndex={0} className="nc-agent-card-tile" data-agent-id={a.id} onClick={(e) => openAgent(a.id, undefined, { newTab: e.metaKey || e.ctrlKey })} onKeyDown={(e) => { if (e.key === 'Enter') openAgent(a.id); }}>
              <div className="nc-agent-card-tile-head">
                <div className="nc-agent-card-tile-icon"><AgentIcon icon={a.icon} size={28} /></div>
                <div role="button" aria-label={t('lp.agents.agent_menu', 'Agent menu')} className="nc-agent-icon-btn small nc-agent-card-tile-more" onClick={(e) => { e.stopPropagation(); openAgentMenu(a, e.currentTarget); }}>
                  <Icon name="ellipsisSmall" size={16} />
                </div>
              </div>
              <div className="nc-agent-card-tile-name nc-ellipsis">{a.favorite && <Icon name="starFilled" size={12} color="var(--lp-yellow-icon-accent, #fbbf24)" />}{a.name || t('lp.agents.untitled_agent', 'Untitled agent')}</div>
              <div className={`nc-agent-card-tile-desc ${a.description ? '' : 'empty'}`}>{a.description || t('lp.agents.no_description', 'No description')}</div>
              <div className="nc-agent-card-tile-foot">
                {a.status !== 'active' && (
                  <span className={`nc-agent-status ${a.status === 'paused' ? 'orange' : 'gray'}`} title={a.pausedReason ? PAUSED_REASON_LABEL[a.pausedReason] : undefined}>
                    {a.status === 'paused' && a.pausedReason ? t('lp.agents.paused', 'Paused: {reason}', { reason: PAUSED_REASON_LABEL[a.pausedReason] }) : t(...STATUS_LABEL[a.status])}
                  </span>
                )}
                {!a.published && <span className="nc-agent-status gray">{t('lp.agents.not_saved_yet', 'Not saved yet')}</span>}
                <span className="nc-agent-card-tile-meta">
                  {t('lp.agents.count_plural_one_other', '{count, plural, one {# automation} other {# automations}}', { count: a.triggers })}
                  {a.lastRunTime ? ` · ${t('lp.agents.last_run', 'Last run {time}', { time: timeAgo(a.lastRunTime) })}` : ''}
                </span>
              </div>
            </div>
          ))}
          {!filtered && (
            <div role="button" tabIndex={0} className="nc-agent-card-tile create" data-testid="agent-dir-create" onClick={() => void openNewAgentModal()} onKeyDown={(e) => { if (e.key === 'Enter') void openNewAgentModal(); }}>
              <div className="nc-agent-card-tile-icon"><Icon name="plus" size={20} /></div>
              <div className="nc-agent-card-tile-name">{t('lp.agents.create_an_agent', 'Create an agent')}</div>
              <div className="nc-agent-card-tile-desc">{t('lp.agents.automate_work_that_repeats', 'Automate work that repeats')}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
