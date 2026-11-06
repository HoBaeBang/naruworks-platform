
// request; the teamspace owners approve or decline it in their Inbox (requests.ts requestJoinTeam).
import { useState } from 'react';
import type { TeamRecord } from '@nc/shared/records.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { useUI } from '../../../lib/store/ui.ts';
import { t } from '../i18n.ts';
import { TeamIcon } from '../sidebar/TeamIcon.tsx';
import { requestJoinTeam } from './access.ts';
import './access.css';

export function openTeamRequestDialog(team: TeamRecord): void {
  openOverlay((close) => <RequestTeam team={team} close={close} />, { placement: 'center', backdrop: 'dim' });
}

function RequestTeam({ team, close }: { team: TeamRecord; close: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await requestJoinTeam(team.id, message);
      useUI.getState().toast(t('lp.shell.membership_requested', 'Membership requested'));
      close();
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.shell.couldn_t_request_membership', 'Couldn’t request membership'));
      setBusy(false);
    }
  };
  return (
    <div className="nc-team-request" role="dialog" aria-label={t('lp.shell.request_access', 'Request access')}>
      <div className="nc-team-request-title">
        <span>{t('lp.shell.ask_for_access_to_69e7', 'Ask for access to {icon} {teamName}', { icon: '', teamName: '' }).replace(/\s+$/, '')}</span>
        <TeamIcon team={team} size={20} />
        <span>{team.name}</span>
      </div>
      <div className="nc-team-request-caption">{t('lp.shell.team_owners_will_review_your_request', 'Team owners will review your request and accept or decline it.')}</div>
      <div className="nc-input">
        <textarea autoFocus rows={3} maxLength={1000} value={message} placeholder={t('lp.shell.message_optional', 'Message (optional)')} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="nc-team-request-footer">
        <button className="nc-btn outline" onClick={close}>{t('lp.shell.cancel', 'Cancel')}</button>
        <button className="nc-btn primary" disabled={busy} onClick={() => void send()}>{t('lp.shell.request', 'Request')}</button>
      </div>
    </div>
  );
}
