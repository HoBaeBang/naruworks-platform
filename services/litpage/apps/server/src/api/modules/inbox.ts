// Inbox API: list notifications for the current user and workspace with
// Status (Unread & read / Unread / Archived / All workspace updates) and Type filters (Access, Discussions,
// Mentions, Automations & runs, Updates, Workspace); mark read/unread, archive/unarchive, bulk actions.
// Notification records are created by other modules through pushNotification (./notifications.ts).
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CommentRecord, DiscussionRecord, NotificationRecord, TeamRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole, memberSpaceIds } from '../../records.ts';
import { pageIdOf } from '../../search.ts';
import { pushNotification } from './notifications.ts';
import { propertyThreadVisible } from '../../propaccess.ts';

type Handler = (ctx: Ctx, body: any) => any;

export type InboxStatus = 'all' | 'unread' | 'archived' | 'workspace';
export type InboxType = 'access' | 'discussions' | 'mentions' | 'automations' | 'updates' | 'workspace';

/** notification.type → Inbox "Type" filter group. */
export function inboxTypeOf(type: string): InboxType {
  switch (type) {
    case 'invite':
    case 'access_request':
    case 'access_requested':
    case 'access_granted':
    case 'team_join_requested':
      return 'access';
    case 'comment':
    case 'reply':
    case 'reaction':
      return 'discussions';
    case 'mention':
    case 'property_mention':
    case 'reminder':
      return 'mentions';
    case 'button':
    case 'automation':
    case 'agent':
      return 'automations';
    case 'space_invite':
    case 'team_invite':
    case 'team_join_approved':
    case 'space_member_requested':
    case 'workspace':
      return 'workspace';
    default:
      return 'updates';
  }
}

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function myNotifications(uid: string, spaceId: string): NotificationRecord[] {
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND space_id = ? AND json_extract(data, '$.user_id') = ?
                           ORDER BY json_extract(data, '$.created_time') DESC LIMIT 1000`).all(spaceId, uid) as { data: string }[];
  const own = rows.map((r) => JSON.parse(r.data) as NotificationRecord);
  // items from workspaces I'm only a guest in (page invites, approved access requests) show in every inbox of mine
  const guest = guestNotifications(uid);
  if (!guest.length) return own;
  return [...own, ...guest].sort((a, b) => b.created_time - a.created_time).slice(0, 1000);
}

/** Notifications of `uid` that belong to workspaces they aren't a member of. */
function guestNotifications(uid: string): NotificationRecord[] {
  const member = new Set(memberSpaceIds(uid));
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ?
                           ORDER BY json_extract(data, '$.created_time') DESC LIMIT 300`).all(uid) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as NotificationRecord).filter((n) => !member.has(n.space_id));
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

/** The page a notification points at (activity.page_id, else the page containing the navigable block). */
function pageOfNotification(n: NotificationRecord): BlockRecord | undefined {
  const pid = (n.activity as { page_id?: string } | undefined)?.page_id;
  if (pid) return getRecord<BlockRecord>('block', pid);
  if (!n.navigable_block_id) return undefined;
  const b = getRecord<BlockRecord>('block', n.navigable_block_id);
  if (!b) return undefined;
  const p = pageIdOf(b);
  return getRecord<BlockRecord>('block', p) ?? b;
}

function unreadCount(uid: string, spaceId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM records WHERE tbl = 'notification' AND space_id = ? AND json_extract(data, '$.user_id') = ?
                          AND COALESCE(json_extract(data, '$.read'), 0) = 0 AND COALESCE(json_extract(data, '$.archived'), 0) = 0`).get(spaceId, uid) as { n: number };
  const guest = guestNotifications(uid).filter((n) => !n.read && !n.archived).length;
  return (row?.n ?? 0) + guest;
}

function updateNotifications(ctx: Ctx, uid: string, list: NotificationRecord[], patch: Partial<NotificationRecord>, action: string) {
  if (!list.length) return { count: 0 };
  const bySpace = new Map<string, NotificationRecord[]>();
  for (const n of list) bySpace.set(n.space_id, [...(bySpace.get(n.space_id) ?? []), n]);
  for (const [spaceId, items] of bySpace) {
    applyTransactions(uid, [{
      id: newId(), spaceId, debug: { userAction: action },
      operations: items.map((n) => ({ pointer: { table: 'notification' as const, id: n.id, spaceId }, path: [], command: 'update' as const, args: patch })),
    }], ctx.clientId);
  }
  return { count: list.length };
}

function ownNotifications(uid: string, ids: unknown): NotificationRecord[] {
  const out: NotificationRecord[] = [];
  for (const id of Array.isArray(ids) ? ids.slice(0, 500) : []) {
    const n = getRecord<NotificationRecord>('notification', String(id));
    if (n && n.user_id === uid) out.push(n);
  }
  return out;
}

export const handlers: Record<string, Handler> = {
  /** Notifications for the Inbox panel. status: all (unread & read) | unread | archived | workspace (all workspace updates). */
  getInbox(ctx, { spaceId, status, types }) {
    const uid = requireUser(ctx);
    const sid = String(spaceId ?? '');
    const st: InboxStatus = ['unread', 'archived', 'workspace'].includes(status) ? status : 'all';
    const allowed = Array.isArray(types) && types.length ? new Set<string>(types.map(String)) : null;
    const rm = new RecordMapBuilder(uid);
    const notificationIds: string[] = [];
    const items: { id: string; pageId: string | null; group: InboxType; requesterRole?: string }[] = [];
    if (st !== 'workspace') {
      for (const n of myNotifications(uid, sid)) {
        if (st === 'unread' && (n.read || n.archived)) continue;
        if (st === 'archived' && !n.archived) continue;
        if (st === 'all' && n.archived) continue;
        const group = inboxTypeOf(n.type);
        if (allowed && !allowed.has(group)) continue;
        let page = pageOfNotification(n);
        if (page && blockRole(page.id, uid) === 'none') {
          // guest-invite requests reach workspace owners who may not see the page itself: keep the item, hide the page
          if (n.type === 'access_requested' && (n.activity as { kind?: string } | undefined)?.kind === 'guest_invite') page = undefined;
          else continue;
        }
        // a thread on a database property value they can't see stays out too (propaccess.ts)
        if (n.discussion_id && !propertyThreadVisible(getRecord<DiscussionRecord>('discussion', n.discussion_id), uid)) continue;
        rm.add('notification', n, 'editor');
        if (page) {
          rm.add('block', page);
          addAncestors(page, rm);
          if (page.collection_id) rm.add('collection', getRecord<CollectionRecord>('collection', page.collection_id));
        }
        if (n.navigable_block_id && n.navigable_block_id !== page?.id) rm.add('block', getRecord<BlockRecord>('block', n.navigable_block_id));
        if (n.actor_id) rm.add('lit_user', getRecord('lit_user', n.actor_id), 'reader');
        const act = (n.activity ?? {}) as { team_id?: string; resolved_by_id?: string; request_id?: string };
        // threads: the discussion and its comments, so the item can show the conversation and reply inline
        if (n.discussion_id) {
          const d = getRecord<DiscussionRecord>('discussion', n.discussion_id);
          if (d && blockRole(d.parent_id, uid) !== 'none') {
            rm.add('discussion', d);
            rm.add('block', getRecord<BlockRecord>('block', d.parent_id));
            for (const cid of (d.comments ?? []).slice(-20)) {
              const c = getRecord<CommentRecord>('comment', cid);
              if (!c) continue;
              rm.add('comment', c);
              rm.add('lit_user', getRecord('lit_user', c.created_by_id), 'reader');
            }
          }
        }
        if (act.team_id) rm.add('team', getRecord<TeamRecord>('team', act.team_id));
        if (act.resolved_by_id) rm.add('lit_user', getRecord('lit_user', act.resolved_by_id), 'reader');
        let requesterRole: string | undefined;
        if (n.type === 'access_requested' && page && n.actor_id) requesterRole = blockRole(page.id, n.actor_id);
        notificationIds.push(n.id);
        items.push({ id: n.id, pageId: page?.id ?? null, group, ...(requesterRole ? { requesterRole } : {}) });
      }
    }
    // "All workspace updates": recent page edits by anyone in the workspace (workspace activity feed)
    const updates: { pageId: string; editorId: string; time: number; created: boolean }[] = [];
    if (st === 'workspace') {
      const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1
                               AND json_extract(data, '$.type') IN ('page', 'collection_view_page') ORDER BY last_edited_time DESC LIMIT 300`).all(sid) as { data: string }[];
      for (const r of rows) {
        const b = JSON.parse(r.data) as BlockRecord;
        if (b.parent_table === 'collection' || blockRole(b.id, uid) === 'none') continue;
        rm.add('block', b);
        addAncestors(b, rm);
        rm.add('lit_user', getRecord('lit_user', b.last_edited_by_id), 'reader');
        updates.push({ pageId: b.id, editorId: b.last_edited_by_id, time: b.last_edited_time, created: Math.abs(b.last_edited_time - b.created_time) < 60_000 });
        if (updates.length >= 100) break;
      }
    }
    return { notificationIds, items, updates, unreadCount: unreadCount(uid, sid), recordMap: rm.map };
  },

  countUnreadInbox(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    return { count: unreadCount(uid, String(spaceId ?? '')) };
  },

  setNotificationsRead(ctx, { ids, read }) {
    const uid = requireUser(ctx);
    return updateNotifications(ctx, uid, ownNotifications(uid, ids), { read: read !== false }, read === false ? 'markNotificationsUnread' : 'markNotificationsRead');
  },

  archiveInboxItems(ctx, { ids, archived }) {
    const uid = requireUser(ctx);
    return updateNotifications(ctx, uid, ownNotifications(uid, ids), { archived: archived !== false }, archived === false ? 'unarchiveNotifications' : 'archiveInboxItems');
  },

  markAllNotificationsReadInSpace(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const list = myNotifications(uid, String(spaceId ?? '')).filter((n) => !n.read && !n.archived);
    return updateNotifications(ctx, uid, list, { read: true }, 'markAllNotificationsRead');
  },

  /** More actions › "Archive read" : archive every notification already read. */
  archiveReadNotifications(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const list = myNotifications(uid, String(spaceId ?? '')).filter((n) => n.read && !n.archived);
    return updateNotifications(ctx, uid, list, { archived: true }, 'archiveReadNotifications');
  },

  archiveAllNotifications(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const list = myNotifications(uid, String(spaceId ?? '')).filter((n) => !n.archived);
    return updateNotifications(ctx, uid, list, { archived: true }, 'archiveAllNotifications');
  },

  /** Dev/e2e helper: put a notification into the caller's own inbox. */
  createTestNotification(ctx, { spaceId, type, blockId, text, actorEmail }) {
    const uid = requireUser(ctx);
    if (process.env.NODE_ENV === 'production') throw new ApiError('Not available', 404);
    const sid = String(spaceId ?? '');
    let actor = uid;
    if (actorEmail) {
      const row = db.prepare(`SELECT id FROM records WHERE tbl = 'lit_user' AND json_extract(data, '$.email') = ?`).get(String(actorEmail).toLowerCase()) as { id: string } | undefined;
      if (row) actor = row.id;
    }
    const block = blockId ? getRecord<BlockRecord>('block', String(blockId)) : undefined;
    const pageId = block ? pageIdOf(block) : undefined;
    const n = pushNotification({
      user_id: uid, space_id: sid, type: (type ?? 'mention') as NotificationRecord['type'], navigable_block_id: block?.id, actor_id: actor,
      activity: { page_id: pageId, text: text ? String(text) : undefined, kind: type === 'comment' ? 'comment' : undefined },
    });
    return { id: n.id };
  },
};
