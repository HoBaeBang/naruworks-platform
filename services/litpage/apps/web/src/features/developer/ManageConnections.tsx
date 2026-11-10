// Settings › Connections › Manage: the workspace's API connections with a ••• menu.
// View access (pages it can reach), Capabilities, Copy installation access token, Open in developer tools, Disconnect.
// Mounted by the connections settings section.
import { useEffect, useState } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { useRecord } from '../../lib/hooks.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Button, Group, UserAvatar, confirmDialog, openSubDialog } from '../settings/ui.tsx';
import { t } from '../shell/i18n.ts';
import { capabilitySummary, openDevelopers, useConnections, type Capabilities, type Connection } from './api.ts';
import { CapabilitiesEditor, ConnLogo } from './DeveloperTools.tsx';
import './developer.css';

function Owner({ id, name }: { id: string; name: string }) {
  const u = useRecord<UserRecord>('lit_user', id);
  return <span className="nc-dev-conn"><UserAvatar user={u ?? { name }} size={18} /><span className="nm" style={{ color: 'var(--lp-text-secondary)', fontSize: 12 }}>{u?.name || name}</span></span>;
}

function closeSettings() {
  useUI.getState().set({ settingsOpen: false });
}

async function viewAccess(c: Connection) {
  const r = await api<{ pages: { blockId: string; title: string; type: string; canOpen: boolean; alive: boolean }[] }>('devGetConnection', { connectionId: c.id }).catch(() => ({ pages: [] }));
  openSubDialog((close) => (
    <>
      <h3>{t('lp.developer.pages_can_access', 'Pages {name} can access', { name: c.name })}</h3>
      <div className="desc">{t('lp.developer.pages_and_databases_shared_with_this', 'Pages and databases shared with this connection, and everything inside them. Share more from a page’s ••• menu › Connections.')}</div>
      {r.pages.filter((p) => p.alive).length ? (
        <table className="nc-set-table" data-testid="connection-access">
          <tbody>{r.pages.filter((p) => p.alive).map((p) => <tr key={p.blockId}><td className="primary"><Icon name={p.type === 'page' ? 'page' : 'databaseEmbed'} size={14} style={{ display: 'inline-flex', marginRight: 6 }} />{p.title}</td></tr>)}</tbody>
        </table>
      ) : <div className="nc-set-empty">{t('lp.developer.no_pages_are_shared_with_this', 'No pages are shared with this connection yet')}</div>}
      <div className="actions"><Button onClick={close}>{t('lp.developer.close', 'Close')}</Button></div>
    </>
  ));
}

function editCapabilities(c: Connection) {
  let caps: Capabilities = { ...c.capabilities };
  openSubDialog((close) => (
    <>
      <h3>{t('lp.developer.capabilities', 'Capabilities')} · {c.name}</h3>
      <div className="desc">{t('lp.developer.when_someone_calls_this_connection_with', 'When someone calls this connection with its API token, these capabilities decide what it’s allowed to do')}</div>
      <CapsDialog initial={c.capabilities} onChange={(v) => { caps = v; }} />
      <div className="actions">
        <Button variant="primary" onClick={async () => {
          try {
            await api('devUpdateConnection', { connectionId: c.id, capabilities: caps });
            useUI.getState().toast(t('lp.developer.connection_updated', 'Connection updated'));
            close();
            void useConnections.getState().load(true);
          } catch (e) {
            useUI.getState().toast((e as Error).message);
          }
        }}>{t('lp.developer.save', 'Save')}</Button>
        <Button onClick={close}>{t('lp.developer.cancel', 'Cancel')}</Button>
      </div>
    </>
  ));
}

function CapsDialog({ initial, onChange }: { initial: Capabilities; onChange: (c: Capabilities) => void }) {
  const [v, setV] = useState(initial);
  return <CapabilitiesEditor value={v} onChange={(n) => { setV(n); onChange(n); }} />;
}

async function copyInstallToken(c: Connection) {
  try {
    const r = await api<{ token: string }>('devInstallationToken', { connectionId: c.id });
    await navigator.clipboard?.writeText(r.token).catch(() => {});
    useUI.getState().toast(t('lp.developer.copied_installation_access_token', 'Copied installation access token'));
  } catch (e) {
    useUI.getState().toast((e as Error).message);
  }
}

async function disconnect(c: Connection) {
  const ok = await confirmDialog({
    title: t('lp.developer.delete_connection', 'Delete connection?'),
    description: t('lp.developer.this_connection_will_be_deactivated_and', 'This connection will be deactivated and removed from every workspace where it was added.'),
    confirmLabel: t('lp.developer.delete_this_connection', 'Remove this connection'), danger: true,
  });
  if (!ok) return;
  try {
    await api('devDeleteConnection', { connectionId: c.id });
    useUI.getState().toast(t('lp.developer.connection_deleted', 'Connection deleted'));
    void useConnections.getState().load(true);
  } catch {
    useUI.getState().toast(t('lp.developer.couldn_t_delete_connection_try_again', 'Couldn’t delete connection. Try again.'));
  }
}

function openRowMenu(anchor: HTMLElement, c: Connection) {
  openMenu(anchor, {
    width: 260,
    sections: [
      {
        items: [
          { label: t('lp.developer.view_access', 'View access'), icon: 'eye', onSelect: () => setTimeout(() => void viewAccess(c), 0) },
          { label: t('lp.developer.capabilities', 'Capabilities'), icon: 'sliders', disabled: !c.canManage, onSelect: () => setTimeout(() => editCapabilities(c), 0) },
          { label: t('lp.developer.copy_installation_access_token', 'Copy installation access token'), icon: 'key', disabled: !c.canManage, onSelect: () => void copyInstallToken(c) },
          { label: t('lp.developer.open_in_developer_tools', 'Open in developer tools'), icon: 'curlyBraces', onSelect: () => { closeSettings(); openDevelopers('connections', c.id); } },
        ],
      },
      { items: [{ label: t('lp.developer.disconnect', 'Disconnect'), icon: 'trash', danger: true, disabled: !c.canManage, onSelect: () => setTimeout(() => void disconnect(c), 0) }] },
    ],
  }, { placement: 'bottom-end' });
}

/** "API connections" group of the Manage tab. */
export function ApiConnectionsManage() {
  const { connections, loaded } = useConnections();
  useEffect(() => { void useConnections.getState().load(true); }, []);
  return (
    <Group title={t('lp.developer.api_connections', 'API connections')} description={t('lp.developer.internal_connections_that_call_the_litpa', 'Internal connections that call the Litpage API with their own token. They reach only the pages shared with them.')}>
      {connections.length ? (
        <table className="nc-set-table" data-testid="api-connections">
          <thead><tr><th>{t('lp.developer.connection', 'Connection')}</th><th>{t('lp.developer.owner', 'Owner')}</th><th>{t('lp.developer.capabilities', 'Capabilities')}</th><th style={{ width: 70 }}>{t('lp.developer.pages', 'Pages')}</th><th style={{ width: 44 }} /></tr></thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id}>
                <td className="primary"><span className="nc-dev-conn"><ConnLogo c={c} size={20} /><span className="nm">{c.name}</span></span></td>
                <td><Owner id={c.ownerId} name={c.ownerName} /></td>
                <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={capabilitySummary(c.capabilities)}>{capabilitySummary(c.capabilities)}</td>
                <td>{c.pageCount}</td>
                <td>
                  <span role="button" className="nc-set-icon-btn" aria-label={t('lp.developer.token_actions', 'Token actions')} data-testid="api-connection-menu" onClick={(e) => openRowMenu(e.currentTarget, c)}>
                    <Icon name="ellipsis" size={16} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : loaded ? <div className="nc-set-empty">{t('lp.developer.no_connections_so_far', 'No connections so far')}</div> : null}
      <div style={{ marginTop: 8 }}>
        <Button icon="curlyBraces" onClick={() => { closeSettings(); openDevelopers('connections'); }}>{t('lp.developer.open_the_developer_tools', 'Open the developer tools')}</Button>
      </div>
    </Group>
  );
}
