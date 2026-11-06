// Chat attachments (+ → "Add photos & files"): files uploaded through POST /api/upload by the chatting user are
// attached to a user turn. Images become image content blocks, PDFs document blocks (both re-read from storage
// when a later turn replays the conversation, so the stored transcript stays small), and text-like files
// (txt / Markdown / CSV / JSON / code) are inlined as text — their text is stored with the turn.
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { fileIdFromUrl, fileRow, readStoredFile } from '../content/files.ts';
import { AiError } from './client.ts';
import type { FileResolver, StoredContext } from './prompts.ts';

export const MAX_ATTACHMENTS = 5;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 150_000;
/** total binary payload per turn (the API's request limit is 32 MB including base64 overhead) */
const MAX_TURN_BYTES = 22 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|cs|php|sh|sql|log|ini|toml|css)$/i;

export type AttachmentKind = 'image' | 'pdf' | 'text';

export function attachmentKind(name: string, mime: string): AttachmentKind | null {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (IMAGE_TYPES.has(m) || /\.(png|jpe?g|gif|webp)$/i.test(name)) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml' || TEXT_EXT.test(name)) return 'text';
  return null;
}

function mediaTypeOf(name: string, mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (IMAGE_TYPES.has(m)) return m;
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.gif$/i.test(name)) return 'image/gif';
  return 'image/webp';
}

function decode(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

/** Validate the user's uploads and snapshot them as turn contexts (throws a user-facing AiError). */
export function prepareAttachments(userId: string, items: unknown): StoredContext[] {
  const list = Array.isArray(items) ? items.slice(0, MAX_ATTACHMENTS + 1) : [];
  if (list.length > MAX_ATTACHMENTS) throw new AiError('bad_request', `You can attach up to ${MAX_ATTACHMENTS} files to a message.`, 400);
  const out: StoredContext[] = [];
  let total = 0;
  for (const it of list) {
    const ref = String((it as any)?.url ?? (it as any)?.id ?? '');
    const file = readStoredFile(ref, userId);
    if (!file) throw new AiError('not_found', 'An attached file is no longer available. Remove it and try again.', 404);
    const id = fileIdFromUrl(ref) ?? ref;
    const name = String((it as any)?.name ?? file.name).slice(0, 200) || file.name;
    const kind = attachmentKind(name, file.mime);
    if (!kind) throw new AiError('bad_request', `“${name}” isn’t a supported file type. Attach images, PDFs, or text, Markdown, CSV and JSON files.`, 400);
    const size = file.data.length;
    if (kind === 'image' && size > MAX_IMAGE_BYTES) throw new AiError('bad_request', `“${name}” is larger than 5 MB.`, 400);
    if (kind === 'pdf' && size > MAX_PDF_BYTES) throw new AiError('bad_request', `“${name}” is larger than 20 MB.`, 400);
    if (kind === 'text' && size > MAX_TEXT_BYTES) throw new AiError('bad_request', `“${name}” is larger than 2 MB.`, 400);
    if (kind !== 'text') total += size;
    if (total > MAX_TURN_BYTES) throw new AiError('bad_request', 'The attached files are too large for one message. Attach fewer or smaller files.', 400);
    if (kind === 'text') {
      const text = decode(file.data);
      out.push({ kind: 'file', pageId: id, title: name, markdown: text.slice(0, MAX_TEXT_CHARS) || '(empty file)', truncated: text.length > MAX_TEXT_CHARS, mime: file.mime || 'text/plain', size });
    } else {
      out.push({ kind: 'file', pageId: id, title: name, markdown: '', truncated: false, mime: kind === 'pdf' ? 'application/pdf' : mediaTypeOf(name, file.mime), size });
    }
  }
  return out;
}

/** Re-reads binary attachments for a request (only the owner's uploads resolve). */
export function fileResolver(userId: string): FileResolver {
  return (c: StoredContext): BetaContentBlockParam | null => {
    const row = fileRow(c.pageId);
    if (!row) return null;
    const file = readStoredFile(c.pageId, userId);
    if (!file) return null;
    const data = file.data.toString('base64');
    if (c.mime === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: c.title } as BetaContentBlockParam;
    }
    return { type: 'image', source: { type: 'base64', media_type: (c.mime ?? 'image/png') as 'image/png', data } } as BetaContentBlockParam;
  };
}
