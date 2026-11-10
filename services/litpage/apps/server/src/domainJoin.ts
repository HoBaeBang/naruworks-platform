// Settings › General › Allowed email domains: people who sign up with an email on one of a workspace's
// allowed domains join it automatically (as members; on the Free plan as workspace owners) — or, with
// "Allow teammates with allowed email domains to join as members" set to "Request to join", ask to join (a member
// request admins approve in Settings › Requests / their Inbox), or nothing ("No access").
// space.settings.allowed_email_domains: string[]
// space.settings.allowed_email_domain_join: 'auto' (default) | 'request' | 'none'
import { newId } from '@nc/shared/ids.ts';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { db, getRecord } from './db.ts';
import { addMember, saveRecord } from './seed.ts';
import { audit } from './audit.ts';
import { realtime } from './realtime.ts';
import { notifyWorkspaceRequest } from './notify.ts';

export type DomainJoinMode = 'auto' | 'request' | 'none';

export function emailDomain(email: string): string {
  return String(email ?? '').trim().toLowerCase().split('@')[1] ?? '';
}

export function domainJoinMode(space: SpaceRecord | undefined): DomainJoinMode {
  const m = (space?.settings as any)?.allowed_email_domain_join;
  return m === 'request' || m === 'none' ? m : 'auto';
}

/** Workspaces (not deleted) that list this email's domain as an allowed domain. */
export function spacesAllowingDomain(email: string): SpaceRecord[] {
  const d = emailDomain(email);
  if (!d) return [];
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'space' AND data LIKE ?`).all(`%"allowed_email_domains"%${d.replace(/[%_]/g, '')}%`) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as SpaceRecord)
    .filter((s) => !(s as any).deleted_time && ((s.settings as any)?.allowed_email_domains ?? []).includes(d));
}

/** Whether this email already asked to join `space` (a pending member request). */
export function hasPendingDomainRequest(space: SpaceRecord, email: string): boolean {
  const e = String(email).trim().toLowerCase();
  return (((space.settings as any)?.member_requests ?? []) as { emails?: string[] }[]).some((r) => r.emails?.includes(e));
}

/** "Request to join": a member request admins approve (Settings › Requests, their Inbox). Idempotent per email. */
export function requestDomainMembership(s: SpaceRecord, userId: string, email: string): void {
  const space = getRecord<SpaceRecord>('space', s.id) ?? s;
  if (hasPendingDomainRequest(space, email)) return;
  const e = String(email).trim().toLowerCase();
  const list = ((space.settings as any)?.member_requests ?? []) as unknown[];
  const req = { id: newId(), emails: [e], requested_by: userId, created_time: Date.now(), via: 'allowed_email_domain' };
  const saved = saveRecord('space', { ...space, settings: { ...(space.settings ?? {}), member_requests: [...list, req] } });
  realtime.broadcastChanges([{ table: 'space', record: saved, spaceId: space.id }] as any);
  notifyWorkspaceRequest({ spaceId: space.id, requesterId: userId, kind: 'member', emails: [e], requestId: req.id });
}

/**
 * Join (or ask to join) a workspace through its allowed email domains, following its join mode: "Join automatically"
 * adds the person as a member (owner on the Free plan), "Request to join" files a member request,
 * "No access" does nothing. Callers make sure `email`'s domain is allowed (spacesAllowingDomain).
 */
export function joinThroughAllowedDomain(s: SpaceRecord, userId: string, email: string): 'joined' | 'requested' | 'none' {
  if ((s.permissions ?? []).some((p) => p.user_id === userId && p.role !== 'none')) return 'joined';
  const mode = domainJoinMode(s);
  if (mode === 'none') return 'none';
  if (mode === 'request') {
    requestDomainMembership(s, userId, email);
    return 'requested';
  }
  addMember(s.id, userId, s.plan_type === 'free' ? 'owner' : 'editor');
  audit('member_joined', { spaceId: s.id, actorId: userId, targetId: userId, data: { via: 'allowed_email_domain', domain: emailDomain(email) } });
  return 'joined';
}

/**
 * Called once for a brand-new account: join every workspace that allows the email's domain ("Join automatically"),
 * or file a membership request ("Request to join"). Returns the ids of the workspaces joined.
 */
export function autoJoinAllowedDomains(userId: string, email: string): string[] {
  const joined: string[] = [];
  for (const s of spacesAllowingDomain(email).slice(0, 20)) {
    if ((s.permissions ?? []).some((p) => p.user_id === userId && p.role !== 'none')) continue;
    if (joinThroughAllowedDomain(s, userId, email) === 'joined') joined.push(s.id);
  }
  return joined;
}
