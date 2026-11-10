// Person mentions in page text → Inbox (catalog  / , help "comments-mentions-and-reminders": the
// mentioned person is notified when they can see the page). The editor's @ menu inserts ["u", userId] through a
// client transaction and then calls notifyMentions; the server only notifies members that the block's text
// really mentions and who have access, never the author, and at most once a minute per (user, block, author)
// so undo/redo or re-inserting the same mention does not spam the Inbox.
// Group mentions : ["g", groupId] notifies the members of that workspace permission group
// (space.settings.groups) under the same rules — activity.kind 'group_mention' with the group's name.
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { toReadableText, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { blockRole } from '../../records.ts';
import { pageIdOf } from '../../search.ts';
import { pushNotification } from './notifications.ts';

type Handler = (ctx: Ctx, body: any) => any;

function mentionedUsers(block: BlockRecord): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(block.properties ?? {})) {
    if (!Array.isArray(v)) continue;
    for (const d of v as RichText) {
      const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as Annotation[]) : [];
      for (const a of anns) if (a?.[0] === 'u' && a[1]) out.add(String(a[1]));
    }
  }
  return out;
}

function mentionedGroups(block: BlockRecord): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(block.properties ?? {})) {
    if (!Array.isArray(v)) continue;
    for (const d of v as RichText) {
      const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as Annotation[]) : [];
      for (const a of anns) if (a?.[0] === 'g' && a[1]) out.add(String(a[1]));
    }
  }
  return out;
}

interface Group { id: string; name?: string; member_ids?: string[] }
function groupOf(spaceId: string | undefined, groupId: string): Group | undefined {
  const space = spaceId ? getRecord<SpaceRecord>('space', spaceId) : undefined;
  return (((space?.settings as { groups?: Group[] } | undefined)?.groups) ?? []).find((g) => g.id === groupId);
}

/** The block text as Inbox shows it: "@Name", page titles and dates instead of the "‣" placeholders. */
function readable(rt: RichText | undefined, max = 400): string {
  return toReadableText(rt, (a) => {
    if (a[0] === 'u') return `@${getRecord<UserRecord>('lit_user', String(a[1]))?.name || 'Unknown user'}`;
    if (a[0] === 'g') {
      const space = getRecord<SpaceRecord>('space', String(a[2] ?? '')) ?? undefined;
      const g = (((space?.settings as { groups?: Group[] } | undefined)?.groups) ?? []).find((x) => x.id === String(a[1]));
      return `@${g?.name || 'Deleted group'}`;
    }
    if (a[0] === 'p') return toReadableText(getRecord<BlockRecord>('block', String(a[1]))?.properties?.title as RichText | undefined) || 'Untitled';
    if (a[0] === 'd') return String((a[1] as { start_date?: string })?.start_date ?? '');
    if (a[0] === 'e') return String(a[1] ?? '');
    if (a[0] === 'lm') return String((a[1] as { title?: string; href?: string })?.title ?? (a[1] as { href?: string })?.href ?? '');
    return '';
  }).slice(0, max);
}

export const handlers: Record<string, Handler> = {
  /** Called by the editor after inserting person mentions into a block's text. */
  notifyMentions(ctx, { blockId, userIds, groupIds }) {
    const uid = ctx.userId;
    if (!uid) throw new ApiError('Unauthorized', 401);
    const block = getRecord<BlockRecord>('block', String(blockId ?? ''));
    if (!block || block.alive === false) throw new ApiError('Not found', 404);
    if (!roleAtLeast(blockRole(block.id, uid), 'read_and_write')) throw new ApiError('Not allowed', 403);
    const present = mentionedUsers(block);
    const targets = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].slice(0, 20);
    const recent = db.prepare(
      `SELECT 1 FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ? AND json_extract(data, '$.navigable_block_id') = ?
         AND json_extract(data, '$.actor_id') = ? AND json_extract(data, '$.type') = 'mention' AND json_extract(data, '$.created_time') > ? LIMIT 1`,
    );
    let notified = 0;
    for (const target of targets) {
      if (target === uid || !present.has(target)) continue;
      if (blockRole(block.id, target) === 'none') continue;
      if (recent.get(target, block.id, uid, Date.now() - 60_000)) continue;
      pushNotification({
        user_id: target, space_id: block.space_id, type: 'mention', navigable_block_id: block.id, actor_id: uid,
        activity: { page_id: pageIdOf(block), text: readable(block.properties?.title as RichText | undefined), kind: 'mention' },
      });
      notified++;
    }
    // group mentions: every member of each mentioned group, once (a person mentioned directly as well is skipped by the
    // one-a-minute rule above)
    const presentGroups = mentionedGroups(block);
    const seen = new Set<string>();
    for (const gid of [...new Set((Array.isArray(groupIds) ? groupIds : []).map(String))].slice(0, 5)) {
      if (!presentGroups.has(gid)) continue;
      const g = groupOf(block.space_id, gid);
      if (!g) continue;
      for (const target of (g.member_ids ?? []).slice(0, 500).map(String)) {
        if (target === uid || seen.has(target)) continue;
        seen.add(target);
        if (blockRole(block.id, target) === 'none') continue;
        if (recent.get(target, block.id, uid, Date.now() - 60_000)) continue;
        pushNotification({
          user_id: target, space_id: block.space_id, type: 'mention', navigable_block_id: block.id, actor_id: uid,
          activity: { page_id: pageIdOf(block), text: readable(block.properties?.title as RichText | undefined), kind: 'group_mention', group_id: g.id, group_name: g.name ?? '' },
        });
        notified++;
      }
    }
    return { notified };
  },
};
