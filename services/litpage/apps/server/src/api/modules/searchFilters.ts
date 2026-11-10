// Quick Find (⌘K) search: filters (Title only, Created by, In page, Teamspace, Date, Content status) and sorts
// (Best matches / Last edited / Created) used by the core `search` handler (handlers.ts delegates here).
// Search filters.
import type { BlockRecord, CollectionRecord, SpaceRecord, TeamRecord } from '@nc/shared/records.ts';
import { groupIdsOf, roleAtLeast, teamMembership } from '@nc/shared/permissions.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../../db.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';
import { pageIdOf, searchTerms, searchText } from '../../search.ts';
import { isArchived } from '@nc/shared/archive.ts';
import { readVerification } from '@nc/shared/verification.ts';

const archiveLookup = {
  block: (id: string) => getRecord<BlockRecord>('block', id),
  collection: (id: string) => getRecord<CollectionRecord>('collection', id),
  team: (id: string) => getRecord<TeamRecord>('team', id),
};
import { logSearch } from '../../searchLog.ts';

type Handler = (ctx: unknown, body: any) => any;

export interface QuickFindFilters {
  titleOnly?: boolean;
  createdBy?: string[];
  ancestorIds?: string[];
  teamIds?: string[];
  lastEditedTime?: { start?: number; end?: number };
  createdTime?: { start?: number; end?: number };
  contentStatus?: 'all' | 'all_with_archived' | 'verified_only' | 'archived_only';
}

export interface QuickFindSort {
  field?: 'relevance' | 'lastEdited' | 'created';
  direction?: 'asc' | 'desc';
}

interface Candidate {
  pageId: string;
  blockId: string;
  text: string;
  titleMatch: boolean;
  score: number;
  order: number;
}

const PAGE_TYPES = new Set(['page', 'collection_view_page']);

/** Ancestor chain (nearest first) through blocks and collections; returns ids and the root team id if any. */
function lineage(b: BlockRecord): { ids: string[]; teamId: string | null } {
  const ids: string[] = [];
  let cur: BlockRecord | undefined = b;
  let teamId: string | null = null;
  for (let i = 0; i < 60 && cur; i++) {
    if (cur.parent_table === 'block') {
      cur = getRecord<BlockRecord>('block', cur.parent_id);
      if (cur) ids.push(cur.id);
    } else if (cur.parent_table === 'collection') {
      const col = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
      if (cur) ids.push(cur.id);
    } else {
      if (cur.parent_table === 'team') teamId = cur.parent_id;
      break;
    }
  }
  return { ids, teamId };
}

function addAncestors(b: BlockRecord, rm: RecordMapBuilder) {
  let cur: BlockRecord | undefined = b;
  for (let i = 0; i < 30 && cur; i++) {
    if (cur.parent_table === 'block') {
      cur = getRecord<BlockRecord>('block', cur.parent_id);
      if (cur) rm.add('block', cur);
    } else if (cur.parent_table === 'collection') {
      const col = getRecord<CollectionRecord>('collection', cur.parent_id);
      if (!col) break;
      rm.add('collection', col);
      cur = getRecord<BlockRecord>('block', col.parent_id);
      if (cur) rm.add('block', cur);
    } else if (cur.parent_table === 'team') {
      rm.add('team', getRecord<TeamRecord>('team', cur.parent_id));
      break;
    } else break;
  }
}

function inRange(t: number, r?: { start?: number; end?: number }) {
  if (!r) return true;
  if (r.start != null && t < r.start) return false;
  if (r.end != null && t > r.end) return false;
  return true;
}

function hasFilters(f: QuickFindFilters | undefined): boolean {
  if (!f) return false;
  return !!(f.createdBy?.length || f.ancestorIds?.length || f.teamIds?.length || f.lastEditedTime || f.createdTime ||
    (f.contentStatus && f.contentStatus !== 'all'));
}

/** Databases are found by their collection name (collection names are not in the block text index); every term of the
 *  query ("quoted text" exactly) has to be in the name. */
function databaseHits(spaceId: string, q: string): { blockId: string; text: string }[] {
  const terms = searchTerms(q).map((t) => t.toLowerCase());
  if (!terms.length) return [];
  const needle = terms.reduce((a, b) => (b.length > a.length ? b : a));
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'collection' AND space_id = ? AND data LIKE ? LIMIT 300`)
    .all(spaceId, `%${needle.replace(/[%_\\]/g, (m) => '\\' + m)}%`) as { data: string }[];
  const out: { blockId: string; text: string }[] = [];
  for (const r of rows) {
    const col = JSON.parse(r.data) as CollectionRecord;
    const name = toPlainText(col.name);
    if (!terms.every((t) => name.toLowerCase().includes(t)) || col.alive === false) continue;
    out.push({ blockId: col.parent_id, text: name });
  }
  return out;
}

/** "Hide in search": the page reaches this user only through an unlisted workspace permission they never used. */
function hiddenFromSearch(page: BlockRecord, uid: string): boolean {
  let unlisted = false;
  let cur: BlockRecord | undefined = page;
  // only the caller's own grants count as explicit access: their groups and teamspaces, not anyone's 
  let groups: Set<string> | null = null;
  const inGroup = (id: string | undefined) => !!id && (groups ??= groupIdsOf(getRecord<SpaceRecord>('space', page.space_id), uid)).has(id);
  const inTeam = (id: string | undefined) => !!id && !!teamMembership(getRecord<TeamRecord>('team', id), uid);
  for (let i = 0; i < 60 && cur; i++) {
    for (const p of cur.permissions ?? []) {
      if (p.role === 'none') continue;
      if ((p.type === 'user_permission' && p.user_id === uid) || (p.type === 'group_permission' && inGroup(p.group_id)) || (p.type === 'team_permission' && inTeam(p.team_id))) return false; // explicit access
      if (p.type === 'space_permission' && (p as { unlisted?: boolean }).unlisted) unlisted = true;
    }
    if ((cur as { permissions_unlinked?: boolean }).permissions_unlinked) break;
    if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else if (cur.parent_table === 'collection') cur = getRecord<BlockRecord>('block', getRecord<CollectionRecord>('collection', cur.parent_id)?.parent_id ?? '');
    else break;
  }
  if (!unlisted) return false;
  const visited = getRecord('page_visit', `${uid}:${page.id}`);
  return !visited;
}

export function quickFindSearch(uid: string, body: { query?: string; spaceId?: string; limit?: number; filters?: QuickFindFilters; sort?: QuickFindSort; source?: string }) {
  const spaceId = String(body.spaceId ?? '');
  const q = String(body.query ?? '').slice(0, 500);
  const filters = (body.filters && typeof body.filters === 'object' ? body.filters : {}) as QuickFindFilters;
  const limit = Math.max(1, Math.min(Number(body.limit) || 50, 500));
  const sort = body.sort ?? {};
  const rm = new RecordMapBuilder(uid);
  const candidates = new Map<string, Candidate>();
  let order = 0;

  if (q.trim()) {
    const terms = searchTerms(q).map((t) => t.toLowerCase());
    // property values the person can't see neither match nor show as snippets 
    for (const h of searchText(spaceId, q, 1000, { userId: uid })) {
      // index rows written before their page existed (seeded content) point at themselves: resolve the page now
      let pid = h.pageId;
      const hb = getRecord<BlockRecord>('block', h.pageId);
      if (hb && !PAGE_TYPES.has(hb.type) && hb.parent_table === 'block') pid = pageIdOf(hb);
      const prev = candidates.get(pid);
      // "Title only": the title itself holds every term (property values of database rows are not the title)
      const titleMatch = h.kind === 'page' && h.blockId === pid && terms.every((t) => h.text.toLowerCase().includes(t));
      if (prev) {
        if (titleMatch && !prev.titleMatch) Object.assign(prev, { titleMatch, blockId: h.blockId, text: h.text });
        continue;
      }
      candidates.set(pid, { pageId: pid, blockId: h.blockId, text: h.text, titleMatch, score: h.score, order: order++ });
    }
    for (const d of databaseHits(spaceId, q)) {
      if (!candidates.has(d.blockId)) candidates.set(d.blockId, { pageId: d.blockId, blockId: d.blockId, text: d.text, titleMatch: true, score: -1, order: order++ });
      else Object.assign(candidates.get(d.blockId)!, { titleMatch: true });
    }
  } else if (hasFilters(filters)) {
    // empty query + filters: browse matching pages (most recently edited first)
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1
                             AND json_extract(data, '$.type') IN ('page', 'collection_view_page') ORDER BY last_edited_time DESC LIMIT 2000`).all(spaceId) as { data: string }[];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      candidates.set(b.id, { pageId: b.id, blockId: b.id, text: toPlainText(b.properties?.title), titleMatch: true, score: 0, order: order++ });
    }
  }

  type Row = { c: Candidate; page: BlockRecord; lineage: ReturnType<typeof lineage>; archived: boolean; verification: string };
  const rows: Row[] = [];
  for (const c of candidates.values()) {
    const page = getRecord<BlockRecord>('block', c.pageId);
    if (!page) continue;
    if (!page.alive) continue;
    // Content status : archived pages only with "including archived" / "Archived"
    const archived = isArchived(archiveLookup, page.id);
    if (filters.contentStatus === 'archived_only' ? !archived : filters.contentStatus !== 'all_with_archived' && archived) continue;
    const verification = readVerification(page, page.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', page.parent_id) : undefined).status;
    if (filters.contentStatus === 'verified_only' && verification !== 'verified') continue;
    // inline databases are only listed by Quick Find (other callers expect navigable pages)
    const isPageLike = PAGE_TYPES.has(page.type) || page.parent_table === 'collection' || (page.type === 'collection_view' && body.source === 'quick_find');
    if (!isPageLike) continue;
    if (!roleAtLeast(blockRole(page.id, uid), 'reader')) continue;
    // Share › Everyone at … › "Hide in search" : workspace-wide pages stay out of results for people who
    // never visited them and have no explicit access
    if (hiddenFromSearch(page, uid)) continue;
    if (filters.titleOnly && !c.titleMatch) continue;
    if (filters.createdBy?.length && !filters.createdBy.includes(page.created_by_id)) continue;
    if (!inRange(page.last_edited_time, filters.lastEditedTime)) continue;
    if (!inRange(page.created_time, filters.createdTime)) continue;
    const lin = lineage(page);
    if (filters.ancestorIds?.length && !filters.ancestorIds.some((a) => a === page.id || lin.ids.includes(a))) continue;
    if (filters.teamIds?.length && !(lin.teamId && filters.teamIds.includes(lin.teamId))) continue;
    rows.push({ c, page, lineage: lin, archived, verification });
  }

  const dir = sort.direction === 'asc' ? 1 : -1;
  if (sort.field === 'lastEdited') rows.sort((a, b) => dir * (a.page.last_edited_time - b.page.last_edited_time));
  else if (sort.field === 'created') rows.sort((a, b) => dir * (a.page.created_time - b.page.created_time));
  // verified pages rank first among equally good matches 
  else rows.sort((a, b) => (Number(b.c.titleMatch) - Number(a.c.titleMatch)) || (Number(b.verification === 'verified') - Number(a.verification === 'verified')) || (a.c.order - b.c.order));

  const total = rows.length;
  const results = rows.slice(0, limit).map(({ c, page, archived, verification }) => {
    rm.add('block', page);
    addAncestors(page, rm);
    if (page.collection_id) rm.add('collection', getRecord<CollectionRecord>('collection', page.collection_id));
    rm.add('lit_user', getRecord('lit_user', page.created_by_id), 'reader');
    // inline databases open their parent page scrolled to the block
    let navigate: { pageId: string; blockId?: string } = { pageId: page.id };
    if (page.type === 'collection_view' && page.parent_table === 'block') navigate = { pageId: page.parent_id, blockId: page.id };
    return {
      id: page.id, blockId: c.blockId, isNavigable: true, highlight: { text: c.text }, score: c.score,
      titleMatch: c.titleMatch, isDatabase: page.type === 'collection_view_page' || page.type === 'collection_view',
      createdBy: page.created_by_id, createdTime: page.created_time, lastEditedTime: page.last_edited_time, navigate,
      ...(archived ? { archived: true } : {}), ...(verification !== 'none' ? { verification } : {}),
    };
  });
  if (body.source === 'quick_find' && q.trim()) logSearch(spaceId, uid, q, results.map((r) => r.id)); // Settings › Analytics › Search
  return { results, total, recordMap: rm.map };
}

export const handlers: Record<string, Handler> = {};
