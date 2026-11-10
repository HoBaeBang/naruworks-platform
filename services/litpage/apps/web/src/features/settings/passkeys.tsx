// Passkeys: WebAuthn ceremonies in the browser + the Settings › Account "Manage Passkeys" dialog.
// The server (apps/server/src/passkeys.ts) issues the options and verifies the responses; credentials are
// discoverable, so the login page's "Passkey" button signs in without an email. WebAuthn needs a domain name:
// on an IP address (127.0.0.1) the server answers with an explanation instead of options.
import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { getLocale, t } from '../shell/i18n.ts';
import { Button, confirmDialog, openSubDialog } from './ui.tsx';

export interface PasskeyInfo { id: string; name: string; createdTime: number; lastUsedTime: number | null }

const toBuf = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const toB64 = (b: ArrayBuffer | null | undefined): string | null => {
  if (!b) return null;
  const bytes = new Uint8Array(b);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

/** The user dismissed the browser prompt (or it timed out): no error message. */
function cancelled(e: unknown): boolean {
  const n = (e as { name?: string })?.name;
  return n === 'NotAllowedError' || n === 'AbortError';
}

/** Create a passkey on this device and register it. Returns the account's passkeys, or null when cancelled. */
export async function addPasskey(name?: string): Promise<PasskeyInfo[] | null> {
  if (!passkeysSupported()) throw new Error(t('lp.settings.that_didn_t_work_choose_a', 'That didn’t work. Choose a different sign-in method, or follow your device’s passkey prompts'));
  const { challengeId, publicKey } = await api<{ challengeId: string; publicKey: any }>('passkeyRegistrationOptions', {});
  let cred: PublicKeyCredential;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        ...publicKey,
        challenge: toBuf(publicKey.challenge),
        user: { ...publicKey.user, id: toBuf(publicKey.user.id) },
        excludeCredentials: (publicKey.excludeCredentials ?? []).map((c: { id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }) => ({ ...c, id: toBuf(c.id) })),
      },
    }) as PublicKeyCredential;
  } catch (e) {
    if (cancelled(e)) return null;
    throw new Error(t('lp.settings.we_couldn_t_save_the_passkey', 'We couldn’t save the passkey. Please try again.'));
  }
  const r = cred.response as AuthenticatorAttestationResponse;
  const res = await api<{ passkeys: PasskeyInfo[] }>('registerPasskey', {
    challengeId,
    name,
    credential: {
      id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
      response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject), transports: r.getTransports?.() ?? [] },
    },
  });
  return res.passkeys;
}

/** Login page › Passkey: sign in with a discoverable credential. Returns false when the prompt was dismissed. */
export async function signInWithPasskey(): Promise<boolean> {
  if (!passkeysSupported()) throw new Error(t('lp.settings.that_didn_t_work_choose_a', 'That didn’t work. Choose a different sign-in method, or follow your device’s passkey prompts'));
  const { challengeId, publicKey } = await api<{ challengeId: string; publicKey: any }>('passkeyLoginOptions', {});
  let cred: PublicKeyCredential;
  try {
    cred = await navigator.credentials.get({ publicKey: { ...publicKey, challenge: toBuf(publicKey.challenge), allowCredentials: [] } }) as PublicKeyCredential;
  } catch (e) {
    if (cancelled(e)) return false;
    throw new Error(t('lp.settings.passkey_sign_in_failed_try_again', 'Passkey sign-in failed. Try again.'));
  }
  const r = cred.response as AuthenticatorAssertionResponse;
  await api('loginWithPasskey', {
    challengeId,
    credential: {
      id: cred.id, rawId: toB64(cred.rawId), type: cred.type,
      response: { clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature), userHandle: toB64(r.userHandle) },
    },
  });
  return true;
}

export function loadPasskeys(): Promise<PasskeyInfo[]> {
  return api<{ passkeys: PasskeyInfo[] }>('getPasskeys', {}).then((r) => r.passkeys);
}

function toastError(e: unknown, fallback: string) {
  useUI.getState().toast((e as Error)?.message || fallback);
}

/** "Add passkey" (callout / row) — registers one, then tells the caller the new list. */
export async function addPasskeyFlow(onChange: (list: PasskeyInfo[]) => void) {
  try {
    const list = await addPasskey();
    if (list) onChange(list);
  } catch (e) {
    toastError(e, t('lp.settings.we_couldn_t_register_your_passkey', 'We couldn’t register your passkey. Please try again.'));
  }
}

export function openManagePasskeys(initial: PasskeyInfo[], onChange: (list: PasskeyInfo[]) => void) {
  openSubDialog((close) => <ManagePasskeys initial={initial} close={close} onChange={onChange} />);
}

function fmt(ms: number): string {
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms));
}

function ManagePasskeys({ initial, close, onChange }: { initial: PasskeyInfo[]; close: () => void; onChange: (list: PasskeyInfo[]) => void }) {
  const [list, setList] = useState(initial);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const update = (l: PasskeyInfo[]) => { setList(l); onChange(l); };
  const remove = async (p: PasskeyInfo) => {
    const ok = await confirmDialog({
      title: t('lp.settings.remove_this_passkey_from_your_account', 'Remove this passkey{newline}from your account?', { newline: ' ' }),
      description: t('lp.settings.after_deletion_you_can_t_use', 'After deletion, you can’t use the passkey saved in {friendlyName}', { friendlyName: p.name }),
      confirmLabel: t('lp.settings.delete', 'Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      update((await api<{ passkeys: PasskeyInfo[] }>('deletePasskey', { id: p.id })).passkeys);
    } catch (e) {
      toastError(e, t('lp.settings.that_didn_t_work_choose_a', 'That didn’t work. Choose a different sign-in method, or follow your device’s passkey prompts'));
    }
  };
  const saveName = async (p: PasskeyInfo) => {
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === p.name) return;
    try {
      update((await api<{ passkeys: PasskeyInfo[] }>('updatePasskeyName', { id: p.id, name })).passkeys);
    } catch (e) {
      toastError(e, t('lp.settings.that_didn_t_work_choose_a', 'That didn’t work. Choose a different sign-in method, or follow your device’s passkey prompts'));
    }
  };
  return (
    <div className="nc-set-passkeys" data-testid="manage-passkeys">
      <h3>{t('lp.settings.manage_passkeys', 'Manage Passkeys')}</h3>
      <div className="desc">{t('lp.settings.sign_in_with_your_device_s', 'Sign in with your device’s security features, such as Face ID, instead of remembering a password.')}</div>
      <div className="nc-set-label">{t('lp.settings.active_passkey', 'Active passkey')}</div>
      <div className="nc-set-passkey-list">
        {list.map((p) => (
          <div key={p.id} className="nc-set-passkey" data-passkey-id={p.id}>
            <Icon name="personKeyFill" size={20} />
            <div className="txt">
              {renaming === p.id ? (
                <div className="nc-set-input">
                  <input autoFocus aria-label={t('lp.settings.rename_passkey', 'Rename passkey')} value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} onBlur={() => void saveName(p)} onKeyDown={(e) => { if (e.key === 'Enter') void saveName(p); if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }} />
                </div>
              ) : <div className="name">{p.name}</div>}
              <div className="meta">{t('lp.settings.added', 'Added {date}', { date: fmt(p.createdTime) })}{p.lastUsedTime ? ` · ${t('lp.settings.last_used', 'Last used {date}', { date: fmt(p.lastUsedTime) })}` : ''}</div>
            </div>
            <span
              role="button"
              tabIndex={0}
              className="nc-set-icon-btn"
              aria-label={t('lp.settings.more', 'More')}
              onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                width: 200,
                sections: [{
                  items: [
                    { label: t('lp.settings.rename_passkey', 'Rename passkey'), icon: 'pencilSmall', onSelect: () => { setDraft(p.name); setRenaming(p.id); } },
                    { label: t('lp.settings.delete', 'Delete'), icon: 'trashSmall', danger: true, onSelect: () => { void remove(p); } },
                  ],
                }],
              }, { placement: 'bottom-end' })}
            >
              <Icon name="ellipsisSmall" size={16} />
            </span>
          </div>
        ))}
        {!list.length && <div className="nc-set-empty">{t('lp.settings.sign_in_with_your_device_s_bf12', 'Sign in with your device’s biometric security')}</div>}
      </div>
      <div className="actions">
        <Button variant="primary" icon="plusSmall" onClick={() => void addPasskeyFlow(update)}>{t('lp.settings.create_a_new_passkey', 'Create a new passkey')}</Button>
        <Button onClick={close}>{t('lp.settings.close', 'Close')}</Button>
      </div>
    </div>
  );
}
