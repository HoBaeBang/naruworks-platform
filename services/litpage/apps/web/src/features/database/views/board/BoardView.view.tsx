// Board view: sticky 48px column-header strip, 260px columns (Small 180 / Large 320) 12px apart,
// colored columns (--ca-{c}BacPriTra), cards (radius 10, --c-{c}BacEle, ring --ca-{c}BorSecTra, 15px/500 title),
// hover pill (Edit / •••), "+ New page" per column, drag cards between columns and to reorder, sub-group
// swimlanes (collection_group_by), hidden groups via the Group page, per-column load limit, "New group".
import { useMemo, useState, type CSSProperties } from 'react';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { encodePeople, encodeRelation, encodeSelect, getPropertyValue, groupAssignment, savedGroupsFrom, savedGroupsOf, type GroupResult } from '@nc/shared/database/index.ts';
import { records } from '../../../../lib/store/records.ts';
import { registerView, type ViewProps } from '../../viewRegistry.ts';
import { conditionalBg, makeQueryContext, useConditionalColors, useViewQuery } from '../../data.ts';
import { useDatabaseContext } from '../../DatabaseContext.tsx';
import { addOption, encodeAssignment, moveRow, setSavedGroups, viewProperties } from '../../actions.ts';
import { GroupToken, openGroupMenu, useCollapsedGroups } from '../../chrome/Groups.tsx';
import { colorKey } from '../../properties/ValueView.tsx';
import { CardBody, CardCover, cardCoverConfig } from '../cards.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { openRowMenu } from '../../chrome/RowMenu.tsx';
import type { Tx } from '../../../../lib/store/transactions.ts';
import './board.css';
import { colorToken } from '../../../../lib/colorToken.ts';

const SIZES: Record<string, number> = { small: 180, medium: 260, large: 320 };

function columnVars(g: GroupResult, colored: boolean): CSSProperties {
  if (!colored) return {};
  const c = g.uncategorized ? 'default' : g.color ?? g.option?.color ?? 'default';
  const k = colorKey(c);
  if (c === 'default') return { ['--nc-col-bg' as any]: 'var(--lp-bg-secondary-transparent)', ['--nc-card-bg' as any]: 'var(--lp-bg-elevated)', ['--nc-card-ring' as any]: 'var(--lp-border-secondary-transparent)', ['--nc-col-accent' as any]: 'var(--lp-text-accent, #52525b)' };
  return { ['--nc-col-bg' as any]: `var(${colorToken(k, 'bg-primary-transparent')})`, ['--nc-card-bg' as any]: `var(--lp-bg-elevated)`, ['--nc-card-ring' as any]: `var(${colorToken(k, 'border-secondary-transparent')})`, ['--nc-col-accent' as any]: `var(${colorToken(k, 'text-accent')}, var(${colorToken(k, 'icon-accent')}))` };
}

function assignInTx(tx: Tx, rowId: string, propId: string, collection: CollectionRecord, group: GroupResult, from?: GroupResult) {
  const prop = collection.schema[propId];
  if (!prop) return;
  const row = records.get<BlockRecord>('block', rowId);
  // multi-value columns (multi-select / person / relation): replace the source value, keep the others
  if (row && from && (prop.type === 'multi_select' || prop.type === 'person' || prop.type === 'relation')) {
    const v = getPropertyValue(row, propId, collection.schema, makeQueryContext());
    const fromVal = from.uncategorized ? undefined : from.value.value;
    const toVal = group.uncategorized ? undefined : group.value.value;
    if (v.kind === 'select') {
      const names = v.options.map((o) => o.value).filter((n) => n !== fromVal);
      if (toVal !== undefined && !names.includes(String(toVal))) names.push(String(toVal));
      tx.set('block', rowId, ['properties', propId], encodeSelect(group.uncategorized ? [] : names));
      return;
    }
    if (v.kind === 'person' || v.kind === 'relation') {
      const ids = v.ids.filter((x) => x !== fromVal?.id);
      if (toVal?.id && !ids.includes(toVal.id)) ids.push(toVal.id);
      const next = group.uncategorized ? [] : ids;
      tx.set('block', rowId, ['properties', propId], v.kind === 'person' ? encodePeople(next) : encodeRelation(next, collection.space_id));
      return;
    }
  }
  const a = groupAssignment(group, prop);
  if (!a) return;
  tx.set('block', rowId, ['properties', propId], encodeAssignment(prop, a.kind, a.value, collection.space_id));
}

function BoardView({ block, view, collection, readOnly }: ViewProps) {
  const db = useDatabaseContext();
  // locked database / Can edit content: cards editable, columns (group settings, new groups) not
  const structureRO = db?.structureReadOnly ?? readOnly;
  const result = useViewQuery(collection, view, { search: db?.search ?? '' });
  const fmt = (view.format ?? {}) as Record<string, any>;
  const gb = result.groupBy;
  const colored = !!gb && !gb.disableBoardColorColumns;
  const width = SIZES[fmt.board_cover_size ?? 'medium'] ?? 260;
  const limitFmt = fmt.inline_collection_first_load_limit as { type: string; limit: number } | undefined;
  const firstLimit = limitFmt?.type === 'load_limit' ? limitFmt.limit : 25;
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ id: string; from: GroupResult; fromSub?: GroupResult } | null>(null);
  const [over, setOver] = useState<{ group: string; sub?: string; before?: string | null } | null>(null);
  const [colDrag, setColDrag] = useState<string | null>(null);
  const collapsedSubs = useCollapsedGroups(`${view.id}:sub`);
  const bleed = db?.bleed ?? { left: 0, right: 0, width: null };
  const props = useMemo(() => viewProperties(view, collection.schema).filter((e) => e.visible && e.property !== 'title').map((e) => e.property), [view, collection.schema]);
  const colorsOf = useConditionalColors(view, collection);
  const showTitle = viewProperties(view, collection.schema).find((e) => e.property === 'title')?.visible !== false;
  const cover = cardCoverConfig(view, 'board');

  if (!gb || !result.groups) {
    return (
      <div className="lit-board-view nc-board-empty" style={{ marginInlineStart: bleed.left, marginInlineEnd: bleed.right }}>
        <div className="nc-board-nogroup">No group by property. Choose one in View settings › Group.</div>
      </div>
    );
  }
  const groups = result.groups.filter((g) => !g.hidden);
  const subGb = result.subGroupBy;
  const subKeys: { id: string; group: GroupResult }[] = [];
  if (subGb) {
    for (const g of groups) for (const s of g.subgroups ?? []) if (!subKeys.some((k) => k.id === s.id) && !s.hidden) subKeys.push({ id: s.id, group: s });
  }

  const dropCard = (target: GroupResult, targetSub: GroupResult | undefined, beforeId: string | null) => {
    if (!drag) return;
    const { id, from, fromSub } = drag;
    const changeGroup = target.id !== from.id;
    const changeSub = !!subGb && !!targetSub && targetSub.id !== fromSub?.id;
    const others = (targetSub ? targetSub.rows : target.rows).filter((r) => r.id !== id);
    const before = beforeId && others.some((r) => r.id === beforeId) ? beforeId : undefined;
    const after = !before && others.length ? others[others.length - 1].id : undefined;
    moveRow(view, collection.id, id, before ? { before } : after ? { after } : {}, (tx) => {
      if (changeGroup) assignInTx(tx, id, gb.property, collection, target, from);
      if (changeSub && subGb) assignInTx(tx, id, subGb.property, collection, targetSub!);
    });
    setDrag(null);
    setOver(null);
  };

  const card = (row: BlockRecord, g: GroupResult, sub?: GroupResult) => (
    <div
      key={row.id}
      className={`lit-selectable lit-page-block lit-collection-item nc-board-card-wrap ${over?.before === row.id && over.group === g.id && over.sub === sub?.id ? 'drop-before' : ''} ${drag?.id === row.id ? 'dragging' : ''}`}
      data-block-id={row.id}
      draggable={!readOnly}
      onDragStart={(e) => { setDrag({ id: row.id, from: g, fromSub: sub }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.id); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2 ? row.id : nextId(sub ? sub.rows : g.rows, row.id);
        setOver({ group: g.id, sub: sub?.id, before });
      }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropCard(g, sub, over?.before ?? null); }}
    >
      <div role="presentation" className="nc-board-card" style={colorsOf(row)?.row ? { ['--nc-card-bg' as any]: conditionalBg(colorsOf(row)?.row) } : undefined} onClick={() => db?.openRow(row.id)} onContextMenu={(e) => { e.preventDefault(); openRowMenu({ x: e.clientX, y: e.clientY }, { rowIds: [row.id], collection, view }); }}>
        <CardCover row={row} cover={cover} view={view} collection={collection} readOnly={readOnly} />
        <CardBody row={row} view={view} collection={collection} props={props} showTitle={showTitle} readOnly={readOnly} editing={db?.editingTitle === row.id} onDoneEditing={() => db?.setEditingTitle(null)} />
        {!readOnly && (
          <div className="nc-card-hover-pill" onClick={(e) => e.stopPropagation()}>
            <span role="button" className="nc-card-pill-btn" data-tooltip="Edit" onClick={() => db?.setEditingTitle(row.id)}><Icon name="pencilLine" size={14} /></span>
            <span role="button" className="nc-card-pill-btn" data-tooltip="Rename, remove, send, and more…" onClick={(e) => openRowMenu(e.currentTarget, { rowIds: [row.id], collection, view })}><Icon name="ellipsisSmall" size={14} /></span>
          </div>
        )}
      </div>
    </div>
  );

  const column = (g: GroupResult, rows: BlockRecord[], sub?: GroupResult) => {
    const key = `${g.id}|${sub?.id ?? ''}`;
    const lim = limits[key] ?? firstLimit;
    const shown = rows.slice(0, lim);
    return (
      <div
        key={key}
        className={`lit-board-group nc-board-column ${colored ? 'colored' : ''} ${over && over.group === g.id && over.sub === sub?.id && over.before === null ? 'drop-end' : ''}`}
        style={{ width, ...columnVars(g, colored) }}
        onDragOver={(e) => { if (!drag) return; e.preventDefault(); setOver({ group: g.id, sub: sub?.id, before: over?.group === g.id && over.sub === sub?.id ? over.before ?? null : null }); }}
        onDrop={(e) => { e.preventDefault(); dropCard(g, sub, over?.before ?? null); }}
      >
        <div className="nc-board-column-spacer" />
        {shown.map((r) => card(r, g, sub))}
        {rows.length > shown.length && (
          <div role="button" className="nc-board-load-more" onClick={() => setLimits((m) => ({ ...m, [key]: lim + firstLimit }))}>
            <Icon name="arrowDown" size={16} />
            <span>Load more</span>
          </div>
        )}
        {!readOnly && (
          <div role="button" className="nc-board-new" onClick={() => db?.addRow({ group: g, subgroup: sub ?? null, position: 'end', editTitle: true })}>
            <Icon name="plusSmall" size={16} />
            <span>New page</span>
          </div>
        )}
      </div>
    );
  };

  const header = (g: GroupResult) => (
    <div
      key={g.id}
      className={`nc-board-header-cell ${colored ? 'colored' : ''} ${colDrag && colDrag !== g.id ? 'drop-target' : ''}`}
      style={{ width, ...columnVars(g, colored) }}
      draggable={!structureRO && gb.sort?.type === 'manual'}
      onDragStart={() => setColDrag(g.id)}
      onDragOver={(e) => { if (colDrag) e.preventDefault(); }}
      onDrop={() => {
        if (!colDrag || colDrag === g.id) return;
        const all = result.groups!;
        const order = all.filter((x) => x.id !== colDrag);
        order.splice(order.findIndex((x) => x.id === g.id), 0, all.find((x) => x.id === colDrag)!);
        setSavedGroups(view, savedGroupsFrom(order, gb.property, savedGroupsOf(view)), { action: 'reorderGroups' });
        setColDrag(null);
      }}
      onDragEnd={() => setColDrag(null)}
    >
      <div className="nc-board-header-pill" title={g.uncategorized ? `Any items with an empty ${collection.schema[gb.property]?.name} property will go here. This group cannot be removed.` : undefined}><GroupToken group={g} /></div>
      {g.aggregation && <span role="button" className="nc-board-count" data-tooltip="Aggregate">{g.aggregation.display}</span>}
      <div className="nc-board-header-spacer" />
      {!readOnly && (
        <>
          {!structureRO && <span role="button" className="nc-board-header-btn" aria-label="More group actions" onClick={(e) => openGroupMenu(e.currentTarget, g, view, collection, result.groups!, gb.property)}><Icon name="ellipsisSmall" size={16} /></span>}
          <span role="button" className="nc-board-header-btn" aria-label="New page" onClick={() => db?.addRow({ group: g, position: 'start', editTitle: true })}><Icon name="plusSmall" size={16} /></span>
        </>
      )}
    </div>
  );

// a new group is a new option of the data source's property
  const canAddGroup = !(db?.schemaReadOnly ?? structureRO) && ['select', 'multi_select'].includes(collection.schema[gb.property]?.type ?? '');
  const newGroup = canAddGroup && (
    <div role="button" className="nc-board-new-group" onClick={() => {
      const name = window.prompt('New group');
      if (name?.trim()) addOption(collection.id, gb.property, name.trim());
    }}>
      <Icon name="plusSmall" size={16} />
      <span>New group</span>
    </div>
  );

  return (
    <div className="lit-board-view" data-board-view={view.id} style={{ marginInlineStart: bleed.left, marginInlineEnd: bleed.right }}>
      <div className="nc-board-headers">
        {groups.map(header)}
        {newGroup}
      </div>
      {subGb ? (
        <div className="nc-board-swimlanes">
          {subKeys.map(({ id, group: s }) => (
            <div key={id} className="nc-board-swimlane">
              <div className="nc-board-swimlane-header">
                <span role="button" className={`nc-group-caret ${collapsedSubs.has(id) ? 'collapsed' : ''}`} onClick={() => collapsedSubs.toggle(id)}><Icon name="triangleDown" size={12} /></span>
                <GroupToken group={s} />
                <span className="nc-group-count">{groups.reduce((n, g) => n + (g.subgroups?.find((x) => x.id === id)?.rows.length ?? 0), 0)}</span>
              </div>
              {!collapsedSubs.has(id) && (
                <div className="nc-board-columns">
                  {groups.map((g) => column(g, g.subgroups?.find((x) => x.id === id)?.rows ?? [], g.subgroups?.find((x) => x.id === id) ?? s))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="nc-board-columns">
          {groups.map((g) => column(g, g.rows))}
        </div>
      )}
    </div>
  );
}

function nextId(rows: BlockRecord[], id: string): string | null {
  const i = rows.findIndex((r) => r.id === id);
  return i >= 0 && i < rows.length - 1 ? rows[i + 1].id : null;
}


registerView('board', BoardView);
export { BoardView };
