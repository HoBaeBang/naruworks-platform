// Automation builder modal, 500x600 at the top of the page: name, scope, triggers, steps, and footer actions.
// top 88): name ("{creator}’s automation" placeholder), "For every entry in ‹data source›" scope, When
// (triggers), Do (steps), footer Cancel / Enable (new: disabled until valid, "Resolve errors to enable") or Delete /
// Active / Save (existing). The same shell edits a database button property (/021: "Enter a name",
// "Button is clicked", full-width Save).
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, UserRecord } from '@nc/shared/records.ts';
import { combinedFilter, countActive } from '@nc/shared/database/index.ts';
import {
  automationCaption, buttonPropertySteps, defaultAutomationName, validateAutomation, type AutomationAction, type AutomationRecord, type AutomationTrigger,
} from '@nc/shared/automation/index.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { useRecord, useTableVersion } from '../../../lib/hooks.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { Toggle } from '../properties/editors/DatePicker.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { updateProperty } from '../actions.ts';
import { openKeepMenu } from './keepMenu.ts';
import { viewIcon } from '../chrome/ViewTabs.tsx';
import { collectionName, deleteAutomation, loadAutomations, saveAutomation, useAutomations } from './api.ts';
import { StepList } from './steps.tsx';
import { ButtonTriggerSection, TriggerSection } from './triggers.tsx';
import './automations.css';

function lookups(collectionId: string, surface: 'automation' | 'button_property', webhooksAllowed: boolean) {
  return {
    surface,
    collectionId,
    schema: records.get<CollectionRecord>('collection', collectionId)?.schema,
    collection: (id: string) => records.get<CollectionRecord>('collection', id),
    block: (id: string) => records.get<BlockRecord>('block', id),
    webhooksAllowed,
  };
}

function viewsOf(collectionId: string): CollectionViewRecord[] {
  const col = records.get<CollectionRecord>('collection', collectionId);
  const host = col ? records.get<BlockRecord>('block', col.parent_id) : undefined;
  return (host?.view_ids ?? []).map((id) => records.get<CollectionViewRecord>('collection_view', id)).filter((v): v is CollectionViewRecord => !!v && v.alive !== false);
}

interface Draft {
  name: string;
  scope: AutomationRecord['scope'];
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  status: 'active' | 'paused';
}

function draftOf(a: AutomationRecord | undefined): Draft {
  if (!a) return { name: '', scope: { type: 'collection' }, trigger: { type: 'event', mode: 'any', events: [] }, actions: [], status: 'active' };
  return { name: a.properties?.name ?? '', scope: a.scope ?? { type: 'collection' }, trigger: structuredClone(a.trigger), actions: structuredClone(a.actions), status: a.status === 'paused' ? 'paused' : 'active' };
}

type BuilderState = { dirty: boolean; save?: () => void; draft?: Draft };

function AutomationBuilder({ collectionId, automationId, close, state, initial }: { collectionId: string; automationId?: string; close: () => void; state: BuilderState; initial?: Draft }) {
  useTableVersion(['collection', 'collection_view']);
  const existing = useRecord<AutomationRecord>('automation', automationId);
  const { access } = useAutomations(collectionId);
  const col = records.get<CollectionRecord>('collection', collectionId);
  const me = records.get<UserRecord>('lit_user', useSession.getState().userId);
  const [draft, setDraft] = useState<Draft>(() => initial ?? draftOf(existing));
  const [original] = useState(() => JSON.stringify(draftOf(existing)));
  const [saving, setSaving] = useState(false);
  const readOnly = !!access && !access.canEdit;
  const issues = useMemo(() => validateAutomation(draft.trigger, draft.actions, lookups(collectionId, 'automation', access?.webhooksAllowed ?? true)), [draft, collectionId, access?.webhooksAllowed]);
  const dirty = JSON.stringify(draft) !== original;
  state.dirty = dirty && !readOnly;
  state.draft = draft;
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const placeholder = existing ? defaultAutomationName(records.get<UserRecord>('lit_user', existing.created_by_id)?.name) : defaultAutomationName(me?.name);
  const scopeView = draft.scope?.type === 'view' ? records.get<CollectionViewRecord>('collection_view', draft.scope.view_id) : undefined;
  const noTriggerPage = draft.trigger.type === 'recurrence';
  const valid = issues.length === 0;
  const save = async () => {
    if (saving || readOnly) return;
    if (draft.status === 'active' && !valid) return;
    setSaving(true);
    try {
      await saveAutomation(collectionId, { id: existing?.id, name: draft.name.trim(), scope: draft.scope, trigger: draft.trigger, actions: draft.actions, status: draft.status });
      const name = draft.name.trim() || placeholder;
      useUI.getState().toast(existing ? `${name} updated` : `${name} created`);
      state.dirty = false;
      close();
    } catch (e) {
      useUI.getState().toast((e as Error)?.message || 'We couldn’t save those workflow changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };
  state.save = save;
  useEffect(() => {
    void loadAutomations(collectionId);
  }, [collectionId]);
  const pausedReason = existing?.status === 'paused' && existing.last_error ? existing.last_error.message : null;
  const scopeMenu = (anchor: HTMLElement) => openKeepMenu(anchor, {
    width: 300,
    sections: [
      { items: [{ id: 'all', label: collectionName(col), icon: 'collection', description: 'Whole dataset', checked: draft.scope?.type !== 'view', onSelect: () => update({ scope: { type: 'collection' } }) }] },
      { title: 'Views', items: viewsOf(collectionId).filter((v) => !['form', 'dashboard', 'chart'].includes(v.type)).map((v) => {
        const n = countActive(combinedFilter(v) ?? null, col?.schema);
        return { id: v.id, label: v.name || 'Untitled view', icon: viewIcon(v.type), description: n ? `${n} ${n === 1 ? 'filter' : 'filters'}` : 'Every entry in this layout', checked: draft.scope?.type === 'view' && draft.scope.view_id === v.id, onSelect: () => update({ scope: { type: 'view', view_id: v.id } }) };
      }) },
    ],
  }, { placement: 'bottom-start', parent: overlayIdOf(anchor), backdrop: 'transparent' });
  return (
    <div className="nc-auto-dialog" role="dialog" aria-modal="true" aria-label={existing ? 'Edit automation' : 'Create automation'}>
      <div className="lit-automation-builder-modal">
        <div className="nc-auto-close" role="button" aria-label="Close" onClick={close}><Icon name="xMarkSmall" size={14} /></div>
        <div className="nc-auto-head">
          <div className="nc-auto-name-row" data-menu-keys="ignore">
            <input className="nc-auto-name" aria-label="Automation name" placeholder={placeholder} value={draft.name} readOnly={readOnly} onChange={(e) => update({ name: e.target.value })} />
          </div>
          <div className="nc-auto-scope">
            <span>{draft.scope?.type === 'view' ? 'For entries in' : 'For every entry in'}</span>
            <span role="button" className={`nc-auto-scope-btn ${readOnly ? 'static' : ''}`} aria-haspopup="dialog" onClick={(e) => !readOnly && scopeMenu(e.currentTarget)}>
              {scopeView && <Icon name={viewIcon(scopeView.type)} size={16} />}
              <span>{scopeView ? scopeView.name || 'Untitled view' : collectionName(col)}</span>
              {!readOnly && <Icon name="arrowChevronSingleDownSmall" size={14} />}
            </span>
          </div>
          {readOnly && access?.editProblem && <div className="nc-auto-banner info"><Icon name="lock" size={14} /><span>{access.editProblem}</span></div>}
          {!readOnly && pausedReason && <div className="nc-auto-banner error"><Icon name="warning" size={14} /><span>{pausedReason}. Fix any errors or remove failing steps to enable this automation.</span></div>}
        </div>
        <div className="nc-auto-body">
          <div className="nc-auto-flow">
            <TriggerSection collectionId={collectionId} trigger={draft.trigger} onChange={(trigger) => update({ trigger, actions: trigger.type === 'recurrence' ? draft.actions.filter((a) => a.type !== 'edit_property') : draft.actions })} readOnly={readOnly} issues={issues} />
            <div className="nc-auto-connector" />
            <section className="nc-auto-section">
              <header className="nc-auto-section-head"><span>Do</span></header>
              <StepList surface="automation" collectionId={collectionId} steps={draft.actions} onChange={(actions) => update({ actions })} issues={issues} readOnly={readOnly} noTriggerPage={noTriggerPage} webhooksAllowed={access?.webhooksAllowed} />
            </section>
          </div>
        </div>
        <div className="nc-auto-foot">
          {existing ? (
            <span role="button" className="nc-btn outline" aria-disabled={readOnly} onClick={async () => {
              if (readOnly) return;
              if (!(await confirmDialog({ message: 'Delete this automation?', confirmLabel: 'Delete' }))) return;
              await deleteAutomation(existing.id);
              state.dirty = false;
              close();
            }}>Delete</span>
          ) : <span role="button" className="nc-btn outline" onClick={close}>Cancel</span>}
          <div className="nc-auto-foot-right">
            {!valid && draft.status === 'active' && !readOnly && (draft.actions.length > 0 || (draft.trigger.type === 'event' ? draft.trigger.events.length > 0 : true)) && <span className="nc-auto-error-caption">Resolve errors to enable</span>}
            {existing && !readOnly && (
              <label className="nc-auto-active">
                <span>Active</span>
                <Toggle on={draft.status === 'active'} onChange={(v) => update({ status: v ? 'active' : 'paused' })} />
              </label>
            )}
            <span
              role="button"
              aria-disabled={readOnly || saving || (draft.status === 'active' && !valid) || (!!existing && !dirty)}
              className={`nc-btn primary ${readOnly || saving || (draft.status === 'active' && !valid) || (!!existing && !dirty) ? 'disabled' : ''}`}
              onClick={() => void save()}
            >
              {existing ? 'Save' : 'Enable'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function modalAnchor() {
  return new DOMRect(Math.max(12, (window.innerWidth - 500) / 2), Math.min(88, Math.max(12, (window.innerHeight - 600) / 2)), 0, 0);
}

/** Open the builder for a new (or an existing) automation of a data source. */
export function openAutomationBuilder(collectionId: string, automationId?: string, initial?: Draft) {
  const state: BuilderState = { dirty: false };
  let closeFn: () => void = () => {};
  let closingOnPurpose = false;
  const guardedClose = async () => {
    if (state.dirty && !(await confirmDialog({ message: 'Discard the unsaved workflow edits?', confirmLabel: 'Discard' }))) return;
    closingOnPurpose = true;
    closeFn();
  };
  closeFn = openOverlay(() => <AutomationBuilder collectionId={collectionId} automationId={automationId} close={() => void guardedClose()} state={state} initial={initial} />, {
    anchor: modalAnchor(), placement: 'bottom-start', offset: 0, backdrop: 'dim', closeOnEscape: true,
    onClose: () => {
      // Escape / click outside with unsaved edits: confirm, and bring the draft back when the user keeps editing
      if (closingOnPurpose || !state.dirty || !state.draft) return;
      const draft = state.draft;
      void confirmDialog({ message: 'Discard the unsaved workflow edits?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }).then((discard) => {
        if (!discard) openAutomationBuilder(collectionId, automationId, draft);
      });
    },
  });
  return closeFn;
}

// ------------------------------------------------------------------ button property

function ButtonPropertyBuilder({ collectionId, propId, close, state }: { collectionId: string; propId: string; close: () => void; state: { dirty: boolean } }) {
  useTableVersion(['collection']);
  const col = records.get<CollectionRecord>('collection', collectionId);
  const prop = col?.schema[propId];
  const [label, setLabel] = useState(String((prop as any)?.button_label ?? prop?.name ?? ''));
  const [steps, setSteps] = useState<AutomationAction[]>(() => structuredClone(buttonPropertySteps(prop, col?.schema)));
  const [original] = useState(() => JSON.stringify({ label: String((prop as any)?.button_label ?? prop?.name ?? ''), steps: buttonPropertySteps(prop, col?.schema) }));
  const { access } = useAutomations(collectionId);
  const issues = useMemo(() => validateAutomation({ type: 'button' }, steps, lookups(collectionId, 'button_property', access?.webhooksAllowed ?? true)).filter((i) => i.message !== 'This button has no actions'), [steps, collectionId, access?.webhooksAllowed]);
  state.dirty = JSON.stringify({ label, steps }) !== original;
  if (!col || !prop) return null;
  const save = () => {
    if (issues.length) return;
    updateProperty(collectionId, propId, { button_label: label.trim() || undefined, button_automation: { trigger: 'button_clicked', v: 2, actions: steps }, button_actions: undefined } as any, 'saveButtonAutomation');
    state.dirty = false;
    close();
  };
  return (
    <div className="nc-auto-dialog" role="dialog" aria-modal="true" aria-label="Edit automation">
      <div className="lit-automation-builder-modal">
        <div className="nc-auto-close" role="button" aria-label="Close" onClick={close}><Icon name="xMarkSmall" size={14} /></div>
        <div className="nc-auto-head">
          <div className="nc-auto-name-row" data-menu-keys="ignore">
            <input className="nc-auto-name" aria-label="Button name" placeholder="Enter a name" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>
        <div className="nc-auto-body">
          <div className="nc-auto-flow">
            <ButtonTriggerSection />
            <div className="nc-auto-connector" />
            <section className="nc-auto-section">
              <header className="nc-auto-section-head"><span>Do</span></header>
              <StepList surface="button_property" collectionId={collectionId} steps={steps} onChange={setSteps} issues={issues} webhooksAllowed={access?.webhooksAllowed} />
            </section>
          </div>
        </div>
        <div className="nc-auto-foot">
          <span role="button" aria-disabled={issues.length > 0} className={`nc-btn primary full ${issues.length ? 'disabled' : ''}`} onClick={save}>Save</span>
        </div>
      </div>
    </div>
  );
}

export function openButtonPropertyBuilder(collectionId: string, propId: string) {
  const state = { dirty: false };
  let closeFn: () => void = () => {};
  const guardedClose = async () => {
    if (state.dirty && !(await confirmDialog({ message: 'Discard the unsaved workflow edits?', confirmLabel: 'Discard' }))) return;
    state.dirty = false;
    closeFn();
  };
  closeFn = openOverlay(() => <ButtonPropertyBuilder collectionId={collectionId} propId={propId} close={() => void guardedClose()} state={state} />, { anchor: modalAnchor(), placement: 'bottom-start', offset: 0, backdrop: 'dim' });
  return closeFn;
}

export { automationCaption };
