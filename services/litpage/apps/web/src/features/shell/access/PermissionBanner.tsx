
// Shown above the page for people with Can view / Can comment when someone with
// full access can approve; the request lands in their Inbox (requests.ts).
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useRole } from '../../../lib/hooks.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { t } from '../i18n.ts';
import { getPageAccessState, requestPageAccess, useMyRequests } from './access.ts';
import { GuestBanner } from './GuestBanner.tsx';
import './access.css';

export function PermissionBanner({ page }: { page: BlockRecord }) {
  
  return (
    <>
      <GuestBanner spaceId={page.space_id} />
      <LimitedAccessBanner page={page} />
    </>
  );
}

function LimitedAccessBanner({ page }: { page: BlockRecord }) {
  const role = useRole('block', page.id);
  const limited = role === 'reader' || role === 'comment_only';
  const [canAsk, setCanAsk] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'requested' | 'limited'>('idle');
  const requestedHere = useMyRequests((s) => s.edits.has(page.id));

  useEffect(() => {
    if (!limited || page.alive === false) return;
    let alive = true;
    void getPageAccessState(page.id).then((s) => {
      if (!alive || s.state !== 'ok') return;
      setCanAsk(s.canRequestEdit);
      if (s.editRequested) setState('requested');
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [page.id, limited, page.alive]);

  if (!limited || page.alive === false) return null;
  const requested = state === 'requested' || requestedHere;
  const ask = async () => {
    if (state !== 'idle' || requested) return;
    setState('sending');
    try {
      await requestPageAccess(page.id, { edit: true });
      setState('requested');
    } catch (e: any) {
      if (e?.status === 429) setState('limited');
      else {
        setState('idle');
        useUI.getState().toast(e?.message || 'We hit a problem');
      }
    }
  };
  return (
    <div className="nc-permission-banner" role="status" data-role={role}>
      <Icon name={role === 'reader' ? 'eye' : 'comment'} size={16} />
      <span className="msg">
        {role === 'reader' ? t('lp.shell.this_page_is_view_only', 'This page is view-only') : t('lp.shell.your_access_to_this_page_is', 'Your access to this page is comment-only')}
      </span>
      {canAsk && (
        <div role="button" aria-disabled={requested || state !== 'idle'} className={`nc-permission-banner-btn ${requested || state !== 'idle' ? 'disabled' : ''}`} onClick={() => void ask()}>
          {requested
            ? t('lp.shell.edit_access_requested', 'Edit access requested')
            : state === 'limited'
              ? t('lp.shell.try_again_soon', 'Try again soon')
              : t('lp.shell.ask_for_edit_access', 'Ask for edit access')}
        </div>
      )}
    </div>
  );
}
