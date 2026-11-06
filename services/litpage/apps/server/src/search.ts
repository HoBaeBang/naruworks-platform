// Full-text search over block text (SQLite FTS5 trigram tokenizer: substring matching works for CJK).
// Index rows: kind 'page' (page / database row title), 'block' (block text) and 'prop:<propertyId>' (one row per database
// row property value). Property values are separate rows so property access rules (propaccess.ts) apply to
// matches and snippets per person: searchText drops hits on values the viewer can't see.
// Queries: words match anywhere on the page in any order; "quoted text" matches exactly.
import type { BlockRecord, CollectionRecord, SpaceRecord } from '@nc/shared/records.ts';
import { hasPropertyRule } from '@nc/shared/database/propertyAccess.ts';
import { db, getRecord } from './db.ts';
import { redactDatabaseRecord } from './propaccess.ts';

const del = db.prepare('DELETE FROM search_index WHERE block_id = ?');
const ins = db.prepare('INSERT INTO search_index (block_id, page_id, space_id, kind, text) VALUES (?, ?, ?, ?, ?)');

const PAGE_TYPES = new Set(['page', 'collection_view_page']);

export function pageIdOf(block: BlockRecord): string {
  return resolvePageId(block) ?? block.id;
}

/** Owning page id, or undefined while an ancestor block isn't stored yet (content written child-first). */
function resolvePageId(block: BlockRecord): string | undefined {
  let cur: BlockRecord | undefined = block;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (PAGE_TYPES.has(cur.type) || cur.parent_table === 'collection') return cur.id;
    if (cur.parent_table !== 'block') return cur.id;
    const parent: BlockRecord | undefined = getRecord<BlockRecord>('block', cur.parent_id);
    if (!parent) return undefined;
    cur = parent;
  }
  return block.id;
}

// Seeded/imported content can be stored children-first inside one synchronous transaction; re-index those
// blocks once the batch has finished so search results point at the right page.
const deferred = new Set<string>();
function deferIndex(id: string) {
  if (!deferred.size) setImmediate(() => {
    const ids = [...deferred];
    deferred.clear();
    for (const bid of ids) {
      const b = getRecord<BlockRecord>('block', bid);
      if (b) indexBlock(b, true);
    }
  });
  deferred.add(id);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "@Design" for a group mention ["g", groupId, spaceId]. */
function groupMentionText(groupId: unknown, spaceId: string | undefined): string {
  const space = spaceId ? getRecord<SpaceRecord>('space', spaceId) : undefined;
  const g = (((space?.settings as { groups?: { id: string; name?: string }[] } | undefined)?.groups) ?? []).find((x) => x?.id === String(groupId));
  return g?.name ? `@${g.name}` : '';
}

/** Searchable text of rich text: date mentions are found by their date ("October 21,
 * 2026" / "Oct 21" / "2026-10-21"), group mentions by "@group name"; person and page @mentions are not part of the text. */
function searchableText(rt: unknown, spaceId?: string): string {
  if (!Array.isArray(rt)) return '';
  let out = '';
  for (const d of rt as [string, unknown[]?][]) {
    if (!Array.isArray(d)) continue;
    const anns = Array.isArray(d[1]) ? (d[1] as [string, unknown, unknown?][]) : [];
    const date = anns.find((a) => a?.[0] === 'd')?.[1] as { start_date?: string } | undefined;
    if (date?.start_date && /^\d{4}-\d{2}-\d{2}$/.test(date.start_date)) {
      const [y, m, dd] = date.start_date.split('-').map(Number);
      out += ` ${MONTHS[m - 1]} ${dd}, ${y} ${MONTHS[m - 1].slice(0, 3)} ${dd} ${date.start_date} `;
      continue;
    }
    const group = anns.find((a) => a?.[0] === 'g');
    if (group) {
      out += ` ${groupMentionText(group[1], typeof group[2] === 'string' ? group[2] : spaceId)} `;
      continue;
    }
    if (typeof d[0] === 'string') out += d[0];
  }
  return out.replace(/[‣⁍]/g, ' ');
}

// database properties Quick Find skips (select / multi-select values are found with database search)
const UNSEARCHED_TYPES = new Set(['select', 'multi_select', 'status', 'person', 'relation', 'checkbox', 'file', 'created_by', 'last_edited_by', 'button']);

export function indexBlock(block: BlockRecord, retried = false) {
  del.run(block.id);
  writeIndex(block, retried);
}

/** Index rows of `block` (callers delete its old rows first). */
function writeIndex(block: BlockRecord, retried: boolean) {
  if (!block.alive) return;
  const text = searchableText(block.properties?.title, block.space_id).replace(/\s+/g, ' ').trim();
  // database row property values: one row per property (access rules are checked per property at query time)
  const props: [string, string][] = [];
  if (block.parent_table === 'collection' && block.properties) {
    const schema = getRecord<CollectionRecord>('collection', block.parent_id)?.schema ?? {};
    for (const [k, v] of Object.entries(block.properties)) {
      if (k === 'title' || !schema[k] || UNSEARCHED_TYPES.has(String(schema[k]?.type ?? ''))) continue;
      const value = searchableText(v, block.space_id).replace(/\s+/g, ' ').trim();
      if (value) props.push([k, value]);
    }
  }
  if (!text && !props.length) return;
  const resolved = resolvePageId(block);
  if (!resolved && !retried) return deferIndex(block.id);
  const pageId = resolved ?? block.id;
  const kind = PAGE_TYPES.has(block.type) || block.parent_table === 'collection' ? 'page' : 'block';
  if (text) ins.run(block.id, pageId, block.space_id, kind, text);
  for (const [pid, value] of props) ins.run(block.id, pageId, block.space_id, `prop:${pid}`, value);
}

export interface SearchHit {
  blockId: string;
  pageId: string;
  kind: string;
  text: string;
  score: number;
}

/** Who is searching: hits on database property values follow that person's property access (null = signed out). */
export interface SearchViewer {
  userId: string | null;
}

/** Quick Find terms: "quoted text" is one exact term, other words are separate terms (all must match). */
export function searchTerms(query: string): string[] {
  const out: string[] = [];
  const re = /["“”]([^"“”]*)["“”]?|([^\s"“”]+)/g;
  for (let m = re.exec(query); m; m = re.exec(query)) {
    const term = (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim();
    if (term && !out.some((t) => t.toLowerCase() === term.toLowerCase())) out.push(term);
  }
  return out.slice(0, 12);
}

function termHits(spaceId: string, term: string, limit: number): SearchHit[] {
  if ([...term].length >= 3) {
    const escaped = '"' + term.replace(/"/g, '""') + '"';
    const rows = db
      .prepare(`SELECT block_id, page_id, kind, text, bm25(search_index) AS score FROM search_index
                WHERE search_index MATCH ? AND space_id = ? ORDER BY (kind = 'page') DESC, score LIMIT ?`)
      .all(escaped, spaceId, limit) as any[];
    return rows.map((r) => ({ blockId: r.block_id, pageId: r.page_id, kind: r.kind, text: r.text, score: r.score }));
  }
  const rows = db
    .prepare(`SELECT block_id, page_id, kind, text FROM search_index WHERE space_id = ? AND text LIKE ? ESCAPE '\\'
              ORDER BY (kind = 'page') DESC LIMIT ?`)
    .all(spaceId, `%${term.replace(/[%_\\]/g, (m) => '\\' + m)}%`, limit) as any[];
  return rows.map((r) => ({ blockId: r.block_id, pageId: r.page_id, kind: r.kind, text: r.text, score: 0 }));
}

/**
 * Hits on database property values the viewer may read: the property still exists and, when it has an
 * access rule, the viewer's copy of the row keeps its value (same rule as record maps, propaccess.ts). Without a
 * viewer only values of unrestricted properties match.
 */
function propertyHitFilter(viewer: SearchViewer | undefined): (h: SearchHit) => boolean {
  const rows = new Map<string, BlockRecord | undefined>();
  const cols = new Map<string, CollectionRecord | undefined>();
  const seen = new Map<string, boolean>();
  return (h) => {
    if (!h.kind.startsWith('prop:')) return true;
    const key = `${h.blockId}:${h.kind}`;
    if (seen.has(key)) return seen.get(key)!;
    const propId = h.kind.slice(5);
    if (!rows.has(h.blockId)) rows.set(h.blockId, getRecord<BlockRecord>('block', h.blockId));
    const row = rows.get(h.blockId);
    let ok = false;
    if (row && row.parent_table === 'collection') {
      if (!cols.has(row.parent_id)) cols.set(row.parent_id, getRecord<CollectionRecord>('collection', row.parent_id));
      const prop = cols.get(row.parent_id)?.schema?.[propId];
      if (prop && !hasPropertyRule(prop)) ok = true;
      else if (prop && viewer) ok = (redactDatabaseRecord('block', row, viewer.userId) as BlockRecord).properties?.[propId] !== undefined;
    }
    seen.set(key, ok);
    return ok;
  };
}

/**
 * Hits for `query` in a workspace (block-level; callers resolve pages and check page access). Several terms match
 * pages that contain every term (in any block); hits holding every term come first, titles before body text.
 */
export function searchText(spaceId: string, query: string, limit = 200, viewer?: SearchViewer): SearchHit[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const visible = propertyHitFilter(viewer);
  if (terms.length === 1) return termHits(spaceId, terms[0], limit).filter(visible);
  const lists = terms.map((t) => termHits(spaceId, t, Math.max(limit, 1000)).filter(visible));
  const pagesPerTerm = lists.map((l) => new Set(l.map((h) => h.pageId)));
  const lower = terms.map((t) => t.toLowerCase());
  const out: (SearchHit & { all: boolean; at: number })[] = [];
  const seen = new Set<string>();
  let at = 0;
  for (const list of lists) {
    for (const h of list) {
      const key = `${h.blockId}:${h.kind}`;
      if (seen.has(key) || !pagesPerTerm.every((s) => s.has(h.pageId))) continue;
      seen.add(key);
      const text = h.text.toLowerCase();
      out.push({ ...h, all: lower.every((t) => text.includes(t)), at: at++ });
    }
  }
  out.sort((a, b) => Number(b.all) - Number(a.all) || Number(b.kind === 'page') - Number(a.kind === 'page') || a.at - b.at);
  return out.slice(0, limit).map(({ all: _all, at: _at, ...h }) => h);
}

// One-time repair for indexes written before deferred indexing existed: block rows whose page_id points at the
// block itself (their ancestors weren't stored yet when they were indexed).
for (const r of db.prepare(`SELECT block_id FROM search_index WHERE kind = 'block' AND page_id = block_id`).all() as { block_id: string }[]) {
  const b = getRecord<BlockRecord>('block', r.block_id);
  if (b) indexBlock(b, true);
}

// One-time upgrade (v2): database rows used to be indexed as one row (title + every property value); re-index them so
// property values become their own rows and property access rules apply to search.
const INDEX_V2_MARK = '__nc_search_index_v2__';
if (!db.prepare('SELECT 1 FROM search_index WHERE block_id = ?').get(INDEX_V2_MARK)) {
  db.exec(`DELETE FROM search_index WHERE block_id IN (SELECT id FROM records WHERE tbl = 'block' AND parent_table = 'collection')`);
  for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND parent_table = 'collection' AND alive = 1`).all() as { data: string }[]) {
    writeIndex(JSON.parse(r.data) as BlockRecord, true);
  }
  ins.run(INDEX_V2_MARK, '', '', 'meta', '');
}
