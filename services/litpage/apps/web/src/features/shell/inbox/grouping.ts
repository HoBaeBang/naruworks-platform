
// time section — comments ("A, B and 2 others commented in Page", "N discussions"), mentions ("A, B mentioned you
// in"), reactions and property updates. Actionable items (access / teamspace requests, invites, reminders,
// assignments) stay one per notification. Grouping is client-side so read/archive changes re-group instantly.
import type { NotificationRecord } from '@nc/shared/records.ts';
import type { InboxType } from './inboxState.ts';

export type TimeGroup = 'today' | 'thisWeek' | 'lastWeek' | 'older';

export interface InboxItem {
  id: string;
  pageId: string | null;
  group: InboxType;
  requesterRole?: string;
}

export interface FeedItem {
  /** stable key: first (newest) notification id */
  key: string;
  /** newest first */
  ids: string[];
  pageId: string | null;
  group: InboxType;
  kind: 'comments' | 'mentions' | 'reactions' | 'updates' | 'single';
  requesterRole?: string;
  time: number;
}

export function timeGroupOf(ts: number, now = new Date()): TimeGroup {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (ts >= today.getTime()) return 'today';
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday
  if (ts >= weekStart.getTime()) return 'thisWeek';
  if (ts >= weekStart.getTime() - 7 * 86_400_000) return 'lastWeek';
  return 'older';
}

function kindOf(n: NotificationRecord): FeedItem['kind'] {
  const k = (n.activity as { kind?: string } | undefined)?.kind;
  if (n.type === 'comment') return k === 'reaction' ? 'reactions' : 'comments';
  // group mentions read "mentioned your group in" — they stay separate from direct mentions
  if (n.type === 'mention') return k === 'group_mention' ? 'single' : 'mentions';
  if (n.type === 'page_edit') return 'updates';
  return 'single';
}

/** Group a newest-first list into time sections of feed items. */
export function groupFeed(items: InboxItem[], get: (id: string) => NotificationRecord | undefined, now = new Date()): { group: TimeGroup; items: FeedItem[] }[] {
  const sections: { group: TimeGroup; items: FeedItem[]; byKey: Map<string, FeedItem> }[] = [];
  for (const it of items) {
    const n = get(it.id);
    if (!n) continue;
    const tg = timeGroupOf(n.created_time, now);
    let sec = sections.find((s) => s.group === tg);
    if (!sec) {
      sec = { group: tg, items: [], byKey: new Map() };
      sections.push(sec);
    }
    const kind = kindOf(n);
    const page = it.pageId ?? n.navigable_block_id ?? null;
    const gk = kind !== 'single' && page ? `${kind}:${page}` : null;
    const existing = gk ? sec.byKey.get(gk) : undefined;
    if (existing) {
      existing.ids.push(it.id);
      continue;
    }
    const fi: FeedItem = { key: it.id, ids: [it.id], pageId: it.pageId, group: it.group, kind, requesterRole: it.requesterRole, time: n.created_time };
    sec.items.push(fi);
    if (gk) sec.byKey.set(gk, fi);
  }
  return sections.map(({ group, items: list }) => ({ group, items: list }));
}

/** Distinct actors of a group, newest first. */
export function actorsOf(ids: string[], get: (id: string) => NotificationRecord | undefined): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const a = get(id)?.actor_id;
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}
