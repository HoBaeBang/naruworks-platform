// High-level block operations expressed as transactions of record operations

import { newId } from '@nc/shared/ids.ts';
import type { BlockFormat, BlockRecord, BlockType, ParentTable, SpaceViewRecord, Table, TeamRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { diffSplice } from '@nc/shared/textmerge.ts';
import { canHaveChildren, PAGE_LIKE } from '@nc/shared/blocks.ts';
import { records } from './store/records.ts';
import { transactions, type Tx } from './store/transactions.ts';
import { currentSpaceView, useSession } from './store/session.ts';

export function me(): string {
  return useSession.getState().userId ?? '';
}

export function getBlock(id: string | undefined | null): BlockRecord | undefined {
  return records.get<BlockRecord>('block', id);
}

/** Where a block is listed: the parent record + array path that holds its id. */
export function listLocation(block: BlockRecord): { table: Table; id: string; path: string[] } | null {
  if (block.parent_table === 'block') return { table: 'block', id: block.parent_id, path: ['content'] };
  if (block.parent_table === 'team') return { table: 'team', id: block.parent_id, path: ['team_pages'] };
  if (block.parent_table === 'space') {
    const sv = currentSpaceView();
    if (sv?.private_pages?.includes(block.id)) return { table: 'space_view', id: sv.id, path: ['private_pages'] };
    return { table: 'space', id: block.parent_id, path: ['pages'] };
  }
  return null; // collection rows are ordered by views
}

export function siblingsOf(block: BlockRecord): string[] {
  const loc = listLocation(block);
  if (!loc) return [];
  const parent = records.get(loc.table, loc.id) as any;
  let arr: any = parent;
  for (const p of loc.path) arr = arr?.[p];
  return Array.isArray(arr) ? arr : [];
}

export interface NewBlockOptions {
  type: BlockType;
  parentId: string;
  parentTable: ParentTable;
  after?: string;
  before?: string;
  first?: boolean;
  title?: RichText;
  properties?: Record<string, any>;
  format?: BlockFormat;
  content?: string[];
  id?: string;
  extra?: Partial<BlockRecord>;
  /** list target override (e.g. space_view private_pages) */
  list?: { table: Table; id: string; path: string[] } | null;
}

export function blockValue(o: NewBlockOptions, spaceId: string, id: string): BlockRecord {
  const now = Date.now();
  const uid = me();
  const v: BlockRecord = {
    id, version: 0, type: o.type,
    properties: { ...(o.title ? { title: o.title } : {}), ...(o.properties ?? {}) },
    parent_id: o.parentId, parent_table: o.parentTable, space_id: spaceId, alive: true,
    created_time: now, created_by_id: uid, created_by_table: 'lit_user',
    last_edited_time: now, last_edited_by_id: uid, last_edited_by_table: 'lit_user',
    ...(o.format ? { format: o.format } : {}),
    ...(o.content ? { content: o.content } : {}),
    ...(o.extra ?? {}),
  };
  if (!Object.keys(v.properties!).length) delete v.properties;
  return v;
}

export function createBlockIn(tx: Tx, o: NewBlockOptions): string {
  const id = o.id ?? newId();
  // a block lives in its parent's workspace (a guest editing a shared page must not stamp their own space)
  const parentSpace = o.parentTable === 'block' ? getBlock(o.parentId)?.space_id
    : o.parentTable === 'collection' ? (records.get('collection', o.parentId) as { space_id?: string } | undefined)?.space_id
      : undefined;
  const value = blockValue(o, parentSpace || tx.spaceId, id);
  const { version: _v, ...args } = value;
  tx.set('block', id, [], args);
  const list = o.list !== undefined ? o.list : o.parentTable === 'block' ? { table: 'block' as Table, id: o.parentId, path: ['content'] } : o.parentTable === 'team' ? { table: 'team' as Table, id: o.parentId, path: ['team_pages'] } : null;
  if (list) {
    if (o.before) tx.listBefore(list.table, list.id, list.path, id, o.before);
    else if (o.first) tx.listBefore(list.table, list.id, list.path, id);
    else tx.listAfter(list.table, list.id, list.path, id, o.after);
  }
  return id;
}

export function touch(tx: Tx, blockId: string) {
  tx.update('block', blockId, [], { last_edited_time: Date.now(), last_edited_by_id: me(), last_edited_by_table: 'lit_user' });
}

export function setTitle(tx: Tx, blockId: string, title: RichText, base?: RichText) {
  // send the edit as a splice so two people typing in the same block don't overwrite each other; `base` is the
  // value the editor computed `title` from (it can lag behind a remote update the store already holds)
  const prev = base ?? (records.get<BlockRecord>('block', blockId)?.properties?.title as RichText | undefined);
  if (prev?.length) {
    const splice = diffSplice(prev, title);
    if (!splice) return;
    tx.spliceText('block', blockId, ['properties', 'title'], splice);
  } else tx.set('block', blockId, ['properties', 'title'], title);
  touch(tx, blockId);
}

export function setProperty(tx: Tx, blockId: string, prop: string, value: any) {
  tx.set('block', blockId, ['properties', prop], value);
  touch(tx, blockId);
}

export function setFormat(tx: Tx, blockId: string, format: Partial<BlockFormat>) {
  tx.update('block', blockId, ['format'], format);
  touch(tx, blockId);
}

/** Remove blocks from their parents and mark them dead (moves pages to Trash). */
export function deleteBlocksIn(tx: Tx, ids: string[]) {
  for (const id of ids) {
    const b = getBlock(id);
    if (!b) continue;
    const loc = listLocation(b);
    if (loc) tx.listRemove(loc.table, loc.id, loc.path, id);
    // bookmarks pointing at deleted pages disappear from the sidebar
    tx.update('block', id, [], { alive: false, deleted_time: Date.now(), deleted_by_id: me() });
  }
}

export function moveBlocksIn(tx: Tx, ids: string[], target: { parentId: string; parentTable: ParentTable; after?: string; before?: string; first?: boolean; list?: { table: Table; id: string; path: string[] } | null }) {
  let after = target.after;
  for (const id of ids) {
    const b = getBlock(id);
    if (!b) continue;
    const loc = listLocation(b);
    if (loc) tx.listRemove(loc.table, loc.id, loc.path, id);
    tx.update('block', id, [], { parent_id: target.parentId, parent_table: target.parentTable, alive: true });
    const list = target.list !== undefined ? target.list : target.parentTable === 'block' ? { table: 'block' as Table, id: target.parentId, path: ['content'] } : target.parentTable === 'team' ? { table: 'team' as Table, id: target.parentId, path: ['team_pages'] } : null;
    if (list) {
      if (target.before) tx.listBefore(list.table, list.id, list.path, id, target.before);
      else if (target.first && !after) tx.listBefore(list.table, list.id, list.path, id);
      else tx.listAfter(list.table, list.id, list.path, id, after);
    }
    after = id;
    touch(tx, id);
  }
}

export function previousSibling(block: BlockRecord): string | undefined {
  const sibs = siblingsOf(block);
  const i = sibs.indexOf(block.id);
  return i > 0 ? sibs[i - 1] : undefined;
}

export function nextSibling(block: BlockRecord): string | undefined {
  const sibs = siblingsOf(block);
  const i = sibs.indexOf(block.id);
  return i >= 0 && i < sibs.length - 1 ? sibs[i + 1] : undefined;
}

/** Tab: make block the last child of its previous sibling. Returns false if not possible. */
export function indentIn(tx: Tx, blockId: string): boolean {
  const b = getBlock(blockId);
  if (!b || b.parent_table !== 'block') return false;
  const prevId = previousSibling(b);
  const prev = getBlock(prevId);
  if (!prev || PAGE_LIKE.has(prev.type) || !canHaveChildren(prev.type, prev.format?.toggleable) || prev.type === 'column_list' || prev.type === 'table') {
    if (!prev || !['text', 'bulleted_list', 'numbered_list', 'to_do', 'toggle', 'quote', 'callout'].includes(prev.type)) return false;
  }
  const lastChild = prev.content?.[prev.content.length - 1];
  moveBlocksIn(tx, [blockId], { parentId: prev.id, parentTable: 'block', after: lastChild });
  return true;
}

/** Shift+Tab: move block after its parent in the grandparent. */
export function outdentIn(tx: Tx, blockId: string): boolean {
  const b = getBlock(blockId);
  if (!b || b.parent_table !== 'block') return false;
  const parent = getBlock(b.parent_id);
  if (!parent || PAGE_LIKE.has(parent.type) || parent.parent_table !== 'block' || parent.type === 'column') return false;
  
  const sibs = parent.content ?? [];
  const idx = sibs.indexOf(blockId);
  const following = idx >= 0 ? sibs.slice(idx + 1) : [];
  moveBlocksIn(tx, [blockId], { parentId: parent.parent_id, parentTable: 'block', after: parent.id });
  if (following.length) {
    const lastChild = b.content?.[b.content.length - 1];
    moveBlocksIn(tx, following, { parentId: blockId, parentTable: 'block', after: lastChild });
  }
  return true;
}

export function run(userAction: string, fn: (tx: Tx) => void, opts?: Parameters<typeof transactions.run>[3]) {
  const spaceId = useSession.getState().spaceId ?? '';
  return transactions.run(spaceId, userAction, fn, opts);
}

/** New page in the sidebar: private (space_view.private_pages), teamspace, or inside another page. */
export function createPageIn(tx: Tx, where: { kind: 'private' } | { kind: 'team'; teamId: string } | { kind: 'block'; parentId: string; after?: string } | { kind: 'workspace' }, opts?: { title?: RichText; icon?: string; type?: BlockType; id?: string }): string {
  const spaceId = tx.spaceId;
  const uid = me();
  if (where.kind === 'private') {
    const sv = currentSpaceView() as SpaceViewRecord;
    return createBlockIn(tx, {
      id: opts?.id, type: opts?.type ?? 'page', parentId: spaceId, parentTable: 'space', title: opts?.title ?? [],
      format: opts?.icon ? { page_icon: opts.icon } : undefined, first: true,
      list: { table: 'space_view', id: sv.id, path: ['private_pages'] },
      extra: { permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }] },
    });
  }
  if (where.kind === 'workspace') {
    return createBlockIn(tx, {
      id: opts?.id, type: opts?.type ?? 'page', parentId: spaceId, parentTable: 'space', title: opts?.title ?? [],
      format: opts?.icon ? { page_icon: opts.icon } : undefined, list: { table: 'space', id: spaceId, path: ['pages'] },
    });
  }
  if (where.kind === 'team') {
    const team = records.get<TeamRecord>('team', where.teamId);
    void team;
    return createBlockIn(tx, { id: opts?.id, type: opts?.type ?? 'page', parentId: where.teamId, parentTable: 'team', title: opts?.title ?? [], format: opts?.icon ? { page_icon: opts.icon } : undefined });
  }
  return createBlockIn(tx, { id: opts?.id, type: opts?.type ?? 'page', parentId: where.parentId, parentTable: 'block', after: where.after, title: opts?.title ?? [], format: opts?.icon ? { page_icon: opts.icon } : undefined });
}

/** Ancestors from the workspace root down to (excluding) the page itself — for breadcrumbs. */
export function ancestorsOf(blockId: string): BlockRecord[] {
  const out: BlockRecord[] = [];
  let cur = getBlock(blockId);
  for (let i = 0; i < 40 && cur; i++) {
    if (cur.parent_table === 'block') {
      cur = getBlock(cur.parent_id);
      if (cur && (PAGE_LIKE.has(cur.type) || cur.parent_table === 'collection')) out.unshift(cur);
    } else if (cur.parent_table === 'collection') {
      const col = records.get('collection', cur.parent_id) as any;
      cur = getBlock(col?.parent_id);
      if (cur) out.unshift(cur);
    } else break;
  }
  return out;
}

/** The page (or database row) that contains a block. */
export function pageOf(blockId: string): BlockRecord | undefined {
  let cur = getBlock(blockId);
  for (let i = 0; i < 60 && cur; i++) {
    if (PAGE_LIKE.has(cur.type) || cur.parent_table !== 'block') return cur;
    cur = getBlock(cur.parent_id);
  }
  return cur;
}
