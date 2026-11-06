// Settings › Import, Litpage AI, meeting notes, Litpage MCP, verified pages, public pages, and developer tools.
// Personal choices persist to user_settings.settings, workspace switches (admins) to space.settings.
import { useEffect, useState } from 'react';
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { pageSlug } from '@nc/shared/ids.ts';
import { api } from '../../../lib/api.ts';
import { createPageIn, run } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { navigate, openPage, spaceDomain } from '../../../lib/router.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { ImportPanel } from '../../import/ImportPanel.tsx';
import { t } from '../../shell/i18n.ts';
import { Badge, Button, Dropdown, Group, Pills, Row, SectionPage, Switch, Upsell, UserAvatar, confirmDialog, msg, openSubDialog, rich } from '../ui.tsx';
import { prefValue, savePref, savePrefs, usePrefs, type UserPrefs } from '../userSettings.ts';
import { planAtLeast, saveSpaceSettings, spaceApi, spaceSetting, useSpaceAccess } from '../spaceSettings.ts';
import { fmtDate } from './workspace.tsx';
import { useDeveloperMode } from '../developerMode.ts';
import { AiWorkspaceControls, LitMcpAccess, SharedChatsTable, useSharedChats } from '../../ai/AiSettings.tsx';
import { VerifiedPagesTable } from '../../page/VerifiedPagesTable.tsx';
import { AgentsAdmin } from '../../agents/AgentsAdmin.tsx';
import { ImageGenerationSettings } from '../../aiImage/ImageSettings.tsx';
import { developersUrl, openDevelopers } from '../../developer/api.ts';

function closeSettings() {
  useUI.getState().set({ settingsOpen: false });
}

function stub(what: string) {
  useUI.getState().toast(t('lp.settings.isn_t_available_in_this_build', '{what} isn’t available in this build', { what }));
}

function titleOf(b: BlockRecord | undefined): string {
  const title = (b?.properties as any)?.title as [string, unknown?][] | undefined;
  return title?.map((x) => x[0]).join('') || t('lp.settings.untitled', 'Untitled');
}

/** Ask workspace owners for an upgrade (members) — recorded in Settings › Requests. */
export async function requestUpgrade(spaceId: string, plan: string) {
  try {
    await spaceApi('requestUpgrade', { spaceId, plan });
    useUI.getState().toast(t('lp.settings.request_sent_to_workspace_owners', 'Request sent to workspace owners'));
  } catch (e) {
    useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
  }
}

// ---------------------------------------------------------------------------------------------- Import

export function ImportSection() {
  return (
    <SectionPage
      title={t('lp.settings.import', 'Import')}
      subtitle={t('lp.settings.pull_files_and_content_from_other', 'Pull files and content from other tools into Litpage')}
    >
      <ImportPanel onDone={closeSettings} />
    </SectionPage>
  );
}

// ---------------------------------------------------------------------------------------------- Litpage AI

const AI_CONNECTORS: { id: string; name: string; color: string; desc: string }[] = [
  { id: 'slack', name: 'Slack', color: '#4a154b', desc: 'Search messages and channels' },
  { id: 'google-drive', name: 'Google Drive', color: '#1a73e8', desc: 'Search docs, sheets and slides' },
  { id: 'github', name: 'GitHub', color: '#1f2328', desc: 'Search issues, pull requests and code' },
  { id: 'jira', name: 'Jira', color: '#0c66e4', desc: 'Search issues and projects' },
  { id: 'microsoft-teams', name: 'Microsoft Teams', color: '#5059c9', desc: 'Search chats and channels' },
  { id: 'sharepoint', name: 'SharePoint & OneDrive', color: '#036c70', desc: 'Search files and sites' },
  { id: 'gmail', name: 'Gmail', color: '#ea4335', desc: 'Search your inbox' },
  { id: 'linear', name: 'Linear', color: '#5e6ad2', desc: 'Search issues and projects' },
];

export function LitAISection() {
  const [tab, setTab] = useState<'general' | 'connectors' | 'agents' | 'skills'>('general');
  const prefs = usePrefs();
  // workspace AI settings are the owners' (membership admins manage members and groups only, server: policy.ts)
  const { space, owner: admin } = useSpaceAccess();
  const instructionsPage = prefs.ai_instructions_page as string | undefined;
  const page = instructionsPage ? records.get<BlockRecord>('block', instructionsPage) : undefined;

  const addInstructions = () => {
    let id = '';
    run('createAiInstructions', (tx) => {
      id = createPageIn(tx, { kind: 'private' }, { title: [[t('lp.settings.ai_instructions', 'AI instructions')]] });
    });
    if (!id) return;
    savePref('ai_instructions_page', id);
    closeSettings();
    openPage(id);
  };
  const pickInstructions = (anchor: HTMLElement) => {
    openPagePicker(anchor, (id) => savePref('ai_instructions_page', id));
  };

  return (
    <SectionPage title={t('lp.settings.litpage_ai', 'Litpage AI')} subtitle={t('lp.settings.configure_ai_features_to_suit_you', 'Configure AI features to suit you and manage connectors')}>
      {/* tab pills, then the tab body 44px below */}
      <div className="nc-set-ai-sec">
      <Pills
        value={tab}
        onChange={setTab}
        items={[
          { value: 'general', label: t('lp.settings.general', 'General') },
          {
            value: 'connectors',
            label: t('lp.settings.ai_connectors', 'AI connectors'),
            icon: (
              <span className="nc-set-pill-logos" aria-hidden>
                <span><i style={{ background: '#4a154b' }}>S</i></span>
                <span><i style={{ background: '#1f2328' }}>G</i></span>
                <span><i style={{ background: '#1a73e8' }}>D</i></span>
              </span>
            ),
          },
          { value: 'agents', label: t('lp.settings.agents', 'Agents') },
          { value: 'skills', label: t('lp.settings.skills', 'Skills') },
        ]}
      />
      {tab === 'agents' && <AgentsAdmin />}
      {tab === 'general' && (
        <div className="nc-set-ai-general">
          {/* Personalization: text column vertically centred on the 197×124 illustration, 16px apart */}
          <div className="nc-set-ai-personal">
            <div className="col">
              <div className="ttl">{t('lp.settings.personalization', 'Personalization')}</div>
              <div className="desc">{t('lp.settings.choose_a_name_for_your_litpage', 'Choose a name for your Litpage AI')}</div>
              <div style={{ marginTop: 6 }}>
                <Button icon="pencilSmall" onClick={() => openSubDialog((close) => <PersonalizeBody close={close} prefs={prefs} />)}>{t('lp.settings.personalize', 'Personalize')}</Button>
              </div>
            </div>
            <div className="nc-set-ai-face" aria-hidden>
              <div className="face">
                <Icon name="aiFace" size={44} />
              </div>
              {prefs.ai_name ? <div className="name">{prefs.ai_name}</div> : null}
            </div>
          </div>
          <div className="nc-set-ai-instr">
            <h2 className="ttl">{t('lp.settings.instructions', 'Instructions')}</h2>
            <div className="desc">{t('lp.settings.instructions_customize_how_your_agent_wo', 'Instructions customize how your agent works and responds to you')}</div>
            <div className="body">
            {page && page.alive !== false ? (
              <div className="nc-set-instr">
                <Icon name="page" size={18} />
                <div className="main">
                  <div className="ttl">{titleOf(page)}</div>
                  <div className="sub">{t('lp.settings.guidance_litpage_agent_keeps_in_mind', 'Guidance Litpage Agent keeps in mind while helping you')}</div>
                </div>
                <Button small onClick={() => { closeSettings(); openPage(page.id); }}>{t('lp.settings.open_page', 'Open page')}</Button>
                <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.choose_another_page', 'Choose another page')} onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                  width: 220,
                  sections: [{
                    items: [
                      { label: t('lp.settings.choose_another_page', 'Choose another page'), icon: 'page', onSelect: () => { const a = e.currentTarget as HTMLElement; setTimeout(() => pickInstructions(a), 0); } },
                      { label: t('lp.settings.remove', 'Remove'), icon: 'trashSmall', danger: true, onSelect: () => savePref('ai_instructions_page', null as unknown as string) },
                    ],
                  }],
                }, { placement: 'bottom-end' })}
                >
                  <Icon name="ellipsisSmall" size={16} />
                </span>
              </div>
            ) : (
              <div><Button icon="pencilSmall" onClick={addInstructions}>{t('lp.settings.add_instructions', 'Add instructions')}</Button></div>
            )}
            </div>
          </div>
          {/* workspace controls, model controls, MCP connections, usage (features/ai) */}
          <AiWorkspaceControls />
          {/* Image generation (features/aiImage) */}
          <ImageGenerationSettings />
        </div>
      )}
      {tab === 'connectors' && (
        <Group
          plain
          title={t('lp.settings.workspace_ai_connections', 'Workspace AI connections')}
          description={t('lp.settings.workspace_owners_can_connect_the_tools', 'Workspace owners can connect the tools their teams use for work.')}
        >
          <div className="nc-set-grid two">
            {AI_CONNECTORS.map((c) => {
              const connected = spaceSetting<string[]>(space, 'ai_connectors', []).includes(c.id);
              return (
                <div key={c.id} className="nc-set-conn">
                  <span className="nc-set-conn-logo sm" style={{ background: c.color }}>{c.name.slice(0, 1)}</span>
                  <div className="nc-set-conn-main">
                    <div className="nc-set-conn-name">{c.name}{connected && <Badge tone="gray">{t('lp.settings.connected', 'Connected')}</Badge>}</div>
                    <div className="nc-set-conn-desc">{c.desc}</div>
                  </div>
                  <span data-tooltip={admin ? undefined : t('lp.settings.this_connection_needs_an_admin_to', 'This connection needs an admin to turn it on')}>
                    <Button
                      small
                      disabled={!admin || !space}
                      onClick={() => {
                        if (!space) return;
                        const list = spaceSetting<string[]>(space, 'ai_connectors', []);
                        if (connected) saveSpaceSettings(space.id, { ai_connectors: list.filter((x) => x !== c.id) });
                        else stub(c.name);
                      }}
                    >
                      {connected ? t('lp.settings.disconnect', 'Disconnect') : t('lp.settings.connect', 'Connect')}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </Group>
      )}
      {tab === 'skills' && (
        <Group
          plain
          title={t('lp.settings.skills', 'Skills')}
          description={t('lp.settings.skills_are_repeatable_tasks_that_ai', 'Skills are repeatable tasks that AI can complete from a chat or a page selection.')}
        >
          <div className="nc-set-empty-card">
            <div>{t('lp.settings.find_and_set_up_skills_in', 'Find and set up skills in the Library')}</div>
            <Button onClick={() => { closeSettings(); navigate(`/${spaceDomain(useSession.getState().spaceId)}/library/skills`); }}>{t('lp.settings.open_library', 'Open Library')}</Button>
          </div>
        </Group>
      )}
      </div>
    </SectionPage>
  );
}

function PersonalizeBody({ close, prefs }: { close: () => void; prefs: UserPrefs }) {
  const [name, setName] = useState((prefs.ai_name as string) ?? '');
  return (
    <>
      <h3>{t('lp.settings.personalization', 'Personalization')}</h3>
      <div>
        <label className="nc-set-label">{t('lp.settings.name', 'Name')} · {t('lp.settings.pick_what_litpage_agent_calls_itself', 'Pick what Litpage Agent calls itself')}</label>
        <div className="nc-set-input"><input autoFocus maxLength={40} placeholder={t('lp.settings.name_your_litpage_agent', 'Name your Litpage agent')} value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <div className="actions">
        <Button variant="primary" onClick={() => { savePrefs({ ai_name: name.trim() }); close(); }}>{t('lp.settings.save', 'Save')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

/** Page search menu (title search through api('searchWorkspace')). */
function openPagePicker(anchor: HTMLElement, onPick: (id: string) => void) {
  const spaceId = useSession.getState().spaceId;
  openOverlayPicker(anchor, async (q) => {
    const res = await api<{ results?: { id: string }[]; recordMap?: any }>('searchWorkspace', { query: q, spaceId, limit: 20, filters: { titleOnly: true } }).catch(() => ({ results: [] as { id: string }[], recordMap: undefined }));
    if (res.recordMap) records.mergeRecordMap(res.recordMap);
    return (res.results ?? []).map((r) => ({ id: r.id, label: titleOf(records.get<BlockRecord>('block', r.id)) }));
  }, onPick, t('lp.settings.find_a_page', 'Find a page…'), 'page');
}

/** Async searchable picker built on the menu component: re-opens with fresh results as the query changes. */
function openOverlayPicker(anchor: HTMLElement, load: (q: string) => Promise<{ id: string; label: string }[]>, onPick: (id: string) => void, placeholder: string, icon: string) {
  void load('').then((items) => {
    openMenu(anchor, {
      width: 300,
      maxHeight: 360,
      search: placeholder,
      emptyText: t('lp.settings.no_results', 'No results'),
      sections: [{ items: items.map((it) => ({ label: it.label, text: it.label, icon, onSelect: () => onPick(it.id) })) }],
    }, { placement: 'bottom-end' });
  });
}

// ---------------------------------------------------------------------------------------------- Meeting notes

export function MeetingNotesSection() {
  const prefs = usePrefs();
  const { space, owner: admin, plan } = useSpaceAccess(); // workspace settings: owners (policy.ts)
  const [dbName, setDbName] = useState<string | null>(null);
  const dbId = prefs.meeting_default_db as string | undefined;
  useEffect(() => {
    if (!dbId) { setDbName(null); return; }
    const c = records.get<any>('collection', dbId);
    if (c) setDbName(((c.name as [string][] | undefined)?.map((x) => x[0]).join('')) || t('lp.settings.untitled', 'Untitled'));
    else void api<{ results: { collectionId: string; name: string }[] }>('searchDataSources', { spaceId: space?.id, query: '', limit: 200 })
      .then((r) => setDbName(r.results.find((x) => x.collectionId === dbId)?.name ?? null))
      .catch(() => setDbName(null));
  }, [dbId, space?.id]);
  if (!space) return null;
  const lockTip = admin ? undefined : t('lp.settings.to_change_this_reach_out_to', 'To change this, reach out to your workspace admin');
  const enforce = spaceSetting(space, 'meeting_enforce_consent', false);
  const set = (patch: Record<string, unknown>) => saveSpaceSettings(space.id, patch);
  const pickDb = (anchor: HTMLElement) => {
    openOverlayPicker(anchor, async (q) => {
      const r = await api<{ results: { collectionId: string; name: string }[]; recordMap: any }>('searchDataSources', { spaceId: space.id, query: q, limit: 50 }).catch(() => ({ results: [], recordMap: undefined }));
      if (r.recordMap) records.mergeRecordMap(r.recordMap);
      return r.results.map((x) => ({ id: x.collectionId, label: x.name }));
    }, (id) => savePref('meeting_default_db', id), t('lp.settings.find_a_database', 'Find a database…'), 'databaseEmbed');
  };
  return (
    <SectionPage title={t('lp.settings.meeting_notes', 'Meeting notes')} subtitle={t('lp.settings.configure_meeting_notes_for_yourself_and', 'Configure meeting notes for yourself and for your workspace.')}>
      <Group plain title={t('lp.settings.workspace_settings', 'Workspace settings')}>
        <Row
          id="meeting-notes-enabled"
          label={t('lp.settings.turn_on_meeting_notes_for_the', 'Turn on meeting notes for the workspace')}
          description={t('lp.settings.make_ai_meeting_notes_available_to', 'Make AI meeting notes available to everyone in the workspace.')}
          control={<span data-tooltip={lockTip}><Switch label="Turn on meeting notes for this workspace" disabled={!admin} checked={spaceSetting(space, 'meeting_notes_enabled', true)} onChange={(v) => set({ meeting_notes_enabled: v })} /></span>}
        />
        <Row
          id="store-audio-locally"
          label={t('lp.settings.save_audio_on_this_device', 'Save audio on this device')}
          description={t('lp.settings.allow_members_to_temporarily_store_a', 'Allow members to temporarily store a local, on-device copy of their meeting audio for added reliability.')}
          control={<span data-tooltip={lockTip}><Switch label="Keep audio on this device" disabled={!admin} checked={spaceSetting(space, 'meeting_store_audio_locally', false)} onChange={(v) => set({ meeting_store_audio_locally: v })} /></span>}
        />
        <Row
          id="transcript-deletion"
          label={t('lp.settings.delete_transcripts_automatically', 'Delete transcripts automatically')}
          description={!planAtLeast(plan, 'enterprise')
            ? <Upsell
                text={admin
                  ? msg('lp.settings.upgrade_to_choose_when_transcripts_are', '<highlight>Upgrade</highlight> to choose when transcripts are deleted automatically.')
                  : msg('lp.settings.request_access_to_choose_when_transcript', '<highlight>Request access</highlight> to choose when transcripts are deleted automatically')}
                onClick={admin ? undefined : () => void requestUpgrade(space.id, 'enterprise')}
              />
            : undefined}
          control={(
            <Dropdown
              width={200}
              disabled={!admin || !planAtLeast(plan, 'enterprise')}
              value={spaceSetting(space, 'meeting_transcript_deletion', 'never')}
              options={[
                { value: 'never', label: t('lp.settings.never', 'Never') },
                { value: '7', label: t('lp.settings.n_plural_one_other_7f1a', '{n, plural, one {# day} other {# days}}', { n: 7 }) },
                { value: '30', label: t('lp.settings.n_plural_one_other_7f1a', '{n, plural, one {# day} other {# days}}', { n: 30 }) },
                { value: '90', label: t('lp.settings.n_plural_one_other_7f1a', '{n, plural, one {# day} other {# days}}', { n: 90 }) },
                { value: '365', label: t('lp.settings.n_plural_one_other', '{n, plural, one {# year} other {# years}}', { n: 1 }) },
              ]}
              onChange={(v) => set({ meeting_transcript_deletion: v })}
            />
          )}
        />
        <Row
          id="enforce-consent"
          label={t('lp.settings.require_consent_from_every_workspace_mem', 'Require consent from every workspace member')}
          description={t('lp.settings.require_every_transcription_by_a_workspa', 'Require every transcription by a workspace member to open with an audio consent message')}
          control={<span data-tooltip={lockTip}><Switch label="Require consent from every workspace member" disabled={!admin} checked={enforce} onChange={(v) => set({ meeting_enforce_consent: v })} /></span>}
        />
      </Group>
      <Group plain title={t('lp.settings.personal_preferences', 'Personal preferences')}>
        <Row
          id="meeting-auto-share"
          label={t('lp.settings.share_automatically_with_internal_calend', 'Share automatically with internal calendar attendees')}
          description={t('lp.settings.workspace_members_invited_to_a_calendar', 'Workspace members invited to a calendar event automatically get access to its AI meeting notes. Notes without a linked calendar event aren’t affected.')}
          control={<Switch label="Share automatically with internal calendar guests" checked={prefValue(prefs, 'meeting_auto_share')} onChange={(v) => savePref('meeting_auto_share', v)} />}
        />
        <Row
          id="meeting-hide-tab"
          label={t('lp.settings.hide_the_meetings_tab', 'Hide the Meetings tab')}
          description={t('lp.settings.this_hides_the_tab_from_your', 'This hides the tab from your sidebar only')}
          control={(
            <Dropdown
              width={160}
              value={prefs.meeting_hide_tab === 'always' ? 'always' : 'never'}
              options={[
                { value: 'never', label: t('lp.settings.never', 'Never') },
                { value: 'always', label: t('lp.settings.always', 'Always') },
              ]}
              onChange={(v) => savePref('meeting_hide_tab', v)}
            />
          )}
        />
        <Row
          id="meeting-auto-consent"
          label={t('lp.settings.open_each_transcription_with_a_consent', 'Open each transcription with a consent message')}
          description={t('lp.settings.every_transcription_starts_by_playing_an', 'Every transcription starts by playing an audio consent message automatically.')}
          control={<Switch label="Play the consent message when starting" disabled={enforce} checked={enforce || prefValue(prefs, 'meeting_auto_consent')} onChange={(v) => savePref('meeting_auto_consent', v)} />}
        />
        <Row
          id="meeting-default-db"
          label={t('lp.settings.choose_the_default_meetings_database', 'Choose the default meetings database')}
          description={t('lp.settings.pick_an_existing_database_or_set', 'Pick an existing database or set up a new one to hold future AI meeting notes.')}
          control={(
            <div
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              className="nc-set-btn nc-set-dropdown nc-set-db-picker"
              onClick={(e) => {
                const a = e.currentTarget;
                if (dbId) {
                  openMenu(a, {
                    width: 300,
                    sections: [{
                      items: [
                        { label: t('lp.settings.find_a_database', 'Find a database…'), icon: 'magnifyingGlassSmall', onSelect: () => { setTimeout(() => pickDb(a), 0); } },
                        { label: t('lp.settings.remove', 'Remove'), icon: 'trashSmall', danger: true, onSelect: () => savePref('meeting_default_db', null as unknown as string) },
                      ],
                    }],
                  }, { placement: 'bottom-end' });
                } else pickDb(a);
              }}
            >
              <span className={dbId ? '' : 'placeholder'}>{dbId ? (dbName ?? '…') : t('lp.settings.find_a_database', 'Find a database…')}</span>
              <span className="chev"><Icon name="arrowChevronSingleDownSmall" size={14} /></span>
            </div>
          )}
        />
      </Group>
    </SectionPage>
  );
}

// ---------------------------------------------------------------------------------------------- Litpage MCP

interface McpClient { id: string; name: string; caption: string; color: string; letter: string; custom?: boolean; url?: string }

function mcpCatalog(): McpClient[] {
  const fallback = (appName: string) => t('lp.settings.link_with_your_litpage_workspace', 'Link {appName} with your Litpage workspace', { appName });
  return [
    { id: 'chatgpt', name: 'ChatGPT', caption: t('lp.settings.let_chatgpt_deep_research_pull_in', 'Let ChatGPT Deep Research pull in context from Litpage'), color: '#000000', letter: 'C' },
    { id: 'claude', name: 'Claude', caption: t('lp.settings.have_claude_collaborate_with_you_in', 'Have Claude collaborate with you in Litpage.'), color: '#d97757', letter: 'C' },
    { id: 'composio', name: 'Composio', caption: t('lp.settings.create_composio_workflows_with_litpage_a', 'Create Composio workflows with Litpage access'), color: '#2b2b2b', letter: 'C' },
    { id: 'cursor', name: 'Cursor', caption: t('lp.settings.find_and_cite_litpage_docs_and', 'Find and cite Litpage docs and tasks without leaving your editor'), color: '#111111', letter: 'C' },
    { id: 'devin', name: 'Devin', caption: t('lp.settings.let_devin_tap_into_your_litpage', 'Let Devin tap into your Litpage workspace while building'), color: '#1a7f64', letter: 'D' },
    { id: 'figma', name: 'Figma', caption: t('lp.settings.prototype_from_your_litpage_prds_by', 'Prototype from your Litpage PRDs by linking them to Figma.'), color: '#a259ff', letter: 'F' },
    { id: 'github', name: 'GitHub', caption: t('lp.settings.track_github_issues_and_pull_requests', 'Track GitHub issues and pull requests as connected tasks in Litpage'), color: '#1f2328', letter: 'G' },
    { id: 'glass', name: 'Glass', caption: t('lp.settings.give_glass_litpage_context_for_everyday', 'Give Glass Litpage context for everyday work.'), color: '#e8e05a', letter: 'G' },
    { id: 'grok', name: 'Grok Bot', caption: fallback('Grok Bot'), color: '#000000', letter: 'X' },
    { id: 'hubspot', name: 'HubSpot', caption: t('lp.settings.keep_hubspot_account_notes_alongside_lit', 'Keep HubSpot account notes alongside Litpage work.'), color: '#ff7a59', letter: 'H' },
    { id: 'make', name: 'Make', caption: t('lp.settings.use_make_to_automate_work_in', 'Use Make to automate work in Litpage'), color: '#6d00cc', letter: 'M' },
    { id: 'mistral', name: 'Mistral', caption: t('lp.settings.draft_plans_and_database_entries_in', 'Draft plans and database entries in Litpage.'), color: '#fa520f', letter: 'M' },
    { id: 'muse', name: 'Muse', caption: fallback('Muse'), color: '#3d3d3d', letter: 'M' },
    { id: 'poke', name: 'Poke', caption: t('lp.settings.let_poke_use_your_litpage_workspace', 'Let Poke use your Litpage workspace'), color: '#ff4f81', letter: 'P' },
    { id: 'vscode', name: 'VS Code', caption: t('lp.settings.bring_litpage_context_into_your_code', 'Bring Litpage context into your code by linking your IDE.'), color: '#007acc', letter: 'V' },
    { id: 'zapier', name: 'Zapier', caption: t('lp.settings.connect_litpage_to_zapier_automations', 'Connect Litpage to Zapier automations.'), color: '#ff4f00', letter: 'Z' },
  ];
}

interface EnabledMcp { id: string; enabled_time: number }

/** Disable / Remove: my access tokens connected with this client stop working in this workspace. */
async function stopClient(c: McpClient) {
  try {
    const r = await api<{ revoked: number }>('mcpDisableMyClient', { spaceId: useSession.getState().spaceId, client: { id: c.id, name: c.name } });
    if (r.revoked) useUI.getState().toast(t('lp.settings.can_no_longer_access_this_workspace', '{clientName} can no longer access this workspace', { clientName: c.name }));
  } catch (e) {
    useUI.getState().toast((e as Error).message);
  }
}

export function LitMcpSection() {
  const prefs = usePrefs();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const custom = (prefs.mcp_custom_clients as McpClient[] | undefined) ?? [];
  const enabled = (prefs.mcp_enabled as EnabledMcp[] | undefined) ?? [];
  const all = [...mcpCatalog(), ...custom.map((c) => ({ ...c, custom: true }))];
  const isOn = (id: string) => enabled.some((e) => e.id === id);
  const enable = (c: McpClient) => savePrefs({ mcp_enabled: [...enabled.filter((e) => e.id !== c.id), { id: c.id, enabled_time: Date.now() }] });
  const disable = async (c: McpClient) => {
    const ok = await confirmDialog({
      title: t('lp.settings.disable', 'Disable {clientName}?', { clientName: c.name }),
      description: t('lp.settings.loses_access_to_this_workspace_via', '{clientName} loses access to this workspace via your account. You can connect it again whenever you like.', { clientName: c.name }),
      confirmLabel: t('lp.settings.disable_9a7d', 'Disable'),
      danger: true,
    });
    if (!ok) return;
    // the server revokes my tokens connected with this client (turning it off is more than a local preference)
    await stopClient(c);
    savePrefs({ mcp_enabled: enabled.filter((e) => e.id !== c.id) });
  };
  const enabledClients = enabled.map((e) => all.find((c) => c.id === e.id)).filter(Boolean) as McpClient[];
  const needle = q.trim().toLowerCase();
  const shown = all.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.caption.toLowerCase().includes(needle));
  const details = (c: McpClient, anchor: HTMLElement) => openMenu(anchor, {
    width: 260,
    sections: [{
      items: [
        { label: c.name, description: enabled.find((e) => e.id === c.id) ? `${t('lp.settings.first_connected', 'First connected')}: ${fmtDate(enabled.find((e) => e.id === c.id)!.enabled_time)}` : c.caption, disabled: true },
        isOn(c.id)
          ? { label: t('lp.settings.disable_9a7d', 'Disable'), icon: 'xMarkSmall', danger: true, onSelect: () => { void disable(c); } }
          : { label: t('lp.settings.enable', 'Enable'), icon: 'checkmarkSmall', onSelect: () => enable(c) },
        ...(c.custom ? [{ label: t('lp.settings.remove', 'Remove'), icon: 'trashSmall', danger: true, onSelect: () => { void stopClient(c).then(() => savePrefs({ mcp_custom_clients: custom.filter((x) => x.id !== c.id), mcp_enabled: enabled.filter((e) => e.id !== c.id) })); } }] : []),
      ],
    }],
  }, { placement: 'bottom-end' });

  return (
    <SectionPage
      title={t('lp.settings.litpage_mcp', 'Litpage MCP')}
      subtitle={t('lp.settings.work_in_litpage_from_other_apps', 'Work in Litpage from other apps. The Litpage MCP server lets agents, apps, and tools act on this workspace.')}
    >
      <Group plain title={t('lp.settings.enabled_clients', 'Enabled clients ({count})', { count: enabledClients.length })}>
        {enabledClients.length ? (
          <div className="nc-set-mcp-tiles">
            {enabledClients.slice(0, 5).map((c) => (
              <div key={c.id} role="button" tabIndex={0} className="nc-set-mcp-tile" aria-label={t('lp.settings.view_details', 'View {clientName} details', { clientName: c.name })} onClick={(e) => details(c, e.currentTarget)}>
                <span className="logo" style={{ background: c.color }}>{c.letter}<span className="ok"><Icon name="checkmarkCircleFillSmall" size={14} /></span></span>
                <span className="nm">{c.name}</span>
                {c.url && <span className="sub">{c.url.replace(/^https?:\/\//, '')}</span>}
              </div>
            ))}
            {enabledClients.length > 5 && (
              <div className="nc-set-mcp-tile more" aria-label={t('lp.settings.count_plural_one_other', '{count, plural, one {Show all # enabled MCP client} other {Show all # enabled MCP clients}}', { count: enabledClients.length })}>
                <span className="nm">{t('lp.settings.count_plural_one_other_0f88', '+ {count, plural, one {# additional} other {# additional}}', { count: enabledClients.length - 5 })}</span>
              </div>
            )}
          </div>
        ) : <div className="nc-set-row-desc">{t('lp.settings.none_of_your_mcp_clients_are', 'None of your MCP clients are enabled.')}</div>}
      </Group>
      <Group>
        <div className="nc-set-mcp-head">
          <div className="nc-set-group-title plain inline">{t('lp.settings.mcp_clients_for_litpage', 'MCP clients for Litpage')}</div>
          <div className="nc-set-people-actions">
            {searching ? (
              <div className="nc-set-input nc-set-people-search">
                <Icon name="magnifyingGlassSmall" size={16} />
                <input autoFocus value={q} placeholder={t('lp.settings.find_mcp_clients', 'Find MCP clients')} onChange={(e) => setQ(e.target.value)} onBlur={() => { if (!q) setSearching(false); }} />
              </div>
            ) : (
              <span role="button" tabIndex={0} className="nc-set-icon-btn lg" aria-label={t('lp.settings.find_mcp_clients', 'Find MCP clients')} onClick={() => setSearching(true)}><Icon name="magnifyingGlass" size={16} /></span>
            )}
            <Button icon="plusSmall" onClick={() => openSubDialog((close) => <AddMcpClientBody close={close} onAdd={(c) => savePrefs({ mcp_custom_clients: [...custom, c], mcp_enabled: [...enabled, { id: c.id, enabled_time: Date.now() }] })} />)}>
              {t('lp.settings.connect_a_new_mcp_client', 'Connect a new MCP client')}
            </Button>
          </div>
        </div>
        {shown.length ? (
          <div className="nc-set-mcp-cards">
            {shown.map((c) => (
              <div key={c.id} className="nc-set-mcp-card" role="button" tabIndex={0} aria-label={isOn(c.id) ? t('lp.settings.view_details', 'View {clientName} details', { clientName: c.name }) : t('lp.settings.enable_37d5', 'Enable {appName}', { appName: c.name })} onClick={(e) => (isOn(c.id) ? details(c, e.currentTarget) : enable(c))}>
                <span className="logo" style={{ background: c.color }}>{c.letter}</span>
                <div className="main">
                  <div className="nm">{c.name}</div>
                  <div className="ds">{c.caption}</div>
                </div>
                {isOn(c.id) ? (
                  <span className="state">
                    <Icon name="checkmarkCircleFill" size={16} style={{ color: 'var(--lp-blue-icon-accent, #818cf8)' }} />
                    <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.more_actions', 'More actions')} onClick={(e) => { e.stopPropagation(); details(c, e.currentTarget as HTMLElement); }}><Icon name="ellipsisSmall" size={16} /></span>
                  </span>
                ) : <span className="nc-set-btn small enable">{t('lp.settings.enable', 'Enable')}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="nc-set-empty">
            <div className="nc-set-user-name">{t('lp.settings.nothing_found', 'Nothing found')}</div>
            {t('lp.settings.your_search_didn_t_find_any', 'Your search didn’t find any MCP clients')}
          </div>
        )}
        <div className="nc-set-crosslink">
          {rich(msg('lp.settings.need_github_prs_slack_or_google', 'Need GitHub PRs, Slack, or Google Drive content in Litpage? <nowrap><link>Connections</link></nowrap>'), {}, {
            nowrap: (c) => <span style={{ whiteSpace: 'nowrap' }}>{c}</span>,
          }).map((n) => n)}
          {' '}
          <span role="button" tabIndex={0} className="nc-set-link strong" onClick={() => useUI.getState().set({ settingsSection: 'connections' })}>
            {t('lp.settings.connections', 'Connections')}
            <Icon name="arrowStraightRightSmall" size={14} />
          </span>
        </div>
      </Group>
      {/* Litpage MCP server: access tokens and owner governance. */}
      <LitMcpAccess />
    </SectionPage>
  );
}

function AddMcpClientBody({ close, onAdd }: { close: () => void; onAdd: (c: McpClient) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const ok = name.trim() && /^https?:\/\/\S+$/.test(url.trim());
  return (
    <>
      <h3>{t('lp.settings.connect_a_new_mcp_client', 'Connect a new MCP client')}</h3>
      <div>
        <label className="nc-set-label">{t('lp.settings.name', 'Name')}</label>
        <div className="nc-set-input"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My agent" /></div>
      </div>
      <div>
        <label className="nc-set-label">{t('lp.settings.client_url', 'Client URL')}</label>
        <div className="nc-set-input"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://127.0.0.1:3000" /></div>
      </div>
      <div className="actions">
        <Button variant="primary" disabled={!ok} onClick={() => { onAdd({ id: `custom-${Date.now().toString(36)}`, name: name.trim(), caption: url.trim(), url: url.trim(), color: '#52525b', letter: name.trim().slice(0, 1).toUpperCase(), custom: true }); close(); }}>
          {t('lp.settings.enable', 'Enable')}
        </Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Verified pages

export function VerifiedPagesSection() {
  const { space, plan, owner } = useSpaceAccess();
  if (!space) return null;
  const business = planAtLeast(plan, 'business');
  const emptyState = (
      <div className="nc-set-verified-empty">
        <Icon name="badgeCheck" size={36} style={{ color: 'var(--lp-icon-tertiary)' }} />
        <div className="ttl">{t('lp.settings.verify_every_page', 'Verify every page')}</div>
        {business ? (
          <div className="sub">{t('lp.settings.no_verified_pages_yet_open_a', 'No verified pages yet. Open a page’s ••• menu and choose Verify to mark it as up to date.')}</div>
        ) : (
          <>
            <div className="sub">{t('lp.settings.verify_any_page_by_upgrading_to', 'Verify any page by upgrading to the Business plan')}</div>
            <Button className="big" icon="arrowInCircleUpAnimated" onClick={() => (owner ? useUI.getState().set({ settingsSection: 'plans' }) : void requestUpgrade(space.id, 'business'))}>
              {owner ? t('lp.settings.upgrade', 'Upgrade') : t('lp.settings.request', 'Request')}
            </Button>
          </>
        )}
      </div>
  );
  return (
    <SectionPage title={t('lp.settings.verified_pages', 'Verified pages')} subtitle={t('lp.settings.oversee_verified_pages_in_this_workspace', 'Oversee verified pages in this workspace')}>
      {/* the list of verified pages on Business and above; other plans see the empty / upgrade state */}
      {business ? <VerifiedPagesTable spaceId={space.id} onOpen={(id) => { closeSettings(); openPage(id); }} empty={emptyState} /> : emptyState}
    </SectionPage>
  );
}

// ---------------------------------------------------------------------------------------------- Public pages

interface PublicPage { blockId: string; kind: 'site' | 'link' | 'form'; published_time?: number; published_by_id?: string; title?: string; viewId?: string }

export function PublicPagesSection() {
  const { space, owner } = useSpaceAccess();
  const sharedChats = useSharedChats(space?.id);
  const [list, setList] = useState<PublicPage[] | null>(null);
  const [open, setOpen] = useState<'site' | 'form' | 'link' | 'chats' | null>(null);
  useEffect(() => {
    if (!space?.id) return;
    let off = false;
    api<{ pages: PublicPage[]; recordMap: any }>('getPublicPages', { spaceId: space.id })
      .then((r) => { if (off) return; records.mergeRecordMap(r.recordMap); setList(r.pages); })
      .catch(() => !off && setList([]));
    return () => { off = true; };
  }, [space?.id]);
  if (!space) return null;
  const of = (k: PublicPage['kind']) => (list ?? []).filter((p) => p.kind === k);
  const tile = (key: 'site' | 'form' | 'link' | 'chats', header: string, pages: PublicPage[], empty: string) => {
    const loading = list === null && key !== 'chats';
    return (
      <div
        key={key}
        role="button"
        tabIndex={pages.length ? 0 : -1}
        aria-disabled={!pages.length || undefined}
        aria-expanded={open === key}
        className={`nc-set-ptile ${open === key ? 'open' : ''}`}
        onClick={() => pages.length && setOpen(open === key ? null : key)}
      >
        <div className="main">
          <div className="head">
            <div className="hdr">{header}</div>
            {loading ? <div className="skeleton" style={{ width: 140, height: 25 }} /> : <div className="big">{pages.length}</div>}
          </div>
          <div className="chips">
            {loading ? <div className="skeleton" style={{ width: 120, height: 24 }} /> : pages.length ? (
              <>
                <span className="chip"><Icon name="page" size={14} /><span>{pages[0].title ?? titleOf(records.get<BlockRecord>('block', pages[0].blockId))}</span></span>
                {pages.length > 1 && <span className="more">{t('lp.settings.text', '+{count}', { count: pages.length - 1 })}</span>}
              </>
            ) : <span className="none">{empty}</span>}
          </div>
        </div>
        <span className="chev"><Icon name="arrowChevronSingleDownFill" size={12} /></span>
      </div>
    );
  };
  const rows = open === 'site' ? of('site') : open === 'form' ? of('form') : open === 'link' ? of('link') : [];
  return (
    <SectionPage title={t('lp.settings.public_pages', 'Public pages')} subtitle={t('lp.settings.manage_public_workspace_content', 'Manage public workspace content')}>
      {/* Domains sits 36px under the tiles (margin-top: 36px), not the 48px group gap */}
      <div className="nc-set-public-sec">
      <div>
        <div className="nc-set-ptiles">
          {tile('site', t('lp.settings.published_sites', 'Published sites'), of('site'), t('lp.settings.no_sites_published', 'No sites published'))}
          {tile('form', t('lp.settings.public_forms', 'Public forms'), of('form'), t('lp.settings.no_public_forms_yet', 'No public forms yet'))}
          {tile('link', t('lp.settings.anyone_who_has_the_link', 'Anyone who has the link'), of('link'), t('lp.settings.no_links_shared_publicly', 'No links shared publicly'))}
          {tile('chats', t('lp.settings.ai_chats_shared', 'AI chats shared'), (sharedChats ?? []).map((c) => ({ blockId: c.id, kind: 'link' as const, title: c.title || 'Untitled chat' })), t('lp.settings.no_chats_are_shared', 'No chats are shared'))}
        </div>
        {open === 'chats' && sharedChats && sharedChats.length > 0 && <SharedChatsTable chats={sharedChats} onClose={closeSettings} />}
        {open && open !== 'chats' && rows.length > 0 && (
          <table className="nc-set-table nc-set-public-table" data-kind={open}>
            <thead>
              <tr>
                <th style={{ width: '34%' }}>{t('lp.settings.page', 'Page')}</th>
                <th>{open === 'site' ? t('lp.settings.domain', 'Domain') : t('lp.settings.link', 'Link')}</th>
                <th>{t('lp.settings.originally_published_by', 'Originally published by')}</th>
                <th>{t('lp.settings.published_date', 'Published date')}</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const b = records.get<BlockRecord>('block', p.blockId);
                const by = p.published_by_id ? records.get<UserRecord>('lit_user', p.published_by_id) : undefined;
                const name = p.kind === 'form' && p.title ? p.title : titleOf(b);
                // sites live under the workspace's domain (/public/…), forms at /form/<view>, share links at the page URL
                const path = p.kind === 'site' ? `/public/${pageSlug(titleOf(b), p.blockId)}`
                  : p.kind === 'form' && p.viewId ? `/form/${p.viewId.replace(/-/g, '')}`
                    : `/${space.domain}/${p.blockId.replace(/-/g, '')}`;
                const url = `${location.origin}${path}`;
                return (
                  <tr key={`${p.kind}:${p.viewId ?? p.blockId}`}>
                    <td className="primary"><span className="nc-set-user"><Icon name={p.kind === 'form' ? 'dbViewForm' : 'page'} size={16} />{name}</span></td>
                    <td>
                      {p.kind === 'site'
                        ? <span className="nc-set-domain-chip">{space.domain}.litpage.site</span>
                        : <span role="button" tabIndex={0} className="nc-set-link-cell" title={t('lp.settings.copy_the_complete_url', 'Copy the complete URL')} onClick={() => { void navigator.clipboard?.writeText(url); useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete')); }}>{path}</span>}
                    </td>
                    <td>{by ? <span className="nc-set-user"><UserAvatar user={by} size={18} />{by.name || by.email}</span> : '—'}</td>
                    <td>{fmtDate(p.published_time)}</td>
                    <td>
                      <Button small onClick={() => { void navigator.clipboard?.writeText(url); useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete')); }}>{t('lp.settings.copy_link', 'Copy link')}</Button>
                      <Button small variant="ghost" onClick={() => { closeSettings(); if (p.kind === 'form') window.open(path, '_blank'); else openPage(p.blockId); }}>{t('lp.settings.view', 'View')}</Button>
                      {p.kind === 'site' && (
                        <Button small variant="ghost" onClick={() => { closeSettings(); openPage(p.blockId); setTimeout(() => void import('../../page/SiteSettings.tsx').then((m) => m.openSiteSettings(p.blockId)), 300); }}>{t('lp.settings.settings', 'Settings')}</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <DomainsGroup space={space} admin={owner} sites={of('site')} />
      </div>
    </SectionPage>
  );
}

/** Homepage picker: only pages published as sites on this domain can be the homepage. */
function openSitePagePicker(anchor: HTMLElement, space: SpaceRecord, sites: PublicPage[], onPick: (id: string) => void) {
  openMenu(anchor, {
    width: 300,
    maxHeight: 360,
    search: t('lp.settings.choose_a_page', 'Choose a page'),
    emptyText: sites.length ? t('lp.settings.no_sites_match', 'No sites match') : t('lp.settings.to_choose_a_homepage_first_publish', 'To choose a homepage, first publish a page on {domainName}', { domainName: `${space.domain}.litpage.site` }),
    sections: sites.length ? [{ items: sites.map((p) => { const label = titleOf(records.get<BlockRecord>('block', p.blockId)); return { label, text: label, icon: 'page', onSelect: () => onPick(p.blockId) }; }) }] : [],
  }, { placement: 'bottom-end' });
}

function DomainsGroup({ space, admin, sites }: { space: SpaceRecord; admin: boolean; sites: PublicPage[] }) {
  const homeId = spaceSetting<string | null>(space, 'public_home_page', null);
  const home = homeId ? records.get<BlockRecord>('block', homeId) : undefined;
  // a homepage is a paid-plan feature ("Upgrade to set a homepage")
  const canHome = admin && space.plan_type !== 'free';
  const pickHome = (anchor: HTMLElement) => openSitePagePicker(anchor, space, sites, (id) => saveSpaceSettings(space.id, { public_home_page: id }));
  const domainMenu = (anchor: HTMLElement) => openMenu(anchor, {
    width: 240,
    sections: [{
      items: [
        { label: t('lp.settings.change_the_domain_name', 'Change the domain name'), icon: 'pencilSmall', onSelect: () => { openSubDialog((close) => <DomainBody space={space} close={close} />); } },
        { label: t('lp.settings.change_homepage', 'Change homepage'), icon: 'page', disabled: !canHome, onSelect: () => { setTimeout(() => pickHome(anchor), 0); } },
        ...(homeId ? [{ label: t('lp.settings.remove_the_domain_homepage', 'Remove the domain homepage'), icon: 'xMarkSmall', onSelect: () => saveSpaceSettings(space.id, { public_home_page: null }) }] : []),
        { label: t('lp.settings.delete', 'Delete'), icon: 'trashSmall', disabled: true, description: t('lp.settings.the_workspace_s_default_domain_can', 'The workspace’s default domain can’t be deleted') },
      ],
    }],
  }, { placement: 'bottom-end' });
  return (
    <div className="nc-set-domains-block">
      <div className="nc-set-domains-head">
        <div>
          <div className="ttl">{t('lp.settings.domains', 'Domains')}</div>
          <div className="sub">{t('lp.settings.domains_where_your_litpage_sites_can', 'Domains where your Litpage sites can be published')}</div>
        </div>
        <span data-tooltip={t('lp.settings.this_workspace_can_have_only_litpage', 'This workspace can have only {maximumDomains} .litpage.site domains', { maximumDomains: 1 })}>
          <Button disabled>{t('lp.settings.new_domain', 'New domain')}</Button>
        </span>
      </div>
      <table className="nc-set-table nc-set-domains">
        <thead>
          <tr>
            <th style={{ width: '41%' }}>{t('lp.settings.domain', 'Domain')}</th>
            <th className="home" style={{ width: '35%' }}>{t('lp.settings.homepage', 'Homepage')}</th>
            <th style={{ width: '20%' }}>{t('lp.settings.status', 'Status')}</th>
            <th style={{ width: '4%' }} />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="primary"><a className="nc-set-domain-chip" href={`/site/${space.domain}`} target="_blank" rel="noreferrer" title={t('lp.settings.visit_site', 'Visit site')}>{space.domain}.litpage.site</a></td>
            <td>
              {home ? (
                <a className="nc-set-home-link" href="#" onClick={(e) => { e.preventDefault(); closeSettings(); openPage(home.id); }}>
                  {titleOf(home)} <Icon name="arrowDiagonalUpRightSmall" size={12} />
                </a>
              ) : (
                <span
                  role="button"
                  tabIndex={canHome ? 0 : -1}
                  aria-disabled={!canHome || undefined}
                  data-tooltip={!admin ? t('lp.settings.only_workspace_owners_can_configure_a', 'Only workspace owners can configure a domain homepage') : space.plan_type === 'free' ? t('lp.settings.upgrade_to_set_a_homepage', 'Upgrade to set a homepage') : undefined}
                  className="nc-set-home-picker"
                  onClick={(e) => canHome && pickHome(e.currentTarget as HTMLElement)}
                >
                  <Icon name="magnifyingGlassSmall" size={12} style={{ color: 'var(--lp-icon-secondary)', marginInlineEnd: 6 }} />
                  {t('lp.settings.choose_a_page', 'Choose a page')}
                </span>
              )}
            </td>
            <td><span className="nc-set-live-pill"><span className="dot" />{t('lp.settings.live', 'Live')}</span></td>
            <td>
              <span role="button" tabIndex={admin ? 0 : -1} aria-disabled={!admin || undefined} aria-haspopup="dialog" className="nc-set-icon-btn" aria-label={t('lp.settings.update', 'Update') + ' domain'} onClick={(e) => admin && domainMenu(e.currentTarget as HTMLElement)}>
                <Icon name="ellipsisSmall" size={16} />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DomainBody({ space, close }: { space: SpaceRecord; close: () => void }) {
  const [v, setV] = useState(space.domain);
  const [state, setState] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = v.trim().toLowerCase();
  useEffect(() => {
    if (d === space.domain) { setState(null); return; }
    const h = setTimeout(() => {
      void api<{ available: boolean; reason?: string }>('checkSpaceDomain', { domain: d, spaceId: space.id })
        .then((r) => setState({ ok: r.available, reason: r.reason }))
        .catch(() => setState(null));
    }, 250);
    return () => clearTimeout(h);
  }, [d, space.domain, space.id]);
  const save = async () => {
    setBusy(true);
    try {
      await spaceApi('setSpaceDomain', { spaceId: space.id, domain: d });
      close();
      useUI.getState().toast(t('lp.settings.domain_updated', 'Domain updated'));
    } catch (e: any) {
      setState({ ok: false, reason: e?.message });
      setBusy(false);
    }
  };
  const msgText = state && !state.ok
    ? state.reason === 'taken' ? t('lp.settings.this_domain_is_already_taken', 'This domain is already taken.')
      : state.reason === 'invalid' ? t('lp.settings.use_3_63_lowercase_letters_numbers', 'Use 3–63 lowercase letters, numbers or hyphens.')
        : state.reason
    : null;
  return (
    <>
      <h3>{t('lp.settings.change_the_domain_name', 'Change the domain name')}</h3>
      <div className="desc">{t('lp.settings.give_your_litpage_site_its_own', 'Give your Litpage site its own domain')}</div>
      <div className="nc-set-input nc-set-domain-input">
        <input autoFocus value={v} placeholder={t('lp.settings.yourdomain', 'yourdomain')} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && state?.ok) void save(); }} />
        <span className="suffix">.litpage.site</span>
      </div>
      {msgText && <div className="error">{msgText}</div>}
      {state?.ok && <div className="ok">{t('lp.settings.available', 'Available')}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy || !state?.ok} onClick={() => void save()}>{t('lp.settings.save', 'Save')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Developer

/** Access tokens issued by the server and listed or revoked here. */
interface PatInfo { id: string; name: string; prefix: string; userId: string; createdTime: number; lastUsedTime: number | null }

export function DeveloperSection() {
  const { space } = useSpaceAccess();
  const devOn = useDeveloperMode((s) => s.on);
  const [show, setShow] = useState(false);
  const [pats, setPats] = useState<PatInfo[] | null>(null);
  const load = () => {
    if (!space) return;
    api<{ tokens: PatInfo[] }>('mcpListTokens', { spaceId: space.id }).then((r) => setPats(r.tokens)).catch(() => setPats([]));
  };
  useEffect(load, [space?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const revoke = async (p: PatInfo) => {
    try {
      await api('mcpRevokeToken', { tokenId: p.id });
      useUI.getState().toast(t('lp.settings.token_revoked', 'Token revoked'));
      load();
    } catch (e) {
      useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
    }
  };
  return (
    <SectionPage
      title={t('lp.settings.developer', 'Developer')}
      subtitle={t('lp.settings.turn_on_developer_features_to_build', 'Turn on developer features to build Workers and connections')}
      headerExtra={(
        <a className="nc-set-dev-link" href={developersUrl()} onClick={(e) => { e.preventDefault(); useUI.getState().set({ settingsOpen: false }); openDevelopers(); }}>
          {t('lp.settings.open_the_developer_tools', 'Open the developer tools')}
          <Icon name="arrowDiagonalUpRightSmall" size={14} />
        </a>
      )}
    >
      <Group plain title={t('lp.settings.developer_ui', 'Developer UI')}>
        <Row
          id="developer-mode"
          label={t('lp.settings.turn_on_developer_features', 'Turn on developer features')}
          description={t('lp.settings.turn_on_the_developer_ui_including', 'Turn on the developer UI, including the toolbar, menu, and quick links to developer tools.')}
          control={<Switch label="Turn on developer tools" checked={devOn} onChange={(v) => useDeveloperMode.getState().setOn(v)} />}
        />
      </Group>
      <Group plain title={t('lp.settings.personal_access_tokens_pats', 'Access tokens (PATs)')}>
        <Row
          id="new-token"
          label={(
            <>
              {t('lp.settings.generate_your_own_api_access_token', 'Generate your own API access token')}
            </>
          )}
          description={rich(msg('lp.settings.create_a_personal_access_token_for', 'Create a personal access token for Litpage API requests. <manageTokens>Manage your tokens</manageTokens>.'), {}, {
            manageTokens: (c) => <a href="#" onClick={(e) => { e.preventDefault(); setShow(true); }}>{c}</a>,
          })}
          control={<Button disabled={!space} onClick={() => space && openSubDialog((close) => <NewTokenBody spaceId={space.id} close={close} onCreated={() => { load(); setShow(true); }} />)}>{t('lp.settings.new_token', 'New token')}</Button>}
        />
        {show && (
          pats?.length ? (
            <table className="nc-set-table" data-testid="pat-table">
              <thead>
                <tr>
                  <th>{t('lp.settings.name', 'Name')}</th>
                  <th>{t('lp.settings.created_accf', 'Created')}</th>
                  <th>{t('lp.settings.last_used_f110', 'Last used')}</th>
                  <th>{t('lp.settings.status', 'Status')}</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {pats.map((p) => (
                  <tr key={p.id}>
                    <td className="primary">{p.name || t('lp.settings.untitled_token', 'Untitled token')} <span className="mono">{p.prefix}…</span></td>
                    <td>{fmtDate(p.createdTime)}</td>
                    <td>{p.lastUsedTime ? fmtDate(p.lastUsedTime) : t('lp.settings.text_1b93', '—')}</td>
                    <td>{t('lp.settings.active', 'Active')}</td>
                    <td>
                      <Button small variant="ghost" onClick={() => void revoke(p)}>{t('lp.settings.revoke', 'Revoke')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="nc-set-empty">{t('lp.settings.you_haven_t_made_any_tokens', 'You haven’t made any tokens yet')}</div>
        )}
      </Group>
    </SectionPage>
  );
}

function NewTokenBody({ spaceId, close, onCreated }: { spaceId: string; close: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ token: string }>('mcpCreateToken', { spaceId, name: name.trim() || t('lp.settings.untitled_token', 'Untitled token') });
      setToken(r.token);
      onCreated();
    } catch (e: any) {
      setErr(e?.status === 403 ? t('lp.settings.creating_tokens_is_turned_off_a', 'Creating tokens is turned off. A workspace owner can turn it on for you.') : (e?.message ?? 'Error'));
    } finally {
      setBusy(false);
    }
  };
  return token ? (
    <>
      <h3>{t('lp.settings.token_created', 'Token created')}</h3>
      <div className="desc">{t('lp.settings.copy_this_token_now_it_won', 'Copy this token now — it won’t be shown again.')}</div>
      <div className="nc-set-input"><input readOnly aria-label={t('lp.settings.token_created', 'Token created')} value={token} onFocus={(e) => e.currentTarget.select()} /></div>
      <div className="actions">
        <Button variant="primary" icon="duplicate" onClick={() => { void navigator.clipboard?.writeText(token); useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete')); }}>{t('lp.settings.copy_token', 'Copy token')}</Button>
        <Button onClick={close}>{t('lp.settings.close', 'Close')}</Button>
      </div>
    </>
  ) : (
    <>
      <h3>{t('lp.settings.generate_your_own_api_access_token', 'Generate your own API access token')}</h3>
      <div>
        <label className="nc-set-label">{t('lp.settings.name', 'Name')}</label>
        <div className="nc-set-input"><input autoFocus aria-label={t('lp.settings.name', 'Name')} value={name} placeholder={t('lp.settings.untitled_token', 'Untitled token')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy} onClick={() => void create()}>{t('lp.settings.new_token', 'New token')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}
