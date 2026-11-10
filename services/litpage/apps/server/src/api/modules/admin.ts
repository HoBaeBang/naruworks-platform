// Workspace admin tools (Enterprise, workspace owners): Settings › Audit log (SET-AUD), Analytics (SET-ANL) and
// Content search (SET-ADM). Events come from audit.ts, views from page_views (pages.ts), edits from the activity
// table (history.ts), searches from searchLog.ts and AI usage from ai_threads/ai_messages (ai/threads.ts).
// Every endpoint checks the caller's role and the workspace plan on the server; results never include pages the
// caller couldn't otherwise reach except in Content search, which is the owner's audit tool (titles only, no content).
import { isSpaceAdmin, isSpaceMember } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, Permission, SpaceRecord, SpaceViewRecord, TeamRecord, UserRecord, UserRootRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';
import { saveRecord } from '../../seed.ts';
import { realtime } from '../../realtime.ts';
import { childBlocks } from '../../tree.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';
import { storeFile } from '../../content/files.ts';
import { AUDIT_EVENTS, audit, pageAudience } from '../../audit.ts';
import { spaceRoleOf, teamOfBlock } from '../../policy.ts';
import { searchText } from '../../search.ts';
import { listRetained, purgePage, restoreRetained } from '../../retention.ts';
import { agentPageRole } from '../../agents/access.ts';
import { isBotId } from '../../agents/model.ts';

type Handler = (ctx: Ctx, body: any) => any;

const DAY = 86_400_000;
const RETENTION_DAYS = 365;
const PAGE_TYPES = new Set(['page', 'collection_view_page']);

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function spaceOrThrow(spaceId: unknown): SpaceRecord {
  const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
  if (!space || (space as any).deleted_time) throw new ApiError('Workspace could not be found', 404);
  return space;
}

/** Audit log, analytics (except Content) and content search: Enterprise workspace owners. */
function requireOwnerTool(space: SpaceRecord, uid: string, what: string) {
  if (spaceRoleOf(space, uid) !== 'owner') throw new ApiError(`Only workspace owners can view ${what}.`, 403);
  if (space.plan_type !== 'enterprise') throw new ApiError(`Upgrade to the Enterprise plan to use ${what}.`, 403);
}

function hasTable(name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // spreadsheet formula injection: prefix cells that would be evaluated
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

function storeCsv(name: string, text: string, uid: string, spaceId: string) {
  const f = storeFile(name, Buffer.from(`﻿${text}`, 'utf8'), uid, spaceId, 'text/csv; charset=utf-8', { private: true });
  return { url: f.url, filename: f.name };
}

function userLabel(id: string | null | undefined): { name: string; email: string } {
  const u = id ? getRecord<UserRecord>('lit_user', id) : undefined;
  return { name: u?.name || u?.email || '', email: u?.email ?? '' };
}

function pageTitle(b: BlockRecord | undefined): string {
  if (!b) return '';
  if (b.type === 'collection_view_page' && b.collection_id) {
    const n = toPlainText((getRecord<CollectionRecord>('collection', b.collection_id)?.name ?? []) as any);
    if (n) return n;
  }
  return toPlainText(b.properties?.title);
}

function members(space: SpaceRecord): string[] {
  return (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
}

function clampRange(from: unknown, to: unknown): { from: number; to: number } {
  const now = Date.now();
  const floor = now - RETENTION_DAYS * DAY;
  const f = Number(from);
  const t = Number(to);
  return { from: Number.isFinite(f) && f > 0 ? Math.max(f, floor) : floor, to: Number.isFinite(t) && t > 0 ? Math.min(t, now + DAY) : now + DAY };
}

function strList(v: unknown, max = 200): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 200).slice(0, max) : [];
}

// ---------------------------------------------------------------------------------------------- audit log

interface AuditRow { id: string; space_id: string | null; time: number; actor_id: string | null; event: string; category: string; target_id: string | null; team_id: string | null; ip: string | null; request_id: string | null; data: string | null }

function auditQuery(space: SpaceRecord, body: any, limit: number) {
  const { from, to } = clampRange(body.from, body.to);
  const where: string[] = ['space_id = ?', 'time >= ?', 'time <= ?'];
  const args: unknown[] = [space.id, from, to];
  const actors = strList(body.actorIds);
  if (actors.length) { where.push(`actor_id IN (${actors.map(() => '?').join(',')})`); args.push(...actors); }
  const events = strList(body.events, 300).filter((e) => e in AUDIT_EVENTS);
  if (events.length) { where.push(`event IN (${events.map(() => '?').join(',')})`); args.push(...events); }
  if (typeof body.teamId === 'string' && body.teamId) { where.push('team_id = ?'); args.push(body.teamId); }
  if (typeof body.requestId === 'string' && body.requestId) { where.push('request_id = ?'); args.push(body.requestId); }
  const cur = body.cursor;
  if (cur && Number.isFinite(Number(cur.time)) && typeof cur.id === 'string') {
    where.push('(time < ? OR (time = ? AND id < ?))');
    args.push(Number(cur.time), Number(cur.time), cur.id);
  }
  const rows = db.prepare(`SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY time DESC, id DESC LIMIT ?`).all(...(args as any[]), limit + 1) as unknown as AuditRow[];
  return rows;
}

function entryOf(r: AuditRow, space: SpaceRecord) {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(r.data || '{}'); } catch { /* keep empty */ }
  const page = r.category === 'page' && r.target_id ? getRecord<BlockRecord>('block', r.target_id) : undefined;
  return {
    id: r.id, time: r.time, actorId: r.actor_id, event: r.event, category: r.category, targetId: r.target_id, teamId: r.team_id,
    ip: r.ip, requestId: r.request_id, data,
    audience: page ? pageAudience(page, space) : undefined,
    pageName: page ? pageTitle(page) || (data.pageName as string | undefined) : (data.pageName as string | undefined),
  };
}

function humanizeEvent(id: string): string {
  const s = id.replace(/^workspace\.|^page\.|^user\.settings\./, '').replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------------------------- analytics helpers

function optedOut(userId: string): boolean {
  const s = getRecord<any>('user_settings', userId)?.settings;
  return s?.page_view_history === 'deny' || s?.view_history === false;
}

function dayKey(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function aiTablesExist(): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_messages'").get();
}

// ---------------------------------------------------------------------------------------------- content search helpers

function locationOf(page: BlockRecord, space: SpaceRecord): { kind: 'private' | 'team' | 'workspace' | 'page' | 'database'; label: string; teamId?: string; ownerId?: string } {
  const team = teamOfBlock(page.id);
  if (page.parent_table === 'block') {
    const parent = getRecord<BlockRecord>('block', page.parent_id);
    return { kind: 'page', label: pageTitle(parent) || 'Untitled', teamId: team?.id };
  }
  if (page.parent_table === 'collection') {
    const col = getRecord<CollectionRecord>('collection', page.parent_id);
    return { kind: 'database', label: toPlainText((col?.name ?? []) as any) || 'Untitled database', teamId: team?.id };
  }
  if (page.parent_table === 'team') return { kind: 'team', label: team?.name || 'Teamspace', teamId: team?.id };
  const owner = (page.permissions ?? []).find((p) => p.type === 'user_permission' && p.user_id)?.user_id;
  const isPrivate = !!owner && !(page.permissions ?? []).some((p) => p.type === 'space_permission');
  if (isPrivate) return { kind: 'private', label: `${userLabel(owner).name || 'Someone'}’s Private`, ownerId: owner };
  return { kind: 'workspace', label: space.name };
}

/** People with explicit access along the page's ancestry (+ teamspace members for teamspace pages). */
function accessCount(page: BlockRecord): number {
  const ids = new Set<string>();
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 60 && cur; i++) {
    for (const p of cur.permissions ?? []) if (p.type === 'user_permission' && p.user_id && p.role !== 'none') ids.add(p.user_id);
    if (cur.parent_table === 'team') {
      for (const m of getRecord<TeamRecord>('team', cur.parent_id)?.membership ?? []) ids.add(m.user_id);
      break;
    }
    if (cur.parent_table === 'collection') {
      const col: CollectionRecord | undefined = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
    } else if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else break;
  }
  return ids.size;
}

function pageRow(page: BlockRecord, space: SpaceRecord) {
  const loc = locationOf(page, space);
  return {
    pageId: page.id, title: pageTitle(page), icon: (page.format?.page_icon as string | undefined) ?? '', type: page.type,
    location: loc, audience: pageAudience(page, space), createdBy: page.created_by_id, createdTime: page.created_time,
    lastEditedBy: page.last_edited_by_id, lastEditedTime: page.last_edited_time, inTrash: page.alive === false, people: accessCount(page),
  };
}

function contentSearch(space: SpaceRecord, body: any, uid: string) {
  const q = String(body.query ?? '').trim().slice(0, 200);
  const status = body.status === 'trash' ? 'trash' : body.status === 'all' ? 'all' : body.status === 'retained' ? 'retained' : 'active';
  if (status === 'retained') {
    // Security › Data retention: pages deleted from Trash, kept for the retention window (title only)
    const rows = listRetained(space.id, q).map((r) => ({
      pageId: r.pageId, retainedId: r.id, title: r.title, icon: '', type: 'page', location: { kind: 'retained', label: '', ownerId: undefined as string | undefined }, audience: 'private',
      createdBy: r.deletedById ?? '', createdTime: r.deletedTime, lastEditedBy: r.deletedById ?? '', lastEditedTime: r.deletedTime, inTrash: false, retained: true,
      retainedUntil: r.expires, people: 0,
    }));
    return { rows: rows.slice(0, 500), total: rows.length };
  }
  const createdBy = strList(body.createdBy);
  const sharedWithAgent = typeof body.sharedWithAgent === 'string' ? body.sharedWithAgent : ''; // "Shared with" an agent 
  const audience = strList(body.audience);
  const { from, to } = { from: Number(body.createdFrom) || 0, to: Number(body.createdTo) || Number.MAX_SAFE_INTEGER };
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 500);
  let pages: BlockRecord[];
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(q.replace(/-/g, '')) || /^[0-9a-f]{32}$/i.test(q)) {
    const hex = q.replace(/-/g, '').toLowerCase();
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const b = getRecord<BlockRecord>('block', id);
    pages = b && b.space_id === space.id && PAGE_TYPES.has(b.type) ? [b] : [];
  } else if (q) {
    const ids = new Set<string>();
    for (const h of searchText(space.id, q, 2000, { userId: uid })) ids.add(h.pageId); // restricted property values don't match 
    pages = [...ids].map((id) => getRecord<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && PAGE_TYPES.has(b.type));
    // trashed pages are dropped from the search index — match their titles directly
    if (status !== 'active') {
      const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 0 AND json_extract(data, '$.type') IN ('page', 'collection_view_page') LIMIT 5000`).all(space.id) as { data: string }[];
      for (const r of rows) {
        const b = JSON.parse(r.data) as BlockRecord;
        if (!ids.has(b.id) && pageTitle(b).toLowerCase().includes(q.toLowerCase())) pages.push(b);
      }
    }
  } else {
    const alive = status === 'trash' ? 'AND alive = 0' : status === 'active' ? 'AND alive = 1' : '';
    pages = (db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? ${alive} AND json_extract(data, '$.type') IN ('page', 'collection_view_page')
                         ORDER BY last_edited_time DESC LIMIT 5000`).all(space.id) as { data: string }[]).map((r) => JSON.parse(r.data) as BlockRecord);
  }
  const rows = pages
    .filter((b) => b.space_id === space.id && !b.is_template)
    .filter((b) => (status === 'all' ? true : status === 'trash' ? b.alive === false : b.alive !== false))
    .filter((b) => !createdBy.length || createdBy.includes(b.created_by_id))
    .filter((b) => !sharedWithAgent || agentPageRole(sharedWithAgent, b.id, space.id) !== 'none')
    .filter((b) => (b.created_time ?? 0) >= from && (b.created_time ?? 0) <= to)
    .map((b) => pageRow(b, space))
    .filter((r) => !audience.length || audience.includes(r.audience))
    .sort((a, b) => (b.lastEditedTime ?? 0) - (a.lastEditedTime ?? 0));
  return { rows: rows.slice(0, limit), total: rows.length };
}

function adminPage(space: SpaceRecord, pageId: unknown): BlockRecord {
  const b = getRecord<BlockRecord>('block', String(pageId ?? ''));
  if (!b || b.space_id !== space.id || !PAGE_TYPES.has(b.type)) throw new ApiError('Page could not be found', 404);
  return b;
}

function spaceViewOf(userId: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', userId);
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (sv?.space_id === spaceId && sv.alive !== false) return sv;
  }
  return undefined;
}

function persist(items: { table: any; record: any }[]) {
  const changes = items.map((it) => ({ table: it.table, record: saveRecord(it.table, it.record), spaceId: it.record.space_id ?? null }));
  realtime.broadcastChanges(changes as any);
  return changes;
}

// ---------------------------------------------------------------------------------------------- handlers

export const handlers: Record<string, Handler> = {
  /** Settings › Audit log: filtered, newest first, 50 per page (cursor = last row). */
  getAuditLog(ctx, body) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(body?.spaceId);
    requireOwnerTool(space, uid, 'the audit log');
    const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);
    const rows = auditQuery(space, body ?? {}, limit);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const entries = page.map((r) => entryOf(r, space));
    const rm = new RecordMapBuilder(uid);
    const users = new Set<string>();
    for (const e of entries) {
      if (e.actorId) users.add(e.actorId);
      if (e.targetId && (e.category === 'workspace' || e.category === 'account' || e.category === 'team')) users.add(e.targetId);
      if (typeof e.data.userId === 'string') users.add(e.data.userId);
      if (e.teamId) rm.add('team', getRecord<TeamRecord>('team', e.teamId));
    }
    for (const id of users) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    const last = page[page.length - 1];
    return { entries, nextCursor: more && last ? { time: last.time, id: last.id } : null, recordMap: rm.map, retentionDays: RETENTION_DAYS };
  },

  /** People and agents that appear in the log (Person filter), including removed users. */
  getAuditLogActors(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireOwnerTool(space, uid, 'the audit log');
    const ids = (db.prepare('SELECT DISTINCT actor_id FROM audit_log WHERE space_id = ? AND actor_id IS NOT NULL AND time > ? LIMIT 2000').all(space.id, Date.now() - RETENTION_DAYS * DAY) as { actor_id: string }[]).map((r) => r.actor_id);
    const current = new Set(members(space));
    const rm = new RecordMapBuilder(uid);
    for (const id of new Set([...ids, ...current])) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    return { actors: [...new Set([...current, ...ids])].map((id) => ({ userId: id, removed: !current.has(id) })), recordMap: rm.map };
  },

  /** Export (CSV) with the current filters: Last 30/60/90 days, Last 1 year or a custom range. */
  downloadAuditLog(ctx, body) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(body?.spaceId);
    requireOwnerTool(space, uid, 'the audit log');
    if (!hit(`audit-export:${space.id}`, 10, 3600_000)) throw new RateLimitError('You can’t repeat this action while this is processing in the background.');
    const rows = auditQuery(space, { ...body, cursor: null }, 50_000);
    const out: unknown[][] = [['Timestamp (UTC)', 'Category', 'Event', 'User name', 'User email', 'Target', 'Teamspace', 'Page audience', 'IP address', 'Details']];
    for (const r of rows.slice(0, 50_000)) {
      const e = entryOf(r, space);
      const actor = userLabel(e.actorId);
      const target = e.category === 'page' ? (e.pageName || e.targetId) : e.targetId && getRecord('lit_user', e.targetId) ? (userLabel(e.targetId).email || userLabel(e.targetId).name) : e.targetId;
      const team = e.teamId ? getRecord<TeamRecord>('team', e.teamId)?.name ?? '' : '';
      out.push([new Date(e.time).toISOString(), e.category, humanizeEvent(e.event), actor.name, actor.email, target ?? '', team, e.audience ?? '', e.ip ?? '', JSON.stringify(e.data)]);
    }
    const { from, to } = clampRange(body?.from, body?.to);
    audit('audit_log_exported', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { startDate: from, endDate: to, duration: Math.round((to - from) / DAY), actorCount: strList(body?.actorIds).length, actionCount: strList(body?.events).length } });
    const stamp = new Date().toISOString().slice(0, 10);
    return { ...storeCsv(`Audit log ${space.name} ${stamp}.csv`, csv(out), uid, space.id), count: out.length - 1 };
  },

  /** Settings › Analytics. Overview / Members / AI / Search: owners; Content: members see the pages they can open. */
  getWorkspaceAnalytics(ctx, body) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(body?.spaceId);
    const tab = ['overview', 'members', 'content', 'ai', 'search'].includes(body?.tab) ? body.tab : 'overview';
    if (tab === 'content') {
      if (!isSpaceMember(space, uid)) throw new ApiError('Not a member', 403);
      if (space.plan_type !== 'enterprise') throw new ApiError('Upgrade to the Enterprise plan to use workspace analytics.', 403);
    } else requireOwnerTool(space, uid, 'workspace analytics');
    const days = [7, 28, 30, 60, 90, 180, 365].includes(Number(body?.days)) ? Number(body.days) : 28;
    const now = Date.now();
    const from = dayKey(now) - (days - 1) * DAY;
    const memberIds = members(space);
    const rm = new RecordMapBuilder(uid);
    const views = db.prepare('SELECT page_id, user_id, time FROM page_views WHERE space_id = ? AND time >= ?').all(space.id, from) as { page_id: string; user_id: string | null; time: number }[];
    const edits = db.prepare('SELECT page_id, user_id, created_time, data FROM activity WHERE space_id = ? AND created_time >= ?').all(space.id, from) as { page_id: string; user_id: string; created_time: number; data: string }[];

    if (tab === 'overview' || tab === 'members') {
      const byUser = new Map<string, { views: number; edits: number; last: number }>();
      const series = new Map<number, Set<string>>();
      for (let d = from; d <= dayKey(now); d += DAY) series.set(d, new Set());
      const touch = (u: string | null, t: number, kind: 'views' | 'edits') => {
        if (!u) return;
        const e = byUser.get(u) ?? { views: 0, edits: 0, last: 0 };
        e[kind]++;
        e.last = Math.max(e.last, t);
        byUser.set(u, e);
        series.get(dayKey(t))?.add(u);
      };
      for (const v of views) touch(v.user_id, v.time, 'views');
      for (const e of edits) touch(e.user_id, Number(JSON.parse(e.data || '{}').last ?? e.created_time), 'edits');
      const activeSeries = [...series.entries()].map(([date, set]) => ({ date, active: set.size }));
      if (tab === 'members') {
        const list = memberIds.map((id) => {
          const e = byUser.get(id) ?? { views: 0, edits: 0, last: 0 };
          const out = optedOut(id);
          return { userId: id, pageViews: out ? null : e.views, pageEdits: e.edits, lastActive: e.last || null, optedOut: out };
        });
        for (const id of memberIds) rm.add('lit_user', getRecord('lit_user', id), 'reader');
        return { tab, days, members: list, activeSeries, recordMap: rm.map };
      }
      // overview: totals + top teamspaces / pages
      const teamStats = new Map<string, { views: number; edits: number }>();
      const pageStats = new Map<string, number>();
      const teamFor = new Map<string, string | null>();
      const teamOf = (pageId: string) => {
        if (!teamFor.has(pageId)) teamFor.set(pageId, teamOfBlock(pageId)?.id ?? null);
        return teamFor.get(pageId)!;
      };
      for (const v of views) {
        pageStats.set(v.page_id, (pageStats.get(v.page_id) ?? 0) + 1);
        const t = teamOf(v.page_id);
        if (t) teamStats.set(t, { views: (teamStats.get(t)?.views ?? 0) + 1, edits: teamStats.get(t)?.edits ?? 0 });
      }
      for (const e of edits) {
        const t = teamOf(e.page_id);
        if (t) teamStats.set(t, { views: teamStats.get(t)?.views ?? 0, edits: (teamStats.get(t)?.edits ?? 0) + 1 });
      }
      const topTeams = [...teamStats.entries()].map(([teamId, s]) => ({ teamId, ...s })).sort((a, b) => b.views + b.edits - (a.views + a.edits)).slice(0, 5);
      for (const tm of topTeams) rm.add('team', getRecord<TeamRecord>('team', tm.teamId));
      const topPages = [...pageStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pageId, n]) => {
        const p = getRecord<BlockRecord>('block', pageId);
        return { pageId, views: n, title: pageTitle(p), canOpen: !!p && blockRole(pageId, uid) !== 'none' };
      });
      const created = (db.prepare(`SELECT COUNT(*) AS n FROM records WHERE tbl = 'block' AND space_id = ? AND json_extract(data, '$.type') IN ('page','collection_view_page') AND json_extract(data, '$.created_time') >= ?`).get(space.id, from) as { n: number }).n;
      // previous period of the same length (for "N% more than previous 28 days")
      const prevFrom = from - days * DAY;
      const prevViewers = new Set((db.prepare('SELECT DISTINCT user_id FROM page_views WHERE space_id = ? AND time >= ? AND time < ? AND user_id IS NOT NULL').all(space.id, prevFrom, from) as { user_id: string }[]).map((r) => r.user_id));
      const viewers = new Set(views.map((v) => v.user_id).filter((u): u is string => !!u));
      const isMember = (u: string) => memberIds.includes(u);
      const ranked = (kind: 'views' | 'edits') => [...byUser.entries()].filter(([u, e]) => isMember(u) && e[kind] > 0 && !(kind === 'views' && optedOut(u)))
        .sort((a, b) => b[1][kind] - a[1][kind]).slice(0, 5).map(([userId, e]) => ({ userId, count: e[kind] }));
      const topViewers = ranked('views');
      const topEditors = ranked('edits');
      for (const u of [...topViewers, ...topEditors]) rm.add('lit_user', getRecord('lit_user', u.userId), 'reader');
      return {
        tab, days, recordMap: rm.map, activeSeries, topTeams, topPages, topViewers, topEditors,
        totals: {
          activeMembers: [...viewers].filter(isMember).length, previousActiveMembers: [...prevViewers].filter(isMember).length,
          activeGuests: [...viewers].filter((u) => !isMember(u)).length, members: memberIds.length,
          pageViews: views.length, uniquePagesViewed: pageStats.size, pageEdits: edits.length, pagesCreated: created,
        },
      };
    }

    if (tab === 'content') {
      const q = String(body?.query ?? '').trim().toLowerCase();
      const createdBy = strList(body?.createdBy);
      const teamId = typeof body?.teamId === 'string' ? body.teamId : '';
      const createdFrom = Number(body?.createdFrom) || 0;
      const createdTo = Number(body?.createdTo) || Number.MAX_SAFE_INTEGER;
      const stats = new Map<string, { views: number; viewers: Set<string> }>();
      for (const v of views) {
        const s = stats.get(v.page_id) ?? { views: 0, viewers: new Set<string>() };
        s.views++;
        if (v.user_id) s.viewers.add(v.user_id);
        stats.set(v.page_id, s);
      }
      const rows = (db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND json_extract(data, '$.type') IN ('page','collection_view_page')
                                ORDER BY last_edited_time DESC LIMIT 5000`).all(space.id) as { data: string }[])
        .map((r) => JSON.parse(r.data) as BlockRecord)
        .filter((b) => !b.is_template && blockRole(b.id, uid) !== 'none')
        .filter((b) => !createdBy.length || createdBy.includes(b.created_by_id))
        .filter((b) => (b.created_time ?? 0) >= createdFrom && (b.created_time ?? 0) <= createdTo)
        .filter((b) => !teamId || teamOfBlock(b.id)?.id === teamId)
        .filter((b) => !q || pageTitle(b).toLowerCase().includes(q))
        .map((b) => ({
          pageId: b.id, title: pageTitle(b), icon: (b.format?.page_icon as string | undefined) ?? '', views: stats.get(b.id)?.views ?? 0,
          uniqueViewers: stats.get(b.id)?.viewers.size ?? 0, lastEditedTime: b.last_edited_time, lastEditedBy: b.last_edited_by_id,
          createdTime: b.created_time, createdBy: b.created_by_id, teamId: teamOfBlock(b.id)?.id ?? null,
        }));
      const sort = body?.sort === 'lastEdited' ? 'lastEdited' : body?.sort === 'uniqueViewers' ? 'uniqueViewers' : 'views';
      rows.sort((a, b) => (sort === 'lastEdited' ? (b.lastEditedTime ?? 0) - (a.lastEditedTime ?? 0) : sort === 'uniqueViewers' ? b.uniqueViewers - a.uniqueViewers : b.views - a.views));
      const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 1000);
      for (const r of rows.slice(0, limit)) {
        rm.add('lit_user', getRecord('lit_user', r.createdBy), 'reader');
        rm.add('lit_user', getRecord('lit_user', r.lastEditedBy), 'reader');
        if (r.teamId) rm.add('team', getRecord<TeamRecord>('team', r.teamId));
      }
      return { tab, days, pages: rows.slice(0, limit), total: rows.length, recordMap: rm.map };
    }

    if (tab === 'search') {
      const rows = db.prepare('SELECT query, user_id, clicked_page_id FROM search_log WHERE space_id = ? AND time >= ?').all(space.id, from) as { query: string; user_id: string; clicked_page_id: string | null }[];
      const byQuery = new Map<string, { searches: number; users: Set<string>; clicks: number }>();
      for (const r of rows) {
        const s = byQuery.get(r.query) ?? { searches: 0, users: new Set<string>(), clicks: 0 };
        s.searches++;
        s.users.add(r.user_id);
        if (r.clicked_page_id) s.clicks++;
        byQuery.set(r.query, s);
      }
      // the system lists terms searched at least twice by at least two people
      const queries = [...byQuery.entries()]
        .filter(([, s]) => s.searches >= 2 && s.users.size >= 2)
        .map(([query, s]) => ({ query, searches: s.searches, uniqueSearches: s.users.size, clickThroughRate: s.searches ? s.clicks / s.searches : 0 }))
        .sort((a, b) => b.searches - a.searches)
        .slice(0, 200);
      return { tab, days, queries, totalSearches: rows.length, recordMap: rm.map };
    }

    // ai: AI chats (ai_threads / ai_messages): active members, actions (= user turns), utilization
    const series = new Map<number, number>();
    for (let d = from; d <= dayKey(now); d += DAY) series.set(d, 0);
    const perUser = new Map<string, number>();
    if (aiTablesExist()) {
      const turns = db.prepare(`SELECT t.user_id AS user_id, m.created_time AS time FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id
                                WHERE t.space_id = ? AND m.role = 'user' AND m.created_time >= ?`).all(space.id, from) as { user_id: string; time: number }[];
      for (const r of turns) {
        if (isBotId(r.user_id)) continue; // Custom Agents' triggered runs — listed in the Custom Agents card 
        perUser.set(r.user_id, (perUser.get(r.user_id) ?? 0) + 1);
        series.set(dayKey(r.time), (series.get(dayKey(r.time)) ?? 0) + 1);
      }
    }
    const actions = [...perUser.values()].reduce((a, b) => a + b, 0);
    const active = [...perUser.keys()].filter((u) => memberIds.includes(u)).length;
    const topUsers = [...perUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([userId, n]) => ({ userId, actions: n }));
    for (const u of topUsers) rm.add('lit_user', getRecord('lit_user', u.userId), 'reader');
    return {
      tab, days, recordMap: rm.map, series: [...series.entries()].map(([date, n]) => ({ date, actions: n })), topUsers,
      totals: { activeAiMembers: active, aiActions: actions, actionsPerUser: active ? actions / active : 0, utilization: memberIds.length ? active / memberIds.length : 0 },
    };
  },

  /** Analytics › Members / Content › Export to CSV. */
  exportWorkspaceAnalytics(ctx, body) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(body?.spaceId);
    const tab = body?.tab === 'content' ? 'content' : 'members';
    const res = handlers.getWorkspaceAnalytics(ctx, { ...body, tab, limit: 1000 }) as any;
    const fmt = (t: number | null | undefined) => (t ? new Date(t).toISOString() : '');
    let out: unknown[][];
    if (tab === 'members') {
      out = [['Name', 'Email', 'Page views', 'Page edits', 'Last active']];
      for (const m of res.members) { const u = userLabel(m.userId); out.push([u.name, u.email, m.optedOut ? 'Hidden' : m.pageViews, m.pageEdits, fmt(m.lastActive)]); }
      audit('user_analytics_exported', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip });
    } else {
      out = [['Page', 'Page ID', 'Views', 'Unique viewers', 'Created by', 'Created', 'Last changed by', 'Last edited']];
      for (const p of res.pages) out.push([p.title, p.pageId, p.views, p.uniqueViewers, userLabel(p.createdBy).name, fmt(p.createdTime), userLabel(p.lastEditedBy).name, fmt(p.lastEditedTime)]);
      audit('content_analytics_exported', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return storeCsv(`${tab === 'members' ? 'Members' : 'Content'} analytics ${space.name} ${stamp}.csv`, csv(out), uid, space.id);
  },

  /** Settings › Content search: every page in the workspace (incl. private and trashed) by ID, title or content. */
  searchContentAsAdmin(ctx, body) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(body?.spaceId);
    requireOwnerTool(space, uid, 'content search');
    const res = contentSearch(space, body ?? {}, uid);
    audit('admin_content_search_queried', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { searchCriteria: String(body?.query ?? '').slice(0, 100), status: body?.status ?? 'active' }, coalesceMs: 60_000 });
    const rm = new RecordMapBuilder(uid);
    for (const r of res.rows) {
      rm.add('lit_user', getRecord('lit_user', r.createdBy), 'reader');
      rm.add('lit_user', getRecord('lit_user', r.lastEditedBy), 'reader');
      if (r.location.ownerId) rm.add('lit_user', getRecord('lit_user', r.location.ownerId), 'reader');
    }
    return { ...res, recordMap: rm.map };
  },

  adminContentSearchExport(ctx, body) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(body?.spaceId);
    requireOwnerTool(space, uid, 'content search');
    const res = contentSearch(space, { ...body, limit: 500 }, uid);
    const out: unknown[][] = [['Page', 'Page ID', 'Location', 'Audience', 'Created by', 'Created', 'People who can access this', 'Last edited', 'In Trash']];
    for (const r of res.rows) out.push([r.title, r.pageId, r.location.label, r.audience, userLabel(r.createdBy).name, r.createdTime ? new Date(r.createdTime).toISOString() : '', r.people, r.lastEditedTime ? new Date(r.lastEditedTime).toISOString() : '', r.inTrash ? 'Yes' : 'No']);
    audit('admin_content_search_exported', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { searchCriteria: String(body?.query ?? '').slice(0, 100) } });
    return storeCsv(`Content search ${space.name}.csv`, csv(out), uid, space.id);
  },

  /** Content search row ••• › View original permissions / Change permissions: the page's own sharing entries. */
  adminGetPagePermissions(ctx, { spaceId, pageId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireOwnerTool(space, uid, 'content search');
    const page = adminPage(space, pageId);
    const memberSet = new Set(members(space));
    const rm = new RecordMapBuilder(uid);
    const entries = (page.permissions ?? []).map((p: Permission, index) => {
      if (p.user_id) rm.add('lit_user', getRecord('lit_user', p.user_id), 'reader');
      return { index, type: p.type, role: p.role, userId: p.user_id ?? null, guest: !!p.user_id && !memberSet.has(p.user_id), published: !!p.published };
    });
    return { pageId: page.id, title: pageTitle(page), audience: pageAudience(page, space), entries, recordMap: rm.map };
  },

  /** Change permissions: revoke one sharing entry (a guest, a public link, workspace access…) with admin privileges. */
  adminRemovePagePermission(ctx, { spaceId, pageId, index }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireOwnerTool(space, uid, 'content search');
    const page = adminPage(space, pageId);
    const perms = [...(page.permissions ?? [])];
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= perms.length) throw new ApiError('Permission not found', 404);
    const [removed] = perms.splice(i, 1);
    if (page.parent_table === 'space' && !perms.length) throw new ApiError('A private page needs at least one person with access.');
    const prev = page;
    const [saved] = persist([{ table: 'block', record: { ...page, permissions: perms } }]);
    audit(removed.type === 'public_permission' ? 'page_shared_to_web' : 'page_permission_updated', {
      spaceId: space.id, actorId: uid, targetId: page.id, teamId: teamOfBlock(page.id)?.id ?? null, ip: ctx.ip,
      data: { pageName: pageTitle(prev), kind: removed.type, userId: removed.user_id, oldRole: removed.role, newRole: 'none', enabled: false, withAdminPerms: true },
    });
    return { permissions: (saved.record as BlockRecord).permissions ?? [] };
  },

  /** Restore to original location / Restore to Private pages (of the acting owner): both restore a page from Trash
   *  (or the retention store), as expected — a live page is never moved by them. */
  adminRestorePage(ctx, { spaceId, pageId, to }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireOwnerTool(space, uid, 'content search');
    const page = adminPage(space, pageId);
    const items: { table: any; record: any }[] = [];
    const now = Date.now();
    if (page.alive !== false) throw new ApiError('This page isn’t in Trash.');
    if (to === 'private') {
      const sv = spaceViewOf(uid, space.id);
      if (!sv) throw new ApiError('Workspace could not be found', 404);
      if (page.parent_table === 'collection') throw new ApiError('Database pages can only be restored to their database.');
      // detach from every list that still shows it: the old parent, the teamspace, the Workspace section and anyone's
      // Private pages, then attach it under the acting owner's Private section
      if (page.parent_table === 'block') {
        const parent = getRecord<BlockRecord>('block', page.parent_id);
        if (parent && (parent.content ?? []).includes(page.id)) items.push({ table: 'block', record: { ...parent, content: (parent.content ?? []).filter((id) => id !== page.id) } });
      } else if (page.parent_table === 'team') {
        const team = getRecord<TeamRecord>('team', page.parent_id);
        if (team && (team.team_pages ?? []).includes(page.id)) items.push({ table: 'team', record: { ...team, team_pages: (team.team_pages ?? []).filter((id) => id !== page.id) } });
      }
      if ((space.pages ?? []).includes(page.id)) items.push({ table: 'space', record: { ...space, pages: (space.pages ?? []).filter((id) => id !== page.id) } });
      const listing = db.prepare(`SELECT data FROM records WHERE tbl = 'space_view' AND space_id = ? AND data LIKE ?`).all(space.id, `%"${page.id}"%`) as { data: string }[];
      for (const r of listing) {
        const other = JSON.parse(r.data) as SpaceViewRecord;
        if (other.id === sv.id || !(other.private_pages ?? []).includes(page.id)) continue;
        items.push({ table: 'space_view', record: { ...other, private_pages: (other.private_pages ?? []).filter((id) => id !== page.id) } });
      }
      items.push({ table: 'block', record: { ...page, alive: true, deleted_time: undefined, deleted_by_id: undefined, parent_id: space.id, parent_table: 'space', permissions: [{ type: 'user_permission', role: 'editor', user_id: uid, added_timestamp: now }], last_edited_time: now, last_edited_by_id: uid } });
      items.push({ table: 'space_view', record: { ...sv, private_pages: [page.id, ...(sv.private_pages ?? []).filter((id) => id !== page.id)] } });
    } else {
      items.push({ table: 'block', record: { ...page, alive: true, deleted_time: undefined, deleted_by_id: undefined } });
      if (page.parent_table === 'block') {
        const parent = getRecord<BlockRecord>('block', page.parent_id);
        if (!parent || parent.alive === false) throw new ApiError('The original location is in Trash. Restore it to Private pages instead.');
        if (!(parent.content ?? []).includes(page.id)) items.push({ table: 'block', record: { ...parent, content: [...(parent.content ?? []), page.id] } });
      } else if (page.parent_table === 'team') {
        const team = getRecord<TeamRecord>('team', page.parent_id);
        if (team && !(team.team_pages ?? []).includes(page.id)) items.push({ table: 'team', record: { ...team, team_pages: [...(team.team_pages ?? []), page.id] } });
      } else if (page.parent_table === 'space') {
        const owner = (page.permissions ?? []).find((p) => p.type === 'user_permission' && p.user_id)?.user_id;
        const isPrivate = !!owner && !(page.permissions ?? []).some((p) => p.type === 'space_permission');
        const sv = owner ? spaceViewOf(owner, space.id) : undefined;
        if (isPrivate && sv) {
          if (!(sv.private_pages ?? []).includes(page.id)) items.push({ table: 'space_view', record: { ...sv, private_pages: [page.id, ...(sv.private_pages ?? [])] } });
        } else if (!(space.pages ?? []).includes(page.id)) items.push({ table: 'space', record: { ...space, pages: [...(space.pages ?? []), page.id] } });
      }
    }
    persist(items);
    audit('page_restored', { spaceId: space.id, actorId: uid, targetId: page.id, teamId: teamOfBlock(page.id)?.id ?? null, ip: ctx.ip, data: { pageName: pageTitle(page), withAdminPerms: true, to: to === 'private' ? 'private' : 'original' } });
    return { ok: true };
  },

  /** Content search › Retained pages › Restore: the page comes back from the retention store, then to its location. */
  adminRestoreRetained(ctx, { spaceId, retainedId, to }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireOwnerTool(space, uid, 'content search');
    const page = restoreRetained(space.id, String(retainedId ?? ''));
    if (!page) throw new ApiError('This page is no longer retained.', 404);
    return handlers.adminRestorePage(ctx, { spaceId: space.id, pageId: page.id, to: to === 'private' ? 'private' : 'original' });
  },

  /** Permanently delete a page that is in Trash (with administrator privileges). */
  adminDeletePagePermanently(ctx, { spaceId, pageId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireOwnerTool(space, uid, 'content search');
    const page = adminPage(space, pageId);
    if (page.alive !== false) throw new ApiError('Move the page to Trash before deleting it permanently.');
    const ids: string[] = [];
    const q: BlockRecord[] = [page];
    const seen = new Set<string>();
    while (q.length && ids.length < 50_000) {
      const cur = q.pop()!;
      if (seen.has(cur.id)) continue;
      seen.add(cur.id);
      ids.push(cur.id);
      for (const c of childBlocks(cur, { alive: false })) q.push(c);
    }
    audit('page.permanently_deleted', { spaceId: space.id, actorId: uid, targetId: page.id, ip: ctx.ip, data: { pageName: pageTitle(page), withAdminPerms: true } });
    void ids;
    return { deleted: purgePage(page, uid) };
  },

  /** Settings › Connections › Manage › All connections : every member's custom MCP connections
   *  (features/ai — ai_mcp_connections), without secrets. Workspace owners only. */
  getWorkspaceConnections(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (spaceRoleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can view all connections.', 403);
    const rows = hasTable('ai_mcp_connections')
      ? db.prepare('SELECT id, user_id, name, url, enabled, created_time FROM ai_mcp_connections WHERE space_id = ? ORDER BY created_time DESC LIMIT 500').all(space.id) as any[]
      : [];
    const rm = new RecordMapBuilder(uid);
    for (const id of new Set(rows.map((r) => r.user_id))) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    return {
      connections: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name, host: hostOf(r.url), enabled: !!r.enabled, createdTime: r.created_time })),
      recordMap: rm.map,
    };
  },

  /** Owners remove a member's connection ("View & manage" › Remove). */
  removeWorkspaceConnection(ctx, { spaceId, connectionId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (spaceRoleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can remove connections.', 403);
    if (!hasTable('ai_mcp_connections')) throw new ApiError('Connection could not be found', 404);
    const row = db.prepare('SELECT id, user_id, name FROM ai_mcp_connections WHERE id = ? AND space_id = ?').get(String(connectionId ?? ''), space.id) as any;
    if (!row) throw new ApiError('Connection could not be found', 404);
    db.prepare('DELETE FROM ai_mcp_connections WHERE id = ? AND space_id = ?').run(row.id, space.id);
    return { removed: true };
  },

  /** Members of a workspace may check whether they can see analytics/audit tabs (nav visibility + plan). */
  getAdminToolsAccess(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    const owner = spaceRoleOf(space, uid) === 'owner';
    return { owner, admin: isSpaceAdmin(space, uid), enterprise: space.plan_type === 'enterprise', member: isSpaceMember(space, uid) };
  },
};
