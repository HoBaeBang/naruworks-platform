// Guest banner + "Request membership": on a page
// of a workspace where you're only a page guest, a banner says "You’re a guest in {workspace}. Become a member for full
// access…" with Request membership → "Request membership to {workspace}" (Reason (optional) · Cancel · Send request).
// Workspace owners and membership admins get the request in their Inbox / Settings › Requests (server membership.ts,
// policy: Settings › Security › "Allow guests to request to be a member"); afterwards the banner shows the pending state.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '../../../lib/api.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { t } from '../i18n.ts';
import './access.css';

interface GuestState {
  guest: boolean;
  workspaceName?: string;
  canRequest?: boolean;
  requested?: boolean;
}

/** Per-workspace guest state for this session (one request per workspace, refreshed after a request). */
const useGuestStates = create<{ bySpace: Record<string, GuestState | 'loading'>; set: (spaceId: string, s: GuestState | 'loading') => void }>((set) => ({
  bySpace: {},
  set: (spaceId, s) => set((st) => ({ bySpace: { ...st.bySpace, [spaceId]: s } })),
}));

function loadGuestState(spaceId: string) {
  const cur = useGuestStates.getState().bySpace[spaceId];
  if (cur) return;
  useGuestStates.getState().set(spaceId, 'loading');
  void api<GuestState>('getMembershipRequestState', { spaceId })
    .then((r) => useGuestStates.getState().set(spaceId, r))
    .catch(() => useGuestStates.getState().set(spaceId, { guest: false }));
}

/** Shown above pages of workspaces where the current user is a page guest (not a member). */
export function GuestBanner({ spaceId }: { spaceId: string | undefined }) {
  const mySpace = useSession((s) => s.spaceId);
  const state = useGuestStates((s) => (spaceId ? s.bySpace[spaceId] : undefined));
  // pages of my own current workspace never get the banner (I'm a member there)
  const relevant = !!spaceId && spaceId !== mySpace;
  useEffect(() => {
    if (relevant && spaceId) loadGuestState(spaceId);
  }, [relevant, spaceId]);
  if (!relevant || !state || state === 'loading' || !state.guest) return null;
  const name = state.workspaceName || t('lp.shell.this_workspace', 'this workspace');
  if (state.requested) {
    return (
      <div className="nc-permission-banner nc-guest-banner" role="status" data-state="pending">
        <Icon name="users" size={16} />
        <span className="msg">{t('lp.shell.your_membership_request_is_pending_while', 'Your membership request is pending. While you wait, create pages here or explore your own workspace.')}</span>
        <div role="button" aria-disabled className="nc-permission-banner-btn disabled">{t('lp.shell.pending', 'Pending')}</div>
      </div>
    );
  }
  return (
    <div className="nc-permission-banner nc-guest-banner" role="status" data-state={state.canRequest ? 'can-request' : 'guest'}>
      <Icon name="users" size={16} />
      <span className="msg">
        {state.canRequest
          ? t('lp.shell.in_you_only_have_guest_access', 'In {workspaceName} you only have guest access. Join as a member to unlock everything, or set up a workspace of your own.', { workspaceName: name })
          : t('lp.shell.in_you_only_have_guest_access_f514', 'In {workspaceName} you only have guest access. Create your own workspace to use everything Litpage offers.', { workspaceName: name })}
      </span>
      {state.canRequest && (
        <div role="button" className="nc-permission-banner-btn" onClick={() => spaceId && openMembershipRequestDialog(spaceId, name)}>
          {t('lp.shell.request_membership', 'Request membership')}
        </div>
      )}
    </div>
  );
}

export function openMembershipRequestDialog(spaceId: string, workspaceName: string): void {
  openOverlay((close) => <MembershipRequest spaceId={spaceId} workspaceName={workspaceName} close={close} />, { placement: 'center', backdrop: 'dim' });
}

function MembershipRequest({ spaceId, workspaceName, close }: { spaceId: string; workspaceName: string; close: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api('requestWorkspaceMembership', { spaceId, message });
      const prev = useGuestStates.getState().bySpace[spaceId];
      useGuestStates.getState().set(spaceId, { ...(prev && prev !== 'loading' ? prev : { guest: true, workspaceName }), requested: true });
      useUI.getState().toast(t('lp.shell.membership_request_sent', 'Membership request sent.'));
      close();
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.shell.couldn_t_send_the_membership_request', 'Couldn’t send the membership request.'));
      setBusy(false);
    }
  };
  return (
    <div className="nc-team-request nc-membership-request" role="dialog" aria-label={t('lp.shell.request_membership_in', 'Request membership in {workspaceName}', { workspaceName })}>
      <div className="nc-team-request-title">{t('lp.shell.request_membership_in', 'Request membership in {workspaceName}', { workspaceName })}</div>
      <div className="nc-input">
        <textarea autoFocus rows={3} maxLength={500} value={message} placeholder={t('lp.shell.reason_optional', 'Reason (optional)')} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="nc-team-request-footer">
        <button className="nc-btn outline" onClick={close}>{t('lp.shell.cancel', 'Cancel')}</button>
        <button className="nc-btn primary" disabled={busy} onClick={() => void send()}>{t('lp.shell.send_request', 'Send request')}</button>
      </div>
    </div>
  );
}
