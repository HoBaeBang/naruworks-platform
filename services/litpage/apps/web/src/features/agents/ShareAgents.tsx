
// that expands into the agents reaching the page (role, via a parent / the workspace) with "Remove access to …";
// agent suggestions under the invite field ("This will give … access to this page" confirmation, up to my own access
// level); Advanced › Agent permissions ("Who can grant agents access"). The server checks every change.
import { useEffect, useState } from 'react';
import { GRANT_ROLE_LABEL, type GrantRole } from '@nc/shared/agents.ts';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { run } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { choiceDialog } from '../ai/dialogs.tsx';
import { agentApi, openAgent, toastError } from './agentsApi.ts';
import { AgentIcon } from './AgentsSection.tsx';
import './agents.css';

type PageAgents = Awaited<ReturnType<typeof agentApi.pageAgents>>;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

function usePageAgents(pageId: string) {
  const [data, setData] = useState<PageAgents | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void agentApi.pageAgents(pageId).then((r) => alive && setData(r)).catch(() => alive && setData(null));
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, [pageId]);
  return data;
}


function inviteGrant(myRole: string): GrantRole {
  return myRole === 'editor' ? 'read_and_write' : 'reader';
}

async function grant(pageId: string, agent: { agentId: string; name: string }, role: GrantRole) {
  const page = records.get<BlockRecord>('block', pageId);
  const ok = await choiceDialog({
    title: t('lp.agents.can_then_access_this_page', '{agentNames} can then access this page', { agentNames: agent.name }),
    description: t('lp.agents.continue_with_this_action', 'Continue with this action?'),
    buttons: [{ label: t('lp.agents.continue', 'Continue'), value: true, primary: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }],
  });
  if (!ok) return false;
  try {
    await agentApi.grantPage(agent.agentId, pageId, role);
    useUI.getState().toast(t('lp.agents.can_access', '{name} can access {page}', { name: agent.name, page: toPlainText(page?.properties?.title) || t('lp.agents.this_page', 'this page') }));
    changed();
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}


export function ShareAgentSuggestions({ pageId, query, onInvited }: { pageId: string; query: string; onInvited?: () => void }) {
  const data = usePageAgents(pageId);
  const q = query.trim().toLowerCase();
  if (!data || !q || q.includes('@')) return null;
  const hits = data.available.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 4);
  if (!hits.length) return null;
  const role = inviteGrant(data.myRole);
  return (
    <div className="nc-share-suggestions" data-testid="share-agent-suggestions">
      {hits.map((a) => (
        <div key={a.agentId} role="button" className="nc-share-row hoverable" data-agent-id={a.agentId} onMouseDown={(e) => e.preventDefault()} onClick={() => void grant(pageId, a, role).then((ok) => ok && onInvited?.())}>
          <span className="nc-share-agent-icon"><AgentIcon icon={a.icon} size={20} /></span>
          <div className="who">
            <div className="name nc-ellipsis">{a.name}</div>
            <div className="email nc-ellipsis">{t('lp.agents.custom_agent', 'Custom agent · {role}', { role: GRANT_ROLE_LABEL[role] })}</div>
          </div>
        </div>
      ))}
    </div>
  );
}


export function ShareAgentRows({ pageId, canManage }: { pageId: string; canManage: boolean }) {
  const data = usePageAgents(pageId);
  const [open, setOpen] = useState(false);
  if (!data || !data.agents.length) return null;
  const page = records.get<BlockRecord>('block', pageId);
  const kind = page?.type === 'collection_view_page' || page?.type === 'collection_view' ? 'database' : 'page';
  const remove = async (a: PageAgents['agents'][number]) => {
    try {
      await agentApi.revokePage(a.agentId, pageId);
      changed();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="nc-share-agents" data-testid="share-agents">
      <div role="button" className="nc-share-row hoverable" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="nc-share-agent-icon"><Icon name="agentFace" size={20} /></span>
        <div className="who">
          <div className="name nc-ellipsis">{t('lp.agents.agents', 'Agents')}</div>
          <div className="email nc-ellipsis">{t('lp.agents.resourcetype_select_database_page_other', '{resourceType, select, database {Agents that can use this database} page {Agents that can use this page} other {Agents with access}}', { resourceType: kind })}</div>
        </div>
        <span className="nc-share-agents-count">{t('lp.agents.count_plural_one_other_af8d', '{count, plural, one {# available agent} other {# available agents}}', { count: data.agents.length })}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
      </div>
      {open && data.agents.map((a) => (
        <div key={a.agentId} className="nc-share-row person nc-share-agent-row" data-agent-id={a.agentId}>
          <span className="nc-share-agent-icon"><AgentIcon icon={a.icon} size={22} /></span>
          <div className="who" role={a.canOpen ? 'button' : undefined} onClick={() => a.canOpen && openAgent(a.agentId)}>
            <div className="name nc-ellipsis">{a.name}</div>
            <div className="email nc-ellipsis">{a.viaWorkspace ? t('lp.agents.pages_shared_with_everyone', 'Pages shared with everyone') : a.direct ? t('lp.agents.added_to_this_page', 'Added to this page') : t('lp.agents.access_from_a_parent_page', 'Access from a parent page')}</div>
          </div>
          <div
            role="button"
            className={`nc-share-role ${canManage && a.direct ? '' : 'disabled'}`}
            onClick={(e) => {
              if (!canManage || !a.direct) return;
              // a choice closes only this menu (the Share menu stays open)
              const close = openMenu(e.currentTarget, {
                width: 260,
                sections: [{
                  items: [{
                    label: t('lp.agents.remove_s_access', 'Remove {agentName}’s access', { agentName: a.name }),
                    description: t('lp.agents.the_agent_s_page_access_will', 'The agent’s page access will be fully removed'),
                    icon: 'trash',
                    danger: true,
                    onSelect: () => {
                      close();
                      void remove(a);
                      return false;
                    },
                  }],
                }],
              }, { placement: 'bottom-end' });
            }}
          >
            <span className="nc-ellipsis">{GRANT_ROLE_LABEL[(a.role === 'editor' || a.role === 'read_and_write' || a.role === 'comment_only' ? a.role : 'reader') as GrantRole]}</span>
            {canManage && a.direct && <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />}
          </div>
        </div>
      ))}
      {open && <div className="nc-share-agents-note">{t('lp.agents.sharing_lets_these_users_access_this', 'Sharing lets these users access this agent’s sources and tools, even without separate access.')}</div>}
    </div>
  );
}


export function openAgentAccessSettings(anchor: HTMLElement, pageId: string, canManage: boolean) {
  const page = records.get<BlockRecord>('block', pageId);
  const policy = (page?.format as { agent_access_policy?: string } | undefined)?.agent_access_policy === 'full_access' ? 'full_access' : 'anyone';
  const set = (v: 'anyone' | 'full_access') => {
    if (!page) return;
    run('setAgentAccessPolicy', (tx) => tx.set('block', page.id, ['format', 'agent_access_policy'], v === 'anyone' ? null : v));
  };
  const close = openMenu(anchor, {
    width: 320,
    sections: [{
      title: t('lp.agents.agent_access_settings', 'Agent permissions'),
      items: [
        { label: t('lp.agents.anyone_with_access', 'Everyone with access'), checked: policy === 'anyone', disabled: !canManage, onSelect: () => { set('anyone'); close(); return false; } },
        { label: t('lp.agents.restricted_to_full_access', 'Restricted to Full access'), checked: policy === 'full_access', disabled: !canManage, onSelect: () => { set('full_access'); close(); return false; } },
      ],
    }],
    header: <div className="nc-agent-menu-foot" style={{ borderTop: 'none', borderBottom: '1px solid var(--lp-border-secondary-transparent)' }}>{t('lp.agents.who_can_share_this_page_with', 'Who can share this page with agents')}{canManage ? '' : ` — ${t('lp.agents.only_users_with_full_access_can', 'Only users with full access can change this setting.')}`}</div>,
  }, { placement: 'top-start' });
}

