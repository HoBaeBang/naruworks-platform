
// Discussions can be marked to revisit. A discussion is new for you while
//  - you have an unread Inbox notification for it (comment, reply, mention or suggestion — not reactions), or
//  - you marked one of its comments "Mark as unread" and there was no
//    notification to flip: that revisit mark lives in your user settings (`discussion_revisit` {discussionId: commentId}).
// Opening the discussion (its popover, a Discussions popup row, its sidebar card) or "Mark as read" reads it, which also
// reads the matching Inbox items — the page and the Inbox share one read state.
import type { CommentRecord, DiscussionRecord, NotificationRecord } from '@nc/shared/records.ts';
import { run } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { getUserPrefs, savePrefs } from '../settings/userSettings.ts';

const REVISIT_KEY = 'discussion_revisit';

function me(): string {
  return useSession.getState().userId ?? '';
}

function threadNotifications(discussionId: string): NotificationRecord[] {
  const uid = me();
  if (!uid) return [];
  return records.all<NotificationRecord>('notification')
    .filter((n) => n.user_id === uid && n.discussion_id === discussionId && (n.activity as { kind?: string } | undefined)?.kind !== 'reaction');
}

function revisits(): Record<string, string> {
  const v = getUserPrefs()[REVISIT_KEY];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
}

export function isDiscussionUnread(d: DiscussionRecord): boolean {
  return !!revisits()[d.id] || threadNotifications(d.id).some((n) => !n.read);
}


export function unreadCommentIds(d: DiscussionRecord): Set<string> {
  const out = new Set<string>();
  for (const n of threadNotifications(d.id)) if (!n.read && n.comment_id) out.add(n.comment_id);
  const mark = revisits()[d.id];
  if (mark) out.add(mark);
  return out;
}

export function markDiscussionRead(discussionId: string) {
  const unread = threadNotifications(discussionId).filter((n) => !n.read);
  if (unread.length) run('readNotification', (tx) => { for (const n of unread) tx.update('notification', n.id, [], { read: true }); }, { skipHistory: true });
  const marks = revisits();
  if (marks[discussionId]) {
    const next = { ...marks };
    delete next[discussionId];
    savePrefs({ [REVISIT_KEY]: next });
  }
}


export function markCommentUnread(d: DiscussionRecord, c: CommentRecord) {
  const own = threadNotifications(d.id).filter((n) => n.comment_id === c.id && n.read);
  if (own.length) {
    run('unreadNotification', (tx) => { for (const n of own) tx.update('notification', n.id, [], { read: false }); }, { skipHistory: true });
    return;
  }
  savePrefs({ [REVISIT_KEY]: { ...revisits(), [d.id]: c.id } });
}
