import { HELP_URL } from '@nc/shared/brand.ts';
// View settings panel (290px, sliders icon): main page (Layout, Property visibility, Filter, Sort, Group,
// Sub-group, Conditional color, Copy link to layout / data source settings) and its sub-pages.
// Item lists use the layout tab labels.
import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, ViewType } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import {
  LAYOUT_PICKER_ORDER, LOAD_LIMITS, PEEK_MODES, defaultGroupBy, groupByOf, isGroupable, propertyTypeMeta, viewTypeMeta, subGroupByOf, savedGroupsOf, savedSubGroupsOf,
  savedGroupsFrom, propertiesKeyFor, FILTER_OPERATOR_LABELS, defaultFilterOperator, type GroupBy, type PropertyFilterLeaf, runQuery, combinedFilter, countActive,
  isDatabaseLocked,
} from '@nc/shared/database/index.ts';
import { COLOR_LABELS } from '@nc/shared/colors.ts';
import { useBlock, useCollection, useCollectionView } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { MenuSectionTitle, openMenu, type MenuDef, type MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { ColorSwatch } from '../properties/editors/SelectEditor.tsx';
import { Toggle } from '../properties/editors/DatePicker.tsx';
import { overlayIdOf, openAddPropertyMenu, openEditPropertyPopover, deletedPropertiesMenuDef } from '../properties/PropertyMenus.tsx';
import {
  addPropertyFilter, changeViewLayout, renameView, setAllPropertiesVisible, setGroupBy, setPropertyVisible, setSavedGroups, updateGroupBy, updateViewFormat, viewProperties,
  moveViewProperty, setSorts,
} from '../actions.ts';
import { collectionRows, makeQueryContext } from '../data.ts';
import { viewIcon, viewLink } from './ViewTabs.tsx';
import { layoutSettingsRegistry, viewSettingsMainRegistry } from '../viewRegistry.ts';
import { GroupToken } from './Groups.tsx';
import { useDatabaseAccess } from '../access.ts';
import { DependenciesPage, SprintsPage, SubitemsPage, moreSettingsItems, turnIntoItems } from './RelationFeatures.tsx';
import { setDatabaseLocked } from '../lock.ts';
import { AutomationsList, automationsEntry } from '../automations/list.tsx';
import { useArchivedViews } from '../../page/archive.tsx';
import { FilterValueEditor, chipLabel, propsForPicker } from './FilterBar.tsx';
import { useEffectiveView } from '../viewState.ts';
import { SettingsSaveControl } from './SaveControl.tsx';
import { ManageDataSourcesPage } from '../sources/ManageSources.tsx';
import { SourceRow } from '../sources/SourceRow.tsx';

interface VSState {
  openFor: string | null;
  set: (id: string | null) => void;
}
const useVS = create<VSState>((set) => ({ openFor: null, set: (id) => set({ openFor: id }) }));
export function useViewSettingsState() {
  return useVS();
}

type Page = 'main' | 'layout' | 'visibility' | 'filter' | 'sort' | 'group' | 'subgroup' | 'color' | 'properties' | 'openin' | 'loadlimit' | 'cardpreview' | 'cardsize' | 'subitems' | 'dependencies' | 'sprints' | 'automations' | 'sources';

interface Ctx {
  block: BlockRecord;
  viewId: string;
  collectionId: string;
  readOnly: boolean;
  inline: boolean;
  onSelectView: (id: string) => void;
  newView?: boolean;
}

function Header({ title, onBack, close, main }: { title: string; onBack?: () => void; close: () => void; main?: boolean }) {
  return (
    <div className={`nc-vs-header ${main ? 'main' : ''}`}>
      {onBack && <span role="button" className="nc-vs-back" aria-label="Back" onClick={onBack}><Icon name="arrowStraightLeftSmall" size={16} /></span>}
      <span className="nc-vs-title">{title}</span>
      <span role="button" className="nc-panel-close" aria-label="Close" data-testid="collection-settings-menu-close-button" onClick={close}><Icon name="xMarkSmall" size={14} /></span>
    </div>
  );
}

function Row({ icon, label, value, onClick, chevron = true, right, danger, disabled, testid }: { icon?: string | ReactNode; label: ReactNode; value?: ReactNode; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; chevron?: boolean; right?: ReactNode; danger?: boolean; disabled?: boolean; testid?: string }) {
  return (
    <div role="menuitem" data-testid={testid} aria-disabled={disabled || undefined} className={`nc-menu-item nc-vs-row ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`} onClick={disabled ? undefined : onClick} onMouseDown={(e) => e.preventDefault()}>
      <div className="nc-menu-item-inner">
        {icon && <div className="nc-menu-icon">{typeof icon === 'string' ? <Icon name={icon} size={20} /> : icon}</div>}
        <div className="nc-menu-label">{label}</div>
        {value !== undefined && value !== null && <span className="nc-menu-value">{value}</span>}
        {right}
        {chevron && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />}
      </div>
    </div>
  );
}

function ToggleRow({ label, on, onChange, disabled }: { label: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Row label={label} chevron={false} disabled={disabled} right={<Toggle on={on} onChange={onChange} disabled={disabled} />} onClick={() => onChange(!on)} />;
}

function Section({ title, children, divider, className }: { title?: ReactNode; children: ReactNode; divider?: boolean; className?: string }) {
  return (
    <div className={`nc-menu-section ${divider ? 'with-divider' : ''} ${className ?? ''}`}>
      {title && (className ? <MenuSectionTitle>{title}</MenuSectionTitle> : <div className="nc-menu-section-title">{title}</div>)}
      {children}
    </div>
  );
}

/** Option sub-menu of a settings row: choosing an option closes only the sub-menu, the panel stays open. */
function pickMenu(anchor: HTMLElement, def: MenuDef, placement: 'bottom-end' | 'bottom-start' | 'right-start' = 'bottom-end') {
  let closeSub: () => void = () => {};
  const sections = def.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => (it.onSelect ? { ...it, onSelect: () => { it.onSelect!(); closeSub(); return false; } } : it)) }));
  closeSub = openMenu(anchor, { ...def, sections }, { placement, offset: 2, parent: overlayIdOf(anchor), backdrop: 'transparent' });
  return closeSub;
}
function pick(anchor: HTMLElement, items: MenuItemDef[], width = 250) {
  return pickMenu(anchor, { width, sections: [{ items }] });
}

const PEEK_DESCRIPTIONS: Record<string, string> = {
  side_peek: 'Launch entries on the side. Keeps the layout behind interactive.',
  center_peek: 'Launch entries in a focused, centered modal.',
  full_page: 'Launch entries in full entry.',
};

// ---------- pages ----------

function MainPage({ ctx, view, collection, go, close }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void }) {
  // leaves new views unnamed (placeholder "View name"); we store the type label as the default name (the
  // sidebar lists views by name), so that label reads as "unnamed" here and clearing the field restores it
  const defaultName = viewTypeMeta(view.type).label;
  const [name, setName] = useState(view.name === defaultName ? '' : view.name);
  const entries = viewProperties(view, collection.schema);
  const shown = entries.filter((e) => e.visible).length;
  const gb = groupByOf(view, collection.schema);
  const sub = subGroupByOf(view, collection.schema);
  const filters = countActive(combinedFilter(view) ?? null, collection.schema);
  const sorts = (view.query2?.sort ?? []).length;
  const rules = ((view.format as any)?.conditional_color_rules ?? []).length;
  const ro = ctx.readOnly;
  const MainOverride = !ctx.newView ? viewSettingsMainRegistry[view.type] : undefined;
  const archivedOn = useArchivedViews((st) => !!st.on[ctx.block.id]);
  return (
    <>
      <Header title={ctx.newView ? 'New view' : 'View settings'} close={close} main={!ctx.newView} />
      <div className="nc-vs-name-row" data-menu-keys="ignore">
        <span role="button" className="nc-prop-icon-btn" aria-label="Change icon" onClick={(e) => !ro && openIconPicker(e.currentTarget, { current: (view.format as any)?.collection_view_icon, onPick: (v) => updateViewFormat(view.id, { collection_view_icon: v ?? undefined }) })}>
          <Icon name={viewIcon(view.type)} size={20} />
        </span>
        <div className="nc-input nc-vs-name-input">
          <input
            value={name}
            placeholder="View name"
            readOnly={ro}
            autoFocus={ctx.newView}
            onChange={(e) => { setName(e.target.value); renameView(view.id, e.target.value || defaultName); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <span role="button" className="nc-prop-desc-btn" aria-label="Create layout description" data-tooltip={(view.format as any)?.description || 'Create layout description'} onClick={(e) => {
            if (ro) return;
            const cur = String((view.format as any)?.description ?? '');
            let text = cur;
            openOverlay((c) => (
              <PopoverSurface width={260}><div className="nc-prop-desc-body" data-menu-keys="ignore"><textarea autoFocus defaultValue={cur} placeholder="Add a description…" onChange={(ev) => (text = ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); c(); } }} /></div></PopoverSurface>
            ), { anchor: e.currentTarget, parent: overlayIdOf(e.currentTarget), onClose: () => updateViewFormat(view.id, { description: text.trim() || undefined }) });
          }}><Icon name="infoCircleFill" size={20} /></span>
        </div>
      </div>
      {ctx.newView ? (
        <LayoutGrid view={view} collection={collection} readOnly={ro} />
      ) : null}
      {MainOverride ? <MainOverride block={ctx.block} view={view} collection={collection} readOnly={ro} go={(p) => go(p as Page)} close={close} /> : <Section className={ctx.newView ? undefined : 'nc-vs-sec first'}>
        {!ctx.newView && <Row icon={viewIcon(view.type)} label="Layout" value={viewTypeMeta(view.type).label} onClick={() => go('layout')} />}
        <Row icon="dbEye" label="Property visibility" value={shown} onClick={() => go('visibility')} />
        <Row icon="dbFilter" label="Filter" value={filters || undefined} onClick={() => go('filter')} />
        <Row icon="arrowUpDownSmall" label="Sort" value={sorts || undefined} onClick={() => go('sort')} />
        {!['calendar', 'map', 'chart', 'form', 'feed', 'dashboard'].includes(view.type) && <Row icon={view.type === 'board' ? 'viewBoard' : 'dbGroup'} label="Group" value={gb ? collection.schema[gb.property]?.name : undefined} onClick={() => go('group')} />}
        {view.type === 'board' && <Row icon="dbGroup" label="Sub-group" value={sub ? collection.schema[sub.property]?.name : undefined} onClick={() => go('subgroup')} />}
        {['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'feed'].includes(view.type) && <Row icon="paintRoller" label="Conditional color" value={rules || undefined} onClick={() => go('color')} />}
        <Row icon="dbLink" label="Copy link to layout" chevron={false} onClick={() => { void navigator.clipboard?.writeText(viewLink(ctx.block, view.id)); useUI.getState().toast('Copied link to view'); }} />
      </Section>}
      {ctx.newView && (
        <Section divider>
          {/* the new view’s data source: any source of this database, or a linked one */}
          <SourceRow block={ctx.block} view={view} collection={collection} readOnly={ro} allowLink />
          <div className="nc-vs-done-wrap"><div role="button" className="nc-btn primary nc-vs-done" onClick={close}>Done</div></div>
        </Section>
      )}
      {!ctx.newView && !MainOverride && (
        <>
          {/* order and labels per */}
          <Section divider title="Dataset settings" className="nc-vs-sec titled">
            {/* a block with a single data source shows its source as a dimmed, inert row */}
            <SourceRow block={ctx.block} view={view} collection={collection} readOnly={ro} />
            <Row icon="bulletedList" label="Edit properties" onClick={() => go('properties')} />
            <Row icon="dbLightning" label="Automations" onClick={() => void automationsEntry(collection, () => go('automations'))} />
            <Row icon="magicWand" label="AI Autofill" onClick={(e) => pick(e.currentTarget, [
              { id: 'basic', label: 'Basic', icon: 'magicWand', description: 'Not available in this workspace', disabled: true },
              { id: 'agent', label: 'Custom Agent', icon: 'aiFace', badge: 'New', description: 'Uses advanced models to fill fields based on web search and your connected workspace.', disabled: true },
            ], 260)} />
            {!ro && <Row icon="dbTurnInto" label="Turn into" onClick={(e) => pick(e.currentTarget, turnIntoItems(collection, close))} />}
            <Row icon="archiveBoxSmall" label={archivedOn ? 'Exit archive view' : 'Show archived entries'} chevron={false} onClick={() => { useArchivedViews.getState().set(ctx.block.id, !archivedOn); close(); }} />
            <Row icon="ellipsis" label="More settings" onClick={(e) => pick(e.currentTarget, moreSettingsItems({ collection, view, block: ctx.block, go: (p) => go(p as Page), close }))} />
          </Section>
          <Section divider className="nc-vs-sec last">
            {/* Source and Linked lists, Add data source, and Link existing data source */}
            <Row icon="collection" label="Manage datasets" onClick={() => go('sources')} />
            <LockRow block={ctx.block} />
          </Section>
        </>
      )}
    </>
  );
}

/** "Lock database" / "Unlock database": views, filters, sorts and properties freeze; rows stay editable. */
function LockRow({ block }: { block: BlockRecord }) {
  const live = useBlock(block.id) ?? block;
  const access = useDatabaseAccess(block.id);
  const locked = isDatabaseLocked(live);
  return (
    <div data-tooltip={locked ? 'Unlock layouts and datasets in this table' : undefined}>
      <Row icon="lockKeyhole" label={locked ? 'Unlock database' : 'Lock database'} chevron={false} disabled={!access.canToggleLock} testid="lock-database" onClick={() => setDatabaseLocked(live, !locked)} />
    </div>
  );
}

function LayoutGrid({ view, collection, readOnly }: { view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean }) {
  // a view of a linked data source can't become a form; forms fill the database's own sources
  const linked = collection.parent_id !== view.parent_id;
  return (
    <div className="nc-vs-layout-grid">
      {LAYOUT_PICKER_ORDER.filter((t) => !(linked && t === 'form' && view.type !== 'form')).map((t) => {
        const meta = viewTypeMeta(t);
        return (
          <div key={t} role="button" className={`nc-vs-layout-cell ${view.type === t ? 'selected' : ''}`} onClick={() => !readOnly && changeViewLayout(view, collection.id, t as ViewType)}>
            <Icon name={meta.icon} size={20} />
            <span>{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LayoutPage({ ctx, view, collection, go, close }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void }) {
  const fmt = (view.format ?? {}) as Record<string, any>;
  const set = (patch: Record<string, unknown>) => updateViewFormat(view.id, patch, 'updateViewLayout');
  const peek = fmt.collection_peek_mode ?? viewTypeMeta(view.type).defaultPeek;
  const limit = fmt.inline_collection_first_load_limit?.limit ?? (view.type === 'board' ? 25 : 50);
  const gb = groupByOf(view, collection.schema);
  const coverKey = view.type === 'board' ? 'board_cover' : 'gallery_cover';
  const sizeKey = view.type === 'board' ? 'board_cover_size' : 'gallery_cover_size';
  const aspectKey = view.type === 'board' ? 'board_cover_aspect' : 'gallery_cover_aspect';
  const cover = fmt[coverKey] as { type?: string; property?: string } | undefined;
  const fileProps = Object.entries(collection.schema).filter(([, p]) => p.type === 'file');
  const coverLabel = !cover || cover.type === 'none' ? 'None' : cover.type === 'page_cover' ? 'Page cover' : cover.type === 'page_content' || cover.type === 'page_content_first' ? 'Page content' : collection.schema[cover.property ?? '']?.name ?? 'Property';
  const ro = ctx.readOnly;
  const LayoutExtra = layoutSettingsRegistry[view.type];
  return (
    <>
      <Header title="Layout" onBack={() => go('main')} close={close} />
      <LayoutGrid view={view} collection={collection} readOnly={ro} />
      <Section>
        <ToggleRow label="Display dataset title" on={fmt.hide_linked_collection_name !== true} onChange={(v) => set({ hide_linked_collection_name: !v })} disabled={ro} />
        {view.type !== 'chart' && view.type !== 'map' && <ToggleRow label="Display entry icon" on={fmt.show_page_icon !== false} onChange={(v) => set({ show_page_icon: v })} disabled={ro} />}
        {(view.type === 'table' || view.type === 'board' || view.type === 'gallery') && <ToggleRow label="Wrap all content" on={fmt.table_wrap !== false} onChange={(v) => {
          const key = propertiesKeyFor(view.type);
          set({ table_wrap: v, ...(view.type === 'table' ? { [key]: viewProperties(view, collection.schema).map((e) => ({ ...e, wrap: undefined })) } : {}) });
        }} disabled={ro} />}
        {view.type === 'table' && <ToggleRow label="Display vertical lines" on={fmt.hide_table_vertical_lines !== true} onChange={(v) => set({ hide_table_vertical_lines: !v })} disabled={ro} />}
        {view.type === 'board' && (
          <>
            <Row label="Group by" value={gb ? collection.schema[gb.property]?.name : 'None'} onClick={() => go('group')} />
            <ToggleRow label="Color columns" on={!(gb as any)?.disableBoardColorColumns} onChange={(v) => updateGroupBy(view, { disableBoardColorColumns: !v })} disabled={ro || !gb} />
          </>
        )}
        {LayoutExtra && <LayoutExtra view={view} collection={collection} readOnly={ro} />}
        <Row label="Launch entries in" value={PEEK_MODES.find((m) => m.id === peek)?.label} onClick={(e) => pick(e.currentTarget, PEEK_MODES.map((m) => ({
          id: m.id, label: m.label, icon: m.icon, checked: peek === m.id, onSelect: () => set({ collection_peek_mode: m.id }),
          // The default option is labeled for the current view type.
          description: <>{PEEK_DESCRIPTIONS[m.id]}{m.id === viewTypeMeta(view.type).defaultPeek ? <span className="nc-peek-default"> Default for {viewTypeMeta(view.type).label.toLowerCase()}</span> : null}</>,
        })), 290)} />
        {['table', 'board', 'list', 'gallery', 'timeline', 'feed'].includes(view.type) && <Row label="Load limit" value={limit} onClick={(e) => pick(e.currentTarget, LOAD_LIMITS.map((n) => ({ id: String(n), label: `${n} pages`, checked: limit === n, onSelect: () => set({ inline_collection_first_load_limit: { type: 'load_limit', limit: n } }) })))} />}
      </Section>
      {(view.type === 'board' || view.type === 'gallery') && (
        <Section divider>
          <Row label="Card preview" value={coverLabel} onClick={(e) => pick(e.currentTarget, [
            { id: 'none', label: 'None', checked: coverLabel === 'None', onSelect: () => set({ [coverKey]: { type: 'none' } }) },
            { id: 'cover', label: 'Page cover', checked: cover?.type === 'page_cover', onSelect: () => set({ [coverKey]: { type: 'page_cover' } }) },
            { id: 'content', label: 'Page content', description: 'Uses first block on the entry', checked: cover?.type === 'page_content' || cover?.type === 'page_content_first', onSelect: () => set({ [coverKey]: { type: 'page_content_first' } }) },
            ...fileProps.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: cover?.type === 'property' && cover.property === id, onSelect: () => set({ [coverKey]: { type: 'property', property: id } }) })),
          ])} />
          <Row label="Card size" value={({ small: 'Small', medium: 'Medium', large: 'Large' } as Record<string, string>)[fmt[sizeKey] ?? 'medium']} onClick={(e) => pick(e.currentTarget, (['small', 'medium', 'large'] as const).map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1), checked: (fmt[sizeKey] ?? 'medium') === s, onSelect: () => set({ [sizeKey]: s }) })))} />
          <ToggleRow label="Fit media" on={fmt[aspectKey] === 'contain'} onChange={(v) => set({ [aspectKey]: v ? 'contain' : 'cover' })} disabled={ro} />
          <Row label="Card layout" value={(fmt.card_layout?.mode ?? 'list') === 'compact' ? 'Compact' : 'List'} onClick={(e) => pick(e.currentTarget, [
            { id: 'list', label: 'List', checked: (fmt.card_layout?.mode ?? 'list') === 'list', onSelect: () => set({ card_layout: { mode: 'list' } }) },
            { id: 'compact', label: 'Compact', checked: fmt.card_layout?.mode === 'compact', onSelect: () => set({ card_layout: { mode: 'compact' } }) },
          ])} />
        </Section>
      )}
    </>
  );
}

function VisibilityPage({ ctx, view, collection, go, close }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void }) {
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const entries = viewProperties(view, collection.schema).filter((e) => !q || collection.schema[e.property].name.toLowerCase().includes(q.toLowerCase()));
  const where = ({ table: 'table', board: 'board', gallery: 'gallery', list: 'list', calendar: 'calendar', timeline: 'timeline', feed: 'feed' } as Record<string, string>)[view.type] ?? 'view';
  const titleLocked = view.type === 'table' || view.type === 'list';
  const row = (e: { property: string; visible: boolean }) => {
    const p = collection.schema[e.property];
    const locked = titleLocked && e.property === 'title';
    return (
      <div
        key={e.property}
        className="nc-menu-item nc-vis-row"
        draggable={!ctx.readOnly}
        onDragStart={() => setDrag(e.property)}
        onDragOver={(ev) => ev.preventDefault()}
        onDrop={() => {
          if (!drag || drag === e.property) return;
          const all = viewProperties(view, collection.schema);
          moveViewProperty(view, collection.schema, drag, all.findIndex((x) => x.property === e.property));
          setDrag(null);
        }}
      >
        <div className="nc-menu-item-inner">
          <span className="nc-vis-drag" aria-label="Drag to send, click to launch menu"><Icon name="dragHandle" size={14} /></span>
          <div className="nc-menu-icon"><PropertyIcon prop={p} size={16} /></div>
          <div className="nc-menu-label">{p.name}</div>
          <span role="button" className={`nc-vis-eye ${locked ? 'locked' : ''}`} aria-label="Switch field visibility" onClick={() => !locked && !ctx.readOnly && setPropertyVisible(view, collection.schema, e.property, !e.visible)}>
            <Icon name={locked ? 'lock' : e.visible ? 'eye' : 'eyeSlash'} size={16} />
          </span>
        </div>
      </div>
    );
  };
  const shown = entries.filter((e) => e.visible);
  const hidden = entries.filter((e) => !e.visible);
  return (
    <>
      <Header title="Property visibility" onBack={() => go('main')} close={close} />
      <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Find a field…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {shown.length > 0 && (
        <Section title={<span className="nc-vs-section-head"><span>Shown in {where}</span>{!ctx.readOnly && <span role="button" className="nc-vs-section-action" onClick={() => setAllPropertiesVisible(view, collection.schema, false)}>Hide all</span>}</span>}>
          {shown.map(row)}
        </Section>
      )}
      {hidden.length > 0 && (
        <Section divider={shown.length > 0} title={<span className="nc-vs-section-head"><span>Hidden in {where}</span>{!ctx.readOnly && <span role="button" className="nc-vs-section-action" onClick={() => setAllPropertiesVisible(view, collection.schema, true)}>Show all</span>}</span>}>
          {hidden.map(row)}
        </Section>
      )}
      {!ctx.readOnly && (
        <Section divider>
          <Row icon="plus" label="New property" chevron={false} onClick={(e) => openAddPropertyMenu(e.currentTarget, { collectionId: collection.id, view })} />
        </Section>
      )}
    </>
  );
}

function FilterPage({ ctx, view, collection, go, close }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void }) {
  const chips = ((view.format as any)?.property_filters ?? []) as { id: string; filter: PropertyFilterLeaf }[];
  const [q, setQ] = useState('');
  const props = Object.entries(collection.schema).filter(([, p]) => propertyTypeMeta(p.type).filterValueType !== null && p.type !== 'button' && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <Header title="Filter" onBack={() => go('main')} close={close} />
      {chips.length > 0 && (
        <Section>
          {chips.map((c) => {
            const p = collection.schema[c.filter.property];
            const l = chipLabel(c.filter, p);
            return <Row key={c.id} icon={p ? <PropertyIcon prop={p} size={16} /> : 'filter'} label={l.name} value={l.rest || FILTER_OPERATOR_LABELS[c.filter.filter.operator]} chevron={false} />;
          })}
        </Section>
      )}
      <SettingsSaveControl view={view} scope="filters" />
      {/* everyone can filter for themselves; only people who can change the view save it for everyone (viewState.ts) */}
      <Section divider={chips.length > 0} title="Add filter">
        <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input placeholder="Filter by…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        {props.map(([id, p]) => (
          <Row key={id} icon={<PropertyIcon prop={p} size={16} />} label={p.name} chevron={false} onClick={() => { addPropertyFilter(view, { property: id, filter: { operator: defaultFilterOperator(p) } }); close(); }} />
        ))}
      </Section>
    </>
  );
}

function SortPage({ ctx, view, collection, go, close }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void }) {
  const sorts = (view.query2?.sort ?? []).filter((s) => collection.schema[s.property]);
  const [q, setQ] = useState('');
  const props = Object.entries(collection.schema).filter(([id, p]) => p.type !== 'button' && !sorts.some((s) => s.property === id) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <Header title="Sort" onBack={() => go('main')} close={close} />
      {sorts.length > 0 && (
        <Section>
          {sorts.map((s, i) => {
            const p = collection.schema[s.property];
            return (
              <Row key={s.property} icon={<PropertyIcon prop={p} size={16} />} label={p.name} value={s.direction === 'descending' ? 'Descending' : 'Ascending'} onClick={(e) => pick(e.currentTarget, [
                { id: 'asc', label: 'Ascending', checked: s.direction === 'ascending', onSelect: () => setSorts(view, sorts.map((x, j) => (j === i ? { ...x, direction: 'ascending' as const } : x))) },
                { id: 'desc', label: 'Descending', checked: s.direction === 'descending', onSelect: () => setSorts(view, sorts.map((x, j) => (j === i ? { ...x, direction: 'descending' as const } : x))) },
                { id: 'rm', label: 'Remove sort', icon: 'trash', onSelect: () => setSorts(view, sorts.filter((_, j) => j !== i)) },
              ])} />
            );
          })}
        </Section>
      )}
      <SettingsSaveControl view={view} scope="sorts" />
      <Section divider={sorts.length > 0} title="New sort">
        <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input placeholder="Sort by…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        {props.map(([id, p]) => <Row key={id} icon={<PropertyIcon prop={p} size={16} />} label={p.name} chevron={false} onClick={() => setSorts(view, [...sorts, { property: id, direction: 'ascending' }])} />)}
      </Section>
    </>
  );
}

const DATE_GROUP_OPTIONS = [
  { id: 'relative', label: 'Relative' }, { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
];

function GroupPage({ ctx, view, collection, go, close, sub }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void; sub?: boolean }) {
  const gb = sub ? subGroupByOf(view, collection.schema) : groupByOf(view, collection.schema);
  const prop = gb ? collection.schema[gb.property] : undefined;
  const ro = ctx.readOnly;
  const candidates = Object.entries(collection.schema).filter(([, p]) => isGroupable(p) && !['file', 'place', 'auto_increment_id', 'button'].includes(p.type));
  const q = runQuery(collectionRows(collection.id), collection, view, makeQueryContext(), sub ? { groupBy: gb } : {});
  const groups = q.groups ?? [];
  const saved = sub ? savedSubGroupsOf(view) : savedGroupsOf(view);
  const setHidden = (id: string, hidden: boolean) => setSavedGroups(view, savedGroupsFrom(groups.map((g) => (g.id === id ? { ...g, hidden } : g)), gb!.property, saved), { sub, action: hidden ? 'hideGroup' : 'showGroup' });
  const sortType = gb?.sort?.type ?? 'manual';
  const isDate = prop && ['date', 'created_time', 'last_edited_time'].includes(prop.type);
  const isText = prop && ['text', 'title', 'url', 'email', 'phone_number'].includes(prop.type);
  const [drag, setDrag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  if (!gb) {
    // no grouping yet: "Group by" page = search field + None (checked) + every groupable property 
    const shown = candidates.filter(([, p]) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()));
    const choose = (id: string, p: PropertySchema) => setGroupBy(view, defaultGroupBy(p, id, { board: view.type === 'board' && !sub }) as GroupBy, { sub });
    return (
      <>
        <Header title={sub ? 'Sub-group by' : 'Group by'} onBack={() => go('main')} close={close} />
        <div className="nc-vs-search" data-menu-keys="ignore">
          <div className="nc-input focused"><input autoFocus placeholder="Find a field…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && shown[0] && !ro) choose(shown[0][0], shown[0][1]); }} /></div>
        </div>
        <div className="nc-vs-pick-list" role="listbox">
          {!search.trim() && (
            <div role="option" aria-selected className="nc-menu-item" onMouseDown={(e) => e.preventDefault()}>
              <div className="nc-menu-item-inner"><div className="nc-menu-label">None</div><Icon name="checkmarkSmall" size={16} /></div>
            </div>
          )}
          {shown.map(([id, p]) => (
            <div key={id} role="option" className={`nc-menu-item ${ro ? 'disabled' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => !ro && choose(id, p)}>
              <div className="nc-menu-item-inner">
                <div className="nc-menu-icon nc-vs-prop-icon"><PropertyIcon prop={p} size={16} style={{ color: 'var(--lp-icon-primary)' }} /></div>
                <div className="nc-menu-label">{p.name}</div>
              </div>
            </div>
          ))}
          {!shown.length && <div className="nc-menu-empty">No results</div>}
        </div>
      </>
    );
  }
  return (
    <>
      <Header title={sub ? 'Sub-group' : 'Group'} onBack={() => go('main')} close={close} />
      <Section>
        <Row label={sub ? 'Sub-group by' : 'Group by'} value={prop?.name ?? 'None'} onClick={(e) => pickMenu(e.currentTarget, { width: 250, search: 'Find a field…', sections: [{ items: [
          ...(view.type !== 'board' || sub ? [{ id: 'none', label: 'None', checked: !gb, onSelect: () => setGroupBy(view, null, { sub }) }] : []),
          ...candidates.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: gb?.property === id, onSelect: () => setGroupBy(view, defaultGroupBy(p, id, { board: view.type === 'board' && !sub }) as GroupBy, { sub }) })),
        ] }] })} />
        {gb && prop?.type === 'status' && <Row label="Status by" value={gb.groupBy === 'group' ? 'Group' : 'Option'} onClick={(e) => pick(e.currentTarget, [
          { id: 'group', label: 'Group', checked: gb.groupBy === 'group', onSelect: () => updateGroupBy(view, { groupBy: 'group' }, { sub }) },
          { id: 'option', label: 'Option', checked: gb.groupBy !== 'group', onSelect: () => updateGroupBy(view, { groupBy: 'option' }, { sub }) },
        ])} />}
        {gb && isDate && <Row label="Date by" value={DATE_GROUP_OPTIONS.find((o) => o.id === (gb.groupBy ?? 'relative'))?.label} onClick={(e) => pick(e.currentTarget, DATE_GROUP_OPTIONS.map((o) => ({ id: o.id, label: o.label, checked: (gb.groupBy ?? 'relative') === o.id, onSelect: () => updateGroupBy(view, { groupBy: o.id }, { sub }) })))} />}
        {gb && isText && <Row label="Text by" value={gb.groupBy === 'alphabet_prefix' ? 'Alphabetical' : 'Exact'} onClick={(e) => pick(e.currentTarget, [
          { id: 'exact', label: 'Exact', checked: gb.groupBy !== 'alphabet_prefix', onSelect: () => updateGroupBy(view, { groupBy: 'exact' }, { sub }) },
          { id: 'alpha', label: 'Alphabetical', checked: gb.groupBy === 'alphabet_prefix', onSelect: () => updateGroupBy(view, { groupBy: 'alphabet_prefix' }, { sub }) },
        ])} />}
        {gb && prop?.type === 'number' && <NumberRange gb={gb} view={view} sub={sub} />}
        {gb && <Row label="Sort" value={sortType === 'manual' ? 'Manual' : sortType === 'descending' ? 'Descending' : 'Ascending'} onClick={(e) => pick(e.currentTarget, [
          { id: 'manual', label: 'Manual', checked: sortType === 'manual', onSelect: () => updateGroupBy(view, { sort: { type: 'manual' } }, { sub }) },
          { id: 'asc', label: 'Ascending', checked: sortType === 'ascending', onSelect: () => updateGroupBy(view, { sort: { type: 'ascending' } }, { sub }) },
          { id: 'desc', label: 'Descending', checked: sortType === 'descending', onSelect: () => updateGroupBy(view, { sort: { type: 'descending' } }, { sub }) },
        ])} />}
        {gb && <ToggleRow label="Conceal empty groups" on={!!gb.hideEmptyGroups} onChange={(v) => updateGroupBy(view, { hideEmptyGroups: v }, { sub })} disabled={ro} />}
        {gb && view.type === 'board' && !sub && <ToggleRow label="Color columns" on={!gb.disableBoardColorColumns} onChange={(v) => updateGroupBy(view, { disableBoardColorColumns: !v })} disabled={ro} />}
      </Section>
      {gb && groups.length > 0 && (
        <Section divider title={<span className="nc-vs-section-head"><span>Groups</span>{!ro && <span role="button" className="nc-vs-section-action" onClick={() => setSavedGroups(view, savedGroupsFrom(groups.map((g) => ({ ...g, hidden: groups.some((x) => !x.hidden) })), gb.property, saved), { sub })}>{groups.some((x) => !x.hidden) ? 'Hide all' : 'Show all'}</span>}</span>}>
          {[...groups.filter((g) => !g.hidden), ...groups.filter((g) => g.hidden)].map((g) => (
            <div
              key={g.id}
              className="nc-menu-item nc-vis-row"
              draggable={!ro}
              onDragStart={() => setDrag(g.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!drag || drag === g.id) return;
                const order = groups.filter((x) => x.id !== drag);
                const i = order.findIndex((x) => x.id === g.id);
                order.splice(i, 0, groups.find((x) => x.id === drag)!);
                setSavedGroups(view, savedGroupsFrom(order, gb.property, saved), { sub, action: 'reorderGroups' });
                setDrag(null);
              }}
            >
              <div className="nc-menu-item-inner">
                <span className="nc-vis-drag"><Icon name="dragHandle" size={14} /></span>
                <div className="nc-menu-label"><GroupToken group={g} /></div>
                <span role="button" className="nc-vis-eye" aria-label={g.hidden ? 'Show group' : 'Hide group'} onClick={() => !ro && setHidden(g.id, !g.hidden)}><Icon name={g.hidden ? 'eyeSlash' : 'eye'} size={16} /></span>
              </div>
            </div>
          ))}
        </Section>
      )}
      <Section divider>
        {gb && !ro && (view.type !== 'board' || sub) && <Row icon="trash" label={sub ? 'Remove sub-grouping' : 'Remove grouping'} chevron={false} onClick={() => setGroupBy(view, null, { sub })} />}
        {HELP_URL && <Row icon="questionMarkCircle" label="Explore grouping" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
      </Section>
    </>
  );
}

function NumberRange({ gb, view, sub }: { gb: GroupBy; view: CollectionViewRecord; sub?: boolean }) {
  const range = typeof gb.groupBy === 'object' && gb.groupBy.type === 'range';
  return (
    <>
      <Row label="Number by" value={range ? 'Range' : 'Unique value'} onClick={(e) => pick(e.currentTarget, [
        { id: 'unique', label: 'Unique value', checked: !range, onSelect: () => updateGroupBy(view, { groupBy: { type: 'unique' } }, { sub }) },
        { id: 'range', label: 'Range', checked: range, onSelect: () => updateGroupBy(view, { groupBy: { type: 'range' }, start: gb.start ?? 0, end: gb.end ?? 1000, size: gb.size ?? 100 }, { sub }) },
      ])} />
      {range && (
        <div className="nc-vs-number-range" data-menu-keys="ignore">
          {(['start', 'end', 'size'] as const).map((k) => (
            <label key={k}>
              <span>{k === 'start' ? 'From' : k === 'end' ? 'To' : 'Interval'}</span>
              <input type="number" defaultValue={String(gb[k] ?? (k === 'start' ? 0 : k === 'end' ? 1000 : 100))} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) updateGroupBy(view, { [k]: n }, { sub }); }} />
            </label>
          ))}
        </div>
      )}
    </>
  );
}

const BG_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

/**: a rule keeps the color of the option it matches ("P0" red) until a color is picked by hand. */
function inheritedColor(prop: PropertySchema | undefined, filter: PropertyFilterLeaf['filter']): string | undefined {
  const raw = filter?.value as unknown;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const val = first && typeof first === 'object' ? (first as { value?: unknown }).value : first;
  if (typeof val !== 'string' || !prop?.options) return undefined;
  const opt = prop.options.find((o) => o.value === val);
  return opt?.color && opt.color !== 'default' ? `${opt.color}_background` : undefined;
}

function ColorPage({ ctx, view, collection, go, close }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void }) {
  const rules = (((view.format as any)?.conditional_color_rules ?? []) as { id: string; property: string; filter: PropertyFilterLeaf['filter']; color: string; apply_to?: string; color_auto?: boolean }[]);
  const set = (next: typeof rules) => updateViewFormat(view.id, { conditional_color_rules: next }, 'updateConditionalColor');
  const props = propsForPicker(collection.schema, (p) => !['button', 'file', 'place', 'location', 'verification'].includes(p.type));
  return (
    <>
      <Header title="Conditional color" onBack={() => go('main')} close={close} />
      {!rules.length && <div className="nc-vs-empty">Adjust entry colors to easily distinguish categories, highlight overdue events, and bring clarity to your work.</div>}
      {rules.map((r, i) => {
        const p = collection.schema[r.property];
        const leaf: PropertyFilterLeaf = { property: r.property, filter: r.filter };
        const l = chipLabel(leaf, p);
        return (
          <div key={r.id} className="nc-cc-rule">
            <div className="nc-cc-rule-head">
              <span role="button" className="nc-adv-select" onClick={(e) => pick(e.currentTarget, props.map(([id, pp]) => ({ id, label: pp.name, icon: <PropertyIcon prop={pp} size={16} />, checked: id === r.property, onSelect: () => set(rules.map((x, j) => (j === i ? { ...x, property: id, filter: { operator: defaultFilterOperator(pp) } } : x))) })))}>
                {p && <PropertyIcon prop={p} size={14} />}<span className="nc-adv-select-text">{p?.name ?? 'Property'}</span><Icon name="arrowChevronSingleDownSmall" size={12} />
              </span>
              <span role="button" className="nc-cc-color" onClick={(e) => pick(e.currentTarget, BG_COLORS.map((c) => ({ id: c, label: COLOR_LABELS[c], icon: <ColorSwatch color={c} />, checked: r.color === `${c}_background`, onSelect: () => set(rules.map((x, j) => (j === i ? { ...x, color: `${c}_background`, color_auto: false } : x))) })), 200)}>
                <ColorSwatch color={r.color.replace('_background', '')} />
              </span>
              <span role="button" className="nc-sort-remove" aria-label="Delete conditional color rule" onClick={() => set(rules.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></span>
            </div>
            <div className="nc-cc-rule-cond">{l.rest || 'Any value'}</div>
            {p && <FilterValueEditor leaf={leaf} prop={p} onChange={(n) => set(rules.map((x, j) => (j === i ? { ...x, filter: n.filter, ...(x.color_auto !== false && inheritedColor(p, n.filter) ? { color: inheritedColor(p, n.filter)! } : {}) } : x)))} />}
            {view.type === 'table' && (
              <Row label="Apply to" value={r.apply_to === 'property' ? p?.name ?? 'Property' : 'Row'} onClick={(e) => pick(e.currentTarget, [
                { id: 'row', label: 'Row', checked: r.apply_to !== 'property', onSelect: () => set(rules.map((x, j) => (j === i ? { ...x, apply_to: 'row' } : x))) },
                { id: 'prop', label: p?.name ?? 'Property', checked: r.apply_to === 'property', onSelect: () => set(rules.map((x, j) => (j === i ? { ...x, apply_to: 'property' } : x))) },
              ])} />
            )}
          </div>
        );
      })}
      {!ctx.readOnly && (
        <Section divider={rules.length > 0}>
          <Row icon="plusSmall" label={rules.length ? 'Add another' : 'New color setting'} chevron={false} onClick={(e) => pick(e.currentTarget, props.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => {
            // a new rule starts as "<property> is not empty" 
            const opt = p.options?.[0];
            set([...rules, { id: crypto.randomUUID(), property: id, filter: { operator: 'is_not_empty' }, color: `${opt?.color && opt.color !== 'default' ? opt.color : 'red'}_background`, color_auto: true }]);
          } })))} />
        </Section>
      )}
    </>
  );
}

function PropertiesPage({ ctx, view, collection, go, close }: { ctx: Ctx; view: CollectionViewRecord; collection: CollectionRecord; go: (p: Page) => void; close: () => void }) {
  const [q, setQ] = useState('');
  const entries = Object.entries(collection.schema)
    .filter(([, p]) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort(([a, pa], [b, pb]) => (a === 'title' ? -1 : b === 'title' ? 1 : pa.name.localeCompare(pb.name)));
  const deleted = Object.entries(((collection as any).deleted_schema ?? {}) as Record<string, PropertySchema>);
  return (
    <>
      <Header title="Properties" onBack={() => go('main')} close={close} />
      <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Find a field…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <Section>
        {entries.map(([id, p]) => <Row key={id} icon={<PropertyIcon prop={p} size={16} />} label={p.name} onClick={(e) => openEditPropertyPopover(e.currentTarget, collection.id, id, view, { placement: 'right-start' })} />)}
      </Section>
      {!ctx.readOnly && (
        <Section divider>
          <Row icon="plus" label="New property" chevron={false} onClick={(e) => openAddPropertyMenu(e.currentTarget, { collectionId: collection.id, view })} />
          {deleted.length > 0 && <Row icon="trash" label="Deleted properties" value={deleted.length} onClick={(e) => pickMenu(e.currentTarget, deletedPropertiesMenuDef(collection.id), 'right-start')} />}
        </Section>
      )}
    </>
  );
}

function ViewSettingsPanel({ ctx, close }: { ctx: Ctx; close: () => void }) {
  // the view as this person sees it: their unsaved filters and sorts
  const view = useEffectiveView(useCollectionView(ctx.viewId));
  const collection = useCollection(ctx.collectionId);
  const [page, setPage] = useState<Page>('main');
  if (!view || !collection) return null;
  const props = { ctx, view, collection, go: setPage, close };
  let body: ReactNode;
  switch (page) {
    case 'layout': body = <LayoutPage {...props} />; break;
    case 'visibility': body = <VisibilityPage {...props} />; break;
    case 'filter': body = <FilterPage {...props} />; break;
    case 'sort': body = <SortPage {...props} />; break;
    case 'group': body = <GroupPage {...props} />; break;
    case 'subgroup': body = <GroupPage {...props} sub />; break;
    case 'color': body = <ColorPage {...props} />; break;
    case 'properties': body = <PropertiesPage {...props} />; break;
    case 'subitems': body = <SubitemsPage {...props} />; break;
    case 'dependencies': body = <DependenciesPage {...props} />; break;
    case 'sprints': body = <SprintsPage {...props} />; break;
    case 'automations': body = <><Header title="Automations" onBack={() => setPage('main')} close={close} /><AutomationsList collectionId={collection.id} /></>; break;
    case 'sources': body = <ManageDataSourcesPage block={ctx.block} readOnly={ctx.readOnly} onBack={() => setPage('main')} close={close} />; break;
    default: body = <MainPage {...props} />;
  }
  return (
    <PopoverSurface width={290} maxHeight="80vh" className="nc-view-settings lit-view-settings-sidebar">
      <div className="lit-scroller vertical nc-vs-scroll">{body}</div>
    </PopoverSurface>
  );
}

export function openViewSettings(anchor: HTMLElement, opts: { block: BlockRecord; view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean; inline: boolean; onSelectView: (id: string) => void; newView?: boolean; page?: Page }) {
  useVS.getState().set(opts.view.id);
  const ctx: Ctx = { block: opts.block, viewId: opts.view.id, collectionId: opts.collection.id, readOnly: opts.readOnly, inline: opts.inline, onSelectView: opts.onSelectView, newView: opts.newView };
  // opens the panel beside the database header — left edge 2px inside the header's right end, top 4px above
  // it keeps the menu inside the viewport
  
  const header = anchor.closest<HTMLElement>('.nc-db-header');
  const r = header?.getBoundingClientRect();
  const at = r ? new DOMRect(Math.min(r.right - 2, window.innerWidth - 12 - 290), r.top - 4, 0, 0) : anchor;
  return openOverlay((close) => <ViewSettingsPanel ctx={ctx} close={close} />, { anchor: at, placement: r ? 'bottom-start' : 'bottom-end', offset: r ? 0 : 6, onClose: () => useVS.getState().set(null) });
}

/** Table header "•••" → property visibility page as a popover. */
export function openPropertyVisibility(anchor: HTMLElement, view: CollectionViewRecord, collection: CollectionRecord) {
  const block = records.get<BlockRecord>('block', view.parent_id);
  const ctx: Ctx = { block: block!, viewId: view.id, collectionId: collection.id, readOnly: false, inline: true, onSelectView: () => {} };
  return openOverlay((close) => (
    <PopoverSurface width={290} maxHeight="70vh" className="nc-view-settings">
      <div className="lit-scroller vertical nc-vs-scroll"><LiveVisibility ctx={ctx} close={close} /></div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom-end', offset: 4 });
}

function LiveVisibility({ ctx, close }: { ctx: Ctx; close: () => void }) {
  const view = useCollectionView(ctx.viewId);
  const collection = useCollection(ctx.collectionId);
  if (!view || !collection) return null;
  return <VisibilityPage ctx={ctx} view={view} collection={collection} go={() => close()} close={close} />;
}

export { Toggle };

// building blocks reused by the relation-feature pages (RelationFeatures.tsx)
export { Header as VSHeader, Row as VSRow, Section as VSSection, ToggleRow as VSToggleRow, pick as vsPick, pickMenu as vsPickMenu };
export type { Ctx as VSCtx, Page as VSPage };
