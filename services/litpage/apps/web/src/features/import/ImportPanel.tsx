// Import panel (Settings › Import body and the Import modal): "Discover / Completed" pills, drag-and-drop zone,
// "File-based imports" and "Third-party imports" grids with consistent card styling and layout,
// 24px icons, grid minmax(240px,1fr) gap 4px 20px; dashed blue drop zone radius 8 padding 32).
// Every tile imports files: CSV (+ TSV / Excel, with a column-mapping step), PDF, Text & Markdown, HTML, Word (docx);
// third-party tiles take supported provider export files; account-based migration isn't available.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { api, uploadFile } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openPage } from '../../lib/router.ts';
import { t } from '../shell/i18n.ts';
import { CsvMapping, type CsvPreview } from './CsvMapping.tsx';
import '../templates/icons.tsx';
import './import.css';

type SourceKind = 'any' | 'csv' | 'pdf' | 'markdown' | 'html' | 'word' | 'thirdparty';
export type ImportKind = 'csv' | 'pdf' | 'markdown' | 'html' | 'word' | 'zip' | 'asana' | 'confluence' | 'trello' | 'workflowy' | 'evernote' | 'jira' | 'monday' | 'quip' | 'gdocs';

interface Source {
  id: string;
  title: string;
  caption: string;
  icon: string;
  kind: SourceKind;
  accept?: string;
}

const FILE_SOURCES = (): Source[] => [
  { id: 'csv', title: t('lp.import.csv', 'CSV'), caption: t('lp.import.import_structured_spreadsheet_data', 'Import structured spreadsheet data'), icon: 'viewTable', kind: 'csv', accept: '.csv,.tsv,.xlsx,text/csv' },
  { id: 'pdf', title: t('lp.import.pdf', 'PDF'), caption: t('lp.import.pull_content_out_of_pdf_files', 'Pull content out of PDF files'), icon: 'filePdfDoc', kind: 'pdf', accept: '.pdf,application/pdf' },
  { id: 'markdown', title: t('lp.import.text_markdown', 'Text & Markdown'), caption: t('lp.import.bring_in_notes_from_plain_text', 'Bring in notes, from plain text to rich formatting'), icon: 'fileText', kind: 'markdown', accept: '.md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip' },
  { id: 'html', title: t('lp.import.html', 'HTML'), caption: t('lp.import.bring_in_web_pages_keeping_their', 'Bring in web pages, keeping their structure'), icon: 'codeBrackets', kind: 'html', accept: '.html,.htm,.zip,text/html' },
  { id: 'word', title: t('lp.import.word', 'Word'), caption: t('lp.import.convert_word_docs_to_litpage_pages', 'Convert Word docs to Litpage pages'), icon: 'importWord', kind: 'word', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
];

const THIRD_PARTY = (): Source[] => [
  { id: 'asana', title: 'Asana', caption: t('lp.import.carry_over_tasks_and_projects', 'Carry over tasks and projects'), icon: 'importAsana', kind: 'thirdparty', accept: '.csv,.xlsx' },
  { id: 'confluence', title: 'Confluence', caption: t('lp.import.move_your_team_s_documentation', "Move your team’s documentation"), icon: 'importConfluence', kind: 'thirdparty', accept: '.zip,.html,.htm' },
  { id: 'trello', title: 'Trello', caption: t('lp.import.import_boards_together_with_their_cards', 'Import boards together with their cards'), icon: 'importTrello', kind: 'thirdparty', accept: '.json,application/json' },
  { id: 'workflowy', title: 'Workflowy', caption: t('lp.import.pull_in_lists_and_outlines', 'Pull in lists and outlines'), icon: 'importWorkflowy', kind: 'thirdparty', accept: '.opml,.txt' },
  { id: 'evernote', title: 'Evernote', caption: t('lp.import.transfer_notebooks_and_the_notes_inside', 'Transfer notebooks and the notes inside'), icon: 'importEvernote', kind: 'thirdparty', accept: '.enex' },
  { id: 'jira', title: 'Jira', caption: t('lp.import.bring_in_projects_along_with_their', 'Bring in projects along with their issues'), icon: 'importJira', kind: 'thirdparty', accept: '.csv,.xlsx' },
  { id: 'monday', title: 'Monday.com', caption: t('lp.import.move_workspaces_and_tasks', 'Move workspaces and tasks'), icon: 'importMonday', kind: 'thirdparty', accept: '.xlsx,.csv' },
  { id: 'quip', title: 'Quip', caption: t('lp.import.import_shared_documents', 'Import shared documents'), icon: 'importQuip', kind: 'thirdparty', accept: '.docx,.html,.htm,.md' },
  { id: 'gdocs', title: 'Google Docs', caption: t('lp.import.import_your_documents_with_ease', 'Import your documents with ease'), icon: 'importGoogleDocs', kind: 'thirdparty', accept: '.docx,.html,.htm' },
];

const SUPPORTED = /\.(md|markdown|txt|csv|tsv|html?|zip|docx|pdf|xlsx|opml|enex|json)$/i;
const SHEET = /\.(csv|tsv|xlsx)$/i;
const ANY_ACCEPT = '.md,.markdown,.txt,.csv,.tsv,.xlsx,.html,.htm,.zip,.docx,.pdf,.opml,.enex';
const HISTORY_KEY = 'nc:importHistory';

interface HistoryEntry {
  time: number;
  files: string[];
  pageIds: string[];
  pages: number;
  databases: number;
  spaceId: string;
}

function readHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}

function pushHistory(e: HistoryEntry) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([e, ...readHistory()].slice(0, 30)));
  } catch {
    /* ignore */
  }
}

type Status =
  | { state: 'idle' }
  | { state: 'working'; label: string; progress: number }
  | { state: 'mapping'; preview: CsvPreview; file: Uploaded }
  | { state: 'done'; entry: HistoryEntry }
  | { state: 'error'; message: string };

export interface Uploaded {
  name: string;
  url: string;
}

export interface ImportTarget {
  parentPageId?: string;
  /** insert after this block of the parent page (slash /import) */
  afterBlockId?: string;
}

/** Upload the supported files (progress 0 → 0.8); returns them with the names of skipped files. */
export async function uploadImportFiles(files: File[], onProgress?: (label: string, progress: number) => void): Promise<{ uploaded: Uploaded[]; skipped: string[] }> {
  const spaceId = useSession.getState().spaceId ?? '';
  const ok = files.filter((f) => SUPPORTED.test(f.name));
  const skipped = files.filter((f) => !SUPPORTED.test(f.name)).map((f) => f.name);
  if (!ok.length) throw new Error(t('lp.import.this_file_type_can_t_be', 'This file type can’t be imported. Try Markdown, CSV, Excel, HTML, Word, PDF or ZIP.'));
  const uploaded: Uploaded[] = [];
  for (let i = 0; i < ok.length; i++) {
    onProgress?.(`${t('lp.import.importing', 'Importing…')} ${ok[i].name}`, (i / (ok.length + 1)) * 0.8);
    const u = await uploadFile(ok[i], ok[i].name, spaceId);
    uploaded.push({ name: ok[i].name, url: u.url });
  }
  return { uploaded, skipped };
}

/** Convert uploaded files into pages / databases under the target (Private section by default). */
export async function importUploaded(uploaded: Uploaded[], target: ImportTarget = {}, csvTypes?: Record<number, string>): Promise<HistoryEntry> {
  const spaceId = useSession.getState().spaceId ?? '';
  const res = await api<{ pageIds: string[]; pages: number; databases: number; recordMap: any }>('importFiles', {
    spaceId,
    parent: target.parentPageId ? { kind: 'page', pageId: target.parentPageId, afterBlockId: target.afterBlockId } : { kind: 'private' },
    files: uploaded,
    ...(csvTypes ? { csvTypes } : {}),
  });
  records.mergeRecordMap(res.recordMap);
  const entry: HistoryEntry = { time: Date.now(), files: uploaded.map((f) => f.name), pageIds: res.pageIds, pages: res.pages, databases: res.databases, spaceId };
  pushHistory(entry);
  return entry;
}

/** Import files into the user's Private section (or under `parentPageId`). */
export async function importFiles(files: File[], opts: ImportTarget & { onProgress?: (label: string, progress: number) => void } = {}): Promise<HistoryEntry> {
  const { uploaded, skipped } = await uploadImportFiles(files, opts.onProgress);
  opts.onProgress?.(t('lp.import.importing', 'Importing…'), 0.85);
  const entry = await importUploaded(uploaded, opts);
  if (skipped.length) useUI.getState().toast(t('lp.import.skipped_unsupported_file_s', 'Skipped {count} unsupported file(s)', { count: skipped.length }));
  return entry;
}

function pageTitleOf(id: string): string {
  const b = records.get('block', id) as { type?: string; properties?: { title?: [string][] }; collection_id?: string } | undefined;
  if (!b) return t('lp.import.untitled', 'Untitled');
  if (b.type === 'collection_view_page' && b.collection_id) {
    const c = records.get('collection', b.collection_id) as { name?: [string][] } | undefined;
    const n = (c?.name ?? []).map((d) => d[0]).join('');
    if (n) return n;
  }
  return (b.properties?.title ?? []).map((d) => d[0]).join('') || t('lp.import.untitled', 'Untitled');
}

function ResultIcon({ id }: { id: string }) {
  const b = records.get('block', id) as { type?: string; format?: { page_icon?: string } } | undefined;
  const emoji = b?.format?.page_icon;
  if (emoji && !emoji.startsWith('/') && !emoji.startsWith('http')) return <span className="nc-import-result-emoji">{emoji}</span>;
  return <Icon name={b?.type === 'collection_view_page' ? 'viewTable' : 'fileText'} size={16} style={{ color: 'var(--lp-icon-secondary)' }} />;
}

export function ImportPanel({ onDone, parentPageId, afterBlockId, initialKind }: { onDone?: () => void; parentPageId?: string; afterBlockId?: string; initialKind?: ImportKind }) {
  const [tab, setTab] = useState<'discover' | 'completed'>('discover');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory());
  const input = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState(ANY_ACCEPT);
  const [csvFlow, setCsvFlow] = useState(false);
  const spaceId = useSession((s) => s.spaceId);
  const target: ImportTarget = { parentPageId, afterBlockId };

  useEffect(() => {
    if (tab === 'completed') setHistory(readHistory());
  }, [tab]);

  const finishWith = (entry: HistoryEntry) => {
    setStatus({ state: 'done', entry });
    useUI.getState().toast(t('lp.import.imported_count_plural_one_other', 'Imported {count, plural, one {# page} other {# pages}}', { count: entry.pages + entry.databases }));
  };

  const run = async (files: File[], viaCsvTile = csvFlow) => {
    if (!files.length) return;
    setStatus({ state: 'working', label: t('lp.import.importing', 'Importing…'), progress: 0.05 });
    try {
      const { uploaded, skipped } = await uploadImportFiles(files, (label, progress) => setStatus({ state: 'working', label, progress }));
      if (skipped.length) useUI.getState().toast(t('lp.import.skipped_unsupported_file_s', 'Skipped {count} unsupported file(s)', { count: skipped.length }));
      // CSV / Excel: column mapping step  when a single spreadsheet comes through the CSV tile
      if (viaCsvTile && uploaded.length === 1 && SHEET.test(uploaded[0].name)) {
        const preview = await api<CsvPreview>('previewCsv', { spaceId, url: uploaded[0].url, name: uploaded[0].name });
        setStatus({ state: 'mapping', preview, file: uploaded[0] });
        return;
      }
      setStatus({ state: 'working', label: t('lp.import.importing', 'Importing…'), progress: 0.85 });
      finishWith(await importUploaded(uploaded, target));
    } catch (e) {
      setStatus({ state: 'error', message: (e as Error).message });
    }
  };

  const importMapped = async (file: Uploaded, csvTypes: Record<number, string>) => {
    setStatus({ state: 'working', label: t('lp.import.importing', 'Importing…'), progress: 0.85 });
    try {
      finishWith(await importUploaded([file], target, csvTypes));
    } catch (e) {
      setStatus({ state: 'error', message: (e as Error).message });
    }
  };

  const pick = (src?: Source) => {
    setCsvFlow(src?.kind === 'csv');
    setAccept(src?.accept ?? ANY_ACCEPT);
    setTimeout(() => input.current?.click(), 0);
  };

  // slash /import /csv /pdf … and page ••• › Import open the modal with a source preselected
  useEffect(() => {
    if (!initialKind) return;
    const all = [...FILE_SOURCES(), ...THIRD_PARTY()];
    const src = all.find((x) => x.id === initialKind) ?? (initialKind === 'zip' ? { id: 'zip', title: 'ZIP', caption: '', icon: 'fileZip', kind: 'any' as SourceKind, accept: '.zip,application/zip' } : undefined);
    if (src) pick(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKind]);

  const card = (s: Source, tall: boolean) => (
    <div key={s.id} role="button" className={`nc-import-card ${tall ? 'tall' : ''}`} aria-haspopup={s.id === 'asana' || s.id === 'jira' ? 'dialog' : undefined} onClick={() => pick(s)} data-source={s.id}>
      <div className="nc-import-card-top">
        <span className="nc-import-card-icon"><Icon name={s.icon} size={20} /></span>
        <div className="nc-import-card-title">{s.title}</div>
      </div>
      <div className="nc-import-card-caption">{s.caption}</div>
    </div>
  );

  return (
    <section className="nc-import" data-testid="import-panel">
      <div role="tablist" aria-label={t('lp.import.imports', 'Imports')} className="nc-import-tabs">
        <div role="tab" aria-selected={tab === 'discover'} className={`nc-import-pill ${tab === 'discover' ? 'selected' : ''}`} onClick={() => setTab('discover')}>{t('lp.import.discover', 'Discover')}</div>
        <div role="tab" aria-selected={tab === 'completed'} className={`nc-import-pill ${tab === 'completed' ? 'selected' : ''}`} onClick={() => setTab('completed')}>{t('lp.import.completed', 'Completed')}</div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        style={{ display: 'none' }}
        data-testid="import-file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void run(files);
        }}
      />
      {tab === 'discover' ? (
        <div role="tabpanel" className="nc-import-body">
          <div className="nc-import-group">
            <div className="nc-import-head">
              <div className="nc-import-h">{t('lp.import.import_content', 'Import content')}</div>
              <div className="nc-import-sub">{t('lp.import.every_file_inside_an_imported_zip', 'Every file inside an imported ZIP becomes a separate page')}</div>
            </div>
            <div
              className={`nc-import-drop ${dragOver ? 'over' : ''} ${status.state}`}
              data-state={status.state}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = [...e.dataTransfer.files];
                void run(dropped, dropped.length === 1 && SHEET.test(dropped[0].name));
              }}
            >
              {status.state === 'mapping' ? (
                <CsvMapping preview={status.preview} fileName={status.file.name} onCancel={() => setStatus({ state: 'idle' })} onImport={(types) => void importMapped(status.file, types)} />
              ) : status.state === 'working' ? (
                <>
                  <Icon name="loader" size={24} className="nc-import-spin" style={{ color: 'var(--lp-blue-icon-accent)' }} />
                  <div className="nc-import-drop-title">{status.label}</div>
                  <div className="nc-import-progress"><div style={{ width: `${Math.round(status.progress * 100)}%` }} /></div>
                </>
              ) : status.state === 'done' ? (
                <>
                  <Icon name="circleCheck" size={24} style={{ color: 'var(--lp-green-icon-accent)' }} />
                  <div className="nc-import-drop-title">{t('lp.import.import_complete', 'Import complete')}</div>
                  <div className="nc-import-results">
                    {status.entry.pageIds.map((id) => (
                      <div
                        key={id}
                        role="button"
                        className="nc-import-result"
                        onClick={() => {
                          onDone?.();
                          openPage(id);
                        }}
                      >
                        <ResultIcon id={id} />
                        <span className="nc-ellipsis">{pageTitleOf(id)}</span>
                      </div>
                    ))}
                  </div>
                  <div role="button" className="nc-import-link" onClick={() => setStatus({ state: 'idle' })}>{t('lp.import.import_more_files', 'Import more files')}</div>
                </>
              ) : (
                <>
                  <Icon name="cloudArrowUp" size={24} style={{ color: 'var(--lp-blue-icon-tertiary)', marginBottom: 8 }} />
                  <div className="nc-import-drop-title">{t('lp.import.import_content_into_litpage', 'Import content into Litpage')}</div>
                  <div className="nc-import-drop-line">
                    <span>{t('lp.import.drop_html_markdown_text_pdf_csv', 'Drop HTML, markdown, text, PDF, CSV, or ZIP files here, or')}</span>
                    <span role="button" className="nc-import-choose" onClick={() => pick()}>{t('lp.import.select_a_file', 'select a file')}</span>
                  </div>
                  <div className="nc-import-drop-note">{t('lp.import.zip_files_must_be_5gb_or', 'ZIP files must be 5GB or smaller')}</div>
                  {status.state === 'error' && (
                    <div className="nc-import-error"><Icon name="circleAlert" size={14} />{status.message}</div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="nc-import-group">
            <div className="nc-import-head">
              <div className="nc-import-h">{t('lp.import.import_from_files', 'Import from files')}</div>
              <div className="nc-import-sub">{t('lp.import.turn_epub_html_markdown_text_pdf', 'Turn EPUB, HTML, markdown, text, PDF, CSV, or DOCX files into pages')}</div>
            </div>
            <div className="nc-import-grid">{FILE_SOURCES().map((s) => card(s, true))}</div>
          </div>
          <div className="nc-import-group">
            <div className="nc-import-head">
              <div className="nc-import-h">{t('lp.import.third_party_app_imports', 'Third-party app imports')}</div>
              <div className="nc-import-sub">{t('lp.import.bring_in_content_from_other_tools', 'Bring in content from other tools')}</div>
            </div>
            <div className="nc-import-grid">{THIRD_PARTY().map((s) => card(s, false))}</div>
          </div>
        </div>
      ) : (
        <div role="tabpanel" className="nc-import-body">
          {history.filter((h) => h.spaceId === spaceId).length === 0 ? (
            <div className="nc-import-empty">{t('lp.import.imports_you_complete_will_appear_here', 'Imports you complete will appear here.')}</div>
          ) : (
            <div className="nc-import-history">
              {history.filter((h) => h.spaceId === spaceId).map((h) => (
                <div key={h.time} className="nc-import-history-row">
                  <Icon name="circleCheck" size={18} style={{ color: 'var(--lp-green-icon-accent)' }} />
                  <div className="nc-import-history-main">
                    <div className="nc-import-history-title nc-ellipsis">{h.files.join(', ')}</div>
                    <div className="nc-import-history-sub">
                      {new Date(h.time).toLocaleString()} · {t('lp.import.count_plural_one_other', '{count, plural, one {# imported item} other {# imported items}}', { count: h.pages + h.databases })}
                    </div>
                  </div>
                  {h.pageIds[0] && records.get('block', h.pageIds[0]) && (
                    <div
                      role="button"
                      className="nc-btn outline"
                      onClick={() => {
                        onDone?.();
                        openPage(h.pageIds[0]);
                      }}
                    >
                      {t('lp.import.open', 'Open')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
