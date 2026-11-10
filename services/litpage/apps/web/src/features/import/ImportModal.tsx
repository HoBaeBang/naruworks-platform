import { HELP_URL } from '@nc/shared/brand.ts';
// Import modal (useUI importOpen — page ••• › Import, slash /import /csv /pdf …, sidebar/templates "Import"): the
// Settings › Import screen (header 26px/600 + 16px subtitle with "Learn more") in a dialog. From a page you can edit,
// imports land inside it — after the block the slash command was typed in.
// The editor dispatches `nc:open-import` {kind, pageId, blockId}; this module takes it over (detail.handled = true) and
// opens the modal with that source's file chooser.
import { create } from 'zustand';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { Modal } from '../../components/Modal.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useUI } from '../../lib/store/ui.ts';
import { records } from '../../lib/store/records.ts';
import { getLocation } from '../../lib/router.ts';
import { t } from '../shell/i18n.ts';
import { ImportPanel, type ImportKind } from './ImportPanel.tsx';
import './import.css';

interface ImportIntent {
  kind?: ImportKind;
  pageId?: string;
  blockId?: string;
  /** bumps for every request so the same kind opens the chooser again */
  seq: number;
}

export const useImportIntent = create<ImportIntent>(() => ({ seq: 0 }));

const KINDS = new Set<ImportKind>(['csv', 'pdf', 'markdown', 'html', 'word', 'zip', 'asana', 'confluence', 'trello', 'workflowy', 'evernote', 'jira', 'monday', 'quip', 'gdocs']);
// slash kinds (editor/slashItems.ts IMPORTS) → tiles; Dropbox Paper documents come in as Word / Markdown downloads
const ALIASES: Record<string, ImportKind> = {
  text: 'markdown', md: 'markdown', txt: 'markdown', docx: 'word', google_docs: 'gdocs', 'google docs': 'gdocs', googledocs: 'gdocs',
  'monday.com': 'monday', dropbox_paper: 'word', excel: 'csv', xlsx: 'csv',
};

/** Open the import modal (optionally for one source, into a page after a block). */
export function openImport(opts: { kind?: string; pageId?: string; blockId?: string } = {}) {
  const raw = String(opts.kind ?? '').toLowerCase();
  const kind = (KINDS.has(raw as ImportKind) ? raw : ALIASES[raw]) as ImportKind | undefined;
  useImportIntent.setState((s) => ({ kind, pageId: opts.pageId, blockId: opts.blockId, seq: s.seq + 1 }));
  useUI.getState().set({ importOpen: true });
}

window.addEventListener('nc:open-import', ((e: CustomEvent) => {
  const d = (e.detail ?? {}) as { kind?: string; pageId?: string; blockId?: string; handled?: boolean };
  d.handled = true;
  openImport(d);
}) as EventListener);

export function ImportModal() {
  const intent = useImportIntent();
  const close = () => {
    useUI.getState().set({ importOpen: false });
    useImportIntent.setState({ kind: undefined, pageId: undefined, blockId: undefined });
  };
  const { route } = getLocation();
  const candidate = intent.pageId ?? (route.name === 'page' ? route.pageId : undefined);
  const pageId = candidate && roleAtLeast(records.role('block', candidate), 'read_and_write') ? candidate : undefined;
  return (
    <Modal open onClose={close} width="min(1000px, calc(100vw - 48px))" height="min(753px, calc(100vh - 72px))" top="max(36px, 6vh)" className="nc-import-modal">
      <div className="nc-import-modal-scroll lit-scroller vertical">
        <div role="button" className="nc-btn icon-only nc-import-modal-close" aria-label={t('lp.import.close', 'Close')} onClick={close}>
          <Icon name="close" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
        <div className="nc-import-modal-inner">
          <header className="nc-import-modal-header">
            <div className="nc-import-modal-title">{t('lp.import.import', 'Import')}</div>
            <div className="nc-import-modal-sub">
              <span>{t('lp.import.pull_files_and_content_from_other', 'Pull files and content from other tools into Litpage')}</span>
              {HELP_URL && (<a href={HELP_URL} target="_blank" rel="noreferrer">{t('lp.import.learn_more', 'Learn more')}</a>)}
            </div>
          </header>
          <ImportPanel key={intent.seq} parentPageId={pageId} afterBlockId={pageId && intent.pageId === pageId ? intent.blockId : undefined} initialKind={intent.kind} onDone={close} />
        </div>
      </div>
    </Modal>
  );
}
