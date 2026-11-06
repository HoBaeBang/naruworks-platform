


import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { domainProblem, GRANT_ROLE_LABEL, normalizeHost, triggerRowTitle, type AgentConfig, type AgentTrigger, type GrantRole } from '@nc/shared/agents.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { useBlock } from '../../lib/hooks.ts';
import { openPage, openPeek } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { BlockList } from '../editor/Block.tsx';
import { EditorSurface } from '../editor/EditorSurface.tsx';
import { appendToPage } from '../editor/commands.ts';
import { usePageLoader } from '../page/usePageLoader.ts';
import { openIconPicker } from '../page/IconPicker.tsx';
import { choiceDialog } from '../ai/dialogs.tsx';
import { agentApi, openAgent, toastError, useAgents, type AgentDetail, type ConnectionRow, type McpPreset } from './agentsApi.ts';
import { canEditAgent, useAgentPage } from './agentPage.ts';
import { AgentIcon } from './AgentsSection.tsx';
import { openTriggerModal } from './TriggerModal.tsx';
import { openMcpDialog } from './McpDialog.tsx';
import { openResourcePicker, ResourceIcon, Toggle } from './ui.tsx';

function Section({ id, title, description, children, action }: { id: string; title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="nc-agent-sec" data-section={id}>
      <div className="nc-agent-sec-head">
        <div className="nc-agent-sec-title">{title}</div>
        {action}
      </div>
      {description && <div className="nc-agent-sec-desc">{description}</div>}
      <div className="nc-agent-sec-body">{children}</div>
    </section>
  );
}

const GRANT_ORDER: GrantRole[] = ['reader', 'comment_only', 'read_and_write', 'editor'];

export function AgentSettingsPanel({ d }: { d: AgentDetail }) {
  const edit = canEditAgent(d);
  const cfg = d.config;
  const update = (patch: Partial<AgentConfig>) => (edit ? useAgentPage.getState().update(patch) : Promise.resolve(false));
  return (
    <aside className="nc-agent-settings" aria-label={t('lp.agents.settings', 'Settings')} data-testid="agent-settings">
      <div className="nc-agent-settings-scroll">
        <div className="nc-agent-settings-head">
          <div
            role="button"
            aria-label={t('lp.agents.agent_icon', 'Agent icon')}
            className={`nc-agent-head-icon ${edit ? 'editable' : ''}`}
            onClick={(e) => edit && openIconPicker(e.currentTarget, { current: cfg.icon, title: t('lp.agents.agent_icon', 'Agent icon'), onPick: (v) => void update({ icon: v ?? undefined }) })}
          >
            <AgentIcon icon={cfg.icon} size={40} />
          </div>
          <NameInput value={cfg.name} disabled={!edit} onCommit={(name) => void update({ name })} />
          <DescriptionInput value={cfg.description ?? ''} disabled={!edit} onCommit={(description) => void update({ description })} />
          {!edit && <div className="nc-agent-readonly-note" data-testid="agent-settings-readonly"><Icon name="eye" size={14} /> {t('lp.agents.you_can_view_this_agent_s', 'You can view this agent’s settings')}</div>}
        </div>
        <InstructionsSection d={d} edit={edit} />
        <TriggersSection d={d} edit={edit} update={update} />
        <ToolsSection d={d} edit={edit} update={update} />
        <ModelSection d={d} edit={edit} update={update} />
        <AdvancedSection d={d} edit={edit} update={update} />
      </div>
    </aside>
  );
}

function NameInput({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="nc-agent-name-input"
      aria-label={t('lp.agents.agent_name', 'Agent name')}
      data-testid="agent-name-input"
      value={v}
      disabled={disabled}
      placeholder={t('lp.agents.untitled_agent', 'Untitled agent')}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() && v !== value) onCommit(v.trim()); else setV(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function DescriptionInput({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (disabled && !value) return null;
  return (
    <input
      className="nc-agent-desc-input"
      aria-label={t('lp.agents.description', 'Description')}
      value={v}
      disabled={disabled}
      placeholder={t('lp.agents.add_a_description', 'Add a description…')}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}



function InstructionsSection({ d, edit }: { d: AgentDetail; edit: boolean }) {
  const pageId = d.instructionsPageId;
  const state = usePageLoader(pageId);
  const page = useBlock(pageId);
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    scroller.current = (host.current?.closest('.nc-agent-settings-scroll') as HTMLDivElement | null) ?? null;
  }, []);
  const empty = !page?.content?.length;
  return (
    <Section
      id="instructions"
      title={t('lp.agents.instructions', 'Instructions')}
      description={t('lp.agents.what_should_this_agent_do_on', 'What should this agent do on each run? See these <link>best practices</link>.').replace(/<\/?link>/g, '')}
      action={pageId ? (
        <div role="button" className="nc-agent-icon-btn" aria-label={t('lp.agents.edit_on_page', 'Edit on page')} data-tooltip={t('lp.agents.edit_on_page', 'Edit on page')} onClick={(e) => openMenu(e.currentTarget, {
          width: 200,
          sections: [{
            title: t('lp.agents.edit_on_page', 'Edit on page'),
            items: [
              { label: t('lp.agents.full_page', 'Full page'), icon: 'fullPage', onSelect: () => openPage(pageId) },
              { label: t('lp.agents.center_preview', 'Center preview'), icon: 'centerPeek', onSelect: () => openPeek(pageId, 'center_peek') },
              { label: t('lp.agents.side_preview', 'Side preview'), icon: 'sidePeek', onSelect: () => openPeek(pageId, 'side_peek') },
            ],
          }],
        }, { placement: 'bottom-end' })}>
          <Icon name="openAsPage" size={16} />
        </div>
      ) : undefined}
    >
      <div ref={host} className="nc-agent-instructions" data-testid="agent-instructions">
        {!pageId || state === 'missing' ? <div className="nc-agent-muted">{t('lp.agents.what_is_this_agent_for', 'What is this agent for?')}</div>
          : state === 'loading' && !page ? <div className="nc-agent-muted">…</div>
            : page && (
              <EditorSurface pageId={pageId} readOnly={!edit} scroller={scroller}>
                <div className="lit-page-content nc-agent-instructions-content">
                  <BlockList parentId={pageId} ids={page.content} depth={0} readOnly={!edit} />
                  {edit && empty && (
                    <div className="nc-agent-instructions-empty" role="button" onMouseDown={(e) => { e.preventDefault(); appendToPage(pageId); }}>
                      {t('lp.agents.what_is_this_agent_for', 'What is this agent for?')}
                    </div>
                  )}
                  {edit && !empty && <div className="nc-click-to-append" onMouseDown={(e) => { e.preventDefault(); appendToPage(pageId); }} />}
                </div>
              </EditorSurface>
            )}
      </div>
    </Section>
  );
}



const TRIGGER_ICON: Record<AgentTrigger['type'], string> = {
  recurrence: 'agentSchedule',
  'lit.page_created': 'agentPageAdd',
  'lit.page_updated': 'agentPageEdit',
  'lit.page_deleted': 'agentPageRemove',
  'lit.comment_added': 'agentComment',
  'lit.agent_mentioned': 'agentMention',
  'lit.meeting_note_summarized': 'agentMeeting',
};

function TriggersSection({ d, edit, update }: { d: AgentDetail; edit: boolean; update: (p: Partial<AgentConfig>) => Promise<boolean> }) {
  const cfg = d.config;
  const setTriggers = (triggers: AgentTrigger[]) => update({ triggers });
  const run = async () => {
    try {
      await agentApi.run(d.agent.id);
      useAgentPage.getState().setTab('activity');
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Section
      id="triggers"
      title={t('lp.agents.triggers', 'Triggers')}
      description={t('lp.agents.set_what_starts_this_agent', 'Set what starts this agent')}
    >
      <div className="nc-agent-list" data-testid="agent-triggers">
        {cfg.triggers.map((tr) => {
          const target = d.triggerTargets[tr.id];
          const next = d.nextRuns[tr.id];
          return (
            <div key={tr.id} className={`nc-agent-row ${tr.enabled ? '' : 'off'}`} data-trigger-id={tr.id} data-trigger-type={tr.type}>
              <div className="nc-agent-row-icon"><Icon name={TRIGGER_ICON[tr.type]} size={16} /></div>
              <div className="nc-agent-row-main" role={edit ? 'button' : undefined} onClick={(e) => edit && openTriggerModal(d, e.currentTarget, tr, (next) => void setTriggers(cfg.triggers.map((x) => (x.id === tr.id ? next : x))), () => void setTriggers(cfg.triggers.filter((x) => x.id !== tr.id)))}>
                <div className="nc-agent-row-title">
                  {triggerRowTitle(tr)}
                  {target && <span className="nc-agent-row-suffix"> {t('lp.agents.in', 'in {context}', { context: target.title })}</span>}
                  {tr.type === 'lit.agent_mentioned' && <span className="nc-agent-row-suffix"> {t('lp.agents.in_litpage', 'in Litpage')}</span>}
                </div>
                {next && tr.enabled && <div className="nc-agent-row-sub">{t('lp.agents.next_run', 'Next run: {time}', { time: next })}</div>}
                {tr.type === 'lit.page_updated' && tr.properties?.length ? <div className="nc-agent-row-sub">{t('lp.agents.watching_properties', 'watching properties: {properties}', { properties: tr.properties.length })}</div> : null}
              </div>
              <Toggle label={t('lp.agents.trigger_on', 'Trigger on')} checked={tr.enabled} disabled={!edit} onChange={(v) => void setTriggers(cfg.triggers.map((x) => (x.id === tr.id ? { ...x, enabled: v } : x)))} />
              {edit && (
                <div role="button" className="nc-agent-icon-btn small" aria-label={t('lp.agents.delete', 'Delete')} onClick={async () => {
                  const ok = await choiceDialog({ title: t('lp.agents.delete_this_trigger', 'Remove this automation?'), buttons: [{ label: t('lp.agents.delete', 'Delete'), value: true, danger: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }] });
                  if (ok) void setTriggers(cfg.triggers.filter((x) => x.id !== tr.id));
                }}>
                  <Icon name="trash" size={14} />
                </div>
              )}
            </div>
          );
        })}
        {!cfg.triggers.length && <div className="nc-agent-muted">{t('lp.agents.runs_only_when_someone_chats_with', 'Runs only when someone chats with it or clicks Run.')}</div>}
      </div>
      <div className="nc-agent-sec-actions">
        {edit && (
          <div role="button" className="nc-agent-add" data-testid="agent-add-trigger" onClick={(e) => openTriggerModal(d, e.currentTarget, null, (tr) => void setTriggers([...cfg.triggers, tr]))}>
            <Icon name="plus" size={14} />
            <span>{t('lp.agents.add_trigger', 'Add trigger')}</span>
          </div>
        )}
        {d.agent.published && (
          <div role="button" className="nc-agent-add" onClick={() => void run()}>
            <Icon name="agentPlay" size={14} />
            <span>{t('lp.agents.run_agent', 'Run agent')}</span>
          </div>
        )}
      </div>
    </Section>
  );
}



function roleMenu(anchor: HTMLElement, current: GrantRole, max: GrantRole | 'editor', onPick: (r: GrantRole) => void, onRemove?: () => void, database = false) {
  const rank = (r: GrantRole) => GRANT_ORDER.indexOf(r);
  const items: MenuItemDef[] = GRANT_ORDER.slice().reverse().map((r) => ({
    label: GRANT_ROLE_LABEL[r],
    description: r === 'editor' ? (database ? t('lp.agents.can_edit_anything_change_database_struct', 'Can edit anything, change database structure and views, and manage permissions') : t('lp.agents.can_edit_anything_and_manage_permissions', 'Can edit anything and manage permissions')) : undefined,
    checked: r === current,
    disabled: rank(r) > rank(max as GrantRole),
    onSelect: () => onPick(r),
  }));
  openMenu(anchor, {
    width: 260,
    sections: [{ items }, ...(onRemove ? [{ items: [{ label: t('lp.agents.remove', 'Remove'), icon: 'trash', danger: true, onSelect: onRemove }] }] : [])],
    footer: <div className="nc-agent-menu-foot">{t('lp.agents.you_can_only_share_access_you', 'You can only share access you already have.')}</div>,
  }, { placement: 'bottom-end' });
}

function ToolsSection({ d, edit, update }: { d: AgentDetail; edit: boolean; update: (p: Partial<AgentConfig>) => Promise<boolean> }) {
  const cfg = d.config;
  
  const [presets, setPresets] = useState<McpPreset[]>([]);
  useEffect(() => {
    const sid = useSession.getState().spaceId;
    if (sid && edit) void agentApi.presets(sid).then((r) => setPresets(r.presets)).catch(() => setPresets([]));
  }, [edit]);
  const space = records.get('space', useSession.getState().spaceId) as { name?: string } | undefined;
  const agents = useAgents((s) => s.agents);
  const setGrant = (blockId: string, role: GrantRole) => update({ grants: cfg.grants.some((g) => g.block_id === blockId) ? cfg.grants.map((g) => (g.block_id === blockId ? { ...g, role } : g)) : [...cfg.grants, { block_id: blockId, role }] });
  const removeGrant = (blockId: string) => update({ grants: cfg.grants.filter((g) => g.block_id !== blockId) });
  const toggleWorkspace = async (on: boolean) => {
    if (on) {
      const ok = await choiceDialog({
        title: t('lp.agents.give_this_agent_access_to_everything', 'Give this agent access to everything shared with the workspace?'),
        description: t('lp.agents.the_agent_will_be_able_to', 'The agent will be able to view every page shared with everyone in {spaceName}, and anyone who can use this agent can ask it about them. Agents can view these pages at most.', { spaceName: space?.name ?? '' }),
        buttons: [{ label: t('lp.agents.allow', 'Allow'), value: true, primary: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }],
      });
      if (!ok) return;
    }
    void update({ workspace_access: on ? 'reader' : 'none' });
  };
  const addMenu = (anchor: HTMLElement) => {
    const subCandidates = agents.filter((a) => a.id !== d.agent.id && a.alive && !cfg.sub_agents.includes(a.id));
    openMenu(anchor, {
      width: 300,
      search: t('lp.agents.search_connections', 'Search connections…'),
      sections: [
        {
          title: t('lp.agents.add_connection', 'Add connection'),
          items: [
            { label: t('lp.agents.litpage_pages_and_databases', 'Litpage pages and databases'), icon: 'page', onSelect: () => { setTimeout(() => openResourcePicker(anchor, (r) => void setGrant(r.blockId, 'reader')), 0); } },
            { label: t('lp.agents.custom_mcp_server', 'External MCP endpoint'), icon: 'agentPlug', description: t('lp.agents.connect_to_an_mcp_server_for', 'Connect to an MCP server for AI inference and tools'), onSelect: () => { setTimeout(() => openMcpDialog(d), 0); } },
            ...presets.map((p) => ({
              label: p.name,
              icon: 'agentPlug',
              description: p.description || p.url,
              right: <span className="nc-agent-badge gray">{t('lp.agents.workspace_managed', 'Workspace Managed')}</span>,
              onSelect: () => { setTimeout(() => openMcpDialog(d, p), 0); },
            })),
            { label: t('lp.agents.people_directory', 'People Directory'), icon: 'agentPeople', disabled: cfg.people_directory, description: t('lp.agents.look_up_people_in_the_workspace', 'Look up people in the workspace'), onSelect: () => void update({ people_directory: true }) },
            {
              label: t('lp.agents.litpage_agents', 'Litpage agents'),
              icon: 'agentFace',
              description: t('lp.agents.add_agents_here_to_let_this', 'Add agents here to let this agent call them.'),
              submenu: () => ({
                width: 260,
                search: t('lp.agents.search_agents', 'Search agents…'),
                emptyText: t('lp.agents.no_agents_found', 'No matching agents'),
                sections: [{ items: subCandidates.map((a) => ({ label: a.name, icon: <AgentIcon icon={a.icon} size={18} />, onSelect: () => void update({ sub_agents: [...cfg.sub_agents, a.id] }) })) }],
              }),
            },
          ],
        },
      ],
    }, { placement: 'bottom-start' });
  };
  return (
    <Section
      id="tools"
      title={t('lp.agents.tools_and_access', 'Tools and permissions')}
      description={t('lp.agents.pick_the_tools_pages_and_connections', 'Pick the tools, pages, and connections this agent is allowed to use.')}
    >
      <div className="nc-agent-list" data-testid="agent-grants">
        {d.grants.map((g) => (
          <div key={g.blockId} className={`nc-agent-row ${g.missing ? 'off' : ''}`} data-grant={g.blockId}>
            <div className="nc-agent-row-icon"><ResourceIcon icon={g.canOpen ? g.icon : null} database={g.database} /></div>
            <div className="nc-agent-row-main" role={g.canOpen ? 'button' : undefined} onClick={() => g.canOpen && openPage(g.blockId)}>
              <div className="nc-agent-row-title">{g.canOpen ? g.title : t('lp.agents.no_access', 'No access')}</div>
              {g.missing && <div className="nc-agent-row-sub warn">{t('lp.agents.this_page_is_no_longer_available', 'This page is no longer available to this agent.')}</div>}
              {g.revoked && <div className="nc-agent-row-sub warn">{t('lp.agents.revokername_select_undefined_other_revok', '{revokerName, select, undefined {Someone} other {{revokerName}}} revoked this agent’s access using the Share menu on this page.', { revokerName: g.revoked.byName })}</div>}
            </div>
            <div role="button" className={`nc-agent-role ${edit ? '' : 'readonly'}`} data-testid="agent-grant-role" onClick={(e) => edit && roleMenu(e.currentTarget, g.role, g.canOpen ? 'editor' : g.role, (r) => void setGrant(g.blockId, r), () => void removeGrant(g.blockId), g.database)}>
              {GRANT_ROLE_LABEL[g.role]}
              {edit && <Icon name="arrowChevronSingleDownSmall" size={12} />}
            </div>
          </div>
        ))}
        <div className="nc-agent-row" data-grant="workspace">
          <div className="nc-agent-row-icon"><Icon name="building" size={16} /></div>
          <div className="nc-agent-row-main">
            <div className="nc-agent-row-title">{t('lp.agents.pages_open_to_all_of', 'Pages open to all of {spaceName}', { spaceName: space?.name ?? '' })}</div>
            {cfg.workspace_access === 'reader' && <div className="nc-agent-row-sub">{GRANT_ROLE_LABEL.reader}</div>}
          </div>
          <Toggle label={t('lp.agents.pages_open_to_all_of', 'Pages open to all of {spaceName}', { spaceName: space?.name ?? '' })} testId="agent-workspace-access" checked={cfg.workspace_access === 'reader'} disabled={!edit} onChange={(v) => void toggleWorkspace(v)} />
        </div>
        <WebRow d={d} edit={edit} update={update} />
        {cfg.people_directory && (
          <div className="nc-agent-row" data-connection="people">
            <div className="nc-agent-row-icon"><Icon name="agentPeople" size={16} /></div>
            <div className="nc-agent-row-main"><div className="nc-agent-row-title">{t('lp.agents.people_directory', 'People Directory')}</div></div>
            {edit && <div role="button" className="nc-agent-icon-btn small" aria-label={t('lp.agents.disconnect', 'Disconnect')} onClick={() => void update({ people_directory: false })}><Icon name="close" size={14} /></div>}
          </div>
        )}
        {d.subAgents.map((s) => (
          <div key={s.id} className="nc-agent-row" data-connection={`agent:${s.id}`}>
            <div className="nc-agent-row-icon"><AgentIcon icon={s.icon} size={16} /></div>
            <div className="nc-agent-row-main" role="button" onClick={() => s.canOpen && openAgent(s.id)}>
              <div className="nc-agent-row-title">{s.canOpen ? s.name : t('lp.agents.unavailable_agent', 'Unavailable agent')}</div>
              <div className="nc-agent-row-sub">{t('lp.agents.litpage_agents', 'Litpage agents')}</div>
            </div>
            {edit && <div role="button" className="nc-agent-icon-btn small" aria-label={t('lp.agents.disconnect', 'Disconnect')} onClick={() => void update({ sub_agents: cfg.sub_agents.filter((x) => x !== s.id) })}><Icon name="close" size={14} /></div>}
          </div>
        ))}
        {d.connections.map((c) => <McpRow key={c.id} d={d} c={c} edit={edit} />)}
      </div>
      {edit && (
        <div className="nc-agent-sec-actions">
          <div role="button" className="nc-agent-add" data-testid="agent-add-connection" onClick={(e) => addMenu(e.currentTarget)}>
            <Icon name="plus" size={14} />
            <span>{t('lp.agents.add_connection', 'Add connection')}</span>
          </div>
          <div role="button" className="nc-agent-add" data-testid="agent-add-page" onClick={(e) => openResourcePicker(e.currentTarget, (r) => void setGrant(r.blockId, 'reader'))}>
            <Icon name="page" size={14} />
            <span>{t('lp.agents.add', 'Add')} {t('lp.agents.pages', 'pages')}</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function WebRow({ d, edit, update }: { d: AgentDetail; edit: boolean; update: (p: Partial<AgentConfig>) => Promise<boolean> }) {
  const cfg = d.config;
  const [domain, setDomain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const disabledByAdmin = !d.webAllowed;
  const addDomain = (list: 'web_domains' | 'trusted_urls') => {
    const existing = (cfg[list] ?? []) as string[];
    const problem = domainProblem(domain, existing);
    if (problem) {
      setErr(problem);
      return;
    }
    const h = normalizeHost(domain)!;
    setErr(null);
    setDomain('');
    void update({ [list]: [...existing, h] } as Partial<AgentConfig>);
  };
  const allowAll = async (on: boolean) => {
    if (on) {
      const ok = await choiceDialog({
        title: t('lp.agents.allow_all_urls', 'Allow all URLs?'),
        description: t('lp.agents.every_http_and_https_url_is', 'Every HTTP and HTTPS URL is permitted, so the agent can open any address without confirming first.'),
        buttons: [{ label: t('lp.agents.allow_all_urls_f2c0', 'Allow all URLs'), value: true, danger: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }],
      });
      if (!ok) return;
    }
    void update({ allow_all_urls: on });
  };
  return (
    <div className="nc-agent-row web" data-connection="web">
      <div className="nc-agent-row-icon"><Icon name="agentWeb" size={16} /></div>
      <div className="nc-agent-row-main">
        <div className="nc-agent-row-title">{t('lp.agents.web_access', 'Web access')}</div>
        <div className="nc-agent-row-sub">{disabledByAdmin ? t('lp.agents.web_browsing_is_disabled_by_your', 'Web browsing is disabled by your workspace admin.') : t('lp.agents.lets_the_agent_browse_the_web', 'Lets the agent browse the web with no limits on internet access.')}</div>
        {cfg.web_access && !disabledByAdmin && (
          <div className="nc-agent-web">
            <div className="nc-agent-chips">
              {(cfg.web_domains ?? []).map((h) => (
                <span key={h} className="nc-agent-chip">{h}{edit && <span role="button" aria-label={t('lp.agents.remove_39d4', 'Remove {domain}', { domain: h })} onClick={() => void update({ web_domains: (cfg.web_domains ?? []).filter((x) => x !== h) })}><Icon name="close" size={10} /></span>}</span>
              ))}
            </div>
            {edit && (
              <div className="nc-agent-inline-form">
                <input className="nc-agent-input" value={domain} aria-label={t('lp.agents.trusted_domain', 'Trusted domain')} placeholder={(cfg.web_domains ?? []).length ? t('lp.agents.add_a_restricted_domain_such_as', 'Add a restricted domain, such as arxiv.org') : t('lp.agents.limit_to_a_domain_such_as', 'Limit to a domain, such as arxiv.org')} onChange={(e) => { setDomain(e.target.value); setErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') addDomain('web_domains'); }} />
              </div>
            )}
            {err && <div className="nc-agent-error">{err}</div>}
            <div className="nc-agent-subrow">
              <span>{t('lp.agents.allow_all_urls_f2c0', 'Allow all URLs')}</span>
              <Toggle label={t('lp.agents.allow_all_urls_f2c0', 'Allow all URLs')} checked={!!cfg.allow_all_urls} disabled={!edit || d.webConfirm} onChange={(v) => void allowAll(v)} />
            </div>
            {d.webConfirm && <div className="nc-agent-row-sub">{t('lp.agents.your_workspace_has_enabled_require_confi', 'Your workspace has enabled “Ask before making web requests.” Allowlisted URLs still require approval.')}</div>}
          </div>
        )}
      </div>
      <Toggle label={t('lp.agents.toggle_the_web_browser', 'Toggle the web browser')} testId="agent-web-access" checked={cfg.web_access && !disabledByAdmin} disabled={!edit || disabledByAdmin} onChange={(v) => void update({ web_access: v })} />
    </div>
  );
}

const MODE_LABEL: Record<string, string> = { auto: 'Run automatically', ask: 'Always ask', allow: 'Always allow' };

function McpRow({ d, c, edit }: { d: AgentDetail; c: ConnectionRow; edit: boolean }) {
  const [open, setOpen] = useState(false);
  const owner = c.mine;
  const apply = async (patch: Parameters<typeof agentApi.updateConnection>[2]) => {
    try {
      const r = await agentApi.updateConnection(d.agent.id, c.id, patch);
      useAgentPage.getState().setDetail({ ...useAgentPage.getState().detail!, ...r });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="nc-agent-row mcp" data-connection={`mcp:${c.id}`}>
      <div className="nc-agent-row-icon"><Icon name="agentPlug" size={16} /></div>
      <div className="nc-agent-row-main">
        <div className="nc-agent-row-title" role="button" onClick={() => setOpen(!open)}>
          {c.name}
          {c.workspaceManaged && <span className="nc-agent-badge gray">{t('lp.agents.workspace_managed', 'Workspace Managed')}</span>}
          {c.error
            ? <span className="nc-agent-status red" data-tooltip={c.error}><Icon name="agentAlert" size={12} /> {t('lp.agents.couldn_t_connect', 'Couldn’t connect')}</span>
            : <span className="nc-agent-status ok"><Icon name="agentCheck" size={12} /> {t('lp.agents.connected', 'Connected')}</span>}
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} />
        </div>
        <div className="nc-agent-row-sub">{t('lp.agents.connected_by', 'Connected by {connectedByName}', { connectedByName: c.addedByName || t('lp.agents.unknown_user', 'Unknown user') })}</div>
        {open && (
          <div className="nc-agent-tools">
            {c.tools.map((tool) => (
              <div key={tool.name} className="nc-agent-tool">
                <Toggle label={tool.name} checked={tool.enabled} disabled={!edit || !owner} onChange={(v) => void apply({ disabledTools: c.tools.filter((x) => (x.name === tool.name ? !v : !x.enabled)).map((x) => x.name) })} />
                <div className="nc-agent-tool-main">
                  <div className="nc-agent-tool-name">{tool.name}{tool.readOnly && <span className="nc-agent-badge gray">read-only</span>}{tool.destructive && <span className="nc-agent-badge red">destructive</span>}</div>
                  {tool.description && <div className="nc-agent-row-sub">{tool.description}</div>}
                </div>
                <div role="button" className={`nc-agent-role ${edit && owner ? '' : 'readonly'}`} onClick={(e) => edit && owner && openMenu(e.currentTarget, {
                  width: 220,
                  sections: [{ items: (['auto', 'ask', 'allow'] as const).map((m) => ({ label: MODE_LABEL[m], checked: tool.mode === m, onSelect: () => void apply({ toolModes: { [tool.name]: m } }) })) }],
                }, { placement: 'bottom-end' })}>
                  {MODE_LABEL[tool.mode]}
                  {edit && owner && <Icon name="arrowChevronSingleDownSmall" size={12} />}
                </div>
              </div>
            ))}
            {!owner && <div className="nc-agent-row-sub">{t('lp.agents.only_the_person_who_connected_this', 'Only the person who connected this server can change its tools.')}</div>}
          </div>
        )}
      </div>
      {edit && owner && (
        <div role="button" className="nc-agent-icon-btn small" aria-label={t('lp.agents.refresh_tools', 'Refresh tools')} data-tooltip={t('lp.agents.refresh_tools', 'Refresh tools')} onClick={async () => {
          try {
            const r = await agentApi.refreshConnection(d.agent.id, c.id);
            useAgentPage.getState().setDetail({ ...useAgentPage.getState().detail!, ...r });
          } catch (e) {
            toastError(e);
          }
        }}><Icon name="refresh" size={14} /></div>
      )}
      {edit && (
        <div role="button" className="nc-agent-icon-btn small" aria-label={t('lp.agents.disconnect', 'Disconnect')} onClick={async () => {
          const ok = await choiceDialog({ title: t('lp.agents.disconnect_this_connection', 'Disconnect this integration?'), description: t('lp.agents.this_also_deletes_every_setting_and', 'This also deletes every setting and trigger that relies on this connection. Reconnecting will require you to authenticate again.'), buttons: [{ label: t('lp.agents.disconnect', 'Disconnect'), value: true, danger: true }, { label: t('lp.agents.cancel', 'Cancel'), value: false }] });
          if (!ok) return;
          try {
            const r = await agentApi.removeConnection(d.agent.id, c.id);
            useAgentPage.getState().setDetail({ ...useAgentPage.getState().detail!, ...r });
          } catch (e) {
            toastError(e);
          }
        }}><Icon name="close" size={14} /></div>
      )}
    </div>
  );
}



const FALLBACK: Record<string, [string, string]> = {
  auto: ['workflow.agent.modelFailover.auto', 'Use another model'],
  wait: ['workflow.agent.modelFailover.wait', 'Wait for recovery'],
  none: ['workflow.agent.modelFailover.none', 'Stop if unavailable'],
};
const FALLBACK_DESC: Record<string, [string, string]> = {
  auto: ['workflow.agent.modelFailover.autoDescription', 'Switch to another available model'],
  wait: ['workflow.agent.modelFailover.waitDescription', 'The agent waits and retries when the selected model is unavailable'],
  none: ['workflow.agent.modelFailover.noneDescription', 'Runs stop when the selected model is unavailable'],
};

function ModelSection({ d, edit, update }: { d: AgentDetail; edit: boolean; update: (p: Partial<AgentConfig>) => Promise<boolean> }) {
  const cfg = d.config;
  const cur = d.models.find((m) => m.id === cfg.model);
  const label = cfg.model === 'auto' || !cur ? t('lp.agents.auto', 'Auto') : `${cur.name} ${cur.version}`;
  const pick = (anchor: HTMLElement) => {
    const items: MenuItemDef[] = [
      { label: t('lp.agents.auto', 'Auto'), description: t('lp.agents.litpage_picks_the_best_model_for', 'Litpage picks the best model for each request'), checked: cfg.model === 'auto', onSelect: () => void update({ model: 'auto' }) },
      ...d.models.map((m) => ({
        label: `${m.name} ${m.version}`,
        description: m.allowed ? m.description + (/Haiku|Luna|Mini/i.test(m.name) ? ` ${t('lp.agents.smaller_models_may_be_more_vulnerable', 'Smaller models may be more vulnerable to prompt injection.')}` : '') : t('lp.agents.restricted_by_your_workspace_admin', 'Restricted by your workspace admin'),
        badge: m.beta ? 'Beta' : undefined,
        checked: cfg.model === m.id,
        disabled: !m.allowed,
        onSelect: () => {
          void update({ model: m.id });
        },
      })),
    ];
    openMenu(anchor, { width: 300, sections: [{ items }] }, { placement: 'bottom-end' });
  };
  return (
    <Section id="model" title={t('lp.agents.model', 'Model')}>
      <div className="nc-agent-row">
        <div className="nc-agent-row-icon"><Icon name="agentModel" size={16} /></div>
        <div className="nc-agent-row-main"><div className="nc-agent-row-title">{t('lp.agents.model', 'Model')}</div></div>
        <div role="button" className={`nc-agent-role ${edit ? '' : 'readonly'}`} data-testid="agent-model" onClick={(e) => edit && pick(e.currentTarget)}>{label}{edit && <Icon name="arrowChevronSingleDownSmall" size={12} />}</div>
      </div>
      <div className="nc-agent-row">
        <div className="nc-agent-row-icon"><Icon name="agentShield" size={16} /></div>
        <div className="nc-agent-row-main">
          <div className="nc-agent-row-title">{t('lp.agents.fallback_behavior', 'Fallback behavior')}</div>
          <div className="nc-agent-row-sub">{t(...FALLBACK_DESC[cfg.fallback ?? 'auto'])}</div>
        </div>
        <div role="button" className={`nc-agent-role ${edit ? '' : 'readonly'}`} onClick={(e) => edit && openMenu(e.currentTarget, {
          width: 280,
          sections: [{ items: (['auto', 'wait', 'none'] as const).map((k) => ({ label: t(...FALLBACK[k]), description: t(...FALLBACK_DESC[k]), checked: (cfg.fallback ?? 'auto') === k, onSelect: () => void update({ fallback: k }) })) }],
        }, { placement: 'bottom-end' })}>{t(...FALLBACK[cfg.fallback ?? 'auto'])}{edit && <Icon name="arrowChevronSingleDownSmall" size={12} />}</div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Advanced

function AdvancedSection({ d, edit, update }: { d: AgentDetail; edit: boolean; update: (p: Partial<AgentConfig>) => Promise<boolean> }) {
  const cfg = d.config;
  const [open, setOpen] = useState(false);
  return (
    <section className="nc-agent-sec" data-section="advanced">
      <div className="nc-agent-sec-head" role="button" onClick={() => setOpen(!open)}>
        <div className="nc-agent-sec-title">{t('lp.agents.advanced', 'Advanced')}</div>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </div>
      {open && (
        <div className="nc-agent-sec-body">
          <div className="nc-agent-sec-desc">{t('lp.agents.configure_tools_and_sources_in_more', 'Configure tools and sources in more detail.')}</div>
          <div className="nc-agent-row">
            <div className="nc-agent-row-main">
              <div className="nc-agent-row-title">{t('lp.agents.skip_every_approval', 'Skip every approval')}</div>
            </div>
            <Toggle label={t('lp.agents.turn_on_or_off_skipping_approvals', 'Turn on or off skipping approvals')} checked={!!cfg.skip_approvals} disabled={!edit} onChange={(v) => void update({ skip_approvals: v })} />
          </div>
          <div className="nc-agent-row">
            <div className="nc-agent-row-main">
              <div className="nc-agent-row-title">{t('lp.agents.allow_model_changes', 'Allow model changes')}</div>
              <div className="nc-agent-row-sub">{t('lp.agents.let_users_and_agents_pick_another', 'Let users and agents pick another model for individual chats.')}</div>
            </div>
            <Toggle label={t('lp.agents.turn_chat_model_changes_on_or', 'Turn chat model changes on or off')} checked={cfg.allow_model_override !== false} disabled={!edit} onChange={(v) => void update({ allow_model_override: v })} />
          </div>
          <div className="nc-agent-row">
            <div className="nc-agent-row-main">
              <div className="nc-agent-row-title">{t('lp.agents.one_shared_chat_history_for_everyone', 'One shared chat history for everyone')}</div>
              <div className="nc-agent-row-sub">{t('lp.agents.when_on_this_agent_can_read', 'When on, this agent can read every user’s chats and triggered runs. When off, each person’s conversations stay separate.')}</div>
            </div>
            <Toggle label={t('lp.agents.let_the_agent_access_every_chat', 'Let the agent access every chat and run')} checked={!!cfg.share_chat_history} disabled={!edit} onChange={(v) => void update({ share_chat_history: v })} />
          </div>
        </div>
      )}
    </section>
  );
}
