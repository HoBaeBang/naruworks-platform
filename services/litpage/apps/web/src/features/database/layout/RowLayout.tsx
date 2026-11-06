// Database row pages rendered through the data source's page layout (…009): pinned heading properties,
// the property group (named, collapsible sections; per-layout hidden properties), single-property modules, page
// discussions, a details panel on the right ("View details" / "Hide details"), tabbed structure (Content + related
// database tabs) and the page settings (property icons, page discussions, database templates).
// PageView renders: header → <RowLayoutTop/> → content → <RowLayoutBottom/>, plus <RowDetailsPanel/> in its grid.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { encodeRelation, type LayoutModule, type PageLayout, type PropertiesModule } from '@nc/shared/database/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useCollection } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { openPeek } from '../../../lib/router.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { PropertyCell, PropertyIcon } from '../properties/PropertyCell.tsx';
import { AddPropertyRow, PropertyRows, TemplateBanner, openLabelMenu, pageProperties } from '../RowProperties.tsx';
import { RowComments } from '../RowPageExtras.tsx';
import { collectionRows, useDatabaseVersion } from '../data.ts';
import { useCollectionAccess } from '../access.ts';
import { createRow } from '../actions.ts';
import { DETAILS_PANEL_WIDTH, useDetailsPanel, useRowPageLayout } from './model.ts';
import { relationIdsOf } from '@nc/shared/relation/index.ts';
import { openRelationPicker, relationShownProperties } from '../advanced/RelationPicker.tsx';
import '../featureIcons.tsx';
import './layout.css';

interface RowProps {
  page: BlockRecord;
  readOnly: boolean;
  publicView?: boolean;
  canComment: boolean;
}

function SectionView({ page, col, section, hidden, readOnly, structureRO, icons, custom }: { page: BlockRecord; col: CollectionRecord; section: PropertiesModule['sections'][number]; hidden: string[]; readOnly: boolean; structureRO: boolean; icons: boolean; custom: boolean }) {
  const [collapsed, setCollapsed] = useState(!!section.collapsed);
  const ids = section.properties.filter((p) => !hidden.includes(p) && col.schema[p]);
  if (!section.name) return <PropertyRows page={page} col={col} ids={ids} readOnly={readOnly} structureRO={structureRO} icons={icons} reorder={!custom} />;
  return (
    <div className="nc-layout-section">
      <div role="button" className={`nc-layout-section-head ${collapsed ? 'collapsed' : ''}`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        <Icon name="triangleRight" size={10} />
        <span>{section.name}</span>
      </div>
      {!collapsed && <PropertyRows page={page} col={col} ids={ids} readOnly={readOnly} structureRO={structureRO} icons={icons} reorder={false} />}
    </div>
  );
}

function PropertyGroupView({ m, page, col, readOnly, structureRO, icons, custom, inPanel }: { m: PropertiesModule; page: BlockRecord; col: CollectionRecord; readOnly: boolean; structureRO: boolean; icons: boolean; custom: boolean; inPanel?: boolean }) {
  return (
    <div className={`nc-row-props-wrap ${inPanel ? 'in-panel' : ''}`}>
      <div role="table" aria-label="Page properties" className={`nc-row-props ${icons ? '' : 'no-icons'}`}>
        {m.sections.map((s) => <SectionView key={s.id} page={page} col={col} section={s} hidden={m.hidden} readOnly={readOnly} structureRO={structureRO} icons={icons} custom={custom} />)}
        {!structureRO && !inPanel && <AddPropertyRow col={col} />}
      </div>
    </div>
  );
}

/** A property shown on its own (module): label above a full-width value. */
function PlainPropertyModule({ propId, page, col, readOnly, structureRO, icons }: { propId: string; page: BlockRecord; col: CollectionRecord; readOnly: boolean; structureRO: boolean; icons: boolean }) {
  const p: PropertySchema | undefined = col.schema[propId];
  if (!p) return null;
  return (
    <div className="nc-layout-prop-module" data-property={propId}>
      <div role="button" className="nc-layout-prop-module-label" onClick={(e) => openLabelMenu(e.currentTarget, col, propId, structureRO)}>
        {icons && <PropertyIcon prop={p} size={16} />}
        <span>{p.name}</span>
      </div>
      <PropertyCell row={page} schema={col.schema} propId={propId} readOnly={readOnly} mode="page" wrap placeholder={<span className="nc-page-prop-empty">Empty</span>} className="nc-page-prop-cell" />
    </div>
  );
}

/** Relation in its own module = a page section listing the related pages (minimal page section, /): * icon + title (+ the properties chosen as "Shown in relation"), click opens the page in a side peek, "Add a relation" * opens the relation picker. */
function RelationSection({ propId, page, col, readOnly, structureRO, icons }: { propId: string; page: BlockRecord; col: CollectionRecord; readOnly: boolean; structureRO: boolean; icons: boolean }) {
  useDatabaseVersion();
  const p: PropertySchema | undefined = col.schema[propId];
  const target = useCollection(p?.collection_id as string | undefined) as CollectionRecord | undefined;
  if (!p) return null;
  const ids = relationIdsOf(page.properties?.[propId] as never);
  const pages = ids.map((id) => records.get<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && b.alive !== false);
  const shown = relationShownProperties(p, target);
  return (
    <div className="nc-layout-relation-section" data-property={propId} data-testid="relation-section">
      <div className="nc-layout-relation-head">
        <div role="button" className="nc-layout-prop-module-label" onClick={(e) => openLabelMenu(e.currentTarget, col, propId, structureRO)}>
          {icons && <PropertyIcon prop={p} size={16} />}
          <span>{p.name}</span>
        </div>
        <span className="nc-layout-relation-count">{pages.length}</span>
      </div>
      <div className="nc-layout-relation-list">
        {pages.map((b) => (
          <div key={b.id} role="button" className="nc-layout-relation-row" onClick={() => openPeek(b.id, 'side_peek')}>
            <PageIcon block={b} size={18} />
            <span className="nc-layout-relation-title nc-ellipsis">{toPlainText(b.properties?.title) || 'Untitled'}</span>
            {target && shown.map((sp) => <PropertyCell key={sp} row={b} schema={target.schema} propId={sp} readOnly noEdit className="nc-layout-relation-prop" />)}
          </div>
        ))}
        {!pages.length && <div className="nc-layout-relation-empty">No related pages</div>}
        {!readOnly && (
          <div role="button" className="nc-layout-relation-add" data-testid="relation-section-add" onClick={(e) => openRelationPicker(e.currentTarget, { rowIds: [page.id], propId, collectionId: col.id })}>
            <Icon name="plus" size={14} /><span>Add a relation</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A property shown on its own (module); relations render as a page section. */
function PropertyModuleView(props: { propId: string; page: BlockRecord; col: CollectionRecord; readOnly: boolean; structureRO: boolean; icons: boolean }) {
  if (props.col.schema[props.propId]?.type === 'relation') return <RelationSection {...props} />;
  return <PlainPropertyModule {...props} />;
}

function ModuleView({ m, page, col, layout, props, structureRO, custom, inPanel }: { m: LayoutModule; page: BlockRecord; col: CollectionRecord; layout: PageLayout; props: RowProps; structureRO: boolean; custom: boolean; inPanel?: boolean }) {
  const icons = layout.settings.property_icons !== false;
  const wrap = (node: ReactNode) => (inPanel ? <div className="nc-layout-panel-module">{node}</div> : <div className="layout-content">{node}</div>);
  switch (m.type) {
    case 'properties':
      return wrap(<PropertyGroupView m={m} page={page} col={col} readOnly={props.readOnly} structureRO={structureRO} icons={icons} custom={custom} inPanel={inPanel} />);
    case 'property':
      return wrap(<PropertyModuleView propId={m.property} page={page} col={col} readOnly={props.readOnly} structureRO={structureRO} icons={icons} />);
    case 'discussions':
      if (props.publicView || layout.settings.page_discussions === false) return null;
      return inPanel ? wrap(<RowComments pageId={page.id} canComment={props.canComment} />) : <RowComments pageId={page.id} canComment={props.canComment} />;
    default:
      return null;
  }
}

/** Heading: pinned properties under the title (horizontal, scrolls with ‹ › when they overflow). */
function PinnedProperties({ ids, page, col, readOnly, icons }: { ids: string[]; page: BlockRecord; col: CollectionRecord; readOnly: boolean; icons: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflow({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    measure();
    el.addEventListener('scroll', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [ids.join(',')]);
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * 240, behavior: 'smooth' });
  return (
    <div className="nc-pinned-props-wrap">
      {overflow.left && <span role="button" className="nc-pinned-scroll left" aria-label="Scroll left" onClick={() => scroll(-1)}><Icon name="chevronLeft" size={14} /></span>}
      <div className="nc-pinned-props hide-scrollbar" ref={ref} aria-label="Pinned properties">
        {ids.map((id) => {
          const p = col.schema[id];
          if (!p) return null;
          return (
            <div key={id} className="nc-pinned-prop" data-property={id}>
              <div className="nc-pinned-prop-label">{icons && <PropertyIcon prop={p} size={14} />}<span>{p.name}</span></div>
              <PropertyCell row={page} schema={col.schema} propId={id} readOnly={readOnly} mode="page" placeholder={<span className="nc-page-prop-empty">Empty</span>} className="nc-pinned-prop-value" />
            </div>
          );
        })}
      </div>
      {overflow.right && <span role="button" className="nc-pinned-scroll right" aria-label="Scroll right" onClick={() => scroll(1)}><Icon name="chevronRight" size={14} /></span>}
    </div>
  );
}

/** Tabbed structure: "Content" + tabs listing the related pages of another data source (+ new related page). */
function RelatedTab({ page, tab }: { page: BlockRecord; tab: NonNullable<PageLayout['tabs']>[number] }) {
  useDatabaseVersion();
  const target = useCollection(tab.collection_id);
  if (!target) return <div className="nc-layout-tab-empty">This data source isn’t available.</div>;
  const relProp = Object.entries(target.schema).find(([, p]) => p.type === 'relation' && ((p.collection_pointer as { id?: string } | undefined)?.id ?? p.collection_id) === page.parent_id)?.[0];
  const rows = relProp ? collectionRows(target.id).filter((r) => JSON.stringify(r.properties?.[relProp] ?? []).includes(page.id)) : [];
  return (
    <div className="nc-layout-tab-list">
      {rows.map((r) => (
        <div key={r.id} role="link" className="nc-layout-tab-row" onClick={() => openPeek(r.id, 'side_peek')}>
          <PageIcon block={r} size={16} fallback="page" />
          <span className="nc-layout-tab-row-title">{toPlainText(r.properties?.title) || 'Untitled'}</span>
        </div>
      ))}
      {!rows.length && <div className="nc-layout-tab-empty">No related pages</div>}
      {relProp && (
        <div role="button" className="nc-layout-tab-new" onClick={() => createRow(target.id, { properties: { [relProp]: encodeRelation([page.id], page.space_id) }, action: 'layout.newRelatedPage' })}>
          <Icon name="plusSmall" size={16} /><span>New page</span>
        </div>
      )}
    </div>
  );
}

function LayoutTabs({ page, layout }: { page: BlockRecord; layout: PageLayout }) {
  const [active, setActive] = useState('content');
  const ref = useRef<HTMLDivElement>(null);
  const tab = layout.tabs?.find((t) => t.id === active);
  useLayoutEffect(() => {
    // a database tab replaces the page content below the tab bar
    const root = ref.current?.closest('.layout');
    root?.classList.toggle('nc-layout-tab-active', !!tab);
    return () => root?.classList.remove('nc-layout-tab-active');
  }, [tab]);
  return (
    <div className="layout-content" ref={ref}>
      <div className="nc-layout-tabs" role="tablist">
        <div role="tab" aria-selected={active === 'content'} className={`nc-layout-tab ${active === 'content' ? 'active' : ''}`} onClick={() => setActive('content')}>Content</div>
        {(layout.tabs ?? []).map((t) => (
          <div key={t.id} role="tab" aria-selected={active === t.id} className={`nc-layout-tab ${active === t.id ? 'active' : ''}`} onClick={() => setActive(t.id)}>{t.name}</div>
        ))}
      </div>
      {tab && <RelatedTab page={page} tab={tab} />}
    </div>
  );
}

function HeaderActions({ page, hasPanel, panelOpen, collectionId }: { page: BlockRecord; hasPanel: boolean; panelOpen: boolean; collectionId: string }) {
  if (!hasPanel) return null;
  return (
    <div className="nc-layout-head-actions">
      <div
        role="button"
        className={`nc-layout-head-btn ${panelOpen ? 'on' : ''}`}
        aria-label="Layout/conceal details"
        data-testid="toggle-details"
        onClick={() => useDetailsPanel.getState().set(collectionId, !panelOpen)}
      >
        <Icon name="panelRight" size={16} />
        <span>{panelOpen ? 'Hide details' : 'View details'}</span>
      </div>
      {void page}
    </div>
  );
}

export function RowLayoutTop(props: RowProps) {
  useDatabaseVersion();
  const st = useRowPageLayout(props.page.id);
  const access = useCollectionAccess(st.collection?.id);
  const col = st.collection;
  if (!col || !st.layout) return null;
  const structureRO = props.readOnly || !access.canEditStructure;
  const main = st.layout.modules.page_main;
  const editorIdx = main.findIndex((m) => m.type === 'editor');
  const before = main.slice(1, editorIdx < 0 ? undefined : editorIdx);
  const title = main[0];
  const custom = !!col.format?.page_layout;
  const icons = st.layout.settings.property_icons !== false;
  return (
    <>
      <div className="layout-content nc-row-layout-head">
        <TemplateBanner page={props.page} col={col} />
        {title?.type === 'title' && title.pinned.length > 0 && <PinnedProperties ids={title.pinned} page={props.page} col={col} readOnly={props.readOnly} icons={icons} />}
        <HeaderActions page={props.page} hasPanel={st.hasPanel} panelOpen={st.panelOpen} collectionId={col.id} />
      </div>
      {before.map((m) => <ModuleView key={m.id} m={m} page={props.page} col={col} layout={st.layout!} props={props} structureRO={structureRO} custom={custom} />)}
      {st.layout.structure === 'tabbed' && <LayoutTabs page={props.page} layout={st.layout} />}
    </>
  );
}

export function RowLayoutBottom(props: RowProps) {
  useDatabaseVersion();
  const st = useRowPageLayout(props.page.id);
  const access = useCollectionAccess(st.collection?.id);
  const col = st.collection;
  if (!col || !st.layout) return null;
  const main = st.layout.modules.page_main;
  const editorIdx = main.findIndex((m) => m.type === 'editor');
  if (editorIdx < 0) return null;
  const after = main.slice(editorIdx + 1);
  const structureRO = props.readOnly || !access.canEditStructure;
  return <>{after.map((m) => <ModuleView key={m.id} m={m} page={props.page} col={col} layout={st.layout!} props={props} structureRO={structureRO} custom={!!col.format?.page_layout} />)}</>;
}

/** Details panel (right column of the page grid). */
export function RowDetailsPanel(props: RowProps) {
  useDatabaseVersion();
  const st = useRowPageLayout(props.page.id);
  const access = useCollectionAccess(st.collection?.id);
  const col = st.collection;
  if (!col || !st.layout || !st.panelOpen) return null;
  const structureRO = props.readOnly || !access.canEditStructure;
  return (
    <aside className="nc-row-details-panel" aria-label="Details" style={{ width: DETAILS_PANEL_WIDTH }}>
      <div className="nc-row-details-head">
        <span role="button" className="nc-row-details-close" aria-label="Hide details" data-tooltip="Hide details" onClick={() => useDetailsPanel.getState().set(col.id, false)}><Icon name="arrowChevronDoubleRight" size={16} /></span>
      </div>
      {st.layout.modules.page_details.map((m) => <ModuleView key={m.id} m={m} page={props.page} col={col} layout={st.layout!} props={props} structureRO={structureRO} custom inPanel />)}
    </aside>
  );
}

/** Page grid style while the details panel is open (PageView merges it into the layout's style). */
export function rowPanelStyle(panelOpen: boolean): Record<string, string> | undefined {
  return panelOpen ? { '--margin-right-width': `minmax(${DETAILS_PANEL_WIDTH + 24}px, 1fr)` } : undefined;
}

export { useRowPageLayout, pageProperties, records };
