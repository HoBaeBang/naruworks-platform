// List view: 30px rows with a 32px pitch, 6px radius, 22x22 page icon, and 14px title on
// the left, visible properties right-aligned (min 100, max max(150px,50%)), groups, load limit, "+ New page".
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { getPropertyValue, isEmptyValue, type GroupResult } from '@nc/shared/database/index.ts';
import { registerView, type ViewProps } from '../../viewRegistry.ts';
import { conditionalBg, makeQueryContext, useConditionalColors, useViewQuery } from '../../data.ts';
import { useDatabaseContext } from '../../DatabaseContext.tsx';
import { moveRow, viewProperties } from '../../actions.ts';
import { PropertyCell } from '../../properties/PropertyCell.tsx';
import { RichTextView } from '../../properties/RichTextView.tsx';
import { GroupHeader, useCollapsedGroups } from '../../chrome/Groups.tsx';
import { openRowMenu } from '../../chrome/RowMenu.tsx';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { RichTextEditable } from '../../../editor/RichTextEditable.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { setValue } from '../../actions.ts';
import { TitleText } from '../highlight.tsx';
import { NewSubitemRow, SubitemCount, SubitemToggle, subitemInfoFor, type SubitemRowInfo } from '../../subitemsUi.tsx';
import { useIsExpanded } from '../../subitems.ts';
import './list.css';

function ListRow({ row, view, collection, props, readOnly, selected, color, subitem, subitemCount = 0, contextRow }: { row: BlockRecord; view: CollectionViewRecord; collection: CollectionRecord; props: string[]; readOnly: boolean; selected: boolean; color?: string; subitem?: SubitemRowInfo | null; subitemCount?: number; contextRow?: boolean }) {
  const db = useDatabaseContext();
  const fmt = (view.format ?? {}) as Record<string, any>;
  const editing = db?.editingTitle === row.id;
  const title = (row.properties?.title as RichText | undefined) ?? [];
  const ctx = makeQueryContext();
  // a new item (+ New page / Shift+Enter) starts with the caret in its title
  const titleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing || readOnly) return;
    const el = titleRef.current?.querySelector<HTMLElement>('[contenteditable]');
    if (!el || document.activeElement === el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(r);
  }, [editing, readOnly]);
  const values = props.filter((p) => collection.schema[p] && (collection.schema[p].type === 'checkbox' || !isEmptyValue(getPropertyValue(row, p, collection.schema, ctx))));
  return (
    <div className={`lit-selectable lit-page-block lit-collection-item nc-list-item ${selected ? 'selected' : ''} ${contextRow ? 'nc-subitem-context' : ''}`} data-block-id={row.id}>
      <div
        role="link"
        className="nc-list-row"
        style={color ? { background: conditionalBg(color) } : undefined}
        onClick={() => !editing && db?.openRow(row.id)}
        onContextMenu={(e) => { e.preventDefault(); openRowMenu({ x: e.clientX, y: e.clientY }, { rowIds: [row.id], collection, view }); }}
      >
        <div className="nc-list-title-cell" ref={titleRef}>
          {subitem && <SubitemToggle info={subitem} />}
          {fmt.show_page_icon !== false && <span className="lit-record-icon nc-list-icon"><PageIcon block={row} size={18} fallback={row.content?.length ? 'page' : 'pageEmpty'} /></span>}
          {editing && !readOnly ? (
            <RichTextEditable
              blockId={row.id}
              property="title"
              value={title}
              className="nc-list-title editing"
              placeholder="Untitled"
              placeholderAlways
              onChange={(next) => setValue(row.id, 'title', next, { coalesce: `title:${row.id}` })}
              onBlur={() => db?.setEditingTitle(null)}
              onKeyDown={(e) => {
                // quick edit: Shift+Enter adds an item below, Tab moves on to the first property
                if (e.key === 'Enter' && e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                  db?.addRow({ after: row.id, editTitle: true });
                  return;
                }
                if (e.key === 'Tab' && !e.shiftKey) {
                  const cell = (e.currentTarget as HTMLElement).closest('.nc-list-item')?.querySelector<HTMLElement>('.nc-list-prop .nc-property-cell');
                  if (cell) {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).blur();
                    setTimeout(() => cell.click(), 0);
                  }
                  return;
                }
                if ((e.key === 'Enter' && !e.nativeEvent.isComposing) || e.key === 'Escape') {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
            />
          ) : (
            <>
              <div className={`nc-list-title ${title.length ? '' : 'untitled'}`}>{title.length ? <TitleText title={title} search={db?.search} /> : 'Untitled'}</div>
              {subitemCount > 0 && <SubitemCount count={subitemCount} />}
            </>
          )}
        </div>
        <div className="nc-list-props" onClick={(e) => e.stopPropagation()}>
          {values.map((p) => (
            <div key={p} className="nc-list-prop">
              <PropertyCell row={row} schema={collection.schema} propId={p} readOnly={readOnly} view={view} mode="list" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListView({ view, collection, readOnly }: ViewProps) {
  const db = useDatabaseContext();
  // a selected item: Shift+Enter adds a new item right below it 
  useEffect(() => {
    const sel = db?.selection ?? [];
    if (readOnly || sel.length !== 1) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'Enter' || !e.shiftKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName)))) return;
      e.preventDefault();
      db?.setSelection([]);
      db?.addRow({ after: sel[0], editTitle: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [db, readOnly]);
  const result = useViewQuery(collection, view, { search: db?.search ?? '' });
  const fmt = (view.format ?? {}) as Record<string, any>;
  const props = viewProperties(view, collection.schema).filter((e) => e.visible && e.property !== 'title').map((e) => e.property);
  const limitFmt = fmt.inline_collection_first_load_limit as { type: string; limit: number } | undefined;
  const first = db?.inline === false ? Infinity : limitFmt?.type === 'load_limit' ? limitFmt.limit : 50;
  const [limit, setLimit] = useState(first);
  useEffect(() => setLimit(first), [first, view.id]);
  const [drag, setDrag] = useState<string | null>(null);
  const collapsed = useCollapsedGroups(view.id);
  const bleed = db?.bleed ?? { left: 0, right: 0, width: null };
  const selection = db?.selection ?? [];
  const colorsOf = useConditionalColors(view, collection);
  const sub = result.subitems;
  const isOpen = useIsExpanded(view.id);

  const rows = (list: BlockRecord[], group?: GroupResult) => (
    <>
      {(Number.isFinite(limit) ? list.slice(0, limit) : list).flatMap(function tree(r: BlockRecord): ReactNode[] {
        const info = subitemInfoFor(r, sub?.depth[r.id] ?? 0, sub, view, isOpen);
        const el = (
        <div
          key={r.id}
          draggable={!readOnly}
          onDragStart={() => setDrag(r.id)}
          onDragOver={(e) => drag && e.preventDefault()}
          onDrop={() => { if (drag && drag !== r.id) moveRow(view, collection.id, drag, { before: r.id }); setDrag(null); }}
        >
          <ListRow row={r} view={view} collection={collection} props={props} readOnly={readOnly} selected={selection.includes(r.id)} color={colorsOf(r)?.row} subitem={info} subitemCount={sub?.mode === 'flattened' ? sub.counts[r.id] ?? 0 : 0} contextRow={!!sub?.context.includes(r.id)} />
        </div>
        );
        if (!info?.open) return [el];
        return [el, ...(sub!.children[r.id] ?? []).flatMap(tree), ...(!readOnly ? [<NewSubitemRow key={`new-sub-${r.id}`} parent={r} view={view} depth={info.depth + 1} className="nc-list-subitem-new" />] : [])];
      })}
      {list.length > limit && (
        <div role="button" className="nc-list-load-more" onClick={() => setLimit((l) => l + (Number.isFinite(first) ? first : 50))}>
          <Icon name="arrowDown" size={16} />
          <span>Load more</span>
        </div>
      )}
      {!readOnly && (
        <div role="button" className="nc-list-new" onClick={() => db?.addRow({ group: group ?? null, position: 'end', editTitle: true })}>
          <Icon name="plusSmall" size={16} />
          <span>New page</span>
        </div>
      )}
    </>
  );

  return (
    <div className="lit-list-view" style={{ paddingInlineStart: bleed.left + 8, paddingInlineEnd: bleed.right }}>
      <div className="nc-list-inner">
        {result.groups ? (
          result.groups.filter((g) => !g.hidden).map((g) => (
            <div key={g.id} className="nc-list-group">
              <GroupHeader group={g} view={view} collection={collection} readOnly={readOnly} collapsed={collapsed.has(g.id)} onToggle={() => collapsed.toggle(g.id)} onAdd={() => db?.addRow({ group: g, position: 'end', editTitle: true })} />
              {!collapsed.has(g.id) && rows(g.rows, g)}
            </div>
          ))
        ) : (
          rows(result.rows)
        )}
      </div>
    </div>
  );
}

registerView('list', ListView);
export { ListView };
