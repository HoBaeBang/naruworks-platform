// Workspace invite links: /invite/<code> (Settings › People › Copy invite link). The code is kept in
// sessionStorage across login / onboarding; once signed in we join the workspace and switch to it.
import { api } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';

const KEY = 'nc:pendingInvite';

export function rememberInvite(code: string) {
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
}

export function pendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let running = false;

/** Join the workspace of the pending invite (if any) and switch to it. */
export async function acceptPendingInvite(): Promise<boolean> {
  const code = pendingInvite();
  if (!code || running) return false;
  running = true;
  try {
    sessionStorage.removeItem(KEY);
    const res = await api<{ spaceId: string; domain: string }>('joinSpaceByInviteLink', { code });
    await useSession.getState().load();
    useSession.getState().setSpace(res.spaceId);
    navigate(`/${res.domain}`, { replace: true });
    return true;
  } catch (e) {
    useUI.getState().toast((e as Error).message || 'This invite link is invalid.');
    if (useSession.getState().status === 'ready') navigate('/', { replace: true });
    return false;
  } finally {
    running = false;
  }
}
