
// workspace header (name · "Plus Plan · N members"), Settings / Invite members / Add account, the account email
// row with "Account options" (•••), the workspace list (drag handle on hover, ✓ current), Add workspace, Log out.
import { useLayoutEffect, useRef, useState } from 'react';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { t } from '../i18n.ts';
import { WorkspaceIcon } from '../Sidebar.tsx';
import { markOpen, memberCount, openAccountOptionsMenu, planLabel, switchWorkspace, userSpaces } from './menus.tsx';
import { openCreateWorkspaceDialog } from './WorkspaceDialogs.tsx';
import { openAddAccount, logoutAllAccounts, removeAccount, switchAccount, useOtherAccounts, type AccountInfo } from '../accounts.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { tRich } from '../tRich.tsx';

export function openWorkspaceMenu(anchor: Anchor) {
  openOverlay((close) => <WorkspaceMenu close={close} />, { anchor, placement: 'top-start', offset: 4, onClose: markOpen(anchor) });
}


function WorkspaceMenu({ close }: { close: () => void }) {
  const { userId, spaceId } = useSession.getState();
  const user = records.get('lit_user', userId) as { email?: string } | undefined;
  const space = records.get<SpaceRecord>('space', spaceId);
  const list = userSpaces();
  const [active, setActive] = useState<string | null>(null);
  const [overflow, setOverflow] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [list.length]);
  const n = memberCount(space);
  const others = useOtherAccounts();
  const row = (key: string, label: string, icon: string, onSelect: () => void) => (
    <div
      key={key}
      role="button"
      className={`nc-menu-item nc-ws-menu-row ${active === key ? 'active' : ''}`}
      onMouseMove={() => setActive(key)}
      onMouseLeave={() => setActive((a) => (a === key ? null : a))}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <div className="nc-ws-menu-row-inner">
        <div className="nc-menu-icon" style={{ color: 'var(--lp-icon-primary)' }}><Icon name={icon} size={20} /></div>
        <div className="nc-menu-label nc-ellipsis">{label}</div>
      </div>
    </div>
  );
  return (
    <PopoverSurface width={300} maxHeight="calc(100vh - 80px)" className="nc-ws-menu" style={{ transform: 'translateX(-4px)' }}>
      <div className="nc-ws-menu-body">
        <div className="nc-ws-menu-header">
          <div className="nc-ws-menu-icon"><WorkspaceIcon space={space} size={36} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div className="nc-ws-menu-name nc-ellipsis notranslate">{space?.name}</div>
            <div className="nc-ws-menu-plan nc-ellipsis">
              {planLabel(space)} · {n === 1 ? t('lp.shell.1_member', '1 member') : t('lp.shell.members_93ee', '{count} members', { count: n })}
            </div>
          </div>
        </div>
        <div className="nc-ws-menu-sepwrap first"><div role="separator" className="nc-ws-menu-sep" /></div>
        {row('settings', t('lp.shell.settings', 'Settings'), 'gear', () => useUI.getState().openSettings())}
        {row('invite', t('lp.shell.invite_members', 'Invite members'), 'people', () => useUI.getState().openSettings('members'))}
        {row('add-account', t('lp.shell.add_account', 'Add account'), 'personCropCircleBadgePlus', () => openAddAccountModal())}
        <div className="nc-ws-menu-sepwrap"><div role="separator" className="nc-ws-menu-sep" /></div>
        <div ref={listRef} className={`nc-ws-menu-list lit-scroller vertical ${overflow ? 'overflow' : ''}`}>
          <div className="nc-ws-menu-account">
            <span className="nc-ellipsis">{user?.email}</span>
            <div
              role="button"
              aria-label={t('lp.shell.account_options', 'Account options')}
              className="nc-sb-mini-btn"
              style={{ width: 24, height: 24 }}
              onClick={(e) => openAccountOptionsMenu(e.currentTarget as HTMLElement)}
            >
              <Icon name="ellipsisSmall" size={16} />
            </div>
          </div>
          <div role="menu" className="nc-ws-menu-spaces">
            {list.map(({ space: s }) => (
              <div
                key={s.id}
                role="menuitem"
                className={`nc-menu-item nc-ws-row ${active === s.id ? 'active' : ''}`}
                onMouseMove={() => setActive(s.id)}
                onMouseLeave={() => setActive((a) => (a === s.id ? null : a))}
                onClick={() => {
                  close();
                  if (s.id !== spaceId) switchWorkspace(s.id);
                }}
              >
                <div className="nc-ws-row-iconwrap">
                  <span className="nc-ws-row-handle"><Icon name="dragHandleFillSmall" size={14} /></span>
                  <div className="nc-ws-row-icon"><WorkspaceIcon space={s} size={20} /></div>
                </div>
                <div className="nc-ws-row-label">
                  <div className="nc-ellipsis notranslate">{s.name}</div>
                  {s.id === spaceId && <span style={{ marginInlineStart: 'auto', display: 'flex' }}><Icon name="checkmark" size={20} style={{ color: 'var(--lp-icon-primary)' }} /></span>}
                </div>
              </div>
            ))}
            <div
              role="menuitem"
              className={`nc-menu-item nc-ws-row add ${active === 'add-ws' ? 'active' : ''}`}
              onMouseMove={() => setActive('add-ws')}
              onMouseLeave={() => setActive((a) => (a === 'add-ws' ? null : a))}
              onClick={() => {
                close();
                openCreateWorkspaceDialog();
              }}
            >
              <div className="nc-ws-row-iconwrap"><Icon name="plusFill" size={16} /></div>
              <div className="nc-ws-row-label"><div className="nc-ellipsis">{t('lp.shell.add_workspace', 'Add workspace')}</div></div>
            </div>
          </div>
          {others.map((acc) => <OtherAccount key={acc.userId} acc={acc} close={close} active={active} setActive={setActive} />)}
        </div>
        <div className="nc-ws-menu-sepwrap"><div role="separator" className="nc-ws-menu-sep" /></div>
        <div
          role="button"
          className={`nc-menu-item nc-ws-menu-row ${active === 'logout' ? 'active' : ''}`}
          onMouseMove={() => setActive('logout')}
          onMouseLeave={() => setActive((a) => (a === 'logout' ? null : a))}
          onClick={() => {
            close();
            if (others.length) void confirmLogoutAll();
            else void useSession.getState().logout();
          }}
        >
          <div className="nc-ws-menu-row-inner nc-ws-logout">
            {others.length
              ? t('lp.shell.isloggedintomultipleaccounts_select_true', '{isLoggedIntoMultipleAccounts, select, true {Sign out everywhere} other {Sign out}}', { isLoggedIntoMultipleAccounts: 'true' })
              : t('lp.shell.log_out', 'Log out')}
          </div>
        </div>
      </div>
    </PopoverSurface>
  );
}

/** Another account signed in on this browser: its email (••• → Log out) and its workspaces (switch on click). */
function OtherAccount({ acc, close, active, setActive }: { acc: AccountInfo; close: () => void; active: string | null; setActive: (f: (a: string | null) => string | null) => void }) {
  return (
    <div className="nc-ws-other-account" data-account={acc.email}>
      <div className="nc-ws-menu-account other">
        <span className="nc-ellipsis">{acc.email}</span>
        <div
          role="button"
          aria-label={t('lp.shell.account_options', 'Account options')}
          className="nc-sb-mini-btn"
          style={{ width: 24, height: 24 }}
          onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
            width: 220,
            sections: [{ items: [{ label: t('lp.shell.log_out', 'Log out'), icon: 'arrowRightFromRectangle', onSelect: () => void removeAccount(acc.userId) }] }],
          }, { placement: 'right-start', backdrop: 'transparent' })}
        >
          <Icon name="ellipsisSmall" size={16} />
        </div>
      </div>
      <div role="menu" className="nc-ws-menu-spaces">
        {acc.spaces.map((s) => {
          const key = `${acc.userId}:${s.id}`;
          return (
            <div
              key={key}
              role="menuitem"
              className={`nc-menu-item nc-ws-row ${active === key ? 'active' : ''}`}
              onMouseMove={() => setActive(() => key)}
              onMouseLeave={() => setActive((a) => (a === key ? null : a))}
              onClick={() => {
                close();
                void switchAccount(acc.userId, s.id);
              }}
            >
              <div className="nc-ws-row-iconwrap"><div className="nc-ws-row-icon"><WorkspaceIcon space={{ id: s.id, name: s.name, icon: s.icon } as SpaceRecord} size={20} /></div></div>
              <div className="nc-ws-row-label"><div className="nc-ellipsis notranslate">{s.name}</div></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function openAddAccountModal() {
  openOverlay((close) => (
    <div className="nc-ws-dialog nc-ws-add-account" role="dialog" aria-label={t('lp.shell.add_account', 'Add account')}>
      <div className="nc-ws-add-account-title">{t('lp.shell.add_account', 'Add account')}</div>
      <div className="nc-ws-add-account-desc">{t('lp.shell.you_ll_stay_logged_in_to', 'You’ll stay logged in to your current account. Add another account you already have, or register with a new email.')}</div>
      <div className="nc-ws-add-account-footer">
        <button className="nc-btn primary" onClick={() => { close(); void openAddAccount(); }}>{t('lp.shell.add_a_different_account', 'Add a different account')}</button>
        <button className="nc-btn outline" onClick={close}>{t('lp.shell.cancel', 'Cancel')}</button>
      </div>
    </div>
  ), { placement: 'center', backdrop: 'dim' });
}

function confirmLogoutAll(): Promise<void> {
  return new Promise((resolve) => {
    openOverlay((close) => (
      <div className="nc-ws-dialog nc-ws-add-account" role="alertdialog">
        <div className="nc-ws-add-account-title">{tRich('lp.shell.isloggedintomultipleaccounts_select_true_d1cc', '{isLoggedIntoMultipleAccounts, select, true {<bold>Sign out everywhere?</bold>} other {<bold>Log out of this account?</bold>}}', { isLoggedIntoMultipleAccounts: 'true' })}</div>
        <div className="nc-ws-add-account-desc">{t('lp.shell.sign_in_again_to_access_your', 'Sign in again to access your Litpage workspaces.')}</div>
        <div className="nc-ws-add-account-footer">
          <button className="nc-btn primary danger" onClick={() => { close(); void logoutAllAccounts(); resolve(); }}>
            {t('lp.shell.isloggedintomultipleaccounts_select_true', '{isLoggedIntoMultipleAccounts, select, true {Sign out everywhere} other {Sign out}}', { isLoggedIntoMultipleAccounts: 'true' })}
          </button>
          <button className="nc-btn outline" onClick={() => { close(); resolve(); }}>{t('lp.shell.cancel', 'Cancel')}</button>
        </div>
      </div>
    ), { placement: 'center', backdrop: 'dim' });
  });
}
