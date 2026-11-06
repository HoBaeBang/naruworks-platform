
// The connection dialog supports an OAuth flow in a web browser and an External MCP endpoint.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api.ts';
import { useSession } from '../../lib/store/session.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useConnections, type McpConnection } from './aiStores.ts';

export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

export function choiceDialog<T>(opts: { title: string; description?: ReactNode; buttons: DialogButton<T>[]; width?: number }): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    openOverlay((close) => (
      <div className="nc-ai-dialog" role="alertdialog" aria-label={opts.title} style={{ width: opts.width ?? 380 }}>
        <div className="nc-ai-dialog-title">{opts.title}</div>
        {opts.description && <div className="nc-ai-dialog-desc">{opts.description}</div>}
        <div className="nc-ai-dialog-buttons">
          {opts.buttons.map((b) => (
            <button
              key={String(b.label)}
              type="button"
              className={`nc-btn ${b.primary ? 'primary' : b.danger ? 'danger-fill' : 'outline'}`}
              onClick={() => {
                finish(b.value);
                close();
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    ), { placement: 'center', backdrop: 'dim', onClose: () => finish(null) });
  });
}

interface WorkspaceMcp { id: string; name: string; description: string | null; url: string; auth: 'none' | 'token' }

function McpConnectForm({ close, onDone }: { close: () => void; onDone: (c: McpConnection) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [presets, setPresets] = useState<WorkspaceMcp[]>([]);
  const [preset, setPreset] = useState<WorkspaceMcp | null>(null);
  useEffect(() => {
    void api<{ presets: WorkspaceMcp[] }>('mcpListPresets', { spaceId: useSession.getState().spaceId }).then((r) => setPresets(r.presets)).catch(() => setPresets([]));
  }, []);
  const customMcpSetting = useConnections((s) => s.customMcp);
  const customMcp = customMcpSetting || !!preset;
  const submit = async () => {
    if (busy || (!url.trim() && !preset)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ connection: McpConnection }>('aiAddConnection', preset ? { spaceId: useSession.getState().spaceId, presetId: preset.id, token } : { spaceId: useSession.getState().spaceId, name, url, token });
      await useConnections.getState().load(true);
      onDone(r.connection);
      close();
    } catch (e) {
      setError((e as Error)?.message || 'Failed to connect');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="nc-ai-dialog nc-ai-mcp-dialog"
      role="dialog"
      aria-label="External MCP endpoint"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="nc-ai-dialog-title">{preset ? preset.name : 'External MCP endpoint'}</div>
      {presets.length > 0 && (
        <div className="nc-ai-mcp-presets" role="listbox" aria-label="Workspace Managed">
          {presets.map((p) => (
            <div key={p.id} role="option" aria-selected={preset?.id === p.id} className={`nc-ai-mcp-preset ${preset?.id === p.id ? 'on' : ''}`} onClick={() => { setPreset(preset?.id === p.id ? null : p); setName(p.name); setUrl(p.url); }}>
              <Icon name="puzzle" size={16} />
              <span className="nc-ellipsis">{p.name}</span>
              <span className="badge">Workspace Managed</span>
            </div>
          ))}
        </div>
      )}
      {preset ? (
        <>
          <div className="nc-ai-dialog-desc">{preset.description || 'Shared with this workspace by an owner.'}</div>
          {preset.auth === 'token' && (
            <label className="nc-ai-field">
              <span>Your access token</span>
              <input autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token sent as the Authorization header" type="password" autoComplete="off" />
            </label>
          )}
          {error && <div className="nc-ai-dialog-error" role="alert">{error}</div>}
        </>
      ) : !customMcp ? (
        <div className="nc-ai-dialog-desc">External MCP endpoints are off in this workspace. Ask an owner to enable them.</div>
      ) : (
        <>
          <div className="nc-ai-mcp-warning">
            <Icon name="warning" size={16} />
            <div>
              <div className="nc-ai-mcp-warning-title">Litpage has not reviewed this endpoint</div>
              <div>After connection, it can read or change agent content and send data outside Litpage. Connect only trusted endpoints.</div>
            </div>
          </div>
          <label className="nc-ai-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="External MCP endpoint" maxLength={60} />
          </label>
          <label className="nc-ai-field">
            <span>MCP endpoint URL</span>
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" inputMode="url" />
          </label>
          <label className="nc-ai-field">
            <span>Access token (optional)</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token sent as the Authorization header" type="password" autoComplete="off" />
          </label>
          {error && <div className="nc-ai-dialog-error" role="alert">{error}</div>}
        </>
      )}
      <div className="nc-ai-dialog-buttons">
        <button type="button" className="nc-btn outline" onClick={close}>Cancel</button>
        {customMcp && <button type="submit" className="nc-btn primary" disabled={busy || (!preset && !url.trim()) || (preset?.auth === 'token' && !token.trim())}>{busy ? 'Connecting…' : 'Connect'}</button>}
      </div>
    </form>
  );
}


export function openMcpConnectDialog(): Promise<McpConnection | null> {
  return new Promise((resolve) => {
    let result: McpConnection | null = null;
    openOverlay((close) => <McpConnectForm close={close} onDone={(c) => { result = c; }} />, { placement: 'center', backdrop: 'dim', onClose: () => resolve(result) });
  });
}
