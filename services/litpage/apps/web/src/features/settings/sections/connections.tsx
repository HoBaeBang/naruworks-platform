// Settings › Connections: a small, searchable catalog of services and the workspace connection controls.
import { useEffect, useMemo, useState } from 'react';
import type { SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { t } from '../../shell/i18n.ts';
import { Button, Group, Row, SectionPage, Switch, Upsell, UserAvatar, confirmDialog, msg, openSubDialog, rich } from '../ui.tsx';
import { planAtLeast, saveSpaceSettings, spaceSetting, useSpaceAccess } from '../spaceSettings.ts';
import { fmtDate } from './workspace.tsx';
import { useSettingsFocus } from '../searchIndex.ts';
import '../admin.css';
import { CATEGORY_OPTIONS, CONNECTION_CATEGORIES, TYPE_OPTIONS, type ConnectionCard } from '../data/connections.ts';
import { ApiConnectionsManage } from '../../developer/ManageConnections.tsx';
import { openDevelopers } from '../../developer/api.ts';
import { WorkspaceSharedMcps } from '../../ai/WorkspaceMcps.tsx';

const BRAND: Record<string, string> = {
  'Google Calendar': '#1a73e8', 'Microsoft Teams': '#5059c9', Outlook: '#0a64c8', Salesforce: '#00a1e0', Asana: '#f06a6a', Atlassian: '#0c66e4',
  Gmail: '#ea4335', Slack: '#4a154b', Discord: '#5865f2', DeepL: '#0f2b46', Zoom: '#0b5cff', iCloud: '#3693f3', Calendly: '#006bff',
  Box: '#0061d5', 'Google Drive': '#1fa463', 'SharePoint & OneDrive': '#036c70', Dropbox: '#0061fe', Coda: '#f46a54', Linear: '#5e6ad2',
  ClickUp: '#7b68ee', Trello: '#0c66e4', 'monday.com': '#ff3d57', Figma: '#a259ff', Canva: '#00c4cc', GitHub: '#1f2328', GitLab: '#fc6d26',
  PagerDuty: '#06ac38', Amplitude: '#1e61f0', Zendesk: '#03363d', Intercom: '#1f8ded', Wiz: '#1a32ff', Make: '#6d00cc', Zapier: '#ff4f00',
};
const PALETTE = ['#818cf8', '#a78bfa', '#fb923c', '#0f7b6c', '#e03e3e', '#0ea5e9', '#f472b6', '#64473a', '#34d399', '#fbbf24'];

function brandColor(name: string): string {
  if (BRAND[name]) return BRAND[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function Logo({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className="nc-set-clogo" style={{ width: size, height: size, background: brandColor(name), fontSize: size * 0.42 }} aria-hidden>
      {name === 'New MCP link' ? <Icon name="plus" size={size * 0.5} /> : name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase()}
    </span>
  );
}

const AI_CONNECTOR = new Set(['Slack', 'Google Drive', 'GitHub', 'Linear']);
const AUTOMATION = new Set(['Slack', 'Gmail', 'Zapier', 'Make']);

function typesOf(c: ConnectionCard): string[] {
  const out: string[] = [];
  if (!c.litpage) out.push('mcp_server');
  if (AI_CONNECTOR.has(c.name)) out.push('ai_connector');
  if (AUTOMATION.has(c.name)) out.push('automation_action');
  if (c.litpage) out.push('link_preview');
  return out;
}

const ALL_CARDS: ConnectionCard[] = (() => {
  const seen = new Map<string, ConnectionCard>();
  for (const c of CONNECTION_CATEGORIES) for (const card of c.cards) if (!seen.has(card.name)) seen.set(card.name, card);
  return [...seen.values()];
})();

/** "Personal MCP server" (Add connection menu / Developer connections): features/ai's Add custom MCP server dialog,
 *  when Connections › Manage › Turn on custom MCP servers is on (space.settings.ai_custom_mcp). */
function openCustomMcp(space: SpaceRecord | undefined, owner: boolean) {
  if (space && spaceSetting<boolean>(space, 'ai_custom_mcp', true) === false) {
    useUI.getState().toast(owner
      ? t('lp.settings.members_can_t_use_this_connection', 'Members can’t use this connection until custom MCP servers are switched on under Manage.')
      : t('lp.settings.custom_mcp_servers_are_off_in', 'Personal MCP servers are off in this workspace. Ask an owner to enable them.'));
    return;
  }
  void import('../../ai/dialogs.tsx').then((m) => m.openMcpConnectDialog());
}

export function ConnectionsSection() {
  const { space, owner } = useSpaceAccess();
  const focus = useSettingsFocus();
  const [tab, setTab] = useState<'browse' | 'manage'>(focus.section === 'connections' && focus.tab === 'manage' ? 'manage' : 'browse');
  useEffect(() => {
    if (focus.section === 'connections' && (focus.tab === 'manage' || focus.tab === 'browse')) setTab(focus.tab);
  }, [focus.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [type, setType] = useState<string>('all');

  const connect = (c: ConnectionCard) => {
    useUI.getState().toast(c.action === 'Request'
      ? t('lp.settings.needs_a_workspace_owner_s_approval', '{name} needs a workspace owner’s approval, and connecting it isn’t available in this build', { name: c.name })
      : t('lp.settings.connecting_needs_signing_in_to_which', 'Connecting {name} needs signing in to {name}, which isn’t available in this build', { name: c.name }));
  };

  const needle = q.trim().toLowerCase();
  const typeOk = (c: ConnectionCard) => type === 'all' || typesOf(c).includes(type);
  const results = useMemo(
    () => (needle ? ALL_CARDS.filter((c) => (c.name.toLowerCase().includes(needle) || c.desc.toLowerCase().includes(needle)) && typeOk(c)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needle, type],
  );

  const catLabel = cat === 'all' ? t('lp.settings.all_categories', 'All categories') : CATEGORY_OPTIONS.find((c) => c.key === cat)?.title ?? cat;
  const typeLabel = type === 'all' ? t('lp.settings.all_types', 'All types') : TYPE_OPTIONS.find((c) => c.key === type)?.title ?? type;

  const filterMenu = (anchor: HTMLElement, items: { key: string; title: string; count?: number }[], cur: string, onPick: (k: string) => void) => {
    anchor.classList.add('open');
    openMenu(anchor, {
      width: 260,
      maxHeight: 420,
      sections: [{
        items: items.map((it) => ({
          label: it.title,
          checked: it.key === cur,
          right: it.count !== undefined ? <span className="nc-set-menu-count">{it.count}</span> : undefined,
          onSelect: () => onPick(it.key),
        })),
      }],
    }, { placement: 'bottom-start', onClose: () => anchor.classList.remove('open') });
  };

  const card = (c: ConnectionCard, key: string) => (
    <div
      key={key}
      role="button"
      tabIndex={0}
      className="nc-set-ccard"
      aria-label={`${c.action === 'Request' ? t('lp.settings.request', 'Request') : t('lp.settings.connect', 'Connect')} ${c.name}`}
      onClick={() => connect(c)}
      onKeyDown={(e) => { if (e.key === 'Enter') connect(c); }}
    >
      <span className="logo-box"><Logo name={c.name} size={40} /></span>
      <div className="main">
        <div className="nm-row">
          <div className="nm" title={c.name}>{c.name}</div>
          {c.litpage && (
            <span className="built" data-tooltip={t('lp.settings.built_and_maintained_by_litpage', 'Built and maintained by Litpage')}>
              <Icon name="badgeCheck" size={12} />
              <span>{t('lp.settings.made_by_litpage', 'Built by Litpage')}</span>
            </span>
          )}
        </div>
        <div className="ds" title={c.desc}>{c.desc}</div>
      </div>
      <span className="act" aria-hidden>{c.action === 'Request' ? t('lp.settings.request', 'Request') : t('lp.settings.connect', 'Connect')}</span>
    </div>
  );

  const categories = CONNECTION_CATEGORIES.filter((c) => cat === 'all' || c.key === cat);

  return (
    <SectionPage
      title={t('lp.settings.connections', 'Connections')}
      subtitle={
        <span className="nc-set-balanced">
          {t('lp.settings.connect_services_to_use_in_litpage', 'Connect services to use in Litpage. Search, sync, and automate work across the tools your team already uses.')}
        </span>
      }
    >
      <div className="nc-set-connections">
        <div className="nc-set-pills" role="tablist">
          <div role="tab" tabIndex={0} aria-selected={tab === 'browse'} className={`nc-set-pill big${tab === 'browse' ? ' selected' : ''}`} onClick={() => setTab('browse')}>{t('lp.settings.browse_connections', 'Browse Connections')}</div>
          {owner && <div role="tab" tabIndex={0} aria-selected={tab === 'manage'} className={`nc-set-pill big${tab === 'manage' ? ' selected' : ''}`} onClick={() => setTab('manage')}>{t('lp.settings.manage', 'Manage')}</div>}
        </div>
        {tab === 'manage' && space && owner ? <ManageConnections space={space} /> : (<>
        <div className="nc-set-conn-toolbar">
          <div className="nc-set-input nc-set-conn-search">
            <Icon name="magnifyingGlassSmall" size={16} />
            <input aria-label={t('lp.settings.search_connections', 'Search connections')} placeholder={t('lp.settings.search_connections', 'Search connections')} value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <span role="button" className="nc-set-icon-btn" aria-label="Clear" onClick={() => setQ('')}><Icon name="xMarkSmall" size={14} /></span>}
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-label={`${t('lp.settings.filter_categories', 'Filter categories')}: ${catLabel}`}
            className="nc-set-btn nc-set-dropdown nc-set-conn-filter"
            onClick={(e) => filterMenu(e.currentTarget, [{ key: 'all', title: t('lp.settings.all_categories', 'All categories') }, ...CATEGORY_OPTIONS], cat, setCat)}
          >
            <span>{catLabel}</span><span className="chev"><Icon name="arrowChevronSingleDownSmall" size={16} /></span>
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-label={`${t('lp.settings.filter_connection_types', 'Filter connection types')}: ${typeLabel}`}
            className="nc-set-btn nc-set-dropdown nc-set-conn-filter"
            onClick={(e) => filterMenu(e.currentTarget, [{ key: 'all', title: t('lp.settings.all_types', 'All types') }, ...TYPE_OPTIONS], type, setType)}
          >
            <span>{typeLabel}</span><span className="chev"><Icon name="arrowChevronSingleDownSmall" size={16} /></span>
          </div>
          <Button
            variant="primary"
            icon="plus"
            onClick={(e) => openMenu(e.currentTarget, {
              width: 260,
              sections: [{
                items: [
                  { label: t('lp.settings.browse_all_connections', 'Browse all connections'), icon: 'squareGrid2X2', onSelect: () => { setQ(''); setCat('all'); setType('all'); } },
                  { label: t('lp.settings.custom_mcp_server', 'Personal MCP server'), icon: 'integration', description: t('lp.settings.add_a_custom_mcp_server_connection', 'Add a custom MCP server connection'), onSelect: () => openCustomMcp(space, owner) },
                  { label: t('lp.settings.develop_integrations', 'Develop integrations'), icon: 'curlyBraces', onSelect: () => { useUI.getState().set({ settingsOpen: false }); openDevelopers('connections'); } },
                ],
              }],
            }, { placement: 'bottom-end' })}
          >
            {t('lp.settings.add_connection', 'Add connection')}
            <Icon name="arrowChevronSingleDownSmall" size={14} />
          </Button>
        </div>

        {needle ? (
          <section className="nc-set-conn-cat">
            <h2 className="nc-set-cat-title">{t('lp.settings.results', 'Results')}</h2>
            {results.length ? <div className="nc-set-cgrid">{results.map((c) => card(c, c.name))}</div> : <div className="nc-set-empty">{t('lp.settings.no_connections_match', 'No connections match “{query}”', { query: q.trim() })}</div>}
          </section>
        ) : (
          categories.map((c) => {
            const cards = c.cards.filter(typeOk);
            if (!cards.length) return null;
            const title = c.title;
            return (
              <section key={c.key} className="nc-set-conn-cat" aria-label={title}>
                <h2 className="nc-set-cat-title">{title}</h2>
                <div className="nc-set-cgrid">{cards.map((x) => card(x, `${c.key}:${x.name}`))}</div>
                {c.key === 'featured' && (
                  <div className="nc-set-cmore-row">
                    <div className="nc-set-mcp-hint">
                      <span>{t('lp.settings.use_litpage_with_your_ai_tools', 'Use Litpage with your AI tools through a custom MCP connection:')}</span>
                      <span role="button" tabIndex={0} className="nc-set-link strong" onClick={() => useUI.getState().set({ settingsSection: 'lit-mcp' })}>
                        {t('lp.settings.litpage_mcp', 'Litpage MCP')}
                        <Icon name="arrowStraightRightSmall" size={14} />
                      </span>
                    </div>
                  </div>
                )}
              </section>
            );
          })
        )}
        </>)}
      </div>
    </SectionPage>
  );
}

// ---------------------------------------------------------------------------------------------- Manage (owners)

interface AdminConnection { id: string; userId: string; name: string; host: string; enabled: boolean; createdTime: number }
interface AdminToken { id: string; name: string; prefix: string; userId: string; createdTime: number; lastUsedTime: number | null }

function personName(id: string): string {
  const u = records.get<UserRecord>('lit_user', id);
  return u?.name || u?.email || '—';
}

/** Settings › Connections › Manage (workspace owners): every member's connections and personal access
 *  tokens (review / remove), and the connection permissions — webhook actions in automations (Enterprise, server-enforced
 *  by the automation engine through space.settings.disallow_webhook_automation_action) and custom MCP servers. */
function ManageConnections({ space }: { space: SpaceRecord }) {
  const [conns, setConns] = useState<AdminConnection[] | null>(null);
  const [tokens, setTokens] = useState<AdminToken[] | null>(null);
  const load = () => {
    api<{ connections: AdminConnection[]; recordMap: any }>('getWorkspaceConnections', { spaceId: space.id })
      .then((r) => { records.mergeRecordMap(r.recordMap); setConns(r.connections); })
      .catch(() => setConns([]));
    api<{ tokens: AdminToken[] }>('mcpListTokens', { spaceId: space.id, all: true }).then((r) => setTokens(r.tokens)).catch(() => setTokens([]));
  };
  useEffect(load, [space.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = space.plan_type ?? 'plus';
  const enterprise = planAtLeast(plan, 'enterprise');
  const webhooksOn = spaceSetting<boolean>(space, 'disallow_webhook_automation_action', false) !== true;
  const customMcp = spaceSetting<boolean>(space, 'ai_custom_mcp', true) !== false;

  const openConnections = () => openSubDialog((close) => (
    <>
      <h3>{t('lp.settings.all_connections', 'All connections')}</h3>
      <div className="desc">{t('lp.settings.apps_that_workspace_members_have_connect', 'Apps that workspace members have connected')}</div>
      {conns?.length ? (
        <table className="nc-set-table" data-testid="all-connections">
          <thead><tr><th>{t('lp.settings.connection', 'Connection')}</th><th>{t('lp.settings.owner', 'Owner')}</th><th>{t('lp.settings.created_accf', 'Created')}</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {conns.map((c) => (
              <tr key={c.id}>
                <td className="primary">{c.name}{c.host ? <span className="mono"> · {c.host}</span> : null}</td>
                <td><span className="nc-set-person-inline"><UserAvatar user={records.get<UserRecord>('lit_user', c.userId)} size={20} />{personName(c.userId)}</span></td>
                <td>{fmtDate(c.createdTime)}</td>
                <td>
                  <Button small variant="ghost" onClick={async () => {
                    const ok = await confirmDialog({ title: t('lp.settings.remove_0ca7', 'Remove {clientName}?', { clientName: c.name }), confirmLabel: t('lp.settings.remove', 'Remove'), danger: true });
                    if (!ok) return;
                    try {
                      await api('removeWorkspaceConnection', { spaceId: space.id, connectionId: c.id });
                      setConns((list) => (list ?? []).filter((x) => x.id !== c.id));
                      close();
                    } catch (e) {
                      useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
                    }
                  }}>{t('lp.settings.remove', 'Remove')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="nc-set-empty">{t('lp.settings.no_connections_so_far', 'No connections so far')}</div>}
      <div className="actions"><Button onClick={close}>{t('lp.settings.close', 'Close')}</Button></div>
    </>
  ));

  const openTokens = () => openSubDialog((close) => (
    <>
      <h3>{t('lp.settings.every_personal_access_token', 'Every personal access token')}</h3>
      <div className="desc">{t('lp.settings.workspace_members_access_tokens', 'Workspace members’ access tokens')}</div>
      {tokens?.length ? (
        <table className="nc-set-table" data-testid="all-tokens">
          <thead><tr><th>{t('lp.settings.name', 'Name')}</th><th>{t('lp.settings.owner', 'Owner')}</th><th>{t('lp.settings.created_accf', 'Created')}</th><th>{t('lp.settings.last_used_f110', 'Last used')}</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {tokens.map((tk) => (
              <tr key={tk.id}>
                <td className="primary">{tk.name} <span className="mono">{tk.prefix}…</span></td>
                <td>{personName(tk.userId)}</td>
                <td>{fmtDate(tk.createdTime)}</td>
                <td>{tk.lastUsedTime ? fmtDate(tk.lastUsedTime) : t('lp.settings.text_1b93', '—')}</td>
                <td>
                  <Button small variant="ghost" onClick={async () => {
                    try {
                      await api('mcpRevokeToken', { tokenId: tk.id });
                      setTokens((list) => (list ?? []).filter((x) => x.id !== tk.id));
                      useUI.getState().toast(t('lp.settings.token_revoked', 'Token revoked'));
                      close();
                    } catch (e) {
                      useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
                    }
                  }}>{t('lp.settings.revoke', 'Revoke')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="nc-set-empty">{t('lp.settings.you_haven_t_made_any_tokens', 'You haven’t made any tokens yet')}</div>}
      <div className="actions"><Button onClick={close}>{t('lp.settings.close', 'Close')}</Button></div>
    </>
  ));

  return (
    <div className="nc-set-conn-manage">
      <Group title={t('lp.settings.oversee_connected_apps_and_tokens', 'Oversee connected apps and tokens')}>
        <Row
          id="all-connections"
          label={t('lp.settings.all_connections', 'All connections')}
          description={t('lp.settings.apps_that_workspace_members_have_connect', 'Apps that workspace members have connected')}
          control={(
            <span className="nc-set-btn-row">
              <span className="nc-set-count">{t('lp.settings.connections_ca9b', '{count} connections', { count: conns?.length ?? 0 })}</span>
              <Button onClick={openConnections}>{t('lp.settings.view_manage', 'View & manage')}</Button>
            </span>
          )}
        />
        <Row
          id="all-personal-access-tokens"
          label={t('lp.settings.every_personal_access_token', 'Every personal access token')}
          description={t('lp.settings.workspace_members_access_tokens', 'Workspace members’ access tokens')}
          control={(
            <span className="nc-set-btn-row">
              <span className="nc-set-count">{t('lp.settings.count_plural_one_other_a7a0', '{count, plural, one {# enabled access token} other {# enabled access tokens}}', { count: tokens?.length ?? 0 })}</span>
              <Button onClick={openTokens}>{t('lp.settings.view_manage', 'View & manage')}</Button>
            </span>
          )}
        />
      </Group>
      {/* the workspace's API connections with their ••• menu */}
      <ApiConnectionsManage />
      {/* Workspace shared MCPs */}
      <WorkspaceSharedMcps space={space} />
      <Group title={t('lp.settings.manage_permissions', 'Manage permissions')}>
        <Row
          id="allow-webhook-actions"
          label={t('lp.settings.allow_automations_to_run_webhook_actions', 'Allow automations to run webhook actions')}
          description={(
            <>
              {rich(msg('lp.settings.decide_who_can_use_the_send', 'Decide who can use the <bold>Send webhook</bold> action in buttons and automations'), {}, { bold: (c) => <b>{c}</b> })}
              {!enterprise && <Upsell text={msg('lp.settings.upgrade_to_block_database_automations_an', '<highlight>Upgrade</highlight> to block database automations and buttons from sending webhooks to third-party tools')} onClick={() => useUI.getState().set({ settingsSection: 'plans' })} />}
            </>
          )}
          control={<Switch label="Permit webhooks in automations" checked={webhooksOn} disabled={!enterprise} onChange={(v) => saveSpaceSettings(space.id, { disallow_webhook_automation_action: !v })} />}
        />
        <Row
          id="custom-mcp-servers"
          label={t('lp.settings.turn_on_custom_mcp_servers', 'Turn on custom MCP servers')}
          description={t('lp.settings.members_can_link_agents_to_custom', 'Members can link agents to custom MCP servers not reviewed by Litpage. Through those servers, agents can send content outside, pull in external data, and act in other systems.')}
          control={<Switch label="Turn on custom MCP servers" checked={customMcp} onChange={(v) => saveSpaceSettings(space.id, { ai_custom_mcp: v })} />}
        />
      </Group>
    </div>
  );
}
