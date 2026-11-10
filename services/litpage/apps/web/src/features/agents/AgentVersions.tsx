
// version to see its changes and restore it (Full access / Can edit — the restore is checked against what the
// person may grant, and becomes a new version).
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay } from '../../components/overlay.tsx';
import { formatDateTime } from '../../lib/format.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { choiceDialog } from '../ai/dialogs.tsx';
import { agentApi, applyAnswer, toastError, type AgentDetail } from './agentsApi.ts';
import { canEditAgent, useAgentPage } from './agentPage.ts';

type Version = Awaited<ReturnType<typeof agentApi.versions>>['versions'][number];

const KIND_ICON: Record<string, string> = {
  name: 'pencil', icon: 'emojiFace', description: 'text', instructions: 'page', trigger: 'agentTrigger', permission: 'agentShield',
  web: 'agentWeb', urls: 'agentWeb', fallback: 'agentShield', model: 'agentModel', connection: 'agentPlug', advanced: 'sliders', restore: 'history', created: 'plus',
};

function VersionHistory({ d, close }: { d: AgentDetail; close: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = canEditAgent(d);
  useEffect(() => {
    agentApi.versions(d.agent.id).then((r) => {
      setVersions(r.versions);
      setSel(r.versions[0]?.id ?? null);
    }).catch((e) => {
      toastError(e);
      setVersions([]);
    });
  }, [d.agent.id]);
  const cur = versions?.find((v) => v.id === sel) ?? null;
  const latest = versions?.[0]?.id;
  const restore = async () => {
    if (!cur) return;
    const ok = await choiceDialog({
      title: t('lp.agents.restore_this_version', 'Restore this saved version?'),
      description: t('lp.agents.the_agent_s_settings_and_instructions', 'The agent’s settings and instructions go back to how they were on {date}. Your current version stays in the history.', { date: formatDateTime(cur.createdTime) }),
      buttons: [{ label: t('lp.agents.restore', 'Restore'), value: true, primary: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }],
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await agentApi.restoreVersion(d.agent.id, cur.id);
      applyAnswer(r);
      useAgentPage.getState().setDetail(r);
      useUI.getState().toast(t('lp.agents.version_restored', 'Version restored'));
      close();
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  return (
    <div className="nc-agent-versions" role="dialog" aria-label={t('lp.agents.version_history', 'Version history')} data-testid="agent-versions">
      <div className="nc-agent-versions-list">
        <div className="nc-agent-versions-title">{t('lp.agents.version_history', 'Version history')}</div>
        {versions === null && <div className="nc-agent-muted pad">{t('lp.agents.loading', 'Loading…')}</div>}
        {versions?.length === 0 && <div className="nc-agent-muted pad">{t('lp.agents.save_the_agent_to_start_its', 'Save the agent to start its version history.')}</div>}
        {versions?.map((v) => (
          <div key={v.id} role="button" className={`nc-agent-version ${v.id === sel ? 'on' : ''}`} data-version-id={v.id} onClick={() => setSel(v.id)}>
            <div className="when">{formatDateTime(v.createdTime)}</div>
            <div className="who nc-ellipsis">{v.createdByName || t('lp.agents.unknown_user', 'Unknown user')}{v.id === latest ? ` · ${t('lp.agents.current_version', 'Current version')}` : ''}</div>
          </div>
        ))}
      </div>
      <div className="nc-agent-versions-detail">
        <div className="nc-agent-versions-head">
          <div className="ttl">{cur ? cur.name || t('lp.agents.untitled_agent', 'Untitled agent') : ''}</div>
          <div role="button" className="nc-agent-icon-btn" aria-label={t('lp.agents.close', 'Close')} onClick={close}><Icon name="close" size={16} /></div>
        </div>
        {cur && (
          <>
            <div className="nc-agent-row-sub">{t('lp.agents.saved_by', 'Saved by {name} · {date}', { name: cur.createdByName || t('lp.agents.unknown_user', 'Unknown user'), date: formatDateTime(cur.createdTime) })}</div>
            <div className="nc-agent-versions-changes">
              {cur.changes.length ? cur.changes.map((c, i) => (
                <div key={i} className="nc-agent-versions-change">
                  <Icon name={KIND_ICON[c.kind] ?? 'agentVersions'} size={14} />
                  <span>{c.label}</span>
                </div>
              )) : <div className="nc-agent-muted">{t('lp.agents.no_changes_to_the_settings', 'No changes to the settings')}</div>}
            </div>
            <div className="nc-agent-versions-foot">
              {edit && cur.id !== latest && <button type="button" className="nc-btn primary small" data-testid="agent-version-restore" disabled={busy} onClick={() => void restore()}>{t('lp.agents.restore', 'Restore')}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function openVersionHistory(d: AgentDetail) {
  openOverlay((close) => <VersionHistory d={d} close={close} />, { placement: 'center', backdrop: 'dim' });
}
