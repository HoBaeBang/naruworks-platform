// Export (page ••• › Export, Settings › General › Export all workspace content).
//   startPageExport { blockId, format: 'markdown' | 'html' | 'pdf', includeSubpages?, includeFiles?, flatten?, includeComments?,
//                 databaseView?: 'current' | 'default', currentViews?: { [dbBlockId]: viewId }, pageFormat?, scale?, timeZone? }
//     (also accepts the supported shape: { block: { id }, recursive, exportOptions: { exportType, includeContents,
//      flattenExportFiletree, collectionViewExportType: 'currently_selected' | 'all', includeComments, pdfFormat, pdfScale } })
//     → Markdown/HTML: { url, exportURL, filename, fileName, pages, files }  (url = /files/<id>/<name>: .md / .html / .csv or .zip)
//     → PDF: { printUrl, filename, fileName, pages } (print-ready HTML at the chosen paper size / scale that opens the
//       browser's print dialog → "Save as PDF"; Include subpages (Business+) prints every subpage on its own sheets)
//   exportWorkspace { spaceId, format: 'markdown' | 'html' } → { url, filename }
//   exportWorkspace { spaceId, format: 'pdf' } → { printUrl, filename, pages }   (Business/Enterprise: one print
//     document with Private / Workspace / joined teamspaces' pages and their subpages, each on a new sheet)
// Workspace policy (Settings › Security › Disable export, teamspace Disable export) is enforced by policy.ts; guests
// need full access to the page they export .
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, SpaceRecord, SpaceViewRecord, TeamRecord, UserRootRecord } from '@nc/shared/records.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { blockRole } from '../../records.ts';
import { assertWorkspacePolicy, teamOfBlock } from '../../policy.ts';
import { audit } from '../../audit.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';
import { exportPrintBundle, exportTree, safeName, blockTitle, PDF_PAGE_SIZES, type ExportFile, type ExportFormat } from '../../content/render.ts';
import { writeZip } from '../../content/zip.ts';
import { fileIdFromUrl, fileRow, readStoredFile, storeFile } from '../../content/files.ts';
import { pushNotification } from '../../notify.ts';
import { cancelJob, registerJobHandler, scheduleJob } from '../../scheduler.ts';
import { db } from '../../db.ts';
import { rmSync } from 'node:fs';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function normalizeFormat(f: unknown): ExportFormat {
  const s = String(f ?? 'markdown').toLowerCase();
  if (s === 'html' || s === 'pdf') return s;
  return 'markdown';
}

// Exports are private to the exporting user (/files serves them only to that session).
function pack(files: ExportFile[], zipBase: string, uid: string, spaceId: string, forceZip = false) {
  if (files.length === 1 && !forceZip) {
    const f = files[0];
    const name = f.path.split('/').pop()!;
    return storeFile(name, f.data, uid, spaceId, undefined, { private: true });
  }
  const zip = writeZip(files.map((f) => ({ name: zipEntryName(f.path), data: f.data })));
  return storeFile(`${zipBase}.zip`, zip, uid, spaceId, 'application/zip', { private: true });
}

/** Archive paths never climb out of the extraction folder (zip-slip for whoever unpacks the export). */
function zipEntryName(path: string): string {
  return path.split('/').filter((p) => p && p !== '.' && p !== '..').join('/') || 'Untitled';
}

/** Settings › Security › Disable export (+ teamspace setting); guests may export only pages they have full access to. */
function exportAllowed(spaceId: string, uid: string, pageId?: string) {
  assertWorkspacePolicy(spaceId, 'export', uid, pageId ? { pageId } : {});
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (pageId && space && !isSpaceMember(space, uid) && blockRole(pageId, uid) !== 'editor') throw new ApiError('Guests need full access to export this page', 403);
}

// Exports walk whole page trees: the service limits them per workspace ("This workspace allows up to N exports every minute").
const EXPORTS_PER_MINUTE = 30;
//  / : big exports (and every workspace export) are delivered to the Inbox — "Your workspace export
// is ready" + Download; the link works for 7 days, then the file is deleted.
const LARGE_EXPORT_BYTES = 50 * 1024 * 1024;
const LARGE_EXPORT_FILES = 2000;
const LINK_DAYS = 7;

registerJobHandler('export_expire', (payload: { fileId?: string }) => {
  const row = payload?.fileId ? fileRow(payload.fileId) : undefined;
  if (!row) return;
  db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
  try {
    rmSync(row.path, { force: true });
  } catch {
    /* already gone */
  }
});

function deliverToInbox(uid: string, spaceId: string, stored: { url: string; name: string; size: number }, kind: 'workspace' | 'page', pageId?: string) {
  const expires = Date.now() + LINK_DAYS * 86400_000;
  const fileId = fileIdFromUrl(stored.url);
  if (fileId) {
    cancelJob(`export-expire:${fileId}`);
    scheduleJob('export_expire', `export-expire:${fileId}`, expires, { fileId });
  }
  pushNotification({
    user_id: uid, space_id: spaceId, type: 'export_completed', navigable_block_id: pageId,
    activity: { kind, url: stored.url, filename: stored.name, size: stored.size, expires },
  });
}

function exportRateLimit(spaceId: string, uid: string) {
  if (!hit(`export:user:${uid}`, EXPORTS_PER_MINUTE, 60_000) || !hit(`export:space:${spaceId}`, EXPORTS_PER_MINUTE * 3, 60_000)) {
    const retry = new Date(Date.now() + 60_000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    throw new RateLimitError(`This workspace allows up to ${EXPORTS_PER_MINUTE} exports every minute. Try again after ${retry}. The limit is shared by everyone in the workspace.`);
  }
}

const DB_VIEW = (v: unknown): 'current' | 'default' => (v === 'all' || v === 'default' || v === 'defaultView' ? 'default' : 'current');

/** `currentViews` from the client: { [database block id]: view id } (validated against each block's views later). */
function cleanViews(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, id] of Object.entries(v as Record<string, unknown>)) {
    if (n++ >= 500) break;
    if (typeof id === 'string' && /^[\w-]{1,64}$/.test(k) && /^[\w-]{1,64}$/.test(id)) out[k] = id;
  }
  return out;
}

const validTimeZone = (tz: unknown): string | undefined => {
  if (typeof tz !== 'string' || tz.length > 64) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
};

export const handlers: Record<string, Handler> = {
  startPageExport(ctx, body) {
    const uid = requireUser(ctx);
    const opts = body?.exportOptions ?? {};
    const blockId = body?.blockId ?? body?.block?.id;
    const format = body?.format ?? opts.exportType;
    const includeSubpages = body?.includeSubpages ?? body?.recursive;
    const includeFiles = body?.includeFiles ?? (opts.includeContents ? opts.includeContents !== 'no_files' : false);
    const flatten = !!(body?.flatten ?? opts.flattenExportFiletree);
    const block = getRecord<BlockRecord>('block', String(blockId));
    if (!block || !roleAtLeast(blockRole(block.id, uid), 'reader')) throw new ApiError('Not found', 404);
    exportAllowed(block.space_id, uid, block.id);
    exportRateLimit(block.space_id, uid);
    const fmt = normalizeFormat(format);
    const space = getRecord<SpaceRecord>('space', block.space_id);
    // PDF › Include subpages is a Business/Enterprise feature (other plans show an upgrade tooltip)
    const pdfSubpages = fmt === 'pdf' && !!includeSubpages && (space?.plan_type === 'business' || space?.plan_type === 'enterprise');
    const pageFormat = String(body?.pageFormat ?? opts.pdfFormat ?? 'A4');
    const res = exportTree(block.id, {
      format: fmt,
      includeSubpages: fmt === 'pdf' ? pdfSubpages : !!includeSubpages,
      includeFiles: fmt !== 'pdf' && !!includeFiles,
      includeComments: fmt === 'html' && !!(body?.includeComments ?? opts.includeComments),
      databaseView: DB_VIEW(body?.databaseView ?? opts.collectionViewExportType),
      currentViews: cleanViews(body?.currentViews ?? opts.currentViews),
      pdf: { format: PDF_PAGE_SIZES[pageFormat] ? pageFormat : 'A4', scale: Number(body?.scale ?? opts.pdfScale) || 100 },
      timeZone: validTimeZone(body?.timeZone ?? opts.timeZone),
      userId: uid,
      canRead: (id) => roleAtLeast(blockRole(id, uid), 'reader'),
      readUpload: (url) => {
        const f = readStoredFile(url, uid, { anyUser: true });
        return f ? { name: f.name, data: f.data } : null;
      },
    });
    if (!res || !res.files.length) throw new ApiError('Nothing to export', 400);
    const base = safeName(blockTitle(block));
    // Settings › Audit log: "Exported {pageName}"
    audit('page_exported', { spaceId: block.space_id, actorId: uid, targetId: block.id, teamId: teamOfBlock(block.id)?.id ?? null, ip: ctx.ip, data: { pageName: blockTitle(block), format: fmt, includeSubpages: !!includeSubpages } });
    const pages = res.files.filter((f) => /\.(md|html|csv)$/.test(f.path)).length;
    if (fmt === 'pdf') {
      const root = res.files.find((f) => f.path === res.rootPath) ?? res.files[0];
      // print view: shown inline, but sandboxed (opaque origin) and only to the exporting user
      const stored = storeFile(`${base}.html`, root.data, uid, block.space_id, 'text/html; charset=utf-8', { private: true, render: true });
      return { printUrl: stored.url, filename: `${base}.pdf`, fileName: `${base}.pdf`, pages: Math.max(1, (String(root.data).match(/<article /g) ?? []).length) };
    }
    let files = res.files;
    if (flatten) {
      const used = new Set<string>();
      files = files.map((f) => {
        let name = f.path.split('/').pop()!;
        while (used.has(name)) name = name.replace(/(\.[^.]+)?$/, ' (1)$1');
        used.add(name);
        return { ...f, path: name };
      });
    }
    const stored = pack(files, base, uid, block.space_id, !!includeFiles && files.length > 1);
    // very large exports: no instant download, the Inbox gets the link (the service emails it)
    if (stored.size > LARGE_EXPORT_BYTES || files.length > LARGE_EXPORT_FILES) {
      deliverToInbox(uid, block.space_id, stored, 'page', block.id);
      return { deferred: true, message: 'This export is still processing because of its size. We’ll email you a download link when it is ready.', pages, files: files.length };
    }
    return { url: stored.url, exportURL: stored.url, filename: stored.name, fileName: stored.name, pages, files: files.length };
  },

  exportWorkspace(ctx, { spaceId, format, pageFormat, scale }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId));
    if (!space || !space.permissions?.some((p) => p.type === 'user_permission' && p.user_id === uid && p.role !== 'none')) throw new ApiError('Not a member of this workspace', 403);
    exportAllowed(space.id, uid);
    const wantPdf = normalizeFormat(format) === 'pdf';
    if (wantPdf && space.plan_type !== 'business' && space.plan_type !== 'enterprise') throw new ApiError('Upgrade to the Business plan to export your workspace as PDF', 403);
    exportRateLimit(space.id, uid);
    const fmt = normalizeFormat(format) === 'html' ? 'html' : 'markdown';
    // Settings › Audit log: "Exported all workspace content"
    audit('workspace_exported', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { format: wantPdf ? 'pdf' : fmt } });
    const root = getRecord<UserRootRecord>('user_root', uid);
    const sv = (root?.space_views ?? []).map((id) => getRecord<SpaceViewRecord>('space_view', id)).find((v) => v?.space_id === space.id && v.parent_id === uid);
    const teams = (sv?.joined_teams ?? []).map((id) => getRecord<TeamRecord>('team', id)).filter((t): t is TeamRecord => !!t && t.alive !== false);
    const tops: { dir: string; ids: string[] }[] = [
      { dir: 'Private/', ids: sv?.private_pages ?? [] },
      { dir: 'Workspace/', ids: space.pages ?? [] },
      ...teams.map((t) => ({ dir: `Teamspaces/${safeName(t.name)}/`, ids: t.team_pages ?? [] })),
    ];
    const files: ExportFile[] = [];
    const canRead = (id: string) => roleAtLeast(blockRole(id, uid), 'reader');
    const stamp = new Date().toISOString().slice(0, 10);
    if (wantPdf) {
      const pf = String(pageFormat ?? 'A4');
      let bundle: ReturnType<typeof exportPrintBundle> = null;
      try {
        bundle = exportPrintBundle(tops.flatMap((g) => g.ids), {
          format: 'pdf', includeSubpages: true, includeFiles: false, canRead, userId: uid,
          pdf: { format: PDF_PAGE_SIZES[pf] ? pf : 'A4', scale: Number(scale) || 100 },
          readUpload: () => null,
        }, space.name || 'Workspace');
      } catch (e) {
        if ((e as Error).message === 'too_large') throw new ApiError('This workspace is too large to export as one PDF. Export it as HTML or Markdown & CSV instead.', 400);
        throw e;
      }
      if (!bundle) throw new ApiError('Nothing to export', 400);
      const base = `Export-${safeName(space.name)}-${stamp}`;
      const stored = storeFile(`${base}.html`, Buffer.from(bundle.html), uid, space.id, 'text/html; charset=utf-8', { private: true, render: true });
      return { printUrl: stored.url, filename: `${base}.pdf`, fileName: `${base}.pdf`, pages: bundle.pages };
    }
    for (const group of tops) {
      for (const id of group.ids) {
        const b = getRecord<BlockRecord>('block', id);
        if (!b || !b.alive || !canRead(id)) continue;
        const res = exportTree(id, {
          format: fmt, includeSubpages: true, includeFiles: true, canRead, userId: uid,
          readUpload: (url) => {
            const f = readStoredFile(url, uid, { anyUser: true });
            return f ? { name: f.name, data: f.data } : null;
          },
        });
        for (const f of res?.files ?? []) files.push({ path: group.dir + f.path, data: f.data });
      }
    }
    if (!files.length) throw new ApiError('Nothing to export', 400);
    const stored = pack(files, `Export-${safeName(space.name)}-${stamp}`, uid, space.id, true);
    // the Inbox keeps the link too ("Your workspace export is ready", valid for 7 days)
    deliverToInbox(uid, space.id, stored, 'workspace');
    return { url: stored.url, exportURL: stored.url, filename: stored.name, fileName: stored.name };
  },
};
