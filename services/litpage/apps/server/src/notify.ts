// Notification delivery: Inbox records + email, honoring Settings › Notifications.
// pushNotification(n) Inbox item for one user (realtime push → badge) and, per the user's email settings,
// a delayed email: "Activity in my workspace" (user_settings.email_activity, default on,
// and space_view.notify_email) sends once the item is still unread after a few minutes
// and the user is not active; "Always send email notifications" (email_always)
// sends right away. Page invites always email at once (the invitee may not be active yet).
// updateNotification(n, p) change an item server-side (e.g. resolved access request) and push it
// effectiveTimeZone(userId) the user's time zone (Settings › Preferences), for reminders and digests
// api/modules/notifications.ts re-exports pushNotification for older importers.
import { newId, pageSlug } from '@nc/shared/ids.ts';
import type { BlockRecord, NotificationRecord, SpaceRecord, SpaceViewRecord, TeamRecord, UserRecord, UserRootRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getRecord } from './db.ts';
import { saveRecord } from './seed.ts';
import { realtime } from './realtime.ts';
import { registerJobHandler, scheduleJob, cancelJob } from './scheduler.ts';
import { appUrl, mailTemplates, sendMail } from './mail.ts';

export type NotificationInput = {
  user_id: string;
  space_id: string;
  type: NotificationRecord['type'];
  navigable_block_id?: string;
  actor_id?: string;
  discussion_id?: string;
  comment_id?: string;
  activity?: Record<string, unknown>;
};

/** Types that may produce an "Activity in my workspace" email. */
const EMAIL_TYPES = new Set<string>([
  'mention', 'comment', 'invite', 'reminder', 'property_mention', 'access_requested', 'access_granted', 'team_join_requested', 'team_join_approved',
  'space_member_requested', 'automation', 'verification_expired',
]);

export function emailDelayMs(): number {
  const v = Number(process.env.NC_EMAIL_DELAY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 5 * 60_000;
}

export function userPrefs(userId: string): Record<string, unknown> {
  return (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
}

export function spaceViewOf(userId: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', userId);
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (sv?.space_id === spaceId && sv.parent_id === userId && sv.alive !== false) return sv;
  }
  return undefined;
}

/** Settings › Notifications › Email notifications for one user in one workspace. */
export function emailPrefs(userId: string, spaceId: string | null) {
  const p = userPrefs(userId);
  const sv = spaceId ? spaceViewOf(userId, spaceId) : undefined;
  return {
    activity: p.email_activity !== false && sv?.notify_email !== false,
    always: p.email_always === true,
    pageUpdates: p.email_page_updates !== false,
    digest: p.email_workspace_digest !== false,
  };
}

function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Settings › Preferences › Time zone: the manual zone, else the device zone the device reported, else UTC. */
export function effectiveTimeZone(userId: string | null | undefined): string {
  const p = userId ? userPrefs(userId) : {};
  if (p.time_zone_auto === false && validTz(p.time_zone)) return p.time_zone;
  if (validTz(p.device_time_zone)) return p.device_time_zone;
  if (validTz(p.time_zone)) return p.time_zone;
  return 'UTC';
}

function pushRecord(rec: NotificationRecord) {
  realtime.notifyUser(rec.user_id, { type: 'records', records: [{ table: 'notification', id: rec.id, version: rec.version, value: rec, role: 'editor' }] });
}

export function pushNotification(n: NotificationInput, opts: { email?: boolean } = {}): NotificationRecord {
  const rec: NotificationRecord = { id: newId(), version: 0, read: false, archived: false, created_time: Date.now(), ...n };
  saveRecord('notification', rec);
  pushRecord(rec);
  if (opts.email !== false) queueNotificationEmail(rec);
  return rec;
}

/** Update a stored notification (server-owned fields such as activity) and push it to its owner. */
export function updateNotification(id: string, patch: Partial<NotificationRecord> | ((n: NotificationRecord) => Partial<NotificationRecord>)): NotificationRecord | null {
  const cur = getRecord<NotificationRecord>('notification', id);
  if (!cur) return null;
  const p = typeof patch === 'function' ? patch(cur) : patch;
  const next = { ...cur, ...p, activity: p.activity ? { ...(cur.activity ?? {}), ...p.activity } : cur.activity } as NotificationRecord;
  saveRecord('notification', next);
  pushRecord(next);
  return next;
}

// ---------------------------------------------------------------- notification emails
function queueNotificationEmail(rec: NotificationRecord) {
  if (!EMAIL_TYPES.has(rec.type)) return;
  if ((rec.activity as { kind?: string } | undefined)?.kind === 'reaction') return; // reactions stay in-app
  const user = getRecord<UserRecord>('lit_user', rec.user_id);
  if (!user?.email) return;
  const prefs = emailPrefs(rec.user_id, rec.space_id);
  // invites reach people who may not have opened the service yet: send at once (the invite itself is the email)
  const immediate = rec.type === 'invite';
  if (!prefs.activity && !immediate) return;
  const at = Date.now() + (immediate || prefs.always ? 0 : emailDelayMs());
  scheduleJob('notification-email', `notify-email:${rec.id}`, at, { notificationId: rec.id });
}

export function cancelNotificationEmail(notificationId: string) {
  cancelJob(`notify-email:${notificationId}`);
}

function titleOf(b: BlockRecord | undefined): string {
  if (!b) return 'Untitled';
  if (b.type === 'collection_view_page' && b.collection_id) {
    const c = getRecord<{ name?: any } & { id: string; version: number }>('collection', b.collection_id);
    const t = toPlainText(c?.name);
    if (t) return t;
  }
  return toPlainText(b.properties?.title) || 'Untitled';
}

export function pageLink(pageId: string | undefined, spaceId?: string): string {
  const page = pageId ? getRecord<BlockRecord>('block', pageId) : undefined;
  const space = getRecord<SpaceRecord>('space', page?.space_id ?? spaceId ?? '');
  if (!page) return appUrl(space ? `/${space.domain}` : '/');
  return appUrl(`/${space?.domain ?? 'workspace'}/${pageSlug(titleOf(page), page.id)}`);
}

function nameOf(userId: string | undefined): string {
  const u = userId ? getRecord<UserRecord>('lit_user', userId) : undefined;
  return u?.name || u?.email || 'Someone';
}

/** Subject / headline / quote of the email for one Inbox item. */
export function notificationEmail(n: NotificationRecord): { subject: string; text: string; html: string } | null {
  const a = (n.activity ?? {}) as Record<string, any>;
  const pageId = (a.page_id as string | undefined) ?? n.navigable_block_id;
  const page = pageId ? getRecord<BlockRecord>('block', pageId) : undefined;
  const pageTitle = titleOf(page);
  const actor = nameOf(n.actor_id);
  const space = getRecord<SpaceRecord>('space', n.space_id);
  const url = pageLink(pageId, n.space_id);
  const quote = typeof a.text === 'string' && a.text ? a.text : undefined;
  const team = a.team_id ? getRecord<TeamRecord>('team', String(a.team_id)) : undefined;
  let subject: string;
  let headline: string;
  let link = url;
  let detail: string | undefined;
  switch (n.type) {
    case 'mention':
      subject = `${actor} tagged you on ${pageTitle}`;
      headline = subject;
      break;
    case 'comment':
      subject = `${actor} left a comment on ${pageTitle}`;
      headline = a.kind === 'reply' ? `${actor} replied on ${pageTitle}` : subject;
      break;
    case 'invite':
      return mailTemplates.pageInvite({ inviter: actor, pageTitle, url, workspace: space?.name, role: a.role ? roleText(String(a.role)) : undefined });
    case 'reminder':
      subject = `Reminder for ${pageTitle}`;
      headline = subject;
      detail = a.date_text ? String(a.date_text) : undefined;
      break;
    case 'property_mention':
      subject = `${actor} tagged you on ${pageTitle}`;
      headline = a.property_name ? `${actor} added you to ${a.property_name} on ${pageTitle}` : subject;
      break;
    case 'access_requested':
      subject = a.kind === 'page_edit' ? `${actor} asked to edit ${pageTitle}` : `${actor} asked to access ${pageTitle}`;
      headline = subject;
      detail = 'Open your Inbox in Litpage to approve or deny this request.';
      break;
    case 'access_granted':
      subject = a.kind === 'page_edit' ? `${actor} approved your edit request for ${pageTitle}` : `${actor} gave you access to ${pageTitle}`;
      headline = subject;
      break;
    case 'team_join_requested':
      subject = `${actor} asked to join ${team?.name ?? 'a team'}`;
      headline = subject;
      link = appUrl(`/${space?.domain ?? ''}/library/teamspaces`);
      detail = 'Open your Inbox in Litpage to approve or deny this request.';
      break;
    case 'team_join_approved':
      subject = `${actor} welcomed you to ${team?.name ?? 'a team'}`;
      headline = subject;
      link = appUrl(`/${space?.domain ?? ''}/library/teamspaces`);
      break;
    case 'space_member_requested':
      subject = `${actor} asked to add someone to ${space?.name ?? 'your workspace'}`;
      headline = subject;
      link = appUrl(`/${space?.domain ?? ''}`);
      break;
    case 'automation':
      subject = a.kind === 'paused'
        ? `${a.automation_name ?? 'An automation'} is paused`
        : typeof a.subject === 'string' && a.subject ? a.subject : `${a.automation_name ?? 'An automation'} sent an update`;
      headline = subject;
      detail = a.kind === 'paused' ? 'Fix the errors or remove the failing steps, then enable this automation again.' : undefined;
      if (!quote && typeof a.message === 'string') return mailTemplates.notification({ subject, headline, quote: a.message.slice(0, 500), detail, url, workspace: space?.name });
      break;
    case 'verification_expired':
      subject = a.kind === 'wiki' ? `Wiki verification expired for ${pageTitle}` : `Page verification expired for ${pageTitle}`;
      headline = subject;
      break;
    default:
      return null;
  }
  return mailTemplates.notification({ subject, headline, quote: quote?.slice(0, 500), detail, url: link, workspace: space?.name });
}

function roleText(r: string): string {
  return ({ editor: 'Full', read_and_write: 'Can edit', comment_only: 'Can comment', reader: 'Can view' } as Record<string, string>)[r] ?? '';
}

registerJobHandler('notification-email', (payload: { notificationId?: string }) => {
  const n = payload?.notificationId ? getRecord<NotificationRecord>('notification', payload.notificationId) : undefined;
  if (!n) return;
  const prefs = emailPrefs(n.user_id, n.space_id);
  const immediate = n.type === 'invite';
  if (!prefs.activity && !immediate) return;
  // without "Always send email notifications": only when the item is still unread and the user isn't active
  if (!prefs.always && !immediate && (n.read || n.archived || realtime.isConnected(n.user_id))) return;
  const user = getRecord<UserRecord>('lit_user', n.user_id);
  if (!user?.email) return;
  const content = notificationEmail(n);
  if (!content) return;
  sendMail({ to: user.email, toUserId: user.id, kind: `notification:${n.type}`, ...content, meta: { notificationId: n.id, spaceId: n.space_id } });
});

/** "X invited you to <workspace>" email for people added through Settings › Members / Add members (WS invite). */
export function sendWorkspaceInviteEmail(spaceId: string, inviterId: string, userId: string) {
  const user = getRecord<UserRecord>('lit_user', userId);
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!user?.email || !space || userId === inviterId) return;
  sendMail({
    to: user.email, toUserId: userId, kind: 'workspace_invite',
    ...mailTemplates.workspaceInvite({ inviter: nameOf(inviterId), workspace: space.name, url: appUrl(`/${space.domain}`) }), meta: { spaceId },
  });
}

/** Login code email (the outbox redacts it after 15 minutes). */
export function sendLoginCodeEmail(email: string, code: string) {
  sendMail({ to: email, kind: 'login_code', ...mailTemplates.loginCode(code), sensitive: true });
}

/** Settings › Requests (api/modules/workspace.ts calls these): a member asked to add people / upgrade
 * → workspace owners & membership admins get an Inbox item; resolving it → the requester hears back. */
export function notifyWorkspaceRequest(o: { spaceId: string; requesterId: string; kind: 'member' | 'upgrade'; emails?: string[]; plan?: string; message?: string; requestId?: string }) {
  const space = getRecord<SpaceRecord>('space', o.spaceId);
  if (!space) return;
  const admins = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && ((p.role as string) === 'owner' || (p.role as string) === 'membership_admin')).map((p) => p.user_id!);
  for (const a of admins.filter((x) => x !== o.requesterId).slice(0, 20)) {
    pushNotification({
      user_id: a, space_id: o.spaceId, type: 'space_member_requested', actor_id: o.requesterId,
      activity: { kind: o.kind, emails: o.emails, plan: o.plan, message: o.message || undefined, request_id_ws: o.requestId },
    });
  }
}

export function notifyWorkspaceRequestResolved(o: { spaceId: string; requesterId: string; actorId: string; kind: 'member' | 'upgrade'; status: 'approved' | 'denied'; emails?: string[]; plan?: string; self?: boolean; spaceName?: string }) {
  if (o.requesterId === o.actorId) return;
  pushNotification({
    user_id: o.requesterId, space_id: o.spaceId, type: 'access_granted', actor_id: o.actorId,
    // self: the requester asked to join themselves (guest banner / team invite link) — "welcomed you to {workspace}"
    activity: { kind: o.kind === 'upgrade' ? 'upgrade_request' : 'member_request', status: o.status, emails: o.emails, plan: o.plan, ...(o.self ? { self: true, space_name: o.spaceName } : {}) },
  });
}
