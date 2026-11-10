// Select / multi-select / status cell editor: chips + "Find an option…" input, option list with drag
// handles and "…" option menus, "Create" row; status options grouped by To-do / In progress / Complete.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionRecord, PropertySchema, SelectOption } from '@nc/shared/records.ts';
import { encodeSelect, getPropertyValue, nextOptionColor, type StatusGroup } from '@nc/shared/database/index.ts';
import { COLOR_LABELS } from '@nc/shared/colors.ts';
import { useCollection } from '../../../../lib/hooks.ts';
import { getBlock } from '../../../../lib/blocks.ts';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { openMenu } from '../../../../components/Menu.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { addOption, deleteOption, reorderOptions, setValue, setValues, updateOption } from '../../actions.ts';
import { makeQueryContext } from '../../data.ts';
import { OptionPill, StatusPill, optionColorClass } from '../ValueView.tsx';
import type { CellEditorOptions } from '../editorRegistry.ts';
import { openNestedMenu } from '../../menus.ts';
import { useCollectionAccess } from '../../access.ts';

function currentNames(rowId: string, propId: string, c: CollectionRecord): string[] {
  const row = getBlock(rowId);
  if (!row) return [];
  const v = getPropertyValue(row, propId, c.schema, makeQueryContext());
  if (v.kind === 'select') return v.options.map((o) => o.value);
  if (v.kind === 'status') return v.option ? [v.option.value] : [];
  return [];
}

export function ColorSwatch({ color }: { color: string }) {
  return <span className={`nc-color-swatch ${optionColorClass(color)}`} />;
}

/** "…" menu of an option: rename, delete, colors. */
export function openOptionMenu(anchor: HTMLElement, collectionId: string, propId: string, option: SelectOption, opts?: { parent?: number; onDeleted?: () => void }) {
  let name = option.value;
  return openNestedMenu(anchor, {
    width: 220,
    header: (
      <div className="nc-option-menu-head">
        <div className="nc-input focused">
          <input
            autoFocus
            defaultValue={option.value}
            onChange={(e) => (name = e.target.value)}
            onBlur={() => name.trim() && name !== option.value && updateOption(collectionId, propId, option.id, { value: name })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
      </div>
    ),
    sections: [
      { items: [{ id: 'delete', label: 'Delete', icon: 'trash', onSelect: () => { deleteOption(collectionId, propId, option.id); opts?.onDeleted?.(); } }] },
      {
        title: 'Colors',
        items: (['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const).map((c) => ({
          id: c, label: COLOR_LABELS[c], icon: <ColorSwatch color={c} />, checked: (option.color ?? 'default') === c,
          onSelect: () => { updateOption(collectionId, propId, option.id, { color: c }); return false; },
        })),
      },
    ],
  }, { placement: 'right-start', offset: 4, parent: opts?.parent, backdrop: 'transparent' });
}

function SelectEditor({ opts, close }: { opts: CellEditorOptions; close: () => void }) {
  const c = useCollection(opts.collectionId);
  // options are part of the schema: a locked database (or Can edit content) only picks existing ones (/004)
  const schemaEditable = useCollectionAccess(opts.collectionId).canEditStructure;
  const prop = c?.schema[opts.propId] as PropertySchema | undefined;
  const multi = prop?.type === 'multi_select';
  const isStatus = prop?.type === 'status';
  const [selected, setSelected] = useState<string[]>(() => (c ? currentNames(opts.rowIds[0], opts.propId, c) : []));
  const [query, setQuery] = useState('');
    // status editor opens with no highlighted option; select keeps the first row
  const [active, setActive] = useState(isStatus ? -1 : 0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const options = prop?.options ?? [];
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => options.filter((o) => !q || o.value.toLowerCase().includes(q)), [options, q]);
  const exact = options.some((o) => o.value.toLowerCase() === q);
  const canCreate = schemaEditable && !!q && !exact;
  const groups = (prop?.groups ?? []) as StatusGroup[];
  const ordered: { group?: StatusGroup; option: SelectOption }[] = isStatus
    ? groups.flatMap((g) => (g.optionIds ?? []).map((id) => filtered.find((o) => o.id === id)).filter(Boolean).map((o) => ({ group: g, option: o! })))
    : filtered.map((o) => ({ option: o }));
  const total = ordered.length + (canCreate ? 1 : 0);

  if (!c || !prop) return null;

  const write = (names: string[]) => {
    const raw = encodeSelect(names);
    if (opts.rowIds.length > 1) setValues(opts.rowIds, opts.propId, raw);
    else setValue(opts.rowIds[0], opts.propId, raw);
  };

  const choose = (o: SelectOption) => {
    if (multi) {
      const next = selected.includes(o.value) ? selected.filter((n) => n !== o.value) : [...selected, o.value];
      setSelected(next);
      write(next);
      setQuery('');
    } else {
      setSelected([o.value]);
      write([o.value]);
      close();
    }
  };

  const create = () => {
    const o = addOption(opts.collectionId, opts.propId, query.trim(), { color: nextOptionColor(options) });
    if (o) choose(o);
    setQuery('');
  };

  const remove = (name: string) => {
    const next = selected.filter((n) => n !== name);
    setSelected(next);
    write(next);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (total ? (a + 1) % total : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (total ? (a < 0 ? total - 1 : (a - 1 + total) % total) : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = ordered[active];
      if (item) choose(item.option);
      else if (canCreate) create();
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const optionByName = (n: string) => options.find((o) => o.value === n) ?? { id: '', value: n, color: 'default' };

  const onDrop = () => {
    if (dragId === null || dropIdx === null) return;
    const ids = ordered.map((x) => x.option.id).filter((id) => id !== dragId);
    const target = Math.min(dropIdx, ids.length);
    ids.splice(target, 0, dragId);
    if (isStatus) {
      // keep groups; move within/between groups by position
      const targetItem = ordered[Math.min(dropIdx, ordered.length - 1)];
      const newGroups = groups.map((g) => ({ ...g, optionIds: (g.optionIds ?? []).filter((id) => id !== dragId) }));
      const tg = newGroups.find((g) => g.id === targetItem?.group?.id) ?? newGroups[0];
      const inGroup = ids.filter((id) => tg.optionIds.includes(id) || id === dragId);
      tg.optionIds = inGroup;
      reorderOptions(opts.collectionId, opts.propId, ids, newGroups);
    } else reorderOptions(opts.collectionId, opts.propId, ids);
    setDragId(null);
    setDropIdx(null);
  };

  let idx = -1;
  let lastGroup: string | undefined;
  return (
    <PopoverSurface width={isStatus ? 240 : 300} className={`nc-select-editor ${isStatus ? 'status' : ''}`} maxHeight="min(70vh, 520px)">
      <div className="nc-select-editor-field">
      <div className="nc-select-editor-input" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}>
        {selected.map((n) =>
          isStatus ? <StatusPill key={n} option={optionByName(n)} /> : <OptionPill key={n} option={optionByName(n)} onRemove={() => remove(n)} />,
        )}
        <input
          ref={inputRef}
          value={query}
          placeholder={selected.length ? '' : 'Find an option…'}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
      </div>
      </div>
      <div className="lit-scroller vertical nc-select-editor-scroll" ref={listRef} role="listbox">
        {!isStatus && <div className="nc-select-editor-hint">{schemaEditable ? 'Choose an option or create one' : 'Choose an option'}</div>}
        {ordered.map(({ group, option }) => {
          idx++;
          const myIdx = idx;
          const header = isStatus && group && group.id !== lastGroup ? group : null;
          lastGroup = group?.id;
          return (
            <div key={option.id}>
              {header && myIdx > 0 && <div className="nc-select-editor-divider group" />}
              {header && <div className="nc-select-editor-group">{header.name}</div>}
              {dropIdx === myIdx && dragId && <div className="nc-drop-line" />}
              <div
                role="option"
                aria-selected={myIdx === active}
                className={`nc-select-option ${myIdx === active ? 'active' : ''}`}
                onMouseMove={() => setActive(myIdx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                draggable={schemaEditable}
                onDragStart={(e) => {
                  setDragId(option.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropIdx(e.clientY < r.top + r.height / 2 ? myIdx : myIdx + 1);
                }}
                onDrop={onDrop}
                onDragEnd={() => {
                  setDragId(null);
                  setDropIdx(null);
                }}
              >
                {!isStatus && schemaEditable && <span className="nc-select-option-drag"><Icon name="dragHandle" size={14} /></span>}
                <span className="nc-select-option-pill">{isStatus ? <StatusPill option={option} /> : <OptionPill option={option} />}</span>
                {!isStatus && schemaEditable && <span
                  role="button"
                  className="nc-select-option-more"
                  aria-label="Edit option"
                  onClick={(e) => {
                    e.stopPropagation();
                    openOptionMenu(e.currentTarget as HTMLElement, opts.collectionId, opts.propId, option, { onDeleted: () => setSelected((s) => s.filter((n) => n !== option.value)) });
                  }}
                >
                  <Icon name="ellipsisSmall" size={16} />
                </span>}
              </div>
            </div>
          );
        })}
        {dropIdx === ordered.length && dragId && <div className="nc-drop-line" />}
        {canCreate && (
          <div
            role="option"
            aria-selected={active === ordered.length}
            className={`nc-select-option create ${active === ordered.length ? 'active' : ''}`}
            onMouseMove={() => setActive(ordered.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={create}
          >
            <span className="nc-select-create-label">Create</span>
            {isStatus ? <StatusPill option={{ value: query.trim(), color: 'default' }} /> : <OptionPill option={{ value: query.trim(), color: nextOptionColor(options, () => 0) }} />}
          </div>
        )}
        {!ordered.length && !canCreate && isStatus && <div className="nc-select-editor-empty">No options</div>}
        {isStatus && schemaEditable && (
          <>
            <div className="nc-select-editor-divider" />
            <div
              role="option"
              className="nc-select-option nc-select-edit-property"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                const anchor = (e.currentTarget.closest('.nc-select-editor') as HTMLElement | null) ?? e.currentTarget;
                const r = anchor.getBoundingClientRect();
                close();
                void import('../PropertyMenus.tsx').then((m) => m.openEditPropertyPopover(new DOMRect(r.left, r.top, r.width, 0), opts.collectionId, opts.propId, opts.view));
              }}
            >
              <Icon name="slidersTwo" size={20} style={{ color: 'var(--lp-icon-primary)' }} />
              <span className="nc-select-edit-property-label">Edit property</span>
            </div>
          </>
        )}
      </div>
    </PopoverSurface>
  );
}

export function openSelectEditor(anchor: HTMLElement, opts: CellEditorOptions): () => void {
  const rect = anchor.getBoundingClientRect();
  return openOverlay((close) => <SelectEditor opts={opts} close={close} />, {
    // the editor covers the cell from 1px above-left
    anchor: new DOMRect(rect.left - 1, rect.top - 1, Math.max(rect.width, 280), 0),
    placement: 'bottom-start',
    offset: 0,
    onClose: opts.onClose,
  });
}
