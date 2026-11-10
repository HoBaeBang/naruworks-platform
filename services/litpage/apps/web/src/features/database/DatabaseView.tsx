// Database chrome + active view, shared by inline databases (collection_view blocks) and full-page databases
// (collection_view_page). Layout:
//   inline, 1 view : [title (24/600) · hover "+"/"•••" · toolbar] then the view body
//   inline, 2+     : [title row] [tabs row (pill tabs) · toolbar] then the view body
//   full page      : page header (CollectionPage) [tabs row · toolbar] then the view body

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { compactId, expandId } from '@nc/shared/ids.ts';
import { canEditDatabaseContent, canEditDatabaseStructure, combinedFilter, countActive, defaultFilterOperator, isDatabaseLocked, propertyFiltersOf, viewTypeMeta, type GroupResult } from '@nc/shared/database/index.ts';
import { useBlock, useRecords, useCollection, useRole } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { run } from '../../lib/blocks.ts';
import { closePeek, getLocation, openPage, openPeek, useLocation } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { RichTextEditable } from '../editor/RichTextEditable.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { viewRegistry } from './viewRegistry.ts';
import { DatabaseContext, type DatabaseContextValue, type PeekMode } from './DatabaseContext.tsx';
import { activeViewKey, collectionOfView } from './data.ts';
import { addPropertyFilter, createRow } from './actions.ts';
import { databaseAccessOf } from './access.ts';
import { Toolbar } from './chrome/Toolbar.tsx';
import { ViewTabs, openAddViewMenu, openViewMenu, type TabDisplay } from './chrome/ViewTabs.tsx';
import { SelectionBar } from './chrome/SelectionBar.tsx';
import { FilterBar, openFilterPropertyPicker, openSortMenu } from './chrome/FilterBar.tsx';
import { openViewSettings, useViewSettingsState } from './chrome/ViewSettings.tsx';
import { NewDatabasePanel } from './chrome/NewDatabasePanel.tsx';
import { useAnchoredOverlayOpen } from './chrome/anchored.ts';
import { ArchivedViewBanner } from '../page/archive.tsx';
import { useEffectiveView } from './viewState.ts';
import { setPeekSource } from './peekNav.ts';
import { databaseDocumentTitle, useDocumentTitle } from './documentTitle.ts';
import './icons.tsx';
import './featureIcons.tsx';
import './dependencies.ts';
import './database.css';

const ACTIVE_KEY = activeViewKey;
const DISPLAY_KEY = (blockId: string) => `nc:tabDisplay:${blockId}`;

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    
  }
}

// Sidebar view rows (features/shell/sidebar/PageTree.tsx DbViewRow) open the database and dispatch nc:select-view

// the view up from its remembered active view.
window.addEventListener('nc:select-view', (e) => {
  const d = (e as CustomEvent<{ blockId?: string; viewId?: string }>).detail;
  if (d?.blockId && d.viewId) writeLS(ACTIVE_KEY(d.blockId), d.viewId);
});


function useActiveView(block: BlockRecord, inline: boolean): [string, (id: string) => void] {
  const ids = block.view_ids ?? [];
  const fromUrl = !inline ? new URLSearchParams(location.search).get('v') : null;
  const urlId = fromUrl ? expandId(fromUrl) : null;
  const [id, setId] = useState<string>(() => (urlId && ids.includes(urlId) ? urlId : readLS(ACTIVE_KEY(block.id)) ?? ''));
  const active = ids.includes(id) ? id : ids[0] ?? '';
  const select = useCallback((next: string) => {
    setId(next);
    writeLS(ACTIVE_KEY(block.id), next);
    if (!inline) {
      const u = new URL(location.href);
      u.searchParams.set('v', compactId(next));
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
  }, [block.id, inline]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ blockId?: string; viewId?: string }>).detail;
      // A view created in the same tick is not yet present in this render's block.
      if (d?.blockId === block.id && d.viewId && (records.get<BlockRecord>('block', block.id)?.view_ids ?? []).includes(d.viewId)) select(d.viewId);
    };
    window.addEventListener('nc:select-view', on);
    return () => window.removeEventListener('nc:select-view', on);
  }, [block.id, select]);
  return [active, select];
}


function useBleed(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [bleed, setBleed] = useState({ left: 0, right: 0, width: null as number | null });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setBleed({ left: 0, right: 0, width: null });
      return;
    }
    const frame = el.closest('.nc-page-scroller') as HTMLElement | null;
    if (!frame) return;
    const compute = () => {
      const fr = frame.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const left = Math.max(0, Math.round(r.left - fr.left));
      const width = frame.clientWidth;
      const right = Math.max(0, Math.round(width - left - r.width));
      setBleed((b) => (b.left === left && b.right === right && b.width === width ? b : { left, right, width }));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(frame);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return bleed;
}

function DbTitle({ collection, block, readOnly, className, linked }: { collection: CollectionRecord; block: BlockRecord; readOnly: boolean; className: string; linked: boolean }) {
  const name = (collection.name as RichText | undefined) ?? [];
  if (linked) {
    const host = records.get<BlockRecord>('block', collection.parent_id);
    return (
      <div className={`${className} linked`} role="link" onClick={() => host && openPage(host.id)}>
        <span className="nc-db-title-linked-icon">{host ? <PageIcon block={host} size={20} /> : <Icon name="viewTable" size={20} />}</span>
        <span className="nc-db-title-linked-text">{name.map((d) => d[0]).join('') || 'Untitled'}</span>
      </div>
    );
  }
  return (
    <RichTextEditable
      blockId={collection.id}
      property="name"
      value={name}
      readOnly={readOnly}
      tagName="div"
      className={`content-editable-leaf-rtl ${className}`}
      placeholder={block.collection_id && collection.id !== block.collection_id ? 'Create a dataset' : 'New database'}
      placeholderAlways
      spellCheck={false}
      onChange={(next) => run('renameDatabase', (tx) => tx.set('collection', collection.id, ['name'], next), { coalesceKey: `dbname:${collection.id}` })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
    />
  );
  void block;
}

export interface DatabaseViewProps {
  block: BlockRecord;
  inline: boolean;
  
  readOnly: boolean;
  
  structureReadOnly?: boolean;
  
  canAddRows?: boolean;
  
  header?: ReactNode;
  
  bleed?: boolean;
  
  pad?: number;
  
  documentTitle?: boolean;
}

export function DatabaseView({ block, inline, readOnly: hostReadOnly, structureReadOnly, canAddRows, header, bleed: allowBleed = true, pad = 96, documentTitle = false }: DatabaseViewProps) {
  const sro = structureReadOnly ?? hostReadOnly;
  const locked = isDatabaseLocked(block);
  const views = useRecords<CollectionViewRecord>('collection_view', block.view_ids).filter((v): v is CollectionViewRecord => !!v && v.alive !== false);
  const [activeId, setActiveId] = useActiveView(block, inline);
  
  const view = useEffectiveView(views.find((v) => v.id === activeId) ?? views[0]);
  const collection = useCollection(collectionOfView(view, block)?.id ?? block.collection_id);
  
  // view the source get read-only cells (rows page-level rules let them edit stay editable) and no new rows
  const linkedSourceId = collection && collection.parent_id !== block.id ? collection.id : undefined;
  const sourceRole = useRole('collection', linkedSourceId);
  const sourceBlock = useBlock(linkedSourceId ? collection?.parent_id : undefined);
  const readOnly = hostReadOnly || (!!linkedSourceId && !canEditDatabaseContent(sourceRole));
  const schemaRO = sro || (!!linkedSourceId && !canEditDatabaseStructure(sourceRole, sourceBlock));
  const canAdd = (canAddRows ?? !hostReadOnly) && (!linkedSourceId || databaseAccessOf(sourceBlock, sourceRole).canCreate);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const measured = useBleed(bodyRef, inline && allowBleed);
  const bleed = useMemo(() => (inline ? measured : { left: pad, right: pad, width: null }), [inline, measured, pad]);
  const [hovered, setHovered] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [selection, setSelectionState] = useState<string[]>([]);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [display, setDisplayState] = useState<TabDisplay>(() => (readLS(DISPLAY_KEY(block.id)) as TabDisplay) || 'text_and_icon');
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);
  // toolbar Filter: with rules it shows/hides the filter bar; without rules it opens the "Filter by…" picker right
  
  const [filterBarHidden, setFilterBarHidden] = useState(false);
  // title "+ •••": shown while the title is hovered, while a menu opened from them is open, and while one of this
  
  const titleZoneRef = useRef<HTMLDivElement>(null);
  const [titleHovered, setTitleHovered] = useState(false);
  const titleMenuOpen = useAnchoredOverlayOpen(titleZoneRef, '.nc-db-title-actions');
  
  const addViewOpen = useAnchoredOverlayOpen(titleZoneRef, '.lit-collection-add-view');
  const viewOptionsOpen = useAnchoredOverlayOpen(titleZoneRef, '.nc-db-view-options');
  const peekId = useLocation().peek?.pageId;
  const settings = useViewSettingsState();
  const [setupOpen, setSetupOpen] = useState(() => !inline && !!(block.format as any)?.nc_new_database_setup);

  const setSelection = useCallback((v: string[] | ((p: string[]) => string[])) => setSelectionState(v), []);
  useEffect(() => {
    setSelectionState([]);
    setFilterBarHidden(false);
  }, [view?.id]);
  // each view starts scrolled to its left edge (the body scroller element is shared between views)
  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollLeft = 0;
  }, [view?.id]);
  useEffect(() => {
    if (!selection.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.lit-overlay-container .nc-overlay')) setSelectionState([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection.length]);

  const peekMode: PeekMode = ((view?.format as any)?.collection_peek_mode as PeekMode | undefined) ?? (viewTypeMeta(view?.type).defaultPeek as PeekMode);

  const openRow = useCallback((rowId: string, mode?: PeekMode) => {
    const m = mode ?? peekMode;
    
    if (view && collection) setPeekSource({ viewId: view.id, collectionId: collection.id, search: search ?? '' });
    const loc = getLocation();
    if (loc.peek?.pageId === rowId) {
      closePeek();
      return;
    }
    if (m === 'full_page') openPage(rowId);
    else openPeek(rowId, m);
  }, [peekMode, view, collection, search]);

  const addRow = useCallback<DatabaseContextValue['addRow']>((opts = {}) => {
    if (!collection || !view) return '';
    const sub = (view.format as any)?.collection_group_by && view.type === 'board' ? (view.format as any).collection_group_by.property : undefined;
    const groupProp = view.type === 'board' ? (view.format as any)?.board_columns_by?.property : (view.format as any)?.collection_group_by?.property;
    const id = createRow(collection.id, {
      view, after: opts.after, before: opts.before, position: opts.position,
      group: opts.group ?? null, groupProp, subgroup: opts.subgroup ?? null, subgroupProp: sub,
    });
    if (opts.editTitle) setEditingTitle(id);
    if (opts.open) openRow(id);
    return id;
  }, [collection, view, openRow]);

  const addFilter = useCallback((propId: string) => {
    if (!view || !collection) return;
    const prop = collection.schema[propId];
    const id = addPropertyFilter(view, { property: propId, filter: { operator: defaultFilterOperator(prop) } });
    setOpenFilterId(id);
  }, [view, collection]);

  const ctx: DatabaseContextValue | null = useMemo(() => (view && collection ? {
    block, collection, view, readOnly, structureReadOnly: sro, schemaReadOnly: schemaRO, locked, canAddRows: canAdd, inline, search: search ?? '', selection, setSelection, peekMode, openRow, addRow, addFilter, bleed, editingTitle, setEditingTitle,
  } : null), [block, collection, view, readOnly, sro, schemaRO, locked, canAdd, inline, search, selection, setSelection, peekMode, openRow, addRow, addFilter, bleed, editingTitle]);

  useDocumentTitle(documentTitle && view && collection ? databaseDocumentTitle(toPlainText(collection.name as RichText | undefined), view.name || viewTypeMeta(view.type).label, views.length > 1) : null);

  if (!view || !collection || !ctx) {
    return <div className="nc-db-missing">{block.view_ids?.length ? 'Loading…' : 'No dataset available'}</div>;
  }

  const linked = collection.parent_id !== block.id;
  const multi = views.length > 1;
  const peekOfRow = !!peekId && records.get<BlockRecord>('block', peekId)?.parent_id === collection.id;
  const titleActionsShown = titleHovered || titleMenuOpen || peekOfRow;
  // a page column wider than its frame (e.g. beside a docked side peek) keeps the header 16px inside the frame edge
  
  const headerStyle = inline && bleed.width && bleed.width - bleed.left - 16 < 708 ? { maxWidth: bleed.width - bleed.left - 16 } : undefined;
  const Comp = viewRegistry[view.type] ?? viewRegistry.table!;
  const showTitle = (view.format as any)?.hide_linked_collection_name !== true;
  const onNew = (templateId?: string | 'empty') => {
    const id = createRow(collection.id, { view, position: 'start', templateId });
    openRow(id);
  };
  const toolbar = (
    <Toolbar
      block={block}
      collection={collection}
      view={view}
      inline={inline}
      readOnly={sro}
      canAdd={canAdd}
      visible
      search={search}
      setSearch={setSearch}
      settingsOpen={settings.openFor === view.id}
      onFilter={(a) => {
        const hasRules = !!(countActive(combinedFilter(view) ?? null, collection.schema) || propertyFiltersOf(view).length || (view.query2?.sort ?? []).length);
        if (hasRules) {
          setFilterBarHidden((h) => !h);
          return;
        }
        setFilterBarHidden(false);
        openFilterPropertyPicker(a, { view, collection, onPick: addFilter });
      }}
      onSort={(a) => openSortMenu(a, { view, collection })}
      onSettings={(a) => openViewSettings(a, { block, view, collection, readOnly: sro, inline, onSelectView: setActiveId })}
      onNew={onNew}
      compact={setupOpen}
    />
  );
  const tabs = (
    <ViewTabs
      block={block}
      views={views}
      activeId={view.id}
      collection={collection}
      readOnly={sro}
      onSelect={setActiveId}
      onEditView={() => rootRef.current && openViewSettings(rootRef.current.querySelector<HTMLElement>('.lit-collection-edit-view') ?? rootRef.current, { block, view, collection, readOnly: sro, inline, onSelectView: setActiveId })}
      onAdded={(id) => {
        setActiveId(id);
        setTimeout(() => {
          const anchor = rootRef.current?.querySelector<HTMLElement>('.lit-collection-edit-view');
          const v = records.get<CollectionViewRecord>('collection_view', id);
          if (anchor && v) openViewSettings(anchor, { block, view: v, collection, readOnly: sro, inline, onSelectView: setActiveId, newView: true });
        }, 50);
      }}
      display={display}
      setDisplay={(d) => {
        setDisplayState(d);
        writeLS(DISPLAY_KEY(block.id), d);
      }}
      hovered={hovered}
    />
  );
  const titleNode = showTitle && <DbTitle collection={collection} block={block} readOnly={sro || linked} className="nc-db-title-leaf" linked={linked} />;

  return (
    <DatabaseContext.Provider value={ctx}>
      <div
        ref={rootRef}
        className={`nc-db ${inline ? 'inline' : 'full'} ${inline && allowBleed ? 'bleed' : ''} ${multi ? 'multi' : 'single'} ${hovered ? 'hovered' : ''}`}
        data-db-block={block.id}
        data-db-collection={collection.id}
        data-db-view={view.id}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {header}
        {inline && !multi && (
          <div className="nc-db-header single" contentEditable={false} style={headerStyle}>
            <div className="nc-db-title-zone" ref={titleZoneRef} onMouseEnter={() => setTitleHovered(true)} onMouseLeave={() => setTitleHovered(false)}>
              <div className="nc-db-title-row">
                {titleNode || <div className="nc-db-title-spacer" />}
                {(!sro || !readOnly) && (
                  <div className={`nc-db-title-actions ${titleActionsShown ? 'visible' : ''}`}>
                    {!sro && <div role="button" className={`lit-collection-add-view nc-db-title-action${addViewOpen ? ' pressed' : ''}`} aria-label="Add view" aria-haspopup="dialog" data-tooltip="Create another layout" onClick={(e) => openAddViewMenu(e.currentTarget, { block, collection, linked, onCreated: (id) => { setActiveId(id); setTimeout(() => { const anchor = rootRef.current?.querySelector<HTMLElement>('.lit-collection-edit-view'); const v = records.get<CollectionViewRecord>('collection_view', id); if (anchor && v) openViewSettings(anchor, { block, view: v, collection, readOnly: sro, inline, onSelectView: setActiveId, newView: true }); }, 50); } })}>
                      <Icon name="plusSmall" size={16} />
                    </div>}
                    {titleActionsShown && <div role="button" className={`nc-db-title-action nc-db-view-options${viewOptionsOpen ? ' pressed' : ''}`} aria-label="View options" onClick={(e) => openViewMenu(e.currentTarget, { block, view, collection, readOnly: sro, onEdit: () => openViewSettings(e.currentTarget as HTMLElement, { block, view, collection, readOnly: sro, inline, onSelectView: setActiveId }), onSelect: setActiveId, display, setDisplay: (d) => { setDisplayState(d); writeLS(DISPLAY_KEY(block.id), d); } })}>
                      <Icon name="ellipsisSmall" size={16} />
                    </div>}
                  </div>
                )}
              </div>
            </div>
            {toolbar}
            {selection.length > 0 && <SelectionBar selection={selection} setSelection={setSelection} collection={collection} view={view} />}
          </div>
        )}
        {inline && multi && showTitle && (
          <div className="nc-db-title-only" contentEditable={false}>
            <div className="nc-db-title-row">{titleNode}</div>
          </div>
        )}
        {(multi || !inline) && (
          <div className="nc-db-header tabs" contentEditable={false} style={inline ? headerStyle : undefined}>
            {tabs}
            {toolbar}
            {selection.length > 0 && <SelectionBar selection={selection} setSelection={setSelection} collection={collection} view={view} />}
          </div>
        )}
        {}
        <FilterBar view={view} collection={collection} readOnly={false} openFilterId={openFilterId} onOpened={() => setOpenFilterId(null)} hidden={filterBarHidden} />
        <ArchivedViewBanner blockId={block.id} />
        <div ref={bodyRef} className="nc-db-body-anchor" />
        <div
          ref={scrollerRef}
          className="lit-scroller horizontal lit-collection-view-body nc-db-body"
          contentEditable={false}
          style={inline && bleed.width ? { width: bleed.width, marginInlineStart: -bleed.left } : undefined}
        >
          <Comp block={block} view={view} collection={collection} readOnly={readOnly} />
        </div>
        {setupOpen && <NewDatabasePanel block={block} collection={collection} view={view} onClose={() => { setSetupOpen(false); run('dismissDatabaseSetup', (tx) => tx.update('block', block.id, ['format'], { nc_new_database_setup: null }), { skipHistory: true }); }} />}
      </div>
    </DatabaseContext.Provider>
  );
}

export type { GroupResult };
