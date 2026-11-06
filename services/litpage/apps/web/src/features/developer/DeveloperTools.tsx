// In-app developer tools at /<domain>/developers, linked from the sidebar Developer
// section and Settings › Developer › "Open developer tools".
// Tabs: Connections (workspace API connections with capabilities, tokens, pages, webhooks, and health) and Access tokens.
// Text keys use the developerPortal namespace.
import { useEffect, useMemo, useState } from 'react';
import type { SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openPage } from '../../lib/router.ts';
import { useRecord } from '../../lib/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Button, UserAvatar, confirmDialog, openSubDialog } from '../settings/ui.tsx';
import { t } from '../shell/i18n.ts';
import {
  EVENT_LABELS, capabilitySummary, createConnection, developersUrl, openDevelopers, useConnections, type Capabilities, type Connection, type ConnectionDetailData,
  type Webhook,
} from './api.ts';
import { pickPage } from './pagePicker.tsx';
import '../settings/settings.css';
import './developer.css';

const fmtDate = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function relative(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return t('lp.developer.just_now', 'Just now');
  return fmtDate(ms);
}

export function ConnLogo({ c, size = 24 }: { c: Pick<Connection, 'icon' | 'name'>; size?: number }) {
  const icon = c.icon;
  return (
    <span className="logo" style={{ width: size, height: size }}>
      {icon && /^(https?:|\/files\/)/.test(icon) ? <img src={icon} alt="" style={{ width: size, height: size, borderRadius: 6 }} /> : icon ? icon : <Icon name="curlyBraces" size={Math.round(size * 0.6)} />}
    </span>
  );
}

function OwnerCell({ id, name }: { id: string; name: string }) {
  const u = useRecord<UserRecord>('lit_user', id);
  return <span className="nc-dev-conn"><UserAvatar user={u ?? { name }} size={20} /><span className="nm" style={{ color: 'var(--lp-text-secondary)' }}>{u?.name || name || '—'}</span></span>;
}

// ---------------------------------------------------------------- dialogs

function revealToken(token: string, title: string) {
  openSubDialog((close) => <Reveal token={token} title={title} close={close} />);
}

function Reveal({ token, title, close }: { token: string; title: string; close: () => void }) {
  return (
    <div className="nc-dev-reveal" data-testid="token-reveal">
      <h3>{title}</h3>
      <div className="desc">{t('lp.developer.this_token_appears_only_once_copy', 'This token appears only once. Copy it before you close this dialog')}</div>
      <div className="nc-dev-token"><span className="grow" data-testid="revealed-token">{token}</span></div>
      <div className="actions">
        <Button variant="primary" onClick={() => { void navigator.clipboard?.writeText(token).catch(() => {}); useUI.getState().toast(t('lp.developer.copied', 'Copied')); close(); }}>
          {t('lp.developer.copy_then_close', 'Copy, then close')}
        </Button>
      </div>
    </div>
  );
}

export function openNewConnectionDialog(onCreated?: (c: Connection) => void) {
  openSubDialog((close) => <NewConnection close={close} onCreated={onCreated} />);
}

function NewConnection({ close, onCreated }: { close: () => void; onCreated?: (c: Connection) => void }) {
  const me = useRecord<UserRecord>('lit_user', useSession.getState().userId);
  const space = useRecord<SpaceRecord>('space', useSession.getState().spaceId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const placeholder = t('lp.developer.s_connection', '{name}’s connection', { name: me?.name || 'My' });
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await createConnection(name.trim() || placeholder);
      close();
      onCreated?.(r.connection);
      revealToken(r.token, t('lp.developer.integration_token', 'Integration token'));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <h3>{t('lp.developer.new_connection', 'New connection')}</h3>
      <div className="desc">{t('lp.developer.set_up_a_connection_so_apps', 'Set up a connection so apps, agents, and workflows can authenticate with Litpage. Scope it to one workspace or several.')}</div>
      <div className="nc-dev-field">
        <label>{t('lp.developer.connection_name', 'Connection name')}</label>
        <input className="nc-dev-input" autoFocus aria-label={t('lp.developer.connection_name', 'Connection name')} value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }} />
      </div>
      <div className="nc-dev-field">
        <label>{t('lp.developer.authentication_method', 'Authentication method')}</label>
        <div className="nc-dev-caps">
          <label className="nc-dev-cap"><input type="radio" checked readOnly /><span><div className="t">{t('lp.developer.api_token', 'API token')}</div><div className="c">{t('lp.developer.a_static_api_token_scoped_to', 'A static API token scoped to one workspace and shared with collaborators, with separate access settings. Limited to 1 workspace and not eligible for the Marketplace.')}</div></span></label>
          <label className="nc-dev-cap disabled" data-tooltip={t('lp.developer.oauth_connections_need_a_public_app', 'OAuth connections need a public app listing, which this workspace doesn’t offer.')}><input type="radio" disabled /><span><div className="t">{t('lp.developer.oauth', 'OAuth')}</div><div className="c">{t('lp.developer.oauth_2_0_scoped_to_each', 'OAuth 2.0 scoped to each user, so access never goes beyond what the signed-in user has. Works across several workspaces and qualifies for the Marketplace.')}</div></span></label>
        </div>
      </div>
      <div className="nc-dev-field">
        <label>{t('lp.developer.installable_in', 'Installable in')}</label>
        <div className="nc-dev-token" style={{ fontFamily: 'inherit' }}><span className="grow">{space?.name ?? ''}</span></div>
      </div>
      {err && <div className="nc-set-error" role="alert" style={{ color: 'var(--lp-red-text-accent)', fontSize: 13 }}>{err}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>{t('lp.developer.create_connection', 'Create connection')}</Button>
        <Button onClick={close}>{t('lp.developer.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- connections tab

function ConnectionsTab() {
  const { connections, loaded, canCreate, createProblem } = useConnections();
  const [q, setQ] = useState('');
  const spaceName = useRecord<SpaceRecord>('space', useSession((s) => s.spaceId))?.name ?? '';
  useEffect(() => { void useConnections.getState().load(true); }, []);
  const list = useMemo(() => connections.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())), [connections, q]);
  return (
    <>
      <div className="nc-dev-toolbar">
        <div className="nc-dev-search">
          <Icon name="search" size={14} />
          <input aria-label={t('lp.developer.search_connections', 'Search connections…')} placeholder={t('lp.developer.search_connections', 'Search connections…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="grow" />
        <span data-tooltip={canCreate ? undefined : createProblem ?? undefined}>
          <Button variant="primary" icon="plus" disabled={!canCreate} onClick={() => openNewConnectionDialog((c) => openDevelopers('connections', c.id))}>
            {t('lp.developer.new_connection', 'New connection')}
          </Button>
        </span>
      </div>
      <table className="nc-dev-table" data-testid="connections-table">
        <thead>
          <tr>
            <th style={{ width: '34%' }}>{t('lp.developer.connection', 'Connection')}</th>
            <th>{t('lp.developer.auth_type', 'Auth type')}</th>
            <th>{t('lp.developer.installable_in', 'Installable in')}</th>
            <th>{t('lp.developer.owner', 'Owner')}</th>
            <th style={{ width: 110 }}>{t('lp.developer.created', 'Created')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => openDevelopers('connections', c.id)}>
              <td className="primary"><span className="nc-dev-conn"><ConnLogo c={c} /><span className="nm">{c.name}</span></span></td>
              <td>{t('lp.developer.api_token', 'API token')}</td>
              <td>{spaceName}</td>
              <td><OwnerCell id={c.ownerId} name={c.ownerName} /></td>
              <td>{relative(c.createdTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {loaded && !list.length && <div className="nc-dev-empty">{q.trim() ? t('lp.developer.your_filters_don_t_match_any', 'Your filters don’t match any connections') : t('lp.developer.no_connections_so_far', 'No connections so far')}</div>}
    </>
  );
}

// ---------------------------------------------------------------- access tokens tab

interface PatInfo { id: string; name: string; prefix: string; createdTime: number; lastUsedTime: number | null }

function TokensTab() {
  const spaceId = useSession((s) => s.spaceId);
  const [tokens, setTokens] = useState<PatInfo[] | null>(null);
  const load = () => void api<{ tokens: PatInfo[] }>('mcpListTokens', { spaceId }).then((r) => setTokens(r.tokens)).catch(() => setTokens([]));
  useEffect(load, [spaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = () => openSubDialog((close) => <NewPat close={close} onDone={load} />);
  return (
    <>
      <div className="nc-dev-toolbar">
        <div className="desc" style={{ fontSize: 13, color: 'var(--lp-text-secondary)' }}>{t('lp.developer.create_a_personal_access_token_for', 'Create a personal access token for Litpage API requests. <manageTokens>Manage your tokens</manageTokens>.').replace(/<[^>]+>[^<]*<\/[^>]+>\.?/, '').trim()}</div>
        <span className="grow" />
        <Button variant="primary" icon="plus" onClick={create}>{t('lp.developer.new_token', 'New token')}</Button>
      </div>
      <table className="nc-dev-table">
        <thead><tr><th>{t('lp.developer.name', 'Name')}</th><th>{t('lp.developer.capabilities', 'Capabilities')}</th><th>{t('lp.developer.created', 'Created')}</th><th>{t('lp.developer.last_used', 'Last used')}</th><th>{t('lp.developer.status', 'Status')}</th><th style={{ width: 90 }} /></tr></thead>
        <tbody>
          {(tokens ?? []).map((p) => (
            <tr key={p.id}>
              <td className="primary">{p.name || t('lp.developer.untitled_token', 'Untitled token')} <span className="nc-dev-mono">{p.prefix}…</span></td>
              <td>{t('lp.developer.litpage_api', 'Litpage API')}</td>
              <td>{fmtDate(p.createdTime)}</td>
              <td>{p.lastUsedTime ? fmtDate(p.lastUsedTime) : t('lp.developer.text', '—')}</td>
              <td>{t('lp.developer.active', 'Active')}</td>
              <td>
                <Button small variant="ghost" onClick={async () => {
                  await api('mcpRevokeToken', { tokenId: p.id });
                  useUI.getState().toast(t('lp.developer.token_revoked', 'Token revoked'));
                  load();
                }}>{t('lp.developer.revoke', 'Revoke')}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tokens && !tokens.length && <div className="nc-dev-empty">{t('lp.developer.you_haven_t_made_any_tokens', 'You haven’t made any tokens yet')}</div>}
    </>
  );
}

function NewPat({ close, onDone }: { close: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!name.trim()) {
      setErr(t('lp.developer.add_a_name_first', 'Add a name first'));
      return;
    }
    try {
      const r = await api<{ token: string }>('mcpCreateToken', { spaceId: useSession.getState().spaceId, name: name.trim() });
      close();
      onDone();
      revealToken(r.token, t('lp.developer.personal_access_token_created_copy_it', 'Personal access token created: copy it now'));
    } catch (e) {
      setErr((e as { status?: number }).status === 403 ? t('lp.developer.creating_tokens_is_turned_off_a', 'Creating tokens is turned off. A workspace owner can turn it on for you.') : (e as Error).message || t('lp.developer.couldn_t_create_token', 'Couldn’t create token'));
    }
  };
  return (
    <>
      <h3>{t('lp.developer.new_personal_access_token', 'New personal access token')}</h3>
      <div className="desc">{t('lp.developer.generate_a_token_scoped_to_this', 'Generate a token scoped to this workspace')}</div>
      <div className="nc-dev-field">
        <label>{t('lp.developer.token_name', 'Token name')}</label>
        <input className="nc-dev-input" autoFocus value={name} placeholder={t('lp.developer.what_is_this_token_for', 'What is this token for?')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </div>
      {err && <div style={{ color: 'var(--lp-red-text-accent)', fontSize: 13 }}>{err}</div>}
      <div className="actions">
        <Button variant="primary" onClick={() => void submit()}>{t('lp.developer.create_token', 'Create token')}</Button>
        <Button onClick={close}>{t('lp.developer.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- connection detail

type DetailTab = 'configuration' | 'content' | 'webhooks' | 'health';

function eventLabel(e: string): string {
  const key = e.replace(/^(\w+)\.(\w+)$/, (_m, a: string, b: string) => `${a}${b.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`).replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
  return t(`creatorProfile.integrations.webhookSubscriptionDetail.eventTypeLabels.${key}`, EVENT_LABELS[e] ?? e);
}

const CAP_ROWS: { key: keyof Capabilities; title: [string, string]; caption: [string, string] }[] = [
  { key: 'read_content', title: ['developerPortal.internalConfig.readContentTitle', 'Read content'], caption: ['developerPortal.internalConfig.readContentCaption', 'Browse pages and database records'] },
  { key: 'update_content', title: ['developerPortal.internalConfig.updateContentTitle', 'Update content'], caption: ['developerPortal.internalConfig.updateContentCaption', 'Modify pages and database records'] },
  { key: 'insert_content', title: ['developerPortal.internalConfig.insertContentTitle', 'Insert content'], caption: ['developerPortal.internalConfig.insertContentCaption', 'Add pages and database records'] },
];
const COMMENT_ROWS: typeof CAP_ROWS = [
  { key: 'read_comments', title: ['developerPortal.internalConfig.readCommentTitle', 'Read comments'], caption: ['developerPortal.internalConfig.readCommentCaption', 'Read comments on pages and blocks'] },
  { key: 'insert_comments', title: ['developerPortal.internalConfig.insertCommentTitle', 'Insert comments'], caption: ['developerPortal.internalConfig.insertCommentCaption', 'Post comments on pages and blocks'] },
];

export function CapabilitiesEditor({ value, onChange, disabled }: { value: Capabilities; onChange: (c: Capabilities) => void; disabled?: boolean }) {
  const box = (r: (typeof CAP_ROWS)[number]) => (
    <label key={r.key} className={`nc-dev-cap ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" aria-label={t(...r.title)} disabled={disabled} checked={!!value[r.key]} onChange={(e) => onChange({ ...value, [r.key]: e.target.checked })} />
      <span><div className="t">{t(...r.title)}</div><div className="c">{t(...r.caption)}</div></span>
    </label>
  );
  const radio = (v: Capabilities['user_info'], title: [string, string], caption: [string, string]) => (
    <label key={v} className={`nc-dev-cap ${disabled ? 'disabled' : ''}`}>
      <input type="radio" name="nc-dev-userinfo" aria-label={t(...title)} disabled={disabled} checked={value.user_info === v} onChange={() => onChange({ ...value, user_info: v })} />
      <span><div className="t">{t(...title)}</div><div className="c">{t(...caption)}</div></span>
    </label>
  );
  return (
    <div className="nc-dev-caps" data-testid="capabilities">
      <div className="nc-dev-subhead">{t('lp.developer.content_capabilities', 'Content capabilities')}</div>
      {CAP_ROWS.map(box)}
      <div className="nc-dev-subhead">{t('lp.developer.comment_capabilities', 'Comment capabilities')}</div>
      {COMMENT_ROWS.map(box)}
      <div className="nc-dev-subhead">{t('lp.developer.user_capabilities', 'User capabilities')}</div>
      {radio('none', ['developerPortal.internalConfig.noUserInformationTitle', 'No profile details'], ['developerPortal.internalConfig.noUserInformationCaption', 'Profile access is off'])}
      {radio('no_email', ['developerPortal.internalConfig.readUserWithoutEmailTitle', 'Read profiles without email'], ['developerPortal.internalConfig.readUserWithoutEmailCaption', 'View basic profiles, without email'])}
      {radio('with_email', ['developerPortal.internalConfig.readUserWithEmailTitle', 'Read profiles with email'], ['developerPortal.internalConfig.readUserWithEmailCaption', 'View profiles, including email'])}
    </div>
  );
}

function ConnectionDetail({ id }: { id: string }) {
  const [data, setData] = useState<ConnectionDetailData | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<DetailTab>('configuration');
  const [name, setName] = useState('');
  const load = () => void api<ConnectionDetailData & { recordMap: any }>('devGetConnection', { connectionId: id })
    .then((r) => { records.mergeRecordMap(r.recordMap); setData(r); setName(r.connection.name); })
    .catch(() => setMissing(true));
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (missing) {
    return <div className="nc-dev-empty"><b>{t('lp.developer.connection_could_not_be_found', 'Connection could not be found')}</b><br />{t('lp.developer.this_connection_wasn_t_found_someone', 'This connection wasn’t found. Someone might have deleted it, or you don’t have access to it.')}</div>;
  }
  if (!data) return null;
  const c = data.connection;
  const save = async (patch: { name?: string; capabilities?: Capabilities }) => {
    if (patch.capabilities && !Object.entries(patch.capabilities).some(([k, v]) => (k === 'user_info' ? v !== 'none' : v === true))) {
      useUI.getState().toast(t('lp.developer.choose_at_least_one_capability_before', 'Choose at least one capability before saving'));
      return;
    }
    try {
      await api('devUpdateConnection', { connectionId: c.id, ...patch });
      useUI.getState().toast(t('lp.developer.connection_updated', 'Connection updated'));
      load();
      void useConnections.getState().load(true);
    } catch (e) {
      useUI.getState().toast((e as Error).message || t('lp.developer.couldn_t_save_this_connection', 'Couldn’t save this connection'));
    }
  };
  const tabs: [DetailTab, string][] = [
    ['configuration', t('lp.developer.configuration', 'Configuration')],
    ['content', t('lp.developer.content_access', 'Content access')],
    ...(c.canManage ? [['webhooks', t('lp.developer.webhooks', 'Webhooks')], ['health', t('lp.developer.health', 'Health')]] as [DetailTab, string][] : []),
  ];
  return (
    <>
      <div className="nc-dev-crumbs">
        <span role="button" onClick={() => openDevelopers()}>{t('lp.developer.developer_tools', 'Developer tools')}</span><span className="sep">/</span>
        <span role="button" onClick={() => openDevelopers('connections')}>{t('lp.developer.connections', 'Connections')}</span><span className="sep">/</span>
        <span>{c.name}</span>
      </div>
      <h1 className="nc-dev-h1"><span className="nc-dev-conn"><ConnLogo c={c} size={36} /></span>{c.name}</h1>
      <div className="nc-dev-tabs" role="tablist">
        {tabs.map(([k, label]) => <div key={k} role="tab" aria-selected={tab === k} className={`nc-dev-tab ${tab === k ? 'selected' : ''}`} onClick={() => setTab(k)}>{label}</div>)}
      </div>
      {tab === 'configuration' && (
        <>
          <div className="nc-dev-section">
            <h2>{t('lp.developer.display_information', 'Display information')}</h2>
            <div className="nc-dev-field">
              <label>{t('lp.developer.connection_name', 'Connection name')}</label>
              <div className="nc-dev-row">
                <input className="nc-dev-input" aria-label={t('lp.developer.connection_name', 'Connection name')} value={name} disabled={!c.canManage} onChange={(e) => setName(e.target.value)} />
                {c.canManage && <Button disabled={!name.trim() || name.trim() === c.name} onClick={() => void save({ name: name.trim() })}>{t('lp.developer.save', 'Save')}</Button>}
              </div>
            </div>
          </div>
          <div className="nc-dev-section">
            <h2>{t('lp.developer.integration_token', 'Integration token')}</h2>
            <div className="desc">{t('lp.developer.api_requests_to_this_workspace_are', 'API requests to this workspace are authenticated with this token. Don’t share it: whoever holds it can act as the connection. <docslink>Read about internal connections.</docslink>').replace(/<docslink>.*<\/docslink>/, '').trim()}</div>
            <div className="nc-dev-token" data-testid="token-prefix">
              <span className="grow">{c.canManage ? `${c.tokenPrefix}${'•'.repeat(24)}` : '•'.repeat(34)}</span>
              {c.canManage && (
                <Button small onClick={async () => {
                  const ok = await confirmDialog({ title: t('lp.developer.refresh_api_token', 'Rotate API token'), description: t('lp.developer.the_current_token_stops_working_right', 'The current token stops working right away. Apps using it need the new token.'), confirmLabel: t('lp.developer.refresh', 'Refresh'), danger: true });
                  if (!ok) return;
                  const r = await api<{ token: string }>('devRefreshConnectionToken', { connectionId: c.id });
                  load();
                  revealToken(r.token, t('lp.developer.integration_token', 'Integration token'));
                }}>
                  <Icon name="refresh" size={14} />{t('lp.developer.refresh', 'Refresh')}
                </Button>
              )}
            </div>
            <div className="desc" style={{ marginTop: 6 }}>{t('lp.developer.last_refreshed', 'Last refreshed {refreshedDate}', { refreshedDate: fmtDate(c.tokenRefreshedTime) })}</div>
          </div>
          {c.canManage && (
            <div className="nc-dev-section">
              <h2>{t('lp.developer.make_your_first_request', 'Make your first request')}</h2>
              <div className="desc">{t('lp.developer.share_a_page_with_this_connection', 'Share a page with this connection (page ••• › Connections), then call the API with its token. Replace the token placeholder with the secret you copied.')}</div>
              <pre className="nc-dev-code" data-testid="api-example">{`curl ${location.origin}/v1/search \\\n  -H "Authorization: Bearer ${c.tokenPrefix}…" \\\n  -H "Litpage-Version: 2026-10-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{"page_size": 10}'`}</pre>
            </div>
          )}
          <div className="nc-dev-section">
            <h2>{t('lp.developer.capabilities', 'Capabilities')}</h2>
            <div className="desc">{t('lp.developer.when_someone_calls_this_connection_with', 'When someone calls this connection with its API token, these capabilities decide what it’s allowed to do')}</div>
            <CapabilitiesEditor value={c.capabilities} disabled={!c.canManage} onChange={(caps) => void save({ capabilities: caps })} />
          </div>
          {c.canManage && (
            <div className="nc-dev-section">
              <h2>{t('lp.developer.danger_zone', 'Danger zone')}</h2>
              <div className="nc-dev-danger">
                <div className="grow">{t('lp.developer.once_deleted_the_connection_is_removed', 'Once deleted, the connection is removed from this workspace and its API token stops working for good')}</div>
                <Button variant="danger" onClick={async () => {
                  const ok = await confirmDialog({ title: t('lp.developer.delete_connection', 'Delete connection?'), description: t('lp.developer.this_connection_will_be_deactivated_and', 'This connection will be deactivated and removed from every workspace where it was added.'), confirmLabel: t('lp.developer.delete_this_connection', 'Remove this connection'), danger: true });
                  if (!ok) return;
                  try {
                    await api('devDeleteConnection', { connectionId: c.id });
                    useUI.getState().toast(t('lp.developer.connection_deleted', 'Connection deleted'));
                    void useConnections.getState().load(true);
                    openDevelopers('connections');
                  } catch {
                    useUI.getState().toast(t('lp.developer.couldn_t_delete_connection_try_again', 'Couldn’t delete connection. Try again.'));
                  }
                }}>{t('lp.developer.delete', 'Delete')}</Button>
              </div>
            </div>
          )}
        </>
      )}
      {tab === 'content' && <ContentAccess data={data} reload={load} />}
      {tab === 'webhooks' && <WebhooksTab data={data} reload={load} />}
      {tab === 'health' && <HealthTab data={data} />}
    </>
  );
}

function ContentAccess({ data, reload }: { data: ConnectionDetailData; reload: () => void }) {
  const c = data.connection;
  return (
    <div className="nc-dev-section">
      <div className="nc-dev-toolbar">
        <div className="desc" style={{ margin: 0 }}>{t('lp.developer.pages_and_databases_shared_with_this', 'Pages and databases shared with this connection, and everything inside them. Share more from a page’s ••• menu › Connections.')}</div>
        <span className="grow" />
        <Button icon="plus" onClick={(e) => pickPage(e.currentTarget as HTMLElement, async (pageId) => {
          try {
            await api('devAddPageConnection', { pageId, connectionId: c.id });
            reload();
          } catch (err) {
            useUI.getState().toast((err as Error).message);
          }
        })}>{t('lp.developer.add_pages', 'Add pages')}</Button>
      </div>
      <table className="nc-dev-table" data-testid="content-access">
        <tbody>
          {data.pages.filter((p) => p.alive).map((p) => (
            <tr key={p.blockId}>
              <td className="primary"><span className="nc-dev-conn"><Icon name={p.type === 'page' ? 'page' : 'databaseEmbed'} size={16} /><span className="nm">{p.title}</span></span></td>
              <td style={{ width: 200, textAlign: 'end' }}>
                {p.canOpen && <Button small variant="ghost" onClick={() => openPage(p.blockId)}>{t('lp.developer.open', 'Open')}</Button>}
                <Button small variant="ghost" onClick={async () => {
                  try {
                    await api('devRemovePageConnection', { pageId: p.blockId, connectionId: c.id });
                    reload();
                  } catch (err) {
                    useUI.getState().toast((err as Error).message);
                  }
                }}>{t('lp.developer.remove', 'Remove')}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.pages.some((p) => p.alive) && <div className="nc-dev-empty">{t('lp.developer.no_pages_are_shared_with_this', 'No pages are shared with this connection yet')}</div>}
    </div>
  );
}

function HealthTab({ data }: { data: ConnectionDetailData }) {
  const s = data.stats ?? { ok: 0, clientErrors: 0, rateLimited: 0 };
  return (
    <div className="nc-dev-section">
      {s.rateLimited >= 10 && (
        <div className="nc-dev-callout warn"><Icon name="warning" size={16} /><div><b>{t('lp.developer.many_requests_are_hitting_the_api', 'Many requests are hitting the API rate limit')}</b><div className="sub">{t('lp.developer.the_connection_was_already_rate_limited', 'The connection was already rate limited when most of these requests went out. Hold off on new requests until the Retry-After time passes.')}</div></div></div>
      )}
      {s.clientErrors >= 20 && (
        <div className="nc-dev-callout warn"><Icon name="warning" size={16} /><div><b>{t('lp.developer.many_api_calls_are_returning_errors', 'Many API calls are returning errors')}</b></div></div>
      )}
      <div className="nc-dev-stats">
        <div className="nc-dev-stat"><div className="n">{s.ok}</div><div className="l">{t('lp.developer.successful_requests_24_h', 'Successful requests (24 h)')}</div></div>
        <div className="nc-dev-stat"><div className="n">{s.clientErrors}</div><div className="l">{t('lp.developer.client_errors_24_h', 'Client errors (24 h)')}</div></div>
        <div className="nc-dev-stat"><div className="n">{s.rateLimited}</div><div className="l">{t('lp.developer.rate_limited_requests_24_h', 'Rate-limited requests (24 h)')}</div></div>
      </div>
    </div>
  );
}

function statusLabel(w: Webhook): { cls: string; text: string } {
  switch (w.status) {
    case 'active': return { cls: 'active', text: t('lp.developer.this_subscription_is_up_and_running', 'This subscription is up and running') };
    case 'paused': return { cls: 'paused', text: t('lp.developer.this_subscription_is_on_hold_for', 'This subscription is on hold for now') };
    case 'paused_errors': return { cls: 'paused', text: t('lp.developer.deliveries_to_this_webhook_are_paused', 'Deliveries to this webhook are paused') };
    default: return { cls: 'pending', text: t('lp.developer.webhook_events_won_t_arrive_until', 'Webhook events won’t arrive until your endpoint is verified') };
  }
}

function WebhooksTab({ data, reload }: { data: ConnectionDetailData; reload: () => void }) {
  const c = data.connection;
  if (!data.webhooksEnabled) {
    return <div className="nc-dev-callout"><Icon name="info" size={16} /><div>{t('lp.developer.connection_webhooks_are_turned_off_on', 'Connection webhooks are turned off on this server. Start it with NC_CONNECTION_WEBHOOKS=1 to use them.')}</div></div>;
  }
  if (!data.webhooks.length) {
    return (
      <div className="nc-dev-empty">
        <b>{t('lp.developer.no_webhook_subscription', 'No webhook is configured')}</b>
        <div style={{ margin: '6px 0 12px' }}>{t('lp.developer.when_something_important_changes_receive', 'When something important changes, receive updates instantly and trigger automated workflows. <learnMoreLink>Learn more</learnMoreLink>').replace(/<learnMoreLink>.*<\/learnMoreLink>/, '').trim()}</div>
        <Button variant="primary" onClick={() => openSubDialog((close) => <WebhookForm connectionId={c.id} events={data.events} close={close} onDone={reload} />)}>
          {t('lp.developer.create_a_subscription', 'Create a subscription')}
        </Button>
      </div>
    );
  }
  return (
    <>
      {data.webhooks.map((w) => {
        const st = statusLabel(w);
        return (
          <div key={w.id} className="nc-dev-section" data-testid="webhook">
            {w.status === 'pending_verification' && (
              <div className="nc-dev-callout warn"><Icon name="warning" size={16} /><div><b>{t('lp.developer.webhook_events_won_t_arrive_until', 'Webhook events won’t arrive until your endpoint is verified')}</b><div className="sub">{t('lp.developer.verify_your_endpoint_before_receiving_ev', 'Verify your endpoint before receiving events. This confirms a secure connection between Litpage and your application.')}</div></div></div>
            )}
            {w.status === 'paused_errors' && (
              <div className="nc-dev-callout warn"><Icon name="warning" size={16} /><div><b>{t('lp.developer.deliveries_to_this_webhook_are_paused', 'Deliveries to this webhook are paused')}</b><div className="sub">{t('lp.developer.this_webhook_subscription_is_paused_beca', 'This webhook subscription is paused because of a high error rate. Fix the issue and resume it to restart event delivery.')}</div></div></div>
            )}
            <div className="nc-dev-field"><label>{t('lp.developer.webhook_url', 'Webhook URL')}</label><div className="nc-dev-token"><span className="grow">{w.url}</span></div></div>
            <div className="nc-dev-row" style={{ marginBottom: 10 }}>
              <span className={`nc-dev-status ${st.cls}`} data-testid="webhook-status"><span className="dot" />{st.text}</span>
              <span className="grow" style={{ flex: 1 }} />
              {w.status === 'pending_verification' && <Button variant="primary" onClick={() => openSubDialog((close) => <VerifyForm w={w} close={close} onDone={reload} />)}>{t('lp.developer.verify', 'Verify')}</Button>}
              {w.status === 'active' && <Button onClick={async () => {
                const ok = await confirmDialog({ title: t('lp.developer.pause_this_subscription_for_now', 'Pause this subscription for now?'), description: t('lp.developer.your_webhook_url_won_t_receive', 'Your webhook URL won’t receive events until you resume the subscription.'), confirmLabel: t('lp.developer.pause_subscription', 'Pause subscription') });
                if (ok) { await api('devUpdateWebhook', { webhookId: w.id, status: 'paused' }); reload(); }
              }}>{t('lp.developer.pause', 'Pause')}</Button>}
              {(w.status === 'paused' || w.status === 'paused_errors') && <Button onClick={async () => {
                const ok = await confirmDialog({ title: t('lp.developer.turn_this_subscription_back_on', 'Turn this subscription back on?'), description: t('lp.developer.litpage_will_begin_sending_events_to', 'Litpage will begin sending events to your webhook URL, so make sure it can reply with a successful HTTP response.'), confirmLabel: t('lp.developer.resume', 'Resume') });
                if (ok) { await api('devUpdateWebhook', { webhookId: w.id, status: 'active' }); reload(); }
              }}>{t('lp.developer.resume', 'Resume')}</Button>}
              <Button onClick={() => openSubDialog((close) => <WebhookForm connectionId={c.id} events={data.events} existing={w} close={close} onDone={reload} />)}>{t('lp.developer.edit_subscription', 'Edit subscription')}</Button>
              <Button variant="danger" onClick={async () => {
                const ok = await confirmDialog({ title: t('lp.developer.delete_this_subscription_for_good', 'Delete this subscription for good?'), description: t('lp.developer.deleting_removes_this_subscription_and_s', 'Deleting removes this subscription and stops all events to your webhook URL. To get events again later, set up a new subscription.'), confirmLabel: t('lp.developer.delete_subscription', 'Delete subscription'), danger: true });
                if (ok) { await api('devDeleteWebhook', { webhookId: w.id }); reload(); }
              }}>{t('lp.developer.delete', 'Delete')}</Button>
            </div>
            <div className="nc-dev-field">
              <label>{t('lp.developer.subscribed_events', 'Subscribed events')} · {t('lp.developer.events', '{numEnabledEvents}/{numTotalEvents} events', { numEnabledEvents: w.eventTypes.length, numTotalEvents: data.events.length })}</label>
              <div className="desc" style={{ fontSize: 12, color: 'var(--lp-text-secondary)' }}>{w.eventTypes.map(eventLabel).join(' · ')}</div>
            </div>
            <div className="nc-dev-row" style={{ fontSize: 12, color: 'var(--lp-text-secondary)', gap: 14 }}>
              <span>{t('lp.developer.success_count', 'Success count')}: <b data-testid="webhook-successes">{w.successes}</b></span>
              <span>{t('lp.developer.failure_count', 'Failure count')}: <b>{w.failures}</b></span>
              {w.failures > 0 && <span role="button" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => openSubDialog((close) => <Failures w={w} close={close} />)}>{t('lp.developer.see_failed_events', 'See failed events')}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}

function WebhookForm({ connectionId, events, existing, close, onDone }: { connectionId: string; events: string[]; existing?: Webhook; close: () => void; onDone: () => void }) {
  const [url, setUrl] = useState(existing?.url ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set(existing?.eventTypes ?? events));
  const [version, setVersion] = useState(existing?.apiVersion ?? '2026-10-01');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (e: string) => setPicked((s) => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n; });
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      if (existing) await api('devUpdateWebhook', { webhookId: existing.id, url, eventTypes: [...picked] });
      else await api('devCreateWebhook', { connectionId, url, eventTypes: [...picked], apiVersion: version });
      close();
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <h3>{existing ? t('lp.developer.edit_subscription', 'Edit subscription') : t('lp.developer.create_a_subscription', 'Create a subscription')}</h3>
      <div className="nc-dev-field">
        <label>{t('lp.developer.webhook_url', 'Webhook URL')}</label>
        <input className="nc-dev-input" autoFocus aria-label={t('lp.developer.webhook_url', 'Webhook URL')} value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
        <div style={{ fontSize: 12, color: 'var(--lp-text-secondary)' }}>{t('lp.developer.webhook_events_are_sent_to_this', 'Webhook events are sent to this address.')}</div>
      </div>
      {!existing && (
        <div className="nc-dev-field">
          <label>{t('lp.developer.api_version', 'API version')}</label>
          <select className="nc-dev-input" value={version} onChange={(e) => setVersion(e.target.value)}><option value="2026-10-01">2026-10-01</option></select>
        </div>
      )}
      <div className="nc-dev-field">
        <label>{t('lp.developer.subscribed_events', 'Subscribed events')}</label>
        <div className="nc-dev-events">
          {events.map((e) => (
            <label key={e} data-tooltip={t('lp.developer.event_type', 'Event type: {eventType}', { eventType: e })}><input type="checkbox" checked={picked.has(e)} onChange={() => toggle(e)} />{eventLabel(e)}</label>
          ))}
        </div>
      </div>
      {err && <div style={{ color: 'var(--lp-red-text-accent)', fontSize: 13 }} role="alert">{err}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy || !url.trim() || !picked.size} onClick={() => void submit()}>{existing ? t('lp.developer.save', 'Save') : t('lp.developer.create_a_subscription', 'Create a subscription')}</Button>
        <Button onClick={close}>{t('lp.developer.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

function VerifyForm({ w, close, onDone }: { w: Webhook; close: () => void; onDone: () => void }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  return (
    <>
      <h3>{t('lp.developer.verify_subscription', 'Verify subscription')}</h3>
      <div className="desc">{t('lp.developer.check_your_webhook_url_for_the', 'Check your webhook URL for the verification token we just sent.')} {t('lp.developer.your_subscription_goes_live_once_you', 'Your subscription goes live once you enter it below.')}</div>
      <div className="nc-dev-field"><label>{t('lp.developer.webhook_url', 'Webhook URL')}</label><div className="nc-dev-token"><span className="grow">{w.url}</span></div></div>
      <div className="nc-dev-field">
        <label>{t('lp.developer.verification_token', 'Verification token')}</label>
        <input className="nc-dev-input" autoFocus aria-label={t('lp.developer.verification_token', 'Verification token')} value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      {err && <div style={{ color: 'var(--lp-red-text-accent)', fontSize: 13 }} role="alert">{err}</div>}
      <div className="actions">
        <Button variant="primary" onClick={async () => {
          try {
            await api('devVerifyWebhook', { webhookId: w.id, token: token.trim() });
            close();
            onDone();
          } catch {
            setErr(t('lp.developer.the_verification_token_is_invalid', 'The verification token is invalid.'));
          }
        }}>{t('lp.developer.verify_subscription', 'Verify subscription')}</Button>
        <Button onClick={async () => {
          const r = await api<{ ok: boolean; status: number }>('devResendWebhookToken', { webhookId: w.id }).catch(() => ({ ok: false, status: 0 }));
          useUI.getState().toast(r.ok
            ? t('lp.developer.the_verification_token_is_on_its', 'The verification token is on its way to the URL')
            : t('lp.developer.couldn_t_send_verification_token_status', 'Couldn’t send verification token, status {httpCode}', { httpCode: r.status }));
        }}>{t('lp.developer.resend_token', 'Resend token')}</Button>
        <Button onClick={close}>{t('lp.developer.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

function Failures({ w, close }: { w: Webhook; close: () => void }) {
  const [list, setList] = useState<{ id: string; eventType: string; entityId: string | null; status: number | null; error: string | null; time: number }[] | null>(null);
  useEffect(() => { void api<{ failures: NonNullable<typeof list> }>('devWebhookFailures', { webhookId: w.id }).then((r) => setList(r.failures)).catch(() => setList([])); }, [w.id]);
  return (
    <>
      <h3>{t('lp.developer.see_failed_events', 'See failed events')}</h3>
      <div className="desc">{t('lp.developer.debug_your_webhook_url_by_checking', 'Debug your webhook URL by checking which deliveries failed and why.')}</div>
      <table className="nc-dev-table">
        <tbody>
          {(list ?? []).map((f) => (
            <tr key={f.id}><td className="primary">{eventLabel(f.eventType)}</td><td>{f.status ? `HTTP ${f.status}` : f.error}</td><td>{new Date(f.time).toLocaleString('en-US')}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="actions"><Button onClick={close}>{t('lp.developer.close', 'Close')}</Button></div>
    </>
  );
}

// ---------------------------------------------------------------- page

export function DeveloperTools({ tab, id }: { tab?: string; id?: string }) {
  const current = tab === 'personal-access-tokens' ? 'tokens' : 'connections';
  return (
    <div className="nc-dev-page" data-testid="developer-tools">
      <div className="nc-dev-scroll">
        <div className="nc-dev-inner">
          {id && current === 'connections' ? (
            <ConnectionDetail key={id} id={id} />
          ) : (
            <>
              <div className="nc-dev-crumbs"><span>{t('lp.developer.developer_tools', 'Developer tools')}</span></div>
              <h1 className="nc-dev-h1"><span className="ico"><Icon name="curlyBraces" size={20} /></span>{t('lp.developer.developer_tools', 'Developer tools')}</h1>
              <div className="nc-dev-tabs" role="tablist" aria-label={t('lp.developer.developer_portal_sections', 'Developer navigation tabs')}>
                <div role="tab" aria-selected={current === 'connections'} className={`nc-dev-tab ${current === 'connections' ? 'selected' : ''}`} onClick={() => openDevelopers('connections')}>{t('lp.developer.connections', 'Connections')}</div>
                <div role="tab" aria-selected={current === 'tokens'} className={`nc-dev-tab ${current === 'tokens' ? 'selected' : ''}`} onClick={() => openDevelopers('personal-access-tokens')}>{t('lp.developer.personal_access_tokens', 'Access tokens')}</div>
              </div>
              {current === 'connections' ? <ConnectionsTab /> : <TokensTab />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { developersUrl, capabilitySummary };
