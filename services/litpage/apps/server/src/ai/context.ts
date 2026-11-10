// Workspace context for AI: permission-checked page → Markdown serialization and full-text
// retrieval (SQLite FTS5 via search.ts) for workspace Q&A and the chat's search_workspace tool.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, UserRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { childrenOf, getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { searchText } from '../search.ts';
import { hitVisible, visibleCollection, visibleHitText, visibleRow, visibleRows } from './visibility.ts';
import { inScope } from './tools/scope.ts';
import {
  extractSearchTerms, MAX_INSTRUCTIONS_CHARS, MAX_PAGE_CHARS, pageToMarkdown, rowToMarkdown, type AiPersona, type MdCollection, type MdSource,
  type PageContext,
} from './prompts.ts';

/** Can `userId` read the block — and, inside a tool call, is it in the workspace the call runs for (tools/scope.ts)? */
export function canRead(blockId: string, userId: string): boolean {
  if (!inScope(getRecord<BlockRecord>('block', blockId)?.space_id)) return false;
  return blockRole(blockId, userId) !== 'none';
}

export function isMember(spaceId: string, userId: string): boolean {
  return isSpaceMember(getRecord<SpaceRecord>('space', spaceId), userId);
}

export function blockTitle(b: BlockRecord | undefined): string {
  if (!b) return '';
  if ((b.type === 'collection_view_page' || b.type === 'collection_view') && b.collection_id) {
    const t = toPlainText(getRecord<CollectionRecord>('collection', b.collection_id)?.name);
    if (t) return t;
  }
  return toPlainText(b.properties?.title).replace(/[‣⁍]/g, '').trim();
}

/** Rows of a collection `userId` may see (row access + property access), in the order of its first view. */
function collectionRows(col: CollectionRecord, userId: string): BlockRecord[] {
  const rows = visibleRows(col.id, userId);
  const parent = getRecord<BlockRecord>('block', col.parent_id);
  const view = parent?.view_ids?.[0] ? getRecord<CollectionViewRecord>('collection_view', parent.view_ids[0]) : undefined;
  const order = new Map((view?.page_sort ?? []).map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || a.created_time - b.created_time);
}

export function mdSource(userId: string): MdSource {
  // Every block / database reached while serializing (children, synced-block and link pointers, inline databases)
  // is read with the user's permissions: pointers and content lists are user-editable, so a page must not be able
  // to pull someone else's private content into the model context.
  const roles = new Map<string, boolean>();
  const readable = (id: string | undefined) => {
    if (!id) return false;
    if (!roles.has(id)) roles.set(id, canRead(id, userId));
    return roles.get(id)!;
  };
  return {
    block: (id) => {
      const b = getRecord<BlockRecord>('block', id);
      if (!b || b.alive === false || !readable(b.id)) return undefined;
      // database rows: only the property values this principal may see
      return (b.parent_table === 'collection' ? visibleRow(b, userId) ?? undefined : b) as any;
    },
    pageTitle: (id) => {
      const b = getRecord<BlockRecord>('block', id);
      if (!b || b.alive === false) return '';
      if (!canRead(id, userId)) return 'Private page';
      return blockTitle(b);
    },
    userName: (id) => {
      const u = getRecord<UserRecord>('lit_user', id);
      return u?.name || '';
    },
    groupName: (id, spaceId) => {
      // group mentions  read as "@<group name>" — groups of the workspace the mention belongs to
      const groups = (getRecord<SpaceRecord>('space', spaceId)?.settings as { groups?: { id?: string; name?: string }[] } | undefined)?.groups;
      return (Array.isArray(groups) ? groups.find((g) => g?.id === id)?.name : '') || '';
    },
    collection: (id): MdCollection | undefined => {
      const raw = getRecord<CollectionRecord>('collection', id);
      if (!raw || raw.alive === false || !readable(raw.parent_id)) return undefined;
      const col = visibleCollection(raw, userId);
      if (!col) return undefined;
      return { name: toPlainText(col.name), schema: col.schema, rows: collectionRows(col, userId) as any };
    },
  };
}

/** The page/database-row a block lives in. */
export function pageIdOf(blockId: string): string | null {
  let cur = getRecord<BlockRecord>('block', blockId);
  for (let i = 0; i < 80 && cur; i++) {
    if (cur.type === 'page' || cur.type === 'collection_view_page' || cur.parent_table !== 'block') return cur.id;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  return cur?.id ?? null;
}

/** Serialize a readable page (or database row with its properties) for model context; null if not readable. */
export function readPage(pageId: string, userId: string, opts: { maxChars?: number; skip?: Set<string> } = {}): PageContext | null {
  const b = getRecord<BlockRecord>('block', pageId);
  if (!b || b.alive === false || !canRead(pageId, userId)) return null;
  const src = mdSource(userId);
  const maxChars = opts.maxChars ?? MAX_PAGE_CHARS;
  if (b.parent_table === 'collection') {
    const col = visibleCollection(getRecord<CollectionRecord>('collection', b.parent_id), userId);
    const row = visibleRow(b, userId);
    if (col && row) {
      const md = rowToMarkdown(row as any, col.schema, src, { maxChars });
      const truncated = md.length > maxChars;
      return { pageId, title: blockTitle(b) || 'Untitled', markdown: truncated ? md.slice(0, maxChars) : md, truncated };
    }
  }
  const s = pageToMarkdown(pageId, src, { maxChars, skip: opts.skip });
  return { pageId, title: s.title, markdown: s.markdown, truncated: s.truncated };
}

/** Settings → AI for this user (user_settings.settings): the personalized name and the body of
 *  the instructions page, read with the user's permissions at request time. */
export function aiPersona(userId: string): AiPersona | null {
  const settings = (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
  const persona: AiPersona = {};
  if (typeof settings.ai_name === 'string' && settings.ai_name.trim()) persona.name = settings.ai_name;
  const pageId = typeof settings.ai_instructions_page === 'string' ? settings.ai_instructions_page : '';
  const page = pageId ? getRecord<BlockRecord>('block', pageId) : undefined;
  if (page && page.alive !== false && canRead(pageId, userId)) {
    const md = pageToMarkdown(pageId, mdSource(userId), { maxChars: MAX_INSTRUCTIONS_CHARS, includeTitle: false });
    if (md.markdown.trim()) {
      persona.instructions = md.markdown;
      persona.instructionsTruncated = md.truncated;
    }
  }
  if (!persona.instructions && typeof settings.ai_instructions === 'string' && settings.ai_instructions.trim()) {
    persona.instructions = settings.ai_instructions.slice(0, MAX_INSTRUCTIONS_CHARS);
    persona.instructionsTruncated = settings.ai_instructions.length > MAX_INSTRUCTIONS_CHARS;
  }
  return persona.name || persona.instructions ? persona : null;
}

export interface SearchResult {
  pageId: string;
  title: string;
  snippet: string;
  score: number;
  /** the block whose text matched (citations jump to it) */
  blockId?: string;
}

function snippetAround(text: string, terms: string[], len = 220): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t.toLowerCase());
    if (at >= 0) break;
  }
  if (at < 0 || text.length <= len) return text.slice(0, len);
  const start = Math.max(0, at - Math.floor(len / 3));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + len)}${start + len < text.length ? '…' : ''}`;
}

/** Rank pages for a natural-language query by FTS hits on its keywords (title hits weigh more). */
export function searchPages(spaceId: string, userId: string, query: string, limit = 8): SearchResult[] {
  const terms = extractSearchTerms(query);
  if (!terms.length && query.trim()) terms.push(query.trim());
  const scores = new Map<string, { score: number; snippet: string; terms: Set<string>; blockId?: string }>();
  const pageCache = new Map<string, string>();
  terms.forEach((term, i) => {
    const weight = terms.length - i;
    for (const h of searchText(spaceId, term, 200, { userId })) {
      // a row matched only through a property this principal can't read is no hit
      if (!hitVisible(h.blockId, term, userId)) continue;
      // the index's page_id can be stale (e.g. blocks indexed before their parent existed): resolve now
      let pid = pageCache.get(h.blockId);
      if (!pid) {
        pid = (h.kind === 'page' ? h.blockId : pageIdOf(h.blockId)) ?? h.pageId;
        pageCache.set(h.blockId, pid);
      }
      const isTitle = pid === h.blockId;
      const cur = scores.get(pid) ?? { score: 0, snippet: '', terms: new Set<string>() };
      cur.score += isTitle ? weight * 2 : weight;
      cur.terms.add(term);
      if (!isTitle && (!cur.snippet || cur.terms.size === 1)) {
        cur.snippet = snippetAround(visibleHitText(h.blockId, h.text, userId), terms);
        cur.blockId = h.blockId;
      }
      scores.set(pid, cur);
    }
  });
  const out: SearchResult[] = [];
  const ranked = [...scores.entries()].sort((a, b) => b[1].terms.size - a[1].terms.size || b[1].score - a[1].score);
  for (const [pageId, s] of ranked) {
    const b = getRecord<BlockRecord>('block', pageId);
    if (!b || b.alive === false || !canRead(pageId, userId)) continue;
    out.push({ pageId, title: blockTitle(b) || 'Untitled', snippet: s.snippet, score: s.score, ...(s.blockId && s.blockId !== pageId ? { blockId: s.blockId } : {}) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Database row + its collection for AI Autofill (null when missing or not readable). */
export function rowForAutofill(rowId: string, userId: string): { row: BlockRecord; col: CollectionRecord } | null {
  const raw = getRecord<BlockRecord>('block', rowId);
  if (!raw || raw.alive === false || raw.parent_table !== 'collection' || !canRead(rowId, userId)) return null;
  // the autofill context holds only what the person filling may read (row + property access)
  const row = visibleRow(raw, userId);
  const col = visibleCollection(getRecord<CollectionRecord>('collection', raw.parent_id), userId);
  return row && col ? { row, col } : null;
}
