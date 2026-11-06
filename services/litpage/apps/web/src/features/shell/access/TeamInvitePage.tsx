
// Workspace members join the teamspace; people outside the workspace (or its page guests)
// ask the workspace's admins to be added as members when Settings › Security allows it; otherwise the link explains why
// it can't be used. The code survives the login detour (sessionStorage), like workspace invite links (invite.ts).
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.ts';
import { navigate } from '../../../lib/router.ts';
import { useSession } from '../../../lib/store/session.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { t } from '../i18n.ts';
import './access.css';

const KEY = 'nc:pendingTeamInvite';

export function rememberTeamInvite(code: string) {
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
}

/** The team invite code someone opened before logging in (consumed once). */
export function takePendingTeamInvite(): string | null {
  try {
    const c = sessionStorage.getItem(KEY);
    if (c) sessionStorage.removeItem(KEY);
    return c;
  } catch {
    return null;
  }
}

interface InviteInfo {
  state: 'invalid' | 'disabled' | 'member' | 'join' | 'request' | 'no_access';
  requested?: boolean;
  team?: { id: string; name: string; icon: string; type: string; memberCount: number };
  space?: { id: string; name: string; icon: string; domain: string };
}

function TeamGlyph({ icon, name }: { icon?: string; name?: string }) {
  if (icon && !icon.startsWith('/') && !icon.startsWith('http') && !icon.startsWith('lit-icon')) return <span className="nc-team-invite-emoji">{icon}</span>;
  if (icon && (icon.startsWith('/') || icon.startsWith('http'))) return <img className="nc-team-invite-img" src={icon} alt="" />;
  return <span className="nc-team-invite-letter">{(name || '?').slice(0, 1).toUpperCase()}</span>;
}

async function openTeamspace(spaceId: string, domain: string) {
  await useSession.getState().load();
  useSession.getState().setSpace(spaceId);
  navigate(`/${domain}`, { replace: true });
}

export function TeamInvitePage({ code }: { code: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const status = useSession((s) => s.status);

  useEffect(() => {
    let live = true;
    api<InviteInfo>('getTeamInvite', { code })
      .then((r) => {
        if (!live) return;
        setInfo(r);
        setRequested(!!r.requested);
        // already in the teamspace: the link just opens its workspace
        if (r.state === 'member' && r.space) void openTeamspace(r.space.id, r.space.domain);
      })
      .catch(() => { if (live) setInfo({ state: 'invalid' }); });
    return () => { live = false; };
  }, [code]);

  const back = () => navigate('/', { replace: true });
  const join = async () => {
    if (busy || !info?.team) return;
    setBusy(true);
    try {
      const r = await api<{ teamId: string; spaceId: string; domain: string; recordMap: unknown }>('joinTeamByInviteLink', { code });
      records.mergeRecordMap(r.recordMap as never);
      useUI.getState().toast(t('lp.shell.joined', 'Joined {teamName}', { teamName: info.team.name }));
      await openTeamspace(r.spaceId, r.domain);
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.shell.couldn_t_request_membership', 'Couldn’t request membership'));
      setBusy(false);
    }
  };
  const request = async () => {
    if (busy || requested) return;
    setBusy(true);
    try {
      await api('requestMembershipByTeamInvite', { code, message });
      setRequested(true);
      useUI.getState().toast(t('lp.shell.membership_requested', 'Membership requested'));
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.shell.couldn_t_request_membership', 'Couldn’t request membership'));
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <div className="nc-team-invite-page"><div className="nc-boot" /></div>;
  const backButton = (
    <button className="nc-btn outline" onClick={back}>{t('lp.shell.return_to_my_workspace', 'Return to my workspace')}</button>
  );
  const footer = <div className="nc-noaccess-footer">{t('lp.shell.questions_reach_out_to_your_workspace', 'Questions? Reach out to your workspace owner.')}</div>;

  if (info.state === 'invalid' || info.state === 'disabled' || !info.team || !info.space) {
    return (
      <div className="nc-team-invite-page" data-state={info.state}>
        <div className="nc-noaccess">
          <div className="nc-noaccess-art"><Icon name="link" size={28} /></div>
          <div className="nc-noaccess-message">
            {info.state === 'disabled'
              ? t('lp.shell.that_invite_link_is_disabled_ask', 'That invite link is disabled. Ask an administrator to invite you directly.')
              : t('lp.shell.that_invite_link_is_invalid_ask', 'That invite link is invalid. Ask a workspace admin for a new one.')}
          </div>
          <div className="nc-noaccess-actions">{backButton}</div>
        </div>
      </div>
    );
  }
  const { team, space } = info;
  const glyph = <div className="nc-team-invite-icon"><TeamGlyph icon={team.icon} name={team.name} /></div>;
  if (info.state === 'join' || info.state === 'member') {
    return (
      <div className="nc-team-invite-page" data-state={info.state}>
        <div className="nc-noaccess">
          {glyph}
          <h1 className="nc-noaccess-title">{t('lp.shell.you_re_invited_to_join', 'You’re invited to join {teamName}', { teamName: team.name })}</h1>
          <div className="nc-noaccess-message">{t('lp.shell.join_the_team_to_unlock_access', 'Join the team to unlock access to its content.')}</div>
          <div className="nc-noaccess-actions">
            {info.state === 'join'
              ? <button className="nc-btn primary" disabled={busy} onClick={() => void join()}>{t('lp.shell.join_team', 'Join team')}</button>
              : <button className="nc-btn primary" onClick={() => void openTeamspace(space.id, space.domain)}>{team.name}</button>}
            {backButton}
          </div>
          {footer}
        </div>
      </div>
    );
  }
  if (info.state === 'request') {
    return (
      <div className="nc-team-invite-page" data-state="request">
        <div className="nc-noaccess">
          {glyph}
          {team.type === 'private' && <div className="nc-team-invite-private"><Icon name="lockFill" size={12} />{t('lp.shell.private_team', 'Private Team')}</div>}
          <h1 className="nc-noaccess-title">{t('lp.shell.ask_for_access_to', 'Ask for access to {teamName}', { teamName: team.name })}</h1>
          <div className="nc-noaccess-message">{t('lp.shell.a_team_owner_must_approve_your', 'A team owner must approve your request before you can access this team.')}</div>
          {!requested && (
            <div className="nc-input nc-noaccess-note">
              <textarea rows={3} maxLength={500} value={message} placeholder={t('lp.shell.message_optional', 'Message (optional)')} onChange={(e) => setMessage(e.target.value)} />
            </div>
          )}
          <div className="nc-noaccess-actions">
            <button className="nc-btn primary" disabled={busy || requested} onClick={() => void request()}>
              {requested ? t('lp.shell.pending', 'Pending') : t('lp.shell.request_access', 'Request access')}
            </button>
            {backButton}
          </div>
          {footer}
        </div>
      </div>
    );
  }
  // no_access: the workspace doesn't take membership requests from this person
  return (
    <div className="nc-team-invite-page" data-state="no_access">
      <div className="nc-noaccess">
        {glyph}
        <h1 className="nc-noaccess-title">{t('lp.shell.ask_for_access_to', 'Ask for access to {teamName}', { teamName: team.name })}</h1>
        <div className="nc-noaccess-message">{t('lp.shell.that_invite_link_is_disabled_ask', 'That invite link is disabled. Ask an administrator to invite you directly.')}</div>
        <div className="nc-noaccess-actions">{backButton}</div>
        {status === 'ready' && footer}
      </div>
    </div>
  );
}
