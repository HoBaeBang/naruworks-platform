
// search, "In ‹data source›", "N selected" (– to remove) and "Select more"; typing a new name offers "New page".
// Writes go through setRelationValue so two-way relations stay in sync.
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { relationIdsOf } from '@nc/shared/relation/index.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { api } from '../../../lib/api.ts';
import { createBlockIn, getBlock, run } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { useBlock, useCollection, useTableVersion } from '../../../lib/hooks.ts';
import { openPeek } from '../../../lib/router.ts';
import { collectionName, getCollection, rowsOfCollection, titleOf } from './context.ts';
import { setRelationValue } from './relations.ts';
import type { MenuDef, MenuItemDef } from '../../../components/Menu.tsx';
import { openNestedMenu } from '../menus.ts';
import { useCollectionAccess } from '../access.ts';
import { PropertyCell, PropertyIcon } from '../properties/PropertyCell.tsx';
import './advanced.css';


export function relationShownProperties(ps: PropertySchema | undefined, target: CollectionRecord | undefined): string[] {
  const list = (ps as { relation_shown_properties?: unknown } | undefined)?.relation_shown_properties;
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && !!target?.schema[id] && id !== 'title') : [];
}

function ShownValues({ page, target, shown }: { page: BlockRecord; target: CollectionRecord; shown: string[] }) {
  if (!shown.length) return null;
  return (
    <span className="nc-relpick-props">
      {shown.map((pid) => <PropertyCell key={pid} row={page} schema={target.schema} propId={pid} readOnly noEdit className="nc-relpick-prop" />)}
    </span>
  );
}

function openShownPropertiesMenu(anchor: HTMLElement, collectionId: string, propId: string, target: CollectionRecord, canEdit: boolean) {
  const render = (): MenuDef => {
    const ps = records.get<CollectionRecord>('collection', collectionId)?.schema[propId];
    const shown = relationShownProperties(ps, target);
    const others = Object.entries(target.schema).filter(([id]) => id !== 'title' && !shown.includes(id));
    const toggle = (id: string, on: boolean) => {
      const next = on ? [...shown, id] : shown.filter((x) => x !== id);
      run('relation.shownProperties', (tx) => tx.update('collection', collectionId, ['schema', propId], { relation_shown_properties: next.length ? next : null }));
      // the menu lists are static: reopen it with the new split
      setTimeout(() => anchor.isConnected && openShownPropertiesMenu(anchor, collectionId, propId, target, canEdit), 0);
    };
    const row = (id: string, on: boolean): MenuItemDef => ({
      id, label: target.schema[id].name, icon: <PropertyIcon prop={target.schema[id]} size={16} />, disabled: !canEdit,
      right: <span className="nc-relpick-eye" aria-label="Switch field visibility"><Icon name={on ? 'eye' : 'eyeOff'} size={14} /></span>,
      onSelect: () => toggle(id, !on),
    });
    return {
      width: 260,
      sections: [
        { title: 'Visible in linked records', items: shown.length ? shown.map((id) => row(id, true)) : [{ id: 'none-shown', label: 'No properties', disabled: true }] },
        { title: 'Hidden in linked records', items: others.length ? others.map(([id]) => row(id, false)) : [{ id: 'none-hidden', label: 'No properties', disabled: true }] },
      ],
    };
  };
  openNestedMenu(anchor, render(), { placement: 'bottom-end' });
}

function PageRow({ page, selected, active, onClick, onRemove, target, shown = [] }: { page: BlockRecord; selected?: boolean; active?: boolean; onClick: () => void; onRemove?: () => void; target?: CollectionRecord; shown?: string[] }) {
  const icon = page.format?.page_icon;
  return (
    <div role="button" className={`nc-relpick-row ${active ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <span className="nc-relpick-icon">{icon && !/^(https?:|\/)/.test(icon) && !icon.includes(':') ? icon : <Icon name="page" size={18} color="var(--lp-icon-secondary)" />}</span>
      <span className="nc-relpick-title">{titleOf(page) || 'Untitled'}</span>
      {target && <ShownValues page={page} target={target} shown={shown} />}
      {selected && onRemove && (
        <span role="button" className="nc-relpick-remove" aria-label="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="dashLong" size={14} /></span>
      )}
      {!selected && <span className="nc-relpick-add"><Icon name="plus" size={14} /></span>}
    </div>
  );
}

function RelationPicker({ rowIds, propId, collectionId, close }: { rowIds: string[]; propId: string; collectionId: string; close: () => void }) {
  useTableVersion(['block', 'collection']);
  const col = useCollection(collectionId);
  const ps = col?.schema[propId];
  const target = getCollection(ps?.collection_id as string | undefined) as CollectionRecord | undefined;
  const row = useBlock(rowIds[0]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const access = useCollectionAccess(collectionId);

  useEffect(() => {
    if (!target) return;
    // make sure the related data source's rows are loaded
    if (!rowsOfCollection(target.id).length) {
      api<{ recordMap?: unknown }>('loadCollectionRows', { collectionId: target.id }).then((r) => r.recordMap && records.mergeRecordMap(r.recordMap as never)).catch(() => undefined);
    }
  }, [target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIds = relationIdsOf(row?.properties?.[propId] as never);
  const selected = selectedIds.map((id) => getBlock(id)).filter((b): b is BlockRecord => !!b && b.alive !== false);
  const candidates = useMemo(() => {
    const all = target ? rowsOfCollection(target.id) : [];
    const qq = q.trim().toLowerCase();
    return all.filter((b) => !selectedIds.includes(b.id) && (!qq || titleOf(b).toLowerCase().includes(qq))).reverse();
  }, [target, q, selectedIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!col || !ps || !target) return <div className="nc-relpick"><div className="nc-rel-sub" style={{ padding: 12 }}>Select a data source for this relation first.</div></div>;
  const shown = relationShownProperties(ps, target);
  const limitOne = ps.limit === 1;
  const write = (ids: string[]) => {
    for (const rid of rowIds) setRelationValue(rid, propId, ids);
  };
  const add = (id: string) => {
    write(limitOne ? [id] : [...selectedIds, id]);
    setQ('');
    if (limitOne) close();
  };
  const remove = (id: string) => write(selectedIds.filter((x) => x !== id));
  const create = () => {
    const name = q.trim();
    if (!name) return;
    let id = '';
    run('relationPicker.createPage', (tx) => {
      id = createBlockIn(tx, { type: 'page', parentId: target.id, parentTable: 'collection', title: [[name]], list: null });
    });
    add(id);
  };
  const showCreate = q.trim() && !candidates.some((c) => titleOf(c).toLowerCase() === q.trim().toLowerCase());
  const flat = [...candidates.map((c) => ({ kind: 'add' as const, id: c.id })), ...(showCreate ? [{ kind: 'create' as const, id: '' }] : [])];
  return (
    <div className="nc-relpick" role="dialog" onKeyDown={(e) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const it = flat[active];
        if (it?.kind === 'add') add(it.id);
        else if (it?.kind === 'create') create();
      }
    }}>
      <div className="nc-relpick-head">
        <input autoFocus placeholder="Link or create an entry…" value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} />
        <span className="nc-relpick-in">In</span>
        <span role="link" className="nc-relpick-ds" onClick={() => { const host = records.get<BlockRecord>('block', target.parent_id); if (host) openPeek(host.id, 'center_peek'); }}>
          <Icon name="databaseEmbed" size={14} color="var(--lp-icon-secondary)" />{collectionName(target)}
        </span>
        <span
          role="button"
          className="nc-relpick-customize"
          aria-label="Adjust visible fields"
          data-testid="relation-customize"
          data-tooltip={access.canEditStructure ? 'Adjust visible fields' : 'You need edit access to change this'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => openShownPropertiesMenu(e.currentTarget, collectionId, propId, target, access.canEditStructure)}
        >
          <Icon name="sliders" size={14} />
        </span>
      </div>
      <div className="nc-relpick-body lit-scroller vertical">
        {selected.length > 0 && (
          <>
            <div className="nc-relpick-section">{selected.length} selected</div>
            {selected.map((p) => <PageRow key={p.id} page={p} selected target={target} shown={shown} onClick={() => openPeek(p.id, 'side_peek')} onRemove={() => remove(p.id)} />)}
          </>
        )}
        {(candidates.length > 0 || showCreate) && <div className="nc-relpick-section">{selected.length ? 'Select more' : 'Select a page'}</div>}
        {candidates.map((p, i) => <PageRow key={p.id} page={p} active={i === active} target={target} shown={shown} onClick={() => add(p.id)} />)}
        {showCreate && (
          <div role="button" className={`nc-relpick-row ${active === flat.length - 1 ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={create}>
            <span className="nc-relpick-icon"><Icon name="plus" size={16} color="var(--lp-icon-secondary)" /></span>
            <span className="nc-relpick-title" style={{ borderBottom: 'none' }}>New page <b style={{ fontWeight: 500 }}>“{q.trim()}”</b> in {collectionName(target)}</span>
          </div>
        )}
        {!candidates.length && !selected.length && !showCreate && <div className="nc-rel-sub" style={{ padding: '8px 12px' }}>No pages</div>}
      </div>
    </div>
  );
}


export function openRelationPicker(anchor: HTMLElement, opts: { rowIds: string[]; propId: string; collectionId: string; onClose?: () => void }): () => void {
  return openOverlay((close) => <RelationPicker rowIds={opts.rowIds} propId={opts.propId} collectionId={opts.collectionId} close={close} />, {
    anchor, placement: 'bottom-start', offset: -32, backdrop: 'transparent', onClose: opts.onClose,
  });
}
