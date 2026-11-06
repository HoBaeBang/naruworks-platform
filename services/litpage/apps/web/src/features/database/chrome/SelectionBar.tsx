// Bulk-action bar shown while rows are selected: "{n} selected" | up to 6 property buttons | trash | •••
//.
import type { CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { Icon } from '../../../components/Icon.tsx';
import { PropertyIcon, openPropertyEditor } from '../properties/PropertyCell.tsx';
import { deleteRows, viewProperties } from '../actions.ts';
import { openRowMenu } from './RowMenu.tsx';

const EXCLUDED = new Set(['title', 'rollup', 'formula', 'button', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'auto_increment_id', 'location']);

export function SelectionBar({ selection, setSelection, collection, view }: { selection: string[]; setSelection: (ids: string[]) => void; collection: CollectionRecord; view: CollectionViewRecord }) {
  const props = viewProperties(view, collection.schema)
    .filter((e) => e.visible && !EXCLUDED.has(collection.schema[e.property]?.type ?? 'title'))
    .slice(0, 6);
  return (
    <div className="nc-selection-bar-outer">
      <div className="nc-selection-bar" role="toolbar">
        <div role="button" className="nc-selection-count" onClick={() => setSelection([])}>{selection.length} selected</div>
        {props.map((e) => {
          const p = collection.schema[e.property];
          return (
            <div
              key={e.property}
              role="button"
              aria-label={p.name}
              className="nc-selection-prop"
              onClick={(ev) => openPropertyEditor(ev.currentTarget, { rowIds: selection, propId: e.property, collectionId: collection.id, view })}
            >
              <PropertyIcon prop={p} size={16} style={{ color: 'var(--lp-text-primary)' }} />
              <span className="nc-selection-prop-name">{p.name}</span>
            </div>
          );
        })}
        <div role="button" className="nc-selection-icon trash" aria-label="Send to trash" data-tooltip="Send to trash" onClick={() => { deleteRows(selection); setSelection([]); }}>
          <Icon name="trash" size={16} />
        </div>
        <div role="button" className="nc-selection-icon more" aria-label="More actions" onClick={(e) => openRowMenu(e.currentTarget, { rowIds: selection, collection, view, onDone: () => setSelection([]) })}>
          <Icon name="ellipsisSmall" size={16} />
        </div>
      </div>
    </div>
  );
}
