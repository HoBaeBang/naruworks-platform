// Notifications and page subscriptions ("Notify me"): the `notification` and `follow` tables.
// Other modules (sharing, comments, requests, reminders, automations) push inbox items through `pushNotification`
// (apps/server/src/notify.ts: Inbox record + realtime badge + email per Settings › Notifications).
import { newId } from '@nc/shared/ids.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, FollowRecord, NotificationRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { pushNotification, updateNotification } from '../../notify.ts';

export { pushNotification, updateNotification };

type Handler = (ctx: Ctx, body: any) => any;
/** Page pages: all_comments / replies_and_mentions; database pages add all_updates / important_updates. */
export type NotifyLevel = 'all_comments' | 'replies_and_mentions' | 'all_updates' | 'important_updates';
const LEVELS = new Set<NotifyLevel>(['all_comments', 'replies_and_mentions', 'all_updates', 'important_updates']);

export function findFollow(userId: string, pageId: string): FollowRecord | undefined {
  const row = db.prepare(`SELECT data FROM records WHERE tbl = 'follow' AND json_extract(data, '$.user_id') = ? AND json_extract(data, '$.navigable_block_id') = ? LIMIT 1`)
    .get(userId, pageId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as FollowRecord) : undefined;
}

export function followersOf(pageId: string): FollowRecord[] {
  return (db.prepare(`SELECT data FROM records WHERE tbl = 'follow' AND json_extract(data, '$.navigable_block_id') = ?`).all(pageId) as { data: string }[])
    .map((r) => JSON.parse(r.data) as FollowRecord)
    .filter((f) => f.following !== false);
}

/** Effective "Notify me" level: explicit follow record, else creators get all comments (the default). */
export function notifyLevel(userId: string, page: BlockRecord): NotifyLevel {
  const f = findFollow(userId, page.id);
  if (f) return f.following === false ? 'replies_and_mentions' : (f.follow_settings?.level ?? 'all_comments');
  return page.created_by_id === userId ? 'all_comments' : 'replies_and_mentions';
}

export const handlers: Record<string, Handler> = {
  getPageNotifySettings(ctx, { pageId }) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || blockRole(page.id, ctx.userId) === 'none') throw new ApiError('Not found', 404);
    const rm = new RecordMapBuilder(ctx.userId);
    const f = findFollow(ctx.userId, page.id);
    if (f) rm.add('follow', f, 'editor');
    return { level: notifyLevel(ctx.userId, page), followId: f?.id ?? null, recordMap: rm.map };
  },

  setPageNotifySettings(ctx, { pageId, level }) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const uid = ctx.userId;
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || !roleAtLeast(blockRole(page.id, uid), 'reader')) throw new ApiError('Not found', 404);
    let lv: NotifyLevel = LEVELS.has(level) ? level : 'all_comments';
    // update levels exist for database pages (rows) only
    if ((lv === 'all_updates' || lv === 'important_updates') && page.parent_table !== 'collection') lv = 'all_comments';
    const existing = findFollow(uid, page.id);
    const id = existing?.id ?? newId();
    const value = {
      id, user_id: uid, navigable_block_id: page.id, following: true, created_time: existing?.created_time ?? Date.now(),
      space_id: page.space_id, follow_settings: { level: lv },
    };
    const changes = applyTransactions(uid, [{
      id: newId(), spaceId: page.space_id, debug: { userAction: 'setPageNotifySettings' },
      operations: [{ pointer: { table: 'follow', id, spaceId: page.space_id }, path: [], command: 'set', args: value }],
    }], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record, 'editor');
    return { level: lv, followId: id, recordMap: rm.map };
  },

  /** Inbox helpers: mark every notification of a page (or all) as read. */
  markNotificationsRead(ctx, { spaceId, pageId }) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND space_id = ? AND json_extract(data, '$.user_id') = ? AND json_extract(data, '$.read') = 0`)
      .all(spaceId, ctx.userId) as { data: string }[];
    const ops: any[] = [];
    for (const r of rows) {
      const n = JSON.parse(r.data) as NotificationRecord;
      if (pageId && n.navigable_block_id !== pageId && (n.activity as any)?.page_id !== pageId) continue;
      ops.push({ pointer: { table: 'notification', id: n.id, spaceId: n.space_id }, path: [], command: 'update', args: { read: true } });
    }
    if (ops.length) applyTransactions(ctx.userId, [{ id: newId(), spaceId, debug: { userAction: 'markNotificationsRead' }, operations: ops }], ctx.clientId);
    return { count: ops.length };
  },
};
