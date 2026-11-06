// Database ••• › More › Merge with CSV: pick a CSV / TSV / Excel file → match its columns to the database's
// properties (by name; unmatched columns become new Text properties, or are skipped) → the rows are added.
import type { BlockRecord } from '@nc/shared/records.ts';
import { api, uploadFile } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { t } from '../shell/i18n.ts';
import { CsvMapping, type CsvPreview } from './CsvMapping.tsx';
import './import.css';

export function openMergeCsv(blockId: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.tsv,.xlsx,text/csv';
  input.style.display = 'none';
  input.setAttribute('data-testid', 'merge-csv-input');
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void mergeFile(blockId, file);
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

async function mergeFile(blockId: string, file: File) {
  const spaceId = records.get<BlockRecord>('block', blockId)?.space_id ?? useSession.getState().spaceId ?? '';
  try {
    const up = await uploadFile(file, file.name, spaceId);
    const preview = await api<CsvPreview>('previewCsv', { spaceId, url: up.url, name: file.name, blockId });
    openOverlay((close) => (
      <div className="nc-merge-csv-dialog" role="dialog" aria-label={t('lp.import.combine_with_csv', 'Combine with CSV')}>
        <CsvMapping
          merge
          preview={preview}
          fileName={file.name}
          onCancel={close}
          onImport={async (mapping) => {
            close();
            try {
              const res = await api<{ added: number; newProperties: string[]; recordMap: any }>('mergeCsv', { blockId, url: up.url, name: file.name, mapping });
              records.mergeRecordMap(res.recordMap);
              useUI.getState().toast(t('lp.import.added_count_plural_one_other', 'Added {count, plural, one {# record} other {# records}}', { count: res.added }));
            } catch (e: any) {
              useUI.getState().toast(e?.message ?? 'Merge failed');
            }
          }}
        />
      </div>
    ), { placement: 'middle', backdrop: 'dim' });
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? 'Merge failed');
  }
}
