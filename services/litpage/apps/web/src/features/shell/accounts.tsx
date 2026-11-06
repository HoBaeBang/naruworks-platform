
// switcher, "Log out of all accounts". Server: apps/server/src/api/modules/multiAccount.ts (HttpOnly cookie of the

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '../../lib/api.ts';
import { navigate, useLocation } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { disconnectRealtime } from '../../lib/store/sync.ts';
import { Icon } from '../../components/Icon.tsx';
import { t } from './i18n.ts';

export interface AccountInfo {
  userId: string;
  name: string;
  email: string;
  photo: string;
  current: boolean;
  spaces: { id: string; name: string; icon: string; domain: string; plan: string; memberCount: number }[];
}

interface AccountsState {
  accounts: AccountInfo[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useAccounts = create<AccountsState>((set) => ({
  accounts: [],
  loaded: false,
  async load() {
    try {
      const r = await api<{ accounts: AccountInfo[] }>('getAccounts');
      set({ accounts: r.accounts, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

/** Accounts other than the current one (switcher "Other accounts"). */
export function useOtherAccounts(): AccountInfo[] {
  const accounts = useAccounts((s) => s.accounts);
  useEffect(() => {
    void useAccounts.getState().load();
  }, []);
  return accounts.filter((a) => !a.current);
}

const ADD_FLAG = 'nc:addAccount';

/** Remember this session, then show the login screen for another account (the current one stays signed in). */
export async function openAddAccount(): Promise<void> {
  try {
    await api('beginAddAccount');
  } catch {
    /* not signed in: plain login */
  }
  try {
    sessionStorage.setItem(ADD_FLAG, '1');
  } catch {
    /* ignore */
  }
  disconnectRealtime();
  useSession.setState({ status: 'anonymous' });
  navigate('/login?add=1');
}

/** Switch to another signed-in account (optionally straight into one of its workspaces). */
export async function switchAccount(userId: string, spaceId?: string): Promise<void> {
  await api('switchAccount', { userId });
  try {
    if (spaceId) localStorage.setItem('nc:lastSpaceId', spaceId);
  } catch {
    /* ignore */
  }
  location.href = '/';
}

export async function logoutAllAccounts(): Promise<void> {
  try {
    await api('logoutAllAccounts');
  } finally {
    disconnectRealtime();
    location.href = '/login';
  }
}

export async function removeAccount(userId: string): Promise<void> {
  await api('removeAccount', { userId });
  await useAccounts.getState().load();
}

/** Login screen in "add account" mode: a way back to the account that is still signed in. */
export function AddAccountBar() {
  const { route } = useLocation();
  const [adding, setAdding] = useState(() => {
    try {
      return new URLSearchParams(location.search).get('add') === '1' && sessionStorage.getItem(ADD_FLAG) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (route.name !== 'login') setAdding(false);
  }, [route.name]);
  if (!adding) return null;
  return (
    <div className="nc-auth-addaccount">
      <div
        role="button"
        className="nc-auth-addaccount-back"
        onClick={() => {
          try {
            sessionStorage.removeItem(ADD_FLAG);
          } catch {
            /* ignore */
          }
          location.href = '/';
        }}
      >
        <Icon name="arrowLeft" size={16} />
        <span>{t('lp.shell.return_to_workspace', 'Return to workspace')}</span>
      </div>
      <div className="nc-auth-addaccount-title">{t('lp.shell.add_a_different_account', 'Add a different account')}</div>
    </div>
  );
}

/** Called after a session loads so the add-account flag is cleared once a session is ready. */
export function clearAddAccountFlag() {
  try {
    sessionStorage.removeItem(ADD_FLAG);
  } catch {
    /* ignore */
  }
}
