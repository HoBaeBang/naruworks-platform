import { HELP_URL } from '@nc/shared/brand.ts';


// Flow: email → (temporary login code | password) → session. Provider buttons are faithful but not wired here.
// e2e contract (e2e/lib.mjs signup): #email, button[type=submit], #code with the dev code in `.nc-auth-hint b`.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { getLocale, LOCALES, setLocale, t } from '../shell/i18n.ts';
import koCatalog from '../shell/i18n.ko-KR.json';
import { AddAccountBar } from '../shell/accounts.tsx';
import { signInWithPasskey } from '../settings/passkeys.tsx';
import './icons.tsx';
import './auth.css';

type Step = 'email' | 'code' | 'password' | 'mfa';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RESEND_SECONDS = 30;


export const LANGUAGE_OPTIONS: { id: string; native: string; english: string }[] = [
  { id: 'ar-SA', native: 'العربية', english: 'Arabic' },
  { id: 'da-DK', native: 'Dansk', english: 'Danish' },
  { id: 'nl-NL', native: 'Nederlands', english: 'Dutch' },
  { id: 'en-GB', native: 'English (UK)', english: 'English (UK)' },
  { id: 'en-US', native: 'English (US)', english: 'English (US)' },
  { id: 'fi-FI', native: 'Suomi', english: 'Finnish' },
  { id: 'fr-FR', native: 'Français (France)', english: 'French (France)' },
  { id: 'de-DE', native: 'Deutsch', english: 'German' },
  { id: 'he-IL', native: 'עברית', english: 'Hebrew' },
  { id: 'id-ID', native: 'Bahasa Indonesia', english: 'Indonesian' },
  { id: 'it-IT', native: 'Italiano', english: 'Italian' },
  { id: 'ja-JP', native: '日本語', english: 'Japanese' },
  { id: 'ko-KR', native: '한국어', english: 'Korean' },
  { id: 'nb-NO', native: 'Norsk', english: 'Norwegian' },
  { id: 'pt-BR', native: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  { id: 'zh-CN', native: '简体中文', english: 'Simplified Chinese' },
  { id: 'es-LA', native: 'Español (Latinoamérica)', english: 'Spanish (Latin American)' },
  { id: 'es-ES', native: 'Español (España)', english: 'Spanish (Spain)' },
  { id: 'sv-SE', native: 'Svenska', english: 'Swedish' },
  { id: 'th-TH', native: 'ภาษาไทย', english: 'Thai' },
  { id: 'zh-TW', native: '繁體中文', english: 'Traditional Chinese' },
  { id: 'vi-VN', native: 'Tiếng Việt', english: 'Vietnamese' },
];

export function openLanguageMenu(anchor: HTMLElement) {
  const cur = getLocale();
  openMenu(anchor, {
    width: 300,
    maxHeight: 360,
    sections: [{
      items: LANGUAGE_OPTIONS.map((l) => {
        const supported = LOCALES.some((x) => x.id === l.id);
        return {
          label: `${l.native} · ${l.english}`,
          text: `${l.native} ${l.english}`,
          checked: l.id === cur,
          disabled: !supported,
          onSelect: () => {
            if (l.id !== cur) setLocale(l.id, { reload: true });
          },
        };
      }),
    }],
  }, { placement: 'top' });
}

function currentLanguageName() {
  const cur = getLocale();
  return LANGUAGE_OPTIONS.find((l) => l.id === cur)?.native ?? 'English (US)';
}

function openHelpMenu(anchor: HTMLElement) {
  openMenu(anchor, {
    width: 240,
    sections: [{
      items: [
        ...(HELP_URL ? [
          { label: t('lp.auth.help_documentation', 'Help & documentation'), icon: 'book', onSelect: () => window.open(HELP_URL!, '_blank') },
          { label: t('lp.auth.message_support', 'Message support'), icon: 'bubbleRight', onSelect: () => window.open(HELP_URL!, '_blank') },
          { label: t('lp.auth.terms_privacy', 'Terms & privacy'), icon: 'shield', onSelect: () => window.open(HELP_URL!, '_blank') },
        ] : []),
        { label: t('lp.auth.status', 'Status'), icon: 'lightning', onSelect: () => window.open('https://www.lit-status.com', '_blank') },
      ],
    }],
  }, { placement: 'top-end' });
}


export function rich(msg: string, tags: Record<string, (chunk: string) => ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/gs;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(msg))) {
    if (m.index > last) out.push(msg.slice(last, m.index));
    const fn = tags[m[1]];
    out.push(<span key={i++}>{fn ? fn(m[2]) : m[2]}</span>);
    last = m.index + m[0].length;
  }
  if (last < msg.length) out.push(msg.slice(last));
  return out;
}


export function msg(id: string, defaultMessage: string, values?: Record<string, string | number>): string {
  let raw = defaultMessage;
  if (getLocale() === 'ko-KR') {
    const v = (koCatalog as Record<string, string>)[id];
    if (v) raw = v;
  }
  return values ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m)) : raw;
}

function AuthHelpButton() {
  return (
    <div
      role="button"
      aria-label={t('lp.auth.help', 'Help')}
      className="nc-auth-help"
      onClick={(e) => openHelpMenu(e.currentTarget as HTMLElement)}
    >
      <Icon name="questionMarkCircle" size={20} style={{ color: 'var(--lp-icon-tertiary)' }} />
    </div>
  );
}

function Providers({ mode }: { mode: 'login' | 'signup' }) {
  const list = mode === 'signup'
    ? [['google', t('lp.auth.google', 'Google')], ['microsoft', t('lp.auth.microsoft', 'Microsoft')], ['openAi', t('lp.auth.chatgpt', 'ChatGPT')]]
    : [
        ['google', t('lp.auth.google', 'Google')],
        ['openAi', t('lp.auth.chatgpt', 'ChatGPT')],
        ['appleTintable', t('lp.auth.apple', 'Apple')],
        ['microsoft', t('lp.auth.microsoft', 'Microsoft')],
        ['personKeyFill', t('lp.auth.passkey', 'Passkey')],
        ['building', t('lp.auth.sso', 'SSO')],
      ];
  return (
    <div className="nc-auth-providers">
      {list.map(([icon, label]) => (
        <button
          key={label}
          type="button"
          className="nc-auth-provider"
          onClick={() => {
            
            if (icon === 'personKeyFill') {
              void signInWithPasskey()
                .then(async (done) => { if (done) await useSession.getState().load(); })
                .catch((e) => useUI.getState().toast((e as Error)?.message || t('lp.auth.passkey_sign_in_failed_try_again', 'Passkey sign-in failed. Try again.')));
              return;
            }
            useUI.getState().toast(t('lp.auth.sign_in_is_not_available_in', '{provider} sign-in is not available in this build. Continue with your email.', { provider: label }));
          }}
        >
          <Icon name={icon} size={22} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function Divider() {
  return (
    <div className="nc-auth-divider">
      <div className="line" />
      <div className="label">{t('lp.auth.or_continue_with', 'or use')}</div>
      <div className="line" />
    </div>
  );
}

function Terms() {
  return (
    <div className="nc-auth-terms">
      <p>
        {rich(msg('lp.auth.continuing_confirms_your_understanding_o', 'Continuing confirms your understanding of and agreement with our <termsandconditionslink>Terms & Conditions</termsandconditionslink> and <privacypolicylink>Privacy Policy</privacypolicylink>'), {
          termsandconditionslink: (c) => HELP_URL ? <a className="nc-auth-link-muted" href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
          privacypolicylink: (c) => HELP_URL ? <a className="nc-auth-link-muted" href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
        })}
      </p>
    </div>
  );
}


function SignupBackdrop() {
  const widths = [48, 64, 49, 40, 105, 58, 105, 58, 55, 68, 38];
  return (
    <>
      <div className="nc-auth-mock" aria-hidden>
        <div className="nc-auth-mock-sidebar">
          <div className="nc-auth-mock-ws"><span>🏠</span><div className="bar" style={{ width: 120 }} /></div>
          <div className="nc-auth-mock-rows">
            {widths.map((w, i) => (
              <div key={i} className="nc-auth-mock-row"><div className="sq" /><div className="bar" style={{ width: w }} /></div>
            ))}
          </div>
        </div>
        <div className="nc-auth-mock-main">
          <div className="nc-auth-mock-cover" />
          <div className="nc-auth-mock-avatar" />
          <div className="bar" style={{ marginTop: 12, height: 36, width: 360, borderRadius: 8 }} />
          <div className="bar" style={{ height: 16, width: 200 }} />
          <div className="bar" style={{ marginTop: 16, height: 14, width: 80, borderRadius: 4 }} />
          <div className="nc-auth-mock-input" />
          <div className="bar" style={{ marginTop: 12, height: 14, width: 220, borderRadius: 4 }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="nc-auth-mock-card selected" />
            <div className="nc-auth-mock-card" />
            <div className="nc-auth-mock-card" />
          </div>
          <div className="nc-auth-mock-cta" />
        </div>
        <div className="nc-auth-mock-dot" />
      </div>
      <div className="nc-auth-mock-overlay" aria-hidden />
    </>
  );
}


export function LoginPage({ mode }: { mode: 'login' | 'signup' }) {
  return <AuthScreen key={mode} mode={mode} />;
}

function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  
  const [mfa, setMfa] = useState<{ token: string; factors: { id: string; name: string }[] } | null>(null);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'backup'>('totp');
  const [mfaCode, setMfaCode] = useState('');
  const [backupLeft, setBackupLeft] = useState<number | null>(null);
  // public demo: "Try the demo" signs in to a new sandbox; without a shared account there is no email sign-in
  const demo = useSession((s) => s.demoMode);
  const [demoBusy, setDemoBusy] = useState(false);
  const showEmailForm = !demo.enabled || !!demo.sharedAccount;

  useEffect(() => {
    document.title = mode === 'signup' ? `Litpage - ${t('lp.auth.sign_up', 'Sign up')}` : `Litpage - ${t('lp.auth.log_in', 'Log in')}`;
  }, [mode]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const tm = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(tm);
  }, [resendIn]);

  const reset = () => {
    setStep('email');
    setCode('');
    setPassword('');
    setDevCode(null);
    setError(null);
    setTimeout(() => emailRef.current?.focus(), 0);
  };

  const sendCode = async (addr: string) => {
    const res = await api('sendSignInCode', { email: addr });
    setDevCode(res.devCode ?? null);
    setResendIn(RESEND_SECONDS);
  };

  const submitEmail = async () => {
    setError(null);
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setError(t('lp.auth.that_email_address_isn_t_valid', 'That email address isn’t valid.'));
      return;
    }
    setBusy(true);
    try {
      const opts = await api('checkSignInMethods', { email: addr });
      setHasPassword(!!opts.passwordSignIn);
      if (opts.passwordSignIn && mode === 'login') {
        setStep('password');
      } else {
        await sendCode(addr);
        setStep('code');
      }
    } catch (e: any) {
      setError(e?.message || t('lp.auth.we_could_not_deliver_to_that', 'We could not deliver to that email address. Try another address.'));
    } finally {
      setBusy(false);
    }
  };

  const login = async (body: { code?: string; password?: string }) => {
    setError(null);
    setBusy(true);
    try {
      const res = await api('signInWithEmail', { email: email.trim(), ...body });
      if (res?.mfaRequired) {
        setMfa({ token: res.mfaToken, factors: res.factors ?? [] });
        setMfaMethod('totp');
        setMfaCode('');
        setStep('mfa');
        return;
      }
      await useSession.getState().load();
    } catch {
      setError(body.password
        ? t('lp.auth.incorrect_password', 'Incorrect password.')
        : t('lp.auth.that_login_code_is_incorrect_try', 'That login code is incorrect. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const verifyMfa = async () => {
    if (!mfa) return;
    if (!mfaCode.trim()) {
      setError(mfaMethod === 'backup' ? t('lp.auth.that_backup_code_was_not_accepted', 'That backup code was not accepted. Try it again or use another code.') : t('lp.auth.that_code_was_not_accepted_enter', 'That code was not accepted. Enter it again.'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // a backup code typed into the authenticator field (xxxx-xxxx) is still accepted
      const method = mfaMethod === 'totp' && /[a-z-]/i.test(mfaCode.trim()) ? 'backup' : mfaMethod;
      const res = await api('loginWithMfa', { mfaToken: mfa.token, code: mfaCode.trim(), method });
      if (typeof res?.backupCodesRemaining === 'number') {
        setBackupLeft(res.backupCodesRemaining);
        return;
      }
      await useSession.getState().load();
    } catch (e: any) {
      const m = String(e?.message ?? '');
      if (/expired|log in again|Too many/i.test(m)) {
        setError(m);
        reset();
        setMfa(null);
      } else {
        setError(mfaMethod === 'backup' ? t('lp.auth.that_backup_code_was_not_accepted', 'That backup code was not accepted. Try it again or use another code.') : t('lp.auth.that_code_was_not_accepted_enter', 'That code was not accepted. Enter it again.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const startDemo = async () => {
    setError(null);
    setDemoBusy(true);
    try {
      const res = await api<{ path: string }>('startDemoSandbox');
      try {
        sessionStorage.setItem('nc:afterLogin', res.path);
      } catch {
        /* the start page opens anyway */
      }
      await useSession.getState().load();
    } catch (e: any) {
      setError(e?.message || t('lp.auth.the_demo_could_not_start', 'The demo could not start. Try again in a moment.'));
    } finally {
      setDemoBusy(false);
    }
  };

  const demoBlock = demo.enabled ? (
    <div className="nc-auth-demo">
      <button className="nc-auth-submit" type="button" data-testid="try-demo" disabled={demoBusy} onClick={() => void startDemo()}>
        {demoBusy ? <span className="nc-auth-spinner" /> : t('lp.auth.try_the_demo', 'Try the demo')}
      </button>
      <div className="nc-auth-hint-line nc-auth-demo-hint">
        {t('lp.auth.demo_sandbox_hint', 'You get your own temporary workspace. It is deleted after {hours} hours. No sign-up.', { hours: demo.sandboxHours ?? 4 })}
      </div>
    </div>
  ) : null;

  const submitLabel = step === 'password' ? t('lp.auth.continue_with_a_password', 'Continue with a password') : step === 'mfa' ? t('lp.auth.continue', 'Continue') : t('lp.auth.continue', 'Continue');

  const switchLink = mode === 'signup'
    ? rich(msg('lp.auth.already_a_user_log_in', 'Already a user? <loginlink>Log in</loginlink>'), {
        loginlink: (c) => <a className="nc-auth-link-sec" href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }}>{c}</a>,
      })
    : rich(msg('lp.auth.new_to_litpage_sign_up', 'New to Litpage? <signuplink>Sign up</signuplink>'), {
        signuplink: (c) => <a className="nc-auth-link-sec" href="/signup" onClick={(e) => { e.preventDefault(); navigate('/signup'); }}>{c}</a>,
      });

  // switch link + terms live inside .lit-login (its 4vh bottom margin comes after them)
  // after logging in with a backup code, show how many are left
  const finishLogin = async (openAccount: boolean) => {
    await useSession.getState().load();
    if (openAccount) setTimeout(() => useUI.getState().openSettings('account'), 300);
  };
  const backupInterstitial = backupLeft !== null ? (
    <div className="lit-login nc-auth-login nc-auth-backup-left">
      <div className="nc-auth-mfa-title">{t('lp.auth.backup_codes_left', 'Backup codes left')}</div>
      <div className="nc-auth-hint-line">
        {backupLeft > 0
          ? t('lp.auth.backup_codes_remaining', 'Backup codes remaining: {numRemainingCodes}.', { numRemainingCodes: backupLeft })
          : rich(msg('lp.auth.every_recovery_code_has_been_used', 'Every recovery code has been used. To get a fresh set, open Litpage in a browser or the desktop app and select <boldtext>Settings & members</boldtext> > <boldtext>My account</boldtext> > <boldtext>Regenerate backup codes</boldtext>.'), { boldtext: (c) => <b>{c}</b> })}
      </div>
      <button className="nc-auth-submit" type="button" onClick={() => void finishLogin(true)}>{t('lp.auth.open_account_settings', 'Open account settings')}</button>
      <button className="nc-auth-textbtn" type="button" onClick={() => void finishLogin(false)}>{t('lp.auth.skip_for_now', 'Do this later')}</button>
    </div>
  ) : null;

  const form = backupInterstitial ?? (
    <div className="lit-login nc-auth-login">
      {demoBlock}
      {demoBlock && showEmailForm && <Divider />}
      {showEmailForm && <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (step === 'email') void submitEmail();
          else if (step === 'mfa') void verifyMfa();
          else if (step === 'code') {
            if (!code.trim()) {
              setError(t('lp.auth.that_login_code_is_incorrect_try', 'That login code is incorrect. Try again.'));
              return;
            }
            void login({ code: code.trim() });
          } else void login({ password });
        }}
      >
        <label className="nc-auth-label" htmlFor="email">
          {mode === 'signup' ? t('lp.auth.work_email', 'Work email') : t('lp.auth.email', 'Email')}
        </label>
        <div className={`nc-auth-field ${step !== 'email' ? 'locked' : ''}`}>
          <input
            ref={emailRef}
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            readOnly={step !== 'email'}
            placeholder={mode === 'signup' ? t('lp.auth.name_company_com', 'you@example.com') : t('lp.auth.type_your_email', 'Type your email...')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {email && (
            <div role="button" aria-label={t('lp.auth.clear_input', 'Clear Input')} className="nc-auth-clear" onClick={() => { setEmail(''); reset(); }}>
              <Icon name="xMarkCircleFill" size={20} />
            </div>
          )}
        </div>
        {step === 'email' && mode === 'login' && (
          <div className="nc-auth-hint-line">{t('lp.auth.collaboration_with_teammates_is_simpler', 'Collaboration with teammates is simpler when you use your organization’s email')}</div>
        )}
        {step === 'email' && mode === 'signup' && (
          <div className="nc-auth-tip">
            {rich(msg('lp.auth.tip_use_your_work_email_if', '<bold>Tip: use your work email</bold> (if available) to help your team join Litpage'), {
              bold: (c) => <b>{c}</b>,
            })}
          </div>
        )}
        {step === 'code' && (
          <>
            <label className="nc-auth-label second" htmlFor="code">{t('lp.auth.verification_code', 'Verification code')}</label>
            <div className="nc-auth-field">
              <input
                id="code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t('lp.auth.enter_code', 'Enter code')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="nc-auth-hint">
              <span>{t('lp.auth.check_your_inbox_for_a_code', 'Check your inbox for a code')}</span>
              {devCode && <span className="nc-auth-dev"> · {t('lp.auth.development_code', 'Development code:')} <b>{devCode}</b></span>}
            </div>
          </>
        )}
        {step === 'mfa' && mfa && (
          <>
            <div className="nc-auth-mfa-title">{mfaMethod === 'backup' ? t('lp.auth.confirm_your_identity', 'Verify it’s you') : t('lp.auth.confirm_your_identity', 'Verify it’s you')}</div>
            <label className="nc-auth-label second" htmlFor="mfa-code">
              {mfaMethod === 'backup'
                ? t('lp.auth.type_a_backup_code_you_haven', 'Type a backup code you haven’t used before.')
                : rich(msg('lp.auth.use_the_code_your_authenticator_shows', 'Use the code your <boldtext>{friendlyName}</boldtext> authenticator shows.').replace('{friendlyName}', mfa.factors[0]?.name ?? ''), { boldtext: (c) => <b>{c}</b> })}
            </label>
            <div className="nc-auth-field">
              <input
                id="mfa-code"
                autoFocus
                inputMode={mfaMethod === 'backup' ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                placeholder={mfaMethod === 'backup' ? 'xxxx-xxxx' : t('lp.auth.enter_code', 'Enter code')}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </div>
          </>
        )}
        {step === 'password' && (
          <>
            <label className="nc-auth-label second" htmlFor="password">{t('lp.auth.password', 'Password')}</label>
            <div className="nc-auth-field">
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                placeholder={t('lp.auth.enter_your_password', 'Type your password...')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}
        <button className="nc-auth-submit" type="submit" disabled={busy}>
          {busy ? <span className="nc-auth-spinner" /> : submitLabel}
        </button>
      </form>}
      {error && <div role="alert" className="nc-auth-error">{error}</div>}
      {step === 'code' && (
        <div className="nc-auth-secondary">
          {resendIn > 0 ? (
            <span className="muted">{t('lp.auth.resend_in_s', 'Resend in {secondsRemaining}s', { secondsRemaining: resendIn })}</span>
          ) : (
            <button type="button" className="nc-auth-textbtn" onClick={() => void sendCode(email.trim())}>
              {t('lp.auth.send_the_verification_code_again', 'Send the verification code again')}
            </button>
          )}
          {hasPassword && (
            <button type="button" className="nc-auth-textbtn" onClick={() => { setError(null); setStep('password'); }}>
              {t('lp.auth.continue_with_a_password', 'Continue with a password')}
            </button>
          )}
        </div>
      )}
      {step === 'mfa' && (
        <div className="nc-auth-secondary">
          <button
            type="button"
            className="nc-auth-textbtn"
            onClick={() => {
              setError(null);
              setMfaCode('');
              setMfaMethod(mfaMethod === 'totp' ? 'backup' : 'totp');
            }}
          >
            {mfaMethod === 'totp'
              ? t('lp.auth.enter_a_single_use_backup_code', 'Enter a single-use backup code')
              : t('lp.auth.use_an_authenticator_code', 'Use an authenticator code')}
          </button>
        </div>
      )}
      {step === 'password' && (
        <div className="nc-auth-secondary">
          <button
            type="button"
            className="nc-auth-textbtn"
            onClick={() => useUI.getState().toast(t('lp.auth.check_your_inbox_for_a_password', 'Check your inbox for a password reset link.'))}
          >
            {t('lp.auth.reset_your_password', 'Reset your password')}
          </button>
          <button
            type="button"
            className="nc-auth-textbtn"
            onClick={() => { setError(null); void sendCode(email.trim()).then(() => setStep('code')); }}
          >
            {t('lp.auth.email_me_a_login_code_instead', 'Email me a login code instead')}
          </button>
        </div>
      )}
      {showEmailForm && (
        <>
          <Divider />
          <Providers mode={mode} />
          <div className="nc-auth-switch">{switchLink}</div>
        </>
      )}
      <Terms />
    </div>
  );

  const heading = (
    <div className="nc-auth-heading">
      <h1>{mode === 'signup' ? t('lp.auth.litpage_a_workspace_with_ai_built', 'Litpage: a workspace with AI built in.') : t('lp.auth.your_ai_workspace', 'Your intelligent workspace')}</h1>
      <h2>{mode === 'signup' ? t('lp.auth.create_an_account_using_a_work', 'Create an account using a work email') : t('lp.auth.sign_in_to_keep_working_in', 'Sign in to keep working in Litpage')}</h2>
    </div>
  );

  if (mode === 'signup') {
    return (
      <div className="nc-auth nc-auth-signup">
        <SignupBackdrop />
        <main className="nc-auth-signup-wrap">
          <div className="nc-auth-card">
            <Icon name="litpage" size={40} className="nc-auth-logo" />
            {heading}
            {form}
          </div>
        </main>
        <AuthHelpButton />
      </div>
    );
  }

  return (
    <div className="nc-auth">
      <main className="nc-auth-main">
        <div className="nc-auth-col">
          <div className="nc-auth-center">
            <div className="nc-auth-spacer-top" />
            <Icon name="litpage" size={40} className="nc-auth-logo" />
            {heading}
            {form}
            <div className="nc-auth-spacer-bottom" />
          </div>
          <div className="nc-auth-footer">
            <div
              role="button"
              aria-label={t('lp.auth.language', 'Language: {language}', { language: currentLanguageName() })}
              className="nc-auth-lang"
              onClick={(e) => openLanguageMenu(e.currentTarget as HTMLElement)}
            >
              <Icon name="globe" size={18} />
              <span>{t('lp.auth.language', 'Language: {language}', { language: currentLanguageName() })}</span>
              <Icon name="arrowChevronSingleDownSmall" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
          </div>
        </div>
      </main>
      <AddAccountBar />
      <AuthHelpButton />
    </div>
  );
}
