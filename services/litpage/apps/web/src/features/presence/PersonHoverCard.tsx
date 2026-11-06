// People hover card: hovering a person (Inbox actor, avatar, @mention in page text) for a
// moment shows photo, name, email, role in the workspace, local time and teamspaces, with "View profile" →
// /<domain>/people/<id>. Workspace owners can switch hover cards / profiles off (space.settings
// hover_cards_enabled / people_profiles_enabled). Mentions rendered by the editor are picked up by delegation
// (installPersonHoverDelegation), so editor files need no changes.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, spaceDomain } from '../../lib/router.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { TeamIcon } from '../shell/sidebar/TeamIcon.tsx';
import { t } from '../shell/i18n.ts';
import { UserAvatar, userName } from './Avatar.tsx';
import './presence.css';

export interface PersonProfile {
  userId: string;
  role: 'owner' | 'membership_admin' | 'member' | 'restricted_member' | 'guest' | 'none';
  teams: { id: string; name: string; icon: string; owner: boolean }[];
  timeZone: string | null;
  title: string;
}

const cache = new Map<string, Promise<{ profile: PersonProfile; profilesEnabled: boolean; hoverCardsEnabled: boolean } | null>>();

export function fetchProfile(userId: string, opts: { activity?: boolean } = {}) {
  const spaceId = useSession.getState().spaceId;
  const key = `${spaceId}:${userId}:${opts.activity ? 1 : 0}`;
  if (!cache.has(key)) {
    cache.set(key, api('getPersonProfile', { spaceId, userId, withActivity: !!opts.activity })
      .then((r) => {
        records.mergeRecordMap(r.recordMap);
        return r;
      })
      .catch(() => null));
    setTimeout(() => cache.delete(key), 60_000);
  }
  return cache.get(key)!;
}

export function roleLabel(role: PersonProfile['role']): string {
  switch (role) {
    case 'owner':
      return t('lp.presence.workspace_owner', 'Workspace Owner');
    case 'membership_admin':
      return t('lp.presence.admin', 'Admin');
    case 'guest':
      return t('lp.presence.guest', 'Guest');
    case 'restricted_member':
      return t('lp.presence.restricted_member', 'Restricted Member');
    case 'none':
      return t('lp.presence.deactivated', 'Deactivated');
    default:
      return t('lp.presence.member', 'Member');
  }
}

/** Guests: workspace admins "Upgrade to member", members "Request to add as member". */
function GuestUpgrade({ email }: { email?: string }) {
  const space = records.get<SpaceRecord>('space', useSession.getState().spaceId);
  const me = useSession.getState().userId;
  const admin = !!space?.permissions?.some((p) => p.user_id === me && ((p.role as string) === 'owner' || (p.role as string) === 'membership_admin'));
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  if (!email || !space) return null;
  const run = async () => {
    if (state !== 'idle') return;
    setState('busy');
    try {
      if (admin) await api('inviteMembers', { spaceId: space.id, emails: [email], role: 'editor' });
      else await api('requestMembers', { spaceId: space.id, emails: [email] });
      setState('done');
      cache.clear();
    } catch (e: any) {
      setState('idle');
      useUI.getState().toast(e?.message || (admin ? t('lp.presence.couldn_t_upgrade_to_a_member', 'Couldn’t upgrade {nameOrEmail} to a member', { nameOrEmail: email }) : t('lp.presence.couldn_t_send_the_request', 'Couldn’t send the request')));
    }
  };
  if (state === 'done') {
    return <div className="nc-person-card-note">{admin ? t('lp.presence.was_upgraded_to_a_member', '{nameOrEmail} was upgraded to a member', { nameOrEmail: email }) : t('lp.presence.request_sent', 'Request sent')}</div>;
  }
  return (
    <div role="button" className="nc-person-card-upgrade" aria-disabled={state === 'busy'} onClick={() => void run()}>
      {admin
        ? <><span className="blue">{t('lp.presence.upgrade', 'Upgrade')}</span> {t('lp.presence.to_member', 'to member')}</>
        : <><span className="blue">{t('lp.presence.request', 'Request')}</span> {t('lp.presence.to_add_as_member', 'to add as member')}</>}
    </div>
  );
}

export function localTime(tz: string | null): string | null {
  if (!tz) return null;
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
}

function spaceFlag(key: string): boolean {
  const space = records.get<SpaceRecord>('space', useSession.getState().spaceId);
  return (space?.settings as Record<string, unknown> | undefined)?.[key] !== false;
}

export function openProfile(userId: string) {
  navigate(`/${spaceDomain(useSession.getState().spaceId)}/people/${userId}`);
}

function PersonCard({ userId, onLeave, onEnter, close }: { userId: string; onLeave: () => void; onEnter: () => void; close: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchProfile>> | undefined>(undefined);
  const u = records.get<UserRecord>('lit_user', userId);
  useEffect(() => {
    let alive = true;
    void fetchProfile(userId).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [userId]);
  const p = data?.profile;
  const time = localTime(p?.timeZone ?? null);
  return (
    <PopoverSurface width={300} className="nc-person-card">
      <div className="nc-person-card-body" data-user-id={userId} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <div className="nc-person-card-head">
          <UserAvatar userId={userId} size={48} />
          <div className="nc-person-card-names">
            <div className="nc-person-card-name">{userName(u)}</div>
            {u?.email && <div className="nc-person-card-email">{u.email}</div>}
          </div>
        </div>
        {p && (
          <div className="nc-person-card-rows">
            {p.title && <div className="nc-person-card-row"><Icon name="info" size={14} /><span>{p.title}</span></div>}
            <div className="nc-person-card-row"><Icon name="user" size={14} /><span>{roleLabel(p.role)}</span></div>
            {time && <div className="nc-person-card-row"><Icon name="clock" size={14} /><span>{t('lp.presence.local_time', '{time} local time', { time })}</span></div>}
            {p.teams.length > 0 && (
              <div className="nc-person-card-row teams">
                <Icon name="team" size={14} />
                <span className="nc-person-card-teams">
                  {p.teams.slice(0, 3).map((tm) => <span key={tm.id} className="nc-person-card-team"><TeamIcon team={{ id: tm.id, name: tm.name, icon: tm.icon }} size={14} />{tm.name}</span>)}
                  {p.teams.length > 3 && <span className="nc-person-card-more">+{p.teams.length - 3}</span>}
                </span>
              </div>
            )}
          </div>
        )}
        {p?.role === 'guest' && <GuestUpgrade email={u?.email} />}
        <div className="nc-person-card-actions">
          {data?.profilesEnabled !== false && (
            <div role="button" className="nc-person-card-btn" onClick={() => { close(); openProfile(userId); }}>
              <Icon name="user" size={14} />{t('lp.presence.view_profile', 'View profile')}
            </div>
          )}
          {u?.email && (
            <a className="nc-person-card-btn" href={`mailto:${u.email}`} onClick={() => close()}>
              <Icon name="mail" size={14} />{t('lp.presence.email', 'Email')}
            </a>
          )}
        </div>
      </div>
    </PopoverSurface>
  );
}

let openCard: { userId: string; close: () => void; anchor: HTMLElement } | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    openCard?.close();
    openCard = null;
  }, 250);
}

function cancelHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}

/** Show the card for `userId` next to `anchor` (replaces any open card). */
export function showPersonCard(anchor: HTMLElement, userId: string) {
  if (!userId || !spaceFlag('hover_cards_enabled')) return;
  cancelHide();
  if (openCard?.userId === userId && openCard.anchor === anchor) return;
  openCard?.close();
  const close = openOverlay((c) => <PersonCard userId={userId} close={c} onEnter={cancelHide} onLeave={scheduleHide} />, {
    anchor, placement: 'bottom-start', offset: 6, backdrop: 'none', noFocus: true, closeOnEscape: true,
    onClose: () => {
      if (openCard?.anchor === anchor) openCard = null;
    },
  });
  openCard = { userId, close, anchor };
}

/** Wrap a person (name, avatar) so hovering it shows their card. */
export function PersonHover({ userId, children }: { userId: string | null; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!userId) return <>{children}</>;
  return (
    <span
      ref={ref}
      className="nc-person-hover"
      data-person-id={userId}
      onMouseEnter={() => {
        cancelHide();
        timer.current = setTimeout(() => ref.current && showPersonCard(ref.current, userId), 450);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        scheduleHide();
      }}
    >
      {children}
    </span>
  );
}

let installed = false;

/** @mentions rendered by the editor (span.lit-user-mention-token[data-user-id]) and anything with data-person-id. */
export function installPersonHoverDelegation() {
  if (installed) return;
  installed = true;
  let pending: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('.lit-user-mention-token[data-user-id]') as HTMLElement | null;
    if (!el || el.closest('.nc-person-hover')) return;
    if (pending?.el === el) return;
    if (pending) clearTimeout(pending.timer);
    cancelHide();
    const id = el.dataset.userId!;
    pending = { el, timer: setTimeout(() => { pending = null; if (el.isConnected) showPersonCard(el, id); }, 450) };
  });
  document.addEventListener('mouseout', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('.lit-user-mention-token[data-user-id]') as HTMLElement | null;
    if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
    if (pending?.el === el) {
      clearTimeout(pending.timer);
      pending = null;
    }
    if (openCard?.anchor === el) scheduleHide();
  });
}
