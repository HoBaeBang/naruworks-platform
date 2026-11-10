// Feed view posts are social: emoji reactions
// on the post ("Add reaction" + pills), the views button (who opened the post: facepile + count, a list on click), the
// post's page comments with an "Add a comment" composer right in the feed.
// Reactions the page as a page discussion whose only comment has no text (comments.tsx isPostReactions), so
// people with comment access can react, everyone's reactions merge and the page shows them above its comments.
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, CommentRecord, DiscussionRecord, UserRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { Icon } from '../../../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { api } from '../../../../lib/api.ts';
import { me, run } from '../../../../lib/blocks.ts';
import { useRole, useTableVersion } from '../../../../lib/hooks.ts';
import { records } from '../../../../lib/store/records.ts';
import { useSession } from '../../../../lib/store/session.ts';
import { timeAgo } from '../../../../lib/format.ts';
import { UserAvatar, userName } from '../../../presence/Avatar.tsx';
import { CommentComposer, DiscussionThread, ReactionGlyph, addComment, isPageDiscussion, isPostReactions, useComments } from '../../../comments/comments.tsx';

const QUICK = ['👍', '❤️', '🎉', '😄', '👀', '✅', '🙏', '🔥'];

/** The first comments of the post's reaction threads (normally one; concurrent first reactions can make two). */
function reactionComments(row: BlockRecord): { d: DiscussionRecord; c: CommentRecord }[] {
  const out: { d: DiscussionRecord; c: CommentRecord }[] = [];
  for (const id of row.discussions ?? []) {
    const d = records.get<DiscussionRecord>('discussion', id);
    if (!d || d.alive === false || d.resolved || !isPostReactions(d)) continue;
    const c = records.get<CommentRecord>('comment', d.comments?.[0]);
    if (c && c.alive !== false) out.push({ d, c });
  }
  return out;
}

/** React to a post with `emoji`, or take your reaction back. */
export function togglePostReaction(row: BlockRecord, emoji: string) {
  const uid = me();
  const threads = reactionComments(row);
  const mine = threads.filter(({ c }) => (c.reactions?.[emoji] ?? []).includes(uid));
  if (mine.length) {
    run('feedPost.removeReaction', (tx) => {
      for (const { d, c } of mine) {
        const next = (c.reactions?.[emoji] ?? []).filter((u) => u !== uid);
        const left = Object.entries(c.reactions ?? {}).some(([k, u]) => (k === emoji ? next.length : u?.length));
        if (!left && d.created_by_id === uid) {
          // taking back the last reaction removes the (empty) reactions thread
          tx.update('comment', c.id, [], { alive: false });
          tx.update('discussion', d.id, [], { alive: false });
          tx.listRemove('block', row.id, ['discussions'], d.id);
        } else tx.set('comment', c.id, ['reactions', emoji], next);
      }
    });
    return;
  }
  const first = threads[0]?.c;
  if (first) {
    run('feedPost.addReaction', (tx) => tx.set('comment', first.id, ['reactions', emoji], [...(first.reactions?.[emoji] ?? []), uid]));
    return;
  }
  const did = newId();
  const cid = newId();
  const now = Date.now();
  run('feedPost.addReaction', (tx) => {
    tx.set('discussion', did, [], {
      id: did, parent_id: row.id, parent_table: 'block', type: 'page', resolved: false, comments: [], space_id: row.space_id, alive: true,
      created_by_id: uid, created_time: now,
    } as never);
    tx.listAfter('block', row.id, ['discussions'], did);
    tx.set('comment', cid, [], {
      id: cid, parent_id: did, parent_table: 'discussion', text: [], reactions: { [emoji]: [uid] }, created_by_id: uid, created_time: now,
      last_edited_time: now, alive: true, space_id: row.space_id,
    } as never);
    tx.listAfter('discussion', did, ['comments'], cid);
  });
}

/** Everyone's reactions on the post: emoji → people (merged over the reaction threads). */
function reactionCounts(row: BlockRecord): Map<string, string[]> {
  const counts = new Map<string, string[]>();
  for (const { c } of reactionComments(row)) {
    for (const [emoji, users] of Object.entries(c.reactions ?? {})) if (users?.length) counts.set(emoji, [...new Set([...(counts.get(emoji) ?? []), ...users])]);
  }
  return counts;
}

function pickPostReaction(anchor: HTMLElement, row: BlockRecord) {
  void import('../../../page/IconPicker.tsx').then(({ openEmojiPicker }) => openEmojiPicker(anchor, { onPick: (e) => togglePostReaction(row, e), quick: QUICK }));
}

function Pills({ row, counts, canReact }: { row: BlockRecord; counts: Map<string, string[]>; canReact: boolean }) {
  const uid = useSession((s) => s.userId) ?? '';
  return (
    <>
      {[...counts.entries()].map(([emoji, users]) => (
        <div
          key={emoji}
          role="button"
          className={`nc-reaction nc-feed-reaction ${users.includes(uid) ? 'mine' : ''} ${canReact ? '' : 'disabled'}`}
          data-testid="feed-reaction"
          data-tooltip={users.map((u) => userName(records.get<UserRecord>('lit_user', u))).join(', ')}
          onClick={() => canReact && togglePostReaction(row, emoji)}
        >
          <span className="emoji"><ReactionGlyph emoji={emoji} /></span>
          <span className="count">{users.length}</span>
        </div>
      ))}
    </>
  );
}

/** Feed post: "Add reaction" + one pill per emoji (count, yours highlighted, names on hover). */
export function PostReactions({ row }: { row: BlockRecord }) {
  useTableVersion(['discussion', 'comment']);
  const canReact = roleAtLeast(useRole('block', row.id), 'comment_only');
  return (
    <>
      {canReact && (
        <div role="button" className="nc-feed-react" aria-label="Add reaction" data-tooltip="Add reaction" aria-haspopup="dialog" data-testid="feed-add-reaction" onClick={(e) => pickPostReaction(e.currentTarget, row)}>
          <Icon name="emojiFacePlus" size={18} />
        </div>
      )}
      <Pills row={row} counts={reactionCounts(row)} canReact={canReact} />
    </>
  );
}

/** The post's reactions on its page, above the comments (only once someone reacted). */
export function PostReactionPills({ row }: { row: BlockRecord }) {
  useTableVersion(['discussion', 'comment']);
  const canReact = roleAtLeast(useRole('block', row.id), 'comment_only');
  const counts = reactionCounts(row);
  if (!counts.size) return null;
  return (
    <div className="nc-reactions nc-page-reactions" data-testid="page-reactions">
      <Pills row={row} counts={counts} canReact={canReact} />
      {canReact && <div role="button" className="nc-reaction add" aria-label="Add reaction" onClick={(e) => pickPostReaction(e.currentTarget, row)}><Icon name="emojiFacePlus" size={14} /></div>}
    </div>
  );
}

export interface PostViewInfo { count: number; viewers: { userId: string; lastViewed: number }[] }

/** Who opened each post (server getFeedViews; nothing when page view analytics are off). */
export function useFeedViews(pageIds: string[]): Record<string, PostViewInfo> {
  const [views, setViews] = useState<Record<string, PostViewInfo>>({});
  const key = pageIds.join(',');
  useEffect(() => {
    if (!pageIds.length) return;
    let alive = true;
    void api<{ views: Record<string, PostViewInfo>; recordMap?: unknown }>('getFeedViews', { pageIds })
      .then((r) => {
        if (!alive) return;
        if (r.recordMap) records.mergeRecordMap(r.recordMap as never);
        setViews(r.views ?? {});
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return views;
}

function openViewers(anchor: HTMLElement, info: PostViewInfo) {
  openOverlay(() => (
    <PopoverSurface width={260} className="nc-feed-viewers" maxHeight={320}>
      <div className="nc-feed-viewers-head">{info.count === 1 ? 'Viewed by 1 person' : `Viewed by ${info.count} people`}</div>
      {info.viewers.map((v) => (
        <div key={v.userId} className="nc-feed-viewer">
          <UserAvatar userId={v.userId} size={20} />
          <span className="nc-feed-viewer-name">{userName(records.get<UserRecord>('lit_user', v.userId))}</span>
          <span className="nc-feed-viewer-time">{timeAgo(v.lastViewed)}</span>
        </div>
      ))}
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 4 });
}

/** The views button: viewers' avatars + how many people opened the post. */
export function PostViews({ info }: { info: PostViewInfo | undefined }) {
  if (!info) return null;
  return (
    <div role="button" className="nc-feed-views" aria-haspopup="dialog" data-testid="feed-views" data-tooltip="Views" onClick={(e) => info.count && openViewers(e.currentTarget, info)}>
      <div className="nc-feed-facepile">
        {info.viewers.slice(0, 3).map((v) => <UserAvatar key={v.userId} userId={v.userId} size={18} />)}
      </div>
      <div className="nc-feed-views-count">{info.count}</div>
    </div>
  );
}

const SHOWN_THREADS = 3;

/** The post's comments (page discussions) and the "Add a comment" composer. */
export function PostComments({ row, onOpen }: { row: BlockRecord; onOpen: () => void }) {
  const version = useTableVersion(['discussion', 'comment']);
  const canComment = roleAtLeast(useRole('block', row.id), 'comment_only');
  const active = useComments((s) => s.active);
  const threads = useMemo(() => (row.discussions ?? [])
    .map((id) => records.get<DiscussionRecord>('discussion', id))
    .filter((d): d is DiscussionRecord => !!d && d.alive !== false && !d.resolved && isPageDiscussion(d, row.id) && !isPostReactions(d)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [row.discussions, version]);
  const shown = threads.slice(-SHOWN_THREADS);
  const hidden = threads.length - shown.length;
  return (
    <div className="nc-feed-comments" data-testid="feed-comments">
      {hidden > 0 && <div role="button" className="nc-feed-more-comments" onClick={onOpen}>{hidden === 1 ? '1 more comment' : `${hidden} more comments`}</div>}
      {shown.map((d) => (
        <DiscussionThread key={d.id} discussion={d} mode="page" active={active === d.id} onActivate={() => { if (active !== d.id) useComments.getState().set({ active: d.id }); }} />
      ))}
      {canComment && (
        <div className="nc-feed-composer">
          <CommentComposer placeholder="Add a comment" submitAria="Send comment" onSubmit={(text) => { addComment(row.id, text, undefined, undefined, { type: 'page' }); }} />
        </div>
      )}
    </div>
  );
}
