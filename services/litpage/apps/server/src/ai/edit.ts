// Workspace editing primitives for the agent's write tools: Markdown → block operations (the importer's parser +
// OpsBuilder, content/markdown.ts + content/spec.ts), locating edit targets in a page by the text the model saw
// selection over read_page's Markdown, parents, moves, deletes and database property values.
// Nothing here writes: callers collect operations and apply them through changes.ts (applyAgentOps).
import { expandId, newId } from '@nc/shared/ids.ts';
import type { Operation } from '@nc/shared/ops.ts';
import { op as mk } from '@nc/shared/ops.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type {
  BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, SelectOption, SpaceRecord, SpaceViewRecord, TeamRecord, UserRecord, UserRootRecord,
} from '@nc/shared/records.ts';
import type { Decoration, RichText } from '@nc/shared/richtext.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { encodeCheckbox, encodeDate, encodeNumber, encodePeople, encodeRelation, encodeSelect } from '@nc/shared/database/values.ts';
import { canEditDatabaseContent, canEditDatabaseStructure, hasCreatePermission } from '@nc/shared/database/access.ts';
import { getRecord } from '../db.ts';
import { blockRole, lookup } from '../records.ts';
import { parseInline, parseMarkdown } from '../content/markdown.ts';
import { OpsBuilder, shortPropId, type DbSpec, type DbViewSpec, type Spec } from '../content/spec.ts';
import { visibleCollection } from './visibility.ts';
import { inScope } from './tools/scope.ts';
import { AiError } from './client.ts';
import { blockTitle, mdSource } from './context.ts';
import { pageToMarkdown } from './prompts.ts';

export const PAGE_TYPES = new Set(['page', 'collection_view_page']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page/database id as the model wrote it (UUID, 32-hex compact id, or a page URL) → UUID. */
export function normalizeId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (UUID.test(s)) return s.toLowerCase();
  const hex = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(s.replace(/-/g, ''));
  if (hex) return expandId(hex[1].toLowerCase());
  return s;
}

export function canEdit(blockId: string, userId: string): boolean {
  return roleAtLeast(blockRole(blockId, userId), 'read_and_write');
}

export function canComment(blockId: string, userId: string): boolean {
  return roleAtLeast(blockRole(blockId, userId), 'comment_only');
}

/** Database rows: "Can edit content" is enough to edit a row's properties and body. */
export function canEditRow(rowId: string, userId: string): boolean {
  return canEditDatabaseContent(blockRole(rowId, userId));
}

/** Database schema / views: Can edit or Full access, and the database is not locked. */
export function canEditStructure(dbBlock: BlockRecord, userId: string): boolean {
  return canEditDatabaseStructure(blockRole(dbBlock.id, userId), dbBlock as any);
}

/** New rows: Can edit content and up, or the database's "Can create" permission. */
export function canAddRows(dbBlock: BlockRecord, userId: string): boolean {
  return canEditDatabaseContent(blockRole(dbBlock.id, userId)) || hasCreatePermission(lookup, dbBlock, userId);
}

/** A live block the user can read, or an AiError the tool reports back to the model. */
export function readableBlock(id: string, userId: string, what = 'page'): BlockRecord {
  const b = getRecord<BlockRecord>('block', normalizeId(id));
  if (!b || b.alive === false || !inScope(b.space_id) || blockRole(b.id, userId) === 'none') throw new AiError('not_found', `That ${what} doesn’t exist or the user can’t access it.`, 404);
  return b;
}

export function editableBlock(id: string, userId: string, what = 'page'): BlockRecord {
  const b = readableBlock(id, userId, what);
  const ok = b.parent_table === 'collection' ? canEditRow(b.id, userId) : canEdit(b.id, userId);
  if (!ok) throw new AiError('forbidden', `The user can only view “${blockTitle(b) || 'Untitled'}”, so it can’t be edited.`, 403);
  return b;
}

export function spaceViewOf(userId: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', userId);
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (sv?.space_id === spaceId && sv.alive !== false) return sv;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Markdown → specs

/** Link targets that name a page (UUID, compact id, app URL) become page mentions. */
function pageRefFromHref(href: string): string | null {
  if (/^https?:\/\//i.test(href) && !/\/[0-9a-f]{32}(?:[?#].*)?$|-[0-9a-f]{32}(?:[?#].*)?$/i.test(href)) return null;
  const id = normalizeId(href.replace(/^nc-page:/, ''));
  if (!UUID.test(id)) return null;
  const b = getRecord<BlockRecord>('block', id);
  return b && b.alive !== false ? id : null;
}

function mentionize(rt: RichText): RichText {
  const out: Decoration[] = [];
  for (const d of rt as Decoration[]) {
    const anns = (d[1] ?? []) as unknown[][];
    const link = anns.find((a) => a[0] === 'a');
    const target = link && typeof link[1] === 'string' && (link[1] as string).startsWith('nc-page:') ? (link[1] as string).slice(8) : null;
    if (target) out.push(['‣', [['p', target]]] as unknown as Decoration);
    else out.push(d);
  }
  return out as RichText;
}

function mapSpec(spec: Spec): Spec {
  const s: Spec = { ...spec };
  if (Array.isArray(s.text)) s.text = mentionize(s.text);
  if (s.table) s.table = s.table.map((row) => row.map((c) => (Array.isArray(c) ? mentionize(c) : c)));
  if (s.children) s.children = s.children.map(mapSpec);
  return s;
}

/** Agent Markdown → block specs (importer grammar; [Title](page_id) links become page mentions). */
export function markdownToSpecs(md: string): Spec[] {
  // a leading "---" block would be read as YAML front matter: start with a blank line
  const src = `\n${String(md ?? '').replace(/\r\n?/g, '\n')}`;
  const r = parseMarkdown(src, { resolveLink: (href) => { const id = pageRefFromHref(href); return id ? `nc-page:${id}` : href; } }, { titleFromH1: false });
  return r.blocks.map(mapSpec);
}

/** Inline Markdown → rich text (titles, text properties, comments). */
export function inlineRichText(text: string): RichText {
  return mentionize(parseInline(String(text ?? '').replace(/\s*\n\s*/g, ' ').trim(), [], { resolveLink: (href) => { const id = pageRefFromHref(href); return id ? `nc-page:${id}` : href; } }));
}

export function countBlocks(specs: Spec[]): number {
  return specs.reduce((n, s) => n + 1 + countBlocks(s.children ?? []) + (s.table?.length ?? 0), 0);
}

/** Build creation ops for specs inserted under `parentId` (content list), after `after` (or first / at the end). */
export function insertSpecs(b: OpsBuilder, parentId: string, specs: Spec[], pos: { after?: string; first?: boolean } = {}): string[] {
  const ids = specs.map((s) => b.block(s, parentId, 'block'));
  let after = pos.after;
  const pointer = { table: 'block' as const, id: parentId, spaceId: b.spaceId };
  ids.forEach((id, i) => {
    if (i === 0 && pos.first && !after) b.ops.push(mk.listBefore(pointer, ['content'], id));
    else b.ops.push(mk.listAfter(pointer, ['content'], id, after));
    after = id;
  });
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Page units (top-level blocks as read_page shows them) and selection matching

export interface Unit {
  id: string;
  markdown: string;
}

export function pageUnits(pageId: string, userId: string): Unit[] {
  const units: Unit[] = [];
  pageToMarkdown(pageId, mdSource(userId), { includeTitle: false, units });
  return units;
}

/** Whitespace-collapsed copy of `s` with a map from collapsed positions back to `s`. */
function collapse(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (!space && text) {
        text += ' ';
        map.push(i);
      }
      space = true;
    } else {
      text += ch.toLowerCase();
      map.push(i);
      space = false;
    }
  }
  return { text, map };
}

const norm = (s: string) => collapse(s).text.trim();

/**
 * Units covered by "start...end" (or a unique snippet) in the page's Markdown. Matching ignores case and
 * whitespace differences. Throws an AiError describing the problem so the model can retry with better text.
 */
export function matchSelection(units: Unit[], selection: string): { first: number; last: number } {
  if (!units.length) throw new AiError('bad_request', 'The page is empty: use append_content instead.', 400);
  const full = units.map((u) => u.markdown).join('\n');
  const starts: number[] = [];
  let pos = 0;
  for (const u of units) {
    starts.push(pos);
    pos += u.markdown.length + 1;
  }
  const unitAt = (i: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= i) k++;
    return k;
  };
  const { text, map } = collapse(full);
  const raw = selection.trim();
  const dots = raw.indexOf('...');
  const a = norm(dots >= 0 ? raw.slice(0, dots) : raw);
  const z = dots >= 0 ? norm(raw.slice(dots + 3)) : '';
  if (!a && !z) throw new AiError('bad_request', 'selection_with_ellipsis is empty.', 400);
  const findAll = (needle: string, from = 0) => {
    const out: number[] = [];
    for (let i = text.indexOf(needle, from); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i);
    return out;
  };
  if (!a) {
    const hits = findAll(z);
    if (!hits.length) throw new AiError('bad_request', `Couldn’t find “${z}” in the page. Read the page again and quote its text.`, 400);
    const u = unitAt(map[hits[0] + z.length - 1]);
    return { first: u, last: u };
  }
  const startHits = findAll(a);
  if (!startHits.length) throw new AiError('bad_request', `Couldn’t find “${raw.slice(0, 80)}” in the page. Read the page again and quote its text exactly.`, 400);
  if (!z) {
    if (startHits.length > 1) throw new AiError('bad_request', `“${a.slice(0, 60)}” appears ${startHits.length} times in the page. Include more text to make the selection unique.`, 400);
    return { first: unitAt(map[startHits[0]]), last: unitAt(map[startHits[0] + a.length - 1]) };
  }
  const ranges = startHits.map((s) => {
    const e = text.indexOf(z, s + a.length);
    return e >= 0 ? { s, e: e + z.length - 1 } : null;
  }).filter((x): x is { s: number; e: number } => !!x);
  if (!ranges.length) throw new AiError('bad_request', `Found “${a.slice(0, 60)}” but not the end “${z.slice(0, 60)}” after it.`, 400);
  if (ranges.length > 1) throw new AiError('bad_request', `The selection matches ${ranges.length} places in the page. Include more text to make it unique.`, 400);
  return { first: unitAt(map[ranges[0].s]), last: unitAt(map[ranges[0].e]) };
}

/**
 * Character range [start, end) of "start...end" (or a unique snippet) inside one block's rich text, matched like
 * matchSelection (case and whitespace insensitive) against the block's raw text. Null when it isn't there exactly once.
 */
export function textRange(rt: RichText | undefined, selection: string): { start: number; end: number } | null {
  const raw = (rt ?? []).map((d) => d[0]).join('');
  const { text, map } = collapse(raw);
  const sel = selection.trim();
  const dots = sel.indexOf('...');
  const a = norm(dots >= 0 ? sel.slice(0, dots) : sel);
  const z = dots >= 0 ? norm(sel.slice(dots + 3)) : '';
  if (!a && !z) return null;
  const all = (needle: string, from = 0) => {
    const out: number[] = [];
    for (let i = text.indexOf(needle, from); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i);
    return out;
  };
  let s = -1;
  let e = -1;
  if (a && z) {
    const ranges = all(a).map((i) => ({ i, j: text.indexOf(z, i + a.length) })).filter((r) => r.j >= 0);
    if (ranges.length !== 1) return null;
    s = ranges[0].i;
    e = ranges[0].j + z.length - 1;
  } else {
    const needle = a || z;
    const hits = all(needle);
    if (hits.length !== 1) return null;
    s = hits[0];
    e = hits[0] + needle.length - 1;
  }
  return { start: map[s], end: map[e] + 1 };
}

// ---------------------------------------------------------------------------------------------
// Deleting / moving blocks

/** Where a block is listed: the record + path holding its id (null for database rows). */
export function listLocation(b: BlockRecord, userId: string): { table: 'block' | 'team' | 'space' | 'space_view'; id: string; path: string[] } | null {
  if (b.parent_table === 'block') return { table: 'block', id: b.parent_id, path: ['content'] };
  if (b.parent_table === 'team') return { table: 'team', id: b.parent_id, path: ['team_pages'] };
  if (b.parent_table === 'space') {
    const sv = spaceViewOf(userId, b.parent_id);
    if (sv?.private_pages?.includes(b.id)) return { table: 'space_view', id: sv.id, path: ['private_pages'] };
    const space = getRecord<SpaceRecord>('space', b.parent_id);
    if (space?.pages?.includes(b.id)) return { table: 'space', id: space.id, path: ['pages'] };
  }
  return null;
}

/** Ops that move blocks to Trash (remove from their list, alive: false). */
export function deleteOps(blocks: BlockRecord[], userId: string): Operation[] {
  const ops: Operation[] = [];
  const now = Date.now();
  for (const b of blocks) {
    const loc = listLocation(b, userId);
    if (loc) ops.push(mk.listRemove({ table: loc.table, id: loc.id, spaceId: b.space_id }, loc.path, b.id));
    ops.push(mk.update({ table: 'block', id: b.id, spaceId: b.space_id }, [], { alive: false, deleted_time: now, deleted_by_id: userId }));
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Parents

export type Parent =
  | { kind: 'page'; id: string; spaceId: string; title: string }
  | { kind: 'database'; collectionId: string; blockId: string; spaceId: string; title: string }
  | { kind: 'teamspace'; id: string; spaceId: string; title: string }
  | { kind: 'private'; spaceId: string; spaceViewId: string; title: string };

export interface ParentInput {
  type?: string;
  id?: string;
}

/**
 * The database (collection) behind a database page / inline database block / linked view / data source id, as `userId`
 * may see it. A linked view in a page they can open says nothing about its source: they get the source only when they
 * can open it (else "not found" — no name, schema or options), and only the properties they may see ("No access"
 * properties don't exist for them.
 */
export function databaseOf(id: string, userId: string): { col: CollectionRecord; block: BlockRecord } {
  const nid = normalizeId(id);
  let col = getRecord<CollectionRecord>('collection', nid);
  let block = col ? getRecord<BlockRecord>('block', col.parent_id) : getRecord<BlockRecord>('block', nid);
  if (!col && block?.collection_id) col = getRecord<CollectionRecord>('collection', block.collection_id);
  const visible = col && block && block.alive !== false && inScope(block.space_id) && blockRole(block.id, userId) !== 'none' ? visibleCollection(col, userId) : null;
  if (!visible || !block) throw new AiError('not_found', 'That database doesn’t exist or the user can’t access it.', 404);
  return { col: visible, block };
}

export function resolveParent(input: ParentInput | undefined, userId: string, spaceId: string, fallbackPageId?: string | null): Parent {
  const type = input?.type ?? (fallbackPageId ? 'page' : 'private');
  const id = input?.id ?? (input?.type ? undefined : fallbackPageId ?? undefined);
  if (type === 'private' || (type === 'page' && !id)) {
    const sv = spaceViewOf(userId, spaceId);
    if (!sv) {
      // a custom agent (bot principal) has no private pages: it creates pages where it was given edit access
      if ((getRecord('lit_user', userId) as { bot?: unknown } | undefined)?.bot) {
        throw new AiError('bad_request', 'Custom agents do not have private pages. Create this page inside a page or database you can edit (parent {"type": "page", "id": …} or {"type": "database", "id": …}).', 400);
      }
      throw new AiError('forbidden', 'The user isn’t a member of this workspace.', 403);
    }
    return { kind: 'private', spaceId, spaceViewId: sv.id, title: 'Private' };
  }
  if (type === 'teamspace') {
    const t = getRecord<TeamRecord>('team', String(id ?? ''));
    if (!t || t.alive === false || t.space_id !== spaceId) throw new AiError('not_found', 'That team does not exist.', 404);
    const inTeam = (t.membership ?? []).some((m) => m.user_id === userId);
    if (!isSpaceMember(getRecord<SpaceRecord>('space', spaceId), userId) || (!inTeam && (t.settings?.type ?? 'open') !== 'open')) {
      throw new AiError('forbidden', `The user cannot add pages to the team “${t.name}”.`, 403);
    }
    return { kind: 'teamspace', id: t.id, spaceId, title: t.name };
  }
  if (type === 'database') {
    const { col, block } = databaseOf(String(id ?? ''), userId);
    if (!canAddRows(block, userId)) throw new AiError('forbidden', `The user can only view the database “${toPlainText(col.name) || 'Untitled'}”.`, 403);
    return { kind: 'database', collectionId: col.id, blockId: block.id, spaceId: block.space_id, title: toPlainText(col.name) || 'Untitled' };
  }
  const page = readableBlock(String(id), userId);
  if (page.type === 'collection_view_page' || page.type === 'collection_view') return resolveParent({ type: 'database', id: page.id }, userId, spaceId);
  if (!canEdit(page.id, userId)) throw new AiError('forbidden', `The user can only view “${blockTitle(page) || 'Untitled'}”, so nothing can be added there.`, 403);
  return { kind: 'page', id: page.id, spaceId: page.space_id, title: blockTitle(page) || 'Untitled' };
}

/** Root block placement for a new page / database under a parent: parent ref + list op + extra fields. */
export function placeUnder(b: OpsBuilder, parent: Parent, userId: string, spec: Spec, opts: { first?: boolean } = {}): string {
  if (parent.kind === 'page') {
    const id = b.block(spec, parent.id, 'block');
    b.ops.push(mk.listAfter({ table: 'block', id: parent.id, spaceId: parent.spaceId }, ['content'], id));
    return id;
  }
  if (parent.kind === 'teamspace') {
    const id = b.block(spec, parent.id, 'team');
    b.ops.push(mk.listAfter({ table: 'team', id: parent.id, spaceId: parent.spaceId }, ['team_pages'], id));
    return id;
  }
  if (parent.kind === 'private') {
    const id = b.block(spec, parent.spaceId, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }] });
    const pointer = { table: 'space_view' as const, id: parent.spaceViewId, spaceId: parent.spaceId };
    b.ops.push(opts.first === false ? mk.listAfter(pointer, ['private_pages'], id) : mk.listBefore(pointer, ['private_pages'], id));
    return id;
  }
  throw new AiError('bad_request', 'Use database rows for database parents.', 400);
}

/** Move ops for an existing page to a new parent (permissions: private pages get the mover as their only editor). */
export function moveOps(page: BlockRecord, parent: Parent, userId: string): Operation[] {
  const ops: Operation[] = [];
  const loc = listLocation(page, userId);
  if (loc) ops.push(mk.listRemove({ table: loc.table, id: loc.id, spaceId: page.space_id }, loc.path, page.id));
  const ptr = { table: 'block' as const, id: page.id, spaceId: page.space_id };
  if (parent.kind === 'page') {
    ops.push(mk.update(ptr, [], { parent_id: parent.id, parent_table: 'block' }));
    ops.push(mk.listAfter({ table: 'block', id: parent.id, spaceId: parent.spaceId }, ['content'], page.id));
  } else if (parent.kind === 'teamspace') {
    ops.push(mk.update(ptr, [], { parent_id: parent.id, parent_table: 'team' }));
    ops.push(mk.listAfter({ table: 'team', id: parent.id, spaceId: parent.spaceId }, ['team_pages'], page.id));
  } else if (parent.kind === 'private') {
    ops.push(mk.update(ptr, [], { parent_id: parent.spaceId, parent_table: 'space', permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }] }));
    ops.push(mk.listBefore({ table: 'space_view', id: parent.spaceViewId, spaceId: parent.spaceId }, ['private_pages'], page.id));
  } else {
    ops.push(mk.update(ptr, [], { parent_id: parent.collectionId, parent_table: 'collection' }));
  }
  return ops;
}

/** Is `ancestorId` the page itself or one of its ancestors (moving a page into its own subtree)? */
export function isAncestor(ancestorId: string, blockId: string): boolean {
  let cur = getRecord<BlockRecord>('block', blockId);
  for (let i = 0; i < 200 && cur; i++) {
    if (cur.id === ancestorId) return true;
    if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const c = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = c ? getRecord<BlockRecord>('block', c.parent_id) : undefined;
    } else break;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Database values

const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

function members(spaceId: string): UserRecord[] {
  const space = getRecord<SpaceRecord>('space', spaceId);
  return (space?.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => getRecord<UserRecord>('lit_user', p.user_id!)).filter((u): u is UserRecord => !!u);
}

/** People by user id, email or (unique) name among the workspace members. */
export function resolvePeople(spaceId: string, names: string[]): { ids: string[]; unknown: string[] } {
  const all = members(spaceId);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const n = raw.replace(/^@/, '').trim().toLowerCase();
    if (!n) continue;
    const hit = all.find((u) => u.id === n || u.email?.toLowerCase() === n) ?? all.filter((u) => (u.name ?? '').toLowerCase() === n)[0] ?? all.filter((u) => (u.name ?? '').toLowerCase().startsWith(n))[0];
    if (hit) ids.push(hit.id);
    else unknown.push(raw);
  }
  return { ids, unknown };
}

function parseDateInput(v: unknown): import('@nc/shared/richtext.ts').DateValue | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const start = parseDateInput(o.start ?? o.date ?? o.start_date);
    if (!start) return null;
    const end = o.end ?? o.end_date ? parseDateInput(o.end ?? o.end_date) : null;
    if (!end) return start;
    const timed = !!start.start_time || !!end.start_time;
    return { type: timed ? 'datetimerange' : 'daterange', start_date: start.start_date, ...(start.start_time ? { start_time: start.start_time } : {}), end_date: end.start_date, ...(end.start_time ? { end_time: end.start_time } : {}) };
  }
  const s = String(v ?? '').trim();
  const range = s.split(/\s*(?:→|->|–|—|\bto\b)\s*/);
  if (range.length === 2 && range[0] && range[1]) return parseDateInput({ start: range[0], end: range[1] });
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s);
  if (!m) return null;
  return m[2] ? { type: 'datetime', start_date: m[1], start_time: m[2] } : { type: 'date', start_date: m[1] };
}

export interface EncodedValues {
  properties: Record<string, RichText>;
  /** properties whose schema gains new select options */
  schemaPatch: Record<string, PropertySchema>;
  errors: string[];
  title?: RichText;
}

const READ_ONLY = new Set(['formula', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'auto_increment_id', 'button', 'verification']);

/** Model-supplied values ({"Status": "Done", …}) → encoded row properties for a database schema. */
export function encodeValues(col: CollectionRecord, values: Record<string, unknown>, userId: string): EncodedValues {
  const out: EncodedValues = { properties: {}, schemaPatch: {}, errors: [] };
  const schema = col.schema;
  const byName = new Map<string, string>();
  for (const [pid, p] of Object.entries(schema)) byName.set(p.name.trim().toLowerCase(), pid);
  for (const [name, raw] of Object.entries(values ?? {})) {
    const pid = name === 'title' ? Object.keys(schema).find((k) => schema[k].type === 'title') ?? 'title' : byName.get(name.trim().toLowerCase()) ?? (schema[name] ? name : undefined);
    if (!pid || !schema[pid]) {
      out.errors.push(`Unknown property “${name}”. Properties: ${Object.values(schema).map((p) => p.name).join(', ')}.`);
      continue;
    }
    const prop = out.schemaPatch[pid] ?? schema[pid];
    const type = pid === 'title' ? 'title' : prop.type;
    if (READ_ONLY.has(type)) {
      out.errors.push(`“${prop.name}” is computed and can’t be set.`);
      continue;
    }
    const list = (Array.isArray(raw) ? raw : raw === null || raw === undefined || raw === '' ? [] : String(raw).split(type === 'multi_select' || type === 'person' || type === 'relation' ? ',' : /\u0000/)).map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '');
    let enc: RichText | undefined;
    switch (type) {
      case 'title':
        out.title = inlineRichText(String(raw ?? ''));
        enc = out.title;
        break;
      case 'text':
      case 'url':
      case 'email':
      case 'phone_number':
        enc = type === 'text' ? inlineRichText(String(raw ?? '')) : (String(raw ?? '').trim() ? [[String(raw).trim()]] : undefined);
        break;
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[^0-9.\-]/g, ''));
        if (raw === null || raw === '' || !Number.isFinite(n)) {
          if (raw !== null && raw !== '') out.errors.push(`“${prop.name}” needs a number.`);
          enc = undefined;
        } else enc = encodeNumber(n);
        break;
      }
      case 'checkbox':
        enc = encodeCheckbox(raw === true || /^(yes|true|1|checked|done|x)$/i.test(String(raw ?? '')));
        break;
      case 'select':
      case 'status':
      case 'multi_select': {
        const names = list.map(String).slice(0, type === 'multi_select' ? 50 : 1);
        const opts: SelectOption[] = [...(prop.options ?? [])];
        const picked: string[] = [];
        for (const n of names) {
          const hit = opts.find((o) => o.value.toLowerCase() === n.toLowerCase());
          if (hit) picked.push(hit.value);
          else if (type === 'status') out.errors.push(`“${n}” isn’t a status of “${prop.name}”. Options: ${opts.map((o) => o.value).join(', ')}.`);
          else {
            const o = { id: newId(), value: n.replace(/,/g, ' ').slice(0, 100), color: OPTION_COLORS[(opts.length + 1) % OPTION_COLORS.length] };
            opts.push(o);
            picked.push(o.value);
            out.schemaPatch[pid] = { ...prop, options: opts };
          }
        }
        enc = encodeSelect(picked);
        break;
      }
      case 'date': {
        const d = raw === null || raw === '' ? null : parseDateInput(raw);
        if (raw !== null && raw !== '' && !d) out.errors.push(`“${prop.name}” needs a date like 2026-10-24 or 2026-10-24 14:00.`);
        enc = d ? encodeDate(d) : undefined;
        break;
      }
      case 'person': {
        const r = resolvePeople(col.space_id, list.map(String));
        if (r.unknown.length) out.errors.push(`No workspace member matches ${r.unknown.map((x) => `“${x}”`).join(', ')}.`);
        enc = encodePeople(r.ids);
        break;
      }
      case 'relation': {
        const ids = list.map((x) => normalizeId(x)).filter((x) => {
          const b = getRecord<BlockRecord>('block', x);
          return !!b && b.alive !== false && b.space_id === col.space_id && blockRole(x, userId) !== 'none';
        });
        if (ids.length < list.length) out.errors.push(`Some related pages of “${prop.name}” weren’t found (use page ids).`);
        enc = encodeRelation(ids);
        break;
      }
      default:
        enc = String(raw ?? '').trim() ? [[String(raw).trim()]] : undefined;
    }
    out.properties[pid] = enc ?? [];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Databases

const PROPERTY_TYPES = new Set(['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone_number', 'files', 'created_time', 'last_edited_time', 'formula']);

export interface PropertyInput {
  name: string;
  type: string;
  options?: string[];
  /** formula properties */
  expression?: string;
}

/** Formula expressions of the given properties keyed by property id (OpsBuilder doesn't know formulas). */
export function formulaPatch(ids: Record<string, string>, props: PropertyInput[]): Record<string, { expression: string }> {
  const out: Record<string, { expression: string }> = {};
  for (const p of props) {
    if (p.type !== 'formula') continue;
    const pid = ids[p.name.trim().toLowerCase()];
    if (pid) out[pid] = { expression: String(p.expression ?? '').slice(0, 2000) };
  }
  return out;
}

/** Database spec from the model's property / view / row lists (a title property is added when missing). */
export function databaseSpec(title: string, props: PropertyInput[] = [], views: { type: string; name?: string; group_by?: string }[] = [], rows: Record<string, unknown>[] = []): { spec: DbSpec; ids: Record<string, string> } {
  const schema: DbSpec['schema'] = {};
  const ids: Record<string, string> = {};
  const titleProp = props.find((p) => p.type === 'title');
  schema.title = { name: titleProp?.name?.trim() || 'Name', type: 'title' };
  ids[schema.title.name.toLowerCase()] = 'title';
  for (const p of props) {
    if (p === titleProp || !PROPERTY_TYPES.has(p.type)) continue;
    const name = p.name.trim().slice(0, 100);
    if (!name || ids[name.toLowerCase()]) continue;
    const pid = shortPropId();
    schema[pid] = { name, type: p.type as any, ...(p.options?.length ? { options: p.options.map((o) => String(o).slice(0, 100)) } : {}) };
    ids[name.toLowerCase()] = pid;
  }
  const viewSpecs: DbViewSpec[] = (views.length ? views : [{ type: 'table' }]).map((v) => ({
    type: (['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(v.type) ? v.type : 'table') as DbViewSpec['type'],
    ...(v.name ? { name: v.name.slice(0, 100) } : {}),
    ...(v.group_by && ids[v.group_by.toLowerCase()] ? { groupBy: ids[v.group_by.toLowerCase()] } : {}),
  }));
  const rowSpecs = rows.slice(0, 100).map((r) => {
    const values: Record<string, any> = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      const pid = k === 'title' ? 'title' : ids[k.trim().toLowerCase()];
      if (pid) values[pid] = Array.isArray(v) ? v.map(String) : typeof v === 'object' && v ? v : v;
    }
    return { values };
  });
  return { spec: { name: title.slice(0, 200), schema, rows: rowSpecs, views: viewSpecs }, ids };
}

// ---------------------------------------------------------------- charts, forms, dashboards 

/** A view the agent asks for: the plain layouts plus chart (DB-CHART), form  and dashboard . */
export interface AgentViewInput {
  type: string;
  name?: string;
  group_by?: string;
  chart_type?: string;
  aggregate?: { function?: string; property?: string };
  questions?: { property: string; required?: boolean; long_answer?: boolean }[];
  description?: string;
  widgets?: AgentViewInput[];
}

export const SPECIAL_VIEW_TYPES = new Set(['chart', 'form', 'dashboard']);
const CHART_TYPES = new Set(['column', 'bar', 'line', 'donut', 'number']);
const AGGREGATORS = new Set(['count', 'sum', 'average', 'median', 'min', 'max']);
const FORM_QUESTION_TYPES = new Set(['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone_number', 'file', 'relation']);

/** chart_config of a chart view (the client's chartModel shapes: groups_reducer / number_reducer). */
export function chartConfigFor(v: AgentViewInput, schema: Record<string, PropertySchema>): Record<string, unknown> {
  const byName = (n: string | undefined) => (n ? Object.keys(schema).find((k) => k === n || schema[k].name.toLowerCase() === n.trim().toLowerCase()) : undefined);
  const fn = AGGREGATORS.has(String(v.aggregate?.function)) ? String(v.aggregate!.function) : 'count';
  const valueProp = byName(v.aggregate?.property);
  const aggregation = fn === 'count' || !valueProp || schema[valueProp]?.type !== 'number' ? { aggregator: 'count' } : { aggregator: fn, property: valueProp };
  const type = CHART_TYPES.has(String(v.chart_type)) ? String(v.chart_type) : 'column';
  if (type === 'number') return { type: 'number', dataConfig: { type: 'number_reducer', aggregationConfig: { aggregation } }, chartFormat: {} };
  const ids = Object.keys(schema);
  const pref = [['select', 'multi_select', 'status'], ['person', 'date', 'checkbox', 'created_time', 'created_by']];
  const gid = byName(v.group_by) ?? pref.map((types) => ids.find((id) => types.includes(schema[id].type))).find(Boolean) ?? 'title';
  const gp = schema[gid];
  const groupBy: Record<string, unknown> = { property: gid, type: gp?.type ?? 'title', hideEmptyGroups: false, sort: { type: type === 'donut' ? 'ascending' : 'manual' } };
  if (gp && ['date', 'created_time', 'last_edited_time'].includes(gp.type)) groupBy.groupBy = 'month';
  if (gp?.type === 'number') groupBy.groupBy = { type: 'unique' };
  if (gp && (gp.type === 'text' || gp.type === 'title')) groupBy.groupBy = 'exact';
  if (type === 'donut') {
    return { type: 'donut', dataConfig: { type: 'groups_reducer', groupBy, aggregationConfig: { aggregation } }, chartFormat: { mainSort: 'y-descending', donutDataLabels: 'value' } };
  }
  return { type, dataConfig: { type: 'groups_reducer', groupBy, aggregationConfig: { aggregation, seriesFormat: { displayType: type } } }, chartFormat: { axisHideEmptyGroups: false, mainSort: 'manual' } };
}

/** form_config of a form view: the title plus the asked properties (all answerable ones when none are named). */
export function formConfigFor(v: AgentViewInput, schema: Record<string, PropertySchema>, ownerId: string): Record<string, unknown> {
  const byName = (n: string) => Object.keys(schema).find((k) => k === n || schema[k].name.toLowerCase() === n.trim().toLowerCase());
  const asked = v.questions?.length
    ? v.questions.map((q) => ({ pid: byName(q.property), q })).filter((x): x is { pid: string; q: NonNullable<AgentViewInput['questions']>[number] } => !!x.pid && FORM_QUESTION_TYPES.has(schema[x.pid].type))
    : Object.keys(schema).filter((k) => k !== 'title' && FORM_QUESTION_TYPES.has(schema[k].type)).map((pid) => ({ pid, q: { property: pid } as { property: string; required?: boolean; long_answer?: boolean } }));
  const list = asked.some((x) => x.pid === 'title') ? asked : [{ pid: 'title', q: { property: 'title', required: true } as { property: string; required?: boolean; long_answer?: boolean } }, ...asked];
  const seen = new Set<string>();
  const questions = list.filter((x) => !seen.has(x.pid) && seen.add(x.pid)).slice(0, 50).map(({ pid, q }) => ({
    id: newId(),
    config: {
      propertyId: pid, shouldSyncQuestionNameToPropertyName: true,
      ...(q.required || pid === 'title' ? { isRequired: true } : {}),
      ...(q.long_answer && schema[pid].type === 'text' ? { isLongAnswer: true } : {}),
    },
  }));
  return {
    version: 1, title: (v.name ?? 'Form').slice(0, 200), ...(v.description ? { description: v.description.slice(0, 2000) } : {}), questions,
    permission: 'space', anonymous: false, submissionAccess: 'none', ownerId, initialized: true,
  };
}

/**
 * Ops for chart / form / dashboard views of a database block (`listed`: the main view goes into the tab bar). A dashboard
 * gets its widget views (format.dashboard_view_id) laid out up to 4 per row, 12 at most .
 */
export function specialViewOps(spaceId: string, blockId: string, collectionId: string, schema: Record<string, PropertySchema>, v: AgentViewInput, ownerId: string): { ops: Operation[]; viewId: string } {
  const ops: Operation[] = [];
  const view = (type: string, name: string, format: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const id = newId();
    ops.push(mk.set({ table: 'collection_view', id, spaceId }, [], {
      id, type, name, format: { ...format, ...extra }, query2: {}, parent_id: blockId, parent_table: 'block', alive: true, space_id: spaceId, page_sort: [],
    }));
    return id;
  };
  const plainFormat = (type: string): Record<string, unknown> => {
    const tmp = new OpsBuilder(spaceId, '');
    tmp.database({ name: '', schema: Object.fromEntries(Object.entries(schema).map(([pid, p]) => [pid, { name: p.name, type: p.type as any }])), rows: [], views: [{ type: type as any }] }, blockId);
    return ((tmp.ops.find((o) => o.pointer.table === 'collection_view')?.args ?? {}) as { format?: Record<string, unknown> }).format ?? {};
  };
  const VIEW_LABEL: Record<string, string> = { chart: 'Chart', form: 'Form', dashboard: 'Dashboard', table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar', timeline: 'Timeline' };
  let viewId: string;
  if (v.type === 'chart') viewId = view('chart', v.name || 'Chart', { chart_config: chartConfigFor(v, schema) });
  else if (v.type === 'form') viewId = view('form', v.name || 'Form', { form_config: formConfigFor(v, schema, ownerId) });
  else {
    viewId = newId();
    const widgets = (v.widgets?.length ? v.widgets : [{ type: 'chart' }, { type: 'chart', chart_type: 'number' }, { type: 'table' }] as AgentViewInput[]).slice(0, 12);
    const rows: { id: string; height: number; widgets: { id: string; view_id: string }[] }[] = [];
    for (const w of widgets) {
      const wtype = w.type === 'chart' || ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(w.type) ? w.type : 'chart';
      const wid = wtype === 'chart'
        ? view('chart', w.name || 'Chart', { chart_config: chartConfigFor(w, schema) }, { dashboard_view_id: viewId })
        : view(wtype, w.name || VIEW_LABEL[wtype] || 'View', plainFormat(wtype), { dashboard_view_id: viewId });
      const last = rows[rows.length - 1];
      if (last && last.widgets.length < 4 && (wtype === 'chart' || last.widgets.length < 2)) last.widgets.push({ id: newId(), view_id: wid });
      else rows.push({ id: newId(), height: 460, widgets: [{ id: newId(), view_id: wid }] });
    }
    ops.push(mk.set({ table: 'collection_view', id: viewId, spaceId }, [], {
      id: viewId, type: 'dashboard', name: v.name || 'Dashboard', format: { dashboard_layout: { rows } }, query2: {}, parent_id: blockId, parent_table: 'block', alive: true, space_id: spaceId, page_sort: [],
    }));
  }
  ops.push(mk.listAfter({ table: 'block', id: blockId, spaceId }, ['view_ids'], viewId));
  void collectionId;
  return { ops, viewId };
}

/** Ops adding views to an existing database block. */
export function addViewOps(spaceId: string, block: BlockRecord, col: CollectionRecord, views: AgentViewInput[], ownerId = ''): { ops: Operation[]; viewIds: string[] } {
  const ops: Operation[] = [];
  const viewIds: string[] = [];
  const byName = new Map(Object.entries(col.schema).map(([pid, p]) => [p.name.toLowerCase(), pid]));
  for (const v of views) {
    if (SPECIAL_VIEW_TYPES.has(v.type)) {
      const sv = specialViewOps(spaceId, block.id, col.id, col.schema, v, ownerId);
      ops.push(...sv.ops);
      viewIds.push(sv.viewId);
      continue;
    }
    const type = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(v.type) ? v.type : 'table';
    // build through a throwaway OpsBuilder database to reuse the view defaults
    const tmp = new OpsBuilder(spaceId, '');
    const gid = v.group_by ? byName.get(v.group_by.toLowerCase()) : undefined;
    tmp.database({ name: '', schema: Object.fromEntries(Object.entries(col.schema).map(([pid, p]) => [pid, { name: p.name, type: p.type as any }])), rows: [], views: [{ type: type as any, ...(v.name ? { name: v.name } : {}), ...(gid ? { groupBy: gid } : {}) }] }, block.id);
    const viewOp = tmp.ops.find((o) => o.pointer.table === 'collection_view');
    if (!viewOp) continue;
    const vid = newId();
    const value = { ...(viewOp.args as Record<string, unknown>), id: vid, page_sort: [] };
    // board grouping must reference the real select / status options
    ops.push({ ...viewOp, pointer: { table: 'collection_view', id: vid, spaceId }, args: value });
    ops.push(mk.listAfter({ table: 'block', id: block.id, spaceId }, ['view_ids'], vid));
    viewIds.push(vid);
  }
  return { ops, viewIds };
}

/** Current views of a database block. */
export function viewsOf(block: BlockRecord): CollectionViewRecord[] {
  return (block.view_ids ?? []).map((id) => getRecord<CollectionViewRecord>('collection_view', id)).filter((v): v is CollectionViewRecord => !!v && v.alive !== false);
}
