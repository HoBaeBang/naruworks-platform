// Settings › Account: Profile (photo + preferred name), passkey callout, Account security
// (email, passkeys, 2FA, password), Support (support access, delete account), Devices (sessions), User ID.
import { useEffect, useRef, useState } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { api, uploadFile } from '../../../lib/api.ts';
import { useCurrentUser } from '../../../lib/hooks.ts';
import { run } from '../../../lib/blocks.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { t, getLocale } from '../../shell/i18n.ts';
import { Button, Group, IdRow, Row, SectionPage, Switch, Badge, confirmDialog, openSubDialog } from '../ui.tsx';
import { prefValue, savePrefs, usePrefs } from '../userSettings.ts';
import {
  loadAccountSecurity, openManageEmails, openManageTwoStep, openRemovePassword, openTwoStepSetup, startDeleteAccount, type AccountSecurity,
} from './accountSecurity.tsx';
import { addPasskeyFlow, loadPasskeys, openManagePasskeys, type PasskeyInfo } from '../passkeys.tsx';

function saveUser(patch: Partial<UserRecord>) {
  const id = useSession.getState().userId;
  if (!id) return;
  run('updateUser', (tx) => tx.update('lit_user', id, [], patch), { skipHistory: true });
}

export function AccountSection() {
  const user = useCurrentUser();
  const prefs = usePrefs();
  const [name, setName] = useState(user?.name ?? '');
  const [sec, setSec] = useState<AccountSecurity | null>(null);
  const hasPw = sec ? sec.hasPassword : null;
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  const reloadSecurity = () => void loadAccountSecurity().then(setSec).catch(() => setSec(null));
  useEffect(reloadSecurity, []);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null);
  useEffect(() => { void loadPasskeys().then(setPasskeys).catch(() => setPasskeys([])); }, []);
  const mfaOn = !!sec?.mfa.enabled;

  const commitName = () => {
    const v = name.trim();
    if (v && v !== user?.name) saveUser({ name: v, given_name: v });
  };
  const pickPhoto = () => fileRef.current?.click();
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      useUI.getState().toast(t('lp.settings.please_choose_an_image_file', 'Please choose an image file'));
      return;
    }
    try {
      const res = await uploadFile(f, f.name, useSession.getState().spaceId ?? undefined);
      saveUser({ profile_photo: res.url });
    } catch (e) {
      useUI.getState().toast((e as Error).message);
    }
  };

  return (
    <SectionPage
      title={t('lp.settings.account', 'Account')}
      subtitle={t('lp.settings.manage_your_profile_sign_in_details', 'Manage your profile, sign-in details, and devices')}
    >
      <Group title={t('lp.settings.profile', 'Profile')}>
        <div className="nc-set-profile-block">
          <div className="nc-set-profile">
            <button className="nc-set-avatar-btn" aria-label={t('lp.settings.upload_photo', 'Upload photo')} onClick={pickPhoto}>
              <div className="nc-set-avatar">
                {user?.profile_photo ? <img src={user.profile_photo} alt="" /> : (user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
              </div>
            </button>
            <div className="nc-set-profile-fields" data-setting="preferred-name">
              <label className="nc-set-label" htmlFor="nc-set-pref-name">{t('lp.settings.preferred_name', 'Preferred name')}</label>
              <div className="nc-set-input">
                <input
                  id="nc-set-pref-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
                />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="nc-set-photo-links">
            {user?.profile_photo ? (
              <>
                <a className="nc-set-link" href="#" onClick={(e) => { e.preventDefault(); pickPhoto(); }}>{t('lp.settings.replace_photo', 'Replace photo')}</a>
                {' · '}
                <a className="nc-set-link" href="#" onClick={(e) => { e.preventDefault(); saveUser({ profile_photo: undefined }); }}>{t('lp.settings.remove_photo', 'Remove photo')}</a>
              </>
            ) : (
              <>
                <a className="nc-set-link" href="#" onClick={(e) => { e.preventDefault(); pickPhoto(); }}>{t('lp.settings.choose_a_photo', 'Choose a photo')}</a>
              </>
            )}
          </div>
        </div>
        {passkeys !== null && !passkeys.length && (
          <div className="nc-set-col-start">
            <div className="nc-set-callout">
              <Icon name="shieldLock" size={22} />
              {t('lp.settings.sign_in_quickly_with_one_touch', 'Sign in quickly with one touch and boost security by adding a passkey')}
            </div>
            <Button variant="primary" onClick={() => void addPasskeyFlow(setPasskeys)}>{t('lp.settings.add_passkey', 'Add passkey')}</Button>
          </div>
        )}
      </Group>

      <Group title={t('lp.settings.account_security', 'Account security')}>
        <Row
          id="emails"
          label={t('lp.settings.email', 'Email')}
          description={sec && sec.emails.length > 1 ? `${user?.email} · ${t('lp.settings.more_7a79', '+{count} more', { count: sec.emails.length - 1 })}` : user?.email}
          control={<Button onClick={() => openManageEmails(reloadSecurity)}>{t('lp.settings.manage_emails', 'Manage emails')}</Button>}
        />
        <Row
          id="passkeys"
          label={t('lp.settings.passkeys', 'Passkeys')}
          badge={<Badge>{t('lp.settings.recommended', 'Recommended')}</Badge>}
          description={t('lp.settings.sign_in_with_your_device_s_bf12', 'Sign in with your device’s biometric security')}
          control={passkeys?.length
            ? <Button onClick={() => openManagePasskeys(passkeys, setPasskeys)}>{t('lp.settings.manage_passkeys_726f', 'Manage passkeys')}</Button>
            : <Button onClick={() => void addPasskeyFlow(setPasskeys)}>{t('lp.settings.add_passkey', 'Add passkey')}</Button>}
        />
        <Row
          id="two-step"
          label={t('lp.settings.two_step_verification', 'Two-step verification')}
          description={mfaOn
            ? t('lp.settings.two_step_verification_is_on', 'Two-step verification is on')
            : t('lp.settings.protect_your_account_with_an_extra', 'Protect your account with an extra security step')}
          control={mfaOn ? (
            <Button onClick={() => sec && openManageTwoStep(sec, reloadSecurity)}>{t('lp.settings.manage_verification_options', 'Manage verification options')}</Button>
          ) : (
            <span data-tooltip={hasPw === false ? t('lp.settings.enter_a_password_before_turning_on', 'Enter a password before turning on two-factor authentication.') : undefined}>
              <Button disabled={!sec || !hasPw} onClick={() => sec && openTwoStepSetup(sec, reloadSecurity)}>{t('lp.settings.add_a_verification_option', 'Add a verification option')}</Button>
            </span>
          )}
        />
        <Row
          id="password"
          label={t('lp.settings.password_8be3', 'Password')}
          description={hasPw === false ? t('lp.settings.give_your_account_a_password', 'Give your account a password') : t('lp.settings.change_your_sign_in_password', 'Change your sign-in password')}
          control={
            <span className="nc-set-btn-row">
              {hasPw && <Button onClick={() => openRemovePassword(mfaOn, reloadSecurity)}>{t('lp.settings.remove_password', 'Remove password')}</Button>}
              <Button onClick={() => openPasswordDialog(!!hasPw, reloadSecurity)}>
                {hasPw === false ? t('lp.settings.add_password', 'Add password') : t('lp.settings.change_password', 'Change password')}
              </Button>
            </span>
          }
        />
      </Group>

      <Group title={t('lp.settings.support', 'Support')}>
        <Row
          id="support-access"
          label={t('lp.settings.support_access', 'Support access')}
          description={t('lp.settings.give_litpage_support_temporary_account_a', 'Give Litpage support temporary account access to troubleshoot issues or recover content for you. You can revoke access at any time.')}
          control={<Switch label="Support access" checked={prefValue(prefs, 'support_access')} onChange={(v) => savePrefs({ support_access: v, support_access_granted_time: v ? Date.now() : null })} />}
        />
        <Row
          id="delete-account"
          label={t('lp.settings.delete_account', 'Delete account')}
          description={t('lp.settings.delete_your_account_permanently_you_ll', 'Delete your account permanently. You’ll lose access to your pages and every workspace you belong to.')}
          control={<Button variant="danger" onClick={() => void startDeleteAccount(user)}>{t('lp.settings.delete_account', 'Delete account')}</Button>}
        />
      </Group>

      <Group title={t('lp.settings.devices', 'Devices')} help={t('lp.settings.this_can_take_several_hours', 'This can take several hours.')}>
        <DevicesBlock />
      </Group>

      <Group title={t('lp.settings.user_id', 'User ID')}>
        <IdRow label={t('lp.settings.user_id', 'User ID')} id={user?.id ?? ''} />
      </Group>
    </SectionPage>
  );
}

function openPasswordDialog(hasPassword: boolean, onSaved: () => void) {
  openSubDialog((close) => <PasswordDialog hasPassword={hasPassword} close={close} onSaved={onSaved} />);
}

function PasswordDialog({ hasPassword, close, onSaved }: { hasPassword: boolean; close: () => void; onSaved: () => void }) {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(null);
    if (hasPassword && !cur) return setErr(t('lp.settings.old_password_is_required', 'Old password is required.'));
    if (!pw) return setErr(t('lp.settings.a_password_is_required', 'A password is required.'));
    if (pw.length < 8) return setErr(t('lp.settings.choose_a_longer_password', 'Choose a longer password.'));
    if (new Set(pw).size < 4) return setErr(t('lp.settings.please_use_at_least_4_different', 'Please use at least 4 different characters.'));
    if (pw.length < 15 && !(/\p{L}/u.test(pw) && /\d/.test(pw))) return setErr(t('lp.settings.passwords_under_15_characters_must_inclu', 'Passwords under 15 characters must include both letters and numbers.'));
    if (pw !== pw2) return setErr(t('lp.settings.your_passwords_don_t_match', 'Your passwords don’t match.'));
    setBusy(true);
    try {
      await api('changePassword', { password: pw, currentPassword: cur || undefined });
      onSaved();
      close();
      useUI.getState().toast(hasPassword ? t('lp.settings.your_password_was_saved', 'Your password was saved') : t('lp.settings.your_password_was_created', 'Your password was created'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3>{hasPassword ? t('lp.settings.change_password', 'Change password') : t('lp.settings.create_a_password', 'Create a password')}</h3>
      {hasPassword && (
        <div>
          <label className="nc-set-label">{t('lp.settings.type_the_password_you_use_now', 'Type the password you use now')}</label>
          <div className="nc-set-input"><input type="password" autoFocus value={cur} placeholder={t('lp.settings.current_password', 'Current password')} onChange={(e) => setCur(e.target.value)} /></div>
        </div>
      )}
      <div>
        <label className="nc-set-label">{t('lp.settings.create_your_new_password', 'Create your new password')}</label>
        <div className="nc-set-input"><input type="password" autoFocus={!hasPassword} value={pw} placeholder={t('lp.settings.new_password', 'New password')} onChange={(e) => setPw(e.target.value)} /></div>
      </div>
      <div>
        <label className="nc-set-label">{t('lp.settings.type_the_new_password_again', 'Type the new password again')}</label>
        <div className="nc-set-input"><input type="password" value={pw2} placeholder={t('lp.settings.confirm_password', 'Confirm password')} onChange={(e) => setPw2(e.target.value)} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <button type="submit" className="nc-set-btn primary" disabled={busy}>
          {hasPassword ? t('lp.settings.change_password', 'Change password') : t('lp.settings.create_a_password', 'Create a password')}
        </button>
      </div>
    </form>
  );
}

interface SessionRow {
  id: string;
  createdTime: number;
  current: boolean;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  return t('lp.settings.web', 'Web');
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function DevicesBlock() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const load = () => void api('getMySessions').then((r) => setRows(r.sessions ?? [])).catch(() => {});
  useEffect(load, []);
  const visible = showAll ? rows : rows.slice(0, 3);
  const more = rows.length - visible.length;
  const logoutAll = async () => {
    const ok = await confirmDialog({
      title: t('lp.settings.sign_out_of_every_device', 'Sign out of every device?'),
      description: t('lp.settings.you_will_be_logged_out_of', 'You will be logged out of all other active sessions on other devices except this one.'),
      confirmLabel: t('lp.settings.log_out', 'Log out'),
      danger: true,
    });
    if (!ok) return;
    const r = await api('logoutOtherSessions');
    useUI.getState().toast(t('lp.settings.you_re_signed_out_of_your', 'You’re signed out of your other active account sessions.'));
    void r;
    load();
  };
  return (
    <>
      <Row
        id="logout-all"
        label={t('lp.settings.sign_out_everywhere', 'Sign out everywhere')}
        description={t('lp.settings.sign_out_of_active_sessions_on', 'Sign out of active sessions on every other device')}
        control={<Button variant="danger" onClick={() => void logoutAll()}>{t('lp.settings.sign_out_everywhere', 'Sign out everywhere')}</Button>}
      />
      <div>
        <table className="nc-set-table" aria-label={t('lp.settings.devices', 'Devices')}>
          <thead>
            <tr>
              <th style={{ width: '32%' }}>{t('lp.settings.device_name', 'Device Name')}</th>
              <th style={{ width: '26%' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {t('lp.settings.last_active', 'Last Active')}
                  <span data-tooltip={t('lp.settings.this_can_take_several_hours', 'This can take several hours.')} style={{ display: 'inline-flex', color: 'var(--lp-icon-tertiary)' }}><Icon name="questionMarkCircleSmall" size={16} /></span>
                </span>
              </th>
              <th style={{ width: '28%' }}>{t('lp.settings.location', 'Location')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id}>
                <td className="primary">
                  <div className="nc-set-device">
                    <Icon name="laptopComputer" size={20} />
                    <div>
                      <div>{s.current ? deviceName() : t('lp.settings.web', 'Web')}</div>
                      {s.current && <div className="nc-set-this-device">{t('lp.settings.this_device', 'This Device')}</div>}
                    </div>
                  </div>
                </td>
                <td>{s.current ? t('lp.settings.now', 'Now') : fmt(s.createdTime)}</td>
                <td>{t('lp.settings.unknown', 'Unknown')}</td>
                <td style={{ textAlign: 'end' }}>
                  {!s.current && (
                    <Button
                      small
                      onClick={async () => {
                        await api('revokeSession', { id: s.id });
                        load();
                      }}
                    >
                      {t('lp.settings.log_out', 'Log out')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={4}>{t('lp.settings.no_sessions_are_currently_active', 'No sessions are currently active.')}</td></tr>
            )}
          </tbody>
        </table>
        {(more > 0 || showAll) && rows.length > 3 && (
          <div role="button" className="nc-set-load-more" onClick={() => setShowAll(!showAll)}>
            <Icon name={showAll ? 'arrowStraightUpFill' : 'arrowStraightDownSmall'} size={16} />
            {showAll
              ? t('lp.settings.collapse_the_device_list', 'Collapse the device list')
              : t('lp.settings.numberofdevicesleft_plural_0_one_other', '{numberOfDevicesLeft, plural, =0 {Device list is complete} one {Load # more device} other {Load # more devices}}', { numberOfDevicesLeft: more })}
          </div>
        )}
      </div>
    </>
  );
}
