

//                          approvals’, custom MCP servers, Memories, skills), Model controls, Usage, my MCP connections

//   Settings → Public pages → Shared AI chats
import { useEffect, useState, type ReactNode } from 'react';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useSession } from '../../lib/store/session.ts';
import { navigate } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { Button, Group, Row, Switch, confirmDialog } from '../settings/ui.tsx';
import { saveSpaceSettings, spaceSetting, useSpaceAccess } from '../settings/spaceSettings.ts';
import { SHARED_CHATS_EVENT, shareChat, useAiStatus } from './aiApi.ts';
import { useConnections, type McpConnection } from './aiStores.ts';
import { chatUrl } from './ChatHistory.tsx';
import { openMcpConnectDialog } from './dialogs.tsx';
import { McpClientsAdmin } from './McpClients.tsx';
import { t } from '../shell/i18n.ts';

const LOCK_TIP = 'Ask a workspace admin to change this option';

function WorkspaceSwitch({ space, admin, k, fallback, label, disabled }: { space: SpaceRecord; admin: boolean; k: string; fallback: boolean; label: string; disabled?: boolean }) {
  const on = spaceSetting<boolean>(space, k, fallback);
  return (
    <span data-tooltip={admin ? undefined : LOCK_TIP}>
      <Switch label={label} checked={on} disabled={!admin || disabled} onChange={(v) => { saveSpaceSettings(space.id, { [k]: v }); setTimeout(() => void useAiStatus.getState().refresh(), 300); }} />
    </span>
  );
}

function fmtTime(t: number | null | undefined): string {
  if (!t) return '—';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ModelControls({ space, admin }: { space: SpaceRecord; admin: boolean }) {
  const models = useAiStatus((s) => s.models);
  const allowed = spaceSetting<string[]>(space, 'ai_allowed_models', []);
  const isOn = (id: string) => !allowed.length || allowed.includes(id);
  const toggle = (id: string, v: boolean) => {
    const cur = allowed.length ? allowed : models.map((m) => m.id);
    const next = v ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    if (!next.length) {
      useUI.getState().toast('Keep at least one model enabled before turning this off.');
      return;
    }
    saveSpaceSettings(space.id, { ai_allowed_models: next.length === models.length ? [] : next });
    setTimeout(() => void useAiStatus.getState().refresh(), 300);
  };
  return (
    <Group plain title="Model controls">
      <Row
        id="ai-allowed-models"
        label="Models available to Litpage Agent"
        description="Choose which models Litpage Agent may use. Restricted models are dimmed in its model picker and chats set to Auto will respect these restrictions."
      />
      <div className="nc-ai-set-models" role="list">
        {models.map((m) => (
          <div key={m.id} className="nc-ai-set-model" role="listitem">
            <Icon name="sparkle" size={16} />
            <span className="nm">{m.name} <span className="ver">{m.version}</span></span>
            <span className="ds">{m.description}</span>
            <span data-tooltip={admin ? undefined : LOCK_TIP}><Switch label={`${m.name} ${m.version}`} checked={isOn(m.id)} disabled={!admin} onChange={(v) => toggle(m.id, v)} /></span>
          </div>
        ))}
      </div>
    </Group>
  );
}

interface UsageRow { userId: string; name: string; chats: number; messages: number; edits: number; lastUsed: number }

function Usage({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<{ members: UsageRow[]; totals: { chats: number; messages: number; edits: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api('aiUsage', { spaceId }).then(setData).catch((e) => setError((e as Error)?.message ?? 'Usage couldn’t be loaded'));
  }, [spaceId]);
  return (
    <Group plain title="Litpage AI usage in your workspace" description="Chats, messages and agent edits by member over the last 30 days.">
      {error ? <div className="nc-set-row-desc">{error}</div> : !data ? <div className="nc-set-row-desc">Loading…</div> : !data.members.length ? (
        <div className="nc-set-row-desc">Use cases appear once people in your workspace try Litpage AI.</div>
      ) : (
        <table className="nc-set-table nc-ai-usage-table">
          <thead><tr><th>Member</th><th>Chats</th><th>Messages</th><th>Agent edits</th><th>Last used</th></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId}><td>{m.name || 'Unknown'}</td><td>{m.chats}</td><td>{m.messages}</td><td>{m.edits}</td><td>{fmtTime(m.lastUsed)}</td></tr>
            ))}
            <tr className="total"><td>Total</td><td>{data.totals.chats}</td><td>{data.totals.messages}</td><td>{data.totals.edits}</td><td /></tr>
          </tbody>
        </table>
      )}
    </Group>
  );
}

function ConnectionRow({ c }: { c: McpConnection }) {
  const [open, setOpen] = useState(false);
  const update = async (patch: Record<string, unknown>) => {
    await api('aiUpdateConnection', { id: c.id, ...patch }).catch((e) => useUI.getState().toast((e as Error)?.message));
    await useConnections.getState().load(true);
  };
  return (
    <div className="nc-ai-set-conn" data-testid="ai-mcp-connection">
      <div className="nc-ai-set-conn-head">
        <Icon name="aiStepPlug" size={18} />
        <div className="main" role="button" onClick={() => setOpen(!open)}>
          <div className="nm">{c.name} <span className="nc-ai-set-badge" data-tooltip="This server has not been reviewed by Litpage">Custom MCP</span></div>
          <div className="ds">{c.url}{c.error ? ` · ${c.error}` : ` · ${c.tools.length} tools`}</div>
        </div>
        <Switch label={`Use ${c.name}`} checked={c.enabled} onChange={(v) => void update({ enabled: v })} />
        <Button small onClick={async () => { await api('aiRefreshConnection', { id: c.id }).catch(() => {}); await useConnections.getState().load(true); }}>Refresh</Button>
        <Button small variant="danger" onClick={async () => {
          if (!(await confirmDialog({ title: `Disconnect ${c.name}?`, description: 'Litpage AI will no longer be able to use this server’s tools.', confirmLabel: 'Disconnect', danger: true }))) return;
          await api('aiRemoveConnection', { id: c.id });
          await useConnections.getState().load(true);
        }}>Disconnect</Button>
      </div>
      {open && (
        <div className="nc-ai-set-tools" aria-label="Tool permissions">
          <div className="hdr">Tool permissions</div>
          {c.tools.map((t) => {
            const on = !c.disabledTools.includes(t.name);
            return (
              <div key={t.name} className="nc-ai-set-tool">
                <span className="nm">{t.name}</span>
                {t.readOnly && <span className="nc-ai-set-badge gray">Read-only</span>}
                {t.destructive && <span className="nc-ai-set-badge red">Destructive</span>}
                <span className="ds nc-ellipsis">{t.description}</span>
                <Switch label={`Allow ${t.name}`} checked={on} onChange={(v) => void update({ disabledTools: v ? c.disabledTools.filter((x) => x !== t.name) : [...c.disabledTools, t.name] })} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function McpAllowlist({ space }: { space: SpaceRecord }) {
  const list = spaceSetting<string[]>(space, 'ai_mcp_allowlist', []);
  const raw = (space.settings as Record<string, unknown> | undefined)?.ai_mcp_allowlist_enabled;
  const on = typeof raw === 'boolean' ? raw : list.length > 0;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const call = async (body: Record<string, unknown>) => {
    try {
      await api('aiUpdateMcpAllowlist', { spaceId: space.id, ...body });
      setError(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return (
    <div className="nc-ai-set-allowlist" data-testid="mcp-allowlist">
      <Row
        id="ai_mcp_allowlist"
        label="MCP server allowlist"
        description="Members can only connect custom MCP servers whose URL matches an approved URL or pattern."
        control={<Switch label="MCP server allowlist" checked={on} onChange={(v) => void call({ enabled: v })} />}
      />
      {on && !list.length && <div className="nc-set-row-desc">{t('lp.ai.members_can_t_connect_custom_mcp', 'Members can’t connect custom MCP servers until at least one is approved.')}</div>}
      {!on && list.length > 0 && <div className="nc-set-row-desc">{t('lp.ai.enable_this_toggle_to_use_the', 'Enable this toggle to use the approved custom MCP servers.')}</div>}
      {list.map((p) => (
        <div key={p} className="nc-ai-set-allow-row">
          <code className="nc-ai-set-code">{p}</code>
          <Button small variant="danger" onClick={() => void call({ remove: p })}>Remove</Button>
        </div>
      ))}
      <div className="nc-ai-set-token-new">
        <input aria-label="MCP endpoint URL or pattern" placeholder="https://mcp.your-domain.example/*" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') void call({ add: value }).then((ok) => ok && setValue('')); }} />
        <Button onClick={() => void call({ add: value }).then((ok) => ok && setValue(''))}>Add</Button>
      </div>
      {error && <div className="nc-ai-dialog-error" role="alert">{error}</div>}
    </div>
  );
}


export function AiWorkspaceControls() {
  
  // membership admins)
  const { space, owner } = useSpaceAccess();
  const conns = useConnections();
  useEffect(() => {
    void useAiStatus.getState().refresh();
    void useConnections.getState().load(true);
  }, []);
  if (!space) return null;
  const webOn = spaceSetting<boolean>(space, 'ai_web_search', true);
  const rows: { k: string; fallback: boolean; label: string; description: ReactNode; disabled?: boolean }[] = [
    { k: 'ai_enabled', fallback: true, label: 'Turn on Litpage AI', description: 'Enable AI for all members of your workspace.' },
    { k: 'ai_web_search', fallback: true, label: 'Allow web search for this workspace', description: 'Let AI search the web for current information when it answers.' },
    { k: 'ai_web_confirm', fallback: false, label: 'Ask before making web requests', description: 'The agent may open external pages when search is not enough. Require approval before viewing any web page.', disabled: !webOn },
    { k: 'ai_skip_approvals', fallback: true, label: 'Allow actions without approval', description: 'Let agents act without asking you first' },
    { k: 'ai_custom_mcp', fallback: true, label: 'Allow custom MCP servers', description: 'Allow members to connect agents to custom MCP servers that Litpage hasn’t reviewed. Connected agents can share content externally, access external data, and take external actions.' },
    { k: 'ai_memories', fallback: true, label: 'Enable Memories', description: 'Let Litpage AI create and use personal memories for workspace members.' },
    { k: 'ai_mcp_skills', fallback: true, label: 'Allow skills over MCP', description: 'Let MCP clients use Litpage skills automatically.' },
    { k: 'ai_local_skills', fallback: true, label: 'Allow skill downloads on local devices', description: 'Let members download skills for local agent use' },
  ];
  return (
    <div className="nc-ai-set" data-testid="ai-workspace-controls">
      <Group plain title="Workspace settings">
        {rows.map((r) => (
          <Row key={r.k} id={r.k} label={r.label} description={r.description} control={<WorkspaceSwitch space={space} admin={owner} k={r.k} fallback={r.fallback} label={r.label} disabled={r.disabled} />} />
        ))}
        {owner && <McpAllowlist space={space} />}
      </Group>
      <ModelControls space={space} admin={owner} />
      <Group plain title="My MCP connections" description="Remote MCP servers Litpage AI can use in your chats (+ → Connections).">
        {conns.list.map((c) => <ConnectionRow key={c.id} c={c} />)}
        <div>
          <Button icon="plusSmall" disabled={!conns.customMcp} title={conns.customMcp ? undefined : 'External MCP endpoints are off in this workspace. Ask an owner to enable them.'} onClick={() => void openMcpConnectDialog()}>Add Connections</Button>
          {owner && (
            <Button variant="danger" onClick={async () => {
              if (!(await confirmDialog({ title: 'Disconnect all custom MCP servers?', description: 'Every member’s custom MCP connections in this workspace will be removed.', confirmLabel: 'Disconnect all', danger: true }))) return;
              const r = await api<{ removed: number }>('aiDisconnectAllConnections', { spaceId: space.id });
              useUI.getState().toast(`Disconnected ${r.removed} connection(s)`);
              void useConnections.getState().load(true);
            }}>Disconnect all</Button>
          )}
        </div>
      </Group>
      {owner && <Usage spaceId={space.id} />}
    </div>
  );
}



interface TokenInfo { id: string; name: string; prefix: string; userId: string; userName?: string; createdTime: number; lastUsedTime: number | null }


export function LitMcpAccess() {
  // everyone's connections and the MCP clients list are for workspace owners (the server refuses membership admins)
  const { space, owner } = useSpaceAccess();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [all, setAll] = useState<TokenInfo[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [name, setName] = useState('');
  const load = async () => {
    if (!space) return;
    const r = await api<{ tokens: TokenInfo[] }>('mcpListTokens', { spaceId: space.id }).catch(() => ({ tokens: [] as TokenInfo[] }));
    setTokens(r.tokens);
    if (owner) {
      const a = await api<{ tokens: TokenInfo[] }>('mcpListTokens', { spaceId: space.id, all: true }).catch(() => ({ tokens: [] as TokenInfo[] }));
      setAll(a.tokens);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space?.id, owner]);
  if (!space) return null;
  const serverUrl = `${location.origin}/api/mcp`;
  const enabled = spaceSetting<boolean>(space, 'lit_mcp_enabled', true);
  const create = async () => {
    try {
      const r = await api<{ token: string }>('mcpCreateToken', { spaceId: space.id, name: name.trim() || 'MCP client' });
      setFresh(r.token);
      setName('');
      void load();
    } catch (e) {
      useUI.getState().toast((e as Error)?.message || 'Couldn’t create a token');
    }
  };
  const revoke = async (t: TokenInfo) => {
    if (!(await confirmDialog({ title: `Revoke “${t.name}”?`, description: 'Apps using this token will lose access to the workspace right away.', confirmLabel: 'Revoke', danger: true }))) return;
    await api('mcpRevokeToken', { tokenId: t.id }).catch((e) => useUI.getState().toast((e as Error)?.message));
    void load();
  };
  return (
    <div className="nc-ai-set" data-testid="lit-mcp-access">
      <Group plain title="Connect with an access token" description="Any MCP client can use this workspace through the Litpage MCP server with a personal access token. Tools act as you, with your permissions.">
        <Row label="Server URL" description={<code className="nc-ai-set-code">{serverUrl}</code>} control={<Button small onClick={() => { void navigator.clipboard?.writeText(serverUrl).catch(() => {}); useUI.getState().toast('Copied'); }}>Copy</Button>} />
        {owner && (
          <Row
            id="lit-mcp-enabled"
            label="Allow Litpage MCP for this workspace"
            description="Members can connect MCP clients to this workspace."
            control={<Switch label="Allow Litpage MCP for this workspace" checked={enabled} onChange={(v) => saveSpaceSettings(space.id, { lit_mcp_enabled: v })} />}
          />
        )}
        {fresh && (
          <div className="nc-ai-set-token-fresh" role="status">
            <div>Copy your token now — it won’t be shown again.</div>
            <code className="nc-ai-set-code" data-testid="mcp-token-value">{fresh}</code>
            <div className="nc-ai-set-snippet">{`Authorization: Bearer ${fresh.slice(0, 12)}…`}</div>
            <Button small onClick={() => { void navigator.clipboard?.writeText(fresh).catch(() => {}); useUI.getState().toast('Copied'); }}>Copy token</Button>
          </div>
        )}
        <div className="nc-ai-set-token-new">
          <input aria-label="Token name" placeholder="Token name, e.g. Claude Desktop" value={name} onChange={(e) => setName(e.target.value)} disabled={!enabled} />
          <Button variant="primary" disabled={!enabled} onClick={() => void create()}>Create token</Button>
        </div>
        {tokens.length > 0 && (
          <table className="nc-set-table nc-ai-usage-table">
            <thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td><code>{t.prefix}…</code></td><td>{fmtTime(t.createdTime)}</td><td>{fmtTime(t.lastUsedTime)}</td><td><Button small variant="danger" onClick={() => void revoke(t)}>Revoke</Button></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>
      {owner && all && (
        <Group plain title="All connections in this workspace" description="View all the MCP clients currently connected to this workspace.">
          {all.length ? (
            <table className="nc-set-table nc-ai-usage-table">
              <thead><tr><th>Member</th><th>Name</th><th>Created</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {all.map((t) => (
                  <tr key={t.id}><td>{t.userName || 'Unknown'}</td><td>{t.name}</td><td>{fmtTime(t.createdTime)}</td><td>{fmtTime(t.lastUsedTime)}</td><td><Button small variant="danger" onClick={() => void revoke(t)}>Revoke</Button></td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="nc-set-row-desc">No members have connected yet.</div>}
          <div>
            <Button variant="danger" disabled={!all.length} onClick={async () => {
              if (!(await confirmDialog({ title: 'Disconnect everyone?', description: 'Every MCP connection to this workspace will be revoked. Members can reconnect later.', confirmLabel: 'Disconnect everyone', danger: true }))) return;
              const r = await api<{ revoked: number }>('mcpRevokeAll', { spaceId: space.id });
              useUI.getState().toast(`Revoked ${r.revoked} connection(s)`);
              void load();
            }}>Disconnect everyone</Button>
          </div>
        </Group>
      )}
      {}
      {owner && <McpClientsAdmin spaceId={space.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Shared AI chats

export interface SharedChat { id: string; title: string; ownerId: string; ownerName: string; updatedTime: number }

export function useSharedChats(spaceId: string | undefined): SharedChat[] | null {
  const [list, setList] = useState<SharedChat[] | null>(null);
  useEffect(() => {
    if (!spaceId) return;
    let off = false;
    const load = () => void api<{ threads: SharedChat[] }>('aiSharedThreads', { spaceId }).then((r) => { if (!off) setList(r.threads); }).catch(() => { if (!off) setList([]); });
    load();
    // Stop sharing (here or in a chat's menu) takes the chat off the list right away
    window.addEventListener(SHARED_CHATS_EVENT, load);
    return () => {
      off = true;
      window.removeEventListener(SHARED_CHATS_EVENT, load);
    };
  }, [spaceId]);
  return list;
}


export function SharedChatsTable({ chats, onClose }: { chats: SharedChat[]; onClose?: () => void }) {
  return (
    <table className="nc-set-table nc-set-public-table" data-testid="shared-ai-chats">
      <thead><tr><th style={{ width: '40%' }}>Chat</th><th>Shared by</th><th>Updated</th><th style={{ width: 120 }} /></tr></thead>
      <tbody>
        {chats.map((c) => (
          <tr key={c.id}>
            <td><span className="nc-ai-set-chatlink" role="link" onClick={() => { onClose?.(); navigate(chatUrl(c.id)); }}><Icon name="chatBubble" size={14} /> {c.title || 'Untitled chat'}</span></td>
            <td>{c.ownerName}</td>
            <td>{fmtTime(c.updatedTime)}</td>
            <td>{c.ownerId === useSession.getState().userId && <Button small onClick={() => void shareChat(c.id, false).then(() => useUI.getState().toast('Stopped sharing'), (e) => useUI.getState().toast((e as Error)?.message || 'Couldn’t stop sharing'))}>Stop sharing</Button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
