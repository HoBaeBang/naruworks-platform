import { HELP_URL } from '@nc/shared/brand.ts';

// (Instructions, Triggers, Tools and permissions, Model, Advanced), banners for the agent's state (unsaved, paused,
// disabled, in Trash, plan, missing key), and the topbar (crumbs + unsaved edits / Save, Run, Credits, Share,
// Settings, •••) rendered into the shell's topbar via <AgentCrumbs/> and <AgentTopbarActions/>.
import { useEffect, useState, type ReactElement } from 'react';
import { compactId } from '@nc/shared/ids.ts';
import { PAUSED_REASON_LABEL } from '@nc/shared/agents.ts';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { useRecord } from '../../lib/hooks.ts';
import { navigate, spaceDomain } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { ChatView } from '../ai/ChatView.tsx';
import { NoKeyNotice } from '../ai/NoKeyNotice.tsx';
import { choiceDialog } from '../ai/dialogs.tsx';
import { ensureAiStatus, useAiStatus } from '../ai/aiApi.ts';
import '../ai/ai.css';
import { agentApi, agentIdFromParam, agentUrl, applyAnswer, openAgent, toastError, useAgents, type AgentDetail } from './agentsApi.ts';
import { canEditAgent, refreshAgentList, useAgentPage, type AgentTab } from './agentPage.ts';
import { AgentIcon } from './AgentsSection.tsx';
import { AgentSettingsPanel } from './AgentSettings.tsx';
import { AgentActivity } from './AgentActivity.tsx';
import { AgentInsights } from './AgentInsights.tsx';
import { openAgentShare } from './AgentShare.tsx';
import { openVersionHistory } from './AgentVersions.tsx';
import { openAgentChats } from './AgentChats.tsx';
import './icons.tsx';
import './agents.css';

function tabFromUrl(): AgentTab | 'settings' | null {
  const v = new URLSearchParams(location.search).get('tab');
  return v === 'activity' || v === 'insights' || v === 'chat' || v === 'settings' ? v : null;
}

function setTabInUrl(tab: AgentTab) {
  const u = new URL(location.href);
  if (tab === 'chat') u.searchParams.delete('tab');
  else u.searchParams.set('tab', tab);
  u.searchParams.delete('q');
  history.replaceState(null, '', u.pathname + u.search);
}

export function AgentPage({ agentId: param }: { agentId: string }) {
  const agentId = agentIdFromParam(param);
  const { detail, noAccess, error, tab, settingsOpen } = useAgentPage();
  const rec = useRecord<{ version: number; space_id: string }>('workflow', agentId);
  const spaceId = useSession((s) => s.spaceId);
  const [chatId, setChatId] = useState<string | null>(null);
  // a new ChatView only when the person opens another chat or starts a new one (not when the first message of a new
  // chat creates its thread — the answer is still streaming into the current view)
  const [chatKey, setChatKey] = useState(0);
  const switchChat = (id: string | null) => {
    setChatId(id);
    setChatKey((k) => k + 1);
  };
  const onChat = (id: string | null) => {
    setChatId(id);
    if (id) setAutoSend(null);
  };
  // "Create a new agent" › describe → ?q=… is the setup chat's first message (sent once: cleared when its thread exists)
  const [autoSend, setAutoSend] = useState<{ text: string; key: string } | null>(null);

  useEffect(() => ensureAiStatus(), []);
  useEffect(() => {
    const fromUrl = tabFromUrl();
    useAgentPage.getState().setTab(fromUrl === 'activity' || fromUrl === 'insights' ? fromUrl : 'chat');
    void useAgentPage.getState().open(agentId).then(() => {
      if (fromUrl === 'settings') useAgentPage.getState().setSettingsOpen(true);
    });
    switchChat(null);
    const q = new URLSearchParams(location.search).get('q');
    setAutoSend(q ? { text: q, key: `${agentId}:${q}` } : null);
    return () => useAgentPage.getState().close();
  }, [agentId]);
  // realtime: someone saved / shared / renamed the agent → refresh the detail
  useEffect(() => {
    if (!rec || !detail) return;
    const timer = setTimeout(() => void useAgentPage.getState().refresh(), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.version]);
  // an agent of another of my workspaces switches to it
  useEffect(() => {
    if (rec?.space_id && spaceId && rec.space_id !== spaceId && records.get('space', rec.space_id)) useSession.getState().setSpace(rec.space_id);
  }, [rec?.space_id, spaceId]);

  if (error) {
    return (
      <div className="nc-agent-noaccess" data-testid="agent-not-found">
        <Icon name="agentFace" size={40} />
        <div className="ttl">{t('lp.agents.we_couldn_t_find_that_agent', 'We couldn’t find that agent')}</div>
        <div className="desc">{t('lp.agents.the_link_might_be_wrong_or', 'The link might be wrong, or the agent may have been deleted.')}</div>
        <button type="button" className="nc-btn outline" onClick={() => navigate(`/${spaceDomain(useSession.getState().spaceId)}`)}>{t('lp.agents.return_to_my_workspace', 'Return to my workspace')}</button>
      </div>
    );
  }
  if (noAccess) return <NoAccess />;
  if (!detail) return <div className="nc-agent-loading" aria-busy="true" />;
  const showSettings = settingsOpen;
  return (
    <div className={`nc-agent-page ${showSettings ? 'with-settings' : ''}`} data-agent-id={detail.agent.id} data-testid="agent-page">
      <div className="nc-agent-main">
        <AgentBanners d={detail} />
        <div className="nc-agent-tabs" role="tablist">
          {([['chat', t('lp.agents.chat', 'Chat')], ['activity', t('lp.agents.activity', 'Activity')], ...(canEditAgent(detail) ? [['insights', t('lp.agents.insights', 'Insights')]] : [])] as [AgentTab, string][]).map(([id, label]) => (
            <div key={id} role="tab" aria-selected={tab === id} className={`nc-agent-tab ${tab === id ? 'on' : ''}`} data-tab={id} onClick={() => { useAgentPage.getState().setTab(id); setTabInUrl(id); }}>{label}</div>
          ))}
          {tab === 'chat' && (
            <div className="nc-agent-tabs-right">
              <div role="button" aria-label={t('lp.agents.recent_chats', 'Recent chats')} data-tooltip={t('lp.agents.recent_chats', 'Recent chats')} className="nc-agent-icon-btn" onClick={(e) => openAgentChats(detail.agent.id, e.currentTarget, (id) => switchChat(id), () => switchChat(null))}>
                <Icon name="history" size={16} />
              </div>
              {chatId && (
                <div role="button" aria-label={t('lp.agents.new_chat', 'New chat')} data-tooltip={t('lp.agents.new_chat', 'New chat')} className="nc-agent-icon-btn" onClick={() => switchChat(null)}>
                  <Icon name="chatBubblePlus" size={16} />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="nc-agent-body">
          {tab === 'chat' && <AgentChat d={detail} chatId={chatId} chatKey={chatKey} onChat={onChat} autoSend={autoSend} />}
          {tab === 'activity' && <AgentActivity d={detail} />}
          {tab === 'insights' && canEditAgent(detail) && <AgentInsights d={detail} />}
        </div>
      </div>
      {showSettings && <AgentSettingsPanel d={detail} />}
    </div>
  );
}

// ---------------------------------------------------------------- chat

const FOLLOW_UPS = [
  ['agentActions.followUp.slackQaHelper', 'Answer common team policy questions'],
  ['agentActions.followUp.slackTaskTriager', 'Triage requests from a team channel'],
  ['agentActions.followUp.weeklyProjectUpdate', 'Compile a weekly market watch report'],
];

function AgentChat({ d, chatId, chatKey, onChat, autoSend }: { d: AgentDetail; chatId: string | null; chatKey: number; onChat: (id: string | null) => void; autoSend: { text: string; key: string } | null }) {
  const configured = useAiStatus((s) => s.configured);
  const [prefill, setPrefill] = useState<{ text: string; key: string } | null>(null);
  const setup = !d.agent.published && canEditAgent(d);
  const name = d.config.name || t('lp.agents.untitled_agent', 'Untitled agent');
  const landing = (
    <div className="nc-agent-intro" data-testid="agent-chat-intro">
      <div className="nc-agent-intro-icon"><AgentIcon icon={d.config.icon} size={48} /></div>
      <div className="nc-agent-intro-name">{name}</div>
      {d.config.description && <div className="nc-agent-intro-desc">{d.config.description}</div>}
      {setup && (
        <div className="nc-agent-canned">
          <div className="nc-agent-canned-text">{t('lp.agents.hi_i_m_your_new_agent', 'Hi, I’m your new agent. Tell me what you’d like done and I’ll update my settings. Not sure where to begin? Try one of these:')}</div>
          <div className="nc-agent-followups">
            {FOLLOW_UPS.map(([id, label]) => (
              <div key={id} role="button" className="nc-agent-followup" onClick={() => setPrefill({ text: t(id, label), key: `${id}:${Date.now()}` })}>{t(id, label)}</div>
            ))}
          </div>
        </div>
      )}
      {configured === false && <NoKeyNotice />}
    </div>
  );
  if (!d.available) return <div className="nc-agent-chat-off">{t('lp.agents.using_this_agent_requires_an_upgrade', 'Using this agent requires an upgrade to {productName}', { productName: 'Business' })}</div>;
  if (d.agent.status === 'disabled') return <div className="nc-agent-chat-off">{t('lp.agents.chat_is_unavailable_while_this_agent', 'Chat is unavailable while this agent is paused')}</div>;
  if (!d.agent.published && !canEditAgent(d)) return <div className="nc-agent-chat-off">{t('lp.agents.to_chat_with_this_agent_publish', 'To chat with this agent, publish it first. <settingsLink>Go to settings</settingsLink>').replace(/<\/?settingsLink>/g, '')}</div>;
  return (
    <div className="nc-agent-chat">
      <ChatView
        key={chatKey}
        variant="page"
        threadId={chatId}
        agent={{ id: d.agent.id, name, modelOverride: d.live.allow_model_override !== false, model: d.live.model }}
        landing={landing}
        placeholder={t('lp.agents.ask_agentname_select_undefined_other', 'Message {agentName, select, undefined {this agent} other {{agentName}}}…', { agentName: name })}
        undo={(messageId) => agentApi.undo(messageId) as Promise<{ conflicts: number; changes?: unknown }>}
        onThreadChange={(id) => onChat(id)}
        autoSend={autoSend}
        prefill={prefill}
      />
    </div>
  );
}

// ---------------------------------------------------------------- banners

function AgentBanners({ d }: { d: AgentDetail }) {
  const a = d.agent;
  const edit = canEditAgent(d);
  const resume = async () => {
    try {
      const r = await agentApi.resume(a.id);
      useUI.getState().toast(r.resumed ? t('lp.agents.resumed_resumedcount_plural_one_other', 'Restarted {resumedCount} {resumedCount, plural, one {job} other {jobs}}', { resumedCount: r.resumed }) : t('lp.agents.agent_resumed_successfully', 'Agent resumed successfully'));
      void useAgentPage.getState().refresh();
    } catch (e) {
      toastError(e, t('lp.agents.couldn_t_resume_agent', 'Couldn’t resume agent'));
    }
  };
  const out: ReactElement[] = [];
  if (!a.alive) {
    out.push(
      <div key="trash" className="nc-agent-banner danger" data-testid="agent-trash-banner">
        <span>{t('lp.agents.this_agent_is_in_trash', 'This agent is in Trash')}</span>
        {d.role === 'editor' && (
          <>
            <button type="button" className="nc-agent-banner-btn" onClick={() => void agentApi.restore(a.id).then((r) => { applyAnswer(r as any); void useAgentPage.getState().refresh(); }).catch((e) => toastError(e))}>{t('lp.agents.restore_agent', 'Restore Agent')}</button>
            <button type="button" className="nc-agent-banner-btn" onClick={async () => {
              const ok = await choiceDialog({ title: t('lp.agents.permanently_delete_this_agent', 'Permanently delete this agent?'), buttons: [{ label: t('lp.agents.permanently_delete', 'Permanently delete'), value: true, danger: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }] });
              if (!ok) return;
              await agentApi.permanentlyDelete(a.id).catch((e) => toastError(e));
              refreshAgentList();
              navigate(`/${spaceDomain(useSession.getState().spaceId)}`);
            }}>{t('lp.agents.permanently_delete', 'Permanently delete')}</button>
          </>
        )}
      </div>,
    );
  }
  if (!d.available) out.push(<div key="plan" className="nc-agent-banner">{t('lp.agents.using_this_agent_requires_an_upgrade', 'Using this agent requires an upgrade to {productName}', { productName: 'Business' })}<button type="button" className="nc-agent-banner-btn" onClick={() => useUI.getState().openSettings('plans')}>{t('lp.agents.upgrade_to_try_it', 'Upgrade to try it')}</button></div>);
  
  const changePermissions = (anchor: HTMLElement) => {
    if (records.get<SpaceRecord>('space', useSession.getState().spaceId)?.plan_type === 'enterprise') openAgentShare(d, anchor);
    else useUI.getState().openSettings('lit-ai');
  };
  const orphanedOff = a.status === 'disabled' && a.pausedReason === 'orphaned';
  if (a.alive && d.orphan && !orphanedOff && a.status !== 'disabled') {
    out.push(
      <div key="orphan" className="nc-agent-banner warn" data-testid="agent-orphan-banner">
        <span>{t('lp.agents.no_one_has_full_access_to', 'No one has Full access to this agent. Grant Full access to at least one person in the agent’s Share settings, or it will be disabled in {daysRemaining, plural, one {# day} other {# days}}.', { daysRemaining: d.orphan.daysRemaining })}</span>
        {d.isAdmin && <button type="button" className="nc-agent-banner-btn" onClick={(e) => changePermissions(e.currentTarget)}>{t('lp.agents.change_permissions', 'Change permissions')}</button>}
      </div>,
    );
  }
  if (a.alive && orphanedOff) {
    out.push(
      <div key="disabled" className="nc-agent-banner warn" data-testid="agent-disabled-banner">
        <span>{t('lp.agents.this_agent_is_paused_because_no', 'This agent is paused because no one has full access. Grant full access to someone in Share settings, then try again.')}</span>
        {d.isAdmin && <button type="button" className="nc-agent-banner-btn" onClick={(e) => changePermissions(e.currentTarget)}>{t('lp.agents.change_permissions', 'Change permissions')}</button>}
      </div>,
    );
  } else if (a.alive && a.status === 'disabled') {
    out.push(
      <div key="disabled" className="nc-agent-banner warn" data-testid="agent-disabled-banner">
        <span>{a.pausedReason === 'disabled_by_admin' ? t('lp.agents.a_workspace_owner_has_paused_this', 'A workspace owner has paused this agent') : t('lp.agents.this_agent_is_currently_paused', 'This agent is currently paused')}</span>
        {(edit && a.pausedReason !== 'disabled_by_admin') || d.isAdmin ? <button type="button" className="nc-agent-banner-btn" onClick={() => void agentApi.setEnabled(a.id, true).then(() => useAgentPage.getState().refresh()).catch((e) => toastError(e))}>{t('lp.agents.enable_agent_again', 'Enable agent again')}</button> : null}
      </div>,
    );
  }
  if (a.alive && a.status === 'paused') {
    const failure = a.pausedReason === 'failure_limit';
    out.push(
      <div key="paused" className="nc-agent-banner warn" data-testid="agent-paused-banner">
        <span>
          <b>{failure ? t('lp.agents.repeated_errors_caused_this_agent_to', 'Repeated errors caused this agent to pause') : a.pausedReason === 'run_limit' ? t('lp.agents.paused_runs_can_be_resumed', 'Paused runs can be resumed') : PAUSED_REASON_LABEL[a.pausedReason ?? 'run_limit']}</b>
          {failure && <> · {t('lp.agents.check_the_agent_settings_then_resume', 'Check the agent settings, then resume it to retry the failed runs')}</>}
          {d.heldRuns > 0 && !failure && <> · {t('lp.agents.count_plural_one_other_paused_while', '{count} {count, plural, one {run was} other {runs were}} paused while this agent was disabled. Resume {count, plural, one {it} other {them}}?', { count: d.heldRuns })}</>}
        </span>
        {edit && <button type="button" className="nc-agent-banner-btn" onClick={() => void resume()}>{d.heldRuns ? t('lp.agents.resume_count_plural_one_other', 'Restart {count} {count, plural, one {job} other {jobs}}', { count: d.heldRuns }) : t('lp.agents.resume', 'Resume')}</button>}
      </div>,
    );
  }
  if (a.alive && !a.published && edit) out.push(<div key="pending" className="nc-agent-banner info" data-testid="agent-pending-banner">{t('lp.agents.save_this_agent_to_activate_it', 'Save this agent to activate it. Until then, it stays pending and ignores triggers.')}</div>);
  if (a.alive && d.accessProblem && edit) out.push(<div key="access" className="nc-agent-banner danger" data-testid="agent-access-banner">{d.accessProblem}</div>);
  return out.length ? <div className="nc-agent-banners">{out}</div> : null;
}

// ---------------------------------------------------------------- no access (workspace owners)

function NoAccess() {
  const n = useAgentPage((s) => s.noAccess)!;
  return (
    <div className="nc-agent-noaccess" data-testid="agent-no-access">
      <AgentIcon icon={n.icon} size={40} />
      <div className="ttl">{t('lp.agents.access_denied_for', 'Access denied for {workflowName}', { workflowName: n.name })}</div>
      <div className="desc">{t('lp.agents.ask_the_agent_owners_for_access', 'Ask the agent owners for access')}</div>
      {n.owners.length > 0 && <div className="desc">{t('lp.agents.owners', 'Owners:')} {n.owners.map((o) => o.name).join(', ')}</div>}
      <div className="desc">{t('lp.agents.this_agent_has_count_plural_one', 'This agent has {count, plural, one {# automation} other {# automations}}', { count: n.triggerCount })}</div>
      {n.admin && (
        <div className="nc-agent-noaccess-actions">
          <button type="button" className="nc-btn outline" onClick={() => void agentApi.setEnabled(n.agentId, n.status !== 'active').then(() => useAgentPage.getState().open(n.agentId)).catch((e) => toastError(e))}>
            {n.status === 'active' ? t('lp.agents.disable_custom_agent', 'Turn off custom agent') : t('lp.agents.enable_custom_agent', 'Turn on custom agent')}
          </button>
          <button type="button" className="nc-btn primary" onClick={() => void agentApi.adminJoin(n.agentId).then(() => useAgentPage.getState().open(n.agentId)).catch((e) => toastError(e))}>
            {t('lp.agents.change_permissions', 'Change permissions')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- topbar (rendered by the shell Topbar)

export function AgentCrumbs() {
  const d = useAgentPage((s) => s.detail);
  const n = useAgentPage((s) => s.noAccess);
  const spaceId = useSession((s) => s.spaceId);
  const name = d?.config.name ?? n?.name ?? '';
  return (
    <div className="nc-breadcrumb notranslate" data-testid="agent-crumbs">
      <div role="button" className="nc-crumb" onClick={() => navigate(`/${spaceDomain(spaceId)}/library/agents`)}>
        <span className="nc-ellipsis">{t('lp.agents.agents', 'Agents')}</span>
      </div>
      {name && (
        <>
          <span className="nc-crumb-sep">/</span>
          <div role="button" className="nc-crumb" onClick={() => d && openAgent(d.agent.id)}>
            <AgentIcon icon={d?.config.icon ?? n?.icon} size={18} />
            <span className="nc-ellipsis" style={{ marginInlineStart: 6 }}>{name}</span>
          </div>
        </>
      )}
    </div>
  );
}

function CreditsPopover({ d, close }: { d: AgentDetail; close: () => void }) {
  const [limit, setLimit] = useState(d.credits.limit === null ? '' : String(d.credits.limit));
  const [busy, setBusy] = useState(false);
  const full = d.role === 'editor';
  const save = async () => {
    setBusy(true);
    try {
      await agentApi.setCreditLimit(d.agent.id, limit.trim() === '' ? null : Number(limit));
      void useAgentPage.getState().refresh();
      close();
    } catch (e) {
      toastError(e, t('lp.agents.the_monthly_limit_didn_t_update', 'The monthly limit didn’t update. Give it another try.'));
      setBusy(false);
    }
  };
  const pct = d.credits.limit ? Math.min(100, Math.round((d.credits.used / Math.max(1, d.credits.limit)) * 100)) : 0;
  return (
    <PopoverSurface width={300} className="nc-agent-credits">
      <div className="nc-agent-pop-title">{t('lp.agents.credit_usage', 'Credit usage')}</div>
      <div className="nc-agent-credits-row">
        <span className="lbl">{t('lp.agents.monthly_agent_usage', 'Monthly agent usage')}</span>
        <span className="val" data-testid="agent-credits-used">{d.credits.used}{d.credits.limit !== null ? ` ${t('lp.agents.text', '/ {limit}', { limit: d.credits.limit })}` : ''}</span>
      </div>
      {d.credits.limit !== null && <div className="nc-agent-meter" aria-label={t('lp.agents.of_credits', '{used} of {limit} credits', { used: d.credits.used, limit: d.credits.limit })}><div style={{ width: `${pct}%` }} /></div>}
      <div className="nc-agent-credits-row">
        <span className="lbl">{t('lp.agents.owner', 'Owner')}</span>
        <span className="val">{d.credits.ownerName || t('lp.agents.no_owner', 'No owner')}</span>
      </div>
      <div className="nc-agent-credits-row">
        <span className="lbl">{t('lp.agents.monthly_limit', 'Monthly limit')}</span>
        {full ? (
          <span className="val">
            <input className="nc-agent-input small" inputMode="numeric" value={limit} placeholder="—" aria-label={t('lp.agents.monthly_limit', 'Monthly limit')} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
            <button type="button" className="nc-btn primary small" disabled={busy} onClick={() => void save()}>{busy ? t('lp.agents.saving', 'Saving…') : t('lp.agents.set_limit', 'Set limit')}</button>
          </span>
        ) : <span className="val">{d.credits.limit ?? '—'}</span>}
      </div>
      <div className="nc-agent-pop-foot">{t('lp.agents.custom_agent_credits_reset_when_each', 'Custom agent credits reset when each billing month begins.')}</div>
    </PopoverSurface>
  );
}

function openMore(d: AgentDetail, anchor: HTMLElement) {
  const a = d.agent;
  const copyLink = () => {
    void navigator.clipboard?.writeText(`${location.origin}${agentUrl(a.id)}`).catch(() => {});
    useUI.getState().toast(t('lp.agents.the_link_is_on_your_clipboard', 'The link is on your clipboard'));
  };
  openMenu(anchor, {
    width: 260,
    sections: [
      {
        items: [
          { label: a.favorite ? t('lp.agents.unfavorite_this_agent', 'Unfavorite this agent') : t('lp.agents.favorite_this_agent', 'Favorite this agent'), icon: 'star', onSelect: () => void agentApi.favorite(a.id, !a.favorite).then(() => useAgentPage.getState().refresh()).then(refreshAgentList) },
          { label: t('lp.agents.copy_link', 'Copy link'), icon: 'link', onSelect: copyLink },
          {
            label: t('lp.agents.duplicate', 'Duplicate'),
            icon: 'duplicate',
            onSelect: async () => {
              try {
                const r = await agentApi.duplicate(a.id);
                applyAnswer(r);
                openAgent(r.agentId, 'settings');
              } catch (e) {
                toastError(e, t('lp.agents.couldn_t_duplicate_the_agent_try', 'Couldn’t duplicate the agent. Try again.'));
              }
            },
          },
          // menus close every overlay after a choice: dialogs open on the next tick
          { label: t('lp.agents.version_history', 'Version history'), icon: 'agentVersions', onSelect: () => void setTimeout(() => openVersionHistory(d), 0) },
        ],
      },
      ...(canEditAgent(d) || d.isAdmin
        ? [{
          items: [
            a.status === 'disabled'
              ? { label: t('lp.agents.enable_agent', 'Enable agent'), icon: 'agentPlay', onSelect: () => void agentApi.setEnabled(a.id, true).then(() => useAgentPage.getState().refresh()).catch((e) => toastError(e)) }
              : { label: t('lp.agents.disable_custom_agent', 'Turn off custom agent'), icon: 'agentPause', onSelect: () => void agentApi.setEnabled(a.id, false).then(() => useAgentPage.getState().refresh()).catch((e) => toastError(e)) },
          ],
        }]
        : []),
      ...(d.role === 'editor' && a.alive
        ? [{
          items: [{
            label: t('lp.agents.send_to_trash', 'Send to Trash'),
            icon: 'trash',
            danger: true,
            onSelect: () => void setTimeout(async () => {
              const ok = await choiceDialog({
                title: t('lp.agents.move_agentname_select_undefined_other_to', 'Move {agentName, select, undefined {this agent} other {{agentName}}} to Trash?', { agentName: a.name }),
                buttons: [{ label: t('lp.agents.send_to_trash', 'Send to Trash'), value: true, danger: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }],
              });
              if (!ok) return;
              try {
                await agentApi.remove(a.id);
                refreshAgentList();
                void useAgentPage.getState().refresh();
              } catch (e) {
                toastError(e, t('lp.agents.something_went_wrong_moving_this_agent', 'Something went wrong while loading moving this agent to Trash. Try again.'));
              }
            }, 0),
          }],
        }]
        : []),
      ...(HELP_URL ? [{ items: [{ label: t('lp.agents.how_custom_agents_work', 'How custom agents work'), icon: 'questionMarkCircle', onSelect: () => window.open(HELP_URL!, '_blank', 'noopener') }] }] : []),
    ],
  }, { placement: 'bottom-end' });
}

export function AgentTopbarActions() {
  const d = useAgentPage((s) => s.detail);
  const saving = useAgentPage((s) => s.saving);
  const settingsOpen = useAgentPage((s) => s.settingsOpen);
  if (!d) return null;
  const edit = canEditAgent(d);
  const unsaved = d.changes.length;
  const run = async () => {
    try {
      await agentApi.run(d.agent.id);
      useUI.getState().toast(t('lp.agents.run_started_see_the_activity', 'Run started — see the Activity'), { label: t('lp.agents.activity', 'Activity'), run: () => { useAgentPage.getState().setTab('activity'); setTabInUrl('activity'); } });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="nc-agent-topbar" data-testid="agent-topbar">
      {edit && (unsaved > 0 || !d.agent.published) && (
        <>
          {unsaved > 0 && <span className="nc-agent-unsaved" data-testid="agent-unsaved">{t('lp.agents.count_plural_one_other_f08b', '{count, plural, one {# pending edit} other {# pending edits}}', { count: unsaved })}</span>}
          {unsaved > 0 && d.agent.published && (
            <div role="button" className="nc-btn secondary small" onClick={async () => {
              const ok = await choiceDialog({ title: t('lp.agents.discard_the_changes_you_haven_t', 'Discard the changes you haven’t saved yet?'), buttons: [{ label: t('lp.agents.discard_changes', 'Discard changes'), value: true, danger: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }] });
              if (ok) void useAgentPage.getState().discard();
            }}>{t('lp.agents.discard_changes', 'Discard changes')}</div>
          )}
          <div role="button" aria-disabled={saving} className="nc-btn primary small nc-agent-save" data-testid="agent-save" onClick={() => void saveWithWarnings(d)}>
            {saving ? t('lp.agents.saving_agent', 'Saving agent…') : t('lp.agents.save', 'Save')}
          </div>
        </>
      )}
      {d.agent.published && d.agent.alive && (
        <div role="button" className="nc-btn secondary small" data-testid="agent-run" aria-label={t('lp.agents.run_agent', 'Run agent')} data-tooltip={t('lp.agents.run_agent', 'Run agent')} onClick={() => void run()}>
          <Icon name="agentPlay" size={14} />
          <span>{t('lp.agents.run', 'Run')}</span>
        </div>
      )}
      <div role="button" className="nc-btn secondary small" aria-label={t('lp.agents.credits', 'Credits')} data-testid="agent-credits" onClick={(e) => { const anchor = e.currentTarget; openOverlay((close) => <CreditsPopover d={d} close={close} />, { anchor, placement: 'bottom-end', offset: 6 }); }}>
        <Icon name="agentCredits" size={14} />
        <span>{t('lp.agents.credits', 'Credits')}</span>
      </div>
      <div role="button" className="nc-btn secondary small" data-testid="agent-share" aria-label={t('lp.agents.share_custom_agent', 'Share this custom agent')} data-tooltip={t('lp.agents.share_custom_agent', 'Share this custom agent')} onClick={(e) => openAgentShare(d, e.currentTarget)}>
        {t('lp.agents.share', 'Share')}
      </div>
      <div role="button" aria-pressed={settingsOpen} aria-label={t('lp.agents.settings', 'Settings')} data-tooltip={t('lp.agents.settings', 'Settings')} data-testid="agent-settings-toggle" className={`nc-agent-icon-btn ${settingsOpen ? 'on' : ''}`} onClick={() => useAgentPage.getState().setSettingsOpen(!settingsOpen)}>
        <Icon name="sliders" size={16} />
      </div>
      <div role="button" aria-label={t('lp.agents.more', 'More…')} data-tooltip={t('lp.agents.more', 'More…')} data-testid="agent-more" className="nc-agent-icon-btn" onClick={(e) => openMore(d, e.currentTarget)}>
        <Icon name="ellipsis" size={18} />
      </div>
    </div>
  );
}


async function saveWithWarnings(d: AgentDetail) {
  const shared = d.sharing.filter((s) => !(s.type === 'user_permission' && s.role === 'editor')).length > 0;
  const before = new Set(d.live.grants.map((g) => g.block_id));
  const added = d.config.grants.filter((g) => !before.has(g.block_id));
  const broad = d.config.workspace_access === 'reader' && d.live.workspace_access !== 'reader';
  if (shared && (added.length || broad)) {
    const ok = await choiceDialog({
      title: t('lp.agents.save_agentname_select_undefined_other', 'Save {agentName, select, undefined {this agent} other {{agentName}}} now?', { agentName: d.config.name }),
      description: (
        <div>
          <div>{t('lp.agents.people_given_can_interact_on_this', 'People given ‘Can interact’ on this agent receive everything listed below.')}</div>
          <ul className="nc-agent-warn-list">
            {broad && <li>{t('lp.agents.can_access_pages_open_to_all', 'Can access pages open to all of {spaceName}', { spaceName: records.get('space', useSession.getState().spaceId)?.name ?? '' })}</li>}
            {added.length > 0 && <li>{t('lp.agents.access_to_private_count_plural_one', 'Can open {count} private {count, plural, one {page} other {pages}}', { count: added.length })}</li>}
          </ul>
        </div>
      ),
      buttons: [{ label: t('lp.agents.i_understand_continue', 'I understand, continue'), value: true, primary: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }],
    });
    if (!ok) return;
  }
  await useAgentPage.getState().save();
}

export { compactId, useAgents };
