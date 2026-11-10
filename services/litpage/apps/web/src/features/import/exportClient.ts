// Export client helpers (used by the page ••• › Export dialog and Settings › General).
//   startPageExport(blockId, { format: 'markdown' | 'html' | 'pdf', includeSubpages?, includeFiles?, flatten? })
//     Markdown & CSV / HTML → downloads /files/<id>/<name> (.md/.html/.csv, or .zip with sub-pages, databases as CSV)
//     PDF → opens a print-ready page that triggers the browser's print dialog ("Save as PDF")
//   exportWorkspace(spaceId, 'markdown' | 'html') → downloads a .zip of every top-level page you can access
import { api } from '../../lib/api.ts';

export type ExportFormat = 'markdown' | 'html' | 'pdf';

export interface ExportResult {
  url?: string;
  exportURL?: string;
  printUrl?: string;
  filename: string;
  fileName: string;
}

function download(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function startPageExport(blockId: string, opts: { format: ExportFormat; includeSubpages?: boolean; includeFiles?: boolean; flatten?: boolean }): Promise<ExportResult> {
  const res = await api<ExportResult>('startPageExport', { blockId, format: opts.format, includeSubpages: !!opts.includeSubpages, includeFiles: !!opts.includeFiles, flatten: !!opts.flatten });
  if (opts.format === 'pdf' && res.printUrl) window.open(res.printUrl, '_blank', 'noopener');
  else if (res.url) download(res.url, res.filename);
  return res;
}

export async function exportWorkspace(spaceId: string, format: 'markdown' | 'html' = 'markdown'): Promise<ExportResult> {
  const res = await api<ExportResult>('exportWorkspace', { spaceId, format });
  if (res.url) download(res.url, res.filename);
  return res;
}
