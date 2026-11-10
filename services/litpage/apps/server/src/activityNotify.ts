// Database activity → Inbox :
//  -  / : adding someone to a Person property notifies them ("mentioned you in" + the property),
//    unless the property's Notifications setting (schema[prop].notification_mode) is 'none'.
//  - : database pages followed with "All updates" notify on every property change by others, "Important
//    updates" only for status / person / date changes (comments are handled by comments.ts).
// Runs on records.ts onCommit, so every path that writes rows (UI, API, automations, AI) is covered.
import type { BlockRecord, CollectionRecord, FollowRecord, PropertySchema, SpaceRecord } from '@nc/shared/records.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import type { Annotation, RichText } from '@nc/shared/richtext.ts';
import { db, getRecord } from './db.ts';
import { blockRole, onCommit, type CommitInfo } from './records.ts';
import { stableJson } from './authz.ts';
import { pushNotification } from './notify.ts';

const IMPORTANT_TYPES = new Set(['status', 'person', 'date']);
const recent = new Map<string, number>();

function throttled(key: string, ms: number, now: number): boolean {
  if ((recent.get(key) ?? 0) > now - ms) return true;
  recent.set(key, now);
  if (recent.size > 10_000) recent.clear();
  return false;
}

/** Permission group ids in a Person value (["g", groupId, spaceId] atoms). */
export function personGroupIds(v: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(v)) return out;
  for (const d of v as RichText) {
    for (const a of (Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as Annotation[]) : [])) {
      if (a?.[0] === 'g' && typeof a[1] === 'string' && !out.includes(a[1])) out.push(a[1]);
    }
  }
  return out;
}

/** Workspace members in permission groups (Settings › People › Groups). */
function groupMembers(space: SpaceRecord | undefined, groupIds: string[]): string[] {
  const groups = ((space?.settings as { groups?: { id?: string; member_ids?: string[] }[] } | undefined)?.groups ?? []);
  const out = new Set<string>();
  for (const g of groups) if (g?.id && groupIds.includes(g.id)) for (const m of g.member_ids ?? []) if (isSpaceMember(space, m)) out.add(m);
  return [...out];
}

export function personIds(v: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(v)) return out;
  for (const d of v as RichText) {
    for (const a of (Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as Annotation[]) : [])) {
      if (a?.[0] === 'u' && typeof a[1] === 'string' && !out.includes(a[1])) out.push(a[1]);
    }
  }
  return out;
}

function followers(pageId: string): FollowRecord[] {
  return (db.prepare(`SELECT data FROM records WHERE tbl = 'follow' AND json_extract(data, '$.navigable_block_id') = ?`).all(pageId) as { data: string }[])
    .map((r) => JSON.parse(r.data) as FollowRecord)
    .filter((f) => f.following !== false);
}

export function notifyRowChange(row: BlockRecord, prev: BlockRecord | undefined, actorId: string, now = Date.now()) {
  const col = getRecord<CollectionRecord>('collection', row.parent_id);
  if (!col || row.alive === false) return;
  const schema = col.schema ?? {};
  // ---- Person property assignments
  for (const [pid, p] of Object.entries(schema) as [string, PropertySchema][]) {
    if (p?.type !== 'person') continue;
    const mode = (p.notification_mode as string | undefined) ?? 'users';
    if (mode === 'none') continue;
    const before = new Set(personIds(prev?.properties?.[pid]));
    const added = personIds(row.properties?.[pid]).filter((uid) => !before.has(uid));
    // "Users and groups": members of groups added to the value hear about it too
    if (mode === 'users_and_groups') {
      const hadGroups = new Set(personGroupIds(prev?.properties?.[pid]));
      const newGroups = personGroupIds(row.properties?.[pid]).filter((g) => !hadGroups.has(g));
      if (newGroups.length) {
        const already = new Set(personIds(prev?.properties?.[pid]));
        for (const uid of groupMembers(getRecord<SpaceRecord>('space', row.space_id), newGroups)) if (!already.has(uid) && !added.includes(uid)) added.push(uid);
      }
    }
    for (const uid of added) {
      if (uid === actorId || !getRecord('lit_user', uid)) continue;
      if (blockRole(row.id, uid) === 'none') continue;
      if (throttled(`assign:${uid}:${row.id}:${pid}`, 60_000, now)) continue;
      pushNotification({
        user_id: uid, space_id: row.space_id, type: 'property_mention', navigable_block_id: row.id, actor_id: actorId,
        activity: { page_id: row.id, kind: 'property_mention', property: pid, property_name: p.name, collection_id: col.id },
      });
    }
  }
  // ---- "Notify me" on database pages: All updates / Important updates
  if (!prev) return;
  const changed: { id: string; name: string; type: string }[] = [];
  for (const k of new Set([...Object.keys(prev.properties ?? {}), ...Object.keys(row.properties ?? {})])) {
    if (stableJson(prev.properties?.[k]) === stableJson(row.properties?.[k])) continue;
    const p = k === 'title' ? { name: schema.title?.name ?? 'Name', type: 'title' } : schema[k];
    if (p) changed.push({ id: k, name: p.name ?? k, type: String(p.type) });
  }
  if (!changed.length) return;
  const important = changed.some((c) => IMPORTANT_TYPES.has(c.type));
  for (const f of followers(row.id)) {
    const level = f.follow_settings?.level;
    if (f.user_id === actorId || (level !== 'all_updates' && !(level === 'important_updates' && important))) continue;
    if (blockRole(row.id, f.user_id) === 'none') continue;
    if (throttled(`update:${f.user_id}:${row.id}:${actorId}`, 5 * 60_000, now)) continue;
    const shown = level === 'important_updates' ? changed.filter((c) => IMPORTANT_TYPES.has(c.type)) : changed;
    pushNotification({
      user_id: f.user_id, space_id: row.space_id, type: 'page_edit', navigable_block_id: row.id, actor_id: actorId,
      activity: { page_id: row.id, kind: 'property_edit', properties: shown.slice(0, 10).map((c) => ({ id: c.id, name: c.name })) },
    });
  }
}

onCommit((info: CommitInfo) => {
  const now = Date.now();
  for (const ch of info.changes) {
    if (ch.table !== 'block') continue;
    const b = ch.record as BlockRecord;
    if (b.parent_table !== 'collection') continue;
    try {
      notifyRowChange(b, info.prev.get(`block:${b.id}`) as BlockRecord | undefined, info.userId, now);
    } catch (e) {
      console.error('[activity notify] failed', e);
    }
  }
});
