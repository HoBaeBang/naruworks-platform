// Export dialog (•••  → More → Export).
// Submits to api('startPageExport') (shell's export endpoint) and falls back to the client exporter.
// PDF › Include subpages is a Business/Enterprise feature: other plans see the switch disabled with an upgrade
// tooltip. "Current view" exports follow the view each database shows on this device.
import { useState } from 'react';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { getBlock } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { exportPage, type ExportFormat, type ExportOptions } from './exportPage.ts';
import './pageIcons.tsx';
import './dialogs.css';

const FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: t('lp.page.pdf', 'PDF'),
  html: t('lp.page.html', 'HTML'),
  markdown: t('lp.page.markdown_csv', 'Markdown & CSV'),
};

export function openExportDialog(pageId: string) {
  // the dialog is centered on both axes, over a dimmed backdrop
  openOverlay((close) => <ExportDialog pageId={pageId} close={close} />, { placement: 'middle', backdrop: 'dim' });
}

const LAST = 'nc:exportOptions';

function ExportDialog({ pageId, close }: { pageId: string; close: () => void }) {
  const [opts, setOpts] = useState<ExportOptions>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LAST) ?? 'null');
      if (v?.format) return { ...v, includeSubpages: false };
    } catch {
      /* ignore */
    }
    return { format: 'markdown', includeContents: 'everything', includeSubpages: false, createFolders: true, databaseView: 'currentView', includeComments: false, pageFormat: 'A4', scale: 100 };
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const page = getBlock(pageId) as BlockRecord | undefined;
  const plan = records.get<SpaceRecord>('space', page?.space_id)?.plan_type ?? 'plus';
  const pdfSubpagesLocked = opts.format === 'pdf' && plan !== 'business' && plan !== 'enterprise';
  const set = (p: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...p }));
  // picking an option closes only this menu (Menu closes every overlay unless onSelect returns false)
  const select = (anchor: HTMLElement, items: [string, string][], cur: string, onPick: (v: string) => void) => {
    const closeMenu = openMenu(anchor, { width: 220, sections: [{ items: items.map(([v, label]) => ({ label, checked: v === cur, onSelect: () => { onPick(v); closeMenu(); return false; } })) }] }, { placement: 'bottom-end' });
  };
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      localStorage.setItem(LAST, JSON.stringify(opts));
    } catch {
      /* ignore */
    }
    try {
      const name = await exportPage(pageId, pdfSubpagesLocked ? { ...opts, includeSubpages: false } : opts);
      close();
      if (opts.format !== 'pdf') useUI.getState().toast(name ? `Exported ${name}` : 'Export complete');
    } catch (e: any) {
      setErr(e?.message ?? 'Export failed');
      setBusy(false);
    }
  };
  return (
    <div className="nc-export-dialog" role="dialog" aria-label={t('lp.page.export', 'Export')} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit(); }}>
      <div className="rows">
        <Row label={t('lp.page.export_format', 'Export format')}>
          <SelectBtn label={FORMAT_LABEL[opts.format]} onClick={(el) => select(el, [['pdf', FORMAT_LABEL.pdf], ['html', FORMAT_LABEL.html], ['markdown', FORMAT_LABEL.markdown]], opts.format, (v) => set({ format: v as ExportFormat }))} />
        </Row>
        {opts.format === 'pdf' && (
          <>
            <Row label={t('lp.page.page_format', 'Page format')}>
              <SelectBtn label={opts.pageFormat ?? 'A4'} onClick={(el) => select(el, ['A4', 'A3', 'Letter', 'Legal', 'Tabloid'].map((v) => [v, t(`exportModal.pageFormatButton.${v.toLowerCase()}.label`, v)] as [string, string]), opts.pageFormat ?? 'A4', (v) => set({ pageFormat: v as any }))} />
            </Row>
            <Row label={t('lp.page.scale_percent', 'Scale percent')}>
              <input className="nc-export-scale" type="number" min={10} max={200} value={opts.scale ?? 100} onChange={(e) => set({ scale: Math.max(10, Math.min(200, Number(e.target.value) || 100)) })} />
            </Row>
          </>
        )}
        <Row label={t('lp.page.database_views', 'Database views')}>
          <SelectBtn
            label={opts.databaseView === 'currentView' ? t('lp.page.current_view', 'Current view') : t('lp.page.default_view', 'Default view')}
            onClick={(el) => select(el, [['currentView', t('lp.page.current_view', 'Current view')], ['defaultView', t('lp.page.default_view', 'Default view')]], opts.databaseView, (v) => set({ databaseView: v as any }))}
          />
        </Row>
        <Row label={t('lp.page.page_content', 'Page content')}>
          <SelectBtn
            label={opts.includeContents === 'everything' ? t('lp.page.everything', 'Everything') : t('lp.page.no_files_or_images', 'No files or images')}
            onClick={(el) => select(el, [['everything', t('lp.page.everything', 'Everything')], ['no_files', t('lp.page.no_files_or_images', 'No files or images')]], opts.includeContents, (v) => set({ includeContents: v as any }))}
          />
        </Row>
        <Row kind="switch" label={t('lp.page.include_subpages', 'Include subpages')}
          tooltip={pdfSubpagesLocked ? t('lp.page.include_subpages_in_pdf_exports_with', 'Include subpages in PDF exports with an upgrade') : undefined}
          tooltipSub={pdfSubpagesLocked ? t('lp.page.creates_a_zip_containing_every_nested', 'Creates a ZIP containing every nested subpage as a PDF.') : undefined}>
          <Toggle on={opts.includeSubpages && !pdfSubpagesLocked} disabled={pdfSubpagesLocked} onChange={(v) => set({ includeSubpages: v })} label={t('lp.page.include_subpages', 'Include subpages')} />
        </Row>
        {opts.format !== 'pdf' && (
          <Row kind="switch" label={t('lp.page.put_subpages_in_their_own_folders', 'Put subpages in their own folders')}>
            <Toggle on={opts.createFolders} disabled={!opts.includeSubpages} onChange={(v) => set({ createFolders: v })} label={t('lp.page.put_subpages_in_their_own_folders', 'Put subpages in their own folders')} />
          </Row>
        )}
        {opts.format === 'html' && (
          <Row kind="switch" label={t('lp.page.export_comments', 'Export comments')}>
            <Toggle on={!!opts.includeComments} onChange={(v) => set({ includeComments: v })} label={t('lp.page.export_comments', 'Export comments')} />
          </Row>
        )}
      </div>
      {err && <div className="progress" style={{ color: 'var(--lp-red-text-primary)' }}>{err}</div>}
      {busy && <div className="progress" role="status">{t('lp.page.exporting', 'Exporting…')}</div>}
      {/* footer: 28px buttons, gray text "Cancel" (margin-inline auto 8) and blue "Export" */}
      <div className="footer">
        <button type="button" role="button" className="nc-export-btn cancel" onClick={close}>{t('lp.page.cancel', 'Cancel')}</button>
        <button type="button" role="button" aria-disabled={busy || undefined} className="nc-export-btn primary" onClick={() => { if (!busy) void submit(); }}>{t('lp.page.export', 'Export')}</button>
      </div>
    </div>
  );
}

/** Rows: select rows are as tall as their 28px button, switch rows 32px. */
function Row({ label, children, kind = 'select', tooltip, tooltipSub }: { label: string; children: React.ReactNode; kind?: 'select' | 'switch'; tooltip?: string; tooltipSub?: string }) {
  return (
    <div className={`nc-setting-row nc-export-row ${kind}`} data-tooltip={tooltip} data-tooltip-sub={tooltipSub}>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

function SelectBtn({ label, onClick }: { label: string; onClick: (el: HTMLElement) => void }) {
  return (
    <div role="button" className="nc-select-btn" onClick={(e) => onClick(e.currentTarget)}>
      <span>{label}</span>
      <Icon name="chevronDownNarrow" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
    </div>
  );
}

/** Switch: the 26×14 track is drawn by a div; an invisible native checkbox (role=switch)
 *  covers it for clicks/keyboard; disabled = whole control at opacity .4. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <div className={`nc-toggle-wrap ${disabled ? 'disabled' : ''}`}>
      <div className={`nc-toggle ${on ? 'on' : ''}`} aria-hidden />
      <input type="checkbox" role="switch" className="nc-toggle-input" aria-checked={on} aria-label={label} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}
