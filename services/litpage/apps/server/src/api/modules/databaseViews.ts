// Database views / data sources endpoints . Importing ../../dbcopy.ts registers the persist hook that copies
// rows and templates into databases duplicated by the client (⋮⋮ › Duplicate with content / ⌘D).
import '../../dbcopy.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';
import { pageViewsEnabled } from '../../policy.ts';
import { hit } from '../../ratelimit.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

/** "Show my view history" (page analytics › per page, then Settings › Preferences) — same rule as getPageStats. */
function showsViewHistory(userId: string, pageId: string): boolean {
  const st = getRecord<any>('user_settings', userId)?.settings ?? {};
  const own = st.page_view_history_pages?.[pageId];
  if (own === 'allow' || own === 'deny') return own === 'allow';
  return (st.page_view_history ?? (st.view_history === false ? 'deny' : 'allow')) !== 'deny';
}

const MAX_POSTS = 100;
const MAX_VIEWERS = 20;

export const handlers: Record<string, Handler> = {
  /**
   * Feed view › Track views : who opened each post (the page view log kept for page analytics, so
   * nothing is tracked when Settings › Analytics is off). The post's author is not counted; people who turned off
   * "Show my view history" are only listed to themselves. Posts the caller can't open are left out.
   */
  getFeedViews(ctx, { pageIds }) {
    const uid = requireUser(ctx);
    if (!hit(`feed-views:${uid}`, 240, 60_000)) throw new ApiError('Too many requests. Try again later.', 429);
    const list = [...new Set((Array.isArray(pageIds) ? pageIds : []).map((x: unknown) => String(x ?? '')).filter(Boolean))].slice(0, MAX_POSTS);
    const q = db.prepare('SELECT user_id, MAX(time) AS last FROM page_views WHERE page_id = ? AND user_id IS NOT NULL GROUP BY user_id ORDER BY last DESC LIMIT 500');
    const views: Record<string, { count: number; viewers: { userId: string; lastViewed: number }[] }> = {};
    const users = new Set<string>();
    for (const id of list) {
      const page = getRecord<BlockRecord>('block', id);
      if (!page || page.alive === false || !roleAtLeast(blockRole(page.id, uid), 'reader')) continue;
      if (!pageViewsEnabled(page.space_id, null)) continue;
      const viewers = (q.all(page.id) as { user_id: string; last: number }[])
        .filter((r) => r.user_id !== page.created_by_id && (r.user_id === uid || showsViewHistory(r.user_id, page.id)))
        .map((r) => ({ userId: r.user_id, lastViewed: r.last }));
      views[page.id] = { count: viewers.length, viewers: viewers.slice(0, MAX_VIEWERS) };
      for (const v of views[page.id].viewers) users.add(v.userId);
    }
    const rm = new RecordMapBuilder(uid);
    for (const u of users) rm.add('lit_user', getRecord('lit_user', u), 'reader');
    return { views, recordMap: rm.map };
  },
};
