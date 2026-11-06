// Comments & discussions: the records themselves are written by client transactions (discussion/comment);
// this module fans out inbox notifications (mentions, replies, "All comments" subscribers, reactions)
// and serves the page's discussion list for the comments sidebar.
import type { BlockRecord, CommentRecord, DiscussionRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { toPlainText, toReadableText, type RichText } from '@nc/shared/richtext.ts';
import { summarizeSuggestion } from '@nc/shared/richtextSuggest.ts';
import { getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';
import { pageIdOf } from '../../search.ts';
import { serializePage } from '../../history.ts';
import { followersOf, findFollow, pushNotification } from './notifications.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';
import { propertyThreadVisible } from '../../propaccess.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function mentionedUsers(text: RichText | undefined): string[] {
  const out = new Set<string>();
  for (const d of text ?? []) for (const a of (d[1] as any[]) ?? []) if (a?.[0] === 'u' && a[1]) out.add(String(a[1]));
  return [...out];
}

/** Comment text as the Inbox quotes it: mentions read "@Name" / "@Group", page mentions their title . */
function preview(text: RichText | undefined, max = 200): string {
  return toReadableText(text, (a) => {
    if (a[0] === 'u') return `@${getRecord<UserRecord>('lit_user', String(a[1]))?.name || 'Unknown user'}`;
    if (a[0] === 'g') {
      const space = getRecord<SpaceRecord>('space', String(a[2] ?? ''));
      const g = (((space?.settings as { groups?: { id: string; name?: string }[] } | undefined)?.groups) ?? []).find((x) => x?.id === String(a[1]));
      return `@${g?.name || 'Deleted group'}`;
    }
    if (a[0] === 'p') return toPlainText(getRecord<BlockRecord>('block', String(a[1]))?.properties?.title as RichText | undefined) || 'Untitled';
    if (a[0] === 'd') return String((a[1] as { start_date?: string })?.start_date ?? '');
    if (a[0] === 'e') return String(a[1] ?? '');
    return '';
  }).replace(/[‣⁍]/g, '@').slice(0, max);
}

/** "Add: “x”" / "Delete: “y”" / "Replace “y” with “x”" for a suggestion's notification. */
function suggestionText(block: BlockRecord, did: string): string {
  const s = summarizeSuggestion(block.properties?.title as RichText | undefined, did);
  const q = (v: string) => `“${v.slice(0, 300)}”`;
  if (s.kind === 'replace') return `Replace ${q(s.removed)} with ${q(s.added)}`;
  if (s.kind === 'add') return `Add: ${q(s.added)}`;
  if (s.kind === 'remove') return `Delete: ${q(s.removed)}`;
  if (s.kind === 'format' || s.kind === 'unformat') return `Format ${q(s.target ?? '')}`;
  return 'Suggested an edit';
}

export const handlers: Record<string, Handler> = {
  /** Called after a comment was saved (new discussion, reply or edit adding mentions). */
  notifyComment(ctx, { commentId, editedMentionsOnly }) {
    const uid = requireUser(ctx);
    const c = getRecord<CommentRecord>('comment', String(commentId ?? ''));
    if (!c || c.alive === false) throw new ApiError('Not found', 404);
    if (c.created_by_id !== uid) throw new ApiError('Not allowed', 403);
    const d = getRecord<DiscussionRecord>('discussion', c.parent_id);
    const block = d && getRecord<BlockRecord>('block', d.parent_id);
    if (!d || !block || blockRole(block.id, uid) === 'none') throw new ApiError('Not found', 404);
    // public pages that allow comments : people outside the workspace can't flood its members' Inboxes
    if (!isSpaceMember(getRecord<SpaceRecord>('space', block.space_id), uid) && !hit(`comment-notify:outsider:${uid}`, 30, 3600_000)) throw new RateLimitError();
    const pageId = pageIdOf(block);
    const page = getRecord<BlockRecord>('block', pageId) ?? block;
    // a suggested edit : "<name> suggested in <page>" with the change ("Add: “…”") for the page's people
    const suggestion = !!(c as CommentRecord & { suggestion?: boolean }).suggestion && d.type === 'suggestion' && d.comments?.[0] === c.id;
    const recipients = new Map<string, 'mention' | 'comment'>();
    for (const u of mentionedUsers(c.text as RichText)) recipients.set(u, 'mention');
    if (!editedMentionsOnly) {
      // replies notify everyone who already took part in the thread
      for (const cid of d.comments ?? []) {
        const pc = getRecord<CommentRecord>('comment', cid);
        if (pc && pc.id !== c.id && pc.alive !== false && !recipients.has(pc.created_by_id)) recipients.set(pc.created_by_id, 'comment');
      }
      // "Notify me: All comments" subscribers (+ the creator by default, as expected)
      for (const f of followersOf(page.id)) {
        // database rows: "All updates" / "Important updates" include every comment too 
        if (['all_comments', 'all_updates', 'important_updates'].includes(f.follow_settings?.level ?? 'all_comments') && !recipients.has(f.user_id)) recipients.set(f.user_id, 'comment');
      }
      if (page.created_by_id && !findFollow(page.created_by_id, page.id) && !recipients.has(page.created_by_id)) recipients.set(page.created_by_id, 'comment');
    }
    let n = 0;
    for (const [target, type] of recipients) {
      if (target === uid) continue;
      if (type !== 'mention' && d.muted_user_ids?.includes(target)) continue;
      if (blockRole(block.id, target) === 'none') continue;
      // a thread on a database property value only reaches people who can see that value 
      if (!propertyThreadVisible(d, target)) continue;
      pushNotification({
        user_id: target, space_id: block.space_id, type, navigable_block_id: block.id, actor_id: uid,
        discussion_id: d.id, comment_id: c.id,
        activity: suggestion
          ? { page_id: page.id, text: suggestionText(block, d.id), kind: 'suggestion' }
          : { page_id: page.id, text: preview(c.text as RichText, 400), context: preview(d.context as RichText), kind: d.comments?.[0] === c.id ? 'comment' : 'reply' },
      });
      n++;
    }
    return { notified: n };
  },

  /** Emoji reaction on a comment notifies its author (2025-11 behavior). */
  notifyReaction(ctx, { commentId, emoji }) {
    const uid = requireUser(ctx);
    const c = getRecord<CommentRecord>('comment', String(commentId ?? ''));
    if (!c || c.created_by_id === uid) return { notified: 0 };
    const d = getRecord<DiscussionRecord>('discussion', c.parent_id);
    const block = d && getRecord<BlockRecord>('block', d.parent_id);
    if (!d || !block || blockRole(block.id, c.created_by_id) === 'none' || !propertyThreadVisible(d, c.created_by_id)) return { notified: 0 };
    // only someone who can see the thread and actually reacted with this emoji notifies the author
    const e = String(emoji ?? '').slice(0, 64);
    if (blockRole(block.id, uid) === 'none' || !(c.reactions?.[e] ?? []).includes(uid)) return { notified: 0 };
    pushNotification({
      user_id: c.created_by_id, space_id: block.space_id, type: 'comment', navigable_block_id: block.id, actor_id: uid,
      discussion_id: d.id, comment_id: c.id,
      activity: { page_id: pageIdOf(block), reaction: e, text: preview(c.text as RichText), kind: 'reaction' },
    });
    return { notified: 1 };
  },

  /** All discussions on a page (page-level + block/inline, open and resolved) for the comments sidebar. */
  getPageDiscussions(ctx, { pageId }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || blockRole(page.id, uid) === 'none') throw new ApiError('Not found', 404);
    const rm = new RecordMapBuilder(uid);
    const discussions: { id: string; blockId: string }[] = [];
    for (const b of serializePage(page.id).blocks) {
      if (b.id !== page.id && (b.type === 'page' || b.type === 'collection_view_page')) continue;
      for (const did of b.discussions ?? []) {
        const d = getRecord<DiscussionRecord>('discussion', did);
        if (!d || d.alive === false) continue;
        rm.add('discussion', d);
        // threads on property values hidden from this person aren't theirs to see (records.ts recordRole)
        if (!rm.has('discussion', d.id)) continue;
        rm.add('block', b);
        discussions.push({ id: d.id, blockId: b.id });
        for (const cid of d.comments ?? []) {
          const c = getRecord<CommentRecord>('comment', cid);
          if (!c) continue;
          rm.add('comment', c);
          rm.add('lit_user', getRecord('lit_user', c.created_by_id), 'reader');
          for (const u of mentionedUsers(c.text as RichText)) rm.add('lit_user', getRecord('lit_user', u), 'reader');
          for (const ids of Object.values(c.reactions ?? {})) for (const u of ids) rm.add('lit_user', getRecord('lit_user', u), 'reader');
        }
      }
    }
    return { discussions, recordMap: rm.map };
  },
};
