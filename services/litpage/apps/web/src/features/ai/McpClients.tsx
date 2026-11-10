

// client connected to the workspace — status, members, last use, Rename (custom / unknown clients), View members
// (disconnect one member), Disconnect all members, Disconnect MCP client. The server enforces the list on every call.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';
import { Badge, Button, Dropdown, Group, Row, confirmDialog, openSubDialog } from '../settings/ui.tsx';
import '../agents/agents.css';

interface ClientRow {
  key: string;
  name: string;
  reportedName: string | null;
  caption: string | null;
  known: boolean;
  renamed: boolean;
  approved: boolean;
  approvedByName: string | null;
  approvedTime: number | null;
  members: number;
  tokens: number;
  firstConnected: number | null;
  lastUsed: number | null;
  blocked: boolean;
}
interface ClientsAnswer { restricted: boolean; clients: ClientRow[]; catalog?: { key: string; name: string; caption: string }[] }

const day = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : t('lp.ai.never', 'Never'));
const toast = (e: unknown) => useUI.getState().toast((e as Error)?.message || t('lp.ai.something_went_wrong_while_processing_th', 'Something went wrong while loading while processing that request.'));

export function McpClientsAdmin({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<ClientsAnswer | null>(null);
  const load = () => void api<ClientsAnswer>('mcpListClients', { spaceId }).then(setData).catch(toast);
  useEffect(load, [spaceId]);
  if (!data) return null;
  const setRestricted = async (restricted: boolean) => {
    if (restricted) {
      const cutoff = Date.now() - 30 * 86_400_000;
      const affected = data.clients.filter((c) => !c.approved && (c.lastUsed ?? 0) > cutoff).reduce((n, c) => n + c.members, 0);
      const ok = await confirmDialog({
        title: t('lp.ai.limit_members_to_mcp_clients_you', 'Limit members to MCP clients you’ve approved?'),
        description: affected
          ? t('lp.ai.membercount_plural_one_other_connected_u', '{memberCount, plural, one {# member} other {# members}} connected unapproved MCP clients in the past 30 days. Turning this on cuts those clients off immediately.', { memberCount: affected })
          : t('lp.ai.unapproved_mcp_clients_stop_working_imme', 'Unapproved MCP clients stop working immediately.'),
        confirmLabel: t('lp.ai.switch', 'Switch'),
      });
      if (!ok) return;
    }
    try {
      setData({ ...data, ...(await api<ClientsAnswer>('mcpSetClientRestriction', { spaceId, restricted })) });
    } catch (e) {
      toast(e);
    }
  };
  const approved = data.clients.filter((c) => c.approved);
  return (
    <Group plain title={t('lp.ai.mcp_clients', 'MCP clients')} description={t('lp.ai.litpage_s_mcp_server_gives_external', 'Litpage’s MCP server gives external MCP clients a secure way into your workspace. Once connected, members can use those clients to search, view, and work with their Litpage.')}>
      <div data-testid="mcp-clients-admin">
        <Row
          id="mcp-client-restriction"
          label={t('lp.ai.mcp_clients_members_can_connect', 'MCP clients members can connect')}
          description={data.restricted ? t('lp.ai.a_workspace_owner_must_approve_an', 'A workspace owner must approve an MCP client before members can connect it') : t('lp.ai.workspace_owners_are_never_blocked_from', 'Workspace owners are never blocked from connecting or approving new MCP clients')}
          control={(
            <Dropdown<'all' | 'approved'>
              label={t('lp.ai.mcp_clients_members_can_connect', 'MCP clients members can connect')}
              value={data.restricted ? 'approved' : 'all'}
              width={280}
              onChange={(v) => void setRestricted(v === 'approved')}
              options={[
                { value: 'all', label: t('lp.ai.all_mcp_clients', 'Every MCP client') },
                { value: 'approved', label: t('lp.ai.approved_mcp_clients_only', 'Allowed MCP clients only'), description: t('lp.ai.a_workspace_owner_must_approve_an', 'A workspace owner must approve an MCP client before members can connect it') },
              ]}
            />
          )}
        />
        <Row
          id="mcp-approved-clients"
          label={t('lp.ai.approved_mcp_client_list', 'Approved MCP client list')}
          description={data.restricted ? t('lp.ai.set_the_mcp_clients_available_to', 'Set the MCP clients available to members') : t('lp.ai.inactive_for_now_until_you_switch', 'Inactive for now. Until you switch on Allowed MCP clients only, members are free to use any MCP client.')}
          control={<Button onClick={() => openApproved(spaceId, data, setData)}>{t('lp.ai.manage_approved_clients', 'Manage approved clients')} · {approved.length}</Button>}
        />
        <div className="nc-set-row-label" style={{ marginTop: 12 }}>{t('lp.ai.all_mcp_clients', 'Every MCP client')}</div>
        <div className="nc-set-row-desc">{t('lp.ai.mcp_clients_with_an_active_connection', 'MCP clients with an active connection or approval in this workspace')}</div>
        {data.clients.length ? (
          <table className="nc-set-table nc-ai-usage-table" data-testid="mcp-clients-table">
            <thead>
              <tr>
                <th>{t('lp.ai.name', 'Name')}</th>
                <th>{t('lp.ai.access', 'Access')}</th>
                <th>{t('lp.ai.members', 'Members')}</th>
                <th>{t('lp.ai.last_used', 'Last used')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.key} data-client-key={c.key}>
                  <td>
                    <span className="nc-ai-mcp-client-name">
                      <span className="nc-ai-mcp-client-logo" aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>
                      <span>{c.name}</span>
                      {c.renamed && <span data-tooltip={t('lp.ai.an_admin_approved_this_app_for', 'An admin approved this app for the workspace and chose its name and icon.')}><Badge tone="gray">{t('lp.ai.custom', 'Custom')}</Badge></span>}
                      {!c.known && !c.renamed && <span data-tooltip={t('lp.ai.the_sign_in_redirect_doesn_t', 'The sign-in redirect doesn’t tell Litpage which MCP client this is. The client reports its own name, which hasn’t been verified.')}><Badge tone="gray">{t('lp.ai.unknown', 'Unknown')}</Badge></span>}
                      {data.restricted && !c.approved && <span data-tooltip={t('lp.ai.while_approved_mcp_clients_only_is', 'While Allowed MCP clients only is turned on, this client won’t work unless it’s on the approved list.')}><Badge tone="yellow">{t('lp.ai.not_approved', 'Not approved')}</Badge></span>}
                    </span>
                  </td>
                  <td>{c.blocked ? t('lp.ai.blocked', 'Blocked') : c.tokens ? t('lp.ai.connected', 'Connected') : t('lp.ai.not_connected', 'Not connected')}</td>
                  <td>{t('lp.ai.count_plural_one_other_f62c', '{count, plural, one {# person} other {# people}}', { count: c.members })}</td>
                  <td>{c.lastUsed ? day(c.lastUsed) : '—'}</td>
                  <td>
                    <span role="button" className="nc-set-icon-btn" aria-label={t('lp.ai.more_options_for', 'More actions for {name}', { name: c.name })} onClick={(e) => clientMenu(e.currentTarget, spaceId, c, load)}>
                      <Icon name="ellipsisSmall" size={16} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="nc-set-empty">{t('lp.ai.no_mcp_clients', 'No connected MCP clients')}</div>}
      </div>
    </Group>
  );
}

function clientMenu(anchor: HTMLElement, spaceId: string, c: ClientRow, reload: () => void) {
  openMenu(anchor, {
    width: 240,
    sections: [
      {
        items: [
          { label: t('lp.ai.view_members', 'View members'), icon: 'users', disabled: !c.members, onSelect: () => void setTimeout(() => openMembers(spaceId, c, reload), 0) },
          {
            label: t('lp.ai.rename', 'Rename'),
            icon: 'pencil',
            onSelect: () => void setTimeout(() => openSubDialog((close) => <RenameClient spaceId={spaceId} c={c} close={() => { close(); reload(); }} />), 0),
          },
          ...(c.members
            ? [{
              label: t('lp.ai.disconnect_every_member', 'Disconnect every member'),
              icon: 'close',
              danger: true,
              onSelect: () => void setTimeout(async () => {
                const ok = await confirmDialog({
                  title: t('lp.ai.remove_s_access_to_litpage_mcp', 'Remove {clientName}’s access to Litpage MCP?', { clientName: c.name }),
                  description: t('lp.ai.all_tokens_held_by_members_will', 'All {clientName} tokens held by members will be revoked, and {clientName} won’t be able to make tool calls. Each member must reconnect by hand.', { clientName: c.name }),
                  confirmLabel: t('lp.ai.disconnect', 'Disconnect'),
                  danger: true,
                });
                if (!ok) return;
                await api('mcpDisconnectClient', { spaceId, key: c.key }).catch(toast);
                reload();
              }, 0),
            }]
            : []),
          ...(c.approved
            ? [{ label: t('lp.ai.remove_mcp_client', 'Disconnect MCP client'), icon: 'trash', danger: true, onSelect: () => void api('mcpRemoveApprovedClient', { spaceId, key: c.key }).then(reload).catch(toast) }]
            : []),
        ],
      },
    ],
    footer: (
      <div className="nc-ai-mcp-menu-foot">
        {c.firstConnected ? t('lp.ai.first_connected', 'First connected {date}', { date: day(c.firstConnected) }) : t('lp.ai.not_used_yet', 'Not used yet')}
        {c.reportedName && c.reportedName !== c.name ? ` · ${c.reportedName}` : ''}
      </div>
    ),
  }, { placement: 'bottom-end' });
}

function RenameClient({ spaceId, c, close }: { spaceId: string; c: ClientRow; close: () => void }) {
  const [name, setName] = useState(c.renamed ? c.name : '');
  const save = async () => {
    try {
      await api('mcpRenameClient', { spaceId, key: c.key, name });
      close();
    } catch (e) {
      toast(e);
    }
  };
  return (
    <form className="nc-ai-mcp-rename" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="ttl">{t('lp.ai.rename', 'Rename')}</div>
      <div className="desc">{t('lp.ai.the_name_members_and_the_audit', 'The name members and the audit log see for this MCP client in this workspace.')}</div>
      <input className="nc-agent-input" autoFocus aria-label={t('lp.ai.name', 'Name')} value={name} placeholder={c.reportedName ?? c.name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <div className="actions">
        <Button onClick={close}>{t('lp.ai.cancel', 'Cancel')}</Button>
        <Button variant="primary" onClick={() => void save()}>{t('lp.ai.save', 'Save')}</Button>
      </div>
    </form>
  );
}

function openMembers(spaceId: string, c: ClientRow, reload: () => void) {
  openSubDialog((close) => <Members spaceId={spaceId} c={c} close={() => { close(); reload(); }} />);
}

function Members({ spaceId, c, close }: { spaceId: string; c: ClientRow; close: () => void }) {
  const [rows, setRows] = useState<{ userId: string; name: string; email: string | null; firstConnected: number | null; lastUsed: number | null }[] | null>(null);
  const [q, setQ] = useState('');
  const load = () => void api<{ members: NonNullable<typeof rows> }>('mcpClientMembers', { spaceId, key: c.key }).then((r) => setRows(r.members)).catch(toast);
  useEffect(load, [spaceId, c.key]);
  const shown = (rows ?? []).filter((m) => !q || `${m.name} ${m.email ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="nc-ai-mcp-members" data-testid="mcp-client-members">
      <div className="ttl">{c.name}</div>
      <div className="desc">{t('lp.ai.members_with_a_mcp_connection', 'Members with a {clientName} MCP connection', { clientName: c.name })}</div>
      <input className="nc-agent-input" value={q} placeholder={t('lp.ai.search_workspace_members', 'Find workspace members')} onChange={(e) => setQ(e.target.value)} />
      {rows === null ? <div className="nc-set-row-desc">{t('lp.ai.loading_connected_clients', 'Loading linked clients…')}</div> : shown.length ? (
        <table className="nc-set-table nc-ai-usage-table">
          <thead><tr><th>{t('lp.ai.workspace_member', 'Workspace member')}</th><th>{t('lp.ai.first_connected_5023', 'First connected')}</th><th>{t('lp.ai.last_used', 'Last used')}</th><th /></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.userId}>
                <td>{m.name}{m.email ? <div className="nc-set-row-desc">{m.email}</div> : null}</td>
                <td>{day(m.firstConnected)}</td>
                <td>{day(m.lastUsed)}</td>
                <td>
                  <Button small variant="danger" ariaLabel={t('lp.ai.disconnect_from', 'Disconnect {userName} from {clientName}', { userName: m.name, clientName: c.name })} onClick={async () => {
                    const ok = await confirmDialog({
                      title: t('lp.ai.disconnect_from_5615', 'Disconnect {userName} from {clientName}?', { userName: m.name, clientName: c.name }),
                      description: t('lp.ai.this_employee_s_tokens_for_the', 'This employee’s tokens for the client will be revoked, and its tool calls will stop.'),
                      confirmLabel: t('lp.ai.disconnect', 'Disconnect'),
                      danger: true,
                    });
                    if (!ok) return;
                    await api('mcpDisconnectClient', { spaceId, key: c.key, memberId: m.userId }).catch(toast);
                    load();
                  }}>{t('lp.ai.disconnect', 'Disconnect')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="nc-set-empty">{t('lp.ai.no_connected_members', 'No linked members')}</div>}
      <div className="actions"><Button onClick={close}>{t('lp.ai.close', 'Close')}</Button></div>
    </div>
  );
}

function openApproved(spaceId: string, data: ClientsAnswer, set: (d: ClientsAnswer) => void) {
  openSubDialog((close) => <Approved spaceId={spaceId} initial={data} onChange={set} close={close} />);
}

function Approved({ spaceId, initial, onChange, close }: { spaceId: string; initial: ClientsAnswer; onChange: (d: ClientsAnswer) => void; close: () => void }) {
  const [data, setData] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const update = (d: ClientsAnswer) => {
    const next = { ...data, ...d };
    setData(next);
    onChange(next);
  };
  const approved = data.clients.filter((c) => c.approved);
  const candidates = useMemo(() => {
    const have = new Set(approved.map((c) => c.key));
    const list = [
      ...(data.catalog ?? []).map((c) => ({ key: c.key, name: c.name, caption: c.caption })),
      ...data.clients.filter((c) => !c.known).map((c) => ({ key: c.key, name: c.name, caption: c.reportedName ?? '' })),
    ];
    return list.filter((c) => !have.has(c.key) && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  }, [data, q, approved]);
  return (
    <div className="nc-ai-mcp-members" data-testid="mcp-approved-clients">
      <div className="ttl">{adding ? t('lp.ai.approve_mcp_clients', 'Allow MCP clients') : t('lp.ai.approved_mcp_clients', 'Allowed MCP clients')}</div>
      {adding ? (
        <>
          <div className="desc">{t('lp.ai.find_mcp_clients_to_approve_any', 'Find MCP clients to approve. Any client a workspace owner connects gets approved automatically.')}</div>
          <input className="nc-agent-input" autoFocus value={q} placeholder={t('lp.ai.find_mcp_clients', 'Find MCP clients')} onChange={(e) => setQ(e.target.value)} />
          <div className="nc-ai-mcp-pick">
            {candidates.map((c) => {
              const on = picked.includes(c.key);
              return (
                <div key={c.key} role="option" aria-selected={on} className={`nc-agent-picker-row ${on ? 'on' : ''}`} data-client-key={c.key} onClick={() => setPicked(on ? picked.filter((x) => x !== c.key) : [...picked, c.key])}>
                  <span className="nc-ai-mcp-client-logo" aria-hidden>{c.name.slice(0, 1).toUpperCase()}</span>
                  <span className="nc-ellipsis">{c.name}</span>
                  <span className="nc-agent-picker-hint nc-ellipsis">{c.caption}</span>
                  {on && <span className="nc-agent-picker-check" aria-hidden>✓</span>}
                </div>
              );
            })}
            {!candidates.length && <div className="nc-set-row-desc">{t('lp.ai.no_matching_clients', 'No matching clients')}</div>}
          </div>
          <div className="actions">
            <span className="nc-set-row-desc">{t('lp.ai.count_plural_one_other_5552', '{count, plural, one {# MCP client chosen} other {# MCP clients chosen}}', { count: picked.length })}</span>
            <Button onClick={() => { setAdding(false); setPicked([]); }}>{t('lp.ai.cancel', 'Cancel')}</Button>
            <Button variant="primary" disabled={!picked.length} onClick={async () => {
              try {
                update(await api<ClientsAnswer>('mcpApproveClients', { spaceId, keys: picked }));
                setAdding(false);
                setPicked([]);
              } catch (e) {
                useUI.getState().toast(t('lp.ai.mcp_client_approval_didn_t_go', 'MCP client approval didn’t go through. Please try again.'));
                void e;
              }
            }}>{t('lp.ai.count_plural_0_one_other_approve', '{count, plural, =0 {Allow MCP clients} one {Approve MCP client} other {Approve {count} MCP clients}}', { count: picked.length })}</Button>
          </div>
        </>
      ) : (
        <>
          {approved.length ? (
            <table className="nc-set-table nc-ai-usage-table">
              <thead><tr><th>{t('lp.ai.name', 'Name')}</th><th>{t('lp.ai.approved', 'Approved')}</th><th /></tr></thead>
              <tbody>
                {approved.map((c) => (
                  <tr key={c.key} data-client-key={c.key}>
                    <td>{c.name}</td>
                    <td>{c.approvedTime ? t('lp.ai.by', '{date} by {user}', { date: day(c.approvedTime), user: c.approvedByName ?? '—' }) : '—'}</td>
                    <td><Button small variant="danger" onClick={() => void api<ClientsAnswer>('mcpRemoveApprovedClient', { spaceId, key: c.key }).then(update).catch(toast)}>{t('lp.ai.remove_mcp_client', 'Disconnect MCP client')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="nc-set-empty">
              <div>{t('lp.ai.your_approved_list_is_empty', 'Your approved list is empty')}</div>
              <div className="nc-set-row-desc">{t('lp.ai.no_mcp_clients_are_approved_right', 'No connected clients are approved yet')}</div>
            </div>
          )}
          <div className="actions">
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>{t('lp.ai.approve_an_mcp_client', 'Approve an MCP client')}</Button>
            <Button onClick={close}>{t('lp.ai.close', 'Close')}</Button>
          </div>
        </>
      )}
    </div>
  );
}
