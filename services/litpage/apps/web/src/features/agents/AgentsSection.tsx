
// Shows saved agents, actions for each row, and the control for creating a new agent.
import { useEffect, useMemo } from 'react';
import { compactId } from '@nc/shared/ids.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { useLocation } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';
import { SectionShell } from '../shell/sidebar/Sections.tsx';
import type { SidebarSection } from '../shell/sidebar/model.ts';
import { choiceDialog } from '../ai/dialogs.tsx';
import { agentApi, agentUrl, openAgent, toastError, useAgents, type AgentSummary } from './agentsApi.ts';
import { openNewAgentModal } from './NewAgentModal.tsx';
import './mentions.tsx';
import './agents.css';

export function AgentIcon({ icon, size = 20 }: { icon?: string | null; size?: number }) {
  return <PageIcon icon={icon ?? undefined} fallback="agentFace" size={size} />;
}


export function sidebarOrder(list: AgentSummary[], me: string | null): AgentSummary[] {
  const mine = list.filter((a) => a.alive && (a.favorite || a.visited || a.createdBy === me));
  const key = (a: AgentSummary) => Math.max(a.visited ?? 0, a.createdBy === me ? a.createdTime : 0);
  return [...mine.filter((a) => a.favorite).sort((x, y) => key(y) - key(x)), ...mine.filter((a) => !a.favorite).sort((x, y) => key(y) - key(x))];
}

export function openAgentMenu(a: AgentSummary, anchor: HTMLElement, opts: { onDeleted?: () => void } = {}) {
  const spaceId = useSession.getState().spaceId;
  openMenu(anchor, {
    width: 240,
    sections: [
      {
        items: [
          {
            label: a.favorite ? t('lp.agents.remove_from_favorites', 'Remove from saved') : t('lp.agents.add_to_favorites', 'Save to favorites'),
            icon: 'star',
            onSelect: () => {
              useAgents.getState().patch(a.id, { favorite: !a.favorite });
              void agentApi.favorite(a.id, !a.favorite).catch((e) => toastError(e));
            },
          },
          { label: t('lp.agents.view_settings', 'View settings'), icon: 'gear', onSelect: () => openAgent(a.id, 'settings') },
          ...(a.role === 'editor' || a.role === 'read_and_write' ? [{ label: t('lp.agents.view_insights', 'View insights'), icon: 'chartBarYAxis', onSelect: () => openAgent(a.id, 'insights') }] : []),
          {
            label: t('lp.agents.copy_link', 'Copy link'),
            icon: 'link',
            onSelect: () => {
              void navigator.clipboard?.writeText(`${location.origin}${agentUrl(a.id)}`).catch(() => {});
              useUI.getState().toast(t('lp.agents.the_link_is_on_your_clipboard', 'The link is on your clipboard'));
            },
          },
        ],
      },
      ...(a.role === 'editor'
        ? [{
          items: [{
            label: t('lp.agents.send_to_trash', 'Send to Trash'),
            icon: 'trash',
            danger: true,
            onSelect: () => void setTimeout(async () => {
              const ok = await choiceDialog({
                title: t('lp.agents.move_to_the_trash_now', 'Move {agentName} to the Trash now?', { agentName: a.name }),
                buttons: [{ label: t('lp.agents.send_to_trash', 'Send to Trash'), value: true, danger: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }],
              });
              if (!ok) return;
              try {
                await agentApi.remove(a.id);
                if (spaceId) void useAgents.getState().load(spaceId, true);
                opts.onDeleted?.();
              } catch (e) {
                toastError(e, t('lp.agents.something_went_wrong_moving_this_agent', 'Something went wrong while loading moving this agent to Trash. Try again.'));
              }
            }, 0),
          }],
        }]
        : []),
    ],
  }, { placement: 'bottom-start' });
}

export function AgentsSection({ section }: { section: SidebarSection }) {
  const spaceId = useSession((s) => s.spaceId);
  const me = useSession((s) => s.userId);
  const { agents, available, loaded } = useAgents();
  const { route } = useLocation();
  const activeId = route.name === 'agent' ? route.agentId : undefined;
  useEffect(() => {
    if (spaceId) void useAgents.getState().load(spaceId);
  }, [spaceId]);
  const list = useMemo(() => sidebarOrder(agents, me), [agents, me]);
  // Free / Plus: the default layout's section stays hidden (Custom Agents are Business+); a section people added
  // themselves shows the "New agent" entry, which explains the upgrade
  if (loaded && !available && section.id === 'sec-agents') return null;
  const limit = section.limit ?? 10;
  return (
    <SectionShell section={section} title={t('lp.agents.agents', 'Agents')}>
      <div role="tree" className="nc-sb-tree nc-agents-tree" data-testid="sidebar-agents">
        {list.slice(0, limit).map((a) => (
          <div key={a.id} className="nc-sb-page">
            <a
              role="treeitem"
              href={agentUrl(a.id)}
              aria-selected={a.id === activeId || compactId(a.id) === activeId}
              className={`nc-sb-item ${a.id === activeId ? 'selected' : ''}`}
              data-agent-id={a.id}
              onClick={(e) => {
                e.preventDefault();
                openAgent(a.id, undefined, { newTab: e.metaKey || e.ctrlKey });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openAgentMenu(a, e.currentTarget as HTMLElement);
              }}
            >
              <div className="nc-sb-item-inner">
                <div className="nc-sb-item-icon"><AgentIcon icon={a.icon} size={20} /></div>
                <div className="nc-sb-item-title"><div className="notranslate nc-ellipsis">{a.name || t('lp.agents.untitled_agent', 'Untitled agent')}</div></div>
                {a.status !== 'active' && <span className="nc-agents-paused-dot" data-tooltip={a.status === 'disabled' ? t('lp.agents.disabled', 'Disabled') : t('lp.agents.paused_c7df', 'Paused')} />}
                <div className="nc-sb-item-actions">
                  <div className="nc-sb-item-actions-inner">
                    <div
                      role="button"
                      aria-label={t('lp.agents.agent_menu', 'Agent menu')}
                      className="nc-sb-mini-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openAgentMenu(a, e.currentTarget as HTMLElement);
                      }}
                    >
                      <Icon name="ellipsisSmall" size={16} />
                    </div>
                  </div>
                </div>
              </div>
            </a>
          </div>
        ))}
        <div className="nc-sb-page">
          <div role="button" className="nc-sb-item nc-agents-new" data-testid="sidebar-new-agent" onClick={() => void openNewAgentModal()}>
            <div className="nc-sb-item-inner">
              <div className="nc-sb-item-icon"><Icon name="plus" size={16} style={{ color: 'var(--lp-icon-secondary)' }} /></div>
              <div className="nc-sb-item-title">
                <div className="nc-ellipsis" style={{ color: 'var(--lp-text-secondary)' }}>{t('lp.agents.new_agent', 'New agent')}</div>
              </div>
            </div>
          </div>
        </div>
        {loaded && !list.length && (
          <div className="nc-agents-empty-desc">{t('lp.agents.automate_repeat_work_with_shared_workflo', 'Automate repeat work with shared workflows')}</div>
        )}
      </div>
    </SectionShell>
  );
}
