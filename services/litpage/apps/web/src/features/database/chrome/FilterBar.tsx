// Filter / sort UI: filter bar (sort chip, advanced-filter chip, property filter chips, "+ Filter"),
// property picker (“Filter by…”), chip editors per value type, relative dates, advanced filters, and sorting.
// relative dates from relativeDates), advanced filter builder (Where / And|Or, rules, nested groups),
// sort popover (rows with property + Ascending/Descending, "+ Add sort", "Delete sort").
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionRecord, CollectionViewRecord, PropertySchema, UserRecord, BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import {
  FILTER_CHIP_LABELS, FILTER_OPERATOR_LABELS, RELATIVE_DATE_LABELS, defaultFilterOperator, isSprintsDatabase, filterOperatorsFor, isActiveLeaf, isFilterGroup, propertyTypeMeta,
  formatDay, ymdToMs, type FilterGroup, type FilterNode, type FilterValue, type PropertyFilterLeaf, type SortSpec, type StatusGroup, propertyFiltersOf, advancedFilterOf,
} from '@nc/shared/database/index.ts';
import { records } from '../../../lib/store/records.ts';
import { useCollectionView, useCollection } from '../../../lib/hooks.ts';
import { useSession } from '../../../lib/store/session.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { OptionPill, StatusPill } from '../properties/ValueView.tsx';
import { UserAvatar } from '../../presence/Avatar.tsx';
import { workspaceMembers } from '../properties/editors/MiscEditors.tsx';
import { DatePicker } from '../properties/editors/DatePicker.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { addPropertyFilter, removePropertyFilter, setAdvancedFilter, setSorts, updatePropertyFilter } from '../actions.ts';
import { collectionRows, collectionTemplates } from '../data.ts';
import { openNestedMenu } from '../menus.ts';
import { dirtyKind, effectiveView, useEffectiveView, useViewTempVersion } from '../viewState.ts';
import { FilterBarSaveControl } from './SaveControl.tsx';

// ---------- helpers ----------

const DEFAULT_OPS = new Set(['string_contains', 'enum_is', 'enum_contains', 'status_is', 'person_contains', 'relation_contains', 'date_is', 'checkbox_is', 'number_equals']);

function valuesOf(fv: FilterValue | FilterValue[] | undefined): FilterValue[] {
  if (!fv) return [];
  return (Array.isArray(fv) ? fv : [fv]).filter((v) => v && v.value !== undefined && v.value !== '');
}

function relativeLabel(v: FilterValue): string {
  if (typeof v.value === 'string' && RELATIVE_DATE_LABELS[v.value]) {
    if (v.value === 'custom') return `${v.direction === 'future' ? 'Next' : 'Past'} ${v.count ?? 1} ${v.unit ?? 'week'}${(v.count ?? 1) === 1 ? '' : 's'}`;
    if (v.value === 'surrounding') return `This ${v.unit ?? 'week'}`;
    return RELATIVE_DATE_LABELS[v.value];
  }
  return String(v.value ?? '');
}

/** Human value text of a filter (chip label). */
export function filterValueText(leaf: PropertyFilterLeaf, prop: PropertySchema | undefined): string {
  const vals = valuesOf(leaf.filter.value);
  if (!vals.length) return '';
  return vals.map((v) => {
    if (v.type === 'relative') return relativeLabel(v);
    if (v.type === 'is_group') return String(v.value);
    if (prop && (prop.type === 'person' || prop.type === 'created_by' || prop.type === 'last_edited_by')) {
      const u = records.get<UserRecord>('lit_user', String(v.value));
      return u?.name || u?.email || 'Unknown';
    }
    if (prop?.type === 'relation') return toPlainText(records.get<BlockRecord>('block', String(v.value))?.properties?.title) || 'Untitled';
    if (prop?.type === 'checkbox' || leaf.filter.operator.startsWith('checkbox')) return v.value === true || v.value === 'true' ? 'Checked' : 'Unchecked';
    const raw = v.value;
    if (raw && typeof raw === 'object' && raw.start_date) return raw.end_date ? `${formatDay(ymdToMs(raw.start_date), 'MMM DD, YYYY')} → ${formatDay(ymdToMs(raw.end_date), 'MMM DD, YYYY')}` : formatDay(ymdToMs(raw.start_date), 'MMM DD, YYYY');
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatDay(ymdToMs(raw), 'MMM DD, YYYY');
    return String(raw);
  }).join(', ');
}

export function chipLabel(leaf: PropertyFilterLeaf, prop: PropertySchema | undefined): { name: string; rest: string; active: boolean } {
  const op = leaf.filter.operator;
  const name = prop?.name ?? 'Property';
  const active = isActiveLeaf(leaf);
  if (op === 'is_empty' || op === 'is_not_empty') return { name, rest: FILTER_OPERATOR_LABELS[op], active };
  const val = filterValueText(leaf, prop);
  if (!val) return { name, rest: '', active };
  const opLabel = DEFAULT_OPS.has(op) ? '' : `${FILTER_CHIP_LABELS[op] ?? FILTER_OPERATOR_LABELS[op] ?? op} `;
  return { name, rest: `${opLabel}${val}`, active };
}

function resultTypeOf(prop: PropertySchema | undefined): string | undefined {
  return (prop as any)?.formula2?.result_type?.type ?? (prop as any)?.target_property_type;
}

// ---------- value editors ----------

function TextValue({ leaf, onChange, number }: { leaf: PropertyFilterLeaf; onChange: (v: FilterValue | undefined) => void; number?: boolean }) {
  const cur = valuesOf(leaf.filter.value)[0]?.value ?? '';
  const [text, setText] = useState(String(cur));
  return (
    <div className="nc-filter-value-input" data-menu-keys="ignore">
      <div className="nc-input focused">
        <input
          autoFocus
          placeholder="Type a value…"
          inputMode={number ? 'decimal' : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const t = e.target.value;
            onChange(t === '' ? undefined : { type: 'exact', value: number ? Number(t) : t });
          }}
        />
      </div>
    </div>
  );
}

function OptionsValue({ leaf, prop, onChange }: { leaf: PropertyFilterLeaf; prop: PropertySchema; onChange: (v: FilterValue[] | undefined) => void }) {
  const [q, setQ] = useState('');
  const vals = valuesOf(leaf.filter.value);
  const isStatus = prop.type === 'status';
  const selected = new Set(vals.map((v) => `${v.type}:${v.value}`));
  const toggle = (v: FilterValue) => {
    const key = `${v.type}:${v.value}`;
    const next = selected.has(key) ? vals.filter((x) => `${x.type}:${x.value}` !== key) : [...vals, v];
    onChange(next.length ? next : undefined);
  };
  const options = (prop.options ?? []).filter((o) => !q || o.value.toLowerCase().includes(q.toLowerCase()));
  const groups = (prop.groups ?? []) as StatusGroup[];
  const row = (key: string, content: ReactNode, v: FilterValue) => (
    <div key={key} role="option" className="nc-filter-option" onClick={() => toggle(v)}>
      <span className={`nc-prop-checkbox ${selected.has(`${v.type}:${v.value}`) ? 'checked' : ''}`}>{selected.has(`${v.type}:${v.value}`) && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
      {content}
    </div>
  );
  return (
    <div className="nc-filter-options" data-menu-keys="ignore">
      <div className="nc-filter-value-input"><div className="nc-input focused"><input autoFocus placeholder="Choose one or more options…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-filter-options-list">
        {isStatus
          ? groups.map((g) => (
              <div key={g.id}>
                {row(`g:${g.id}`, <span className="nc-filter-group-name">{g.name}</span>, { type: 'is_group', value: g.name })}
                {(g.optionIds ?? []).map((id) => options.find((o) => o.id === id)).filter(Boolean).map((o) => row(o!.id, <span className="nc-filter-option-indent"><StatusPill option={o!} /></span>, { type: 'is_option', value: o!.value }))}
              </div>
            ))
          : options.map((o) => row(o.id, <OptionPill option={o} />, { type: 'exact', value: o.value }))}
        {!options.length && !isStatus && <div className="nc-select-editor-empty">No results</div>}
      </div>
      {vals.length > 0 && <div role="button" className="nc-filter-clear" onClick={() => onChange(undefined)}>Clear selection</div>}
    </div>
  );
}

function PeopleValue({ leaf, onChange }: { leaf: PropertyFilterLeaf; onChange: (v: FilterValue[] | undefined) => void }) {
  const [q, setQ] = useState('');
  const vals = valuesOf(leaf.filter.value);
  const has = (v: FilterValue) => vals.some((x) => x.type === v.type && x.value === v.value);
  const toggle = (v: FilterValue) => {
    const next = has(v) ? vals.filter((x) => !(x.type === v.type && x.value === v.value)) : [...vals, v];
    onChange(next.length ? next : undefined);
  };
  const users = workspaceMembers().filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  const me: FilterValue = { type: 'relative', value: 'me' };
  return (
    <div className="nc-filter-options" data-menu-keys="ignore">
      <div className="nc-filter-value-input"><div className="nc-input focused"><input autoFocus placeholder="Find one or more people…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-filter-options-list">
        {(!q || 'me'.includes(q.toLowerCase())) && (
          <div role="option" className="nc-filter-option" onClick={() => toggle(me)}>
            <span className={`nc-prop-checkbox ${has(me) ? 'checked' : ''}`}>{has(me) && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
            <UserAvatar userId={useSession.getState().userId} size={20} />
            <span>Me</span>
          </div>
        )}
        {users.map((u) => {
          const v: FilterValue = { type: 'exact', value: u.id };
          return (
            <div key={u.id} role="option" className="nc-filter-option" onClick={() => toggle(v)}>
              <span className={`nc-prop-checkbox ${has(v) ? 'checked' : ''}`}>{has(v) && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
              <UserAvatar userId={u.id} size={20} />
              <span>{u.name || u.email}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelationValue({ leaf, prop, onChange }: { leaf: PropertyFilterLeaf; prop: PropertySchema; onChange: (v: FilterValue[] | undefined) => void }) {
  const [q, setQ] = useState('');
  const vals = valuesOf(leaf.filter.value);
  // database templates can be picked too: a linked view inside a template filtered by "<relation> contains <this
  // template>" is re-pointed at each page created from the template 
  const target = records.get<CollectionRecord>('collection', String(prop.collection_id ?? ''));
  const pages = [...collectionTemplates(target), ...collectionRows(String(prop.collection_id ?? ''))].filter((p) => !q || toPlainText(p.properties?.title).toLowerCase().includes(q.toLowerCase())).slice(0, 100);
  const has = (id: string) => vals.some((v) => v.value === id);
  // relations to a Sprints database also filter by the Current / Next / Last sprint (relative sprint variables)
  const sprintVars = isSprintsDatabase(records.get<CollectionRecord>('collection', String(prop.collection_id ?? ''))) ? ['current_sprint', 'next_sprint', 'last_sprint'] : [];
  return (
    <div className="nc-filter-options" data-menu-keys="ignore">
      <div className="nc-filter-value-input"><div className="nc-input focused"><input autoFocus placeholder="Find one or more entries…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-filter-options-list">
        {sprintVars.map((sv) => (
          <div key={sv} role="option" className="nc-filter-option" onClick={() => { const next = has(sv) ? vals.filter((v) => v.value !== sv) : [...vals, { type: 'relative' as const, value: sv }]; onChange(next.length ? next : undefined); }}>
            <span className={`nc-prop-checkbox ${has(sv) ? 'checked' : ''}`}>{has(sv) && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
            <span>{RELATIVE_DATE_LABELS[sv]}</span>
          </div>
        ))}
        {pages.map((p) => (
          <div key={p.id} role="option" className="nc-filter-option" onClick={() => { const next = has(p.id) ? vals.filter((v) => v.value !== p.id) : [...vals, { type: 'exact' as const, value: p.id }]; onChange(next.length ? next : undefined); }}>
            <span className={`nc-prop-checkbox ${has(p.id) ? 'checked' : ''}`}>{has(p.id) && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
            <span>{toPlainText(p.properties?.title) || 'Untitled'}{p.is_template && <span className="nc-filter-option-badge"> Template</span>}</span>
          </div>
        ))}
        {!pages.length && <div className="nc-select-editor-empty">No results</div>}
      </div>
    </div>
  );
}

function CheckboxValue({ leaf, onChange }: { leaf: PropertyFilterLeaf; onChange: (v: FilterValue) => void }) {
  const cur = valuesOf(leaf.filter.value)[0]?.value;
  return (
    <div className="nc-filter-options">
      {[true, false].map((b) => (
        <div key={String(b)} role="option" className="nc-filter-option" onClick={() => onChange({ type: 'exact', value: b })}>
          <span className={`nc-prop-checkbox ${b ? 'checked' : ''}`}>{b && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
          <span>{b ? 'Checked' : 'Unchecked'}</span>
          {(cur === b || (cur === undefined && false)) && <Icon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
        </div>
      ))}
    </div>
  );
}

const SINGLE_DATE_OPTIONS = ['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now', 'one_month_ago', 'one_month_from_now'];
const RANGE_OPTIONS = ['the_past_week', 'the_past_month', 'the_past_year', 'the_next_week', 'the_next_month', 'the_next_year', 'this_week'];

function DateValue({ leaf, onChange, onUseEnd }: { leaf: PropertyFilterLeaf; onChange: (v: FilterValue | undefined) => void; onUseEnd: (useEnd: boolean) => void }) {
  const op = leaf.filter.operator;
  const isRange = op === 'date_is_within' || op === 'date_is_relative_to';
  const cur = valuesOf(leaf.filter.value)[0];
  const exactSelected = cur?.type === 'exact';
  const [mode, setMode] = useState<'relative' | 'exact'>(exactSelected ? 'exact' : 'relative');
  const selectRel = (value: string) => {
    if (isRange) {
      const preset: Record<string, FilterValue> = {
        this_week: { type: 'relative', value: 'surrounding', unit: 'week' },
        the_past_week: { type: 'relative', value: 'custom', direction: 'past', count: 1, unit: 'week' },
        the_past_month: { type: 'relative', value: 'custom', direction: 'past', count: 1, unit: 'month' },
        the_past_year: { type: 'relative', value: 'custom', direction: 'past', count: 1, unit: 'year' },
        the_next_week: { type: 'relative', value: 'custom', direction: 'future', count: 1, unit: 'week' },
        the_next_month: { type: 'relative', value: 'custom', direction: 'future', count: 1, unit: 'month' },
        the_next_year: { type: 'relative', value: 'custom', direction: 'future', count: 1, unit: 'year' },
      };
      onChange(preset[value]);
    } else onChange({ type: 'relative', value });
  };
  const isCurrentRel = (value: string) => {
    if (!cur || cur.type !== 'relative') return false;
    if (!isRange) return cur.value === value;
    const label = relativeLabel(cur);
    return label === RELATIVE_DATE_LABELS[value] || (value === 'this_week' && cur.value === 'surrounding' && cur.unit === 'week') || (cur.value === 'custom' && cur.count === 1 && value === `the_${cur.direction === 'future' ? 'next' : 'past'}_${cur.unit}`);
  };
  const custom = cur?.type === 'relative' && cur.value === 'custom' ? cur : { type: 'relative' as const, value: 'custom', direction: 'past' as const, count: 1, unit: 'week' as const };
  return (
    <div className="nc-filter-date" data-menu-keys="ignore">
      <div className="nc-filter-date-mode">
        <span role="button" className={`nc-filter-date-tab ${!leaf.filter.use_end ? 'active' : ''}`} data-tooltip="Matches the start of a date range, or the date itself for single dates." onClick={() => onUseEnd(false)}>Start date</span>
        <span role="button" className={`nc-filter-date-tab ${leaf.filter.use_end ? 'active' : ''}`} data-tooltip="Matches the end of a date range, or the date itself for single dates." onClick={() => onUseEnd(true)}>End date</span>
      </div>
      <div className="nc-filter-options">
        {(isRange ? RANGE_OPTIONS : SINGLE_DATE_OPTIONS).map((v) => (
          <div key={v} role="option" className={`nc-filter-option ${isCurrentRel(v) ? 'selected' : ''}`} onClick={() => { setMode('relative'); selectRel(v); }}>
            <span>{RELATIVE_DATE_LABELS[v]}</span>
            {isCurrentRel(v) && <Icon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
          </div>
        ))}
        {isRange && (
          <div className="nc-filter-relative-range">
            <span>Relative range</span>
            <select value={custom.direction} onChange={(e) => onChange({ ...custom, direction: e.target.value as 'past' | 'future' })}>
              <option value="past">Past</option>
              <option value="future">Next</option>
            </select>
            <input type="number" min={1} value={custom.count ?? 1} onChange={(e) => onChange({ ...custom, count: Math.max(1, Number(e.target.value) || 1) })} />
            <select value={custom.unit} onChange={(e) => onChange({ ...custom, unit: e.target.value as 'day' | 'week' | 'month' | 'year' })}>
              {['day', 'week', 'month', 'year'].map((u) => <option key={u} value={u}>{`${u}${(custom.count ?? 1) === 1 ? '' : 's'}`}</option>)}
            </select>
          </div>
        )}
        <div role="option" className={`nc-filter-option ${mode === 'exact' ? 'selected' : ''}`} onClick={() => setMode('exact')}>
          <span>{isRange ? 'Exact dates' : 'Custom date'}</span>
          {mode === 'exact' && <Icon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
        </div>
      </div>
      {mode === 'exact' && (
        <div className="nc-filter-date-picker">
          <DatePicker
            simple={!isRange}
            value={exactSelected && cur.value && typeof cur.value === 'object' ? { type: cur.value.end_date ? 'daterange' : 'date', start_date: cur.value.start_date, end_date: cur.value.end_date } : null}
            onChange={(d) => onChange(d ? { type: 'exact', value: isRange ? { type: 'daterange', start_date: d.start_date, end_date: d.end_date ?? d.start_date } : { type: 'date', start_date: d.start_date } } : undefined)}
          />
        </div>
      )}
    </div>
  );
}

export function FilterValueEditor({ leaf, prop, onChange }: { leaf: PropertyFilterLeaf; prop: PropertySchema | undefined; onChange: (leaf: PropertyFilterLeaf) => void }) {
  if (!prop) return null;
  const op = leaf.filter.operator;
  if (op === 'is_empty' || op === 'is_not_empty') return null;
  const set = (value: FilterValue | FilterValue[] | undefined) => onChange({ ...leaf, filter: { ...leaf.filter, value } });
  const vt = propertyTypeMeta(prop.type).filterValueType;
  const effective = vt === 'formula' || vt === 'rollup' ? op.split('_')[0] : vt;
  switch (effective) {
    case 'select': case 'multi_select': case 'status': case 'enum':
      return prop.options ? <OptionsValue leaf={leaf} prop={prop} onChange={set} /> : <TextValue leaf={leaf} onChange={set} />;
    case 'person':
      return <PeopleValue leaf={leaf} onChange={set} />;
    case 'relation':
      return <RelationValue leaf={leaf} prop={prop} onChange={set} />;
    case 'checkbox':
      return <CheckboxValue leaf={leaf} onChange={set} />;
    case 'date':
      return <DateValue leaf={leaf} onChange={set} onUseEnd={(u) => onChange({ ...leaf, filter: { ...leaf.filter, use_end: u || undefined } })} />;
    case 'number':
      return <TextValue leaf={leaf} onChange={set} number />;
    default:
      return <TextValue leaf={leaf} onChange={set} />;
  }
}

function operatorMenu(anchor: HTMLElement, prop: PropertySchema, current: string, pick: (op: string) => void) {
  const ops = filterOperatorsFor(prop, resultTypeOf(prop));
  return openNestedMenu(anchor, { width: 200, sections: [{ items: ops.map((o) => ({ id: o, label: FILTER_OPERATOR_LABELS[o] ?? o, checked: o === current, onSelect: () => pick(o) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(anchor), backdrop: 'transparent' });
}

/** Chip editor popover: [Property Operator ▾ •••] + value editor. */
function FilterChipEditor({ viewId, collectionId, filterId, close }: { viewId: string; collectionId: string; filterId: string; close: () => void }) {
  // the view as this person sees it (their unsaved filters, viewState.ts)
  const view = useEffectiveView(useCollectionView(viewId));
  const collection = useCollection(collectionId);
  const entry = view ? propertyFiltersOf(view).find((f) => f.id === filterId) : undefined;
  useEffect(() => {
    if (view && !entry) close();
  }, [view, entry, close]);
  if (!view || !collection || !entry) return null;
  const leaf = entry.filter;
  const prop = collection.schema[leaf.property];
  const update = (next: PropertyFilterLeaf) => updatePropertyFilter(view, filterId, next);
  return (
    <PopoverSurface width={['date', 'created_time', 'last_edited_time', 'last_visited_time'].includes(prop?.type ?? '') ? 300 : 260} className="nc-filter-editor" maxHeight="70vh">
      <div className="nc-filter-editor-head" data-menu-keys="ignore">
        <span className="nc-filter-editor-prop">{prop?.name ?? 'Property'}</span>
        <span role="button" className="nc-filter-editor-op" onClick={(e) => prop && operatorMenu(e.currentTarget, prop, leaf.filter.operator, (op) => update({ ...leaf, filter: { ...leaf.filter, operator: op, ...(op === 'is_empty' || op === 'is_not_empty' ? { value: undefined } : {}) } }))}>
          {/* the header spells the operator in lower case ("Status is ⌄"); the menu keeps "Is" / "Is not" */}
          {(FILTER_OPERATOR_LABELS[leaf.filter.operator] ?? leaf.filter.operator).toLowerCase()}
          <Icon name="arrowChevronSingleDownFillSmall" size={16} />
        </span>
        <span
          role="button"
          className="nc-filter-editor-more"
          aria-label="More actions"
          onClick={(e) => openMenu(e.currentTarget, { width: 240, sections: [{ items: [
            { id: 'del', label: 'Delete filter', icon: 'trash', onSelect: () => { removePropertyFilter(view, filterId); close(); } },
            { id: 'adv', label: 'Add an advanced filter', icon: 'filter', description: 'Group rules with an advanced filter and combine AND/OR conditions.', onSelect: () => {
              const adv = advancedFilterOf(view) ?? { operator: 'and' as const, filters: [] };
              setAdvancedFilter(view, { ...adv, filters: [...adv.filters, leaf] });
              const latest = effectiveView(records.get<CollectionViewRecord>('collection_view', view.id)!);
              removePropertyFilter(latest, filterId);
              close();
            } },
          ] }] }, { placement: 'bottom-end', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}
        >
          <Icon name="ellipsisSmall" size={16} />
        </span>
      </div>
      <FilterValueEditor leaf={leaf} prop={prop} onChange={update} />
    </PopoverSurface>
  );
}

export function openFilterChipEditor(anchor: HTMLElement, view: CollectionViewRecord, collection: CollectionRecord, filterId: string) {
  return openOverlay((close) => <FilterChipEditor viewId={view.id} collectionId={collection.id} filterId={filterId} close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

/** Filter icon opens the “Filter by…” property list and “Create an advanced filter”. */
export function openFilterPropertyPicker(anchor: HTMLElement, opts: { view: CollectionViewRecord; collection: CollectionRecord; onPick: (propId: string) => void }) {
  const { view, collection } = opts;
  const props = propsForPicker(collection.schema, (p) => propertyTypeMeta(p.type).filterValueType !== null && p.type !== 'button');
  const addAdvanced = () => {
    const adv = advancedFilterOf(view) ?? { operator: 'and' as const, filters: [] };
    const first = props.find(([id]) => id === 'title') ?? props[0];
    const leaf: PropertyFilterLeaf = { property: first?.[0] ?? 'title', filter: { operator: defaultFilterOperator(first?.[1]) } };
    setAdvancedFilter(view, { ...adv, filters: [...adv.filters, leaf] });
    setTimeout(() => {
      const chip = document.querySelector<HTMLElement>(`[data-filter-bar="${view.id}"] .nc-filter-chip.advanced`);
      if (chip) openAdvancedFilter(chip, view.id, collection.id);
    }, 60);
  };
  let close: () => void = () => {};
  close = openMenu(anchor, {
    width: 290,
    search: 'Filter by…',
    className: 'nc-db-picker',
    hoverAfterMove: true,
    sections: [
      { items: props.map(([id, p]) => ({ id, label: p.name, icon: <span className="nc-pick-prop"><PropertyIcon prop={p} size={16} style={{ color: 'var(--lp-icon-primary)', transform: 'scale(1.2)' }} /></span>, onSelect: () => opts.onPick(id) })) },
    ],
    footer: (
      <div className="nc-filter-picker-foot">
        <div role="menuitem" className="nc-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); addAdvanced(); }}>
          <div className="nc-menu-item-inner nc-mi">
            <div className="nc-menu-icon" style={{ color: 'var(--lp-icon-secondary)' }}><Icon name="plus" size={20} /></div>
            <div className="nc-menu-label"><div className="nc-ellipsis" style={{ color: 'var(--lp-text-secondary)' }}>Create an advanced filter</div></div>
          </div>
        </div>
      </div>
    ),
  }, { placement: 'bottom-start' });
  return close;
}

// ---------- advanced filter builder ----------

function updateAt(group: FilterGroup, path: number[], fn: (n: FilterNode) => FilterNode | null): FilterGroup {
  if (!path.length) return group;
  const [i, ...rest] = path;
  const filters = [...group.filters];
  if (!rest.length) {
    const r = fn(filters[i]);
    if (r === null) filters.splice(i, 1);
    else filters[i] = r;
  } else {
    filters[i] = updateAt(filters[i] as FilterGroup, rest, fn);
  }
  return { ...group, filters };
}

function AdvancedRows({ group, path, schema, onChange, depth }: { group: FilterGroup; path: number[]; schema: Record<string, PropertySchema>; onChange: (fn: (root: FilterGroup) => FilterGroup) => void; depth: number }) {
  const props = Object.entries(schema).filter(([, p]) => propertyTypeMeta(p.type).filterValueType !== null && p.type !== 'button');
  const setCombinator = (op: 'and' | 'or') => onChange((root) => (path.length ? updateAt(root, path, (n) => ({ ...(n as FilterGroup), operator: op })) : { ...root, operator: op }));
  const addRule = (grp: boolean) => {
    const first = props.find(([id]) => id === 'title') ?? props[0];
    const leaf: PropertyFilterLeaf = { property: first?.[0] ?? 'title', filter: { operator: defaultFilterOperator(first?.[1]) } };
    const node: FilterNode = grp ? { operator: 'and', filters: [leaf] } : leaf;
    onChange((root) => (path.length ? updateAt(root, path, (n) => ({ ...(n as FilterGroup), filters: [...(n as FilterGroup).filters, node] })) : { ...root, filters: [...root.filters, node] }));
  };
  return (
    <div className={`nc-adv-group depth-${depth}`}>
      {group.filters.map((node, i) => {
        const p = [...path, i];
        const lead = i === 0 ? (
          <span className="nc-adv-lead">Where</span>
        ) : i === 1 ? (
          <span role="button" className="nc-adv-lead select" onClick={(e) => openNestedMenu(e.currentTarget, { width: 220, sections: [{ items: [
            { id: 'and', label: 'And', description: 'Every filter must match', checked: group.operator === 'and', onSelect: () => setCombinator('and') },
            { id: 'or', label: 'Or', description: 'Any filter can match', checked: group.operator === 'or', onSelect: () => setCombinator('or') },
          ] }] }, { parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>{group.operator === 'or' ? 'Or' : 'And'}<Icon name="arrowChevronSingleDownSmall" size={12} /></span>
        ) : (
          <span className="nc-adv-lead muted">{group.operator === 'or' ? 'Or' : 'And'}</span>
        );
        const more = (e: React.MouseEvent<HTMLElement>, isGroup: boolean) => openNestedMenu(e.currentTarget, { width: 220, sections: [{ items: [
          { id: 'rm', label: 'Remove', icon: 'trash', onSelect: () => onChange((root) => updateAt(root, p, () => null)) },
          { id: 'dup', label: 'Duplicate', icon: 'duplicate', onSelect: () => onChange((root) => {
            const parentPath = p.slice(0, -1);
            const idx = p[p.length - 1];
            const dupe = (g: FilterGroup) => { const filters = [...g.filters]; filters.splice(idx + 1, 0, structuredClone(g.filters[idx])); return { ...g, filters }; };
            return parentPath.length ? updateAt(root, parentPath, (n) => dupe(n as FilterGroup)) : dupe(root);
          }) },
          ...(isGroup ? [{ id: 'unwrap', label: 'Unwrap group', icon: 'arrowLineRight', onSelect: () => onChange((root) => {
            const parentPath = p.slice(0, -1);
            const idx = p[p.length - 1];
            const unwrap = (g: FilterGroup) => { const inner = (g.filters[idx] as FilterGroup).filters; const filters = [...g.filters]; filters.splice(idx, 1, ...inner); return { ...g, filters }; };
            return parentPath.length ? updateAt(root, parentPath, (n) => unwrap(n as FilterGroup)) : unwrap(root);
          }) }] : depth < 2 ? [{ id: 'wrap', label: 'Place in a group', icon: 'dbGroup', description: 'Group this filter', onSelect: () => onChange((root) => updateAt(root, p, (n) => ({ operator: 'and', filters: [n] }))) }] : []),
        ] as MenuItemDef[] }] }, { placement: 'bottom-end', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' });
        if (isFilterGroup(node)) {
          return (
            <div key={i} className="nc-adv-row group">
              {lead}
              <div className="nc-adv-nested">
                <AdvancedRows group={node} path={p} schema={schema} onChange={onChange} depth={depth + 1} />
              </div>
              <span role="button" className="nc-adv-more" aria-label="More actions" onClick={(e) => more(e, true)}><Icon name="ellipsisSmall" size={16} /></span>
            </div>
          );
        }
        const leaf = node as PropertyFilterLeaf;
        const prop = schema[leaf.property];
        return (
          <div key={i} className="nc-adv-row">
            {lead}
            <span role="button" className="nc-adv-select" onClick={(e) => openNestedMenu(e.currentTarget, { width: 240, search: 'Find a field…', sections: [{ items: props.map(([id, pp]) => ({ id, label: pp.name, icon: <PropertyIcon prop={pp} size={16} />, checked: id === leaf.property, onSelect: () => onChange((root) => updateAt(root, p, () => ({ property: id, filter: { operator: defaultFilterOperator(pp) } }))) })) }] }, { parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
              {prop && <PropertyIcon prop={prop} size={14} />}
              <span className="nc-adv-select-text">{prop?.name ?? 'Property'}</span>
              <Icon name="arrowChevronSingleDownSmall" size={12} />
            </span>
            <span role="button" className="nc-adv-select" onClick={(e) => prop && operatorMenu(e.currentTarget, prop, leaf.filter.operator, (op) => onChange((root) => updateAt(root, p, () => ({ ...leaf, filter: { ...leaf.filter, operator: op, ...(op === 'is_empty' || op === 'is_not_empty' ? { value: undefined } : {}) } }))))}>
              <span className="nc-adv-select-text">{FILTER_OPERATOR_LABELS[leaf.filter.operator] ?? leaf.filter.operator}</span>
              <Icon name="arrowChevronSingleDownSmall" size={12} />
            </span>
            <AdvancedValue leaf={leaf} prop={prop} onChange={(next) => onChange((root) => updateAt(root, p, () => next))} />
            <span role="button" className="nc-adv-more" aria-label="More actions" onClick={(e) => more(e, false)}><Icon name="ellipsisSmall" size={16} /></span>
          </div>
        );
      })}
      <div role="button" className="nc-adv-add" onClick={(e) => openNestedMenu(e.currentTarget, { width: 240, sections: [{ items: [
        { id: 'rule', label: 'Create a filter rule', icon: 'plus', onSelect: () => addRule(false) },
        ...(depth < 2 ? [{ id: 'group', label: 'Create a filter group', icon: 'dbGroup', description: 'A group for nested filters', onSelect: () => addRule(true) }] : []),
      ] }] }, { parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
        <Icon name="plus" size={14} /> Create a filter rule <Icon name="arrowChevronSingleDownSmall" size={12} />
      </div>
    </div>
  );
}

function AdvancedValue({ leaf, prop, onChange }: { leaf: PropertyFilterLeaf; prop: PropertySchema | undefined; onChange: (l: PropertyFilterLeaf) => void }) {
  const op = leaf.filter.operator;
  if (!prop || op === 'is_empty' || op === 'is_not_empty') return <span className="nc-adv-value empty" />;
  const vt = propertyTypeMeta(prop.type).filterValueType;
  if (vt === 'text' || vt === 'number' || ((vt === 'formula' || vt === 'rollup') && (op.startsWith('string') || op.startsWith('number')))) {
    const cur = valuesOf(leaf.filter.value)[0]?.value ?? '';
    return (
      <span className="nc-adv-value" data-menu-keys="ignore">
        <input className="nc-adv-input" placeholder="Value" defaultValue={String(cur)} onChange={(e) => onChange({ ...leaf, filter: { ...leaf.filter, value: e.target.value === '' ? undefined : { type: 'exact', value: vt === 'number' || op.startsWith('number') ? Number(e.target.value) : e.target.value } } })} />
      </span>
    );
  }
  const text = filterValueText(leaf, prop);
  return (
    <span role="button" className="nc-adv-value select" onClick={(e) => openOverlay(() => (
      <PopoverSurface width={300} className="nc-filter-editor"><FilterValueEditorLive leaf={leaf} prop={prop} onChange={onChange} /></PopoverSurface>
    ), { anchor: e.currentTarget, placement: 'bottom-start', parent: overlayIdOf(e.currentTarget) })}>
      <span className={text ? '' : 'placeholder'}>{text || 'Value'}</span>
      <Icon name="arrowChevronSingleDownSmall" size={12} />
    </span>
  );
}

/** Keeps its own copy of the leaf so multi-select toggles accumulate while the popover is open. */
function FilterValueEditorLive({ leaf, prop, onChange }: { leaf: PropertyFilterLeaf; prop: PropertySchema; onChange: (l: PropertyFilterLeaf) => void }) {
  const [cur, setCur] = useState(leaf);
  return <FilterValueEditor leaf={cur} prop={prop} onChange={(n) => { setCur(n); onChange(n); }} />;
}

function AdvancedFilter({ viewId, collectionId, close }: { viewId: string; collectionId: string; close: () => void }) {
  const view = useEffectiveView(useCollectionView(viewId));
  const collection = useCollection(collectionId);
  if (!view || !collection) return null;
  const adv = advancedFilterOf(view) ?? { operator: 'and' as const, filters: [] };
  const change = (fn: (root: FilterGroup) => FilterGroup) => {
    const latest = effectiveView(records.get<CollectionViewRecord>('collection_view', viewId));
    if (!latest) return;
    const root = advancedFilterOf(latest) ?? { operator: 'and' as const, filters: [] };
    setAdvancedFilter(latest, fn(root));
  };
  return (
    <PopoverSurface width={560} className="nc-adv-filter" maxHeight="70vh">
      <div className="lit-scroller vertical nc-adv-scroll">
        <AdvancedRows group={adv} path={[]} schema={collection.schema} onChange={change} depth={0} />
      </div>
      <div className="nc-adv-footer">
        <div role="button" className="nc-menu-item danger-hover" onClick={() => { setAdvancedFilter(view, undefined); close(); }}>
          <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="trash" size={20} /></div><div className="nc-menu-label">Delete filter</div></div>
        </div>
      </div>
    </PopoverSurface>
  );
}

export function openAdvancedFilter(anchor: HTMLElement, viewId: string, collectionId: string) {
  return openOverlay((close) => <AdvancedFilter viewId={viewId} collectionId={collectionId} close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

// ---------- sorts ----------

function SortPopover({ viewId, collectionId, close }: { viewId: string; collectionId: string; close: () => void }) {
  const view = useEffectiveView(useCollectionView(viewId));
  const collection = useCollection(collectionId);
  const [drag, setDrag] = useState<number | null>(null);
  if (!view || !collection) return null;
  const sorts = ((view.query2?.sort ?? []) as SortSpec[]).filter((s) => collection.schema[s.property]);
  const props = propsForPicker(collection.schema, (p) => p.type !== 'button');
  const set = (next: SortSpec[]) => {
    const latest = effectiveView(records.get<CollectionViewRecord>('collection_view', viewId));
    if (latest) setSorts(latest, next);
    if (!next.length) close();
  };
  return (
    <PopoverSurface width={372} className="nc-sort-popover">
      <div className="nc-sort-rows">
        {sorts.map((s, i) => {
          const prop = collection.schema[s.property];
          return (
            <div
              key={`${s.property}-${i}`}
              className="nc-sort-row"
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag === null || drag === i) return;
                const next = [...sorts];
                const [m] = next.splice(drag, 1);
                next.splice(i, 0, m);
                set(next);
                setDrag(null);
              }}
            >
              <span className="nc-sort-drag"><Icon name="dragHandle" size={14} /></span>
              <span role="button" className="nc-adv-select" onClick={(e) => openNestedMenu(e.currentTarget, { width: 240, search: 'Find a field…', sections: [{ items: props.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === s.property, onSelect: () => set(sorts.map((x, j) => (j === i ? { ...x, property: id } : x))) })) }] }, { parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                <PropertyIcon prop={prop} size={14} />
                <span className="nc-adv-select-text">{prop.name}</span>
                <Icon name="arrowChevronSingleDownSmall" size={12} />
              </span>
              <span role="button" className="nc-adv-select" onClick={(e) => openNestedMenu(e.currentTarget, { width: 200, sections: [{ items: [
                { id: 'asc', label: sortDirectionLabel(prop, 'ascending'), checked: s.direction === 'ascending', onSelect: () => set(sorts.map((x, j) => (j === i ? { ...x, direction: 'ascending' as const } : x))) },
                { id: 'desc', label: sortDirectionLabel(prop, 'descending'), checked: s.direction === 'descending', onSelect: () => set(sorts.map((x, j) => (j === i ? { ...x, direction: 'descending' as const } : x))) },
              ] }] }, { parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
                <span className="nc-adv-select-text">{sortDirectionLabel(prop, s.direction === 'descending' ? 'descending' : 'ascending')}</span>
                <Icon name="arrowChevronSingleDownSmall" size={12} />
              </span>
              <span role="button" className="nc-sort-remove" aria-label="Delete sort rule" data-tooltip="Delete sort rule" onClick={() => set(sorts.filter((_, j) => j !== i))}><Icon name="xMarkSmall" size={14} /></span>
            </div>
          );
        })}
      </div>
      <div className="nc-sort-footer">
        <div role="button" className="nc-menu-item" onClick={(e) => openNestedMenu(e.currentTarget, { width: 240, search: 'Sort by…', sections: [{ items: props.filter(([id]) => !sorts.some((s) => s.property === id)).map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => set([...sorts, { property: id, direction: 'ascending' }]) })) }] }, { parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
          <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="plus" size={16} /></div><div className="nc-menu-label">Add sort</div></div>
        </div>
        <div role="button" className="nc-menu-item danger-hover" onClick={() => set([])}>
          <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="trash" size={16} /></div><div className="nc-menu-label">Delete sort</div></div>
        </div>
      </div>
    </PopoverSurface>
  );
}

/** Property pickers list the title first, then every other property alphabetically. */
export function propsForPicker(schema: Record<string, PropertySchema>, keep: (p: PropertySchema, id: string) => boolean = () => true): [string, PropertySchema][] {
  return Object.entries(schema)
    .filter(([id, p]) => keep(p, id))
    .sort(([a, pa], [b, pb]) => (a === 'title' ? -1 : b === 'title' ? 1 : pa.name.localeCompare(pb.name, undefined, { sensitivity: 'base' })));
}

/** Sort direction labels depend on the property type. */
export function sortDirectionLabel(prop: PropertySchema | undefined, dir: 'ascending' | 'descending'): string {
  const t = prop?.type as string | undefined;
  const asc = dir === 'ascending';
  if (!t) return asc ? 'Ascending' : 'Descending';
  if (['title', 'text', 'url', 'email', 'phone_number'].includes(t)) return asc ? 'A → Z' : 'Z → A';
  if (['number', 'auto_increment_id'].includes(t)) return asc ? 'Low → high' : 'High → low';
  if (['date', 'created_time', 'last_edited_time', 'last_visited_time'].includes(t)) return asc ? 'Old → new' : 'New → old';
  if (t === 'checkbox') return asc ? 'Unchecked → checked' : 'Checked → unchecked';
  return asc ? 'Ascending' : 'Descending';
}

/** Sort icon: with sorts → sort rows popover; without → "Sort by…" property list. */
export function openSortMenu(anchor: HTMLElement, opts: { view: CollectionViewRecord; collection: CollectionRecord }) {
  const { view, collection } = opts;
  const sorts = (view.query2?.sort ?? []).filter((s) => collection.schema[s.property]);
  if (!sorts.length) {
    const props = propsForPicker(collection.schema, (p) => p.type !== 'button');
    return openMenu(anchor, {
      width: 290,
      search: 'Sort by…',
      className: 'nc-db-picker',
      hoverAfterMove: true,
      sections: [{ items: props.map(([id, p]) => ({ id, label: p.name, icon: <span className="nc-pick-prop"><PropertyIcon prop={p} size={16} style={{ color: 'var(--lp-icon-primary)', transform: 'scale(1.2)' }} /></span>, onSelect: () => {
        setSorts(view, [{ property: id, direction: 'ascending' }]);
        setTimeout(() => {
          const chip = document.querySelector<HTMLElement>(`[data-filter-bar="${view.id}"] .nc-filter-chip.sort`);
          if (chip) openOverlay((close) => <SortPopover viewId={view.id} collectionId={collection.id} close={close} />, { anchor: chip, placement: 'bottom-start', offset: 4 });
        }, 60);
      } })) }],
    }, { placement: 'bottom-start' });
  }
  const chip = document.querySelector<HTMLElement>(`[data-filter-bar="${view.id}"] .nc-filter-chip.sort`) ?? anchor;
  return openOverlay((close) => <SortPopover viewId={view.id} collectionId={collection.id} close={close} />, { anchor: chip, placement: 'bottom-start', offset: 4 });
}

// ---------- filter bar ----------

export function FilterBar({ view: viewIn, collection, readOnly, openFilterId, onOpened, forceOpen = false, hidden = false }: { view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean; openFilterId: string | null; onOpened: () => void; forceOpen?: boolean; hidden?: boolean }) {
  // personal filters / sorts (viewState.ts): what this person sees + Reset / Save for everyone while they differ
  useViewTempVersion();
  const view = effectiveView(viewIn);
  const dirty = !!dirtyKind(view);
  const chips = propertyFiltersOf(view);
  const adv = advancedFilterOf(view);
  const sorts = ((view.query2?.sort ?? []) as SortSpec[]).filter((s) => collection.schema[s.property]);
  const barRef = useRef<HTMLDivElement>(null);
  const advCount = useMemo(() => {
    const count = (g: FilterGroup): number => g.filters.reduce((n, f) => n + (isFilterGroup(f) ? count(f) : 1), 0);
    return adv ? count(adv) : 0;
  }, [adv]);

  useEffect(() => {
    if (!openFilterId) return;
    const el = barRef.current?.querySelector<HTMLElement>(`[data-filter-id="${openFilterId}"]`);
    if (el) {
      openFilterChipEditor(el, view, collection, openFilterId);
      onOpened();
    }
  }, [openFilterId, chips.length]);

  if (hidden || (!chips.length && !adv && !sorts.length && !forceOpen && !dirty)) return null;
  const sortLabel = sorts.length === 1 ? collection.schema[sorts[0].property]?.name : `${sorts.length} sorts`;
  return (
    <div className="nc-filter-bar" data-filter-bar={view.id} ref={barRef}>
      <div className="nc-filter-bar-inner">
        {sorts.length > 0 && (
          <div role="button" className="nc-filter-chip sort active" onClick={(e) => !readOnly && openSortMenu(e.currentTarget, { view, collection })}>
            <Icon name={sorts.length > 1 ? 'arrowUpDownSmall' : sorts[0].direction === 'descending' ? 'arrowDown' : 'arrowUp'} size={14} />
            <span>{sortLabel}</span>
            <Icon name="arrowChevronSingleDownSmall" size={12} />
          </div>
        )}
        {adv && (
          <div role="button" className="nc-filter-chip advanced active" onClick={(e) => !readOnly && openAdvancedFilter(e.currentTarget, view.id, collection.id)}>
            <Icon name="filterSmall" size={14} />
            <span>{advCount === 1 ? '1 rule' : `${advCount} rules`}</span>
            <Icon name="arrowChevronSingleDownSmall" size={12} />
          </div>
        )}
        {(sorts.length > 0 || adv) && (chips.length > 0 || !readOnly) && <div className="nc-filter-bar-divider" />}
        {chips.map((c) => {
          const prop = collection.schema[c.filter.property];
          const l = chipLabel(c.filter, prop);
          return (
            <div key={c.id} role="button" data-filter-id={c.id} className={`nc-filter-chip ${l.active ? 'active' : ''}`} onClick={(e) => !readOnly && openFilterChipEditor(e.currentTarget, view, collection, c.id)}>
              {prop && <PropertyIcon prop={prop} size={14} style={{ color: 'currentColor' }} />}
              <span className="nc-filter-chip-text">
                <span className="nc-filter-chip-name">{l.name}{l.rest ? ':' : ''}</span>
                {l.rest && <span className="nc-filter-chip-value"> {l.rest}</span>}
              </span>
              <Icon name="arrowChevronSingleDownSmall" size={12} />
            </div>
          );
        })}
        {!readOnly && (
          <div role="button" className="nc-filter-add" onClick={(e) => openFilterPropertyPicker(e.currentTarget, { view, collection, onPick: (pid) => {
            const id = addPropertyFilter(view, { property: pid, filter: { operator: defaultFilterOperator(collection.schema[pid]) } });
            setTimeout(() => {
              const el = barRef.current?.querySelector<HTMLElement>(`[data-filter-id="${id}"]`);
              if (el) openFilterChipEditor(el, records.get<CollectionViewRecord>('collection_view', view.id)!, collection, id);
            }, 30);
          } })}>
            <Icon name="plusSmall" size={14} />
            <span>Filter</span>
          </div>
        )}
        <FilterBarSaveControl view={view} />
      </div>
    </div>
  );
}
