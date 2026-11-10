// Sites settings and the public site.
// Settings live on the site's published permission (block.permissions[public_permission, published].site), so only
// people with full access can change them (permission edits need full access in authz) and they disappear with
// Unpublish:
//   slug         custom short link → /public/<slug> (unique across published sites)
//   theme        'system' | 'light' | 'dark'
//   title / description / image   share preview + SEO (search engines, social cards)
//   favicon      'page_icon' (default) | 'Litpage' | emoji | uploaded image URL
//   header       { breadcrumbs, search, share, signup (Get started), links: [{ pageId }] ≤ 10 }
//   ga           Google Analytics measurement ID
// Endpoints:
//   getSite { slugOrId }                 public: resolve a slug / page id to the page + its site settings
//   setSiteSettings { pageId, settings } full access on the published root, publishing allowed by policy
//   checkSiteSlug { pageId, slug }       availability of a short link
//   searchSite { pageId, query }         site search: pages of the published site matching the query (public)
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, Permission, SpaceRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { assertWorkspacePolicy } from '../../policy.ts';
import { hit, exemptIp } from '../../ratelimit.ts';
import { searchText } from '../../search.ts';

type Handler = (ctx: Ctx, body: any) => any;

export interface SiteSettings {
  slug?: string;
  theme?: 'system' | 'light' | 'dark';
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  header?: { breadcrumbs?: boolean; search?: boolean; share?: boolean; signup?: boolean; links?: { pageId: string }[] };
  ga?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED = new Set(['api', 'files', 'public', 'login', 'signup', 'form', 'invite', 'admin', 'settings', 'site', 'sites', 'litpage', 'www', 'help']);
const MAX_LINKS = 10;

function expand(id: string): string {
  const h = id.replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(h) ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : id;
}

const livePublished = (p: Permission | undefined) => !!p && p.type === 'public_permission' && !!p.published && (!p.expiry_time || p.expiry_time > Date.now());

function parentOf(b: BlockRecord): BlockRecord | undefined {
  if (b.parent_table === 'block') return getRecord<BlockRecord>('block', b.parent_id);
  if (b.parent_table === 'collection') {
    const col = getRecord<CollectionRecord>('collection', b.parent_id);
    return col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
  }
  return undefined;
}

/** The published root of `page` (itself or the nearest ancestor with a live Publish permission). */
export function siteRootOf(page: BlockRecord | undefined): { root: BlockRecord; perm: Permission } | null {
  let cur = page;
  for (let i = 0; i < 80 && cur; i++) {
    const perm = (cur.permissions ?? []).find(livePublished);
    if (perm) return { root: cur, perm };
    cur = parentOf(cur);
  }
  return null;
}

function titleOf(b: BlockRecord | undefined): string {
  if (!b) return '';
  if ((b.type === 'collection_view_page' || b.type === 'collection_view') && b.collection_id) {
    const t = toPlainText(getRecord<CollectionRecord>('collection', b.collection_id)?.name);
    if (t) return t;
  }
  return toPlainText(b.properties?.title);
}

/** Page published under this slug, if any. */
function pageBySlug(slug: string): BlockRecord | undefined {
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND alive = 1 AND data LIKE ? LIMIT 50`).all(`%"slug":"${slug.replace(/[%_\\"]/g, '')}"%`) as { data: string }[];
  for (const r of rows) {
    const b = JSON.parse(r.data) as BlockRecord;
    const perm = (b.permissions ?? []).find(livePublished);
    if ((perm as any)?.site?.slug === slug) return b;
  }
  return undefined;
}

/** Public view of a site's settings (only what visitors need). */
function publicSettings(perm: Permission): SiteSettings {
  const s = ((perm as any).site ?? {}) as SiteSettings;
  return {
    slug: s.slug, theme: s.theme ?? 'system', title: s.title, description: s.description, image: s.image, favicon: s.favicon ?? 'page_icon',
    header: { breadcrumbs: s.header?.breadcrumbs !== false, search: s.header?.search !== false, share: !!s.header?.share, signup: s.header?.signup !== false, links: s.header?.links ?? [] },
    ga: s.ga,
  };
}

function cleanUrl(u: unknown): string | undefined {
  if (typeof u !== 'string' || !u) return undefined;
  if (u.length > 2000) throw new ApiError('Image link is too long', 400);
  if (/^\/files\/[0-9a-f-]{36}\//i.test(u) || /^https:\/\/[^\s"'<>]+$/i.test(u)) return u;
  throw new ApiError('Use an uploaded image or an https:// link', 400);
}

function within(root: BlockRecord, page: BlockRecord | undefined): boolean {
  let cur = page;
  for (let i = 0; i < 80 && cur; i++) {
    if (cur.id === root.id) return true;
    cur = parentOf(cur);
  }
  return false;
}

function validate(root: BlockRecord, input: any, current: SiteSettings): SiteSettings {
  const next: SiteSettings = { ...current };
  if (!input || typeof input !== 'object') throw new ApiError('Invalid settings', 400);
  if ('slug' in input) {
    const slug = String(input.slug ?? '').trim().toLowerCase();
    if (!slug) delete next.slug;
    else {
      if (!SLUG.test(slug) || /^[0-9a-f]{32}$/.test(slug) || RESERVED.has(slug)) throw new ApiError('Short links use lowercase letters, numbers and dashes', 400);
      const taken = pageBySlug(slug);
      if (taken && taken.id !== root.id) throw new ApiError('This link is already taken', 409);
      next.slug = slug;
    }
  }
  if ('theme' in input) {
    if (!['system', 'light', 'dark'].includes(input.theme)) throw new ApiError('Invalid theme', 400);
    next.theme = input.theme;
  }
  if ('title' in input) next.title = String(input.title ?? '').slice(0, 120) || undefined;
  if ('description' in input) next.description = String(input.description ?? '').slice(0, 300) || undefined;
  if ('image' in input) next.image = cleanUrl(input.image);
  if ('favicon' in input) {
    const f = input.favicon;
    if (f === null || f === undefined || f === '' || f === 'page_icon') next.favicon = 'page_icon';
    else if (f === 'litpage') next.favicon = 'litpage';
    else if (typeof f === 'string' && [...f].length <= 8 && !/[<>"'\s]/.test(f) && !/^[a-z]+:/i.test(f)) next.favicon = f;
    else next.favicon = cleanUrl(f);
  }
  if ('header' in input) {
    const h = input.header ?? {};
    const links = Array.isArray(h.links) ? h.links : current.header?.links ?? [];
    if (links.length > MAX_LINKS) throw new ApiError(`You can add up to ${MAX_LINKS} page shortcuts`, 400);
    const clean: { pageId: string }[] = [];
    for (const l of links) {
      const id = String(l?.pageId ?? '');
      const p = UUID.test(id) ? getRecord<BlockRecord>('block', id) : undefined;
      // header links point at pages of this site (visitors can open them)
      if (!p || !p.alive || !within(root, p)) throw new ApiError('Header links must be pages of this site', 400);
      if (!clean.some((c) => c.pageId === id)) clean.push({ pageId: id });
    }
    next.header = {
      breadcrumbs: h.breadcrumbs ?? current.header?.breadcrumbs ?? true,
      search: h.search ?? current.header?.search ?? true,
      share: h.share ?? current.header?.share ?? false,
      signup: h.signup ?? current.header?.signup ?? true,
      links: clean,
    };
    for (const k of ['breadcrumbs', 'search', 'share', 'signup'] as const) next.header[k] = !!next.header[k];
  }
  if ('ga' in input) {
    const ga = String(input.ga ?? '').trim();
    if (ga && !/^[A-Za-z0-9-]{1,30}$/.test(ga)) throw new ApiError('Use letters and numbers only', 400);
    next.ga = ga || undefined;
  }
  return next;
}

export const handlers: Record<string, Handler> = {
  getSite(ctx, { slugOrId }) {
    const key = String(slugOrId ?? '').trim();
    if (!key || key.length > 100) throw new ApiError('Not found', 404);
    const page = UUID.test(expand(key)) ? getRecord<BlockRecord>('block', expand(key)) : pageBySlug(key.toLowerCase());
    if (!page || !page.alive || blockRole(page.id, ctx.userId) === 'none') throw new ApiError('Not found', 404);
    const site = siteRootOf(page);
    const rm = new RecordMapBuilder(ctx.userId);
    const settings = site ? publicSettings(site.perm) : null;
    // header shortcuts: titles/icons of the linked pages
    for (const l of settings?.header?.links ?? []) {
      const b = getRecord<BlockRecord>('block', l.pageId);
      if (b && blockRole(b.id, ctx.userId) !== 'none') rm.add('block', b);
    }
    if (site) rm.add('block', site.root);
    return {
      pageId: page.id, rootId: site?.root.id ?? null, published: !!site, settings,
      indexing: !!site?.perm.allow_search_engine_indexing, allowDuplicate: !!site?.perm.allow_duplicate,
      siteTitle: titleOf(site?.root), recordMap: rm.map,
    };
  },

  checkSiteSlug(ctx, { pageId, slug }) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const s = String(slug ?? '').trim().toLowerCase();
    if (!SLUG.test(s) || /^[0-9a-f]{32}$/.test(s) || RESERVED.has(s)) return { available: false, reason: 'Short links use lowercase letters, numbers and dashes' };
    const taken = pageBySlug(s);
    return { available: !taken || taken.id === String(pageId ?? ''), reason: taken && taken.id !== pageId ? 'This link is already taken' : undefined };
  },

  setSiteSettings(ctx, { pageId, settings }) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const uid = ctx.userId;
    const root = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!root || !root.alive || blockRole(root.id, uid) === 'none') throw new ApiError('Not found', 404);
    if (blockRole(root.id, uid) !== 'editor') throw new ApiError('Full access is required to update this page’s settings', 403);
    const idx = (root.permissions ?? []).findIndex(livePublished);
    if (idx < 0) throw new ApiError('Publish this page first', 400);
    assertWorkspacePolicy(root.space_id, 'publish', uid, { pageId: root.id });
    const perm = root.permissions![idx] as Permission & { site?: SiteSettings };
    const next = validate(root, settings, perm.site ?? {});
    const permissions = root.permissions!.map((p, i) => (i === idx ? { ...p, site: next } : p));
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: root.space_id, debug: { userAction: 'setSiteSettings' }, operations: [{ pointer: { table: 'block', id: root.id, spaceId: root.space_id }, path: ['permissions'], command: 'set', args: permissions }] } as any], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { settings: next, recordMap: rm.map };
  },

  searchSite(ctx, { pageId, query, limit }) {
    // anonymous visitors search too: keep it bounded per IP / user
    const who = ctx.userId ?? ctx.ip ?? 'anon';
    if (!exemptIp(ctx.ip) && !hit(`site-search:${who}`, 60, 60_000)) throw new ApiError('Too many searches. Try again in a moment.', 429);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    const site = page && blockRole(page.id, ctx.userId) !== 'none' ? siteRootOf(page) : null;
    if (!site) throw new ApiError('Not found', 404);
    const space = getRecord<SpaceRecord>('space', site.root.space_id);
    const q = String(query ?? '').trim().slice(0, 200);
    if (!q || !space) return { results: [] };
    const out: { id: string; title: string; text: string; icon: string | null }[] = [];
    const seen = new Set<string>();
    // visitors match only property values they may see; signed-out visitors see unrestricted ones
    for (const h of searchText(space.id, q, 400, { userId: ctx.userId ?? null })) {
      if (out.length >= Math.min(Number(limit) || 20, 50)) break;
      let p = getRecord<BlockRecord>('block', h.pageId);
      // hits inside a page resolve to the page
      for (let i = 0; i < 40 && p && p.type !== 'page' && p.type !== 'collection_view_page' && p.parent_table === 'block'; i++) p = getRecord<BlockRecord>('block', p.parent_id);
      if (!p || seen.has(p.id) || !p.alive || (p.type !== 'page' && p.type !== 'collection_view_page')) continue;
      seen.add(p.id);
      // only pages of this site that the visitor can open
      if (!within(site.root, p) || blockRole(p.id, ctx.userId) === 'none') continue;
      out.push({ id: p.id, title: titleOf(p) || 'Untitled', text: h.text.slice(0, 160), icon: (p.format?.page_icon as string) ?? null });
    }
    return { results: out };
  },
};
