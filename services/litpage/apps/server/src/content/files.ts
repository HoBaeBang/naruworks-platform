// Stored files (same storage as POST /api/upload): DATA_DIR/files/<id> + a row in the `files` table, served at
// /files/<id>/<name> by app.ts (fileResponse). Uploads are capability URLs (random ids) that render inline only for
// passive types; anything a browser could execute (HTML, SVG, XML, scripts, unknown types) is served as a sandboxed
// download. Export results are `private`: only the user who exported can fetch them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '@nc/shared/ids.ts';
import { DATA_DIR, db } from '../db.ts';

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

// Owner-only files (exports) and server-rendered HTML that may be shown inline in a sandbox (PDF print view).
try {
  db.exec('ALTER TABLE files ADD COLUMN private INTEGER NOT NULL DEFAULT 0');
} catch {
  /* column exists */
}
try {
  db.exec('ALTER TABLE files ADD COLUMN render INTEGER NOT NULL DEFAULT 0');
} catch {
  /* column exists */
}

const MIME: Record<string, string> = {
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', zip: 'application/zip', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
};

export function mimeFor(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** File name safe to store and to put in a header: no path separators, control characters or quotes. */
export function cleanFileName(name: unknown): string {
  // eslint-disable-next-line no-control-regex
  const s = String(name ?? '').replace(/[\\/\u0000-\u001f\u007f"<>]/g, '_').replace(/^\.+/, '_').trim().slice(0, 200);
  return s || 'file';
}

/** `type/subtype` (lower case, no parameters) or octet-stream. */
export function cleanMime(mime: unknown): string {
  const m = String(mime ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(m) ? m : 'application/octet-stream';
}

export function storeFile(
  name: string, data: Buffer | string, userId: string, spaceId: string | null, mime?: string,
  opts: { private?: boolean; render?: boolean } = {},
): StoredFile {
  const id = newId();
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const clean = cleanFileName(name);
  const path = join(DATA_DIR, 'files', id);
  writeFileSync(path, buf);
  const type = mime ?? mimeFor(clean);
  db.prepare('INSERT INTO files (id, space_id, user_id, name, mime, size, path, created_time, private, render) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, spaceId, userId, clean, type, buf.length, path, Date.now(), opts.private ? 1 : 0, opts.render ? 1 : 0);
  return { id, name: clean, mime: type, size: buf.length, url: `/files/${id}/${encodeURIComponent(clean)}` };
}

export interface FileRow {
  id: string;
  space_id: string | null;
  user_id: string | null;
  name: string;
  mime: string;
  size: number;
  path: string;
  private?: number;
  render?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fileRow(id: string): FileRow | undefined {
  if (!UUID.test(id)) return undefined;
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
  // content always lives at DATA_DIR/files/<id>; the stored path column is never trusted
  return row ? { ...row, path: join(DATA_DIR, 'files', row.id) } : undefined;
}

export function fileIdFromUrl(url: string): string | null {
  const m = /\/files\/([0-9a-f-]{36})(?:\/|$)/i.exec(url);
  return m ? m[1] : null;
}

/** Read an uploaded file by its /files URL (or id). `userId` must be the uploader unless `anyUser` (private files: always the owner). */
export function readStoredFile(urlOrId: string, userId: string | null, opts?: { anyUser?: boolean }): { name: string; mime: string; data: Buffer } | null {
  const id = fileIdFromUrl(urlOrId) ?? (UUID.test(urlOrId) ? urlOrId : null);
  if (!id) return null;
  const row = fileRow(id);
  if (!row || !existsSync(row.path)) return null;
  if (row.private && row.user_id !== userId) return null;
  if (!opts?.anyUser && row.user_id && row.user_id !== userId) return null;
  return { name: row.name, mime: row.mime, data: readFileSync(row.path) };
}

// Types a browser displays without running code: served inline. Everything else is an attachment.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain|text\/csv|text\/markdown|font\/[\w.+-]+)$/;

/** Response headers for a stored file (see module comment). */
export function fileHeaders(row: FileRow, download = false): Record<string, string> {
  const mime = cleanMime(row.mime);
  const ascii = row.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const disposition = (kind: string) => `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.name)}`;
  const base: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': row.private ? 'private, no-store' : 'private, max-age=31536000, immutable',
  };
  if (row.render && mime === 'text/html' && !download) {
    // server-rendered export (PDF print view): shown inline, but in an opaque-origin sandbox (no cookies / app access)
    return {
      ...base, 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': disposition('inline'),
      'Content-Security-Policy': "sandbox allow-scripts allow-modals allow-popups; default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src * data:",
    };
  }
  if (!download && INLINE.test(mime)) {
    const text = mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime;
    return {
      ...base, 'Content-Type': text, 'Content-Disposition': disposition('inline'),
      ...(mime === 'application/pdf' ? {} : { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'" }),
    };
  }
  // SVG keeps its type so <img> can display it; as a document it is a sandboxed download
  return {
    ...base, 'Content-Type': mime === 'image/svg+xml' ? 'image/svg+xml' : 'application/octet-stream', 'Content-Disposition': disposition('attachment'),
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
  };
}
