// First account of a fresh deployment. Production shows no login codes on screen and may have no mail server, so
// NC_BOOTSTRAP_EMAIL + NC_BOOTSTRAP_PASSWORD create that person (onboarded, with a workspace) on the first start and
// keep the password in sync; they sign in with "Continue with password". Nothing happens when either is unset.
import { newId } from '@nc/shared/ids.ts';
import { findUserIdByEmail, getRecord, putRecord } from './db.ts';
import { createUser, createWorkspace, seedDemoContent } from './seed.ts';
import { isDemoMode } from './demo.ts';
import { setPassword } from './auth.ts';
import { disableMfa } from './mfa.ts';
import { deleteAllPasskeys } from './passkeys.ts';
import type { UserRecord } from '@nc/shared/records.ts';

export function bootstrapOwner() {
  const email = process.env.NC_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.NC_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;
  let userId = findUserIdByEmail(email);
  if (!userId) {
    userId = newId();
    const user = createUser(userId, email, process.env.NC_BOOTSTRAP_NAME?.trim() || email.split('@')[0]);
    putRecord('lit_user', { ...user, onboarding_completed: true });
    const created = createWorkspace(userId, process.env.NC_BOOTSTRAP_WORKSPACE?.trim() || 'Workspace');
    if (isDemoMode()) seedDemoContent(created.space.id, userId);
    console.log('[server] bootstrap: created the first account');
  } else if (getRecord<UserRecord>('lit_user', userId)?.onboarding_completed === false) {
    putRecord('lit_user', { ...getRecord<UserRecord>('lit_user', userId)!, onboarding_completed: true });
  }
  setPassword(userId, password);
  if (isDemoMode()) {
    // A deployment can be switched to demo mode without wiping first. Remove old second factors so the published password remains usable.
    disableMfa(userId);
    deleteAllPasskeys(userId);
    const root = getRecord<any>('user_root', userId);
    const view = root?.space_views?.map((id: string) => getRecord<any>('space_view', id)).find((v: any) => v?.alive !== false);
    if (view) seedDemoContent(view.space_id, userId);
  }
}
