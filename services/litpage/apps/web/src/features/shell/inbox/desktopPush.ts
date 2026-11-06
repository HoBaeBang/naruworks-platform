
// Inbox items also appear as browser notifications — when the user allowed them ("Enable desktop notifications" in
// Inbox › More actions) and Settings › Notifications keeps desktop notifications on (space_view.notify_desktop).
import type { BlockRecord, NotificationRecord, UserRecord } from '@nc/shared/records.ts';
import { records } from '../../../lib/store/records.ts';
import { currentSpaceView, useSession } from '../../../lib/store/session.ts';
import { openPage } from '../../../lib/router.ts';
import { pageTitle } from '../../page/pageActions.ts';

const seen = new Set<string>();
let installed = false;

export function desktopPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopPushState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  return desktopPushSupported() ? Notification.permission : 'unsupported';
}

export async function enableDesktopPush(): Promise<boolean> {
  if (!desktopPushSupported()) return false;
  const r = await Notification.requestPermission();
  return r === 'granted';
}

function text(n: NotificationRecord): { title: string; body: string } {
  const actor = records.get<UserRecord>('lit_user', n.actor_id);
  const who = actor?.name || actor?.email || 'Someone';
  const a = (n.activity ?? {}) as Record<string, any>;
  const page = records.get<BlockRecord>('block', (a.page_id as string) ?? n.navigable_block_id);
  const title = pageTitle(page) || 'a page';
  switch (n.type) {
    case 'mention':
    case 'property_mention':
      return { title: `${who} mentioned you on ${title}`, body: a.text ?? '' };
    case 'comment':
      return { title: a.kind === 'reaction' ? `${who} reacted in ${title}` : `${who} commented in ${title}`, body: a.text ?? '' };
    case 'invite':
      return { title: `${who} sent you an invite to ${title}`, body: '' };
    case 'reminder':
      return { title: `Reminder in ${title}`, body: a.text ?? a.date_text ?? '' };
    case 'access_requested':
      return { title: `${who} asked for access to ${title}`, body: a.message ?? '' };
    default:
      return { title: `${who} updated ${title}`, body: '' };
  }
}

export function installDesktopPush() {
  if (installed || !desktopPushSupported()) return;
  installed = true;
  for (const n of records.all<NotificationRecord>('notification')) seen.add(n.id);
  records.subscribeAll((keys) => {
    for (const k of keys) {
      if (!k.startsWith('notification:')) continue;
      const id = k.slice('notification:'.length);
      if (seen.has(id)) continue;
      seen.add(id);
      const n = records.get<NotificationRecord>('notification', id);
      const me = useSession.getState().userId;
      if (!n || n.user_id !== me || n.read || n.archived || Date.now() - n.created_time > 60_000) continue;
      if (Notification.permission !== 'granted' || currentSpaceView()?.notify_desktop === false) continue;
      if (!document.hidden && document.hasFocus()) continue;
      const { title, body } = text(n);
      try {
        const note = new Notification(title, { body: body.slice(0, 200), tag: n.id });
        note.onclick = () => {
          window.focus();
          const pid = ((n.activity as { page_id?: string } | undefined)?.page_id) ?? n.navigable_block_id;
          if (pid) openPage(pid);
          note.close();
        };
      } catch {
        /* notifications blocked by the browser */
      }
    }
  });
}
