// "Join or create workspace" / "Add workspace" dialog (workspace switcher → Add workspace, account options).
import { useEffect, useState } from 'react';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { navigate } from '../../../lib/router.ts';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { t } from '../i18n.ts';

export function openCreateWorkspaceDialog() {
  openOverlay((close) => <CreateWorkspace close={close} />, { placement: 'center', backdrop: 'dim' });
}

function CreateWorkspace({ close }: { close: () => void }) {
  const user = records.get('lit_user', useSession.getState().userId) as { name?: string } | undefined;
  const [name, setName] = useState(user?.name ? `${user.name}'s Workspace` : '');
  const [icon, setIcon] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api('createWorkspace', { name: name.trim(), icon: icon || undefined });
      await useSession.getState().load();
      useSession.getState().setSpace(res.spaceId);
      const s = records.get<SpaceRecord>('space', res.spaceId);
      close();
      navigate(`/${s?.domain ?? ''}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nc-ws-dialog" role="dialog" aria-label={t('lp.shell.start_or_join_a_workspace', 'Start or join a workspace')}>
      <div className="nc-ws-dialog-head">
        <div className="nc-ws-dialog-title">{t('lp.shell.create_workspace', 'Create workspace')}</div>
        <div role="button" className="nc-btn icon-only" aria-label={t('lp.shell.close', 'Close')} onClick={close}>
          <Icon name="close" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
      </div>
      <div className="nc-ws-dialog-body">
        <div
          role="button"
          className="nc-ws-dialog-icon"
          aria-label={t('lp.shell.choose_icon', 'Choose icon')}
          onClick={(e) => openIconPicker(e.currentTarget, { current: icon, onPick: (v) => setIcon(v ?? '') })}
        >
          {icon ? <span style={{ fontSize: 36 }}>{icon}</span> : <span className="nc-ws-dialog-letter">{(name.trim()[0] ?? 'W').toUpperCase()}</span>}
        </div>
        <label className="nc-ws-dialog-label" htmlFor="nc-ws-name">{t('lp.shell.workspace_name', 'Workspace name')}</label>
        <div className="nc-input" style={{ height: 32 }}>
          <input
            id="nc-ws-name"
            autoFocus
            value={name}
            placeholder={t('lp.shell.acme_inc', 'Acme Inc.')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void create(); }}
          />
        </div>
        <div className="nc-ws-dialog-hint">{t('lp.shell.you_can_use_your_organization_or', 'You can use your organization or company name. Keep it simple.')}</div>
        <button className="nc-btn primary nc-ws-dialog-submit" disabled={!name.trim() || busy} onClick={() => void create()}>
          {t('lp.shell.create_workspace', 'Create workspace')}
        </button>
      </div>
    </div>
  );
}


interface JoinableSpace {
  id: string;
  name: string;
  icon: string;
  domain: string;
  memberCount: number;
  /** Settings › General › Allowed email domains: join right away, or ask the workspace's admins */
  joinMode?: 'auto' | 'request';
  requested?: boolean;
}

export function openJoinOrCreateWorkspaceDialog() {
  openOverlay((close) => <JoinOrCreate close={close} />, { placement: 'center', backdrop: 'dim' });
}

function JoinOrCreate({ close }: { close: () => void }) {
  const [spaces, setSpaces] = useState<JoinableSpace[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void api<{ spaces: JoinableSpace[] }>('getJoinableWorkspaces').then((r) => setSpaces(r.spaces)).catch(() => setSpaces([]));
  }, []);
  const join = async (s: JoinableSpace) => {
    setBusy(s.id);
    try {
      const res = await api<{ requested?: boolean }>('joinWorkspace', { spaceId: s.id });
      if (res?.requested) {
        // "Request to join": admins approve it in Settings › Requests; the row now reads "Access requested"
        setSpaces((list) => (list ?? []).map((x) => (x.id === s.id ? { ...x, requested: true } : x)));
        return;
      }
      await useSession.getState().load();
      useSession.getState().setSpace(s.id);
      close();
      navigate(`/${s.domain}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="nc-ws-dialog" role="dialog" aria-label={t('lp.shell.start_or_join_a_workspace', 'Start or join a workspace')}>
      <div className="nc-ws-dialog-head">
        <div className="nc-ws-dialog-title">{t('lp.shell.start_or_join_a_workspace', 'Start or join a workspace')}</div>
        <div role="button" className="nc-btn icon-only" aria-label={t('lp.shell.close', 'Close')} onClick={close}>
          <Icon name="close" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
      </div>
      <div className="nc-ws-dialog-body">
        <div className="nc-ws-dialog-label">{t('lp.shell.workspaces_you_can_join', 'Workspaces you can join')}</div>
        {spaces === null && <div className="nc-ws-dialog-hint">…</div>}
        {spaces?.length === 0 && <div className="nc-ws-dialog-hint">{t('lp.shell.no_workspaces_are_open_to_your', 'No workspaces are open to your email domain yet.')}</div>}
        {spaces?.map((s) => (
          <div key={s.id} className="nc-ws-join-row" data-space-id={s.id}>
            <span className="nc-ws-join-icon">{s.icon || s.name.slice(0, 1).toUpperCase()}</span>
            <div className="nc-ws-join-text">
              <div className="nc-ellipsis">{s.name}</div>
              <div className="nc-ws-join-sub">{s.memberCount === 1 ? t('lp.shell.1_member', '1 member') : t('lp.shell.members_93ee', '{count} members', { count: s.memberCount })}</div>
            </div>
            {s.requested
              ? <button className="nc-btn outline" disabled>{t('lp.shell.access_requested', 'Access requested')}</button>
              : s.joinMode === 'request'
                ? <button className="nc-btn primary" disabled={busy === s.id} onClick={() => void join(s)}>{t('lp.shell.request', 'Request')}</button>
                : <button className="nc-btn primary" disabled={busy === s.id} onClick={() => void join(s)}>{t('lp.shell.join', 'Join')}</button>}
          </div>
        ))}
        <button className="nc-btn outline nc-ws-join-create" onClick={() => { close(); openCreateWorkspaceDialog(); }}>
          <Icon name="plus" size={16} />{t('lp.shell.create_workspace', 'Create workspace')}
        </button>
      </div>
    </div>
  );
}
