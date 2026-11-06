// Settings › Account security (SET-ACC): two-factor authentication (authenticator apps + backup codes, and the login
// step that asks for a code), password removal, secondary emails ("Manage emails"), account deletion.
// Password set/change lives in handlers.ts (setPassword) with the rules in policy.ts (passwordProblem).
import { createHash, randomInt } from 'node:crypto';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import type { SpaceRecord, SpaceViewRecord, UserRecord, UserRootRecord } from '@nc/shared/records.ts';
import { db, findUserIdByEmail, getRecord } from '../../db.ts';
import { checkPassword, clearSessionCookie, createSession, devLoginCodesEnabled, hasPassword, sessionCookie } from '../../auth.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder } from '../../records.ts';
import { exemptIp, hit, RateLimitError } from '../../ratelimit.ts';
import { saveRecord } from '../../seed.ts';
import { realtime } from '../../realtime.ts';
import { sendMail, esc } from '../../mail.ts';
import { audit, auditAccount } from '../../audit.ts';
import {
  BACKUP_CODE_COUNT, MAX_AUTHENTICATORS, MfaError, backupCodesRemaining, completeLoginChallenge, completeTotpEnrollment, deleteFactor, disableMfa,
  listFactors, mfaEnabled, regenerateBackupCodes, renameFactor, startTotpEnrollment, verifySecondFactor,
} from '../../mfa.ts';
import { deleteWorkspace, detachMember, commitRecords } from './workspace.ts';
import {
  PasskeyError, deleteAllPasskeys, deletePasskey, listPasskeys, loginOptions as passkeyLoginOpts, registrationOptions, renamePasskey,
  verifyAssertion, verifyRegistration,
} from '../../passkeys.ts';

type Handler = (ctx: Ctx, body: any) => any;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAILS = 5;
const CODE_TTL_MS = 15 * 60_000;

db.exec(`
CREATE TABLE IF NOT EXISTS user_emails (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_emails_user ON user_emails(user_id);
CREATE TABLE IF NOT EXISTS email_verifications (
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, email)
);
`);

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function rethrow(e: unknown): never {
  if (e instanceof MfaError || e instanceof PasskeyError) throw new ApiError(e.message, e.status);
  throw e;
}

function pk<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    rethrow(e);
  }
}

/** "Chrome on macOS"-style default passkey name from the User-Agent. */
function deviceName(ua: string | undefined): string {
  const s = String(ua ?? '');
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** For sensitive changes once 2FA is on: a current authenticator or backup code ("To continue, we need to verify your identity"). */
function requireSecondFactor(uid: string, code: unknown, method?: unknown) {
  if (!mfaEnabled(uid)) return;
  if (!hit(`mfa-verify:user:${uid}`, 10, 15 * 60_000)) throw new RateLimitError('Too many attempts. Try again later.');
  const m = method === 'backup' ? 'backup' : method === 'totp' ? 'totp' : 'any';
  if (!verifySecondFactor(uid, String(code ?? ''), m)) {
    throw new ApiError(m === 'backup' ? 'That backup code was not accepted. Try it again or use another code.' : 'That code was not accepted. Enter it again.', 401);
  }
}

function emailsOf(uid: string): { email: string; primary: boolean }[] {
  const user = getRecord<UserRecord>('lit_user', uid);
  const rows = db.prepare('SELECT email FROM user_emails WHERE user_id = ? ORDER BY created_time').all(uid) as { email: string }[];
  return [...(user?.email ? [{ email: user.email, primary: true }] : []), ...rows.map((r) => ({ email: r.email, primary: false }))];
}

function codeHash(code: string): string {
  return createHash('sha256').update(String(code).trim()).digest('hex');
}

/**
 * Workspaces affected by deleting this account: every workspace where the user is the only owner is deleted
 * with the account — also when other members are in it (they lose access; the final dialog lists them); the user
 * simply leaves the others.
 */
function deletionImpact(uid: string) {
  const root = getRecord<UserRootRecord>('user_root', uid);
  const spaces = (root?.space_views ?? [])
    .map((id) => getRecord<SpaceViewRecord>('space_view', id))
    .filter((v): v is SpaceViewRecord => !!v && v.alive !== false && v.parent_id === uid)
    .map((v) => getRecord<SpaceRecord>('space', v.space_id))
    .filter((s): s is SpaceRecord => !!s && isSpaceMember(s, uid));
  const toDelete: { space: SpaceRecord; otherMembers: number }[] = [];
  const toLeave: SpaceRecord[] = [];
  for (const s of spaces) {
    const members = (s.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none');
    const owners = members.filter((p) => (p.role as string) === 'owner');
    if (members.length <= 1 || (owners.length === 1 && owners[0].user_id === uid)) toDelete.push({ space: s, otherMembers: members.length - 1 });
    else toLeave.push(s);
  }
  return { toDelete, toLeave };
}

export const handlers: Record<string, Handler> = {
  /** Settings › Account › Account security model. */
  getAccountSecurity(ctx) {
    const uid = requireUser(ctx);
    return {
      hasPassword: hasPassword(uid),
      mfa: { enabled: mfaEnabled(uid), factors: listFactors(uid), backupCodesRemaining: backupCodesRemaining(uid), maxAuthenticators: MAX_AUTHENTICATORS },
      emails: emailsOf(uid),
      maxEmails: MAX_EMAILS,
    };
  },

  // ---------------------------------------------------------------- two-factor authentication
  /** "Code from authenticator" step 1: secret + otpauth URI for the QR code. A password is required first. */
  startTotpEnrollment(ctx, { code, method }) {
    const uid = requireUser(ctx);
    if (!hasPassword(uid)) throw new ApiError('Enter a password before turning on two-factor authentication.', 400);
    requireSecondFactor(uid, code, method); // adding a second authenticator needs the first one
    const user = getRecord<UserRecord>('lit_user', uid);
    try {
      return startTotpEnrollment(uid, user?.email || uid);
    } catch (e) {
      rethrow(e);
    }
  },
  /** Step 2: name + first code → authenticator saved; the first one turns 2FA on and returns the backup codes (once). */
  completeTotpEnrollment(ctx, { enrollmentId, name, code }) {
    const uid = requireUser(ctx);
    if (!hit(`mfa-enroll:user:${uid}`, 20, 15 * 60_000)) throw new RateLimitError();
    const wasOn = mfaEnabled(uid);
    try {
      const res = completeTotpEnrollment(uid, String(enrollmentId ?? ''), String(name ?? ''), String(code ?? ''));
      if (!wasOn) {
        auditAccount('mfa_totp_toggled', uid, { ip: ctx.ip, data: { enabled: true, name: res.factor.name } });
        auditAccount('mfa_backup_code_toggled', uid, { ip: ctx.ip, data: { enabled: true } });
      } else auditAccount('mfa_totp_toggled', uid, { ip: ctx.ip, data: { enabled: true, name: res.factor.name } });
      return { factor: res.factor, backupCodes: res.backupCodes, backupCodeCount: BACKUP_CODE_COUNT };
    } catch (e) {
      rethrow(e);
    }
  },
  renameMfaFactor(ctx, { factorId, name }) {
    const uid = requireUser(ctx);
    try {
      renameFactor(uid, String(factorId ?? ''), String(name ?? ''));
    } catch (e) {
      rethrow(e);
    }
    return { factors: listFactors(uid) };
  },
  /** Delete an authenticator (verification needed); the last one turns 2FA off. */
  deleteMfaFactor(ctx, { factorId, code, method }) {
    const uid = requireUser(ctx);
    requireSecondFactor(uid, code, method);
    try {
      const still = deleteFactor(uid, String(factorId ?? ''));
      auditAccount('mfa_totp_toggled', uid, { ip: ctx.ip, data: { enabled: false } });
      if (!still) auditAccount('mfa_backup_code_toggled', uid, { ip: ctx.ip, data: { enabled: false } });
      return { enabled: still, factors: listFactors(uid) };
    } catch (e) {
      rethrow(e);
    }
  },
  /** "Turn off two-factor authentication". */
  disableMfa(ctx, { code, method }) {
    const uid = requireUser(ctx);
    requireSecondFactor(uid, code, method);
    if (mfaEnabled(uid)) {
      disableMfa(uid);
      auditAccount('mfa_totp_toggled', uid, { ip: ctx.ip, data: { enabled: false } });
      auditAccount('mfa_backup_code_toggled', uid, { ip: ctx.ip, data: { enabled: false } });
    }
    return { enabled: false };
  },
  /** "Regenerate backup codes": the old ones stop working. */
  regenerateBackupCodes(ctx, { code, method }) {
    const uid = requireUser(ctx);
    if (!mfaEnabled(uid)) throw new ApiError('Two-factor authentication is not turned on.');
    requireSecondFactor(uid, code, method);
    const codes = regenerateBackupCodes(uid);
    auditAccount('mfa_backup_code_toggled', uid, { ip: ctx.ip, data: { enabled: true, regenerated: true } });
    return { backupCodes: codes };
  },
  /** Login step 2 ("Verify your identity"): the token from signInWithEmail plus an authenticator or backup code. */
  loginWithMfa(ctx, { mfaToken, code, method }) {
    if (!exemptIp(ctx.ip) && !hit(`mfa-login:ip:${ctx.ip}`, 60, 3600_000)) throw new RateLimitError('Too many login attempts. Try again later.');
    let res: { userId: string; method: 'totp' | 'backup' };
    try {
      res = completeLoginChallenge(String(mfaToken ?? ''), String(code ?? ''), method === 'backup' ? 'backup' : method === 'totp' ? 'totp' : 'any');
    } catch (e) {
      rethrow(e);
    }
    const token = createSession(res.userId);
    ctx.setCookie(sessionCookie(token, !!ctx.secure));
    auditAccount('login', res.userId, { ip: ctx.ip, data: { authType: 'mfa', mfaMethod: res.method } });
    return { userId: res.userId, isNewUser: false, backupCodesRemaining: res.method === 'backup' ? backupCodesRemaining(res.userId) : undefined };
  },

  // ---------------------------------------------------------------- passkeys (passkeys.ts: WebAuthn verification)
  getPasskeys(ctx) {
    const uid = requireUser(ctx);
    return { passkeys: listPasskeys(uid) };
  },
  passkeyRegistrationOptions(ctx) {
    const uid = requireUser(ctx);
    if (!hit(`passkey-reg:user:${uid}`, 20, 15 * 60_000)) throw new RateLimitError();
    const user = getRecord<UserRecord>('lit_user', uid);
    return pk(() => registrationOptions({ id: uid, email: user?.email ?? '', name: user?.name }, ctx.origin));
  },
  registerPasskey(ctx, { challengeId, credential, name }) {
    const uid = requireUser(ctx);
    const passkey = pk(() => verifyRegistration(uid, challengeId, credential ?? {}, String(name ?? '') || deviceName(ctx.userAgent)));
    return { passkey, passkeys: listPasskeys(uid) };
  },
  updatePasskeyName(ctx, { id, name }) {
    const uid = requireUser(ctx);
    pk(() => renamePasskey(uid, id, name));
    return { passkeys: listPasskeys(uid) };
  },
  deletePasskey(ctx, { id }) {
    const uid = requireUser(ctx);
    pk(() => deletePasskey(uid, id));
    return { passkeys: listPasskeys(uid) };
  },
  /** Login page › Passkey: options for a discoverable-credential sign-in (no email needed). */
  passkeyLoginOptions(ctx) {
    if (!exemptIp(ctx.ip) && !hit(`passkey-login:ip:${ctx.ip}`, 60, 15 * 60_000)) throw new RateLimitError('Too many login attempts. Try again later.');
    return pk(() => passkeyLoginOpts(ctx.origin));
  },
  /** A passkey is a phishing-resistant second factor in itself: no authenticator code is asked after it. */
  loginWithPasskey(ctx, { challengeId, credential }) {
    if (!exemptIp(ctx.ip) && !hit(`passkey-verify:ip:${ctx.ip}`, 60, 15 * 60_000)) throw new RateLimitError('Too many login attempts. Try again later.');
    const { userId } = pk(() => verifyAssertion(challengeId, credential ?? {}));
    if (!getRecord('lit_user', userId)) throw new ApiError('This passkey isn’t registered to a Litpage account.', 401);
    const token = createSession(userId);
    ctx.setCookie(sessionCookie(token, !!ctx.secure));
    auditAccount('login', userId, { ip: ctx.ip, data: { authType: 'passkey' } });
    return { userId, isNewUser: false };
  },

  // ---------------------------------------------------------------- password
  /** "Remove password for temporary login codes?": back to email-code login; turns 2FA off too (it needs a password). */
  removePassword(ctx, { currentPassword }) {
    const uid = requireUser(ctx);
    if (!hasPassword(uid)) return {};
    if (!hit(`pw-check:user:${uid}`, 10, 15 * 60_000)) throw new RateLimitError();
    if (!checkPassword(uid, String(currentPassword ?? ''))) throw new ApiError('Incorrect password.', 401);
    db.prepare('DELETE FROM passwords WHERE user_id = ?').run(uid);
    auditAccount('password_cleared', uid, { ip: ctx.ip });
    // "Two-factor authentication will also be removed if you continue." (it needs a password)
    if (mfaEnabled(uid)) {
      disableMfa(uid);
      auditAccount('mfa_totp_toggled', uid, { ip: ctx.ip, data: { enabled: false } });
      auditAccount('mfa_backup_code_toggled', uid, { ip: ctx.ip, data: { enabled: false } });
    }
    return {};
  },

  // ---------------------------------------------------------------- secondary emails (Manage emails)
  /** "Add email": sends a verification code to the new address (dev: also returned like login codes). */
  addSecondaryEmail(ctx, { email }) {
    const uid = requireUser(ctx);
    const e = String(email ?? '').trim().toLowerCase();
    if (!e || e.length > 254 || !EMAIL_RE.test(e)) throw new ApiError('Please provide a valid email address.');
    if (emailsOf(uid).length >= MAX_EMAILS) throw new ApiError(`You can add up to ${MAX_EMAILS} emails to your account.`);
    const owner = findUserIdByEmail(e);
    if (owner) throw new ApiError(owner === uid ? 'This email is already on your account.' : 'This email is already used by another Litpage account.');
    if (!hit(`email-verify:user:${uid}`, 10, 3600_000) || !hit(`email-verify:email:${e}`, 5, 15 * 60_000)) throw new RateLimitError();
    const code = String(randomInt(100000, 1000000));
    db.prepare(`INSERT INTO email_verifications (user_id, email, code_hash, expires, attempts) VALUES (?, ?, ?, ?, 0)
                ON CONFLICT(user_id, email) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0`)
      .run(uid, e, codeHash(code), Date.now() + CODE_TTL_MS);
    sendMail({
      to: e, toUserId: uid, kind: 'verify_email', sensitive: true,
      subject: `Your Litpage verification code is ${code}`,
      text: `Verify your email\n\nEnter this code in Litpage to add ${e} to your account:\n\n${code}\n\nIf you didn't request this, you can ignore this email.`,
      html: `<p>Enter this code in Litpage to add <b>${esc(e)}</b> to your account:</p><p style="font-size:24px;font-weight:700;letter-spacing:2px">${esc(code)}</p><p>If you didn't request this, you can ignore this email.</p>`,
    });
    return { email: e, ...(devLoginCodesEnabled() ? { devCode: code } : {}) };
  },
  verifySecondaryEmail(ctx, { email, code }) {
    const uid = requireUser(ctx);
    const e = String(email ?? '').trim().toLowerCase();
    const row = db.prepare('SELECT code_hash, expires, attempts FROM email_verifications WHERE user_id = ? AND email = ?').get(uid, e) as { code_hash: string; expires: number; attempts: number } | undefined;
    if (!row || row.expires < Date.now() || row.attempts >= 5) throw new ApiError('Invalid or expired verification code.', 401);
    db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = ? AND email = ?').run(uid, e);
    if (row.code_hash !== codeHash(String(code ?? ''))) throw new ApiError('Invalid or expired verification code.', 401);
    if (findUserIdByEmail(e)) throw new ApiError('This email is already used by another Litpage account.');
    if (emailsOf(uid).length >= MAX_EMAILS) throw new ApiError(`You can add up to ${MAX_EMAILS} emails to your account.`);
    db.prepare('INSERT INTO user_emails (email, user_id, created_time) VALUES (?, ?, ?)').run(e, uid, Date.now());
    db.prepare('DELETE FROM email_verifications WHERE user_id = ? AND email = ?').run(uid, e);
    auditAccount('user.settings.alias_added', uid, { ip: ctx.ip, data: { email: e } });
    return { emails: emailsOf(uid) };
  },
  removeSecondaryEmail(ctx, { email }) {
    const uid = requireUser(ctx);
    const e = String(email ?? '').trim().toLowerCase();
    const res = db.prepare('DELETE FROM user_emails WHERE email = ? AND user_id = ?').run(e, uid);
    if (!Number(res.changes ?? 0)) throw new ApiError('Email not found', 404);
    auditAccount('user.settings.alias_removed', uid, { ip: ctx.ip, data: { email: e } });
    return { emails: emailsOf(uid) };
  },
  /** "Make primary": the secondary address becomes the account email (the old primary stays as secondary). */
  makeEmailPrimary(ctx, { email }) {
    const uid = requireUser(ctx);
    const e = String(email ?? '').trim().toLowerCase();
    const row = db.prepare('SELECT email FROM user_emails WHERE email = ? AND user_id = ?').get(e, uid);
    if (!row) throw new ApiError('Email not found', 404);
    const user = getRecord<UserRecord>('lit_user', uid);
    if (!user) throw new ApiError('Not found', 404);
    const old = user.email;
    db.prepare('DELETE FROM user_emails WHERE email = ?').run(e);
    if (old) db.prepare('INSERT OR REPLACE INTO user_emails (email, user_id, created_time) VALUES (?, ?, ?)').run(old, uid, Date.now());
    const saved = saveRecord('lit_user', { ...user, email: e });
    realtime.broadcastChanges([{ table: 'lit_user', record: saved, spaceId: null }] as any);
    auditAccount('user.settings.alias_made_primary', uid, { ip: ctx.ip, data: { email: e } });
    auditAccount('email_changed', uid, { ip: ctx.ip, data: { oldEmail: old, newEmail: e } });
    const rm = new RecordMapBuilder(uid);
    rm.add('lit_user', saved, 'editor');
    return { emails: emailsOf(uid), recordMap: rm.map };
  },

  // ---------------------------------------------------------------- delete my account
  /** What "Delete my account" will do: workspaces deleted with the account, and those blocking it (sole owner). */
  getAccountDeletionPreview(ctx) {
    const uid = requireUser(ctx);
    const { toDelete, toLeave } = deletionImpact(uid);
    const pick = (s: SpaceRecord) => ({ id: s.id, name: s.name, icon: s.icon ?? '' });
    return {
      toDelete: toDelete.map((d) => ({ ...pick(d.space), otherMembers: d.otherMembers })), toLeave: toLeave.map(pick),
      affectedMembers: toDelete.reduce((n, d) => n + d.otherMembers, 0), mfa: mfaEnabled(uid), hasPassword: hasPassword(uid),
      factors: listFactors(uid).map((f) => ({ id: f.id, name: f.name, kind: f.kind, createdTime: f.createdTime })),
    };
  },
  /**
   * "Permanently delete account and {n} workspaces": the email must be typed; with 2FA a code is required; the client
   * must confirm exactly the workspaces that will be deleted (those where the user is the only owner — the final
   * "Are you sure?" dialog), so a stale or scripted request can't delete a workspace the user didn't see. The user
   * leaves every other workspace; sessions, password, 2FA and secondary emails are removed and the profile is
   * anonymized (the address can sign up again).
   */
  deleteAccount(ctx, { email, code, method, confirmWorkspaceIds }) {
    const uid = requireUser(ctx);
    const user = getRecord<UserRecord>('lit_user', uid);
    if (!user) throw new ApiError('Not found', 404);
    if (String(email ?? '').trim().toLowerCase() !== String(user.email ?? '').toLowerCase()) throw new ApiError('Type your email address to confirm.');
    requireSecondFactor(uid, code, method);
    const { toDelete, toLeave } = deletionImpact(uid);
    const confirmed = new Set(Array.isArray(confirmWorkspaceIds) ? confirmWorkspaceIds.map(String) : []);
    const unconfirmed = toDelete.filter((d) => d.otherMembers > 0 && !confirmed.has(d.space.id));
    if (unconfirmed.length) {
      throw new ApiError(`Confirm that ${unconfirmed.map((d) => `“${d.space.name}”`).join(', ')} will be deleted with your account.`, 409);
    }
    auditAccount('user_deleted', uid, { ip: ctx.ip, data: { workspacesDeleted: toDelete.length } });
    for (const d of toDelete) deleteWorkspace(getRecord<SpaceRecord>('space', d.space.id) ?? d.space, uid);
    for (const s of toLeave) {
      const fresh = getRecord<SpaceRecord>('space', s.id) ?? s;
      commitRecords(uid, detachMember(fresh, uid));
      audit('member_left', { spaceId: s.id, actorId: uid, targetId: uid, ip: ctx.ip });
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM passwords WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM user_emails WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(uid);
    disableMfa(uid);
    deleteAllPasskeys(uid);
    const deleted = saveRecord('lit_user', { ...user, email: '', name: 'Deleted user', given_name: '', family_name: '', profile_photo: undefined, deleted_time: Date.now() } as UserRecord);
    realtime.broadcastChanges([{ table: 'lit_user', record: deleted, spaceId: null }] as any);
    ctx.setCookie(clearSessionCookie(!!ctx.secure));
    return { deletedWorkspaces: toDelete.length };
  },
};
