// Property menus: column header menu (Edit property / Change type / Filter / Sort / Group / Calculate /
// Freeze / Hide / Wrap / Insert left|right / Duplicate / Delete), per-type "Edit property" flyouts,
// Calculate / Sort / Change type submenus and the "+ Add property" type picker.
// Item lists and per-type gating follow the configured property definitions.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, PropertyType, SelectOption, SpaceRecord } from '@nc/shared/records.ts';
import {
  AGGREGATION_LABELS, CREATABLE_TYPES, DATE_FORMATS, NUMBER_FORMATS, NUMBER_PRECISIONS, PICKER_SECTIONS, TIME_FORMATS, defaultFilterOperator, defaultGroupBy,
  isGroupable, propertyTypeMeta, timeFormatId, type AggregationSpec, type GroupBy, type StatusGroup, groupByOf, aggregatorName,
} from '@nc/shared/database/index.ts';
import { COLOR_LABELS } from '@nc/shared/colors.ts';
import { records } from '../../../lib/store/records.ts';
import { useCollection, useCollectionView } from '../../../lib/hooks.ts';
import { openMenu, type MenuDef, type MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface, useOverlays } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { toPlainText } from '@nc/shared/richtext.ts';
import {
  addOption, addProperty, changePropertyType, deleteOption, deleteProperty, duplicateProperty, renameProperty, reorderOptions, setAggregation,
  setGroupBy, setPropertyVisible, setSorts, updateOption, updateProperty, updateViewFormat, updateViewProperty, viewProperties, setGroupAggregation,
  deleteIdProperty, permanentlyDeleteProperty, restoreProperty,
} from '../actions.ts';
import { useCollectionAccess } from '../access.ts';
import { PropertyIcon } from './PropertyCell.tsx';
import { OptionPill, StatusPill } from './ValueView.tsx';
import { ColorSwatch } from './editors/SelectEditor.tsx';
import { Toggle, reminderLabel } from './editors/DatePicker.tsx';
import { propertyConfigRegistry, propertyCreatedHooks } from './editorRegistry.ts';
import { REMINDER_OPTIONS_DATE, canRestrictProperty, hasPropertyRule, subitemConfigOf } from '@nc/shared/database/index.ts';
import './properties.css';
import { openNestedMenu } from '../menus.ts';
import { autofillMenuItems, createAutofillProperty } from '../../ai/autofillUi.tsx';

export interface PropMenuContext {
  collectionId: string;
  propId: string;
  view?: CollectionViewRecord;
  block?: BlockRecord;
  readOnly?: boolean;
  /** add a filter chip for this property and open its editor */
  onAddFilter?: (propId: string) => void;
  /** "Insert left/right": open the add-property picker next to this column */
  onInsert?: (side: 'left' | 'right') => void;
  onClose?: () => void;
}

export function overlayIdOf(el: Element | null | undefined): number | undefined {
  const o = el?.closest?.('[data-overlay-id]') as HTMLElement | null;
  return o ? Number(o.dataset.overlayId) : undefined;
}

const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

function col(id: string) {
  return records.get<CollectionRecord>('collection', id);
}

// ---------- sort / calculate / change type submenus ----------

export function sortLabels(type: string): [string, string] {
  switch (type) {
    case 'date': case 'created_time': case 'last_edited_time': case 'last_visited_time':
      return ['Sort old → new', 'Sort new → old'];
    case 'number': case 'auto_increment_id':
      return ['Sort low → high', 'Sort high → low'];
    case 'checkbox':
      return ['Sort unchecked → checked', 'Sort checked → unchecked'];
    case 'select': case 'multi_select': case 'status': case 'rollup': case 'formula':
      return ['Sort ascending', 'Sort descending'];
    default:
      return ['Sort A → Z', 'Sort Z → A'];
  }
}

export function sortMenuDef(view: CollectionViewRecord, propId: string, prop: PropertySchema): MenuDef {
  const [asc, desc] = sortLabels(prop.type);
  const apply = (direction: 'ascending' | 'descending') => {
    const cur = (view.query2?.sort ?? []).filter((s) => s.property !== propId);
    setSorts(view, [{ property: propId, direction }, ...cur]);
  };
  return { width: 200, sections: [{ items: [{ id: 'asc', label: asc, onSelect: () => apply('ascending') }, { id: 'desc', label: desc, onSelect: () => apply('descending') }] }] };
}

function bucketItems(agg: string[], current: string, pick: (a: string) => void): MenuItemDef[] {
  return agg.map((a) => ({ id: a, label: AGGREGATION_LABELS[a]?.full ?? a, checked: current === a, onSelect: () => pick(a) }));
}

/** Calculate submenu (None / Count › / Percent › / Date › | More options ›). */
export function calculateMenuDef(prop: PropertySchema, current: string, pick: (aggregator: string | AggregationSpec['aggregator']) => void, opts?: { limitToggle?: { on: boolean; set: (v: boolean) => void } }): MenuDef {
  const type = prop.type === 'formula' || prop.type === 'rollup' ? ((prop as any).formula2?.result_type?.type ?? 'number') : prop.type;
  const isCheckbox = type === 'checkbox';
  const isNumber = type === 'number' || type === 'auto_increment_id';
  const isDate = ['date', 'created_time', 'last_edited_time', 'last_visited_time'].includes(type);
  const countAggs = isCheckbox ? ['count', 'checked', 'unchecked'] : ['count', 'count_values', 'unique', 'empty', 'not_empty'];
  const pctAggs = isCheckbox ? ['percent_checked', 'percent_unchecked'] : ['percent_empty', 'percent_not_empty'];
  const items: MenuItemDef[] = [
    { id: 'none', label: 'None', checked: !current || current === 'none', onSelect: () => pick('none') },
    {
      id: 'count', label: 'Count', checked: countAggs.includes(current), submenu: () => ({
        width: 250,
        sections: [
          ...(opts?.limitToggle ? [{ items: [{ id: 'limit', label: 'Display large counts as 99+', description: 'This improves performance for large tables.', right: <Toggle on={opts.limitToggle.on} />, onSelect: () => { opts.limitToggle!.set(!opts.limitToggle!.on); return false; } }] }] : []),
          { items: bucketItems(countAggs, current, pick) },
        ],
      }),
    },
    { id: 'percent', label: 'Percent', checked: pctAggs.includes(current), submenu: () => ({ width: 250, sections: [{ items: bucketItems(pctAggs, current, pick) }] }) },
  ];
  if (prop.type === 'status') {
    const groups = (prop.groups ?? []) as StatusGroup[];
    items.push({
      id: 'per_group', label: 'Per group', submenu: () => ({
        width: 250,
        sections: [
          { title: 'Count per group', items: groups.map((g) => ({ id: `c:${g.id}`, label: g.name, onSelect: () => pick({ operator: 'count_per_group', groupName: g.name }) })) },
          { title: 'Percent per group', items: groups.map((g) => ({ id: `p:${g.id}`, label: g.name, onSelect: () => pick({ operator: 'percent_per_group', groupName: g.name }) })) },
        ],
      }),
    });
  }
  if (isDate) items.push({ id: 'date', label: 'Date', checked: ['earliest_date', 'latest_date', 'date_range'].includes(current), submenu: () => ({ width: 250, sections: [{ items: bucketItems(['earliest_date', 'latest_date', 'date_range'], current, pick) }] }) });
  if (isNumber) items.push({ id: 'more', label: 'More options', checked: ['sum', 'average', 'median', 'min', 'max', 'range'].includes(current), submenu: () => ({ width: 250, sections: [{ items: bucketItems(['sum', 'average', 'median', 'min', 'max', 'range'], current, pick) }] }) });
  return { width: 200, sections: [{ items }] };
}

export function changeTypeMenuDef(collectionId: string, propId: string, prop: PropertySchema, onChanged?: (t: PropertyType) => void): MenuDef {
  return {
    width: 200,
    maxHeight: 470,
    sections: [{
      items: CREATABLE_TYPES.map((t) => {
        const meta = propertyTypeMeta(t);
        return {
          id: t,
          label: meta.label,
          icon: <PropertyIcon prop={{ type: t }} size={16} style={{ color: 'var(--lp-icon-primary)' }} />,
          checked: prop.type === t,
          disabled: t === 'auto_increment_id' && prop.type !== t,
          onSelect: async () => {
            // Relation (again, or from another type) asks which data source it relates to 
            const pickTarget = () => { void import('../advanced/RelationConfig.tsx').then((m) => m.openRelationConfig(null, { collectionId, propertyId: propId })); };
            if (prop.type === t) {
              if (t === 'relation') pickTarget();
              return;
            }
            if (prop.type === 'relation') {
              const ok = await confirmDialog({ message: 'This will delete all link values and cannot be undone', confirmLabel: 'Continue' });
              if (!ok) return;
            }
            changePropertyType(collectionId, propId, t);
            onChanged?.(t);
            if (t === 'relation') pickTarget();
          },
        } satisfies MenuItemDef;
      }),
    }],
  };
}

// ---------- "Edit property" flyout ----------

function FlyRow({ icon, label, value, chevron = true, onClick, children }: { icon?: string | ReactNode; label: ReactNode; value?: ReactNode; chevron?: boolean; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; children?: ReactNode }) {
  return (
    <div role="menuitem" className="nc-menu-item nc-fly-row" onClick={onClick} onMouseDown={(e) => e.preventDefault()}>
      <div className="nc-menu-item-inner">
        {icon && <div className="nc-menu-icon">{typeof icon === 'string' ? <Icon name={icon} size={20} /> : icon}</div>}
        <div className="nc-menu-label">{label}</div>
        {value !== undefined && <span className="nc-menu-value">{value}</span>}
        {children}
        {chevron && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />}
      </div>
    </div>
  );
}

function dropdown(anchor: HTMLElement, items: MenuItemDef[], opts?: { width?: number; search?: string; maxHeight?: number }) {
  return openNestedMenu(anchor, { width: opts?.width ?? 250, search: opts?.search, maxHeight: opts?.maxHeight, sections: [{ items }] }, { placement: 'bottom-end', offset: 2, parent: overlayIdOf(anchor), backdrop: 'transparent' });
}

function DateFlyout({ collectionId, propId, prop, timeOnly }: { collectionId: string; propId: string; prop: PropertySchema; timeOnly?: boolean }) {
  const df = (prop.date_format as string | undefined) ?? 'll';
  const tf = prop.time_format as string | undefined;
  const reminder = prop.default_reminder as any;
  return (
    <div className="nc-menu-section">
      <FlyRow icon="viewCalendar" label="Date format" value={DATE_FORMATS.find((f) => f.id === df)?.label ?? 'Full date'} onClick={(e) => dropdown(e.currentTarget, DATE_FORMATS.map((f) => ({ id: f.id, label: f.label, checked: df === f.id, onSelect: () => updateProperty(collectionId, propId, { date_format: f.id }) })))} />
      <FlyRow icon="clock" label="Time format" value={TIME_FORMATS.find((f) => f.id === timeFormatId(tf))?.label} onClick={(e) => dropdown(e.currentTarget, TIME_FORMATS.map((f) => ({ id: f.id, label: f.label, checked: timeFormatId(tf) === f.id, onSelect: () => updateProperty(collectionId, propId, { time_format: f.stored }) })))} />
      {!timeOnly && (
        <FlyRow icon="alarm" label="Notifications" value={reminderLabel(reminder, false)} onClick={(e) => dropdown(e.currentTarget, REMINDER_OPTIONS_DATE.map((o, i) => ({ id: String(i), label: reminderLabel(o as any, false), checked: JSON.stringify(o) === JSON.stringify(reminder ?? { unit: 'none' }), onSelect: () => updateProperty(collectionId, propId, { default_reminder: o.unit === 'none' ? undefined : o }) })))} />
      )}
    </div>
  );
}

function NumberFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const fmt = (prop.number_format as string | undefined) ?? 'number';
  const prec = (prop.number_precision as string | undefined) ?? 'precision_uncapped';
  const showAs = (prop.show_as as { type?: string; color?: string; maxValue?: number; showValue?: boolean } | undefined) ?? undefined;
  const mode = showAs?.type ?? 'number';
  const fmtLabel = (f: (typeof NUMBER_FORMATS)[number]) => (f.currency && f.id !== 'bitcoin' ? `${f.label} (${f.currency})` : f.id === 'bitcoin' ? 'Bitcoin (BTC)' : f.id === 'number_with_commas' ? 'Number with separators' : f.label);
  const setShow = (patch: Record<string, unknown>) => updateProperty(collectionId, propId, { show_as: { type: mode, color: 'green', maxValue: 100, showValue: true, ...(showAs ?? {}), ...patch } });
  return (
    <>
      <div className="nc-menu-section">
        <FlyRow label="Number format" value={fmtLabel(NUMBER_FORMATS.find((f) => f.id === fmt) ?? NUMBER_FORMATS[0])} onClick={(e) => openNestedMenu(e.currentTarget, { width: 192, search: 'Filter formats…', maxHeight: 600, sections: [{ items: NUMBER_FORMATS.map((f) => ({ id: f.id, label: fmtLabel(f), onSelect: () => updateProperty(collectionId, propId, { number_format: f.id }) })) }] }, { placement: 'right-start', parent: overlayIdOf(e.currentTarget) })} />
        <FlyRow label="Decimal places" value={prec === 'precision_uncapped' ? 'Default' : NUMBER_PRECISIONS.find((p) => p.id === prec)?.digits} onClick={(e) => dropdown(e.currentTarget, NUMBER_PRECISIONS.map((p) => ({ id: p.id, label: p.digits === null ? 'Default' : String(p.digits), checked: prec === p.id, onSelect: () => updateProperty(collectionId, propId, { number_precision: p.id }) })))} />
      </div>
      <div className="nc-menu-section with-divider">
        <div className="nc-menu-section-title">Show as</div>
        <div className="nc-show-as-tiles">
          {[
            { id: 'number', label: 'Number', preview: <span className="nc-show-as-42">42</span> },
            { id: 'bar', label: 'Bar', preview: <span className="nc-show-as-bar"><span /></span> },
            { id: 'ring', label: 'Ring', preview: <svg width={20} height={20} viewBox="0 0 20 20"><circle cx={10} cy={10} r={7} fill="none" stroke="var(--lp-border-primary-transparent)" strokeWidth={3} /><circle cx={10} cy={10} r={7} fill="none" stroke="currentColor" strokeWidth={3} strokeDasharray="22 44" transform="rotate(-90 10 10)" /></svg> },
          ].map((tile) => (
            <div key={tile.id} role="button" className={`nc-show-as-tile ${mode === tile.id ? 'selected' : ''}`} onClick={() => (tile.id === 'number' ? updateProperty(collectionId, propId, { show_as: undefined }) : setShow({ type: tile.id }))}>
              <div className="nc-show-as-preview">{tile.preview}</div>
              <div className="nc-show-as-label">{tile.label}</div>
            </div>
          ))}
        </div>
        {mode !== 'number' && (
          <div className="nc-show-as-settings" data-menu-keys="ignore">
            <div className="nc-show-as-row">
              <span>Color</span>
              <span role="button" className="nc-show-as-color" onClick={(e) => dropdown(e.currentTarget, OPTION_COLORS.filter((c) => c !== 'default').map((c) => ({ id: c, label: COLOR_LABELS[c], icon: <ColorSwatch color={c} />, checked: (showAs?.color ?? 'green') === c, onSelect: () => setShow({ color: c }) })), { width: 190 })}>
                <ColorSwatch color={showAs?.color ?? 'green'} />
                {COLOR_LABELS[(showAs?.color ?? 'green') as keyof typeof COLOR_LABELS] ?? 'Green'}
                <Icon name="arrowChevronSingleDownSmall" size={14} />
              </span>
            </div>
            <div className="nc-show-as-row">
              <span>Divide by</span>
              <span className="nc-input nc-show-as-divide"><input defaultValue={String(showAs?.maxValue ?? 100)} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) setShow({ maxValue: n }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></span>
            </div>
            <div className="nc-show-as-row">
              <span>Show number</span>
              <Toggle on={showAs?.showValue !== false} onChange={(v) => setShow({ showValue: v })} />
            </div>
          </div>
        )}
        <div className="nc-fly-footnote">Changes apply to all layouts showing this field.</div>
      </div>
    </>
  );
}

/** Option row "›" submenu: name, description, Delete, (status: Set as default, Group ›), Colors. */
export function optionEditMenuDef(collectionId: string, propId: string, prop: PropertySchema, option: SelectOption): MenuDef {
  let name = option.value;
  const isStatus = prop.type === 'status';
  const groups = (prop.groups ?? []) as StatusGroup[];
  const curGroup = groups.find((g) => g.optionIds?.includes(option.id));
  return {
    width: 220,
    header: (
      <div className="nc-option-menu-head" data-menu-keys="ignore">
        <div className="nc-input focused">
          <input
            autoFocus
            defaultValue={option.value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => (name = e.target.value)}
            onBlur={() => name.trim() && name !== option.value && updateOption(collectionId, propId, option.id, { value: name })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
          />
        </div>
      </div>
    ),
    sections: [
      {
        items: [
          { id: 'delete', label: 'Delete', icon: 'trash', onSelect: () => deleteOption(collectionId, propId, option.id) },
          ...(isStatus ? [
            { id: 'default', label: 'Set as default', icon: 'flag', disabled: prop.defaultOption === option.value, onSelect: () => updateProperty(collectionId, propId, { defaultOption: option.value }) },
            {
              id: 'group', label: 'Group', icon: 'checkmarkSquare', right: <span className="nc-menu-value">{curGroup?.name ?? ''}</span>,
              submenu: () => ({ width: 200, sections: [{ items: groups.map((g) => ({ id: g.id, label: g.name, checked: g.id === curGroup?.id, onSelect: () => {
                const next = groups.map((x) => ({ ...x, optionIds: (x.optionIds ?? []).filter((id) => id !== option.id) }));
                next.find((x) => x.id === g.id)!.optionIds.push(option.id);
                updateProperty(collectionId, propId, { groups: next });
              } })) }] }),
            },
          ] as MenuItemDef[] : []),
        ],
      },
      {
        title: 'Colors',
        items: OPTION_COLORS.map((c) => ({ id: c, label: COLOR_LABELS[c], icon: <ColorSwatch color={c} />, checked: (option.color ?? 'default') === c, onSelect: () => { updateOption(collectionId, propId, option.id, { color: c }); } })),
      },
    ],
  };
}

function OptionsFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const [adding, setAdding] = useState<string | null>(null); // group id ('' for select)
  const [newName, setNewName] = useState('');
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [over, setOver] = useState<{ id: string; before: boolean } | null>(null);
  const isStatus = prop.type === 'status';
  const options = prop.options ?? [];
  const groups = (prop.groups ?? []) as StatusGroup[];
  const sortMode = (prop.option_sort as string | undefined) ?? 'manual';

  const create = (groupId?: string) => {
    if (newName.trim()) addOption(collectionId, propId, newName.trim(), { groupId });
    setNewName('');
    setAdding(null);
  };

  const drop = (targetId: string, before: boolean) => {
    if (!drag || drag.id === targetId) return;
    const ids = options.map((o) => o.id).filter((id) => id !== drag.id);
    const ti = ids.indexOf(targetId);
    ids.splice(before ? ti : ti + 1, 0, drag.id);
    if (isStatus) {
      const next = groups.map((g) => ({ ...g, optionIds: (g.optionIds ?? []).filter((id) => id !== drag.id) }));
      const tg = next.find((g) => g.optionIds.includes(targetId) || groups.find((x) => x.id === g.id)?.optionIds?.includes(targetId));
      if (tg) {
        const pos = tg.optionIds.indexOf(targetId);
        tg.optionIds.splice(before ? pos : pos + 1, 0, drag.id);
      }
      reorderOptions(collectionId, propId, ids, next);
    } else {
      reorderOptions(collectionId, propId, ids);
      if (sortMode !== 'manual') updateProperty(collectionId, propId, { option_sort: 'manual' });
    }
    setDrag(null);
    setOver(null);
  };

  const row = (o: SelectOption) => (
    <div
      key={o.id}
      role="menuitem"
      className={`nc-menu-item nc-option-row ${over?.id === o.id ? (over.before ? 'drop-before' : 'drop-after') : ''}`}
      draggable
      onDragStart={() => setDrag({ id: o.id })}
      onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver({ id: o.id, before: e.clientY < r.top + r.height / 2 }); }}
      onDrop={() => over && drop(over.id, over.before)}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onClick={(e) => openNestedMenu(e.currentTarget, optionEditMenuDef(collectionId, propId, prop, o), { placement: 'right-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}
    >
      <div className="nc-menu-item-inner">
        <span className="nc-option-drag"><Icon name="dragHandle" size={14} /></span>
        <div className="nc-menu-label">{isStatus ? <StatusPill option={o} /> : <OptionPill option={o} />}</div>
        {isStatus && prop.defaultOption === o.value && <span className="nc-option-default">Default</span>}
        <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
      </div>
    </div>
  );

  const adder = (groupId?: string) => adding === (groupId ?? '') && (
    <div className="nc-option-add-input" data-menu-keys="ignore">
      <div className="nc-input focused">
        <input autoFocus placeholder="Type a new option…" value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => create(groupId)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); create(groupId); setAdding(groupId ?? ''); } if (e.key === 'Escape') { e.preventDefault(); setAdding(null); } }} />
      </div>
    </div>
  );

  if (isStatus) {
    return (
      <>
        {groups.map((g, gi) => (
          <div key={g.id} className={`nc-menu-section ${gi ? 'with-divider' : ''}`}>
            <div className="nc-menu-section-title nc-options-title">
              <span>{g.name}</span>
              <span role="button" className="nc-options-add" aria-label="Create an option" onClick={() => { setAdding(g.id); setNewName(''); }}><Icon name="plus" size={14} /></span>
            </div>
            {adder(g.id)}
            {(g.optionIds ?? []).map((id) => options.find((o) => o.id === id)).filter(Boolean).map((o) => row(o!))}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      <div className="nc-menu-section">
        <FlyRow icon="arrowUpDown" label="Sort" value={sortMode === 'alphabetical' ? 'Alphabetical' : sortMode === 'reverse_alphabetical' ? 'Reverse alphabetical' : 'Manual'} onClick={(e) => dropdown(e.currentTarget, [
          { id: 'manual', label: 'Manual', checked: sortMode === 'manual', onSelect: () => updateProperty(collectionId, propId, { option_sort: 'manual' }) },
          { id: 'az', label: 'Alphabetical', checked: sortMode === 'alphabetical', onSelect: () => { const sorted = [...options].sort((a, b) => a.value.localeCompare(b.value)); reorderOptions(collectionId, propId, sorted.map((o) => o.id)); updateProperty(collectionId, propId, { option_sort: 'alphabetical' }); } },
          { id: 'za', label: 'Reverse alphabetical', checked: sortMode === 'reverse_alphabetical', onSelect: () => { const sorted = [...options].sort((a, b) => b.value.localeCompare(a.value)); reorderOptions(collectionId, propId, sorted.map((o) => o.id)); updateProperty(collectionId, propId, { option_sort: 'reverse_alphabetical' }); } },
        ])} />
      </div>
      <div className="nc-menu-section with-divider">
        <div className="nc-menu-section-title nc-options-title">
          <span>Options</span>
          <span role="button" className="nc-options-add" aria-label="Create an option" onClick={() => { setAdding(''); setNewName(''); }}><Icon name="plus" size={14} /></span>
        </div>
        {adder()}
        {options.map(row)}
        {!options.length && adding === null && <div className="nc-options-empty">No options</div>}
      </div>
      <div className="nc-menu-section with-divider">
        <div role="menuitem" className="nc-menu-item disabled"><div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="aiFace" size={20} /></div><div className="nc-menu-label">Generate with AI</div></div></div>
      </div>
    </>
  );
}

const ID_PREFIX = /^[A-Za-z][A-Za-z0-9-]{1,9}$/;

function IdFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const [prefix, setPrefix] = useState((prop.prefix as string | undefined) ?? '');
  const [error, setError] = useState('');
  const suggestion = (toPlainText(col(collectionId)?.name as any) || 'TAS').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'TAS';
  const shown = prefix || suggestion;
  const apply = () => {
    const next = (prefix || suggestion).toUpperCase();
    // The server validates the same prefix format.
    if (!ID_PREFIX.test(next)) return setError('The prefix must begin with a letter, followed by up to 9 letters, numbers, or hyphens.');
    setError('');
    updateProperty(collectionId, propId, { prefix: next });
    setPrefix(next);
  };
  return (
    <div className="nc-menu-section nc-id-flyout" data-menu-keys="ignore">
      <div className="nc-id-prefix-row">
        <span className="nc-id-prefix-label">Prefix</span>
        <span className="nc-input"><input placeholder={suggestion} value={prefix} data-testid="id-prefix" onChange={(e) => { setError(''); setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10)); }} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} /></span>
      </div>
      <div className="nc-id-preview">{`${shown}-1, ${shown}-2, ${shown}-3, …`}</div>
      {error && <div className="nc-id-error" role="alert">{error}</div>}
      <div role="button" className="nc-btn primary nc-id-apply" data-testid="id-prefix-apply" onClick={apply}>
        <Icon name="plus" size={14} />{prop.prefix ? 'Update ID Prefix' : 'Create ID prefix'}
      </div>
    </div>
  );
}

/** Person property notifications: who is notified when someone is added. */
const NOTIFY_LABEL: Record<string, string> = { users_and_groups: 'Users and groups', users: 'Users only', none: 'None' };

function LimitFlyout({ collectionId, propId, prop, kind }: { collectionId: string; propId: string; prop: PropertySchema; kind: 'person' | 'file' }) {
  const limit = prop.limit === 1 ? 1 : 0;
  return (
    <div className="nc-menu-section">
      <FlyRow icon="numbers123" label="Limit" value={limit ? `1 ${kind === 'person' ? 'person' : 'file'}` : 'No limit'} onClick={(e) => dropdown(e.currentTarget, [
        { id: 'none', label: 'No limit', checked: !limit, onSelect: () => updateProperty(collectionId, propId, { limit: undefined }) },
        { id: 'one', label: `1 ${kind === 'person' ? 'person' : 'file'}`, checked: limit === 1, onSelect: () => updateProperty(collectionId, propId, { limit: 1 }) },
      ])} />
      {kind === 'person' && (
        <>
          <FlyRow icon="personCircle" label="Default" value={prop.default === 'created_by' ? 'Created by' : 'No default'} onClick={(e) => dropdown(e.currentTarget, [
            { id: 'none', label: 'No default', checked: prop.default !== 'created_by', onSelect: () => updateProperty(collectionId, propId, { default: undefined }) },
            { id: 'cb', label: 'Created by', checked: prop.default === 'created_by', onSelect: () => updateProperty(collectionId, propId, { default: 'created_by' }) },
          ])} />
          <FlyRow icon="bell" label="Notifications" value={NOTIFY_LABEL[(prop.notification_mode as string | undefined) ?? 'users'] ?? 'Users only'} onClick={(e) => dropdown(e.currentTarget, (['users_and_groups', 'users', 'none'] as const).map((m) => ({
            id: m, label: NOTIFY_LABEL[m], checked: ((prop.notification_mode as string | undefined) ?? 'users') === m, onSelect: () => updateProperty(collectionId, propId, { notification_mode: m === 'users' ? undefined : m }),
          })))} />
        </>
      )}
    </div>
  );
}

/** Fallback rollup/relation/formula config used until the formula/relation/rollup work stream registers its own. */
function ComputedFallbackFlyout({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const c = col(collectionId)!;
  if (prop.type === 'relation') {
    const target = records.get<CollectionRecord>('collection', String(prop.collection_id ?? ''));
    const all = records.all<CollectionRecord>('collection').filter((x) => x.alive !== false);
    return (
      <div className="nc-menu-section">
        <FlyRow icon="arrowDiagonalUpRight" label="Related to" value={target ? toPlainText(target.name as any) || 'Untitled' : 'Select'} onClick={(e) => dropdown(e.currentTarget, all.map((x) => ({ id: x.id, label: toPlainText(x.name as any) || 'Untitled', checked: x.id === target?.id, onSelect: () => updateProperty(collectionId, propId, { collection_id: x.id, collection_pointer: { id: x.id, table: 'collection', spaceId: x.space_id } }) })), { width: 280, search: 'Search datasets…' })} />
        <FlyRow icon="numbers123" label="Limit" value={prop.limit === 1 ? '1 page' : 'No limit'} onClick={(e) => dropdown(e.currentTarget, [
          { id: 'none', label: 'No limit', checked: prop.limit !== 1, onSelect: () => updateProperty(collectionId, propId, { limit: undefined }) },
          { id: 'one', label: '1 page', checked: prop.limit === 1, onSelect: () => updateProperty(collectionId, propId, { limit: 1 }) },
        ])} />
      </div>
    );
  }
  if (prop.type === 'rollup') {
    const rels = Object.entries(c.schema).filter(([, p]) => p.type === 'relation');
    const rel = c.schema[String(prop.relation_property ?? '')];
    const target = records.get<CollectionRecord>('collection', String(rel?.collection_id ?? ''));
    const targetProp = target?.schema[String(prop.target_property ?? '')];
    const agg = typeof prop.aggregation === 'string' ? prop.aggregation : 'show_original';
    return (
      <div className="nc-menu-section">
        <FlyRow icon="arrowDiagonalUpRight" label="Relation" value={rel?.name ?? 'Select'} onClick={(e) => dropdown(e.currentTarget, rels.map(([id, p]) => ({ id, label: p.name, checked: id === prop.relation_property, onSelect: () => updateProperty(collectionId, propId, { relation_property: id }) })), { width: 280 })} />
        <FlyRow icon="pathRoundEnds" label="Property" value={targetProp?.name ?? 'Select'} onClick={(e) => target && dropdown(e.currentTarget, Object.entries(target.schema).map(([id, p]) => ({ id, label: p.name, checked: id === prop.target_property, onSelect: () => updateProperty(collectionId, propId, { target_property: id, target_property_type: p.type }) })), { width: 280 })} />
        <FlyRow icon="sum" label="Calculate" value={agg === 'show_original' ? 'Show original' : AGGREGATION_LABELS[agg]?.full ?? agg} onClick={(e) => openNestedMenu(e.currentTarget, {
          width: 200,
          sections: [{ items: [
            { id: 'orig', label: 'Show original', checked: agg === 'show_original', onSelect: () => updateProperty(collectionId, propId, { aggregation: 'show_original' }) },
            { id: 'uniq', label: 'Display unique values', checked: agg === 'show_unique', onSelect: () => updateProperty(collectionId, propId, { aggregation: 'show_unique' }) },
            ...calculateMenuDef(targetProp ?? { name: '', type: 'number' }, agg, (a) => updateProperty(collectionId, propId, { aggregation: a as any })).sections[0].items.slice(1),
          ] }],
        }, { placement: 'right-start', parent: overlayIdOf(e.currentTarget) })} />
      </div>
    );
  }
  // formula
  return <FormulaFallback collectionId={collectionId} propId={propId} prop={prop} />;
}

function FormulaFallback({ collectionId, propId, prop }: { collectionId: string; propId: string; prop: PropertySchema }) {
  const f2 = (prop as any).formula2;
  const initial = typeof f2?.code === 'string' ? f2.code : toPlainText(f2?.code) || (prop.formula as any)?.expression || '';
  const [code, setCode] = useState(initial);
  return (
    <div className="nc-menu-section nc-formula-fallback" data-menu-keys="ignore">
      <div className="nc-menu-section-title">Formula</div>
      <textarea className="nc-formula-input" value={code} placeholder='e.g. prop("Number") * 2' onChange={(e) => setCode(e.target.value)} onBlur={() => updateProperty(collectionId, propId, { version: 'v2', formula2: { code: code ? [[code]] : [], result_type: f2?.result_type ?? { type: 'text' } }, formula: { expression: code } })} />
    </div>
  );
}

export function hasEditFlyout(prop: PropertySchema): boolean {
  if (propertyConfigRegistry[prop.type]) return true;
  return ['date', 'created_time', 'last_edited_time', 'number', 'select', 'multi_select', 'status', 'person', 'file', 'auto_increment_id', 'rollup', 'relation', 'formula'].includes(prop.type);
}

/** Body of the "Edit property" flyout for a property type. */
export function EditPropertyBody({ collectionId, propId, view, close }: { collectionId: string; propId: string; view?: CollectionViewRecord; close?: () => void }) {
  const c = useCollection(collectionId);
  const prop = c?.schema[propId];
  if (!c || !prop) return null;
  const Custom = propertyConfigRegistry[prop.type];
  if (Custom) return <Custom collection={c} propId={propId} prop={prop} view={view} close={close ?? (() => {})} />;
  switch (prop.type) {
    case 'date': return <DateFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'created_time': case 'last_edited_time': return <DateFlyout collectionId={collectionId} propId={propId} prop={prop} timeOnly />;
    case 'number': return <NumberFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'select': case 'multi_select': case 'status': return <OptionsFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'person': return <LimitFlyout collectionId={collectionId} propId={propId} prop={prop} kind="person" />;
    case 'file': return <LimitFlyout collectionId={collectionId} propId={propId} prop={prop} kind="file" />;
    case 'auto_increment_id': return <IdFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    case 'rollup': case 'relation': case 'formula': return <ComputedFallbackFlyout collectionId={collectionId} propId={propId} prop={prop} />;
    default: return <div className="nc-menu-empty">No options for this property type</div>;
  }
}

function editFlyoutDef(collectionId: string, propId: string, view?: CollectionViewRecord): MenuDef {
  return { width: 300, header: <div data-menu-keys="ignore" className="nc-edit-flyout"><EditPropertyBody collectionId={collectionId} propId={propId} view={view} /></div>, sections: [{ items: [] }], maxHeight: '80vh' };
}

/** Open the "Edit property" body as a standalone popover (page property labels, view settings). */
export function openEditPropertyPopover(anchor: HTMLElement | DOMRect, collectionId: string, propId: string, view?: CollectionViewRecord, opts?: { placement?: 'bottom-start' | 'right-start' }) {
  return openOverlay((close) => (
    <PopoverSurface width={300} maxHeight="80vh" className="nc-edit-property-popover">
      <div className="lit-scroller vertical" data-menu-keys="ignore">
        <PropertyDetailHead collectionId={collectionId} propId={propId} />
        <EditPropertyBody collectionId={collectionId} propId={propId} view={view} close={close} />
        <PropertyDetailActions collectionId={collectionId} propId={propId} view={view} close={close} />
      </div>
    </PopoverSurface>
  ), { anchor, placement: opts?.placement ?? 'bottom-start', offset: 1 });
}

/** Property detail (View settings › Properties › property): name / icon row when the person may edit the schema. */
function PropertyDetailHead({ collectionId, propId }: { collectionId: string; propId: string }) {
  const access = useCollectionAccess(collectionId);
  if (!access.canEditStructure) return null;
  return <PropertyNameHeader collectionId={collectionId} propId={propId} />;
}

/** "Duplicate property" / "Delete property" at the bottom of the property detail. */
function PropertyDetailActions({ collectionId, propId, view, close }: { collectionId: string; propId: string; view?: CollectionViewRecord; close: () => void }) {
  const c = useCollection(collectionId);
  const access = useCollectionAccess(collectionId);
  const prop = c?.schema[propId];
  if (!c || !prop || !access.canEditStructure || propId === 'title' || prop.type === 'title') return null;
  return (
    <div className="nc-menu-section nc-prop-detail-actions">
      <div className="nc-menu-divider" />
      {prop.type !== 'auto_increment_id' && <FlyRow icon="dbDuplicate" label="Duplicate property" chevron={false} onClick={() => { duplicateProperty(collectionId, propId, view); close(); }} />}
      <FlyRow icon="dbTrash" label="Delete property" chevron={false} onClick={() => { close(); setTimeout(() => void confirmDeleteProperty(collectionId, propId), 0); }} />
    </div>
  );
}

/** View settings › Properties › Deleted properties: Restore / Delete per property, Permanently delete all. */
export function deletedPropertiesMenuDef(collectionId: string): MenuDef {
  const c = col(collectionId);
  const deleted = Object.entries(((c?.deleted_schema ?? {}) as Record<string, PropertySchema>)).filter(([, p]) => !!p);
  const removeOne = async (id: string) => {
    const ok = await confirmDialog({ message: 'Are you sure you want to delete this field?', confirmLabel: 'Delete', danger: true, width: 300 });
    if (ok) permanentlyDeleteProperty(collectionId, id);
  };
  const removeAll = async () => {
    const ok = await confirmDialog({ message: 'Permanently delete all fields?', description: 'This action cannot be undone.', confirmLabel: 'Permanently delete all', danger: true, width: 320 });
    if (ok) for (const [id] of deleted) permanentlyDeleteProperty(collectionId, id);
  };
  return {
    width: 280,
    sections: [
      { items: deleted.map(([id, p]) => ({
        id, label: p.name, icon: <PropertyIcon prop={p} size={16} />,
        submenu: () => ({ width: 200, sections: [{ items: [
          { id: 'restore', label: 'Restore', icon: 'undo', onSelect: () => restoreProperty(collectionId, id) },
          { id: 'delete', label: 'Delete', icon: 'trash', onSelect: () => { setTimeout(() => void removeOne(id), 0); } },
        ] }] }),
      })) },
      ...(deleted.length ? [{ items: [{ id: 'all', label: 'Permanently delete all', icon: 'trash', onSelect: () => { setTimeout(() => void removeAll(), 0); } }] }] : []),
    ],
  };
}

// ---------- header row (icon / name / description) ----------

function PropertyNameHeader({ collectionId, propId, autoFocus }: { collectionId: string; propId: string; autoFocus?: boolean }) {
  const c = useCollection(collectionId);
  const prop = c?.schema[propId];
  const [name, setName] = useState(prop?.name ?? '');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // header-menu-status: the name field is focused (caret at the end) when a property's menu opens;
    // the title column’s menu leaves it unfocused
  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);
  if (!c || !prop) return null;
  const commit = () => {
    const n = name.trim();
    if (!n || n === prop.name) return;
    const dup = Object.entries(c.schema).some(([id, p]) => id !== propId && p.name.toLowerCase() === n.toLowerCase());
    if (dup) {
      setError(`A field named ${n} already exists in this table.`);
      return;
    }
    setError('');
    renameProperty(collectionId, propId, n);
  };
  return (
    <div className="nc-prop-menu-head" data-menu-keys="ignore">
      <div className="nc-prop-menu-head-row">
        <div role="button" className="nc-prop-icon-btn" aria-label="Change icon" onClick={(e) => openIconPicker(e.currentTarget, { current: prop.icon as string | undefined, onPick: (v) => updateProperty(collectionId, propId, { icon: v ?? undefined }) })}>
          <PropertyIcon prop={prop} size={14} style={{ color: 'rgb(85, 83, 78)' }} />
        </div>
        <div className="nc-input nc-prop-name-input">
          <input
            ref={inputRef}
            value={name}
            placeholder="Property name"
            onChange={(e) => { setName(e.target.value); setError(''); }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
                if (!error) useOverlays.getState().closeAll();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                useOverlays.getState().closeAll();
              }
            }}
          />
          <span
            role="button"
            className="nc-prop-desc-btn"
            aria-label={prop.description ? 'Edit field description' : 'Create field description'}
            data-tooltip={prop.description ? String(prop.description) : 'Create field description'}
            onClick={(e) => openDescriptionPopover(e.currentTarget, collectionId, propId)}
          >
            <Icon name="infoCircleFill" size={20} />
          </span>
        </div>
      </div>
      {error && <div className="nc-prop-name-error">{error}</div>}
    </div>
  );
}

function openDescriptionPopover(anchor: HTMLElement, collectionId: string, propId: string) {
  const prop = col(collectionId)?.schema[propId];
  let text = String(prop?.description ?? '');
  openOverlay((close) => (
    <PopoverSurface width={280} className="nc-prop-desc-popover">
      <div data-menu-keys="ignore" className="nc-prop-desc-body">
        <textarea autoFocus defaultValue={text} placeholder="Add a description…" onChange={(e) => (text = e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); close(); } }} />
      </div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', parent: overlayIdOf(anchor), onClose: () => updateProperty(collectionId, propId, { description: text.trim() || undefined }) });
}

// ---------- column header menu ----------

const AI_AUTOFILL_TYPES = new Set(['text', 'checkbox', 'multi_select', 'select', 'number', 'person', 'url', 'date', 'email', 'phone_number', 'status']);
const NO_ACCESS = new Set(['created_by', 'created_time', 'auto_increment_id', 'last_edited_by', 'last_edited_time', 'title']);

export function openPropertyHeaderMenu(anchor: HTMLElement, ctx: PropMenuContext): () => void {
  const c = col(ctx.collectionId);
  const prop = c?.schema[ctx.propId];
  if (!c || !prop) return () => {};
  const view = ctx.view;
  const { propId, collectionId } = ctx;
  const type = prop.type;
  const isTitle = propId === 'title' || type === 'title';
  const entries = view ? viewProperties(view, c.schema) : [];
  const entry = entries.find((e) => e.property === propId);
  const fmt = (view?.format ?? {}) as Record<string, any>;
  const tableWrap = fmt.table_wrap !== false;
  const wrapped = entry?.wrap ?? tableWrap;
  const gb = view ? groupByOf(view, c.schema) : null;
  const groupedHere = gb?.property === propId;
  const visible = entries.filter((e) => e.visible);
  const frozenIdx = typeof fmt.table_frozen_column_index === 'number' ? fmt.table_frozen_column_index : -1;
  const myIdx = visible.findIndex((e) => e.property === propId);
  const frozenHere = frozenIdx >= 0 && myIdx >= 0 && myIdx <= frozenIdx;
  const currentAgg = view ? aggregatorName((view.query2?.aggregations ?? []).find((a) => a.property === propId) as AggregationSpec | undefined) : 'none';

  const s2: MenuItemDef[] = [];
  if (isTitle && view) s2.push({ id: 'pageicon', label: 'Display entry icon', icon: 'emojiFace', right: <Toggle on={fmt.show_page_icon !== false} decorative />, onSelect: () => { updateViewFormat(view.id, { show_page_icon: fmt.show_page_icon === false }); return false; } });
  if (type === 'url') s2.push({ id: 'fullurl', label: 'Display full URL', icon: 'arrowExpandHorizontal', right: <Toggle on={prop.show_full_url === true} />, onSelect: () => { updateProperty(collectionId, propId, { show_full_url: prop.show_full_url !== true }); return false; } });
  if (type === 'button') s2.push({ id: 'automation', label: 'Edit automation', icon: 'pencilLine', onSelect: () => openButtonConfig(collectionId, propId) });
  if (!ctx.readOnly && hasEditFlyout(prop) && !isTitle) s2.push({ id: 'edit', label: 'Edit property', icon: 'slidersTwo', submenu: () => editFlyoutDef(collectionId, propId, view) });
  if (!NO_ACCESS.has(type) && canRestrictProperty(prop, propId, subitemPairOf(c))) s2.push({ id: 'access', label: 'Property access', icon: 'lockKeyhole', right: hasPropertyRule(prop) ? <span className="nc-menu-value">On</span> : undefined, onSelect: () => openPropertyAccess(collectionId, propId) });
  if (!isTitle && type !== 'auto_increment_id' && !ctx.readOnly) s2.push({ id: 'type', label: 'Change type', icon: 'dbTurnInto', submenu: () => changeTypeMenuDef(collectionId, propId, prop) });
  // header-menu-name / -status: "AI Autofill ›" (no promo badge any more), also on the title column
  if (AI_AUTOFILL_TYPES.has(type) || isTitle) s2.push({
    id: 'ai', label: 'AI Autofill', icon: 'magicWandSparkle',
    // Basic autofill is configured / run by features/ai; Custom Agent autofill comes with Custom Agents
    submenu: () => ({ width: 260, sections: [{ items: [
      ...(ctx.readOnly ? [{ id: 'basic', label: 'Basic', icon: 'magicWand', description: 'Not available for this field type', disabled: true }] : autofillMenuItems(collectionId, propId, view, anchor)),
      { id: 'agent', label: 'Custom Agent', icon: 'aiFace', badge: 'New', description: 'Uses advanced models to fill fields based on web search and your connected workspace.', disabled: true },
    ] }] }),
  });

  const s3: MenuItemDef[] = [];
  if (view && type !== 'button') {
    s3.push({ id: 'filter', label: 'Filter', icon: 'dbFilter', onSelect: () => ctx.onAddFilter?.(propId) });
    s3.push({ id: 'sort', label: 'Sort', icon: 'arrowUpDownSmall', disabled: type === 'rollup' && (prop.aggregation ?? 'show_original') === 'show_original', submenu: () => sortMenuDef(view, propId, prop) });
    if (isGroupable(prop) && !['file', 'place', 'auto_increment_id'].includes(type) && !(type === 'rollup' && (prop.aggregation ?? 'show_original') === 'show_original')) {
      s3.push(groupedHere
        ? { id: 'ungroup', label: 'Ungroup', icon: 'dbGroup', onSelect: () => setGroupBy(view, null) }
        : { id: 'group', label: 'Group', icon: 'dbGroup', onSelect: () => setGroupBy(view, defaultGroupBy(prop, propId, { board: view.type === 'board' }) as GroupBy) });
    }
    s3.push({ id: 'calc', label: 'Calculate', icon: 'sum', submenu: () => calculateMenuDef(prop, currentAgg, (a) => setAggregation(view, propId, a as any)) });
  }
  if (view?.type === 'table') {
    s3.push(frozenHere
      ? { id: 'unfreeze', label: frozenIdx > 0 ? 'Unfreeze columns' : 'Unfreeze column', icon: 'pinSlash', onSelect: () => updateViewFormat(view.id, { table_frozen_column_index: -1 }) }
      : { id: 'freeze', label: 'Freeze', icon: 'dbPin', onSelect: () => updateViewFormat(view.id, { table_frozen_column_index: Math.max(0, myIdx) }) });
  }
  if (view && !isTitle) s3.push({ id: 'hide', label: 'Hide', icon: 'dbEyeSlash', onSelect: () => setPropertyVisible(view, c.schema, propId, false) });
  if (view && type !== 'checkbox' && type !== 'button') {
    s3.push({ id: 'wrap', label: wrapped ? 'Unwrap content' : 'Wrap content', icon: wrapped ? 'arrowLineRight' : 'arrowUTurnDownLeft', onSelect: () => updateViewProperty(view, c.schema, propId, { wrap: !wrapped }, wrapped ? 'unwrapColumn' : 'wrapColumn') });
  }
  if (view && type === 'status') {
    const showAs = (entry?.statusShowAs as string | undefined) ?? 'select';
    s3.push({ id: 'displayas', label: 'Display as', icon: 'dbEye', right: <span className="nc-menu-value">{showAs === 'checkbox' ? 'Checkbox' : 'Select'}</span>, submenu: () => ({ width: 200, sections: [{ items: [
      { id: 'cb', label: 'Checkbox', icon: 'checkmarkSquare', checked: showAs === 'checkbox', onSelect: () => updateViewProperty(view, c.schema, propId, { statusShowAs: 'checkbox' }) },
      { id: 'sel', label: 'Select', icon: 'arrowTriangleDownCircle', checked: showAs !== 'checkbox', onSelect: () => updateViewProperty(view, c.schema, propId, { statusShowAs: undefined }) },
    ] }] }) });
  }

  const s4: MenuItemDef[] = [];
  if (view && !ctx.readOnly) {
    s4.push({ id: 'left', label: 'Insert left', icon: 'arrowRectangleLeft', onSelect: () => ctx.onInsert?.('left') });
    s4.push({ id: 'right', label: 'Insert right', icon: 'arrowRectangleRight', onSelect: () => ctx.onInsert?.('right') });
  }
  if (!isTitle && type !== 'auto_increment_id' && !ctx.readOnly) s4.push({ id: 'dup', label: 'Duplicate property', icon: 'dbDuplicate', onSelect: () => duplicateProperty(collectionId, propId, view) });
  if (!isTitle && !ctx.readOnly) s4.push({ id: 'delete', label: 'Delete property', icon: 'dbTrash', danger: false, onSelect: () => { setTimeout(() => void confirmDeleteProperty(collectionId, propId), 0); } });

  const sections = [{ items: s2 }, { items: s3 }, { items: s4 }].filter((s) => s.items.length);
  //: min-width 220, rows with a toggle make it ~243; the popover sits 6px left of the header cell
  // (dialog margin-inline-start -6px) and opens with no highlighted row; the name field takes focus except on the
    // title column behavior differs from other columns
  const hasToggle = s2.some((it) => it.id === 'pageicon' || it.id === 'fullurl');
  const r = anchor.getBoundingClientRect();
  return openMenu(new DOMRect(r.left - 6, r.top, r.width, r.height), {
    // header-menu-name: the title menu (with the "Display entry icon" toggle) is 243.3 wide, the others 220
    width: hasToggle ? 243.3 : 220,
    role: 'menu',
    initialActive: -1,
    header: ctx.readOnly ? undefined : <PropertyNameHeader collectionId={collectionId} propId={propId} autoFocus={!isTitle} />,
    sections,
  }, { placement: 'bottom-start', offset: 0, onClose: ctx.onClose });
}

export async function confirmDeleteProperty(collectionId: string, propId: string) {
  const c = col(collectionId);
  if (!c) return;
  if (c.schema[propId]?.type === 'auto_increment_id') {
    // IDs have no "Deleted properties" entry.
    const sure = await confirmDialog({ message: 'The ID field will be permanently deleted.', confirmLabel: 'Delete', danger: true, width: 300 });
    if (sure) deleteIdProperty(collectionId, propId);
    return;
  }
  const name = toPlainText(c.name as any) || 'this database';
  const ok = await confirmDialog({ message: `Delete this field from ${name}? It will be removed from all layouts.`, confirmLabel: 'Delete', width: 300 });
  if (ok) deleteProperty(collectionId, propId);
}

/** Property access: the rule dialog with the other database permissions UI. */
function openPropertyAccess(collectionId: string, propId: string) {
  void import('../permissions/PropertyAccess.tsx').then((m) => m.openPropertyAccessDialog(collectionId, propId));
}

/** Sub-item relation pair (can't get access rules). */
function subitemPairOf(c: CollectionRecord): string[] {
  const cfg = subitemConfigOf(c);
  return cfg ? [cfg.property, cfg.inverse] : [];
}

// ---------- "+ Add property" ----------

export interface AddPropertyOptions {
  collectionId: string;
  view?: CollectionViewRecord;
  afterPropId?: string;
  beforePropId?: string;
  /** called with the new property id (e.g. to open the relation panel) */
  onCreated?: (propId: string, type: PropertyType) => void;
  /** anchor rect is the header cell slot; the name row overlays it */
  overlayHeader?: boolean;
  anchor?: HTMLElement | DOMRect;
  /** called when the menu closes (the table drops its pending column slot) */
  onClose?: () => void;
}

// AI Autofill presets of the "+ Add property" card (05-database-.1)
const AI_PRESETS = [
  { id: 'sum', label: 'Summarize', icon: 'textAlignLeft', options: ['Paragraph', 'Bullets', 'One-liner'] },
  { id: 'tr', label: 'Translate', icon: 'textTranslate', options: ['English', 'Korean', 'Chinese Simplified', 'Chinese Traditional', 'Japanese', 'Spanish', 'Russian', 'French', 'Portuguese', 'German', 'Italian', 'Dutch', 'Indonesian', 'Filipino', 'Vietnamese'] },
];

function AddPropertyMenu({ opts, close }: { opts: AddPropertyOptions; close: () => void }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const view = useCollectionView(opts.view?.id);
  const choose = (type: PropertyType) => {
    const pid = addProperty(opts.collectionId, type, { name, view: view ?? opts.view, afterPropId: opts.afterPropId, beforePropId: opts.beforePropId });
    close();
    if (!pid) return;
    opts.onCreated?.(pid, type);
    propertyCreatedHooks[type]?.({ anchor: opts.anchor ?? null, collectionId: opts.collectionId, propId: pid, viewId: (view ?? opts.view)?.id });
  };
  // Verification: wikis and Business / Enterprise workspaces, one per database
  const c = useCollection(opts.collectionId);
  const space = c ? records.get<SpaceRecord>('space', c.space_id) : undefined;
  const canVerify = !!c && !Object.values(c.schema).some((p) => p?.type === 'verification')
    && (!!(c.format as Record<string, unknown> | undefined)?.is_wiki || space?.plan_type === 'business' || space?.plan_type === 'enterprise');
  const picker = PICKER_SECTIONS.map((s) => (s.id === 'advanced' && canVerify ? { ...s, types: [...s.types, 'verification' as PropertyType] } : s));
  const sections = picker.map((s) => ({ ...s, types: s.types.filter((t) => query === null || propertyTypeMeta(t).label.toLowerCase().includes(query.toLowerCase())) })).filter((s) => s.types.length);
  const flat = sections.flatMap((s) => s.types);
  return (
    <div className="nc-add-prop" data-menu-keys="ignore">
      <div className="nc-add-prop-name">
        <span role="button" className="nc-add-prop-icon" aria-label="Select icon"><Icon name="emojiFaceFill" size={16} /></span>
        <input
          autoFocus
          placeholder="Type field name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') { e.preventDefault(); choose((flat[active] as PropertyType) ?? 'text'); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
        />
      </div>
      <div className="nc-add-prop-card">
        <div className="lit-scroller vertical nc-add-prop-scroll" role="grid">
          <div className="nc-add-prop-section">
            <div className="nc-add-prop-section-title">AI Autofill</div>
            {/* add-property-menu: regular rows; presets open a submenu */}
            {AI_PRESETS.map((a) => (
              <div key={a.id} role="gridcell" className="nc-add-prop-ai" onClick={(e) => openMenu(e.currentTarget, { width: 220, sections: [{ items: a.options.map((o) => ({ id: o, label: o, onSelect: () => { close(); createAutofillProperty(opts.collectionId, a.id as 'sum' | 'tr', o, view ?? opts.view, { afterPropId: opts.afterPropId, beforePropId: opts.beforePropId }); } })) }] }, { placement: 'right-start', parent: overlayIdOf(e.currentTarget) })}>
                <Icon name={a.icon} size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
                <span className="nc-add-prop-ai-label">{a.label}</span>
                <span className="nc-badge gray">Basic</span>
                <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)', marginInlineStart: 'auto' }} />
              </div>
            ))}
          </div>
          <div className="nc-add-prop-section types-head with-divider">
            <div className="nc-add-prop-section-title">
              <span>Select type</span>
              <span role="button" className={`nc-add-prop-search-btn ${query !== null ? 'on' : ''}`} aria-label="Search types…" onClick={() => setQuery(query === null ? '' : null)}><Icon name="magnifyingGlassSmall" size={14} /></span>
            </div>
            {query !== null && (
              <div className="nc-add-prop-search"><input autoFocus placeholder="Search types…" value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={(e) => { if (e.key === 'Enter' && flat[Math.max(0, active)]) choose(flat[Math.max(0, active)] as PropertyType); if (e.key === 'Escape') { e.preventDefault(); setQuery(null); } }} /></div>
            )}
          </div>
          {sections.map((s, si) => (
            <div key={s.id} className={`nc-add-prop-group ${si ? 'with-divider' : 'first'}`} role="rowgroup">
              {chunk(s.types, 2).map((pair, ri) => (
                <div key={ri} role="row" className="nc-add-prop-row">
                  {pair.map((t) => {
                    const meta = propertyTypeMeta(t);
                    const idx = flat.indexOf(t);
                    return (
                      <div key={t} role="gridcell" className={`nc-add-prop-cell ${idx === active ? 'active' : ''}`} onMouseMove={() => setActive(idx)} onClick={() => choose(t)}>
                        <span className="nc-add-prop-cell-icon"><PropertyIcon prop={{ type: t }} size={16} /></span>
                        <span className="nc-add-prop-cell-label">{meta.label}</span>
                        <span role="button" className="nc-add-prop-help" data-tooltip={meta.tooltip} onClick={(e) => e.stopPropagation()}><Icon name="questionMarkCircleSmall" size={14} /></span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
          {!sections.length && <div className="nc-menu-empty">No results</div>}
        </div>
      </div>
    </div>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** "+ Add property": name row over the new column slot + type picker card. */
export function openAddPropertyMenu(anchor: HTMLElement | DOMRect, opts: AddPropertyOptions): () => void {
  const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  opts = { ...opts, anchor: opts.anchor ?? anchor };
  return openOverlay((close) => <AddPropertyMenu opts={opts} close={close} />, {
    anchor: new DOMRect(r.left - 11, r.top, r.width, 0), placement: 'bottom-start', offset: 0, className: 'nc-add-prop-overlay', onClose: opts.onClose,
  });
}

// ---------- button property config (Edit automation) ----------

/** Button property › Edit automation: the shared automation builder in button mode (features/database/automations). */
export function openButtonConfig(collectionId: string, propId: string) {
  void import('../automations/builder.tsx').then((m) => m.openButtonPropertyBuilder(collectionId, propId));
}

export { setGroupAggregation, defaultFilterOperator };
