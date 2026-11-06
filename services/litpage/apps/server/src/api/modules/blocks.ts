// Block feature endpoints (non-text blocks):
// - saveBookmarkPreview {type:"external-bookmark", block:{id,spaceId}, url}: fetches the page server-side and writes
//   properties.title / description + format.bookmark_icon / bookmark_cover onto the bookmark block. Returns the updated recordMap.
// - resolves a pasted link to an embeddable iframe
//   (known providers or oEmbed discovery). The server answers {type:"embed", empty:true, format:{}, properties:{}} when
//   nothing better is known.
// - getTransclusionReferences {blockId}: synced copies (transclusion_reference blocks) of an original
//   transclusion_container, with the pages they live on (backs "Synced to N other pages").
import { newId } from '@nc/shared/ids.ts';
import { isHttpUrl } from '@nc/shared/url.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord } from '@nc/shared/records.ts';
import type { Operation } from '@nc/shared/ops.ts';
import { db, getRecord } from '../../db.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { FetchBlockedError, safeFetch } from '../../safefetch.ts';
import { hit } from '../../ratelimit.ts';

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 6000;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

/* ------------------------------------------------------------------ safe fetch (SSRF-guarded, see safefetch.ts) */

async function fetchText(raw: string, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'): Promise<{ url: string; text: string; contentType: string }> {
  let res;
  try {
    res = await safeFetch(raw, { accept, maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
  } catch (e) {
    if (e instanceof FetchBlockedError) throw new ApiError(e.message, 400);
    throw e;
  }
  const buf = res.body;
  const contentType = res.contentType;
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'))?.[1] ?? 'utf-8';
  let text: string;
  try {
    text = new TextDecoder(charset.toLowerCase()).decode(buf);
  } catch {
    text = buf.toString('utf8');
  }
  return { url: res.url, text, contentType };
}

/** Per-user budget for server-side fetches (each preview can trigger 2 requests). */
function fetchBudget(uid: string) {
  if (!hit(`unfurl:user:${uid}`, 60, 60_000)) throw new ApiError('Too many link previews. Try again in a minute.', 429);
}

/* ------------------------------------------------------------------ html metadata */

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

export interface PageMeta {
  title?: string;
  description?: string;
  icon?: string;
  image?: string;
  oembed?: string;
}

export function parseMeta(html: string, baseUrl: string): PageMeta {
  const head = html.slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key && a.content != null && !(key in meta)) meta[key] = a.content.trim();
  }
  const links: { rel: string; href: string; type?: string; sizes?: string }[] = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.rel && a.href) links.push({ rel: a.rel.toLowerCase(), href: a.href, type: a.type?.toLowerCase(), sizes: a.sizes });
  }
  const abs = (h?: string) => {
    if (!h) return undefined;
    try {
      return new URL(h, baseUrl).toString();
    } catch {
      return undefined;
    }
  };
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = meta['og:title'] ?? meta['twitter:title'] ?? (titleTag ? decodeEntities(titleTag.replace(/\s+/g, ' ').trim()) : undefined);
  const description = meta['og:description'] ?? meta['description'] ?? meta['twitter:description'];
  const image = abs(meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'] ?? meta['twitter:image:src']);
  const iconLink = links.find((l) => /(^|\s)icon(\s|$)/.test(l.rel) && !l.rel.includes('mask')) ?? links.find((l) => l.rel.includes('apple-touch-icon'));
  const icon = abs(iconLink?.href) ?? abs('/favicon.ico');
  const oembed = abs(links.find((l) => l.rel === 'alternate' && l.type === 'application/json+oembed')?.href);
  return { title: title?.slice(0, 500), description: description?.replace(/\s+/g, ' ').trim().slice(0, 1000), icon, image, oembed };
}

/* ------------------------------------------------------------------ providers (server-side mirror of the client list) */

function videoEmbed(u: URL): string | null {
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) {
    const id = h === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.pathname.startsWith('/watch') ? u.searchParams.get('v') : /^\/(?:embed|shorts|live)\/([\w-]+)/.exec(u.pathname)?.[1];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (/(^|\.)vimeo\.com$/.test(h)) {
    const id = /\/(\d+)/.exec(u.pathname)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  if (/(^|\.)loom\.com$/.test(h)) {
    const id = /\/(?:share|embed)\/([\w-]+)/.exec(u.pathname)?.[1];
    return id ? `https://www.loom.com/embed/${id}` : null;
  }
  return null;
}

function iframeSrc(html: string): string | null {
  const m = /<iframe\b[^>]*\ssrc=("([^"]+)"|'([^']+)')/i.exec(html);
  return m ? decodeEntities(m[2] ?? m[3]) : null;
}

/* ------------------------------------------------------------------ handlers */

export const handlers = {
  /** Link mention metadata: "Paste as › Mention" shows the page title and icon, not the host).
   *  Read-only: the editor writes the mention itself with the user's own permissions. */
  async getLinkMetadata(ctx: Ctx, body: { url?: string }) {
    const uid = requireUser(ctx);
    const url = String(body.url ?? '').slice(0, 4096);
    if (!isHttpUrl(url)) throw new ApiError('Invalid URL', 400);
    fetchBudget(uid);
    let meta: PageMeta = {};
    let finalUrl = url;
    try {
      const page = await fetchText(url);
      finalUrl = page.url;
      if (/html|xml/i.test(page.contentType) || /<html|<head|<title/i.test(page.text.slice(0, 2000))) meta = parseMeta(page.text, page.url);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 400) throw e;
    }
    let provider = '';
    try {
      provider = new URL(finalUrl).hostname.replace(/^www\./, '');
    } catch {
      /* keep empty */
    }
    return {
      url: finalUrl,
      title: meta.title ?? null,
      description: meta.description ?? null,
      icon_url: meta.icon && isHttpUrl(meta.icon) ? meta.icon : null,
      provider,
    };
  },

  async saveBookmarkPreview(ctx: Ctx, body: { type?: string; block?: { id?: string; spaceId?: string }; url?: string }) {
    const uid = requireUser(ctx);
    const blockId = String(body.block?.id ?? '');
    const block = getRecord<BlockRecord>('block', blockId);
    if (!block || !block.alive) throw new ApiError('Block could not be found', 404);
    if (!roleAtLeast(blockRole(blockId, uid), 'read_and_write')) throw new ApiError('Permission denied', 403);
    const url = String(body.url ?? '').slice(0, 4096);
    fetchBudget(uid);
    let meta: PageMeta = {};
    let finalUrl = url;
    try {
      const page = await fetchText(url);
      finalUrl = page.url;
      if (/html|xml/i.test(page.contentType) || /<html|<head|<title/i.test(page.text.slice(0, 2000))) meta = parseMeta(page.text, page.url);
      else if (/^image\//i.test(page.contentType)) meta = { image: page.url };
    } catch (e) {
      if (e instanceof ApiError && e.status !== 400) throw e;
      meta = {};
    }
    const ptr = { table: 'block' as const, id: blockId, spaceId: block.space_id };
    const operations: Operation[] = [];
    const now = Date.now();
    if (meta.title) operations.push({ pointer: ptr, path: ['properties', 'title'], command: 'set', args: [[meta.title]] });
    if (meta.description) operations.push({ pointer: ptr, path: ['properties', 'description'], command: 'set', args: [[meta.description]] });
    const fmt: Record<string, unknown> = {};
    if (meta.icon && isHttpUrl(meta.icon)) fmt.bookmark_icon = meta.icon;
    if (meta.image && isHttpUrl(meta.image)) fmt.bookmark_cover = meta.image;
    if (Object.keys(fmt).length) operations.push({ pointer: ptr, path: ['format'], command: 'update', args: fmt });
    operations.push({ pointer: ptr, path: [], command: 'update', args: { last_edited_time: now } });
    applyTransactions(uid, [{ id: newId(), spaceId: block.space_id, debug: { userAction: 'saveBookmarkPreview' }, operations }], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    rm.add('block', getRecord<BlockRecord>('block', blockId));
    return { recordMap: rm.map, url: finalUrl, metadata: meta };
  },

  async resolveEmbedLink(ctx: Ctx, body: { source?: string; pageWidth?: number; type?: string }) {
    const uid = requireUser(ctx);
    const source = String(body.source ?? '').slice(0, 4096);
    let u: URL;
    try {
      u = new URL(source);
    } catch {
      return { type: 'embed', empty: true, format: {}, properties: {} };
    }
    const video = videoEmbed(u);
    if (video) {
      const w = Math.min(Number(body.pageWidth) || 708, 708);
      return { type: 'video', empty: false, format: { display_source: video, block_width: w, block_height: Math.round((w * 9) / 16), block_preserve_scale: true }, properties: { source: [[source]] } };
    }
    try {
      fetchBudget(uid);
      const page = await fetchText(source);
      const meta = parseMeta(page.text, page.url);
      if (meta.oembed) {
        const oe = await fetchText(meta.oembed, 'application/json');
        const data = JSON.parse(oe.text) as { html?: string; height?: number; width?: number; type?: string; url?: string };
        // the provider's iframe/photo URL is stored and rendered: http(s) only (no javascript:/data: frames)
        const src = data.html ? iframeSrc(data.html) : null;
        if (src && isHttpUrl(src)) return { type: 'embed', empty: false, format: { display_source: src, block_height: Math.max(120, Math.min(Number(data.height) || 320, 1200)) }, properties: { source: [[source]] } };
        if (data.type === 'photo' && data.url && isHttpUrl(data.url)) return { type: 'image', empty: false, format: { display_source: data.url }, properties: { source: [[data.url]] } };
      }
    } catch {
      /* unreachable / not embeddable → generic iframe */
    }
    return { type: 'embed', empty: true, format: {}, properties: {} };
  },

  getTransclusionReferences(ctx: Ctx, body: { blockId?: string }) {
    const uid = requireUser(ctx);
    const id = String(body.blockId ?? '');
    const container = getRecord<BlockRecord>('block', id);
    // a container created a moment ago may not be saved yet: it cannot have copies, so answer empty instead of 404
    if (!container) return { references: [], recordMap: {} };
    if (blockRole(id, uid) === 'none') throw new ApiError('Permission denied', 403);
    if (!/^[\w-]{1,64}$/.test(id)) return { references: [], recordMap: {} };
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND alive = 1 AND data LIKE ? AND data LIKE ? LIMIT 2000`).all('%"transclusion_reference_pointer"%', `%${id}%`) as { data: string }[];
    const rm = new RecordMapBuilder(uid);
    const references: { id: string; pageId: string }[] = [];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      if (b.type !== 'transclusion_reference' || (b.format as any)?.transclusion_reference_pointer?.id !== id) continue;
      if (blockRole(b.id, uid) === 'none') continue;
      // walk up to the page that contains the copy
      let cur: BlockRecord | undefined = b;
      for (let i = 0; i < 60 && cur && cur.parent_table === 'block' && cur.type !== 'page' && cur.type !== 'collection_view_page'; i++) cur = getRecord<BlockRecord>('block', cur.parent_id);
      if (!cur || !cur.alive) continue;
      rm.add('block', b);
      rm.add('block', cur);
      references.push({ id: b.id, pageId: cur.id });
    }
    return { references, recordMap: rm.map };
  },
};
