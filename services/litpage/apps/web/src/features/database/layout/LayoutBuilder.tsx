// "Customize layout" — the database page layout builder (…010;,
// /242/244/246): header (database icon + name, "Preview: ‹page› ▾", × Cancel, ✓ Apply to all entries + More
// save options ▾ › Reset to original entry layout), a canvas with the page (Heading, Property group, modules, Page
// discussions, Content, "+" Create entry module) and the details panel ("Create to panel", Hide sidebar), and the
// configuration sidebar (Page settings: Structure Simple / Tabbed, Inline comments, Page discussions, Property icons,
// Full width, Database templates — or the selected module's settings). Edits are a draft until Apply to all entries.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, PropertySchema, PropertyType } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import {
  MAX_PINNED_PROPERTIES, PICKER_SECTIONS, canMoveToPanel, newLayoutModuleId, normalizePageLayout, propertyTypeMeta,
  type LayoutArea, type LayoutModule, type PageLayout, type PropertiesModule, type TitleModule,
} from '@nc/shared/database/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import type { MenuDef, MenuItemDef } from '../../../components/Menu.tsx';
import { openNestedMenu as openMenu } from '../menus.ts';
import { openOverlay, overlayCount } from '../../../components/overlay.tsx';
import { useCollection } from '../../../lib/hooks.ts';
import { confirmDialog } from '../../page/confirm.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { ValueView } from '../properties/ValueView.tsx';
import { openEditPropertyPopover } from '../properties/PropertyMenus.tsx';
import { Toggle } from '../properties/editors/DatePicker.tsx';
import { addProperty } from '../actions.ts';
import { collectionRows, makeQueryContext, useDatabaseVersion } from '../data.ts';
import { getPropertyValue, isEmptyValue } from '@nc/shared/database/index.ts';
import { applyPageLayout, pageLayoutOf, pagePropertyOrder, resetPageLayout } from './model.ts';
import '../featureIcons.tsx';
import './layout.css';

type Sel = { kind: 'page' } | { kind: 'module'; id: string };

const MODULE_LABEL: Record<string, string> = { title: 'Heading', properties: 'Property group', discussions: 'Page discussions', editor: 'Content' };

function clone(l: PageLayout): PageLayout {
  return structuredClone(l);
}

function findModule(l: PageLayout, id: string): { area: LayoutArea; index: number; m: LayoutModule } | null {
  for (const area of ['page_main', 'page_details'] as LayoutArea[]) {
    const index = l.modules[area].findIndex((m) => m.id === id);
    if (index >= 0) return { area, index, m: l.modules[area][index] };
  }
  return null;
}

function groupOf(l: PageLayout): PropertiesModule | undefined {
  return [...l.modules.page_main, ...l.modules.page_details].find((m): m is PropertiesModule => m.type === 'properties');
}

/** Take a property out of wherever it is (pins, group sections, modules). */
function detachProperty(l: PageLayout, pid: string) {
  const title = l.modules.page_main[0] as TitleModule;
  if (title?.type === 'title') title.pinned = title.pinned.filter((p) => p !== pid);
  const g = groupOf(l);
  if (g) for (const s of g.sections) s.properties = s.properties.filter((p) => p !== pid);
  for (const area of ['page_main', 'page_details'] as LayoutArea[]) l.modules[area] = l.modules[area].filter((m) => !(m.type === 'property' && m.property === pid));
}

function returnToGroup(l: PageLayout, pid: string) {
  const g = groupOf(l);
  if (!g) return;
  detachProperty(l, pid);
  g.sections[g.sections.length - 1].properties.push(pid);
}

// ------------------------------------------------------------------ canvas modules

function PreviewValue({ row, pid, col }: { row: BlockRecord | undefined; pid: string; col: CollectionRecord }) {
  const ctx = makeQueryContext();
  if (!row) return <span className="nc-page-prop-empty">Empty</span>;
  const v = getPropertyValue(row, pid, col.schema, ctx);
  if (isEmptyValue(v) && v.kind !== 'checkbox') return <span className="nc-page-prop-empty">Empty</span>;
  return <ValueView value={v} prop={col.schema[pid]} propId={pid} row={row} ctx={ctx} wrap readOnly mode="cell" />;
}

function PropRowPreview({ pid, col, row, icons, eye }: { pid: string; col: CollectionRecord; row?: BlockRecord; icons: boolean; eye?: ReactNode }) {
  const p = col.schema[pid];
  if (!p) return null;
  return (
    <div className="nc-lb-prop-row">
      <div className="nc-lb-prop-label">{icons && <PropertyIcon prop={p} size={16} />}<span>{p.name}</span></div>
      <div className="nc-lb-prop-value"><PreviewValue row={row} pid={pid} col={col} /></div>
      {eye}
    </div>
  );
}

function ModuleFrame({ m, selected, onSelect, onMenu, label, children, hoverLabel = true }: { m: LayoutModule; selected: boolean; onSelect: () => void; onMenu?: (anchor: HTMLElement) => void; label: string; children: ReactNode; hoverLabel?: boolean }) {
  return (
    <div className={`nc-lb-module ${selected ? 'selected' : ''} type-${m.type}`} data-module={m.type} data-module-id={m.id} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      {hoverLabel && <div className="nc-lb-module-label"><Icon name="gripVertical" size={12} /><span>{label}</span></div>}
      {onMenu && (
        <span role="button" className="nc-lb-module-menu" aria-label="Action menu for module" onClick={(e) => { e.stopPropagation(); onMenu(e.currentTarget); }}>
          <Icon name="ellipsisSmall" size={16} />
        </span>
      )}
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ builder

function LayoutBuilder({ collectionId, close }: { collectionId: string; close: () => void }) {
  useDatabaseVersion();
  const col = useCollection(collectionId) as CollectionRecord | undefined;
  const [draft, setDraft] = useState<PageLayout | null>(() => (col ? pageLayoutOf(col) : null));
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Sel>({ kind: 'page' });
  const [previewId, setPreviewId] = useState<string | undefined>(() => collectionRows(collectionId)[0]?.id);
  const [panelShown, setPanelShown] = useState(true);
  const [tipOpen, setTipOpen] = useState(() => {
    try {
      return localStorage.getItem('nc:layoutBuilderTip') !== '1';
    } catch {
      return true;
    }
  });
  const rows = useMemo(() => collectionRows(collectionId), [collectionId, col]);
  // keep the draft consistent when properties are added / removed while editing
  useEffect(() => {
    if (col && draft) setDraft((d) => (d ? normalizePageLayout(d, col.schema, pagePropertyOrder(col)) : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col?.schema]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlayCount() > 1) return;
      e.preventDefault();
      void cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const cancelRef = useRef<() => Promise<void>>(async () => close());
  if (!col || !draft) return null;
  const row = rows.find((r) => r.id === previewId) ?? rows[0];
  const icons = draft.settings.property_icons !== false;
  const edit = (fn: (l: PageLayout) => void) => {
    const next = clone(draft);
    fn(next);
    setDraft(normalizePageLayout(next, col.schema, pagePropertyOrder(col)));
    setDirty(true);
  };
  const dismissTip = () => {
    setTipOpen(false);
    try {
      localStorage.setItem('nc:layoutBuilderTip', '1');
    } catch {
      /* ignore */
    }
  };

  const cancel = async () => {
    if (dirty && !(await confirmDialog({ message: 'Discard all layout changes?', confirmLabel: 'Discard' }))) return;
    close();
  };
  cancelRef.current = cancel;
  const apply = () => {
    applyPageLayout(col, draft);
    close();
  };

  // ---- module menus
  const moduleMenu = (anchor: HTMLElement, id: string) => {
    const at = findModule(draft, id);
    if (!at) return;
    const list = draft.modules[at.area];
    const items: MenuItemDef[] = [];
    const canUp = at.area === 'page_main' ? at.index > 1 : at.index > 0;
    if (at.m.type !== 'title') {
      items.push({ id: 'up', label: 'Move up', icon: 'arrowUp', disabled: !canUp, onSelect: () => edit((l) => { const a = l.modules[at.area]; [a[at.index - 1], a[at.index]] = [a[at.index], a[at.index - 1]]; }) });
      items.push({ id: 'down', label: 'Move down', icon: 'arrowDown', disabled: at.index >= list.length - 1, onSelect: () => edit((l) => { const a = l.modules[at.area]; [a[at.index + 1], a[at.index]] = [a[at.index], a[at.index + 1]]; }) });
    }
    if (at.area === 'page_main' && canMoveToPanel(at.m, col.schema)) {
      items.push({ id: 'panel', label: 'Send to panel', icon: 'panelRight', onSelect: () => edit((l) => { const [m] = l.modules.page_main.splice(at.index, 1); l.modules.page_details.push(m); }) });
    }
    if (at.area === 'page_details') {
      items.push({ id: 'page', label: 'Send to entry', icon: 'arrowStraightLeftSmall', onSelect: () => edit((l) => { const [m] = l.modules.page_details.splice(at.index, 1); const ed = l.modules.page_main.findIndex((x) => x.type === 'editor'); l.modules.page_main.splice(ed < 0 ? l.modules.page_main.length : ed, 0, m); }) });
    }
    if (at.m.type === 'property') {
      const pid = at.m.property;
      items.push({ id: 'group', label: 'Create to field group', icon: 'bulletedList', onSelect: () => edit((l) => returnToGroup(l, pid)) });
      items.push({ id: 'remove', label: 'Remove from layout', icon: 'trash', onSelect: () => edit((l) => { returnToGroup(l, pid); const g = groupOf(l); if (g && !g.hidden.includes(pid)) g.hidden.push(pid); }) });
    }
    if (at.m.type === 'discussions') items.push({ id: 'hide', label: 'Conceal entry discussions', icon: 'eyeSlash', onSelect: () => edit((l) => { l.modules[at.area] = l.modules[at.area].filter((m) => m.type !== 'discussions'); }) });
    if (!items.length) return;
    openMenu(anchor, { width: 220, sections: [{ items }] }, { placement: 'bottom-end' });
  };

  /** "+" Create entry module / "Create to panel": Suggested (Page discussions, Property group), existing properties, new property. */
  const addMenu = (anchor: HTMLElement, area: LayoutArea, afterIndex: number) => {
    const insert = (l: PageLayout, m: LayoutModule) => {
      const list = l.modules[area];
      list.splice(Math.min(afterIndex + 1, list.length), 0, m);
    };
    const suggested: MenuItemDef[] = [];
    if (![...draft.modules.page_main, ...draft.modules.page_details].some((m) => m.type === 'discussions')) {
      suggested.push({ id: 'disc', label: 'Page discussions', icon: 'commentFilled', onSelect: () => edit((l) => insert(l, { id: 'discussions', type: 'discussions' })) });
    }
    const existing = Object.entries(col.schema).filter(([id, p]) => id !== 'title' && p.type !== 'title' && !(area === 'page_details' && p.type === 'relation'));
    const def: MenuDef = {
      width: 280,
      search: 'Search…',
      maxHeight: 460,
      sections: [
        ...(suggested.length ? [{ title: 'Suggested', items: suggested }] : []),
        { title: 'Use an existing field', items: existing.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => edit((l) => { detachProperty(l, id); const g = groupOf(l); if (g) g.hidden = g.hidden.filter((x) => x !== id); insert(l, { id: newLayoutModuleId('prop'), type: 'property', property: id }); }) })) },
        { title: 'Create new field', items: PICKER_SECTIONS.flatMap((s) => s.types).filter((t) => !(area === 'page_details' && t === 'relation')).map((t) => ({ id: `new-${t}`, label: propertyTypeMeta(t).label, icon: <PropertyIcon prop={{ type: t }} size={16} />, onSelect: () => {
          const pid = addProperty(col.id, t as PropertyType, { action: 'layout.createProperty' });
          if (pid) setTimeout(() => setDraft((d) => {
            if (!d) return d;
            const next = clone(d);
            detachProperty(next, pid);
            next.modules[area].splice(Math.min(afterIndex + 1, next.modules[area].length), 0, { id: newLayoutModuleId('prop'), type: 'property', property: pid });
            setDirty(true);
            return next;
          }), 0);
        } })) },
      ],
    };
    openMenu(anchor, def, { placement: 'bottom-start' });
    dismissTip();
  };

  const pickPreview = (anchor: HTMLElement) => openMenu(anchor, {
    width: 300,
    search: 'Search pages…',
    emptyText: 'No results.',
    sections: [{ title: 'Choose entry to preview', items: rows.map((r) => ({ id: r.id, label: toPlainText(r.properties?.title) || 'Untitled', icon: <PageIcon block={r} size={16} fallback="page" />, checked: r.id === row?.id, onSelect: () => setPreviewId(r.id) })) }],
  }, { placement: 'bottom' as never });

  const saveOptions = (anchor: HTMLElement) => openMenu(anchor, {
    width: 280,
    sections: [{ items: [{ id: 'reset', label: 'Reset to original entry layout', description: 'No fields will be deleted', icon: 'undo', onSelect: async () => {
      const ok = await confirmDialog({ message: 'Reset to original entry layout?', description: 'No fields will be deleted.', confirmLabel: 'Reset' });
      if (!ok) return;
      resetPageLayout(col);
      close();
    } }] }],
  }, { placement: 'bottom-end' });

  // ---- canvas
  const renderModule = (m: LayoutModule, area: LayoutArea, index: number) => {
    const selected = sel.kind === 'module' && sel.id === m.id;
    const select = () => setSel({ kind: 'module', id: m.id });
    const menu = (a: HTMLElement) => moduleMenu(a, m.id);
    switch (m.type) {
      case 'title':
        return (
          <ModuleFrame key={m.id} m={m} selected={selected} onSelect={select} label="Heading" hoverLabel>
            <div className="nc-lb-heading">
              {row && <PageIcon block={row} size={30} fallback={null} />}
              <div className="nc-lb-heading-title">{toPlainText(row?.properties?.title) || 'Untitled'}</div>
            </div>
            {m.pinned.length > 0 && (
              <div className="nc-lb-pinned">
                {m.pinned.map((pid) => col.schema[pid] && (
                  <div key={pid} className="nc-lb-pinned-prop">
                    <div className="nc-lb-pinned-label">{icons && <PropertyIcon prop={col.schema[pid]} size={14} />}<span>{col.schema[pid].name}</span></div>
                    <PreviewValue row={row} pid={pid} col={col} />
                  </div>
                ))}
              </div>
            )}
            <div className="nc-lb-backlinks"><Icon name="arrowDiagonalDownLeftSmall" size={14} /><span>No backlinks</span></div>
          </ModuleFrame>
        );
      case 'properties':
        return (
          <ModuleFrame key={m.id} m={m} selected={selected} onSelect={select} onMenu={menu} label="Property group">
            {m.sections.map((s) => (
              <div key={s.id} className="nc-lb-section">
                {s.name && <div className="nc-lb-section-name"><Icon name="triangleRight" size={10} /><span>{s.name}</span></div>}
                {s.properties.filter((p) => !m.hidden.includes(p)).map((pid) => <PropRowPreview key={pid} pid={pid} col={col} row={row} icons={icons} />)}
              </div>
            ))}
          </ModuleFrame>
        );
      case 'property':
        return (
          <ModuleFrame key={m.id} m={m} selected={selected} onSelect={select} onMenu={menu} label={col.schema[m.property]?.name ?? 'Property'}>
            <div className="nc-lb-single">
              <div className="nc-lb-prop-label">{icons && col.schema[m.property] && <PropertyIcon prop={col.schema[m.property]} size={16} />}<span>{col.schema[m.property]?.name}</span></div>
              <div className="nc-lb-single-value"><PreviewValue row={row} pid={m.property} col={col} /></div>
            </div>
          </ModuleFrame>
        );
      case 'discussions':
        return (
          <ModuleFrame key={m.id} m={m} selected={selected} onSelect={select} onMenu={menu} label="Page discussions">
            <div className="nc-lb-discussions"><div className="nc-lb-discussions-title">Comments</div><div className="nc-lb-discussions-input">Add a comment…</div></div>
          </ModuleFrame>
        );
      case 'editor':
        return (
          <ModuleFrame key={m.id} m={m} selected={selected} onSelect={select} onMenu={menu} label="Content">
            <div className="nc-lb-content">{row?.content?.length ? `${row.content.length} block${row.content.length === 1 ? '' : 's'}` : 'Empty'}</div>
          </ModuleFrame>
        );
    }
    void area;
    void index;
    return null;
  };

  const addButton = (area: LayoutArea, index: number) => (
    <div className="nc-lb-add-wrap" key={`add-${area}-${index}`}>
      <span role="button" className="nc-lb-add" aria-label="Create entry module" onClick={(e) => { e.stopPropagation(); addMenu(e.currentTarget, area, index); }}><Icon name="plus" size={16} /></span>
    </div>
  );

  // ---- sidebar
  const selected = sel.kind === 'module' ? findModule(draft, sel.id) : null;
  let sidebar: ReactNode;
  if (!selected) {
    sidebar = <PageSettings draft={draft} col={col} edit={edit} />;
  } else if (selected.m.type === 'title') {
    sidebar = <HeadingSettings m={selected.m} col={col} edit={edit} />;
  } else if (selected.m.type === 'properties') {
    sidebar = <GroupSettings m={selected.m} col={col} edit={edit} />;
  } else if (selected.m.type === 'property') {
    const pid = selected.m.property;
    sidebar = (
      <div className="nc-lb-side-section">
        <div className="nc-lb-side-title">{col.schema[pid]?.name ?? 'Property'}</div>
        <div role="button" className="nc-lb-side-row" onClick={(e) => openEditPropertyPopover(e.currentTarget, col.id, pid)}><Icon name="slidersTwo" size={16} /><span>Edit property</span></div>
        <div role="button" className="nc-lb-side-row" onClick={() => { edit((l) => returnToGroup(l, pid)); setSel({ kind: 'page' }); }}><Icon name="bulletedList" size={16} /><span>Create to field group</span></div>
      </div>
    );
  } else {
    sidebar = (
      <div className="nc-lb-side-section">
        <div className="nc-lb-side-title">{MODULE_LABEL[selected.m.type]}</div>
        <div className="nc-lb-side-caption">{selected.m.type === 'editor' ? 'The page’s own content. It stays on every page.' : 'Comments about the whole page.'}</div>
      </div>
    );
  }

  return (
    <div className="nc-lb" role="dialog" aria-label="Customize layout" onClick={() => setSel({ kind: 'page' })}>
      <header className="nc-lb-header" onClick={(e) => e.stopPropagation()}>
        <div className="nc-lb-header-center">
          <div className="nc-lb-dbname">{col.icon ? <span className="nc-lb-dbicon">{String(col.icon)}</span> : <Icon name="collection" size={18} />}<span>{toPlainText(col.name as never) || 'Untitled'}</span></div>
          <div role="button" className="nc-lb-preview" aria-haspopup="dialog" onClick={(e) => pickPreview(e.currentTarget)}>
            <span className="nc-lb-preview-prefix">Preview:</span><span className="nc-lb-preview-title">{toPlainText(row?.properties?.title) || 'Untitled'}</span><Icon name="arrowChevronSingleDownSmall" size={14} />
          </div>
        </div>
        <div className="nc-lb-header-right">
          <div role="button" className="nc-lb-cancel" data-testid="layout-cancel" onClick={() => void cancel()}><Icon name="xMarkSmall" size={14} /><span>Cancel</span></div>
          <div className="nc-lb-apply-group">
            <div role="button" className="nc-lb-apply" data-testid="layout-apply" onClick={apply}><Icon name="checkmarkSmall" size={14} /><span>Apply to all entries</span></div>
            <div role="button" className="nc-lb-apply-more" aria-label="More storage options" onClick={(e) => saveOptions(e.currentTarget)}><Icon name="arrowChevronSingleDownSmall" size={14} /></div>
          </div>
        </div>
      </header>
      <div className="nc-lb-body">
        <div className="nc-lb-canvas lit-scroller vertical">
          <div className={`nc-lb-page ${panelShown ? 'with-panel' : ''}`}>
            <div className="nc-lb-main">
              {draft.modules.page_main.map((m, i) => (
                <div key={m.id} className="nc-lb-slot">
                  {renderModule(m, 'page_main', i)}
                  {m.type !== 'title' && addButton('page_main', i)}
                  {m.type === 'properties' && tipOpen && (
                    <div className="nc-lb-tip" role="dialog" onClick={(e) => e.stopPropagation()}>
                      <div className="nc-lb-tip-title">Start creating your layout</div>
                      <span role="button" className="nc-lb-tip-close" aria-label="Close tooltip" onClick={dismissTip}><Icon name="xMarkSmall" size={12} /></span>
                      <div className="nc-lb-tip-body">Click the <Icon name="plus" size={12} /> icon to add to the page</div>
                    </div>
                  )}
                </div>
              ))}
              {draft.structure === 'tabbed' && <div className="nc-lb-tabs-preview"><span className="active">Content</span>{(draft.tabs ?? []).map((t) => <span key={t.id}>{t.name}</span>)}</div>}
            </div>
            {panelShown ? (
              <div className="nc-lb-panel">
                <span role="button" className="nc-lb-panel-hide" aria-label="Hide sidebar" onClick={(e) => { e.stopPropagation(); setPanelShown(false); }}><Icon name="arrowChevronDoubleRight" size={16} /></span>
                {draft.modules.page_details.map((m, i) => renderModule(m, 'page_details', i))}
                <div role="button" className="nc-lb-add-panel" data-testid="layout-add-to-panel" onClick={(e) => { e.stopPropagation(); addMenu(e.currentTarget, 'page_details', draft.modules.page_details.length - 1); }}>
                  <Icon name="plus" size={16} /><span>Create to panel</span>
                </div>
              </div>
            ) : (
              <span role="button" className="nc-lb-panel-show" aria-label="Show sidebar" onClick={(e) => { e.stopPropagation(); setPanelShown(true); }}><Icon name="arrowChevronDoubleLeft" size={16} /></span>
            )}
          </div>
        </div>
        <aside className="nc-lb-side lit-scroller vertical" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sidebar panels

function SettingSwitch({ label, info, on, onChange, testid }: { label: string; info?: string; on: boolean; onChange: (v: boolean) => void; testid?: string }) {
  return (
    <div role="menuitemcheckbox" aria-checked={on} className="nc-lb-switch-row" data-testid={testid} onClick={() => onChange(!on)}>
      <span className="nc-lb-switch-label">{label}{info && <span className="nc-lb-info" data-tooltip={info}><Icon name="infoCircleSmall" size={14} /></span>}</span>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function PageSettings({ draft, col, edit }: { draft: PageLayout; col: CollectionRecord; edit: (fn: (l: PageLayout) => void) => void }) {
  const s = draft.settings;
  const relations = Object.entries(col.schema).filter(([, p]) => p.type === 'relation');
  return (
    <div className="nc-lb-side-section">
      <div className="nc-lb-side-title">Page settings</div>
      <div className="nc-lb-side-heading">Structure</div>
      <div className="nc-lb-structures">
        {(['simple', 'tabbed'] as const).map((k) => (
          <div key={k} role="button" className={`nc-lb-structure ${draft.structure === k ? 'selected' : ''}`} data-testid={`structure-${k}`} onClick={() => edit((l) => { l.structure = k; })}>
            <div className={`nc-lb-structure-art ${k}`}><span /><span /><span /></div>
            <div className="nc-lb-structure-label">{k === 'simple' ? 'Simple' : 'Tabbed'}</div>
          </div>
        ))}
      </div>
      {draft.structure === 'tabbed' && (
        <>
          <div className="nc-lb-side-heading">Tabs</div>
          <div className="nc-lb-tab-list">
            <div className="nc-lb-tab-item"><Icon name="page" size={14} /><span>Content</span></div>
            {(draft.tabs ?? []).map((t) => (
              <div key={t.id} className="nc-lb-tab-item">
                <Icon name="collection" size={14} /><span>{t.name}</span>
                <span role="button" className="nc-lb-tab-remove" aria-label="Remove tab" onClick={() => edit((l) => { l.tabs = (l.tabs ?? []).filter((x) => x.id !== t.id); })}><Icon name="xMarkSmall" size={12} /></span>
              </div>
            ))}
            <div role="button" className="nc-lb-side-row" onClick={(e) => openMenu(e.currentTarget, {
              width: 260,
              sections: [{ title: 'New view', items: relations.length ? relations.map(([id, p]) => {
                const target = (p.collection_pointer as { id?: string } | undefined)?.id ?? (p.collection_id as string);
                return { id, label: `Related to ${p.name}`, icon: <PropertyIcon prop={p} size={16} />, onSelect: () => edit((l) => { l.tabs = [...(l.tabs ?? []), { id: newLayoutModuleId('tab'), name: p.name, collection_id: target }]; }) };
              }) : [{ id: 'none', label: 'Add a relation property first', disabled: true }] }],
            }, { placement: 'bottom-start' })}><Icon name="plus" size={16} /><span>New view</span></div>
          </div>
        </>
      )}
      <div className="nc-lb-side-heading">Options</div>
      <div role="button" className="nc-lb-switch-row" onClick={(e) => openMenu(e.currentTarget, { width: 220, sections: [{ items: [
        { id: 'default', label: 'Default', description: 'Show comments to the right of the page', checked: s.inline_comments !== 'minimal', onSelect: () => edit((l) => { l.settings.inline_comments = 'default'; }) },
        { id: 'minimal', label: 'Minimal', description: 'Show an icon and comment count', checked: s.inline_comments === 'minimal', onSelect: () => edit((l) => { l.settings.inline_comments = 'minimal'; }) },
      ] }] }, { placement: 'bottom-end' })}>
        <span className="nc-lb-switch-label">Inline comments</span>
        <span className="nc-lb-value">{s.inline_comments === 'minimal' ? 'Minimal' : 'Default'}<Icon name="arrowChevronSingleRightSmall" size={14} /></span>
      </div>
      <SettingSwitch label="Page discussions" on={s.page_discussions !== false} testid="setting-discussions" onChange={(v) => edit((l) => { l.settings.page_discussions = v; })} />
      <SettingSwitch label="Property icons" on={s.property_icons !== false} testid="setting-icons" onChange={(v) => edit((l) => { l.settings.property_icons = v; })} />
      <SettingSwitch label="Full width" info="Entry width can be overwritten on individual entries." on={!!s.full_width} onChange={(v) => edit((l) => { l.settings.full_width = v; })} />
      <SettingSwitch label="Database templates" info="If enabled, empty entries will display the template picker." on={s.database_templates !== false} onChange={(v) => edit((l) => { l.settings.database_templates = v; })} />
    </div>
  );
}

function HeadingSettings({ m, col, edit }: { m: TitleModule; col: CollectionRecord; edit: (fn: (l: PageLayout) => void) => void }) {
  const unpinned = Object.keys(col.schema).filter((id) => id !== 'title' && col.schema[id].type !== 'title' && !m.pinned.includes(id));
  const full = m.pinned.length >= MAX_PINNED_PROPERTIES;
  const row = (pid: string, pinned: boolean) => {
    const p: PropertySchema = col.schema[pid];
    return (
      <div key={pid} className="nc-lb-pin-row">
        <PropertyIcon prop={p} size={16} />
        <span className="nc-lb-pin-name">{p.name}</span>
        <span
          role="button"
          className={`nc-lb-pin ${pinned ? 'on' : ''} ${!pinned && full ? 'disabled' : ''}`}
          aria-label={pinned ? `Do not display ${p.name} as pinned` : `Display ${p.name} as pinned`}
          data-tooltip={!pinned && full ? 'Maximum number of pinned properties reached. Unpin a property to pin another.' : undefined}
          onClick={() => (pinned || !full) && edit((l) => {
            const t = l.modules.page_main[0] as TitleModule;
            if (pinned) {
              t.pinned = t.pinned.filter((x) => x !== pid);
              returnToGroup(l, pid);
            } else {
              detachProperty(l, pid);
              (l.modules.page_main[0] as TitleModule).pinned.push(pid);
            }
          })}
        >
          <Icon name="pin" size={14} />
        </span>
      </div>
    );
  };
  return (
    <div className="nc-lb-side-section">
      <div className="nc-lb-side-title">Heading</div>
      <div className="nc-lb-side-heading">Pinned properties</div>
      {m.pinned.length ? m.pinned.map((pid) => row(pid, true)) : <div className="nc-lb-side-caption">Pin up to {MAX_PINNED_PROPERTIES} properties to show them under the title.</div>}
      <div role="button" className={`nc-lb-side-row ${full ? 'disabled' : ''}`} data-tooltip={full ? 'Maximum number of pinned properties reached. Unpin a property to create a new pinned property.' : undefined} onClick={(e) => !full && openMenu(e.currentTarget, {
        width: 240, search: 'Search…',
        sections: [{ items: PICKER_SECTIONS.flatMap((s) => s.types).map((t) => ({ id: t, label: propertyTypeMeta(t).label, icon: <PropertyIcon prop={{ type: t }} size={16} />, onSelect: () => {
          const pid = addProperty(col.id, t as PropertyType, { action: 'layout.createPinnedProperty' });
          if (pid) setTimeout(() => edit((l) => { detachProperty(l, pid); (l.modules.page_main[0] as TitleModule).pinned.push(pid); }), 0);
        } })) }],
      }, { placement: 'bottom-start' })}><Icon name="plus" size={16} /><span>Add a property</span></div>
      <div className="nc-lb-side-heading">Unpinned properties</div>
      {unpinned.map((pid) => row(pid, false))}
      <div className="nc-lb-side-heading">Options</div>
      <div role="button" className="nc-lb-switch-row" onClick={(e) => openMenu(e.currentTarget, { width: 200, sections: [{ items: (['show', 'hover', 'off'] as const).map((k) => ({ id: k, label: k === 'show' ? 'Always show' : k === 'hover' ? 'Show on hover' : 'Off', checked: (m.backlinks ?? 'show') === k, onSelect: () => edit((l) => { (l.modules.page_main[0] as TitleModule).backlinks = k; }) })) }] }, { placement: 'bottom-end' })}>
        <span className="nc-lb-switch-label">Backlinks</span>
        <span className="nc-lb-value">{m.backlinks === 'hover' ? 'Show on hover' : m.backlinks === 'off' ? 'Off' : 'Always show'}<Icon name="arrowChevronSingleRightSmall" size={14} /></span>
      </div>
    </div>
  );
}

function GroupSettings({ m, col, edit }: { m: PropertiesModule; col: CollectionRecord; edit: (fn: (l: PageLayout) => void) => void }) {
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ section: string; before?: string } | null>(null);
  /** drop a dragged property into `sectionId` before `beforeId` (end when absent) */
  const drop = (sectionId: string, beforeId?: string) => {
    const pid = drag;
    setDrag(null);
    setOver(null);
    if (!pid || pid === beforeId) return;
    edit((l) => {
      const g = groupOf(l)!;
      for (const s of g.sections) s.properties = s.properties.filter((x) => x !== pid);
      const target = g.sections.find((s) => s.id === sectionId) ?? g.sections[g.sections.length - 1];
      const at = beforeId ? target.properties.indexOf(beforeId) : -1;
      target.properties.splice(at < 0 ? target.properties.length : at, 0, pid);
    });
  };
  const match = (pid: string) => !q.trim() || (col.schema[pid]?.name ?? '').toLowerCase().includes(q.trim().toLowerCase());
  const sectionMenu = (anchor: HTMLElement, sid: string, index: number) => openMenu(anchor, {
    width: 220,
    sections: [{ items: [
      { id: 'rename', label: 'Rename', icon: 'compose', onSelect: () => {
        const name = window.prompt('Rename section', m.sections[index]?.name ?? '');
        if (name !== null) edit((l) => { const g = groupOf(l)!; const s = g.sections.find((x) => x.id === sid); if (s) s.name = name.trim() || undefined; });
      } },
      { id: 'up', label: 'Move up', icon: 'arrowUp', disabled: index === 0, onSelect: () => edit((l) => { const g = groupOf(l)!; [g.sections[index - 1], g.sections[index]] = [g.sections[index], g.sections[index - 1]]; }) },
      { id: 'down', label: 'Move down', icon: 'arrowDown', disabled: index >= m.sections.length - 1, onSelect: () => edit((l) => { const g = groupOf(l)!; [g.sections[index + 1], g.sections[index]] = [g.sections[index], g.sections[index + 1]]; }) },
      { id: 'delete', label: 'Delete', icon: 'trash', description: 'No fields will be deleted', disabled: m.sections.length <= 1, onSelect: () => edit((l) => {
        const g = groupOf(l)!;
        const [gone] = g.sections.splice(index, 1);
        g.sections[Math.max(0, index - 1)].properties.push(...gone.properties);
      }) },
    ] }],
  }, { placement: 'bottom-end' });
  return (
    <div className="nc-lb-side-section">
      <div className="nc-lb-side-title">Property group</div>
      <div className="nc-input nc-lb-search" data-menu-keys="ignore"><input placeholder="Search properties…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {m.sections.map((s, i) => (
        <div key={s.id} className="nc-lb-group-section">
          <div className={`nc-lb-group-section-head ${over?.section === s.id && !over.before ? 'drop' : ''}`} onDragOver={(e) => { if (drag) { e.preventDefault(); setOver({ section: s.id }); } }} onDrop={() => drop(s.id)}>
            <span>{s.name || 'Properties'}</span>
            <span role="button" className="nc-lb-group-section-menu" aria-label="Display section options" onClick={(e) => sectionMenu(e.currentTarget, s.id, i)}><Icon name="ellipsisSmall" size={14} /></span>
          </div>
          {s.properties.filter(match).map((pid) => {
            const hidden = m.hidden.includes(pid);
            const p = col.schema[pid];
            if (!p) return null;
            return (
              <div
                key={pid}
                className={`nc-lb-group-prop ${hidden ? 'hidden' : ''} ${over?.before === pid ? 'drop-before' : ''}`}
                draggable
                onDragStart={() => setDrag(pid)}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                onDragOver={(e) => { if (drag) { e.preventDefault(); setOver({ section: s.id, before: pid }); } }}
                onDrop={() => drop(s.id, pid)}
              >
                <PropertyIcon prop={p} size={16} />
                <span role="button" className="nc-lb-group-prop-name" onClick={(e) => openEditPropertyPopover(e.currentTarget, col.id, pid)}>{p.name}</span>
                <span role="button" className="nc-lb-eye" aria-label={`Toggle the visibility ${p.name}`} onClick={() => edit((l) => { const g = groupOf(l)!; g.hidden = hidden ? g.hidden.filter((x) => x !== pid) : [...g.hidden, pid]; })}>
                  <Icon name={hidden ? 'eyeSlash' : 'eye'} size={16} />
                </span>
              </div>
            );
          })}
        </div>
      ))}
      {!m.sections.some((s) => s.properties.some(match)) && q && <div className="nc-lb-side-caption">Not found</div>}
      <div role="button" className="nc-lb-side-row" data-testid="layout-add-section" onClick={() => edit((l) => { const g = groupOf(l)!; g.sections.push({ id: newLayoutModuleId('sec'), name: 'New section', properties: [] }); })}><Icon name="plus" size={16} /><span>Add section</span></div>
    </div>
  );
}

export function openLayoutBuilderOverlay(collectionId: string) {
  return openOverlay((close) => <LayoutBuilder collectionId={collectionId} close={close} />, { placement: 'center', backdrop: 'none', className: 'nc-lb-overlay', closeOnEscape: false });
}
