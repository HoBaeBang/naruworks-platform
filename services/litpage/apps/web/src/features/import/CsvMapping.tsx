// CSV column mapping ("Merge with CSV"): one row per CSV column with sample
// values. New database: pick each column's property type (or skip it; the first column is the title). Merge: pick the
// existing property each column fills, "New property" (Text) or skip — matched by name by default.
import { useMemo, useState } from 'react';
import { t } from '../shell/i18n.ts';
import '../page/dialogs.css';

export interface CsvPreview {
  columns: { index: number; name: string; type: string; samples: string[] }[];
  rows: number;
  types: string[];
  target?: { blockId: string; name: string; properties: { id: string; name: string; type: string }[] };
}

const TYPE_LABEL: Record<string, string> = {
  title: 'Title', text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', status: 'Status', date: 'Date',
  checkbox: 'Checkbox', url: 'URL', email: 'Email', phone_number: 'Phone',
};

export function CsvMapping({ preview, fileName, onImport, onCancel, merge }: {
  preview: CsvPreview;
  fileName: string;
  /** new database: { columnIndex: type | 'skip' }; merge: { columnIndex: propertyId | 'new' | 'skip' } */
  onImport: (choice: Record<number, string>) => void;
  onCancel: () => void;
  merge?: boolean;
}) {
  const props = preview.target?.properties ?? [];
  const initial = useMemo(() => {
    const out: Record<number, string> = {};
    for (const c of preview.columns) {
      if (merge) {
        const byName = props.find((p) => p.name.trim().toLowerCase() === c.name.trim().toLowerCase());
        out[c.index] = byName ? byName.id : c.index === 0 && props.some((p) => p.id === 'title') ? 'title' : 'new';
      } else if (c.index > 0) out[c.index] = c.type;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  const [choice, setChoice] = useState<Record<number, string>>(initial);
  return (
    <div className="nc-csv-mapping" role="group" aria-label={t('lp.import.map_columns', 'Map columns')}>
      <div className="nc-csv-mapping-head">
        <div className="nc-csv-mapping-title">{merge ? t('lp.import.merge_into', 'Merge “{file}” into {database}', { file: fileName, database: preview.target?.name || 'Untitled' }) : fileName}</div>
        <div className="nc-csv-mapping-sub">
          {t('lp.import.count_plural_one_other_c1d7', '{count, plural, one {# record} other {# records}}', { count: preview.rows })} · {merge ? t('lp.import.choose_the_property_each_column_fills', 'Choose the property each column fills. New rows are added; existing rows stay as they are.') : t('lp.import.choose_a_property_type_for_each', 'Choose a property type for each column.')}
        </div>
      </div>
      <div className="nc-csv-mapping-list">
        {preview.columns.map((c) => (
          <div key={c.index} className="nc-csv-mapping-row" data-column={c.name}>
            <div className="nc-csv-col">
              <div className="nc-csv-col-name nc-ellipsis">{c.name}</div>
              <div className="nc-csv-col-sample nc-ellipsis">{c.samples.filter(Boolean).join(', ') || '—'}</div>
            </div>
            {merge ? (
              <select className="nc-csv-type" aria-label={`${c.name} property`} value={choice[c.index] ?? 'new'} onChange={(e) => setChoice((x) => ({ ...x, [c.index]: e.target.value }))}>
                {props.map((p) => <option key={p.id} value={p.id}>{p.name} ({TYPE_LABEL[p.type] ?? p.type})</option>)}
                <option value="new">{t('lp.import.new_property', 'New property')}</option>
                <option value="skip">{t('lp.import.don_t_import', 'Don’t import')}</option>
              </select>
            ) : c.index === 0 ? (
              <div className="nc-csv-type fixed">{TYPE_LABEL.title}</div>
            ) : (
              <select className="nc-csv-type" aria-label={`${c.name} type`} value={choice[c.index] ?? c.type} onChange={(e) => setChoice((x) => ({ ...x, [c.index]: e.target.value }))}>
                {preview.types.map((ty) => <option key={ty} value={ty}>{TYPE_LABEL[ty] ?? ty}</option>)}
                <option value="skip">{t('lp.import.don_t_import', 'Don’t import')}</option>
              </select>
            )}
          </div>
        ))}
      </div>
      <div className="nc-csv-mapping-actions">
        <button type="button" className="nc-dialog-btn outline" onClick={onCancel}>{t('lp.import.cancel', 'Cancel')}</button>
        <button type="button" className="nc-dialog-btn primary" onClick={() => onImport(choice)}>{merge ? t('lp.import.merge', 'Merge') : t('lp.import.import', 'Import')}</button>
      </div>
    </div>
  );
}
