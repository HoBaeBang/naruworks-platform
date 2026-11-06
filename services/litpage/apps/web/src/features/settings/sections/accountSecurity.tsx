// Settings › Account › Account security: Two-factor authentication (authenticator apps +
// backup codes: setup with QR code, manage, verify identity, turn off), Manage emails (secondary addresses with a
// verification code, make primary, remove), Remove password, Delete my account. Server: api/modules/account.ts.
import { useEffect, useState, type ReactNode } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { getLocale, t } from '../../shell/i18n.ts';
import { Badge, Button, msg, openSubDialog, rich } from '../ui.tsx';
import { qrSvgPath } from '../qr.ts';
import '../admin.css';

export interface MfaFactor { id: string; kind: 'totp'; name: string; createdTime: number }
export interface AccountSecurity {
  hasPassword: boolean;
  mfa: { enabled: boolean; factors: MfaFactor[]; backupCodesRemaining: number; maxAuthenticators: number };
  emails: { email: string; primary: boolean }[];
  maxEmails: number;
}

export function loadAccountSecurity(): Promise<AccountSecurity> {
  return api<AccountSecurity>('getAccountSecurity');
}

function bold(text: string): ReactNode[] {
  return rich(text, {}, { boldtext: (c) => <strong>{c}</strong>, b: (c) => <strong>{c}</strong> });
}

function fmtDay(ms: number): string {
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms));
}

/** 6-digit code input (paste-friendly, numeric keyboard). */
function CodeInput({ value, onChange, onEnter, label, placeholder, autoFocus = true }: { value: string; onChange: (v: string) => void; onEnter?: () => void; label?: string; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div>
      {label && <label className="nc-set-label">{label}</label>}
      <div className="nc-set-input">
        <input
          autoFocus={autoFocus}
          inputMode="text"
          autoComplete="one-time-code"
          aria-label={label ?? t('lp.settings.one_time_passcode', 'One-time passcode')}
          placeholder={placeholder ?? '000000'}
          value={value}
          maxLength={20}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- verify identity

/** "To continue, we need to verify your identity": authenticator code (or a backup code via "Try another method"). */
function VerifyIdentity({ factors, onVerified, busy, error }: { factors: MfaFactor[]; onVerified: (code: string, method: 'totp' | 'backup') => void; busy?: boolean; error?: string }) {
  const [method, setMethod] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const name = factors[0]?.name ?? '';
  return (
    <>
      <h3>{method === 'totp' ? t('lp.settings.verify_your_identity_to_continue', 'Verify your identity to continue') : t('lp.settings.verify_your_identity_to_continue', 'Verify your identity to continue')}</h3>
      <div className="desc">
        {method === 'totp'
          ? bold(t('lp.settings.use_the_code_your_authenticator_shows', 'Use the code your <boldtext>{friendlyName}</boldtext> authenticator shows.', { friendlyName: name }))
          : t('lp.settings.type_a_backup_code_you_haven', 'Type a backup code you haven’t used before.')}
      </div>
      <CodeInput value={code} onChange={setCode} onEnter={() => code.trim() && onVerified(code.trim(), method)} placeholder={method === 'backup' ? 'xxxx-xxxx' : '000000'} />
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy || !code.trim()} onClick={() => onVerified(code.trim(), method)}>{t('lp.settings.continue', 'Continue')}</Button>
        <Button onClick={() => { setMethod(method === 'totp' ? 'backup' : 'totp'); setCode(''); }}>
          {method === 'totp' ? t('lp.settings.switch_to_backup_codes', 'Switch to backup codes') : t('lp.settings.use_an_authenticator_code', 'Use an authenticator code')}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- setup

type SetupStep =
  | { kind: 'intro' }
  | { kind: 'verify' }
  | { kind: 'scan'; enrollmentId: string; secret: string; uri: string; showSecret: boolean }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'done' };

/** "Add verification method" (first setup) and "Add authenticator" (second one, after verifying). */
export function openTwoStepSetup(sec: AccountSecurity, onChange: () => void) {
  openSubDialog((close) => <TwoStepSetup sec={sec} close={close} onChange={onChange} />);
}

function TwoStepSetup({ sec, close, onChange }: { sec: AccountSecurity; close: () => void; onChange: () => void }) {
  const adding = sec.mfa.enabled;
  const [step, setStep] = useState<SetupStep>(adding ? { kind: 'verify' } : { kind: 'intro' });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async (verify?: { code: string; method: 'totp' | 'backup' }) => {
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ enrollmentId: string; secret: string; uri: string }>('startTotpEnrollment', verify ?? {});
      setStep({ kind: 'scan', ...r, showSecret: false });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    if (step.kind !== 'scan') return;
    if (!name.trim()) return setErr(t('lp.settings.give_the_authenticator_a_name', 'Give the authenticator a name.'));
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ backupCodes: string[] | null }>('completeTotpEnrollment', { enrollmentId: step.enrollmentId, name: name.trim(), code: code.trim() });
      onChange();
      setStep(r.backupCodes ? { kind: 'codes', codes: r.backupCodes } : { kind: 'done' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (step.kind === 'intro') {
    return (
      <>
        <h3>{t('lp.settings.enable_two_step_verification', 'Enable two-step verification')}</h3>
        <div className="desc">{t('lp.settings.confirm_your_identity_with_a_password', 'Verify it’s you with a password and verification code')}</div>
        <div role="button" tabIndex={0} className="nc-set-method" data-method="totp" onClick={() => void start()} onKeyDown={(e) => { if (e.key === 'Enter') void start(); }}>
          <Icon name="qrCode" size={22} />
          <div>
            <div className="t">{t('lp.settings.authenticator_code', 'Authenticator code')} <Badge>{t('lp.settings.recommended', 'Recommended')}</Badge></div>
            <div className="d">{t('lp.settings.use_an_authenticator_app_to_get', 'Use an authenticator app to get one-time codes')}</div>
          </div>
        </div>
        <div role="button" tabIndex={-1} aria-disabled="true" className="nc-set-method" data-tooltip={t('lp.settings.text_messages_aren_t_available_in', 'Text messages aren’t available in this build')}>
          <Icon name="smartphone" size={22} />
          <div>
            <div className="t">{t('lp.settings.text_a_code_to_me', 'Text a code to me')}</div>
            <div className="d">{t('lp.settings.add_a_phone_number_and_confirm', 'Add a phone and confirm it')}</div>
          </div>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="actions"><Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button></div>
      </>
    );
  }
  if (step.kind === 'verify') {
    return <VerifyIdentity factors={sec.mfa.factors} busy={busy} error={err} onVerified={(c, m) => void start({ code: c, method: m })} />;
  }
  if (step.kind === 'scan') {
    const qr = (() => {
      try {
        return qrSvgPath(step.uri);
      } catch {
        return null;
      }
    })();
    return (
      <>
        <h3>{step.showSecret ? t('lp.settings.enter_the_code_in_your_authenticator', 'Enter the code in your authenticator') : t('lp.settings.scan_with_your_authenticator_app', 'Scan with your authenticator app')}</h3>
        <div className="desc">{t('lp.settings.to_finish_give_the_authenticator_a', 'To finish, give the authenticator a name and type the code it shows')}</div>
        {step.showSecret || !qr ? (
          <div className="nc-set-secret" data-testid="totp-secret">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
        ) : (
          <div className="nc-set-qr">
            <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={t('lp.settings.scan_a_qr_code', 'Scan a QR code')} data-otpauth={step.uri} shapeRendering="crispEdges">
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.path} fill="#000" />
            </svg>
          </div>
        )}
        <div style={{ textAlign: 'center' }}>
          <a className="nc-set-link" href="#" onClick={(e) => { e.preventDefault(); setStep({ ...step, showSecret: !step.showSecret }); }}>
            {step.showSecret ? t('lp.settings.scan_a_qr_code', 'Scan a QR code') : t('lp.settings.can_t_scan_the_code', 'Can’t scan the code?')}
          </a>
        </div>
        <div>
          <label className="nc-set-label">{t('lp.settings.authenticator_name', 'Authenticator name')}</label>
          <div className="nc-set-input"><input aria-label={t('lp.settings.authenticator_name', 'Authenticator name')} placeholder={t('lp.settings.duo_or_authy', 'Duo or Authy')} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <CodeInput autoFocus={false} label={t('lp.settings.one_time_passcode', 'One-time passcode')} value={code} onChange={setCode} onEnter={() => void finish()} />
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <Button variant="primary" disabled={busy || !code.trim()} onClick={() => void finish()}>{t('lp.settings.continue', 'Continue')}</Button>
          <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
        </div>
      </>
    );
  }
  if (step.kind === 'codes') return <BackupCodes codes={step.codes} onDone={() => setStep({ kind: 'done' })} />;
  return (
    <>
      <h3>{t('lp.settings.authenticator_based_two_step_verificatio', 'Authenticator-based two-step verification is on')}</h3>
      <div className="desc">{t('lp.settings.whenever_you_enter_your_password_litpage', 'Whenever you enter your password, Litpage will request a verification code to confirm it’s you.')}</div>
      <div className="actions">
        <Button variant="primary" onClick={() => { close(); void loadAccountSecurity().then((s) => openManageTwoStep(s, onChange)); }}>{t('lp.settings.see_two_step_verification_options', 'See two-step verification options')}</Button>
        <Button onClick={close}>{t('lp.settings.close', 'Close')}</Button>
      </div>
    </>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const download = () => {
    const text = [
      t('lp.settings.litpage_backup_codes', 'Litpage recovery codes'),
      t('lp.settings.keep_these_somewhere_secure_and_check', 'Keep these somewhere secure and check off each code as you use it.'),
      '',
      ...codes,
      '',
      t('lp.settings.created_at', 'Created at {createdAt}', { createdAt: new Date().toLocaleString(getLocale()) }),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'lit-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <>
      <h3>{t('lp.settings.keep_these_backup_codes_safe', 'Keep these backup codes safe')}</h3>
      <div className="desc">{bold(msg('lp.settings.you_can_view_these_only_once', '<boldtext>You can view these only once</boldtext>, so save them somewhere safe to avoid being locked out.'))}</div>
      <div className="nc-set-codes" data-testid="backup-codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="actions">
        <Button icon="download" onClick={download}>{t('lp.settings.download_a_txt_file', 'Download a .txt file')}</Button>
        <Button variant="primary" onClick={onDone}>{t('lp.settings.i_saved_my_codes', 'I saved my codes')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- manage

export function openManageTwoStep(sec: AccountSecurity, onChange: () => void) {
  openSubDialog((close) => <ManageTwoStep initial={sec} close={close} onChange={onChange} />);
}

type Pending =
  | { kind: 'delete'; factor: MfaFactor; last: boolean }
  | { kind: 'regenerate' }
  | { kind: 'turnOff' }
  | null;

function ManageTwoStep({ initial, close, onChange }: { initial: AccountSecurity; close: () => void; onChange: () => void }) {
  const [sec, setSec] = useState(initial);
  const [pending, setPending] = useState<Pending>(null);
  const [verifying, setVerifying] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<MfaFactor | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const reload = async () => {
    const s = await loadAccountSecurity();
    setSec(s);
    onChange();
    return s;
  };
  const runPending = async (code: string, method: 'totp' | 'backup') => {
    if (!pending) return;
    setErr('');
    try {
      if (pending.kind === 'delete') {
        const r = await api<{ enabled: boolean }>('deleteMfaFactor', { factorId: pending.factor.id, code, method });
        await reload();
        setPending(null);
        setVerifying(false);
        if (!r.enabled) setDone(true);
      } else if (pending.kind === 'regenerate') {
        const r = await api<{ backupCodes: string[] }>('regenerateBackupCodes', { code, method });
        await reload();
        setPending(null);
        setVerifying(false);
        setCodes(r.backupCodes);
      } else {
        await api('disableMfa', { code, method });
        await reload();
        setPending(null);
        setVerifying(false);
        setDone(true);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (done) {
    return (
      <>
        <h3>{t('lp.settings.two_step_verification_is_off', 'Two-step verification is off')}</h3>
        <div className="desc">{t('lp.settings.two_step_verification_was_removed_from', 'Two-step verification was removed from your account. Litpage will ask only for your password when you sign in.')}</div>
        <div className="actions"><Button variant="primary" onClick={close}>{t('lp.settings.complete', 'Complete')}</Button></div>
      </>
    );
  }
  if (codes) return <BackupCodes codes={codes} onDone={() => setCodes(null)} />;
  if (verifying && pending) return <VerifyIdentity factors={sec.mfa.factors} error={err} onVerified={(c, m) => void runPending(c, m)} />;
  if (pending?.kind === 'delete' || pending?.kind === 'turnOff') {
    const isTurnOff = pending.kind === 'turnOff';
    const lastFactor = pending.kind === 'delete' && pending.last;
    return (
      <>
        <h3>{isTurnOff || lastFactor ? t('lp.settings.disable_two_step_verification', 'Disable two-step verification') : t('lp.settings.delete_6b57', 'Delete {friendlyName}', { friendlyName: pending.kind === 'delete' ? pending.factor.name : '' })}</h3>
        <div className="desc">
          {isTurnOff
            ? t('lp.settings.disabling_two_step_verification_removes', 'Disabling two-step verification removes an extra layer of account security. Litpage will ask only for your password when you sign in.')
            : lastFactor
              ? t('lp.settings.deleting_disables_two_step_verification', 'Deleting {mfaSettingName} disables two-step verification and removes an extra layer of account security. Litpage will ask only for your password when you sign in.', { mfaSettingName: pending.factor.name })
              : bold(msg('lp.settings.after_deletion_codes_from_won_t', 'After deletion, codes from {friendlyName} won’t work. <boldtext>Delete this verification method?</boldtext>').replace('{friendlyName}', pending.kind === 'delete' ? pending.factor.name : ''))}
        </div>
        <div className="actions">
          <Button variant="danger" onClick={() => setVerifying(true)}>{isTurnOff || lastFactor ? t('lp.settings.disable_two_step_verification', 'Disable two-step verification') : t('lp.settings.delete', 'Delete')}</Button>
          <Button onClick={() => setPending(null)}>{t('lp.settings.cancel', 'Cancel')}</Button>
        </div>
      </>
    );
  }
  if (pending?.kind === 'regenerate') {
    return (
      <>
        <h3>{t('lp.settings.create_new_backup_codes', 'Create new backup codes')}</h3>
        <div className="desc">{bold(msg('lp.settings.backup_codes_let_you_sign_in', 'Backup codes let you sign in when you lose access to your password or other verification methods. <boldtext>Old codes stop working when you create new ones.</boldtext>'))}</div>
        <div className="actions">
          <Button variant="primary" onClick={() => setVerifying(true)}>{t('lp.settings.create_fresh_backup_codes', 'Create fresh backup codes')}</Button>
          <Button onClick={() => setPending(null)}>{t('lp.settings.cancel', 'Cancel')}</Button>
        </div>
      </>
    );
  }
  if (renaming) {
    return <RenameFactor factor={renaming} onDone={async () => { setRenaming(null); await reload(); }} onCancel={() => setRenaming(null)} />;
  }
  const n = sec.mfa.factors.length;
  return (
    <div className="left nc-set-mfa-manage">
      <h3>{t('lp.settings.two_step_verification', 'Two-step verification')}</h3>
      <div className="desc">{t('lp.settings.confirm_your_identity_after_entering_a', 'Verify it’s you after entering a password with a verification code.')}</div>
      <div className="nc-set-label">{t('lp.settings.active', 'Active')}</div>
      <div className="nc-set-mfa-list">
        {sec.mfa.factors.map((f) => (
          <div key={f.id} className="nc-set-mfa-row" data-factor={f.name}>
            <Icon name="qrCode" size={20} />
            <div className="main">
              <div className="t">{f.name}</div>
              <div className="d">{t('lp.settings.set_up', 'Set up {createdTimeNormalized}', { createdTimeNormalized: fmtDay(f.createdTime) })}</div>
            </div>
            <span
              role="button"
              className="nc-set-icon-btn"
              aria-label={t('lp.settings.more_actions', 'More actions')}
              onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                width: 200,
                sections: [{
                  items: [
                    { label: t('lp.settings.edit_title', 'Edit title'), icon: 'pencilSmall', onSelect: () => setRenaming(f) },
                    { label: t('lp.settings.delete', 'Delete'), icon: 'trashSmall', danger: true, onSelect: () => setPending({ kind: 'delete', factor: f, last: n <= 1 }) },
                  ],
                }],
              }, { placement: 'bottom-end' })}
            >
              <Icon name="ellipsisSmall" size={16} />
            </span>
          </div>
        ))}
        <div className="nc-set-mfa-row">
          <Icon name="key" size={20} />
          <div className="main">
            <div className="t">{t('lp.settings.create_new_backup_codes', 'Create new backup codes')}</div>
            <div className="d">{t('lp.settings.use_this_to_recover_your_account', 'Use this to recover your account when other options fail')} · {t('lp.settings.backup_codes_remaining', 'Backup codes remaining: {numRemainingCodes}.', { numRemainingCodes: sec.mfa.backupCodesRemaining })}</div>
          </div>
          <Button small onClick={() => setPending({ kind: 'regenerate' })}>{t('lp.settings.create_new_backup_codes', 'Create new backup codes')}</Button>
        </div>
      </div>
      <div className="nc-set-label">{t('lp.settings.add_methods', 'Add methods')}</div>
      <div
        role="button"
        tabIndex={n >= sec.mfa.maxAuthenticators ? -1 : 0}
        aria-disabled={n >= sec.mfa.maxAuthenticators || undefined}
        className="nc-set-method"
        onClick={() => { if (n < sec.mfa.maxAuthenticators) { close(); openTwoStepSetup(sec, onChange); } }}
      >
        <Icon name="plusSmall" size={20} />
        <div>
          <div className="t">{t('lp.settings.add_authenticator', 'Add authenticator')}</div>
          <div className="d">{n >= sec.mfa.maxAuthenticators ? t('lp.settings.2_of_2_authenticators_are_set', '2 of 2 authenticators are set up') : t('lp.settings.authenticators_in_use_of_2', 'Authenticators in use: {numOfTotpSettings} of 2', { numOfTotpSettings: n })}</div>
        </div>
      </div>
      <div role="button" tabIndex={-1} aria-disabled="true" className="nc-set-method" data-tooltip={t('lp.settings.text_messages_aren_t_available_in', 'Text messages aren’t available in this build')}>
        <Icon name="smartphone" size={20} />
        <div>
          <div className="t">{t('lp.settings.add_a_phone_number', 'Add a phone')}</div>
          <div className="d">{t('lp.settings.of_2_phone_numbers_are_added', '{numOfSmsSettings} of 2 phone numbers are added', { numOfSmsSettings: 0 })}</div>
        </div>
      </div>
      <div className="actions">
        <Button variant="danger" onClick={() => setPending({ kind: 'turnOff' })}>{t('lp.settings.disable_two_step_verification', 'Disable two-step verification')}</Button>
        <Button onClick={close}>{t('lp.settings.close', 'Close')}</Button>
      </div>
    </div>
  );
}

function RenameFactor({ factor, onDone, onCancel }: { factor: MfaFactor; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(factor.name);
  const [err, setErr] = useState('');
  const save = async () => {
    try {
      await api('renameMfaFactor', { factorId: factor.id, name });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <h3>{t('lp.settings.edit_title', 'Edit title')}</h3>
      <div className="nc-set-input"><input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} /></div>
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="primary" onClick={() => void save()}>{t('lp.settings.save', 'Save')}</Button>
        <Button onClick={onCancel}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- password removal

export function openRemovePassword(mfaOn: boolean, onDone: () => void) {
  openSubDialog((close) => <RemovePassword mfaOn={mfaOn} close={close} onDone={onDone} />);
}

function RemovePassword({ mfaOn, close, onDone }: { mfaOn: boolean; close: () => void; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [removed, setRemoved] = useState(false);
  const submit = async () => {
    if (!pw) return setErr(t('lp.settings.current_password_is_required', 'Current password is required.'));
    try {
      await api('removePassword', { currentPassword: pw });
      setRemoved(true);
      onDone();
    } catch (e) {
      setErr((e as Error).message || t('lp.settings.couldn_t_remove_the_password_try', 'Couldn’t remove the password. Try again later.'));
    }
  };
  if (removed) {
    return (
      <>
        <h3>{t('lp.settings.password_removed', 'Password removed')}</h3>
        <div className="desc">{t('lp.settings.we_ll_email_you_a_temporary', 'We’ll email you a temporary sign-in code to access your account.')}</div>
        <div className="actions"><Button variant="primary" onClick={close}>{t('lp.settings.ok', 'OK')}</Button></div>
      </>
    );
  }
  return (
    <>
      <h3>{t('lp.settings.remove_your_password_and_use_temporary', 'Remove your password and use temporary sign-in codes?')}</h3>
      <div className="desc">{t('lp.settings.when_you_sign_in_we_ll', 'When you sign in, we’ll email you a link and a code.')}</div>
      {mfaOn && <div className="desc">{bold(msg('lp.settings.continuing_will_also_disable_two_step', '<boldtext>Continuing will also disable two-step verification.</boldtext>'))}</div>}
      <div>
        <label className="nc-set-label">{t('lp.settings.type_the_password_you_use_now', 'Type the password you use now')}</label>
        <div className="nc-set-input"><input type="password" autoFocus value={pw} placeholder={t('lp.settings.current_password', 'Current password')} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="danger" onClick={() => void submit()}>{t('lp.settings.continue', 'Continue')}</Button>
        <Button onClick={close}>{t('lp.settings.keep_my_password', 'Keep my password')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- manage emails

export function openManageEmails(onChange: () => void) {
  openSubDialog((close) => <ManageEmails close={close} onChange={onChange} />);
}

function ManageEmails({ close, onChange }: { close: () => void; onChange: () => void }) {
  const [sec, setSec] = useState<AccountSecurity | null>(null);
  const [adding, setAdding] = useState<null | { step: 'email' } | { step: 'code'; email: string; devCode?: string }>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const reload = () => loadAccountSecurity().then(setSec).catch(() => {});
  useEffect(() => { void reload(); }, []);
  const send = async () => {
    setErr('');
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setErr(t('lp.settings.enter_a_valid_email_address', 'Use a valid email address.'));
    try {
      const r = await api<{ email: string; devCode?: string }>('addSecondaryEmail', { email: e });
      setAdding({ step: 'code', email: r.email, devCode: r.devCode });
    } catch (er) {
      setErr((er as Error).message);
    }
  };
  const verify = async () => {
    if (adding?.step !== 'code') return;
    setErr('');
    try {
      await api('verifySecondaryEmail', { email: adding.email, code: code.trim() });
      useUI.getState().toast(t('lp.settings.email_added_to_your_account', 'Email added to your account!'));
      setAdding(null);
      setEmail('');
      setCode('');
      void reload();
      onChange();
    } catch (er) {
      setErr((er as Error).message);
    }
  };
  const rowMenu = (anchor: HTMLElement, e: string) => openMenu(anchor, {
    width: 200,
    sections: [{
      items: [
        {
          label: t('lp.settings.make_primary', 'Make primary'), icon: 'checkmarkCircleFillSmall',
          onSelect: () => { void api<any>('makeEmailPrimary', { email: e }).then((r) => { records.mergeRecordMap(r.recordMap); void reload(); onChange(); }).catch((er) => setErr((er as Error).message)); },
        },
        {
          label: t('lp.settings.remove', 'Remove'), icon: 'trashSmall', danger: true,
          onSelect: () => { void api('removeSecondaryEmail', { email: e }).then(() => { useUI.getState().toast(t('lp.settings.email_removed_from_your_account', 'Email removed from your account')); void reload(); onChange(); }).catch((er) => setErr((er as Error).message)); },
        },
      ],
    }],
  }, { placement: 'bottom-end' });
  if (adding?.step === 'email') {
    return (
      <>
        <h3>{t('lp.settings.add_an_email_address', 'Add an email address')}</h3>
        <div className="desc">{t('lp.settings.add_an_email_for_signing_in', 'Add an email for signing in to this Litpage account. It must not already belong to another Litpage account.')}</div>
        <div>
          <label className="nc-set-label">{t('lp.settings.email_address', 'Email address')}</label>
          <div className="nc-set-input"><input autoFocus type="email" aria-label={t('lp.settings.add_an_email_address', 'Add an email address')} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} /></div>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <Button variant="primary" onClick={() => void send()}>{t('lp.settings.add_email', 'Add email')}</Button>
          <Button onClick={() => { setAdding(null); setErr(''); }}>{t('lp.settings.cancel', 'Cancel')}</Button>
        </div>
      </>
    );
  }
  if (adding?.step === 'code') {
    return (
      <>
        <h3>{t('lp.settings.confirm_your_email_address', 'Confirm your email address')}</h3>
        <div className="desc">{t('lp.settings.check_your_inbox_for_the_verification', 'Check your inbox for the verification code we sent, then use it to confirm this address is yours')}</div>
        <div className="desc">{t('lp.settings.sent_a_code_to', 'Sent a code to {email}', { email: adding.email })}</div>
        <CodeInput label={t('lp.settings.verification_code', 'Verification code')} value={code} onChange={setCode} onEnter={() => void verify()} placeholder="000000" />
        {adding.devCode && <div className="nc-auth-hint nc-set-muted small">{t('lp.settings.development_code', 'Development code:')} <b>{adding.devCode}</b></div>}
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <Button variant="primary" disabled={!code.trim()} onClick={() => void verify()}>{t('lp.settings.ok', 'OK')}</Button>
          <Button onClick={() => { setAdding(null); setErr(''); }}>{t('lp.settings.cancel', 'Cancel')}</Button>
        </div>
      </>
    );
  }
  return (
    <div className="left">
      <h3>{t('lp.settings.manage_emails', 'Manage emails')}</h3>
      <div className="desc">{t('lp.settings.sign_in_to_litpage_with_several', 'Sign in to Litpage with several email addresses under one account')}</div>
      <div>
        {(sec?.emails ?? []).map((e) => (
          <div key={e.email} className="nc-set-email-row" data-email={e.email}>
            <span className="e">{e.email}</span>
            {e.primary ? <Badge tone="gray">{t('lp.settings.primary', 'Primary')}</Badge> : (
              <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.more_actions', 'More actions')} onClick={(ev) => rowMenu(ev.currentTarget as HTMLElement, e.email)}><Icon name="ellipsisSmall" size={16} /></span>
            )}
          </div>
        ))}
        {sec && sec.emails.length <= 1 && <div className="nc-set-muted small" style={{ padding: '8px 0' }}>{t('lp.settings.nothing_here_yet_add_an_email', 'Nothing here yet. Add an email address above to begin.')}</div>}
      </div>
      <div className="nc-set-muted small">{t('lp.settings.only_your_primary_email_address_receives', 'Only your primary email address receives customer support and other in-app emails')}</div>
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="primary" icon="plusSmall" disabled={!!sec && sec.emails.length >= sec.maxEmails} onClick={() => { setAdding({ step: 'email' }); setErr(''); }}>{t('lp.settings.add_an_email_address', 'Add an email address')}</Button>
        <Button onClick={close}>{t('lp.settings.close', 'Close')}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- delete account

interface DeletionPreview { toDelete: { id: string; name: string; otherMembers: number }[]; toLeave: { id: string; name: string }[]; affectedMembers: number; mfa: boolean; factors: MfaFactor[] }

export async function startDeleteAccount(user: UserRecord | undefined) {
  let preview: DeletionPreview;
  try {
    preview = await api<DeletionPreview>('getAccountDeletionPreview');
  } catch (e) {
    useUI.getState().toast((e as Error).message);
    return;
  }
  openSubDialog((close) => <DeleteAccount close={close} email={user?.email ?? ''} preview={preview} />);
}

function DeleteAccount({ close, email, preview }: { close: () => void; email: string; preview: DeletionPreview }) {
  const [typed, setTyped] = useState('');
  const [step, setStep] = useState<'confirm' | 'final' | 'verify'>('confirm');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const n = preview.toDelete.length;
  const shared = preview.toDelete.filter((s) => s.otherMembers > 0);
  const ok = typed.trim().toLowerCase() === email.toLowerCase();
  const doDelete = async (code?: string, method?: 'totp' | 'backup') => {
    setBusy(true);
    setErr('');
    try {
      await api('deleteAccount', { email: typed.trim(), code, method, confirmWorkspaceIds: preview.toDelete.map((s) => s.id) });
      location.href = '/login';
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const next = () => {
    if (!ok) return;
    if (step === 'confirm' && shared.length) return setStep('final');
    if (preview.mfa) return setStep('verify');
    void doDelete();
  };
  if (step === 'verify') return <VerifyIdentity factors={preview.factors ?? []} busy={busy} error={err} onVerified={(c, m) => void doDelete(c, m)} />;
  const buttonLabel = n
    ? t('lp.settings.numberofworkspaces_plural_one_other_perm', '{numberOfWorkspaces, plural, one {Permanently erase your account plus 1 workspace} other {Permanently erase your account plus {numberOfWorkspaces} workspaces}}', { numberOfWorkspaces: n })
    : t('lp.settings.delete_account_permanently', 'Delete account permanently');
  if (step === 'final') {
    return (
      <>
        <h3>{t('lp.settings.confirm_action', 'Confirm action?')}</h3>
        <div className="desc">
          {t('lp.settings.there_s_no_undoing_this_you', 'There’s no undoing this. You’re the only admin of {countSpacesToBeDeletedWithOtherMembers} {countSpacesToBeDeletedWithOtherMembers, plural, one {workspace} other {workspaces}} that {countSpacesToBeDeletedWithOtherMembers, plural, one {contains} other {contain}} {affectedMemberCount, plural, one {another member} other {other members}}. Once your account is gone, every member will be removed and {numberOfWorkspaces} {count, plural, one {workspace} other {workspaces}} will be deleted for good.', {
            countSpacesToBeDeletedWithOtherMembers: shared.length, affectedMemberCount: preview.affectedMembers, numberOfWorkspaces: n, count: n,
          })}
        </div>
        <div className="nc-set-ws-list">{shared.map((s) => <div key={s.id}>{s.name}</div>)}</div>
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <Button variant="danger" disabled={busy} onClick={() => (preview.mfa ? setStep('verify') : void doDelete())}>{buttonLabel}</Button>
          <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <h3>{t('lp.settings.permanently_delete_your_whole_account', 'Permanently delete your whole account?')}</h3>
      <div className="desc">
        {n
          ? t('lp.settings.this_can_t_be_undone_your', 'This can’t be undone. Your whole account will be deleted permanently, and you’ll leave every shared workspace. These {count, plural, one {workspace} other {workspaces}} that you own will also be deleted, along with other members’ access:', { count: n })
          : t('lp.settings.this_can_t_be_undone_your_0e01', 'This can’t be undone. Your whole account will be deleted permanently, and you’ll leave every shared workspace.')}
      </div>
      {n > 0 && <div className="nc-set-ws-list" data-testid="delete-workspaces">{preview.toDelete.map((s) => <div key={s.id}>{s.name}</div>)}</div>}
      <div>
        <label className="nc-set-label">{t('lp.settings.type_your_email_address_to_confirm', 'Type your email address to confirm.')}</label>
        <div className="nc-set-input"><input autoFocus aria-label={t('lp.settings.type_your_email_address_to_confirm', 'Type your email address to confirm.')} placeholder={email} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') next(); }} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="danger" disabled={!ok || busy} onClick={next}>{buttonLabel}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}
