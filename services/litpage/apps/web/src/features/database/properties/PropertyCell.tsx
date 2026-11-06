// <PropertyCell row schema propId readOnly /> — display + click-to-edit for every property type, shared by
// all database views (table, board, list, gallery, calendar, timeline, …) and the page properties panel.
// openPropertyEditor(anchor, …) opens the type's editor (select menu, date picker, person picker, …).
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { BlockRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { encodeCheckbox, encodeFiles, getPropertyValue, isCompleteStatus, isEmptyValue, propertiesKeyFor, propertyTypeMeta, type Schema } from '@nc/shared/database/index.ts';
import { records } from '../../../lib/store/records.ts';
import { Icon } from '../../../components/Icon.tsx';
import { setValue } from '../actions.ts';
import { propertyAccessFor } from '../access.ts';
import { makeQueryContext, useDatabaseVersion } from '../data.ts';
import { CheckboxView, ValueView } from './ValueView.tsx';
import { cellEditorRegistry, type CellEditorOptions } from './editorRegistry.ts';
import { openTextEditor } from './editors/TextEditor.tsx';
import { openSelectEditor } from './editors/SelectEditor.tsx';
import { openDateEditor } from './editors/DatePicker.tsx';
import { openFilesEditor, openPersonEditor, openPlaceEditor, openRelationEditor, uploadFileValues } from './editors/MiscEditors.tsx';
import { runButton } from './buttonActions.ts';
import { colorToken } from '../../../lib/colorToken.ts';

/** Icon for a property: custom schema icon (emoji / icon) or the type icon. */
export function PropertyIcon({ prop, size = 16, style }: { prop: Pick<PropertySchema, 'type'> & { icon?: unknown }; size?: number; style?: CSSProperties }) {
  const icon = typeof prop.icon === 'string' ? prop.icon : '';
  // custom property icons: emoji, icon from the Icons tab ("lit-icon:name:color") or an uploaded image
  if (icon.startsWith('lit-icon:')) {
    const [, name, color] = icon.split(':');
    return <Icon name={name} size={size} style={{ color: color ? `var(${colorToken(color.slice(0, 3), 'text-accent')}, ${color})` : 'var(--lp-icon-secondary)', ...style }} />;
  }
  if (/^(https?:|\/files\/|data:image\/)/.test(icon)) {
    return <img className="nc-prop-icon image" src={icon} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 3, flexShrink: 0, ...style }} />;
  }
  if (icon && !icon.startsWith('/')) {
    return <span className="nc-prop-icon emoji" style={{ width: size, height: size, fontSize: size * 0.85, ...style }}>{icon}</span>;
  }
  return <Icon name={propertyTypeMeta(prop.type).icon} size={size} style={{ color: 'var(--lp-icon-secondary)', ...style }} />;
}

/** Open the editor for `propId` of the given row(s). Returns a close function (no-op for read-only types). */
export function openPropertyEditor(anchor: HTMLElement, opts: CellEditorOptions): () => void {
  const c = records.get('collection', opts.collectionId) as { schema: Schema } | undefined;
  const prop = c?.schema[opts.propId];
  if (!prop) return () => {};
  const custom = cellEditorRegistry[prop.type];
  if (custom) return custom(anchor, opts);
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'number':
    case 'url':
    case 'email':
    case 'phone_number':
      return openTextEditor(anchor, opts);
    case 'select':
    case 'multi_select':
    case 'status':
      return openSelectEditor(anchor, opts);
    case 'date':
      return openDateEditor(anchor, opts);
    case 'person':
      return openPersonEditor(anchor, opts);
    case 'file':
      return openFilesEditor(anchor, opts);
    case 'place':
      return openPlaceEditor(anchor, opts);
    case 'relation':
      return openRelationEditor(anchor, opts);
    default:
      return () => {};
  }
}

/** The view shows this Status property as a checkbox (Display as › Checkbox). */
export function statusShownAsCheckbox(view: CollectionViewRecord, propId: string): boolean {
  const key = propertiesKeyFor(view.type);
  const list = ((view.format as Record<string, unknown> | undefined)?.[key] ?? []) as { property?: string; statusShowAs?: string }[];
  return list.some((e) => e?.property === propId && e.statusShowAs === 'checkbox');
}

/** Option a Status checkbox switches to: the first "Complete" option when checking, the default / first "To-do" option when unchecking. */
export function statusToggleTarget(prop: PropertySchema, done: boolean): string | null {
  const groups = (prop.groups ?? []) as { name: string; optionIds?: string[] }[];
  const optionOf = (groupName: string) => {
    const ids = groups.find((g) => g.name === groupName)?.optionIds ?? [];
    return (prop.options ?? []).find((o) => ids.includes(o.id))?.value ?? null;
  };
  if (done) return optionOf('Complete');
  return (prop.defaultOption as string | undefined) ?? optionOf('To-do');
}

export function isEditableType(type: string): boolean {
  if (cellEditorRegistry[type]) return true;
  return !propertyTypeMeta(type).noEditor && !['created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'auto_increment_id', 'location', 'formula', 'rollup', 'button', 'verification'].includes(type);
}

export interface PropertyCellProps {
  row: BlockRecord;
  schema: Schema;
  propId: string;
  readOnly?: boolean;
  view?: CollectionViewRecord;
  wrap?: boolean;
  mode?: 'cell' | 'card' | 'page' | 'list';
  /** shown when the value is empty (page properties: "Empty") */
  placeholder?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** the element the editor anchors to (defaults to the cell itself) */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** rows to edit together (bulk edit) */
  rowIds?: string[];
  onEditorClose?: () => void;
  /** disable click-to-edit (e.g. card previews where clicking opens the page) */
  noEdit?: boolean;
}

export function PropertyCell({ row, schema, propId, readOnly, view, wrap, mode = 'cell', placeholder, className, style, anchorRef, rowIds, onEditorClose, noEdit }: PropertyCellProps) {
  useDatabaseVersion();
  const ref = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState(false);
  const prop = schema[propId];
  if (!prop) return null;
  // property access rule: values may be view-only for this person
  if ((prop as { property_permissions?: unknown }).property_permissions && !propertyAccessFor(row.parent_id, propId, row).canEditValues) readOnly = true;
  const ctx = makeQueryContext();
  const value = getPropertyValue(row, propId, schema, ctx);
  // Status › Display as › Checkbox (view setting): checked = a "Complete" option 
  const statusBox = prop.type === 'status' && !!view && statusShownAsCheckbox(view, propId);
  const editable = !readOnly && !noEdit && isEditableType(prop.type) && !statusBox;
  const toggle = prop.type === 'checkbox' && !readOnly ? () => setValue(row.id, propId, encodeCheckbox(!(value.kind === 'checkbox' && value.checked))) : undefined;
  let content: ReactNode;
  if (statusBox) {
    const done = value.kind === 'status' && !!value.option && isCompleteStatus(prop, value.option.value);
    const next = statusToggleTarget(prop, !done);
    content = <CheckboxView checked={done} disabled={readOnly || !next} onToggle={readOnly || !next ? undefined : () => setValue(row.id, propId, [[next]])} />;
  } else if (prop.type === 'button') {
    content = (
      <span
        role="button"
        className="nc-prop-button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!readOnly) runButton(row, propId, schema, e.currentTarget);
        }}
      >
        <Icon name="button" size={14} />
        <span>{(prop.button_label as string | undefined) || prop.name}</span>
      </span>
    );
  } else {
    content = <ValueView value={value} prop={prop} propId={propId} row={row} ctx={ctx} wrap={wrap} readOnly={readOnly} onToggleCheckbox={toggle} mode={mode} />;
  }
  // ValueView renders nothing for empty values; page properties show their placeholder ("Empty") instead
  const empty = prop.type !== 'button' && prop.type !== 'checkbox' && !statusBox && isEmptyValue(value);
  return (
    <div
      ref={ref}
      className={`nc-property-cell type-${prop.type} ${editable ? 'editable' : ''} ${empty ? 'empty' : ''} ${dropTarget ? 'drop-target' : ''} ${className ?? ''}`}
      style={style}
      data-property={propId}
      // Files & media: drop files onto the cell to upload them 
      onDragOver={prop.type === 'file' && editable ? (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropTarget(true); } } : undefined}
      onDragLeave={prop.type === 'file' && editable ? () => setDropTarget(false) : undefined}
      onDrop={prop.type === 'file' && editable ? (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(false);
        const list = [...e.dataTransfer.files];
        void uploadFileValues(list).then((added) => {
          if (!added.length) return;
          const cur = getPropertyValue(records.get<BlockRecord>('block', row.id) ?? row, propId, schema, makeQueryContext());
          const before = cur.kind === 'file' ? cur.files : [];
          const next = prop.limit === 1 ? added.slice(-1) : [...before, ...added];
          setValue(row.id, propId, encodeFiles(next));
        });
      } : undefined}
  // page properties: the value box is the button that opens the editor
      role={mode === 'page' && editable && prop.type !== 'checkbox' ? 'button' : undefined}
      onClick={(e) => {
        if (!editable || prop.type === 'checkbox') return;
        e.stopPropagation();
        const anchor = anchorRef?.current ?? ref.current;
        if (anchor) openPropertyEditor(anchor, { rowIds: rowIds ?? [row.id], propId, collectionId: row.parent_id, view, onClose: onEditorClose });
      }}
    >
      {empty ? placeholder ?? null : content}
    </div>
  );
}
