// Page properties of a database row (side peek / center peek / full page): role=table "Page properties",
// rows 34px + 4px gap, 160px label (icon + name, click → label menu), value cells (PropertyCell, "Empty"),
// visibility (Always show / Hide when blank / Always hide → "N more properties"), drag to reorder,

// The pieces are shared with the page layout renderer (layout/RowLayout.tsx: property groups with sections,
// single-property modules, pinned heading properties, details panel).
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getPropertyValue, isEmptyValue } from '@nc/shared/database/index.ts';
import { useCollection } from '../../lib/hooks.ts';
import { run } from '../../lib/blocks.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { PropertyCell, PropertyIcon } from './properties/PropertyCell.tsx';
import { confirmDeleteProperty, openAddPropertyMenu, openEditPropertyPopover, hasEditFlyout, changeTypeMenuDef } from './properties/PropertyMenus.tsx';
import { duplicateProperty, renameProperty } from './actions.ts';
import { makeQueryContext, useDatabaseVersion } from './data.ts';
import { collectionAccess, useCollectionAccess } from './access.ts';
import { pagePropertyOrder } from './layout/model.ts';
import { openLayoutBuilder } from './layout/openLayoutBuilder.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import './properties/properties.css';
import './database.css';
import { TemplateBanner as DbTemplateBanner } from './templates/templates.tsx';
import { records } from '../../lib/store/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { PropertyCommentButton } from './propertyComments.tsx';

type Visibility = 'show' | 'hide_if_empty' | 'hide';

export function pageProperties(c: CollectionRecord): string[] {
  return pagePropertyOrder(c);
}

export function visibilityOf(c: CollectionRecord, propId: string): Visibility {
  const list = (c.format?.property_visibility ?? []) as { property: string; visibility: Visibility }[];
  return list.find((v) => v.property === propId)?.visibility ?? 'show';
}

function setVisibility(c: CollectionRecord, propId: string, visibility: Visibility) {
  const list = ((c.format?.property_visibility ?? []) as { property: string; visibility: Visibility }[]).filter((v) => v.property !== propId);
  list.push({ property: propId, visibility });
  run('setPropertyVisibility', (tx) => tx.update('collection', c.id, ['format'], { property_visibility: list }));
}

function reorderPageProperties(c: CollectionRecord, from: string, to: string) {
  const ids = pageProperties(c).filter((id) => id !== from);
  ids.splice(ids.indexOf(to), 0, from);
  run('reorderPageProperties', (tx) => tx.update('collection', c.id, ['format'], { collection_page_properties: ids.map((property) => ({ property, visible: true })) }));
}

function openRename(anchor: HTMLElement, c: CollectionRecord, propId: string) {
  let name = c.schema[propId]?.name ?? '';
  openOverlay((close) => (
    <PopoverSurface width={240}>
      <div className="nc-rename-view-body" data-menu-keys="ignore">
        <div className="nc-input focused"><input autoFocus defaultValue={name} onFocus={(e) => e.currentTarget.select()} onChange={(e) => (name = e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') close(); }} /></div>
      </div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 1, onClose: () => name.trim() && renameProperty(c.id, propId, name.trim()) });
}


export function openLabelMenu(anchor: HTMLElement, c: CollectionRecord, propId: string, readOnly: boolean) {
  const prop = c.schema[propId];
  const vis = visibilityOf(c, propId);
  const access = collectionAccess(c.id);
  return openMenu(anchor, {
    width: 220,
    sections: [
      { items: [
        { id: 'rename', label: 'Rename', icon: 'compose', disabled: readOnly, onSelect: () => { setTimeout(() => openRename(anchor, c, propId), 0); } },
        { id: 'edit', label: 'Edit property', icon: 'slidersTwo', disabled: readOnly || !hasEditFlyout(prop), onSelect: () => { setTimeout(() => openEditPropertyPopover(anchor, c.id, propId), 0); } },
        ...(!readOnly && prop?.type !== 'auto_increment_id' ? [{ id: 'type', label: 'Change type', icon: 'dbTurnInto', submenu: () => changeTypeMenuDef(c.id, propId, prop) }] : []),
      ] },
      { items: [
        { id: 'vis', label: 'Property visibility', icon: 'eyeSlash', disabled: readOnly, submenu: () => ({ width: 180, sections: [{ items: [
          { id: 'show', label: 'Always show', checked: vis === 'show', onSelect: () => setVisibility(c, propId, 'show') },
          { id: 'empty', label: 'Hide when blank', checked: vis === 'hide_if_empty', onSelect: () => setVisibility(c, propId, 'hide_if_empty') },
          { id: 'hide', label: 'Always hide', checked: vis === 'hide', onSelect: () => setVisibility(c, propId, 'hide') },
        ] }] }) },
        ...(!readOnly ? [
          { id: 'dup', label: 'Duplicate property', icon: 'duplicate', onSelect: () => duplicateProperty(c.id, propId) },
          { id: 'del', label: 'Delete property', icon: 'trash', onSelect: () => { setTimeout(() => void confirmDeleteProperty(c.id, propId), 0); } },
        ] : []),
      ] },
      { items: [{
        id: 'layout', label: 'Customize layout', icon: 'layout', disabled: !access.canEditStructure,
        description: access.locked ? 'Unlock this table to adjust its layout.' : undefined,
        onSelect: () => openLayoutBuilder(c.id),
      }] },
    ],
  }, { placement: 'bottom-start', offset: 1 });
}


export function PropertyRow({ page, col, id, readOnly, structureRO, icons = true, drag }: {
  page: BlockRecord; col: CollectionRecord; id: string; readOnly: boolean; structureRO: boolean; icons?: boolean;
  drag?: { current: string | null; set: (id: string | null) => void; onDrop: (from: string, to: string) => void };
}) {
  const p: PropertySchema = col.schema[id];
  return (
    <div
      className="nc-page-prop-drag"
      draggable={!structureRO && !!drag}
      onDragStart={() => drag?.set(id)}
      onDragOver={(e) => drag && e.preventDefault()}
      onDrop={() => {
        if (drag?.current && drag.current !== id) drag.onDrop(drag.current, id);
        drag?.set(null);
      }}
    >
      <div role="row" className="nc-page-prop-row">
        <div className="nc-page-prop-label">
          <div role="cell" aria-haspopup="dialog" className="nc-page-prop-label-button" data-tooltip={p.name.length > 18 ? p.name : undefined} onClick={(e) => openLabelMenu(e.currentTarget, col, id, structureRO)}>
            {icons && (
              <span className="nc-th-icon-stack">
                <span className="nc-th-icon"><PropertyIcon prop={p} size={16} /></span>
                <span className="nc-th-drag"><Icon name="dragHandle" size={14} /></span>
              </span>
            )}
            <span className="nc-page-prop-name">{p.name}</span>
          </div>
        </div>
        <div role="cell" className="nc-page-prop-value">
          <PropertyCell row={page} schema={col.schema} propId={id} readOnly={readOnly} mode="page" wrap placeholder={<span className="nc-page-prop-empty">Empty</span>} className="nc-page-prop-cell" />
          {p.type !== 'title' && <PropertyCommentButton page={page} col={col} propId={id} />}
        </div>
      </div>
    </div>
  );
}


export function PropertyRows({ page, col, ids, readOnly, structureRO, icons = true, reorder = true }: { page: BlockRecord; col: CollectionRecord; ids: string[]; readOnly: boolean; structureRO: boolean; icons?: boolean; reorder?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const ctx = makeQueryContext();
  const visible: string[] = [];
  const hidden: string[] = [];
  for (const id of ids) {
    if (!col.schema[id]) continue;
    const vis = visibilityOf(col, id);
    const empty = vis === 'hide_if_empty' ? isEmptyValue(getPropertyValue(page, id, col.schema, ctx)) : false;
    if (vis === 'hide' || (vis === 'hide_if_empty' && empty)) hidden.push(id);
    else visible.push(id);
  }
  const shown = expanded ? [...visible, ...hidden] : visible;
  const dragApi = reorder ? { current: drag, set: setDrag, onDrop: (from: string, to: string) => reorderPageProperties(col, from, to) } : undefined;
  return (
    <>
      {shown.map((id) => <PropertyRow key={id} page={page} col={col} id={id} readOnly={readOnly} structureRO={structureRO} icons={icons} drag={dragApi} />)}
      {hidden.length > 0 && (
        <div role="button" className="nc-page-prop-more" onClick={() => setExpanded(!expanded)}>
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={16} />
          <span>{expanded ? `Hide ${hidden.length} ${hidden.length === 1 ? 'property' : 'properties'}` : `${hidden.length} more ${hidden.length === 1 ? 'property' : 'properties'}`}</span>
        </div>
      )}
    </>
  );
}

export function AddPropertyRow({ col }: { col: CollectionRecord }) {
  return (
    <div role="button" aria-haspopup="dialog" className="nc-page-prop-add" onClick={(e) => openAddPropertyMenu(e.currentTarget, { collectionId: col.id })}>
      <Icon name="plusFillSmall" size={16} />
      <span>Add a property</span>
    </div>
  );
}

export function TemplateBanner({ page, col }: { page: BlockRecord; col: CollectionRecord }) {
  if (!page.is_template) return null;
  
  return <DbTemplateBanner page={page} collection={col} readOnly={!roleAtLeast(records.role('block', page.id), 'read_and_write')} />;
}


export function RowProperties({ page, readOnly }: { page: BlockRecord; readOnly: boolean }) {
  useDatabaseVersion();
  const col = useCollection(page.parent_id) as CollectionRecord | undefined;
  // values follow the row page's access; the property list itself is database structure (locked database, Can edit content)
  const structureRO = readOnly || !useCollectionAccess(page.parent_id).canEditStructure;
  if (!col) return null;
  return (
    <div className="nc-row-props-wrap">
      <TemplateBanner page={page} col={col} />
      <div role="table" aria-label="Page properties" className="nc-row-props">
        <PropertyRows page={page} col={col} ids={pageProperties(col)} readOnly={readOnly} structureRO={structureRO} />
        {!structureRO && <AddPropertyRow col={col} />}
      </div>
    </div>
  );
}
