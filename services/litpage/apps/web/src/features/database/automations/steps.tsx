import { HELP_URL } from '@nc/shared/brand.ts';
// Step cards of automations, button blocks and button properties ("Do" section): action menu per surface
//, one card per step with its
// editors, the step "•••" menu: Duplicate, Move up / down, Create action above / below,
// Delete, Learn about, drag to reorder, and inline error banners.
import { useEffect, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { FILTER_OPERATOR_LABELS, defaultFilterOperator, filterOperatorsFor, propertyTypeMeta, type FilterGroup, type PropertyFilterLeaf } from '@nc/shared/database/index.ts';
import {
  ACTION_META, ACTION_ORDER, LIMITS, WEBHOOK_SECRET_MASK, contextLabel, type ActionType, type AutomationAction, type PeekTarget, type PropertyEdit, type ValidationIssue,
  type ValueRef,
} from '@nc/shared/automation/index.ts';
import { newId } from '@nc/shared/ids.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { api } from '../../../lib/api.ts';
import { useTableVersion } from '../../../lib/hooks.ts';
import { Icon } from '../../../components/Icon.tsx';
import type { MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { UserAvatar } from '../../presence/Avatar.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { FilterValueEditor, chipLabel } from '../chrome/FilterBar.tsx';
import { workspaceMembers } from '../properties/editors/MiscEditors.tsx';
import { openKeepMenu } from './keepMenu.ts';
import { collectionName } from './api.ts';
import {
  RefsField, ValueChips, ctxSurface, defaultEditFor, earlierOutputs, editSentence, editablePropsOf, openValuePicker, refLabel, type EditorCtx, type Surface,
} from './valueRefs.tsx';
import { openAutomationFormula } from './formulaField.tsx';

export interface StepListProps {
  surface: Surface;
  collectionId?: string;
  /** button block whose steps these are (formula assistant, insert blocks) */
  blockId?: string;
  steps: AutomationAction[];
  onChange: (steps: AutomationAction[]) => void;
  issues?: ValidationIssue[];
  readOnly?: boolean;
  /** recurrence trigger: Edit property is not available */
  noTriggerPage?: boolean;
  webhooksAllowed?: boolean;
  /** Insert blocks editor (the button block renders its own children inline) */
  renderInsertBlocks?: (step: Extract<AutomationAction, { type: 'insert_blocks' }>) => ReactNode;
}

// ------------------------------------------------------------------ new steps

export function newStep(type: ActionType, opts: { collectionId?: string; propId?: string; prop?: PropertySchema } = {}): AutomationAction {
  const id = newId();
  switch (type) {
    case 'edit_property': return { id, type, edits: opts.propId && opts.prop ? [defaultEditFor(opts.propId, opts.prop)] : [] };
    case 'add_page': return { id, type, collection_id: undefined, template_id: null, edits: [] };
    case 'edit_pages': return { id, type, collection_id: undefined, filter: null, edits: [] };
    case 'notify': return { id, type, target: { type: 'users', user_ids: [] }, message: [] };
    case 'webhook': return { id, type, url: '', headers: [], properties: 'all' };
    case 'define_variables': return { id, type, variables: [{ id: newId(), name: 'Variable 1', formula: '' }] };
    case 'confirm': return { id, type, message: '' };
    case 'open': return { id, type, target: null, peek: 'side_peek' };
    case 'insert_blocks': return { id, type, position: 'below' };
    case 'agent': return { id, type, message: '' };
    default: return { id, type: type as 'mail' | 'slack' };
  }
}

/** The action menu ("New action" / "Create another step"). */
export function openActionMenu(anchor: HTMLElement, props: { surface: Surface; collectionId?: string; noTriggerPage?: boolean; webhooksAllowed?: boolean; steps: AutomationAction[]; onPick: (s: AutomationAction) => void }) {
  const items: MenuItemDef[] = [];
  for (const type of ACTION_ORDER[props.surface]) {
    const meta = ACTION_META[type];
    if (type === 'edit_property') {
      if (props.noTriggerPage) continue;
      const editable = editablePropsOf(props.collectionId);
      items.push({
        id: type, label: meta.label, icon: meta.icon,
        submenu: () => ({ width: 240, search: 'Search properties…', sections: [{ items: editable.map(([pid, p]) => ({ id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => props.onPick(newStep('edit_property', { propId: pid, prop: p })) })) }] }),
      });
      continue;
    }
    const webhookCount = props.steps.filter((s) => s.type === 'webhook').length;
    const disabled = type === 'mail' || type === 'slack' || (type === 'webhook' && (props.webhooksAllowed === false || webhookCount >= LIMITS.webhookActions));
    items.push({
      id: type, label: meta.label, icon: meta.icon, badge: type === 'mail' ? 'New' : undefined, disabled,
      description: type === 'mail' ? 'Connect a Gmail account to send mail' : type === 'slack' ? 'Connect Slack to use this action' : type === 'webhook' && props.webhooksAllowed === false ? 'This feature is disabled in your workspace' : type === 'webhook' && webhookCount >= LIMITS.webhookActions ? `Up to ${LIMITS.webhookActions} webhook actions` : undefined,
      onSelect: () => props.onPick(newStep(type, { collectionId: props.collectionId })),
    });
  }
  return openKeepMenu(anchor, { width: 266, search: 'Search actions…', emptyText: 'No results', sections: [{ items }] }, { placement: 'bottom-start', offset: 0, parent: overlayIdOf(anchor), backdrop: 'transparent' });
}

// ------------------------------------------------------------------ shared pickers

function Pill({ children, onClick, placeholder, title, disabled }: { children: ReactNode; onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void; placeholder?: boolean; title?: string; disabled?: boolean }) {
  return (
    <span role="button" aria-label={title} className={`nc-auto-pill ${placeholder ? 'placeholder' : ''} ${disabled ? 'static' : ''}`} onClick={disabled ? undefined : onClick}>
      {children}
      {!disabled && <Icon name="arrowChevronSingleDownSmall" size={14} />}
    </span>
  );
}

function useDataSources() {
  useTableVersion(['collection']);
  return records.all<CollectionRecord>('collection').filter((c) => c.alive !== false && (c as any).parent_id && records.get<BlockRecord>('block', c.parent_id)?.alive !== false);
}

/** Data source picker (Add page to / Edit pages in): loaded databases + a server search. */
export function openDataSourcePicker(anchor: HTMLElement, opts: { current?: string; extra?: MenuItemDef[]; onPick: (collectionId: string) => void }) {
  const spaceId = useSession.getState().spaceId;
  const show = (cols: CollectionRecord[]) => openKeepMenu(anchor, {
    width: 300, search: 'Search for a data source…', emptyText: 'No results',
    sections: [
      ...(opts.extra?.length ? [{ title: 'From this workflow', items: opts.extra }] : []),
      { title: 'Data sources', items: cols.map((c) => ({ id: c.id, label: collectionName(c), text: collectionName(c), icon: <PageIcon block={records.get<BlockRecord>('block', c.parent_id)} size={18} />, checked: c.id === opts.current, onSelect: () => opts.onPick(c.id) })) },
    ],
  }, { placement: 'bottom-start', parent: overlayIdOf(anchor), backdrop: 'transparent' });
  api<{ results: { collectionId: string }[]; recordMap: any }>('searchDataSources', { spaceId, limit: 100 }).then((res) => {
    records.mergeRecordMap(res.recordMap);
    const ids = new Set(res.results.map((r) => r.collectionId));
    const cols = records.all<CollectionRecord>('collection').filter((c) => ids.has(c.id) || c.id === opts.current);
    show(cols);
  }).catch(() => {
    show(records.all<CollectionRecord>('collection').filter((c) => c.alive !== false));
  });
}

function DataSourcePill({ collectionId, onPick, readOnly, extra, label }: { collectionId?: string; onPick: (id: string) => void; readOnly?: boolean; extra?: MenuItemDef[]; label?: string }) {
  useDataSources();
  const col = collectionId ? records.get<CollectionRecord>('collection', collectionId) : undefined;
  return (
    <Pill title="Choose a dataset" placeholder={!col && !label} disabled={readOnly} onClick={(e) => openDataSourcePicker(e.currentTarget, { current: collectionId, extra, onPick })}>
      {col ? <PageIcon block={records.get<BlockRecord>('block', col.parent_id)} size={16} /> : null}
      <span>{label ?? (col ? collectionName(col) : 'Choose a dataset')}</span>
    </Pill>
  );
}

// ------------------------------------------------------------------ property edits

function EditRows({ c, collectionId, edits, onChange, readOnly, addLabel }: { c: EditorCtx; collectionId?: string; edits: PropertyEdit[]; onChange: (e: PropertyEdit[]) => void; readOnly?: boolean; addLabel?: string }) {
  useTableVersion(['collection']);
  const col = records.get<CollectionRecord>('collection', collectionId);
  const schema = col?.schema ?? {};
  const set = (i: number, e: PropertyEdit) => onChange(edits.map((x, j) => (j === i ? e : x)));
  const editable = editablePropsOf(collectionId).filter(([pid]) => !edits.some((e) => e.property === pid));
  return (
    <>
      {edits.map((e, i) => {
        const prop = schema[e.property];
        const s = editSentence(prop, e, c);
        const textual = prop && ['title', 'text', 'url', 'email', 'phone_number', 'number'].includes(prop.type) && e.op === 'set';
        return (
          <div key={`${e.property}-${i}`} className="nc-auto-row">
            <div className="nc-auto-row-label">{prop ? <PropertyIcon prop={prop} size={16} /> : <Icon name="warning" size={16} />}<span>{prop?.name ?? 'Deleted property'}</span></div>
            <div className="nc-auto-row-value">
              {textual ? (
                <RefsField c={c} value={e.values} onChange={(v) => set(i, { ...e, values: v })} placeholder={prop.type === 'title' ? 'Untitled' : prop.type === 'number' ? 'Number' : 'Empty'} ariaLabel={`${prop.name} value`} multiline={prop.type === 'text'} />
              ) : (
                <span role="button" className="nc-auto-pill" style={{ height: 'auto', minHeight: 24, flexWrap: 'wrap', whiteSpace: 'normal' }} onClick={(ev) => !readOnly && prop && collectionId && openValuePicker(ev.currentTarget, { c, prop, collectionId, edit: e, onChange: (next) => set(i, next) })}>
                  <span style={{ color: 'var(--lp-text-secondary)' }}>{s.before}</span>
                  {s.values.length || (e.op !== 'clear' && !(e.op === 'toggle' && prop?.type === 'checkbox')) ? <ValueChips values={s.values} c={c} prop={prop} /> : null}
                  {s.after && <span style={{ color: 'var(--lp-text-secondary)' }}>{s.after}</span>}
                </span>
              )}
            </div>
            {!readOnly && <span role="button" className="nc-auto-icon-btn nc-auto-row-remove" aria-label="Remove" data-tooltip="Remove" onClick={() => onChange(edits.filter((_, j) => j !== i))}><Icon name="xMarkSmall" size={14} /></span>}
          </div>
        );
      })}
      {!readOnly && collectionId && editable.length > 0 && (
        <span role="button" className="nc-auto-link" onClick={(ev) => openKeepMenu(ev.currentTarget, {
          width: 240, search: 'Search properties…',
          sections: [{ items: editable.map(([pid, p]) => ({ id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => onChange([...edits, defaultEditFor(pid, p)]) })) }],
        }, { placement: 'bottom-start', parent: overlayIdOf(ev.currentTarget), backdrop: 'transparent' })}>
          <Icon name="plusSmall" size={16} />{addLabel ?? (edits.length ? 'Edit another property' : 'Edit a property')}
        </span>
      )}
    </>
  );
}

// ------------------------------------------------------------------ filter (Edit pages in)

function filterLeaves(f: FilterGroup | null | undefined): PropertyFilterLeaf[] {
  return ((f?.filters ?? []) as PropertyFilterLeaf[]).filter((x) => (x as PropertyFilterLeaf).property);
}

function FilterEditor({ collectionId, filter, onChange }: { collectionId: string; filter: FilterGroup | null | undefined; onChange: (f: FilterGroup | null) => void }) {
  useTableVersion(['collection']);
  const col = records.get<CollectionRecord>('collection', collectionId);
  const schema = col?.schema ?? {};
  const [leaves, setLeaves] = useState<PropertyFilterLeaf[]>(() => filterLeaves(filter));
  const [mode, setMode] = useState<'and' | 'or'>(filter?.operator === 'or' ? 'or' : 'and');
  const commit = (next: PropertyFilterLeaf[], m = mode) => { setLeaves(next); onChange(next.length ? { operator: m, filters: next } : null); };
  const props = Object.entries(schema).filter(([, p]) => propertyTypeMeta(p.type).filterValueType !== null && p.type !== 'button');
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, width: 360 }} data-menu-keys="ignore">
      {!leaves.length && <div className="nc-auto-hint" style={{ padding: '2px 4px' }}>No filters. Every page in {collectionName(col)} is edited.</div>}
      {leaves.map((leaf, i) => {
        const prop = schema[leaf.property];
        const ops = filterOperatorsFor(prop);
        const label = chipLabel(leaf, prop);
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="nc-auto-header-row">
              <span className="nc-auto-hint" style={{ width: 34 }}>{i === 0 ? 'Where' : <span role="button" className="nc-auto-mode-btn" onClick={() => { const m = mode === 'and' ? 'or' : 'and'; setMode(m); commit(leaves, m); }}>{mode === 'and' ? 'And' : 'Or'}</span>}</span>
              <Pill onClick={(e) => openKeepMenu(e.currentTarget, { width: 220, search: 'Search properties…', sections: [{ items: props.map(([pid, p]) => ({ id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => commit(leaves.map((x, j) => (j === i ? { property: pid, filter: { operator: defaultFilterOperator(p) } } : x))) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                {prop && <PropertyIcon prop={prop} size={14} />}<span>{prop?.name ?? 'Property'}</span>
              </Pill>
              <Pill onClick={(e) => openKeepMenu(e.currentTarget, { width: 200, sections: [{ items: ops.map((o) => ({ id: o, label: FILTER_OPERATOR_LABELS[o] ?? o, checked: o === leaf.filter.operator, onSelect: () => commit(leaves.map((x, j) => (j === i ? { ...x, filter: { ...x.filter, operator: o, ...(o === 'is_empty' || o === 'is_not_empty' ? { value: undefined } : {}) } } : x))) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                <span>{(FILTER_OPERATOR_LABELS[leaf.filter.operator] ?? leaf.filter.operator).toLowerCase()}</span>
              </Pill>
              <span role="button" className="nc-auto-pill" onClick={() => setOpen(open === i ? null : i)}><span>{label.rest && label.active ? label.rest : 'Value'}</span></span>
              <span role="button" className="nc-auto-icon-btn" aria-label="Delete filter" data-tooltip="Delete filter" onClick={() => commit(leaves.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></span>
            </div>
            {open === i && prop && <div style={{ border: '1px solid var(--lp-border-secondary)', borderRadius: 8 }}><FilterValueEditor leaf={leaf} prop={prop} onChange={(l) => commit(leaves.map((x, j) => (j === i ? l : x)))} /></div>}
          </div>
        );
      })}
      <span role="button" className="nc-auto-link" onClick={(e) => openKeepMenu(e.currentTarget, { width: 220, search: 'Search properties…', sections: [{ items: props.map(([pid, p]) => ({ id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => { commit([...leaves, { property: pid, filter: { operator: defaultFilterOperator(p) } }]); setOpen(leaves.length); } })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
        <Icon name="plusSmall" size={16} />Add filter rule
      </span>
    </div>
  );
}

function openFilterEditor(anchor: HTMLElement, opts: { collectionId: string; filter: FilterGroup | null | undefined; onChange: (f: FilterGroup | null) => void }) {
  return openOverlay(() => <PopoverSurface width="auto" maxHeight="60vh"><FilterEditor {...opts} /></PopoverSurface>, { anchor, placement: 'bottom-start', offset: 4, parent: overlayIdOf(anchor) });
}

// ------------------------------------------------------------------ open page target

function OpenTargetPicker({ c, current, onChange, close }: { c: EditorCtx; current: Extract<AutomationAction, { type: 'open' }>; onChange: (s: AutomationAction) => void; close: () => void }) {
  const spaceId = useSession((st) => st.spaceId);
  const [q, setQ] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const query = q.trim();
  const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(query) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(query);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = query && !isUrl ? await api('searchWorkspace', { query, spaceId, limit: 10 }) : await api('listRecentPages', { spaceId, limit: 8 });
        if (!alive) return;
        records.mergeRecordMap(res.recordMap);
        setIds((query && !isUrl ? res.results.map((r: any) => r.id) : res.pages.map((p: any) => p.id)).slice(0, 8));
      } catch { /* offline */ }
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [query, isUrl, spaceId]);
  const pick = (target: Extract<AutomationAction, { type: 'open' }>['target']) => { onChange({ ...current, target }); close(); };
  const out = earlierOutputs(c).pages;
  const firstStep = c.stepIndex === 0;
  const urlAllowed = c.surface !== 'automation' || firstStep;
  const match = (label: string) => !query || label.toLowerCase().includes(query.toLowerCase());
  return (
    <PopoverSurface width={300} className="nc-auto-pop" maxHeight="50vh">
      <div className="nc-auto-pop-search" style={{ paddingTop: 8 }} data-menu-keys="ignore">
        <div className="nc-input focused"><input autoFocus placeholder={urlAllowed ? 'Find or paste a link…' : 'Type to find…'} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && isUrl && urlAllowed) pick({ type: 'url', url: query }); }} /></div>
      </div>
      <div className="nc-auto-pop-list">
        {isUrl && (
          <>
            <div className="nc-auto-pop-section">Link</div>
            {urlAllowed
              ? <div role="option" className="nc-auto-opt" onClick={() => pick({ type: 'url', url: query })}><Icon name="link" size={18} /><span className="grow">{query}</span></div>
              : <div className="nc-auto-hint" style={{ padding: '0 8px 6px' }}>A URL can be linked only as the first workflow action.</div>}
          </>
        )}
        {(match(contextLabel('page', ctxSurface(c))) || out.length > 0) && <div className="nc-auto-pop-section">{c.surface === 'automation' ? 'From this workflow' : 'From this button'}</div>}
        {match(contextLabel('page', ctxSurface(c))) && <div role="option" className="nc-auto-opt" onClick={() => pick({ type: 'context', key: 'page' })}><Icon name="page" size={18} /><span className="grow">{contextLabel('page', ctxSurface(c))}</span></div>}
        {out.filter((r) => match(refLabel(r, c).label)).map((r) => (
          <div key={(r as { step: string }).step} role="option" className="nc-auto-opt" onClick={() => pick({ type: 'step', step: (r as { step: string }).step })}><Icon name="page" size={18} /><span className="grow">{refLabel(r, c).label}</span></div>
        ))}
        {ids.length > 0 && <div className="nc-auto-pop-section">Pages</div>}
        {ids.map((id) => (
          <div key={id} role="option" className="nc-auto-opt" onClick={() => pick({ type: 'page', page_id: id })}><PageIcon block={records.get<BlockRecord>('block', id)} size={18} /><span className="grow">{pageTitle(records.get<BlockRecord>('block', id)) || 'Untitled'}</span></div>
        ))}
      </div>
    </PopoverSurface>
  );
}

function openTargetMenu(anchor: HTMLElement, c: EditorCtx, current: Extract<AutomationAction, { type: 'open' }>, onChange: (s: AutomationAction) => void) {
  return openOverlay((close) => <OpenTargetPicker c={c} current={current} onChange={onChange} close={close} />, { anchor, placement: 'bottom-start', offset: 4, parent: overlayIdOf(anchor) });
}

function openTargetLabel(t: Extract<AutomationAction, { type: 'open' }>['target'], c: EditorCtx): string {
  if (!t) return 'Choose an entry, form, or URL';
  switch (t.type) {
    case 'page': return pageTitle(records.get<BlockRecord>('block', t.page_id)) || 'Untitled';
    case 'url': return t.url;
    case 'step': return refLabel({ type: 'step', step: t.step }, c).label;
    case 'context': return contextLabel('page', ctxSurface(c));
  }
}

/** Database of the pages an earlier step produced (Edit pages in "Page added in step 2"). */
function sourceDatabase(source: NonNullable<Extract<AutomationAction, { type: 'edit_pages' }>['source']>, steps: AutomationAction[]): string | undefined {
  if (source.type !== 'step') return undefined;
  const s = steps.find((x) => x.id === source.step);
  if (s?.type === 'add_page' || s?.type === 'edit_pages') return s.collection_id;
  return undefined;
}

const PEEK_LABELS: Record<PeekTarget, string> = { side_peek: 'Side peek', center_peek: 'Center peek', full_page: 'Full page', new_tab: 'New tab' };
const INSERT_LABELS: Record<string, [string, string]> = {
  below: ['Below button', 'below button'], above: ['Above button', 'above button'], top: ['At the top of the entry', 'at the top of the entry'], bottom: ['At the bottom of the entry', 'at the bottom of the entry'],
};

// ------------------------------------------------------------------ one card

function StepBody({ step, c, onChange, readOnly, props }: { step: AutomationAction; c: EditorCtx; onChange: (s: AutomationAction) => void; readOnly?: boolean; props: StepListProps }): { title: ReactNode; body: ReactNode } {
  const meta = ACTION_META[step.type];
  switch (step.type) {
    case 'edit_property':
      return { title: <b>{meta.title}</b>, body: <EditRows c={c} collectionId={props.collectionId} edits={step.edits} readOnly={readOnly} onChange={(edits) => onChange({ ...step, edits })} /> };
    case 'add_page': {
      const target = step.collection_id ? records.get<CollectionRecord>('collection', step.collection_id) : undefined;
      const templates = (target?.template_pages ?? []).map((id) => records.get<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && b.alive !== false);
      const tpl = step.template_id ? records.get<BlockRecord>('block', step.template_id) : undefined;
      return {
        title: (
          <>
            <b>Add page to</b>
            <DataSourcePill collectionId={step.collection_id} readOnly={readOnly} onPick={(id) => onChange({ ...step, collection_id: id, template_id: null, edits: id === step.collection_id ? step.edits : [{ property: 'title', op: 'set', values: [] }] })} />
            {target && (
              <>
                <span>as</span>
                <Pill title="Select template" disabled={readOnly} placeholder={!tpl} onClick={(e) => openKeepMenu(e.currentTarget, { width: 260, sections: [{ title: 'Select template', items: [
                  { id: 'empty', label: 'Empty', icon: 'pageEmpty', checked: !step.template_id, onSelect: () => onChange({ ...step, template_id: null }) },
                  ...templates.map((t) => ({ id: t.id, label: toPlainText(t.properties?.title) || 'Untitled', icon: <PageIcon block={t} size={18} />, checked: t.id === step.template_id, onSelect: () => onChange({ ...step, template_id: t.id }) })),
                ] }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                  <span>{tpl ? toPlainText(tpl.properties?.title) || 'Untitled' : 'Empty'}</span>
                </Pill>
              </>
            )}
          </>
        ),
        body: step.collection_id ? <EditRows c={c} collectionId={step.collection_id} edits={step.edits} readOnly={readOnly} addLabel={step.edits.length ? 'Edit another property' : 'Edit a property'} onChange={(edits) => onChange({ ...step, edits })} /> : null,
      };
    }
    case 'edit_pages': {
      const n = filterLeaves(step.filter).length;
      const fromStep = step.source ? refLabel(step.source.type === 'step' ? { type: 'step', step: step.source.step } : { type: 'variable', step: step.source.step, variable: step.source.variable }, c).label : undefined;
      const extra: MenuItemDef[] = [...earlierOutputs(c).pages, ...earlierOutputs(c).variables].map((r) => ({ id: JSON.stringify(r), label: refLabel(r, c).label, icon: 'page', onSelect: () => onChange({ ...step, source: r.type === 'step' ? { type: 'step', step: r.step } : { type: 'variable', step: (r as any).step, variable: (r as any).variable }, collection_id: step.collection_id }) }));
      return {
        title: (
          <>
            <b>Edit</b>
            {!step.source && (
              <Pill disabled={readOnly || !step.collection_id} onClick={(e) => step.collection_id && openFilterEditor(e.currentTarget, { collectionId: step.collection_id, filter: step.filter, onChange: (f) => onChange({ ...step, filter: f }) })}>
                <span>{n ? `pages that match ${n} ${n === 1 ? 'filter' : 'filters'}` : 'all pages'}</span>
              </Pill>
            )}
            <span>in</span>
            <DataSourcePill collectionId={step.source ? undefined : step.collection_id} label={fromStep} readOnly={readOnly} extra={extra} onPick={(id) => onChange({ ...step, source: null, collection_id: id, filter: id === step.collection_id ? step.filter : null, edits: id === step.collection_id ? step.edits : [] })} />
          </>
        ),
        body: (step.collection_id || step.source) ? <EditRows c={c} collectionId={step.source ? sourceDatabase(step.source, c.steps) ?? props.collectionId : step.collection_id} edits={step.edits} readOnly={readOnly} onChange={(edits) => onChange({ ...step, edits })} /> : null,
      };
    }
    case 'notify': {
      const t = step.target;
      const people = props.collectionId ? Object.entries(records.get<CollectionRecord>('collection', props.collectionId)?.schema ?? {}).filter(([, p]) => p.type === 'person') : [];
      const blockButton = c.surface === 'button_block';
      return {
        title: (
          <>
            <b>Send a notice to</b>
            {blockButton ? <span>specific people</span> : (
              <Pill disabled={readOnly} onClick={(e) => openKeepMenu(e.currentTarget, { width: 200, sections: [{ items: [
                { id: 'users', label: 'People', checked: t.type === 'users', onSelect: () => onChange({ ...step, target: { type: 'users', user_ids: [] } }) },
                { id: 'prop', label: 'Property', checked: t.type === 'property', disabled: !people.length, onSelect: () => onChange({ ...step, target: { type: 'property', property: people[0]?.[0] ?? '' } }) },
              ] }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                <span>{t.type === 'property' ? 'Property' : 'People'}</span>
              </Pill>
            )}
          </>
        ),
        body: (
          <>
            {t.type === 'users' ? (
              <div className="nc-auto-row">
                <div className="nc-auto-row-value">
                  {(t.dynamic ?? []).map((k) => <span key={k} className="nc-auto-chip"><Icon name="person" size={12} />{contextLabel(k, ctxSurface(c))}</span>)}
                  {t.user_ids.map((id) => <span key={id} className="nc-auto-pill static"><UserAvatar userId={id} size={18} /><span>{records.get<any>('lit_user', id)?.name ?? 'Unknown'}</span></span>)}
                  {!readOnly && (
                    <span role="button" className="nc-auto-pill placeholder" onClick={(e) => openKeepMenu(e.currentTarget, {
                      width: 280, search: `Choose up to ${LIMITS.notifyUsers} people…`,
                      sections: [
                        { title: 'From this workflow'.replace('automation', c.surface === 'automation' ? 'automation' : 'button'), items: (['actor', ...(c.surface === 'automation' ? ['page_creator'] : [])] as ('actor' | 'page_creator')[]).map((k) => ({ id: k, label: contextLabel(k, ctxSurface(c)), icon: 'person', checked: (t.dynamic ?? []).includes(k), onSelect: () => { const d = t.dynamic ?? []; onChange({ ...step, target: { ...t, dynamic: d.includes(k) ? d.filter((x) => x !== k) : [...d, k] } }); } })) },
                        { title: 'Send a notice to', items: workspaceMembers().map((u) => ({ id: u.id, label: u.name || u.email, text: `${u.name} ${u.email}`, icon: <UserAvatar userId={u.id} size={20} />, checked: t.user_ids.includes(u.id), onSelect: () => onChange({ ...step, target: { ...t, user_ids: t.user_ids.includes(u.id) ? t.user_ids.filter((x) => x !== u.id) : [...t.user_ids, u.id].slice(0, LIMITS.notifyUsers) } }) })) },
                      ],
                    }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                      <span>{t.user_ids.length + (t.dynamic?.length ?? 0) ? 'Edit' : `Choose up to ${LIMITS.notifyUsers} people…`}</span>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="nc-auto-row">
                <div className="nc-auto-row-value">
                  <Pill disabled={readOnly} placeholder={!t.property} onClick={(e) => openKeepMenu(e.currentTarget, { width: 220, sections: [{ items: people.map(([pid, p]) => ({ id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: pid === t.property, onSelect: () => onChange({ ...step, target: { type: 'property', property: pid } }) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                    <span>{t.property && people.find(([pid]) => pid === t.property)?.[1].name || 'Select a property'}</span>
                  </Pill>
                </div>
              </div>
            )}
            <div className="nc-auto-field-label">Message</div>
            <RefsField c={c} value={step.message} onChange={(message) => onChange({ ...step, message })} placeholder="Write a message, @ to mention" multiline ariaLabel="Message" />
          </>
        ),
      };
    }
    case 'webhook': {
      const col = props.collectionId ? records.get<CollectionRecord>('collection', props.collectionId) : undefined;
      const sendable = Object.entries(col?.schema ?? {}).filter(([, p]) => p.type !== 'button');
      const all = step.properties === 'all';
      const selected = all ? sendable.map(([id]) => id) : (step.properties as string[]);
      return {
        title: <b>Send webhook</b>,
        body: (
          <>
            <div className="nc-auto-field-label">URL</div>
            <input className="nc-auto-input" aria-label="URL" placeholder="https://" value={step.url} readOnly={readOnly} onChange={(e) => onChange({ ...step, url: e.target.value })} />
            {c.surface === 'automation' && col && (
              <>
                <div className="nc-auto-field-label">Content</div>
                <span role="button" className="nc-auto-pill" style={{ alignSelf: 'flex-start' }} onClick={(e) => !readOnly && openKeepMenu(e.currentTarget, {
                  width: 280,
                  sections: [
                    { items: [{ id: 'all', label: 'Choose all existing fields', description: 'New fields are not added automatically', checked: all, onSelect: () => { onChange({ ...step, properties: all ? [] : 'all' }); return false; } }] },
                    { items: sendable.map(([pid, p]) => ({ id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: selected.includes(pid), onSelect: () => { const next = selected.includes(pid) ? selected.filter((x) => x !== pid) : [...selected, pid]; onChange({ ...step, properties: next }); return false; } })) },
                  ],
                }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                  <span>{all ? 'All properties' : selected.length ? `${selected.length} ${selected.length === 1 ? 'property' : 'properties'}` : 'No properties'}</span>
                  <Icon name="arrowChevronSingleDownSmall" size={14} />
                </span>
              </>
            )}
            {step.headers.map((h, i) => (
              <div key={i} className="nc-auto-header-row">
                <input className="nc-auto-input" aria-label="Key" placeholder="Key" value={h.key} readOnly={readOnly} onChange={(e) => onChange({ ...step, headers: step.headers.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
                <HeaderValueInput value={h.value} readOnly={readOnly} onChange={(value) => onChange({ ...step, headers: step.headers.map((x, j) => (j === i ? { ...x, value } : x)) })} />
                {!readOnly && <span role="button" className="nc-auto-icon-btn" aria-label="Delete custom header" onClick={() => onChange({ ...step, headers: step.headers.filter((_, j) => j !== i) })}><Icon name="xMarkSmall" size={14} /></span>}
              </div>
            ))}
            {!readOnly && step.headers.length < LIMITS.customHeaders && <span role="button" className="nc-auto-link" onClick={() => onChange({ ...step, headers: [...step.headers, { id: newId(), key: '', value: '' }] })}><Icon name="plusSmall" size={16} />Create custom header</span>}
          </>
        ),
      };
    }
    case 'define_variables':
      return {
        title: <b>Define variables</b>,
        body: (
          <>
            {step.variables.map((v, i) => (
              <div key={v.id} className="nc-auto-row">
                <div className="nc-auto-row-label" style={{ width: 130 }}>
                  <input className="nc-auto-input" aria-label="Variable name" value={v.name} readOnly={readOnly} onChange={(e) => onChange({ ...step, variables: step.variables.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                </div>
                <div className="nc-auto-row-value">
                  <span style={{ color: 'var(--lp-text-tertiary)' }}>=</span>
                  <span role="button" className={`nc-auto-pill ${v.formula ? '' : 'placeholder'}`} onClick={(e) => !readOnly && openAutomationFormula(e.currentTarget, { c, initial: v.formula, onSave: (src) => onChange({ ...step, variables: step.variables.map((x, j) => (j === i ? { ...x, formula: src } : x)) }) })}>
                    <span style={{ fontWeight: 600, color: 'var(--lp-icon-secondary)' }}>∑</span><span>{v.formula ? 'Edit formula' : 'Add a formula'}</span>
                  </span>
                </div>
                {!readOnly && (
                  <span role="button" className="nc-auto-icon-btn nc-auto-row-remove" aria-label="More" onClick={(e) => openKeepMenu(e.currentTarget, { width: 200, sections: [{ items: [
                    { id: 'dup', label: 'Duplicate', icon: 'duplicate', onSelect: () => onChange({ ...step, variables: [...step.variables.slice(0, i + 1), { ...v, id: newId(), name: `${v.name} (1)` }, ...step.variables.slice(i + 1)] }) },
                    { id: 'del', label: 'Delete', icon: 'trash', disabled: step.variables.length <= 1, onSelect: () => onChange({ ...step, variables: step.variables.filter((_, j) => j !== i) }) },
                  ] }] }, { placement: 'bottom-end', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}><Icon name="ellipsisSmall" size={14} /></span>
                )}
              </div>
            ))}
            {!readOnly && step.variables.length < LIMITS.variables && <span role="button" className="nc-auto-link" onClick={() => onChange({ ...step, variables: [...step.variables, { id: newId(), name: `Variable ${step.variables.length + 1}`, formula: '' }] })}><Icon name="plusSmall" size={16} />Define one more variable…</span>}
          </>
        ),
      };
    case 'confirm':
      return {
        title: <b>Show confirmation</b>,
        body: (
          <>
            <div className="nc-auto-field-label">Confirmation message</div>
            <input className="nc-auto-input" aria-label="Confirmation message" placeholder="Continue with this action?" value={step.message} readOnly={readOnly} onChange={(e) => onChange({ ...step, message: e.target.value })} />
            <div className="nc-auto-header-row">
              <div style={{ flex: 1 }}>
                <div className="nc-auto-field-label">Text for the continue button</div>
                <input className="nc-auto-input" aria-label="Text for the continue button" placeholder="Continue" value={step.continue_label ?? ''} readOnly={readOnly} onChange={(e) => onChange({ ...step, continue_label: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="nc-auto-field-label">Text for the cancel button</div>
                <input className="nc-auto-input" aria-label="Text for the cancel button" placeholder="Cancel" value={step.cancel_label ?? ''} readOnly={readOnly} onChange={(e) => onChange({ ...step, cancel_label: e.target.value })} />
              </div>
            </div>
          </>
        ),
      };
    case 'open':
      return {
        title: (
          <>
            <b>Open</b>
            <Pill disabled={readOnly} placeholder={!step.target} title="Choose an entry, form, or URL" onClick={(e) => openTargetMenu(e.currentTarget, c, step, onChange)}>
              {step.target?.type === 'page' ? <PageIcon block={records.get<BlockRecord>('block', step.target.page_id)} size={16} /> : null}
              <span>{openTargetLabel(step.target, c)}</span>
            </Pill>
            <span>in</span>
            <Pill disabled={readOnly} onClick={(e) => openKeepMenu(e.currentTarget, { width: 180, sections: [{ items: (Object.keys(PEEK_LABELS) as PeekTarget[]).map((p) => ({ id: p, label: PEEK_LABELS[p], checked: (step.peek ?? 'side_peek') === p, onSelect: () => onChange({ ...step, peek: p }) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
              <span>{PEEK_LABELS[step.peek ?? 'side_peek']}</span>
            </Pill>
          </>
        ),
        body: null,
      };
    case 'insert_blocks':
      return {
        title: (
          <>
            <b>Insert blocks</b>
            <Pill disabled={readOnly} onClick={(e) => openKeepMenu(e.currentTarget, { width: 200, sections: [{ items: Object.entries(INSERT_LABELS).map(([k, [label]]) => ({ id: k, label, checked: step.position === k, onSelect: () => onChange({ ...step, position: k as 'below' }) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
              <span>{INSERT_LABELS[step.position]?.[1] ?? 'below button'}</span>
            </Pill>
          </>
        ),
        body: props.renderInsertBlocks?.(step) ?? null,
      };
    case 'agent':
      return {
        title: <><b>Send message to:</b><span className="nc-auto-pill static"><Icon name="aiFace" size={14} /><span>Litpage AI</span></span></>,
        body: (
          <>
            <div className="nc-auto-field-label">Message</div>
            <input className="nc-auto-input" aria-label="Message" placeholder="Message" value={step.message} readOnly={readOnly} onChange={(e) => onChange({ ...step, message: e.target.value })} />
          </>
        ),
      };
    default:
      return { title: <b>{meta.title}</b>, body: <div className="nc-auto-hint">{step.type === 'mail' ? 'Connect a Gmail account in Settings › Connections to send mail.' : 'Connect Slack in Settings › Connections to send Slack notifications.'}</div> };
  }
}

function StepCard({ step, index, props, issues, onDragStart, onDropAt, dragging, dropMark }: {
  step: AutomationAction; index: number; props: StepListProps; issues: ValidationIssue[];
  onDragStart: () => void; onDropAt: (before: boolean) => void; dragging: boolean; dropMark: 'before' | 'after' | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const meta = ACTION_META[step.type];
  const c: EditorCtx = { surface: props.surface, collectionId: props.collectionId, blockId: props.blockId, steps: props.steps, stepIndex: index };
  const update = (next: AutomationAction) => props.onChange(props.steps.map((s) => (s.id === step.id ? next : s)));
  const { title, body } = StepBody({ step, c, onChange: update, readOnly: props.readOnly, props });
  const issue = issues.find((x) => x.stepId === step.id);
  const steps = props.steps;
  const insertAt = (at: number, anchor: HTMLElement) => openActionMenu(anchor, { ...props, steps, onPick: (s) => props.onChange([...steps.slice(0, at), s, ...steps.slice(at)]) });
  const more = (anchor: HTMLElement) => {
    setMenuOpen(true);
    openKeepMenu(anchor, {
      width: 220,
      sections: [
        { items: [
          { id: 'dup', label: 'Duplicate', icon: 'duplicate', onSelect: () => props.onChange([...steps.slice(0, index + 1), { ...structuredClone(step), id: newId() }, ...steps.slice(index + 1)]) },
          { id: 'up', label: 'Move up', icon: 'arrowUp', disabled: index === 0, onSelect: () => { const n = steps.slice(); [n[index - 1], n[index]] = [n[index], n[index - 1]]; props.onChange(n); } },
          { id: 'down', label: 'Move down', icon: 'arrowDown', disabled: index === steps.length - 1, onSelect: () => { const n = steps.slice(); [n[index + 1], n[index]] = [n[index], n[index + 1]]; props.onChange(n); } },
        ] },
        { items: [
          { id: 'above', label: 'Create action above', icon: 'plus', onSelect: () => { setTimeout(() => insertAt(index, anchor), 0); } },
          { id: 'below', label: 'Create action below', icon: 'plus', onSelect: () => { setTimeout(() => insertAt(index + 1, anchor), 0); } },
        ] },
        { items: [
          ...(HELP_URL && step.type === 'webhook' ? [{ id: 'learn', label: 'Explore webhooks', icon: 'questionMarkCircle', onSelect: () => window.open(HELP_URL!, '_blank', 'noopener') }] : []),
          ...(HELP_URL && step.type === 'define_variables' ? [{ id: 'learn', label: 'Explore variables', icon: 'questionMarkCircle', onSelect: () => window.open(HELP_URL!, '_blank', 'noopener') }] : []),
          { id: 'del', label: 'Delete', icon: 'trash', onSelect: () => props.onChange(steps.filter((s) => s.id !== step.id)) },
        ] },
      ],
    }, { placement: 'bottom-end', parent: overlayIdOf(anchor), backdrop: 'transparent', onClose: () => setMenuOpen(false) });
  };
  return (
    <div
      className={`nc-auto-card ${issue ? 'error' : ''} ${dragging ? 'dragging' : ''} ${dropMark ? `drop-${dropMark}` : ''}`}
      data-step-type={step.type}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onDropAt(e.clientY < r.top + r.height / 2); }}
    >
      {!props.readOnly && (
        <span className="nc-auto-drag" draggable aria-label={`Drag step ${index + 1} to reposition it`} data-tooltip={`Drag step ${index + 1} to reposition it`} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', step.id); onDragStart(); }}>
          <Icon name="dragHandle" size={14} />
        </span>
      )}
      <div className="nc-auto-card-head">
        <span className="nc-auto-card-icon"><Icon name={meta.icon} size={18} /></span>
        <div className="nc-auto-card-title">{title}</div>
        {!props.readOnly && (
          <div className={`nc-auto-card-actions ${menuOpen ? 'open' : ''}`}>
            <span role="button" className="nc-auto-icon-btn" aria-label="More" data-tooltip="More" onClick={(e) => more(e.currentTarget)}><Icon name="ellipsisSmall" size={16} /></span>
          </div>
        )}
      </div>
      {body && <div className="nc-auto-card-body">{body}</div>}
      {issue && (
        <div className="nc-auto-card-error" role="alert"><Icon name="warning" size={14} /><span>{issue.message}{issue.tip ? ` — ${issue.tip}` : ''}</span></div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ list

export function StepList(props: StepListProps) {
  const [drag, setDrag] = useState<string | null>(null);
  const [mark, setMark] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const issues = props.issues ?? [];
  const steps = props.steps;
  const move = (targetId: string, before: boolean) => {
    if (!drag || drag === targetId) return;
    const moving = steps.find((s) => s.id === drag)!;
    const rest = steps.filter((s) => s.id !== drag);
    const at = rest.findIndex((s) => s.id === targetId) + (before ? 0 : 1);
    props.onChange([...rest.slice(0, at), moving, ...rest.slice(at)]);
  };
  return (
    <div className="nc-auto-steps" style={{ display: 'flex', flexDirection: 'column', gap: 0, width: '100%' }} onDragEnd={() => { setDrag(null); setMark(null); }}>
      {steps.map((s, i) => (
        <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }} onDragEnter={() => drag && drag !== s.id && setMark({ id: s.id, pos: steps.findIndex((x) => x.id === drag) > i ? 'before' : 'after' })}>
          {i > 0 && <div className="nc-auto-connector short" />}
          <div style={{ width: '100%' }}>
            <StepCard step={s} index={i} props={props} issues={issues} dragging={drag === s.id} dropMark={mark?.id === s.id ? mark.pos : null} onDragStart={() => setDrag(s.id)} onDropAt={(before) => { move(s.id, before); setDrag(null); setMark(null); }} />
          </div>
        </div>
      ))}
      {!props.readOnly && (
        <>
          {steps.length > 0 && <div className="nc-auto-connector short" style={{ alignSelf: 'center' }} />}
          <div
            role="button"
            aria-label="Add action"
            aria-haspopup="dialog"
            className="nc-auto-add"
            onClick={(e) => openActionMenu(e.currentTarget, { ...props, steps, onPick: (s) => props.onChange([...steps, s]) })}
          >
            <span className="nc-auto-add-icon"><Icon name="plusSmall" size={16} /></span>
            <span className="nc-auto-add-label">{steps.length ? 'Create another step' : 'New action'}</span>
          </div>
        </>
      )}
    </div>
  );
}

export type { CollectionViewRecord };

/* * A custom header value: stored values are secrets the server keeps (only WEBHOOK_SECRET_MASK comes back). Leaving * the placeholder keeps the stored value, typing replaces it, clearing removes it. While the field has focus the local * text wins, so a save confirmed by the server (placeholder) doesn't replace what is being typed.
*/
function HeaderValueInput({ value, readOnly, onChange }: { value: string; readOnly?: boolean; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const masked = shown === WEBHOOK_SECRET_MASK;
  return (
    <input
      className="nc-auto-input"
      aria-label="Value"
      placeholder="Value"
      value={shown}
      readOnly={readOnly}
      title={masked ? 'The saved value is hidden. Type to replace it.' : undefined}
      onFocus={(e) => { setDraft(value); if (value === WEBHOOK_SECRET_MASK) e.currentTarget.select(); }}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        // typing into the placeholder replaces the stored value instead of appending to the dots
        const next = masked ? e.target.value.replace(/\u2022/g, '') : e.target.value;
        setDraft(next);
        onChange(next);
      }}
    />
  );
}
