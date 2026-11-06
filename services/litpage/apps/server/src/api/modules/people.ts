// People: People Directory, profile pages, hover cards and people in Quick Find. Only workspace members see the directory; a person shows up for a viewer only
// when they share the workspace (members) or are a guest on its pages; emails follow UserVisibility (records.ts).
// Workspace owners can turn profiles / hover cards / profile activity off (space.settings.people_profiles_enabled /
// hover_cards_enabled / people_activity_enabled, Settings › People.
import type { BlockRecord, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { isSpaceAdmin, isSpaceMember, teamVisibleTo } from '@nc/shared/permissions.ts';
import { db, getRecord, recordsInSpace } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, UserVisibility, blockRole } from '../../records.ts';
import { effectiveTimeZone } from '../../notify.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function memberSpace(spaceId: unknown, uid: string): SpaceRecord {
  const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
  if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
  return space;
}

function roleIn(space: SpaceRecord, userId: string): 'owner' | 'membership_admin' | 'member' | 'restricted_member' | 'guest' | 'none' {
  const p = (space.permissions ?? []).find((x) => x.type === 'user_permission' && x.user_id === userId && x.role !== 'none');
  if (p) return (p.role as string) === 'owner' ? 'owner' : (p.role as string) === 'membership_admin' ? 'membership_admin' : (p.role as string) === 'restricted_member' ? 'restricted_member' : 'member';
  const row = db.prepare(`SELECT 1 FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND data LIKE ? LIMIT 1`).get(space.id, `%"user_id":"${userId.replace(/[^\w-]/g, '')}"%`);
  return row ? 'guest' : 'none';
}

const setting = (space: SpaceRecord, key: string) => (space.settings as Record<string, unknown> | undefined)?.[key] !== false;

function profileOf(space: SpaceRecord, viewer: string, userId: string) {
  const u = getRecord<UserRecord>('lit_user', userId);
  if (!u) return null;
  const role = roleIn(space, userId);
  if (role === 'none') return null;
  const teams = recordsInSpace<TeamRecord>('team', space.id)
    .filter((t) => t.alive !== false && !t.archived_by && t.membership?.some((m) => m.user_id === userId) && teamVisibleTo(t, space, viewer))
    .map((t) => ({ id: t.id, name: t.name, icon: t.icon ?? '', owner: !!t.membership?.some((m) => m.user_id === userId && m.role === 'owner') }));
  const prefs = (getRecord<{ id: string; version: number; settings?: Record<string, unknown> }>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
  return {
    userId, role, teams,
    // local time on hover cards: only for people who share a workspace with the viewer
    timeZone: role !== 'guest' ? effectiveTimeZone(userId) : null,
    title: typeof prefs.profile_title === 'string' ? prefs.profile_title.slice(0, 120) : '',
  };
}

export const handlers: Record<string, Handler> = {
  /** People Directory: everyone in the workspace (members, then guests) with role and teamspaces. */
  getPeopleDirectory(ctx, { spaceId, query, includeGuests }) {
    const uid = requireUser(ctx);
    const space = memberSpace(spaceId, uid);
    if (!setting(space, 'people_profiles_enabled') && !isSpaceAdmin(space, uid)) return { people: [], disabled: true, recordMap: {} };
    const q = String(query ?? '').trim().toLowerCase();
    const vis = new UserVisibility(uid);
    const rm = new RecordMapBuilder(uid);
    const ids = new Set<string>((space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!));
    if (includeGuests) {
      const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND data LIKE '%"user_permission"%' LIMIT 5000`).all(space.id) as { data: string }[];
      for (const r of rows) for (const p of (JSON.parse(r.data) as BlockRecord).permissions ?? []) if (p.type === 'user_permission' && p.user_id && p.role !== 'none') ids.add(p.user_id);
    }
    const people: ReturnType<typeof profileOf>[] = [];
    for (const id of ids) {
      const u = getRecord<UserRecord>('lit_user', id);
      if (!u) continue;
      const shown = vis.user(u) as UserRecord;
      if (q && !`${shown.name ?? ''} ${shown.email ?? ''}`.toLowerCase().includes(q)) continue;
      const p = profileOf(space, uid, id);
      if (!p) continue;
      people.push(p);
      rm.add('lit_user', u, 'reader');
    }
    const order = { owner: 0, membership_admin: 1, member: 2, restricted_member: 2.5, guest: 3, none: 4 } as const;
    people.sort((a, b) => order[a!.role] - order[b!.role] || (getRecord<UserRecord>('lit_user', a!.userId)?.name ?? '').localeCompare(getRecord<UserRecord>('lit_user', b!.userId)?.name ?? ''));
    return { people, recordMap: rm.map };
  },

  /** Hover card / profile page for one person. */
  getPersonProfile(ctx, { spaceId, userId, withActivity }) {
    const uid = requireUser(ctx);
    const space = memberSpace(spaceId, uid);
    const target = String(userId ?? '');
    const profilesOn = setting(space, 'people_profiles_enabled');
    const cardsOn = setting(space, 'hover_cards_enabled');
    // "Show recent activity on people profiles": off → no Recent activity list (collaborators stay)
    const activityOn = setting(space, 'people_activity_enabled');
    const p = profileOf(space, uid, target);
    if (!p) throw new ApiError('Not found', 404);
    const rm = new RecordMapBuilder(uid);
    rm.add('lit_user', getRecord('lit_user', target), 'reader');
    let recentPages: { pageId: string; editedTime: number }[] = [];
    let collaborators: string[] = [];
    if (withActivity && profilesOn) {
      // pages this person edited recently that the viewer can open (profile "Recent activity")
      const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND json_extract(data, '$.type') IN ('page', 'collection_view_page')
                               AND json_extract(data, '$.last_edited_by_id') = ? ORDER BY last_edited_time DESC LIMIT 200`).all(space.id, target) as { data: string }[];
      for (const r of rows) {
        const b = JSON.parse(r.data) as BlockRecord;
        if (blockRole(b.id, uid) === 'none') continue;
        if (activityOn) rm.add('block', b);
        recentPages.push({ pageId: b.id, editedTime: b.last_edited_time });
        if (recentPages.length >= 12) break;
      }
      // frequent collaborators: other editors of those pages (from the activity log)
      const counts = new Map<string, number>();
      if (recentPages.length) {
        const q = db.prepare(`SELECT user_id, COUNT(*) AS n FROM activity WHERE page_id IN (${recentPages.map(() => '?').join(',')}) AND user_id != ? GROUP BY user_id ORDER BY n DESC LIMIT 8`);
        for (const row of q.all(...recentPages.map((x) => x.pageId), target) as { user_id: string; n: number }[]) counts.set(row.user_id, row.n);
      }
      collaborators = [...counts.keys()].filter((id) => roleIn(space, id) !== 'none' && id !== target);
      for (const id of collaborators) rm.add('lit_user', getRecord('lit_user', id), 'reader');
      if (!activityOn) recentPages = [];
    }
    return { profile: p, profilesEnabled: profilesOn, hoverCardsEnabled: cardsOn, activityEnabled: activityOn, recentPages, collaborators, recordMap: rm.map };
  },

  /** Quick Find "People" results (name or email). */
  searchPeople(ctx, { spaceId, query, limit }) {
    const uid = requireUser(ctx);
    const space = memberSpace(spaceId, uid);
    const q = String(query ?? '').trim().toLowerCase();
    if (q.length < 1) return { userIds: [], recordMap: {} };
    const vis = new UserVisibility(uid);
    const rm = new RecordMapBuilder(uid);
    const out: string[] = [];
    for (const p of space.permissions ?? []) {
      if (p.type !== 'user_permission' || !p.user_id || p.role === 'none') continue;
      const u = getRecord<UserRecord>('lit_user', p.user_id);
      if (!u) continue;
      const shown = vis.user(u) as UserRecord;
      const hay = `${shown.name ?? ''} ${shown.email ?? ''}`.toLowerCase();
      if (!hay.split(/\s+/).some((w) => w.startsWith(q)) && !hay.includes(q)) continue;
      out.push(u.id);
      rm.add('lit_user', u, 'reader');
      if (out.length >= Math.min(Number(limit) || 5, 20)) break;
    }
    return { userIds: out, recordMap: rm.map };
  },
};
