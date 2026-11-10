// Database toolbar (aria order: Filter, Sort, Automations, AI Autofill, Search, Launch as full entry, Settings)
// + blue "New" split button with the templates menu ("More create options").
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { countActive, combinedFilter } from '@nc/shared/database/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { pageUrl, openPeek } from '../../../lib/router.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { compactId } from '@nc/shared/ids.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { collectionTemplates } from '../data.ts';
import { createRow, createTemplate, defaultTemplateId } from '../actions.ts';
import { toolbarExtrasRegistry, toolbarLeadingRegistry } from '../viewRegistry.ts';
import { useAnchoredOverlayOpen } from './anchored.ts';
import { collectionAccess } from '../access.ts';
import { SprintToolbarButton } from '../sprints/SprintSettings.tsx';
import { openTemplateItemMenu, templateCaption } from '../templates/templates.tsx';
import { loadAutomations } from '../automations/api.ts';
import { openToolbarAutofillMenu } from '../../ai/autofillUi.tsx';

export function ToolButton({ icon, label, onClick, active, pressed, className, rotate }: { icon: string; label: string; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; active?: boolean; pressed?: boolean; className?: string; rotate?: boolean }) {
  return (
    <div
      role="button"
      aria-label={label}
      aria-haspopup="dialog"
      data-tooltip={label}
      className={`nc-db-tool ${active ? 'active' : ''} ${pressed ? 'pressed' : ''} ${className ?? ''}`}
      onClick={onClick}
    >
      <Icon name={icon} size={16} style={rotate ? { transform: 'rotate(180deg)' } : undefined} />
    </div>
  );
}

/** ⚡ Automations: the data source's automation list, or the builder when there are none yet (automations/list.tsx). */
export function openAutomations(collection: CollectionRecord, anchor?: HTMLElement | null) {
  void import('../automations/list.tsx').then((m) => m.openAutomations(collection, anchor));
}

export function openTemplatesMenu(anchor: HTMLElement, opts: { collection: CollectionRecord; view: CollectionViewRecord; onCreateFrom: (templateId: string | 'empty') => void }) {
  const { collection, view } = opts;
  const templates = collectionTemplates(collection);
  const defId = defaultTemplateId(collection, view);
  const name = toPlainText(collection.name as any) || 'Untitled';
  // templates are part of the database's structure: locked databases / Can edit content only use them
  const access = collectionAccess(collection.id);
  const templateMenu = (t: BlockRecord) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!access.canEditStructure) return;
    // Set as default (all views / this view), Edit, Duplicate every…, Duplicate, Delete (database/templates)
    openTemplateItemMenu(e.currentTarget as HTMLElement, { t, collection, view, isDefault: defId === t.id });
  };
  void loadAutomations(collection.id).catch(() => {}); // repeating templates ("Duplicate weekly" captions)
  // new-more-menu (no templates yet): 360 wide — "Templates for ‹db›" + Help, the description, a role=menu
  // with "New template" (secondary text), then "Create shortcut to sidebar" below a divider
  let close: () => void = () => {};
  close = openMenu(anchor, {
    width: 360,
    role: 'menu',
    initialActive: -1,
    className: 'nc-templates-menu',
    header: (
      <div className="nc-templates-head">
        <div className="nc-templates-title-row">
          <span className="nc-templates-title">Templates for {name}</span>
          <span role="button" className="nc-templates-help" aria-label="Help" data-tooltip="Learn about database templates"><Icon name="questionMarkCircle" size={16} /></span>
        </div>
        {!templates.length && access.canEditStructure && <div className="nc-templates-desc">Create a reusable entry template for this table.</div>}
        {access.locked && <div className="nc-templates-desc">This table is locked. Unlock it to create templates.</div>}
      </div>
    ),
    sections: [
      ...(templates.length ? [{
        items: [
          ...templates.map((t) => ({
            id: t.id,
            label: toPlainText(t.properties?.title) || 'Untitled',
            icon: <PageIcon block={t} size={20} />,
            badge: defId === t.id ? 'Default' : undefined,
            description: templateCaption(t.id),
            right: access.canEditStructure ? <span role="button" className="nc-template-more" aria-label="Template options" onClick={templateMenu(t)}><Icon name="ellipsisSmall" size={16} /></span> : undefined,
            onSelect: () => opts.onCreateFrom(t.id),
          })),
          { id: 'empty', label: 'Empty', icon: 'pageEmpty', badge: !defId ? 'Default' : undefined, onSelect: () => opts.onCreateFrom('empty') },
        ],
      }] : []),
      ...(!access.canEditStructure ? [] : [{ items: [{ id: 'new', label: <span className="nc-templates-new">New template</span>, text: 'New template', icon: 'plus', iconColor: 'var(--lp-icon-secondary)', onSelect: () => { const id = createTemplate(collection.id); openPeek(id, 'center_peek'); } }] }]),
    ],
    footer: (
      <div className="nc-templates-foot">
        <div role="button" className="nc-menu-item nc-templates-shortcut" onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); useUI.getState().toast('Sidebar shortcuts for templates are not available yet'); }}>
          <div className="nc-menu-item-inner nc-mi">
            <div className="nc-menu-icon"><Icon name="sidebarLeft" size={20} /></div>
            <div className="nc-menu-label">Create shortcut to sidebar</div>
          </div>
        </div>
      </div>
    ),
  }, { placement: 'bottom-end' });
  return close;
}

export interface ToolbarProps {
  block: BlockRecord;
  collection: CollectionRecord;
  view: CollectionViewRecord;
  inline: boolean;
  readOnly: boolean;
  /** the blue "New" button (defaults to !readOnly) */
  canAdd?: boolean;
  visible: boolean;
  search: string | null;
  setSearch: (s: string | null) => void;
  settingsOpen: boolean;
  onFilter: (anchor: HTMLElement) => void;
  onSort: (anchor: HTMLElement) => void;
  onSettings: (anchor: HTMLElement) => void;
  onNew: (templateId?: string | 'empty') => void;
  compact?: boolean;
}

const MINIMIZED_KEY = (viewId: string) => `nc:dbActionsMinimized:${viewId}`;
function readMinimized(viewId: string) {
  try {
    return localStorage.getItem(MINIMIZED_KEY(viewId)) === '1';
  } catch {
    return false;
  }
}
function writeMinimized(viewId: string, v: boolean) {
  try {
    if (v) localStorage.setItem(MINIMIZED_KEY(viewId), '1');
    else localStorage.removeItem(MINIMIZED_KEY(viewId));
  } catch {
    /* ignore */
  }
}

/** Chevron shown while actions are hovered: “Minimize” collapses them to the settings button, “Expand” restores them. */
function MinimizeToggle({ minimized, onClick }: { minimized: boolean; onClick: () => void }) {
  const label = minimized ? 'Expand' : 'Minimize';
  return (
    <div role="button" aria-label={label} data-tooltip={label} className="nc-db-tool nc-db-minimize" onClick={onClick}>
      <Icon name={minimized ? 'arrowChevronDoubleLeft' : 'arrowChevronDoubleRight'} size={16} />
    </div>
  );
}

export function Toolbar(p: ToolbarProps) {
  const { view, collection, block } = p;
  const ToolbarExtra = toolbarExtrasRegistry[view.type];
  const ToolbarLeading = toolbarLeadingRegistry[view.type];
  const filterCount = countActive(combinedFilter(view) ?? null, collection.schema);
  const sortCount = (view.query2?.sort ?? []).filter((s) => collection.schema[s.property]).length;
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [hoverNew, setHoverNew] = useState(false);
  const [hover, setHover] = useState(false);
  const [minimized, setMinimizedState] = useState(() => readMinimized(view.id));
  useEffect(() => setMinimizedState(readMinimized(view.id)), [view.id]);
  const setMinimized = (v: boolean) => {
    setMinimizedState(v);
    writeMinimized(view.id, v);
  };
  // The Filter, Sort, and New popovers keep the actions hovered by portaling from this container.
  // View settings and search do not keep the actions hovered.
  const popoverOpen = useAnchoredOverlayOpen(rootRef, '.lit-collection-filter, .lit-collection-sort, .nc-db-new-more, .nc-db-new');
  // The button whose picker is open keeps its pressed background.
  const filterOpen = useAnchoredOverlayOpen(rootRef, '.lit-collection-filter');
  const sortOpen = useAnchoredOverlayOpen(rootRef, '.lit-collection-sort');
  const newMenuOpen = useAnchoredOverlayOpen(rootRef, '.nc-db-new-more');
  useEffect(() => {
    if (p.search !== null) searchRef.current?.focus();
  }, [p.search !== null]);
  const hovered = hover || popoverOpen;
  const settingsButton = <ToolButton icon="dbToolSettings" label="Settings" className="lit-collection-edit-view" pressed={p.settingsOpen} onClick={(e) => p.onSettings(e.currentTarget)} />;
  if (minimized && !p.compact) {
    return (
      <div ref={rootRef} className="nc-db-toolbar minimized" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {hovered && <MinimizeToggle minimized onClick={() => setMinimized(false)} />}
        {settingsButton}
      </div>
    );
  }
  return (
    <div ref={rootRef} className={`nc-db-toolbar ${filterCount > 0 || sortCount > 0 ? 'has-rules' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* mounted only while hovered: toggle enters the layout (the title side shrinks by half its width — filter-menu: title leaf 213.2 vs 227.2) */}
      {!p.compact && hovered && <MinimizeToggle minimized={false} onClick={() => setMinimized(true)} />}
      {!p.compact && (
        <>
          {ToolbarLeading && <ToolbarLeading block={block} view={view} collection={collection} readOnly={p.readOnly} />}
          <ToolButton icon="dbToolFilter" label="Filter" className="lit-collection-filter" active={filterCount > 0} pressed={filterOpen} onClick={(e) => p.onFilter(e.currentTarget)} />
          <ToolButton icon="arrowUpDownSmall" label="Sort" className="lit-collection-sort" active={sortCount > 0} pressed={sortOpen} onClick={(e) => p.onSort(e.currentTarget)} />
          <ToolButton icon="dbToolLightning" label="Automations" className="lit-collection-automation-edit-view" onClick={(e) => openAutomations(collection, e.currentTarget)} />
          <ToolButton icon="magicWandSmall" label="AI Autofill" onClick={(e) => openToolbarAutofillMenu(e.currentTarget, collection.id, view)} />
          <div className={`nc-db-search ${p.search !== null ? 'open' : ''}`}>
            <ToolButton icon="dbToolSearch" label="Search" onClick={() => (p.search === null ? p.setSearch('') : searchRef.current?.focus())} />
            {p.search !== null && (
              <input
                ref={searchRef}
                className="nc-db-search-input"
                placeholder="Type to find…"
                value={p.search}
                onChange={(e) => p.setSearch(e.target.value)}
                onBlur={() => { if (!p.search) p.setSearch(null); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); p.setSearch(null); } }}
              />
            )}
            {p.search && <span role="button" className="nc-db-search-clear" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { p.setSearch(''); searchRef.current?.focus(); }}><Icon name="xMarkSmall" size={11} strokeWidth={2.4} /></span>}
          </div>
          {p.inline && (
            <a role="link" className="nc-db-tool" aria-label="Launch as full entry" data-tooltip="Launch as full entry" href={`${pageUrl(block.id)}?v=${compactId(view.id)}`} onClick={(e) => { e.preventDefault(); history.pushState(null, '', `${pageUrl(block.id)}?v=${compactId(view.id)}`); dispatchEvent(new PopStateEvent('popstate')); }}>
              <Icon name="dbToolExpand" size={16} />
            </a>
          )}
        </>
      )}
      {settingsButton}
      <SprintToolbarButton view={view} collection={collection} readOnly={p.canAdd === false && p.readOnly} />
      {ToolbarExtra ? <ToolbarExtra block={block} view={view} collection={collection} readOnly={p.readOnly} /> : (p.canAdd ?? !p.readOnly) && (
        <div className="nc-db-new-wrap">
          <div className={`lit-collection-view-item-add ${hoverNew ? 'hover' : ''}${newMenuOpen ? ' open' : ''}`} data-inp-target="collection-add-item">
            <div role="button" aria-haspopup="dialog" className="nc-db-new" onMouseEnter={() => setHoverNew(true)} onMouseLeave={() => setHoverNew(false)} onClick={() => p.onNew()}>New</div>
            <div role="button" aria-label="More create options" aria-haspopup="dialog" className="nc-db-new-more" onClick={(e) => openTemplatesMenu(e.currentTarget, { collection, view, onCreateFrom: (t) => p.onNew(t) })}>
              <Icon name="arrowChevronSingleDownSmall" size={16} strokeWidth={2} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { createRow };
