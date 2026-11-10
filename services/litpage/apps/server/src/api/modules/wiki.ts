// Wikis and page verification.
//   turnIntoWiki { pageId }   ••• › More › Turn into wiki: the page becomes a wiki database (collection_view_page that
//                             keeps its blocks as the "Home" view) with Owner / Verification / Tags / Last edited;
//                             its sub-pages become wiki pages (rows) owned by their creators. Full access, plain pages only.
//   undoWiki { pageId }       ••• › More › Undo wiki: back to a normal page — the database, its views and page properties go.
//   setPageVerification { pageId, verified, expiry }   Verify page (until `expiry` ms or indefinitely = null) / Remove
//                             verification. Wiki pages use the Verification property (owners = Owner property); other
//                             pages keep it in format.page_verification (Business+). Owners only once a page has owners.
//                             Expiry → Inbox notification to the owners (scheduler job 'verification_expiry').
//   setPageOwners { pageId, owners }   owners of a non-database page's verification (at least one while verified).
//   getVerifiedPages { spaceId, query?, ownerId?, status? }   Settings › Verified pages.
// Pages created inside a wiki's Home become wiki pages too (commit hook).
import { newId } from '@nc/shared/ids.ts';
import { isSpaceAdmin, isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { isArchived } from '@nc/shared/archive.ts';
import { encodePeople, encodeVerificationValue, makeVerification, personIds, readVerification, verificationProperty } from '@nc/shared/verification.ts';
import { childrenOf, db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole, onCommit } from '../../records.ts';
import { cancelJob, registerJobHandler, scheduleJob } from '../../scheduler.ts';
import { pushNotification } from '../../notify.ts';
import { childBlocks } from '../../tree.ts';

type Handler = (ctx: Ctx, body: any) => any;

export const OWNER_PROP = 'verification_owner';
export const VERIFICATION_PROP = 'verification';
const TAGS_PROP = 'wiki_tags';
const EDITED_PROP = 'wiki_last_edited';
const MAX_EXPIRY_MS = 10 * 365 * 86400_000;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function pageOrThrow(pageId: unknown, uid: string, min: 'read_and_write' | 'editor' | 'reader'): BlockRecord {
  const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
  const role = page ? blockRole(page.id, uid) : 'none';
  if (!page || role === 'none') throw new ApiError('Not found', 404);
  if (!roleAtLeast(role, min)) throw new ApiError(min === 'editor' ? 'You need full access to do this' : 'Not allowed', 403);
  if (!page.alive) throw new ApiError('Restore this page from Trash first', 400);
  return page;
}

const archiveLookup = {
  block: (id: string) => getRecord<BlockRecord>('block', id),
  collection: (id: string) => getRecord<CollectionRecord>('collection', id),
  team: (id: string) => getRecord<TeamRecord>('team', id),
};

export function isWikiBlock(b: BlockRecord | undefined): boolean {
  if (!b || b.type !== 'collection_view_page' || !b.collection_id) return false;
  return !!(getRecord<CollectionRecord>('collection', b.collection_id)?.format as Record<string, unknown> | undefined)?.is_wiki;
}

function isWikiCollection(c: CollectionRecord | undefined): boolean {
  return !!(c?.format as Record<string, unknown> | undefined)?.is_wiki;
}

const businessPlan = (space: SpaceRecord | undefined) => space?.plan_type === 'business' || space?.plan_type === 'enterprise';

function commit(uid: string, spaceId: string, operations: any[], action: string) {
  const changes = applyTransactions(uid, [{ id: newId(), spaceId, debug: { userAction: action }, operations } as any]);
  const rm = new RecordMapBuilder(uid);
  for (const ch of changes) rm.add(ch.table, ch.record);
  return rm.map;
}

const ptr = (table: string, id: string, spaceId: string) => ({ table, id, spaceId });

function titleOf(b: BlockRecord | undefined): string {
  if (!b) return 'Untitled';
  if (b.type === 'collection_view_page' && b.collection_id) {
    const t = toPlainText(getRecord<CollectionRecord>('collection', b.collection_id)?.name);
    if (t) return t;
  }
  return toPlainText(b.properties?.title) || 'Untitled';
}

// ---------------------------------------------------------------- verification expiry → Inbox

/** (Re)schedule the expiry notice for a page's current verification (or cancel it). */
function scheduleExpiry(pageId: string) {
  const page = getRecord<BlockRecord>('block', pageId);
  const col = page?.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', page.parent_id) : undefined;
  const info = readVerification(page, col);
  const key = `verification:${pageId}`;
  if (info.status === 'verified' && info.expiryTime) scheduleJob('verification_expiry', key, info.expiryTime, { pageId, expiry: info.expiryTime });
  else cancelJob(key);
}

registerJobHandler('verification_expiry', (payload: { pageId?: string; expiry?: number }) => {
  const page = payload?.pageId ? getRecord<BlockRecord>('block', payload.pageId) : undefined;
  if (!page || !page.alive) return;
  const col = page.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', page.parent_id) : undefined;
  const info = readVerification(page, col);
  // re-verified or removed since the job was scheduled
  if (info.status !== 'expired' || info.expiryTime !== payload.expiry) return;
  const recipients = new Set(info.owners.length ? info.owners : info.verifiedBy ? [info.verifiedBy] : []);
  const kind = isWikiCollection(col) ? 'wiki' : 'page';
  for (const userId of recipients) {
    if (blockRole(page.id, userId) === 'none') continue;
    pushNotification({
      user_id: userId, space_id: page.space_id, type: 'verification_expired', navigable_block_id: page.id, actor_id: info.verifiedBy,
      activity: { kind, expiry_time: info.expiryTime, verified_time: info.verifiedTime, verified_by: info.verifiedBy },
    });
  }
});

// ---------------------------------------------------------------- wiki: new pages in Home become wiki pages

onCommit((info) => {
  const created: BlockRecord[] = [];
  for (const ch of info.changes) {
    if (ch.table !== 'block' || info.prev.get(`block:${ch.record.id}`)) continue;
    const b = ch.record as BlockRecord;
    if (b.type === 'page' && b.parent_table === 'block' && b.alive) created.push(b);
  }
  if (!created.length) return;
  const byWiki = new Map<string, BlockRecord[]>();
  for (const b of created) {
    const parent = getRecord<BlockRecord>('block', b.parent_id);
    if (!isWikiBlock(parent)) continue;
    byWiki.set(parent!.id, [...(byWiki.get(parent!.id) ?? []), b]);
  }
  if (!byWiki.size) return;
  // after this commit's response: move each new page under the wiki's database, owned by its creator
  setTimeout(() => {
    for (const [wikiId, pages] of byWiki) {
      const wiki = getRecord<BlockRecord>('block', wikiId);
      if (!wiki?.collection_id) continue;
      const ops = pages.map((p) => getRecord<BlockRecord>('block', p.id)).filter((p): p is BlockRecord => !!p && p.parent_id === wikiId && p.parent_table === 'block')
        .map((p) => ({
          pointer: ptr('block', p.id, p.space_id), path: [], command: 'update',
          args: { parent_id: wiki.collection_id, parent_table: 'collection', properties: { ...(p.properties ?? {}), [OWNER_PROP]: encodePeople([p.created_by_id]) } },
        }));
      if (!ops.length) continue;
      try {
        applyTransactions(info.userId, [{ id: newId(), spaceId: wiki.space_id, debug: { userAction: 'wikiAdoptPage' }, operations: ops } as any]);
      } catch (e) {
        console.error('[wiki] could not adopt new page', e);
      }
    }
  }, 0);
});

// ---------------------------------------------------------------- handlers

export const handlers: Record<string, Handler> = {
  turnIntoWiki(ctx, { pageId }) {
    const uid = requireUser(ctx);
    const page = pageOrThrow(pageId, uid, 'editor');
    if (page.type !== 'page' || page.parent_table === 'collection') throw new ApiError('Only pages can be turned into wikis', 400);
    if (page.is_template) throw new ApiError('Templates can’t be turned into wikis', 400);
    const sp = page.space_id;
    const colId = newId();
    const homeId = newId();
    const allId = newId();
    const mineId = newId();
    const now = Date.now();
    const columns = [
      { property: 'title', visible: true, width: 280 },
      { property: OWNER_PROP, visible: true, width: 160 },
      { property: VERIFICATION_PROP, visible: true, width: 180 },
      { property: TAGS_PROP, visible: true, width: 180 },
      { property: EDITED_PROP, visible: true, width: 200 },
    ];
    const base = { parent_id: page.id, parent_table: 'block', alive: true, space_id: sp };
    const ops: any[] = [
      {
        pointer: ptr('collection', colId, sp), path: [], command: 'set',
        args: {
          id: colId, ...base, name: page.properties?.title ?? [], ...(page.format?.page_icon ? { icon: page.format.page_icon } : {}),
          schema: {
            title: { name: 'Page', type: 'title' },
            [OWNER_PROP]: { name: 'Owner', type: 'person' },
            [VERIFICATION_PROP]: { name: 'Verification', type: 'verification', verifier_property: OWNER_PROP },
            [TAGS_PROP]: { name: 'Tags', type: 'multi_select', options: [] },
            [EDITED_PROP]: { name: 'Last edited', type: 'last_edited_time' },
          },
          format: { is_wiki: true, wiki_created_time: now, wiki_created_by: uid },
        },
      },
      { pointer: ptr('collection_view', homeId, sp), path: [], command: 'set', args: { id: homeId, ...base, type: 'page', name: 'Home', format: {} } },
      { pointer: ptr('collection_view', allId, sp), path: [], command: 'set', args: { id: allId, ...base, type: 'table', name: 'All pages', format: { table_properties: columns, table_wrap: true } } },
      {
        pointer: ptr('collection_view', mineId, sp), path: [], command: 'set',
        args: {
          id: mineId, ...base, type: 'table', name: 'Pages I manage',
          format: { table_properties: columns, table_wrap: true, property_filters: [{ id: newId(), filter: { property: OWNER_PROP, filter: { operator: 'person_contains', value: { type: 'relative', value: 'me' } } } }] },
        },
      },
      { pointer: ptr('block', page.id, sp), path: [], command: 'update', args: { type: 'collection_view_page', collection_id: colId, view_ids: [homeId, allId, mineId] } },
    ];
    // sub-pages become wiki pages (rows), owned by whoever created them; they stay where they are on Home
    for (const child of childBlocks(page)) {
      if (child.type !== 'page') continue;
      ops.push({
        pointer: ptr('block', child.id, sp), path: [], command: 'update',
        args: { parent_id: colId, parent_table: 'collection', properties: { ...(child.properties ?? {}), [OWNER_PROP]: encodePeople([child.created_by_id]) } },
      });
    }
    return { collectionId: colId, viewIds: [homeId, allId, mineId], recordMap: commit(uid, sp, ops, 'turnIntoWiki') };
  },

  undoWiki(ctx, { pageId }) {
    const uid = requireUser(ctx);
    const page = pageOrThrow(pageId, uid, 'editor');
    if (!isWikiBlock(page)) throw new ApiError('This page is not a wiki', 400);
    const sp = page.space_id;
    const col = getRecord<CollectionRecord>('collection', page.collection_id!)!;
    const content = [...(page.content ?? [])];
    const ops: any[] = [];
    for (const row of childrenOf<BlockRecord>('block', col.id)) {
      if (row.parent_table !== 'collection') continue;
      // page properties go; the title stays
      ops.push({ pointer: ptr('block', row.id, sp), path: [], command: 'update', args: { parent_id: page.id, parent_table: 'block', properties: { title: row.properties?.title ?? [] } } });
      if (row.alive && !content.includes(row.id)) content.push(row.id);
      cancelJob(`verification:${row.id}`);
    }
    for (const vid of page.view_ids ?? []) {
      const v = getRecord<CollectionViewRecord>('collection_view', vid);
      if (v) ops.push({ pointer: ptr('collection_view', vid, sp), path: [], command: 'update', args: { alive: false } });
    }
    ops.push({ pointer: ptr('collection', col.id, sp), path: [], command: 'update', args: { alive: false } });
    ops.push({ pointer: ptr('block', page.id, sp), path: [], command: 'update', args: { type: 'page', collection_id: null, view_ids: null, content, properties: { ...(page.properties ?? {}), title: (col.name as any) ?? page.properties?.title ?? [] } } });
    return { recordMap: commit(uid, sp, ops, 'undoWiki') };
  },

  setPageVerification(ctx, { pageId, verified, expiry }) {
    const uid = requireUser(ctx);
    const page = pageOrThrow(pageId, uid, 'read_and_write');
    if (isArchived(archiveLookup, page.id)) throw new ApiError('Unarchive this page before verifying it', 400);
    const space = getRecord<SpaceRecord>('space', page.space_id);
    const col = page.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', page.parent_id) : undefined;
    const prop = col ? verificationProperty(col.schema) : null;
    if (col && !prop) throw new ApiError('This database has no Verification property', 400);
    if (page.type !== 'page' && !prop) throw new ApiError('Only pages can be verified', 400);
    // wikis: every plan; any other page or database: Business / Enterprise
    if (!isWikiCollection(col) && !businessPlan(space)) throw new ApiError('Upgrade your plan to edit verification settings', 403);
    const info = readVerification(page, col);
    const admin = isSpaceAdmin(space, uid);
    if (info.owners.length && !info.owners.includes(uid) && !admin) {
      const ownerName = prop?.ownerId ? String(col!.schema[prop.ownerId]?.name ?? 'Owner') : '';
      throw new ApiError(prop?.ownerId ? `Only people named in ${ownerName} can verify this page` : 'Only page owners may verify this page', 403);
    }
    const now = Date.now();
    let exp: number | null = null;
    if (verified) {
      if (expiry !== null && expiry !== undefined) {
        exp = Number(expiry);
        if (!Number.isFinite(exp) || exp <= now || exp > now + MAX_EXPIRY_MS) throw new ApiError('Pick a date in the future', 400);
      }
    }
    const ops: any[] = [];
    if (prop) {
      const value = verified ? makeVerification(uid, now, exp) : null;
      ops.push({ pointer: ptr('block', page.id, page.space_id), path: ['properties', prop.id], command: 'set', args: encodeVerificationValue(value) ?? null });
      // verification needs at least one owner: the verifier becomes one when there is none
      if (verified && prop.ownerId && !info.owners.length) ops.push({ pointer: ptr('block', page.id, page.space_id), path: ['properties', prop.ownerId], command: 'set', args: encodePeople([uid]) });
    } else {
      const owners = info.owners.length ? info.owners : [uid];
      ops.push({ pointer: ptr('block', page.id, page.space_id), path: ['format'], command: 'update', args: { page_verification: verified ? makeVerification(uid, now, exp, owners) : null } });
    }
    const recordMap = commit(uid, page.space_id, ops, verified ? 'verifyPage' : 'removeVerification');
    scheduleExpiry(page.id);
    return { recordMap };
  },

  setPageOwners(ctx, { pageId, owners }) {
    const uid = requireUser(ctx);
    const page = pageOrThrow(pageId, uid, 'read_and_write');
    if (page.parent_table === 'collection') throw new ApiError('Edit the Owner property of database pages', 400);
    const space = getRecord<SpaceRecord>('space', page.space_id);
    if (!businessPlan(space)) throw new ApiError('Upgrade your plan to edit verification settings', 403);
    const list = [...new Set((Array.isArray(owners) ? owners : []).filter((x): x is string => typeof x === 'string'))].slice(0, 50);
    // owners are people who can see the page (workspace members or invited guests)
    for (const id of list) if (!getRecord('lit_user', id) || (!isSpaceMember(space, id) && blockRole(page.id, id) === 'none')) throw new ApiError('Owners must have access to this page', 400);
    const info = readVerification(page);
    const cur = ((page.format as Record<string, unknown> | undefined)?.page_verification ?? null) as Record<string, unknown> | null;
    if (info.status !== 'none' && !list.length) throw new ApiError('Add at least one owner before enabling verification.', 400);
    if (cur && info.owners.length && !info.owners.includes(uid) && !isSpaceAdmin(space, uid)) throw new ApiError('Only page owners can change owners', 403);
    const next = cur ? { ...cur, owners: list } : { state: 'none', owners: list };
    return { recordMap: commit(uid, page.space_id, [{ pointer: ptr('block', page.id, page.space_id), path: ['format'], command: 'update', args: { page_verification: next } }], 'setPageOwners') };
  },

  getVerifiedPages(ctx, { spaceId, query, ownerId, status, limit }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not a member of this workspace', 403);
    const q = String(query ?? '').trim().toLowerCase().slice(0, 200);
    const max = Math.min(Number(limit) || 200, 500);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND (data LIKE '%"page_verification"%' OR data LIKE '%"vr"%') LIMIT 5000`).all(space.id) as { data: string }[];
    const rm = new RecordMapBuilder(uid);
    const out: any[] = [];
    const now = Date.now();
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      if (blockRole(b.id, uid) === 'none') continue;
      const col = b.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', b.parent_id) : undefined;
      const info = readVerification(b, col, now);
      if (info.status === 'none') continue;
      if (status && status !== info.status) continue;
      if (ownerId && !info.owners.includes(String(ownerId))) continue;
      const title = titleOf(b);
      if (q && !title.toLowerCase().includes(q)) continue;
      rm.add('block', b);
      if (col) rm.add('collection', col);
      for (const id of [...info.owners, info.verifiedBy]) if (id) rm.add('lit_user', getRecord('lit_user', id), 'reader');
      out.push({ pageId: b.id, title, status: info.status, verifiedBy: info.verifiedBy, verifiedTime: info.verifiedTime, expiryTime: info.expiryTime, owners: info.owners, wiki: isWikiCollection(col) });
      if (out.length >= max) break;
    }
    out.sort((a, b) => (b.verifiedTime ?? 0) - (a.verifiedTime ?? 0));
    return { pages: out, recordMap: rm.map };
  },
};

export { personIds };
