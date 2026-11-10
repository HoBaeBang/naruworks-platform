
// The connection belongs to the agent (its bot), is listed with the person who connected it, and only that person can

import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay } from '../../components/overlay.tsx';
import { t } from '../shell/i18n.ts';
import { agentApi, type AgentDetail, type McpPreset } from './agentsApi.ts';
import { useAgentPage } from './agentPage.ts';

function McpForm({ d, close, preset }: { d: AgentDetail; close: () => void; preset?: McpPreset }) {
  const [name, setName] = useState(preset?.name ?? '');
  const [url, setUrl] = useState(preset?.url ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await agentApi.addConnection(d.agent.id, preset ? { presetId: preset.id, token: token.trim() || undefined } : { name: name.trim() || undefined, url: url.trim(), token: token.trim() || undefined });
      const cur = useAgentPage.getState().detail;
      if (cur && cur.agent.id === d.agent.id) useAgentPage.getState().setDetail({ ...cur, ...r });
      close();
    } catch (e) {
      setError((e as Error)?.message || t('lp.agents.couldn_t_connect_to_this_server', 'Couldn’t connect to this server'));
      setBusy(false);
    }
  };
  return (
    <form
      className="nc-ai-dialog nc-ai-mcp-dialog"
      role="dialog"
      aria-label={t('lp.agents.custom_mcp_server', 'External MCP endpoint')}
      data-testid="agent-mcp-dialog"
      style={{ width: 440 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="nc-ai-dialog-title">{preset ? preset.name : t('lp.agents.custom_mcp_server', 'External MCP endpoint')}</div>
      {preset ? (
        <div className="nc-ai-dialog-desc">
          {preset.description || t('lp.agents.shared_with_this_workspace_by_an', 'Shared with this workspace by an owner.')}
          <div><code className="nc-ai-set-code">{preset.url}</code></div>
        </div>
      ) : (
      <div className="nc-ai-mcp-warning">
        <Icon name="warning" size={16} />
        <div>
          <div className="nc-ai-mcp-warning-title">{t('lp.agents.not_reviewed_by_litpage', 'Not reviewed by Litpage')}</div>
          <div>{t('lp.agents.once_connected_this_agent_can_use', 'Once connected, this agent can use its tools and may share data with it. Anyone who can use the agent can trigger these tools. Only connect servers you trust.')}</div>
        </div>
      </div>
      )}
      {!preset && (
        <>
          <label className="nc-ai-field">
            <span>{t('lp.agents.name', 'Name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('lp.agents.custom_mcp_server', 'External MCP endpoint')} maxLength={60} />
          </label>
          <label className="nc-ai-field">
            <span>{t('lp.agents.mcp_server_address', 'MCP server address')}</span>
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" inputMode="url" />
          </label>
        </>
      )}
      {(!preset || preset.auth === 'token') && (
        <label className="nc-ai-field">
          <span>{preset ? t('lp.agents.your_access_token', 'Your access token') : t('lp.agents.access_token_optional', 'Access token (optional)')}</span>
          <input autoFocus={!!preset} value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('lp.agents.bearer_token_sent_as_the_authorization', 'Bearer token sent as the Authorization header')} type="password" autoComplete="off" />
        </label>
      )}
      {error && <div className="nc-ai-dialog-error" role="alert">{error}</div>}
      <div className="nc-ai-dialog-buttons">
        <button type="button" className="nc-btn outline" onClick={close}>{t('lp.agents.cancel', 'Cancel')}</button>
        <button type="submit" className="nc-btn primary" disabled={busy || (!preset && !url.trim()) || (preset?.auth === 'token' && !token.trim())}>{busy ? t('lp.agents.connecting', 'Connecting…') : t('lp.agents.connect', 'Connect')}</button>
      </div>
    </form>
  );
}

export function openMcpDialog(d: AgentDetail, preset?: McpPreset) {
  openOverlay((close) => <McpForm d={d} close={close} preset={preset} />, { placement: 'center', backdrop: 'dim' });
}
