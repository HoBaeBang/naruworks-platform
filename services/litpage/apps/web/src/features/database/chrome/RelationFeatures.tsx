// View settings › More settings › Sub-items / Dependencies / Sprints pages and "Change to Tasks table"
// Labels use the database view settings and collection settings translations.
// Labels describe sub-item display and filter scope, plus sprint settings.
import { useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import {
  DATE_SHIFT_MODES, dependencyConfigOf, isSprintsDatabase, nestsSubitems, sprintSettingsOf, subitemConfigOf, subitemSettingsOf,
  type DateShiftMode, type SubitemDisplayMode, type SubitemFilterScope,
} from '@nc/shared/database/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import type { MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { useCollection, useCollectionView } from '../../../lib/hooks.ts';
import { confirmDialog } from '../../page/confirm.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { updateViewFormat } from '../actions.ts';
import { itemNoun, setSubitemDisplayMode, setSubitemFilterScope, turnOffSubitems, turnOnSubitems } from '../subitems.ts';
import { turnOffDependencies, turnOnDependencies, updateDependencySettings, firstDateProperty } from '../dependencies.ts';
import { isTaskDatabase, undoTaskDatabase } from '../taskdb.ts';
import { openTurnIntoTasksDialog } from './TurnIntoTasks.tsx';
import { isSkillsDatabase, openTurnIntoSkillsDialog, undoSkillsDatabase } from '../../ai/SkillsDatabase.tsx';
import { SprintSettingsBody } from '../sprints/SprintSettings.tsx';
import { useCollectionAccess } from '../access.ts';
import { openLayoutBuilder } from '../layout/openLayoutBuilder.ts';
import { connectionsMenuItem } from '../../developer/PageConnections.tsx';
import { VSHeader as Header, VSRow as Row, VSSection as Section, VSToggleRow as ToggleRow, vsPick as pick, type VSCtx, type VSPage } from './ViewSettings.tsx';
import '../featureIcons.tsx';
import './relationFeatures.css';

interface PageProps {
  ctx: VSCtx;
  view: CollectionViewRecord;
  collection: CollectionRecord;
  go: (p: VSPage) => void;
  close: () => void;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** View settings › “More settings” submenu: Dependencies, Connections, and Adjust entry layout. */
export function moreSettingsItems(opts: { collection: CollectionRecord; view: CollectionViewRecord; block: BlockRecord; go: (p: string) => void; close: () => void }): MenuItemDef[] {
  const noun = itemNoun(opts.collection);
  return [
    { id: 'subitems', label: `Sub-${noun.items}`, icon: 'listToggleIndent', right: <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />, onSelect: () => opts.go('subitems') },
    { id: 'deps', label: 'Dependencies', icon: 'arrowTurnDownRight', right: <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />, onSelect: () => opts.go('dependencies') },
    ...(isTaskDatabase(opts.collection) ? [{ id: 'sprints', label: 'Sprints', icon: 'sprint', right: <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />, onSelect: () => opts.go('sprints') }] : []),
    // API connections of this database (features/developer: list / add / remove, page ••• › Connections)
    connectionsMenuItem(opts.block.id, (label, icon, extra) => ({ id: 'conn', label, icon, ...extra })),
    { id: 'layout', label: 'Adjust entry layout', icon: 'layout', onSelect: () => { opts.close(); openLayoutBuilder(opts.collection.id); } },
  ];
}

/** View settings › "Turn into" submenu. */
export function turnIntoItems(collection: CollectionRecord, close: () => void): MenuItemDef[] {
  // Skills database
  if (isSkillsDatabase(collection)) {
    return [{ id: 'undo-skills', label: 'Undo Skills table', icon: 'paperBolt', onSelect: async () => {
      const ok = await confirmDialog({ message: 'Undo Skills table?', confirmLabel: 'Undo' });
      if (ok) undoSkillsDatabase(collection);
    } }];
  }
  if (isTaskDatabase(collection)) {
    return [{ id: 'undo', label: 'Undo Task table', icon: 'checkmarkSquare', onSelect: async () => {
      const ok = await confirmDialog({ message: 'Undo Task table?', confirmLabel: 'Remove' });
      if (ok) undoTaskDatabase(collection);
    } }];
  }
  return [
    { id: 'tasks', label: 'Change to Tasks table', icon: 'checkmarkSquare', disabled: isSprintsDatabase(collection), onSelect: () => { close(); openTurnIntoTasksDialog(collection.id); } },
    { id: 'skills', label: 'Change to Skills table', icon: 'paperBolt', onSelect: () => { close(); openTurnIntoSkillsDialog(collection.id); } },
  ];
}

/** Modal of "Turn off sub-items" / "Disable dependencies": Keep properties | Remove properties. */
function openTurnOffModal(opts: { title: string; property: string; inverse?: string; onPick: (remove: boolean) => void }) {
  openOverlay((close) => (
    <div className="nc-confirm nc-rf-turnoff" role="alertdialog" style={{ width: 340 }}>
      <div className="nc-confirm-message">{opts.title}</div>
      <div className="nc-rf-turnoff-choices">
        <div role="button" className="nc-rf-turnoff-choice" onClick={() => { close(); opts.onPick(false); }}>
          <div className="nc-rf-turnoff-title">Keep properties</div>
        </div>
        <div role="button" className="nc-rf-turnoff-choice danger" onClick={() => { close(); opts.onPick(true); }}>
          <div className="nc-rf-turnoff-title">Remove properties</div>
          <div className="nc-rf-turnoff-desc">{opts.inverse ? `Delete ${opts.property} and ${opts.inverse}.` : `Delete ${opts.property}.`}</div>
        </div>
      </div>
      <div className="nc-confirm-buttons"><button className="nc-dialog-btn outline" onClick={close}>Cancel</button></div>
    </div>
  ), { placement: 'center', backdrop: 'dim' });
}

function selfRelations(c: CollectionRecord): [string, PropertySchema][] {
  return Object.entries(c.schema).filter(([, p]) => p.type === 'relation' && ((p.collection_pointer as { id?: string } | undefined)?.id ?? p.collection_id) === c.id);
}

/** Shared "Property" chooser of the turn-on state: create a new relation (optional name) or use an existing one. */
function RelationChooser({ c, caption, placeholder, value, onChange }: { c: CollectionRecord; caption: string; placeholder: string; value: { mode: 'new' | 'existing'; name: string; relation?: string }; onChange: (v: { mode: 'new' | 'existing'; name: string; relation?: string }) => void }) {
  const rels = selfRelations(c);
  return (
    <Section title="Property" className="nc-vs-sec titled">
      <Row label="Create a new link" chevron={false} right={<Icon name={value.mode === 'new' ? 'radioOn' : 'radioOff'} size={16} />} onClick={() => onChange({ ...value, mode: 'new' })} />
      {value.mode === 'new' && (
        <div className="nc-rf-input" data-menu-keys="ignore">
          <div className="nc-rf-input-label">Rename (optional)</div>
          <div className="nc-input"><input placeholder={placeholder} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></div>
        </div>
      )}
      <Row label="Use an existing link" chevron={false} disabled={!rels.length} right={<Icon name={value.mode === 'existing' ? 'radioOn' : 'radioOff'} size={16} />} onClick={() => onChange({ ...value, mode: 'existing', relation: value.relation ?? rels[0]?.[0] })} />
      {value.mode === 'existing' && rels.length > 0 && (
        <Row icon={<PropertyIcon prop={c.schema[value.relation ?? rels[0][0]]} size={16} />} label="Property" value={c.schema[value.relation ?? rels[0][0]]?.name} onClick={(e) => pick(e.currentTarget, rels.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === value.relation, onSelect: () => onChange({ ...value, relation: id }) })))} />
      )}
      <div className="nc-rf-caption">{caption}</div>
    </Section>
  );
}

// ------------------------------------------------------------------ Sub-items

const DISPLAY_LABEL: Record<SubitemDisplayMode, string> = { show: 'Nested under a toggle', flattened: 'Flattened list', disabled: 'Disabled' };
const SCOPE_LABEL: Record<SubitemFilterScope, string> = { parents: 'Parents only', parents_and_subitems: 'Parents and nested items', subitems: 'Nested items only' };

function subitemsPreview(mode: SubitemDisplayMode, scope: SubitemFilterScope, nested: boolean): string {
  if (mode === 'disabled') return 'Every item is treated as top-level.';
  if (mode === 'flattened') {
    return scope === 'parents' ? 'Matching parents appear with a count of nested items.'
      : scope === 'subitems' ? 'Only matching nested items appear.' : 'Matching parents and nested items appear together.';
  }
  if (!nested) return 'Matching parents appear with nested items on each card.';
  return scope === 'parents' ? 'Any parents that match the filters will display up, with their sub-items nested.'
    : scope === 'subitems' ? 'Only parents with matching nested items appear.' : 'All matching parents and nested items appear.';
}

export function SubitemsPage({ ctx, view: v0, collection: c0, go, close }: PageProps) {
  const c = useCollection(c0.id) ?? c0;
  const view = useCollectionView(v0.id) ?? v0;
  const noun = itemNoun(c);
  const cfg = subitemConfigOf(c);
  const ro = ctx.readOnly || !useCollectionAccess(c.id).canEditStructure;
  const [choice, setChoice] = useState<{ mode: 'new' | 'existing'; name: string; relation?: string }>({ mode: 'new', name: '' });
  const title = `Sub-${noun.items}`;
  if (!cfg) {
    return (
      <>
        <Header title={title} onBack={() => go('main')} close={close} />
        <div className="nc-rf-desc">{`Group ${noun.items} under toggles`}</div>
        <RelationChooser c={c} value={choice} onChange={setChoice} placeholder={isTaskDatabase(c) ? 'Sub-tasks…' : 'Sub-items…'} caption={`Choose the link field for sub-${noun.items}. “Sub-${noun.item}” is the default.`} />
        <div className="nc-rf-cta"><div role="button" data-testid="turn-on-subitems" className={`nc-btn primary nc-rf-cta-btn ${ro ? 'disabled' : ''}`} onClick={() => !ro && turnOnSubitems(c, choice.mode === 'existing' ? { relation: choice.relation } : { name: choice.name })}>{`Enable sub-${noun.items}`}</div></div>
      </>
    );
  }
  const f = (view.format ?? {}) as Record<string, any>;
  const nested = nestsSubitems(view.type);
  const settings = subitemSettingsOf(view, c);
  const mode: SubitemDisplayMode = (f.subitem_display_mode as SubitemDisplayMode | undefined) ?? (view.type === 'chart' ? 'flattened' : 'show');
  const scope: SubitemFilterScope = settings?.scope ?? 'parents';
  const showLabel = nested ? 'Nested under a toggle' : 'Card property';
  const scopes: SubitemFilterScope[] = mode === 'show' && !nested ? ['parents'] : ['parents', 'parents_and_subitems', 'subitems'];
  return (
    <>
      <Header title={title} onBack={() => go('main')} close={close} />
      <Section className="nc-vs-sec first">
        <Row label="Display options" testid="subitem-display" value={mode === 'show' ? showLabel : DISPLAY_LABEL[mode]} disabled={ro} onClick={(e) => pick(e.currentTarget, (['show', 'flattened', 'disabled'] as SubitemDisplayMode[]).map((m) => ({ id: m, label: m === 'show' ? showLabel : DISPLAY_LABEL[m], checked: mode === m, onSelect: () => setSubitemDisplayMode(view, m) })))} />
        {mode !== 'disabled' && (
          <Row label={mode === 'flattened' ? 'Include' : 'Filter options'} testid="subitem-scope" value={SCOPE_LABEL[scope]} disabled={ro || scopes.length === 1} onClick={(e) => pick(e.currentTarget, scopes.map((s) => ({ id: s, label: SCOPE_LABEL[s], checked: scope === s, onSelect: () => setSubitemFilterScope(view, s) })))} />
        )}
        <div className="nc-rf-caption">{subitemsPreview(mode, scope, nested)}</div>
      </Section>
      <Section divider title="Advanced settings" className="nc-vs-sec titled">
        <Row label="Property" value={c.schema[cfg.property]?.name} disabled={ro} onClick={(e) => pick(e.currentTarget, selfRelations(c).map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === cfg.property, onSelect: () => turnOnSubitems(c, { relation: id }) })))} />
        {view.type === 'table' && (
          <div data-tooltip="Choose whether nesting and its toggle stay in the title or first column. This applies to tables.">
            <ToggleRow label="Put the nesting toggle in the title column" on={f.table_subitem_toggle_on_title !== false} disabled={ro} onChange={(on) => updateViewFormat(view.id, { table_subitem_toggle_on_title: on ? undefined : false }, 'subitems.toggleOnTitle')} />
          </div>
        )}
      </Section>
      <Section divider className="nc-vs-sec last">
        <Row icon="trash" label={`Disable sub-${noun.items}`} chevron={false} disabled={ro} testid="turn-off-subitems" onClick={() => openTurnOffModal({
          title: `Remove linked fields when disabling sub-${noun.items}?`,
          property: c.schema[cfg.property]?.name ?? 'Sub-item', inverse: c.schema[cfg.inverse]?.name,
          onPick: (remove) => turnOffSubitems(c, remove),
        })} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Dependencies

function ShiftOptions({ mode, avoidWeekends, disabled, onMode, onAvoid, noun }: { mode: DateShiftMode | 'none'; avoidWeekends: boolean; disabled: boolean; onMode: (m: DateShiftMode | 'none') => void; onAvoid: (v: boolean) => void; noun: string }) {
  return (
    <Section divider title="Automatic date adjustment" className="nc-vs-sec titled">
      {DATE_SHIFT_MODES.map((m) => (
        <Row key={m.id} testid={`shift-${m.id}`} label={m.id === 'preserve_gap' ? `Shift ${noun} while keeping their timing` : m.label} chevron={false} disabled={disabled} right={<Icon name={mode === m.id ? 'radioOn' : 'radioOff'} size={16} />} onClick={() => onMode(m.id)} />
      ))}
      <ToggleRow label="Avoid weekends" on={avoidWeekends} disabled={disabled || mode === 'none'} onChange={onAvoid} />
      <div className="nc-rf-caption">{`Keep shifted ${noun} off weekends`}</div>
    </Section>
  );
}

function ShiftUsing({ c, date, end, disabled, onChange }: { c: CollectionRecord; date?: string; end?: string; disabled: boolean; onChange: (date: string, end?: string | null) => void }) {
  const dates = Object.entries(c.schema).filter(([, p]) => p.type === 'date');
  const items = (cur: string | undefined, set: (id: string) => void) => dates.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === cur, onSelect: () => set(id) }));
  return (
    <Section divider title="Shift using" className="nc-vs-sec titled">
      {end ? (
        <>
          <Row label="Start date" value={date ? c.schema[date]?.name : 'None'} disabled={disabled || !dates.length} onClick={(e) => pick(e.currentTarget, items(date, (id) => onChange(id, end)))} />
          <Row label="End date" value={c.schema[end]?.name} disabled={disabled} onClick={(e) => pick(e.currentTarget, items(end, (id) => onChange(date ?? id, id)))} />
        </>
      ) : (
        <Row label="Date property" value={date ? c.schema[date]?.name : 'None'} disabled={disabled || !dates.length} onClick={(e) => pick(e.currentTarget, items(date, (id) => onChange(id)))} />
      )}
      <ToggleRow label="Use separate start and end dates" on={!!end} disabled={disabled || dates.length < 2} onChange={(on) => onChange(date ?? dates[0]?.[0] ?? '', on ? dates.find(([id]) => id !== date)?.[0] : null)} />
    </Section>
  );
}

export function DependenciesPage({ ctx, view: v0, collection: c0, go, close }: PageProps) {
  const c = useCollection(c0.id) ?? c0;
  const view = useCollectionView(v0.id) ?? v0;
  const noun = itemNoun(c);
  const cfg = dependencyConfigOf(c);
  const ro = ctx.readOnly || !useCollectionAccess(c.id).canEditStructure;
  const [choice, setChoice] = useState<{ mode: 'new' | 'existing'; name: string; relation?: string }>({ mode: 'new', name: '' });
  const [draft, setDraft] = useState<{ mode: DateShiftMode | 'none'; avoid: boolean; date?: string; end?: string }>({ mode: 'consume_gap', avoid: true, date: firstDateProperty(c.schema) });
  if (!cfg) {
    return (
      <>
        <Header title="Dependencies" onBack={() => go('main')} close={close} />
        <div className="nc-rf-desc">{`Use dependencies to display ${noun.items} that are blocking — or blocked by — other ${noun.items}.`}</div>
        <RelationChooser c={c} value={choice} onChange={setChoice} placeholder="Dependencies…" caption={`Choose the link field for blocked ${noun.items}. “Blocking” is the default.`} />
        <ShiftOptions mode={draft.mode} avoidWeekends={draft.avoid} disabled={ro} noun={noun.items} onMode={(m) => setDraft({ ...draft, mode: m })} onAvoid={(v) => setDraft({ ...draft, avoid: v })} />
        <ShiftUsing c={c} date={draft.date} end={draft.end} disabled={ro} onChange={(d, e) => setDraft({ ...draft, date: d, end: e ?? undefined })} />
        <div className="nc-rf-cta"><div role="button" data-testid="turn-on-dependencies" className={`nc-btn primary nc-rf-cta-btn ${ro ? 'disabled' : ''}`} onClick={() => !ro && turnOnDependencies(c, {
          relation: choice.mode === 'existing' ? choice.relation : undefined, name: choice.name, mode: draft.mode === 'none' ? null : draft.mode, avoidWeekends: draft.avoid, dateProperty: draft.date, endDateProperty: draft.end, view,
        })}>Enable dependencies</div></div>
      </>
    );
  }
  const shownInView = (view.format as Record<string, any> | undefined)?.timeline_arrows_by?.property;
  return (
    <>
      <Header title="Dependencies" onBack={() => go('main')} close={close} />
      <Section className="nc-vs-sec first">
        <Row label="Property" value={c.schema[cfg.blocking]?.name} disabled={ro} onClick={(e) => pick(e.currentTarget, selfRelations(c).map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === cfg.blocking, onSelect: () => turnOnDependencies(c, { relation: id, mode: cfg.mode ?? null, avoidWeekends: cfg.avoidWeekends, dateProperty: cfg.dateProperty, endDateProperty: cfg.endDateProperty }) })))} />
        <div className="nc-rf-caption">New layouts use this field for dependencies and date shifting.</div>
        {view.type === 'timeline' && (
          <Row label={shownInView ? 'Hide dependencies in this layout' : 'Display dependencies in this layout'} chevron={false} disabled={ro} onClick={() => updateViewFormat(view.id, { timeline_arrows_by: shownInView ? undefined : { property: cfg.blocking } }, 'dependencies.toggleView')} />
        )}
      </Section>
      <ShiftOptions mode={cfg.mode ?? 'none'} avoidWeekends={cfg.avoidWeekends} disabled={ro} noun={noun.items} onMode={(m) => updateDependencySettings(c, { mode: m === 'none' ? null : m })} onAvoid={(v) => updateDependencySettings(c, { avoid_weekends: v })} />
      <ShiftUsing c={c} date={cfg.dateProperty} end={cfg.endDateProperty} disabled={ro} onChange={(d, e) => updateDependencySettings(c, { date_property: d, end_date_property: e === undefined ? cfg.endDateProperty ?? null : e })} />
      <Section divider className="nc-vs-sec last">
        <Row icon="trash" label="Disable dependencies" chevron={false} disabled={ro} testid="turn-off-dependencies" onClick={() => openTurnOffModal({
          title: 'Disable dependencies?', property: c.schema[cfg.blocking]?.name ?? 'Blocking', inverse: cfg.blockedBy ? c.schema[cfg.blockedBy]?.name : undefined,
          onPick: (remove) => turnOffDependencies(c, remove),
        })} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Sprints

export function SprintsPage({ ctx, view, collection: c0, go, close }: PageProps) {
  const c = useCollection(c0.id) ?? c0;
  const ro = ctx.readOnly || !useCollectionAccess(c.id).canEditStructure;
  return (
    <>
      <Header title="Sprints" onBack={() => go('main')} close={close} />
      <SprintSettingsBody collection={c} view={view} block={ctx.block} readOnly={ro} closePanel={close} />
      {void sprintSettingsOf}
    </>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <div className="nc-rf-caption">{children}</div>;
}

export { cap };
