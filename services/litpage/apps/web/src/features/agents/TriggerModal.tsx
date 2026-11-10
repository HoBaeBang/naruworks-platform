

// database, A comment is posted on a page, The agent is mentioned, A meeting note is summarized — each with its filters (database,
// view, watched properties, "Trigger when page content edited", "Wait for edits to finish", "Run only for") and
// optional instructions for runs of that trigger.
import { useEffect, useMemo, useState } from 'react';
import { newId } from '@nc/shared/ids.ts';
import { triggerTypeLabel, type AgentTrigger, type TriggerType } from '@nc/shared/agents.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, UserRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { openKeepMenu } from '../database/automations/keepMenu.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { records } from '../../lib/store/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { t } from '../shell/i18n.ts';
import { loadPage } from '../page/usePageLoader.ts';
import { openRecurrenceEditor } from '../database/automations/recurrence.tsx';
import { spaceMembers } from '../search/filterMenus.tsx';
import '../database/automations/automations.css';
import type { AgentDetail } from './agentsApi.ts';
import { openChecklist, openResourcePicker, ResourceIcon, Toggle } from './ui.tsx';

const NAV: { type: TriggerType; label: [string, string]; icon: string }[] = [
  { type: 'lit.page_created', label: ['workflow.agent.triggers.nav.lit.pageCreated', 'A page enters a database'], icon: 'agentPageAdd' },
  { type: 'lit.page_updated', label: ['workflow.agent.triggers.nav.lit.pageUpdated', 'A database property changes'], icon: 'agentPageEdit' },
  { type: 'lit.page_deleted', label: ['workflow.agent.triggers.nav.lit.pageDeleted', 'A page leaves a database'], icon: 'agentPageRemove' },
  { type: 'lit.comment_added', label: ['workflow.agent.triggers.nav.lit.commentAdded', 'A comment is posted on a page'], icon: 'agentComment' },
  { type: 'lit.agent_mentioned', label: ['workflow.agent.triggers.nav.lit.agentMentioned', 'The agent is mentioned'], icon: 'agentMention' },
  { type: 'lit.meeting_note_summarized', label: ['workflow.agent.triggers.nav.lit.meetingNoteSummaryCompleted', 'A meeting note is summarized'], icon: 'agentMeeting' },
];

const DB_TYPES: TriggerType[] = ['lit.page_created', 'lit.page_updated', 'lit.page_deleted', 'lit.meeting_note_summarized'];

function navLabel(type: TriggerType): string {
  if (type === 'recurrence') return t('lp.agents.on_a_schedule', 'On a schedule');
  const n = NAV.find((x) => x.type === type);
  return n ? t(...n.label) : triggerTypeLabel(type);
}


export function openTriggerModal(d: AgentDetail, anchor: HTMLElement, trigger: AgentTrigger | null, onSave: (t: AgentTrigger) => void, onDelete?: () => void) {
  if (trigger) {
    openEditor(d, anchor, trigger, false, onSave, onDelete);
    return;
  }
  const items = (types: typeof NAV): MenuItemDef[] => types.map((n) => ({
    label: t(...n.label),
    icon: n.icon,
    disabled: n.type === 'lit.agent_mentioned' && d.config.triggers.some((x) => x.type === 'lit.agent_mentioned'),
    onSelect: () => {
      setTimeout(() => openEditor(d, anchor, { id: newId(), type: n.type, enabled: true }, true, onSave), 0);
    },
  }));
  openMenu(anchor, {
    width: 280,
    sections: [
      {
        title: t('lp.agents.add_trigger', 'Add trigger'),
        items: [{
          label: t('lp.agents.on_a_schedule', 'On a schedule'),
          icon: 'agentSchedule',
          onSelect: () => {
            setTimeout(() => openEditor(d, anchor, { id: newId(), type: 'recurrence', enabled: true }, true, onSave), 0);
          },
        }],
      },
      { title: t('lp.agents.litpage', 'Litpage'), items: items(NAV) },
    ],
  }, { placement: 'bottom-start' });
}

function openEditor(d: AgentDetail, anchor: Anchor, tr: AgentTrigger, isNew: boolean, onSave: (t: AgentTrigger) => void, onDelete?: () => void) {
  if (tr.type === 'recurrence') {
    openRecurrenceEditor(anchor, {
      value: tr.recurrence ?? null,
      onSave: (r) => onSave({ ...tr, recurrence: r }),
      onDelete: isNew ? undefined : onDelete,
      deleteLabel: t('lp.agents.delete', 'Delete'),
    });
    return;
  }
  openOverlay((close) => <TriggerPane d={d} initial={tr} isNew={isNew} close={close} onSave={onSave} onDelete={onDelete} />, { anchor, placement: 'bottom-start', offset: 4 });
}

interface DbChoice { blockId: string; title: string; collectionId: string }

function dbFromTrigger(d: AgentDetail, tr: AgentTrigger): DbChoice | null {
  if (!tr.collection_id) return null;
  const target = d.triggerTargets[tr.id];
  const col = records.get<CollectionRecord>('collection', tr.collection_id);
  const blockId = target?.blockId ?? col?.parent_id;
  if (!blockId) return null;
  return { blockId, title: target?.title ?? (toPlainText(col?.name) || t('lp.agents.database', 'database')), collectionId: tr.collection_id };
}

function useDatabaseMeta(db: DbChoice | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    void loadPage(db.blockId).then(() => alive && setTick((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [db?.blockId]);
  if (!db) return { views: [] as CollectionViewRecord[], schema: {} as CollectionRecord['schema'] };
  const block = records.get<BlockRecord>('block', db.blockId);
  const views = (block?.view_ids ?? []).map((id) => records.get<CollectionViewRecord>('collection_view', id)).filter((v): v is CollectionViewRecord => !!v && v.alive !== false);
  const schema = records.get<CollectionRecord>('collection', db.collectionId)?.schema ?? {};
  return { views, schema };
}

function TriggerPane({ d, initial, isNew, close, onSave, onDelete }: { d: AgentDetail; initial: AgentTrigger; isNew: boolean; close: () => void; onSave: (t: AgentTrigger) => void; onDelete?: () => void }) {
  const [tr, setTr] = useState<AgentTrigger>(initial);
  const [db, setDb] = useState<DbChoice | null>(() => dbFromTrigger(d, initial));
  const [scope, setScope] = useState<{ blockId: string; title: string } | null>(() => (initial.page_id ? { blockId: initial.page_id, title: d.triggerTargets[initial.id]?.title ?? '' } : null));
  const { views, schema } = useDatabaseMeta(db);
  const set = (patch: Partial<AgentTrigger>) => setTr((x) => ({ ...x, ...patch }));
  const needsDb = DB_TYPES.includes(tr.type) && tr.type !== 'lit.meeting_note_summarized';
  const people = useMemo(() => spaceMembers(), []);
  const valid = !needsDb || !!tr.collection_id;
  const view = views.find((v) => v.id === tr.view_id);
  const propNames = (tr.properties ?? []).map((p) => schema[p]?.name).filter(Boolean) as string[];
  const save = () => {
    if (!valid) return;
    onSave({ ...tr, collection_id: db?.collectionId, page_id: tr.type === 'lit.comment_added' ? scope?.blockId : undefined });
    close();
  };
  const warning = !DB_TYPES.includes(tr.type) || !db ? null
    : tr.type === 'lit.page_created' && !tr.view_id ? t('lp.agents.runs_will_start_for_each_page', 'Runs will start for each page added to this database. Pick a view or property to avoid unnecessary runs.')
      : tr.type === 'lit.page_deleted' && !tr.view_id ? t('lp.agents.runs_will_start_for_each_page_96e6', 'Runs will start for each page removed from this database. Pick a view or property to avoid unnecessary runs.')
        : tr.type === 'lit.page_updated' && !tr.properties?.length && !tr.content_edited ? t('lp.agents.start_runs_when_properties_on_pages', 'Start runs when properties on pages in this database change. Pick properties to avoid unnecessary runs.')
          : tr.type === 'lit.meeting_note_summarized' && !tr.view_id ? t('lp.agents.start_runs_for_each_meeting_note', 'Start runs for each meeting note summarized in this database. Pick a view or property to avoid unnecessary runs.')
            : null;
  const viewMenu = (anchor: HTMLElement) => openKeepMenu(anchor, {
    width: 260,
    search: views.length > 6 ? t('lp.agents.search_views', 'Search views…') : undefined,
    emptyText: t('lp.agents.no_views_found', 'No views available'),
    sections: [{
      items: [
        { label: t('lp.agents.entire_database', 'Entire database'), icon: 'agentDatabase', checked: !tr.view_id, onSelect: () => set({ view_id: undefined }) },
        ...views.map((v) => ({ label: v.name || t('lp.agents.untitled_view', 'Untitled view'), icon: 'viewTable', checked: tr.view_id === v.id, onSelect: () => set({ view_id: v.id }) })),
      ],
    }],
  }, { placement: 'bottom-start' });
  const propMenu = (anchor: HTMLElement) => openChecklist(anchor, {
    items: Object.keys(schema).map((id) => ({ id, label: schema[id]!.name || id })),
    selected: tr.properties ?? [],
    allLabel: t('lp.agents.all_properties', 'All properties'),
    search: t('lp.agents.search_properties', 'Search properties…'),
    onChange: (ids) => set({ properties: ids }),
  });
  const userMenu = (anchor: HTMLElement) => openChecklist(anchor, {
    items: people.map((u: UserRecord) => ({ id: u.id, label: u.name || u.email, hint: u.name ? u.email : undefined })),
    selected: tr.user_filter ?? [],
    allLabel: t('lp.agents.anyone', 'Anyone'),
    search: t('lp.agents.search_people', 'Search people…'),
    onChange: (ids) => set({ user_filter: ids }),
  });
  const userLabel = !tr.user_filter?.length ? t('lp.agents.anyone', 'Anyone') : tr.user_filter.map((id) => records.get<UserRecord>('lit_user', id)?.name || '…').join(', ');
  return (
    <PopoverSurface width={380} maxHeight="80vh" className="nc-agent-trigger-pane">
      <div className="nc-agent-trigger" role="dialog" aria-label={navLabel(tr.type)} data-testid="agent-trigger-pane" data-trigger-type={tr.type}>
        <div className="nc-agent-trigger-title">{navLabel(tr.type)}</div>
        {DB_TYPES.includes(tr.type) && (
          <div className="nc-agent-field">
            <div className="nc-agent-field-label">{t('lp.agents.select_database', 'Select database')}</div>
            <div role="button" className="nc-agent-select" data-testid="agent-trigger-database" onClick={(e) => openResourcePicker(e.currentTarget, (r) => {
              if (!r.collectionId) return;
              setDb({ blockId: r.blockId, title: r.title, collectionId: r.collectionId });
              set({ collection_id: r.collectionId, view_id: undefined, properties: [] });
            }, 'database')}>
              {db ? <><ResourceIcon icon={null} database /><span className="nc-ellipsis">{db.title}</span></> : <span className="nc-agent-muted">{tr.type === 'lit.meeting_note_summarized' ? t('lp.agents.any_meeting_notes_database', 'Any meeting notes database') : t('lp.agents.select_database', 'Select database')}</span>}
              <Icon name="arrowChevronSingleDownSmall" size={12} />
            </div>
          </div>
        )}
        {db && tr.type !== 'lit.page_updated' && (
          <div className="nc-agent-field">
            <div className="nc-agent-field-label">{t('lp.agents.select_view', 'Select view')}</div>
            <div role="button" className="nc-agent-select" onClick={(e) => viewMenu(e.currentTarget)}>
              <span className="nc-ellipsis">{view ? view.name || t('lp.agents.untitled_view', 'Untitled view') : t('lp.agents.entire_database', 'Entire database')}</span>
              <Icon name="arrowChevronSingleDownSmall" size={12} />
            </div>
          </div>
        )}
        {db && tr.type === 'lit.page_updated' && (
          <>
            <div className="nc-agent-field">
              <div className="nc-agent-field-label">{t('lp.agents.select_properties', 'Select properties')}</div>
              <div role="button" className="nc-agent-select" data-testid="agent-trigger-properties" onClick={(e) => propMenu(e.currentTarget)}>
                <span className="nc-ellipsis">{propNames.length ? propNames.join(', ') : t('lp.agents.all_properties', 'All properties')}</span>
                <Icon name="arrowChevronSingleDownSmall" size={12} />
              </div>
            </div>
            <div className="nc-agent-field row">
              <span>{t('lp.agents.run_on_edits_to_page_content', 'Run on edits to page content')}</span>
              <Toggle label={t('lp.agents.run_on_edits_to_page_content', 'Run on edits to page content')} checked={!!tr.content_edited} onChange={(v) => set({ content_edited: v || undefined })} />
            </div>
          </>
        )}
        {tr.type === 'lit.comment_added' && (
          <div className="nc-agent-field">
            <div className="nc-agent-field-label">{t('lp.agents.page_or_database', 'Page or database')}</div>
            <div role="button" className="nc-agent-select" data-testid="agent-trigger-page" onClick={(e) => openKeepMenu(e.currentTarget, {
              width: 260,
              sections: [{
                items: [
                  { label: t('lp.agents.any_page_this_agent_can_access', 'Any page this agent can access'), checked: !scope, onSelect: () => setScope(null) },
                  { label: t('lp.agents.choose_a_page_or_database', 'Choose a page or database…'), icon: 'search', onSelect: () => { const el = e.currentTarget; setTimeout(() => openResourcePicker(el, (r) => setScope({ blockId: r.blockId, title: r.title })), 0); } },
                ],
              }],
            }, { placement: 'bottom-start' })}>
              <span className="nc-ellipsis">{scope ? scope.title : t('lp.agents.any_page_this_agent_can_access', 'Any page this agent can access')}</span>
              <Icon name="arrowChevronSingleDownSmall" size={12} />
            </div>
          </div>
        )}
        {tr.type === 'lit.agent_mentioned' && (
          <div className="nc-agent-field-help">{t('lp.agents.runs_when_someone_mentions_this_agent', 'Runs when someone @-mentions this agent on a page or in a comment it can access. The agent replies where it was mentioned.')}</div>
        )}
        {(tr.type === 'lit.page_created' || tr.type === 'lit.page_updated') && (
          <div className="nc-agent-field row">
            <span>{t('lp.agents.wait_until_edits_are_finished', 'Wait until edits are finished')}</span>
            <Toggle label={t('lp.agents.wait_until_edits_are_finished', 'Wait until edits are finished')} checked={tr.wait_for_edits !== false} onChange={(v) => set({ wait_for_edits: v ? undefined : false })} />
          </div>
        )}
        <div className="nc-agent-field">
          <div className="nc-agent-field-label">{t('lp.agents.run_only_when', 'Run only when')}</div>
          <div role="button" className="nc-agent-select" onClick={(e) => userMenu(e.currentTarget)}>
            <span className="nc-ellipsis">{userLabel}</span>
            <Icon name="arrowChevronSingleDownSmall" size={12} />
          </div>
        </div>
        <div className="nc-agent-field">
          <div className="nc-agent-field-label">{t('lp.agents.instructions_for_this_trigger_optional', 'Instructions for this trigger (optional)')}</div>
          <textarea className="nc-agent-textarea" rows={3} value={tr.instructions ?? ''} placeholder={t('lp.agents.e_g_only_reply_when_the', 'e.g. Only reply when the comment asks a question')} onChange={(e) => set({ instructions: e.target.value || undefined })} />
        </div>
        {warning && <div className="nc-agent-field-warn"><Icon name="agentAlert" size={14} /><span>{warning}</span></div>}
        {!valid && <div className="nc-agent-field-help">{t('lp.agents.pick_which_view_or_property_this', 'Pick which view or property this trigger watches. Any page added and Any page removed can start runs too.')}</div>}
        <div className="nc-agent-trigger-foot">
          {!isNew && onDelete ? <button type="button" className="nc-btn outline" onClick={() => { onDelete(); close(); }}>{t('lp.agents.delete', 'Delete')}</button> : <span />}
          <button type="button" className="nc-btn primary" data-testid="agent-trigger-save" disabled={!valid} onClick={save}>{isNew ? t('lp.agents.add_trigger', 'Add trigger') : t('lp.agents.save', 'Save')}</button>
        </div>
      </div>
    </PopoverSurface>
  );
}
