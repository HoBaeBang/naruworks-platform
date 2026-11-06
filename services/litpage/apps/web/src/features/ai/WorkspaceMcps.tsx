
// — "Create workspace MCP" (Name, Description, Server URL, how members sign in) → "Connect MCP server"; the list "Shared with
// this workspace" with "Delete workspace preset". Members find them as "Workspace Managed" in Add connection (Custom

import { useEffect, useState } from 'react';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';
import { Badge, Button, Group, Row, confirmDialog } from '../settings/ui.tsx';
import './ai.css';

export interface McpPresetInfo {
  id: string;
  name: string;
  description: string | null;
  url: string;
  auth: 'none' | 'token';
  createdBy: string;
  createdTime: number;
}

export function WorkspaceSharedMcps({ space }: { space: SpaceRecord }) {
  const [presets, setPresets] = useState<McpPresetInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', url: '', auth: 'token' as 'none' | 'token' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ presets: McpPresetInfo[] }>('mcpListPresets', { spaceId: space.id }).then((r) => setPresets(r.presets)).catch(() => setPresets([]));
  }, [space.id]);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ presets: McpPresetInfo[] }>('mcpCreatePreset', { spaceId: space.id, ...form });
      setPresets(r.presets);
      setAdding(false);
      setForm({ name: '', description: '', url: '', auth: 'token' });
    } catch (e) {
      setError((e as Error)?.message || 'Couldn’t add this MCP server');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p: McpPresetInfo) => {
    const ok = await confirmDialog({ title: t('lp.ai.remove_workspace_preset', 'Delete workspace preset'), description: t('lp.ai.members_won_t_find_in_add', 'Members won’t find {name} in Add connection anymore. Existing connections keep working only if custom MCP servers are allowed.', { name: p.name }), confirmLabel: t('lp.ai.remove', 'Remove'), danger: true });
    if (!ok) return;
    try {
      setPresets((await api<{ presets: McpPresetInfo[] }>('mcpDeletePreset', { spaceId: space.id, presetId: p.id })).presets);
    } catch {
      useUI.getState().toast(t('lp.ai.the_workspace_mcp_preset_couldn_t', 'The workspace MCP preset couldn’t be removed'));
    }
  };
  return (
    <Group title={t('lp.ai.shared_workspace_mcps', 'Shared workspace MCPs')} description={t('lp.ai.make_mcp_servers_discoverable_so_members', 'Make MCP servers discoverable so members of the workspace can connect to them')}>
      <div className="nc-ai-set" data-testid="workspace-shared-mcps">
        {adding ? (
          <form className="nc-ai-mcp-preset-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <div className="nc-set-row-label">{t('lp.ai.new_workspace_mcp', 'Create workspace MCP')}</div>
            <label className="nc-ai-field"><span>{t('lp.ai.name', 'Name')}</span><input autoFocus value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Snowflake" /></label>
            <label className="nc-ai-field"><span>{t('lp.ai.description', 'Description')}</span><input value={form.description} maxLength={300} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('lp.ai.what_members_can_do_with_it', 'What members can do with it')} /></label>
            <label className="nc-ai-field"><span>{t('lp.ai.server_url', 'Server URL')}</span><input value={form.url} inputMode="url" onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" /></label>
            <label className="nc-ai-field">
              <span>{t('lp.ai.authentication', 'Authentication')}</span>
              <select value={form.auth} onChange={(e) => setForm({ ...form, auth: e.target.value as 'none' | 'token' })}>
                <option value="token">{t('lp.ai.each_member_signs_in_with_their', 'Each member signs in with their own access token')}</option>
                <option value="none">{t('lp.ai.no_authentication', 'No authentication')}</option>
              </select>
            </label>
            <div className="nc-ai-mcp-warning"><Icon name="info" size={16} /><div>{t('lp.ai.this_workspace_mcp_will_go_on', 'This workspace MCP will go on the approved list as soon as you create it.')}</div></div>
            {error && <div className="nc-ai-dialog-error" role="alert">{error}</div>}
            <div className="nc-ai-mcp-preset-actions">
              <Button onClick={() => { setAdding(false); setError(null); }}>{t('lp.ai.cancel', 'Cancel')}</Button>
              <Button variant="primary" disabled={busy || !form.name.trim() || !form.url.trim()} onClick={() => void add()}>{t('lp.ai.add_mcp_server', 'Connect MCP server')}</Button>
            </div>
          </form>
        ) : (
          <Row
            id="new-workspace-mcp"
            label={t('lp.ai.available_to_the_whole_workspace', 'Available to the whole workspace')}
            description={presets?.length ? t('lp.ai.count_plural_one_other', '{count, plural, one {# MCP endpoint} other {# MCP endpoints}}', { count: presets.length }) : t('lp.ai.no_mcp_servers_shared_yet', 'No MCP servers shared yet')}
            control={<Button icon="plus" onClick={() => setAdding(true)}>{t('lp.ai.new_workspace_mcp', 'Create workspace MCP')}</Button>}
          />
        )}
        {presets && presets.length > 0 && (
          <table className="nc-set-table nc-ai-usage-table">
            <thead><tr><th>{t('lp.ai.name', 'Name')}</th><th>{t('lp.ai.server_url', 'Server URL')}</th><th>{t('lp.ai.authentication', 'Authentication')}</th><th /></tr></thead>
            <tbody>
              {presets.map((p) => (
                <tr key={p.id} data-preset-id={p.id}>
                  <td>
                    <div className="nc-ai-mcp-client-name">{p.name}<Badge tone="gray">{t('lp.ai.workspace_managed', 'Workspace Managed')}</Badge></div>
                    {p.description && <div className="nc-set-row-desc">{p.description}</div>}
                    <div className="nc-set-row-desc">{(records.get('lit_user', p.createdBy) as { name?: string } | undefined)?.name ?? ''}</div>
                  </td>
                  <td><code className="nc-ai-set-code">{p.url}</code></td>
                  <td>{p.auth === 'token' ? t('lp.ai.member_token', 'Member token') : t('lp.ai.no_authentication', 'No authentication')}</td>
                  <td>
                    <span role="button" className="nc-set-icon-btn" aria-label={t('lp.ai.more_options_for', 'More actions for {name}', { name: p.name })} onClick={(e) => openMenu(e.currentTarget, {
                      width: 220,
                      sections: [{ items: [{ label: t('lp.ai.remove_workspace_preset', 'Delete workspace preset'), icon: 'trash', danger: true, onSelect: () => void setTimeout(() => void remove(p), 0) }] }],
                    }, { placement: 'bottom-end' })}>
                      <Icon name="ellipsisSmall" size={16} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Group>
  );
}
