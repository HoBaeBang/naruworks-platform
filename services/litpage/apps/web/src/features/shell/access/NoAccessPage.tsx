
// The server decides (requests.ts getPageAccessState):
// missing → "This page couldn’t be found"; no access → "No access to this page [in <workspace>]" with an optional
// message and "Request access" (or "You don’t have permission…" when the workspace turned requests off).
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon.tsx';
import { useCurrentUser } from '../../../lib/hooks.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { t } from '../i18n.ts';
import { tRich } from '../tRich.tsx';
import { openStartPage } from '../Workspace.tsx';
import { openAddAccount } from '../accounts.tsx';
import { records } from '../../../lib/store/records.ts';
import { loadPage } from '../../page/usePageLoader.ts';
import type { NotificationRecord } from '@nc/shared/records.ts';
import { getPageAccessState, requestPageAccess, type PageAccessState } from './access.ts';
import './access.css';

export function NoAccessPage({ pageId, onAccess }: { pageId: string; onAccess?: () => void }) {
  const [st, setSt] = useState<PageAccessState | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const user = useCurrentUser();
  const spaceId = useSession((s) => s.spaceId);

  useEffect(() => {
    let alive = true;
    setSt(null);
    setSent(false);
    getPageAccessState(pageId).then((s) => alive && setSt(s)).catch(() => alive && setSt({ state: 'missing' }));
    return () => {
      alive = false;
    };
  }, [pageId]);

  useEffect(() => {
    // access granted meanwhile (another tab, or the request was approved while this screen is open)
    if (st?.state === 'ok') {
      onAccess?.();
      void loadPage(pageId, true);
    }
  }, [st, onAccess, pageId]);

  useEffect(() => {
    // "X approved your request": the approval arrives as an Inbox item over the websocket → load the page
    return records.subscribeAll((keys) => {
      for (const k of keys) {
        if (!k.startsWith('notification:')) continue;
        const n = records.get<NotificationRecord>('notification', k.slice('notification:'.length));
        if (n?.type === 'access_granted' && (n.activity as { page_id?: string } | undefined)?.page_id === pageId) {
          void loadPage(pageId, true);
          return;
        }
      }
    });
  }, [pageId]);

  if (!st) return <div className="nc-page-loading" />;
  if (st.state === 'missing' || st.state === 'ok') {
    return (
      <div className="nc-noaccess" data-state="missing">
        <div className="nc-noaccess-title">{t('lp.shell.we_couldn_t_find_this_page', 'We couldn’t find this page')}</div>
        <div className="nc-noaccess-message">{t('lp.shell.this_might_be_deleted_moved_or', 'This might be deleted, moved, or not shared with you. Double-check the link, then retry.')}</div>
        <div className="nc-noaccess-actions">
          <button className="nc-btn outline" onClick={() => spaceId && openStartPage(spaceId)}>{t('lp.shell.return_to_my_workspace', 'Return to my workspace')}</button>
        </div>
      </div>
    );
  }

  const requested = sent || st.requested;
  const title = requested
    ? t('lp.shell.request_sent', 'Request sent!')
    : st.inTrash
      ? t('lp.shell.you_can_t_open_this_trashed', 'You can’t open this trashed page')
      : st.workspaceName
        ? tRich('lp.shell.you_can_t_access_this_page', 'You can’t access this page in <bold>{workspaceName}</bold>', { workspaceName: st.workspaceName })
        : t('lp.shell.you_can_t_access_this_page_48da', 'You can’t access this page');
  const description = requested
    ? t('lp.shell.once_your_request_for_access_is', 'Once your request for access is approved, you’ll get a notification.')
    : st.canRequest
      ? t('lp.shell.an_approval_will_give_you_access', 'An approval will give you access to this page.')
      : t('lp.shell.you_aren_t_allowed_to_view', 'You aren’t allowed to view this page.');

  const send = async () => {
    if (sending || requested) return;
    setSending(true);
    try {
      await requestPageAccess(pageId, { message });
      setSent(true);
    } catch (e: any) {
      useUI.getState().toast(e?.status === 429 ? t('lp.shell.your_request_for_access_to_this', 'Your request for access to this page went out recently.') : (e?.message || 'We hit a problem'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="nc-noaccess" data-state={requested ? 'requested' : 'no-access'}>
      <div className="nc-noaccess-art" aria-hidden><Icon name="lock" size={28} /></div>
      <h1 className="nc-noaccess-title">{title}</h1>
      <div className="nc-noaccess-message">{description}</div>
      {st.canRequest && !requested && (
        <div className="nc-input nc-noaccess-note">
          <textarea
            rows={3}
            maxLength={1000}
            value={message}
            placeholder={t('lp.shell.message_optional', 'Message (optional)')}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
      )}
      <div className="nc-noaccess-actions">
        {(st.canRequest || requested) && (
          <button className="nc-btn primary nc-noaccess-request" disabled={requested || sending} onClick={() => void send()}>
            {requested ? t('lp.shell.requested_access', 'Requested access') : t('lp.shell.request_access', 'Request access')}
          </button>
        )}
        <button className="nc-btn outline" onClick={() => spaceId && openStartPage(spaceId)}>{t('lp.shell.return_to_my_workspace', 'Return to my workspace')}</button>
      </div>
      {user && (
        <div className="nc-noaccess-footer">
          <span>{t('lp.shell.signed_in_as', 'Signed in as {currentlyLoggedInUser}', { currentlyLoggedInUser: user.email })}</span>
          <span className="sep">·</span>
          <span role="button" className="link" onClick={() => openAddAccount()}>{t('lp.shell.switch_or_add_an_account', 'Switch or add an account')}</span>
          <span className="sep">·</span>
          <span role="button" className="link" onClick={() => void useSession.getState().logout()}>{t('lp.shell.log_out', 'Log out')}</span>
        </div>
      )}
    </div>
  );
}
