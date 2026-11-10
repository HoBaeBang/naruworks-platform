

// (name + icon) → for work: "Who else is on your team?" invites (skippable).
// e2e contract (e2e/lib.mjs signup): #name + button[type=submit], a "Continue" button on the use-case step,
// #ws + button[type=submit] (default use case "For personal life" skips the invite step).
import { useRef, useState } from 'react';
import type { UserRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { api, uploadFile } from '../../lib/api.ts';
import { useSession } from '../../lib/store/session.ts';
import { records } from '../../lib/store/records.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useRecord } from '../../lib/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { openIconPicker } from '../page/IconPicker.tsx';
import { t } from '../shell/i18n.ts';
import './icons.tsx';
import './auth.css';

type Step = 'profile' | 'use' | 'workspace' | 'invite';
type UseCase = 'team' | 'personal' | 'school';


const STARTER_TEMPLATES: Record<UseCase, { id: string; label: string; icon: string }[]> = {
  team: [{ id: 'team-wiki', label: 'Team wiki', icon: '📚' }, { id: 'project-tracker', label: 'Projects', icon: '🎯' }, { id: 'meeting-notes', label: 'Meeting notes', icon: '🗓️' }],
  school: [{ id: 'todo-list', label: 'Assignments', icon: '✏️' }, { id: 'reading-list', label: 'Reading list', icon: '📚' }, { id: 'weekly-planner', label: 'Weekly planner', icon: '🗓️' }],
  personal: [{ id: 'todo-list', label: 'Task list', icon: '✅' }, { id: 'journal', label: 'Journal', icon: '📔' }, { id: 'reading-list', label: 'Reading list', icon: '📚' }],
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function nameError(v: string): string | null {
  const s = v.trim();
  if (!s) return t('lp.auth.name_can_t_be_empty', 'Name can’t be empty');
  if (s.length > 65) return t('lp.auth.use_65_characters_or_fewer_for', 'Use 65 characters or fewer for the name');
  if (/https?:\/\/|www\./i.test(s)) return t('lp.auth.urls_aren_t_allowed_in_the', 'URLs aren’t allowed in the name');
  return null;
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ['profile', 'use', 'workspace', 'invite'];
  const i = order.indexOf(step);
  return (
    <div className="nc-onb-steps" aria-hidden>
      {order.slice(0, 3).map((s, k) => <span key={s} className={k <= Math.min(i, 2) ? 'on' : ''} />)}
    </div>
  );
}

export function OnboardingPage() {
  const userId = useSession((s) => s.userId)!;
  const user = useRecord<UserRecord>('lit_user', userId);
  const [step, setStep] = useState<Step>('profile');
  const [name, setName] = useState(user?.name ?? '');
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [use, setUse] = useState<UseCase>('personal');
  const [wsName, setWsName] = useState('');
  const [wsIcon, setWsIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [invites, setInvites] = useState<string[]>(['', '', '']);
  const [starters, setStarters] = useState<string[] | null>(null);
  const chosenStarters = starters ?? (use === 'personal' ? [] : STARTER_TEMPLATES[use].map((x) => x.id));
  const fileRef = useRef<HTMLInputElement>(null);

  const photo = user?.profile_photo;
  const initial = (name.trim()[0] ?? user?.email?.[0] ?? '?').toUpperCase();

  const saveProfile = async () => {
    const err = nameError(name);
    setNameErr(err);
    if (err) return;
    const n = name.trim();
    transactions.run('', 'onboarding.setName', (tx) => {
      tx.update('lit_user', userId, [], { name: n, given_name: n, onboarding_completed: true });
    });
    if (showPassword && password) {
      try {
        await api('changePassword', { password });
      } catch (e: any) {
        setNameErr(e?.message ?? null);
        return;
      }
    }
    setWsName((cur) => cur || t('lp.auth.s_workspace', '{name}’s Workspace', { name: n }));
    setStep('use');
  };

  const saveUseCase = () => {
    const settings = records.get<UserSettingsRecord>('user_settings', userId);
    transactions.run('', 'onboarding.useCase', (tx) => {
      if (settings) tx.update('user_settings', userId, ['settings'], { onboarding_use_case: use });
      else tx.set('user_settings', userId, [], { id: userId, settings: { onboarding_use_case: use } });
    }, { skipHistory: true });
    setStep('workspace');
  };

  const finish = async (id: string) => {
    await useSession.getState().load();
    useSession.getState().setSpace(id);
  };

  const createWorkspace = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await transactions.flush();
      const res = await api('createWorkspace', { name: wsName.trim() || t('lp.auth.my_workspace', 'My Workspace'), icon: wsIcon || undefined });
      // starter templates go to the new workspace's Private section (usable / deletable like any page)
      for (const templateId of chosenStarters) await api('getTemplate', { templateId, spaceId: res.spaceId }).catch(() => null);
      if (use === 'team') {
        setSpaceId(res.spaceId);
        setStep('invite');
      } else {
        await finish(res.spaceId);
      }
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  };

  const sendInvites = async (skip: boolean) => {
    if (!spaceId || busy) return;
    const emails = invites.map((s) => s.trim()).filter(Boolean);
    if (!skip && emails.some((e) => !EMAIL_RE.test(e))) {
      useUI.getState().toast(t('lp.auth.some_email_addresses_look_invalid_try', 'Some email addresses look invalid. Try again?'));
      return;
    }
    setBusy(true);
    try {
      if (!skip && emails.length) await api('inviteMembers', { spaceId, emails, role: 'editor' });
      await finish(spaceId);
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const up = await uploadFile(f, f.name);
      transactions.run('', 'onboarding.setPhoto', (tx) => tx.update('lit_user', userId, [], { profile_photo: up.url }));
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? 'Upload failed');
    }
  };

  return (
    <div className="nc-auth nc-onb">
      <header className="nc-onb-header">
        <Icon name="litpage" size={28} />
        <Steps step={step} />
      </header>
      <main className="nc-onb-main">
        {step === 'profile' && (
          <form className="nc-onb-card" noValidate onSubmit={(e) => { e.preventDefault(); void saveProfile(); }}>
            <div className="nc-auth-heading">
              <h1>{t('lp.auth.set_up_your_profile', 'Set up your profile')}</h1>
              <h2>{t('lp.auth.this_is_the_name_and_photo', 'This is the name and photo people see in Litpage')}</h2>
            </div>
            <div className="nc-onb-avatar-wrap">
              <div
                role="button"
                aria-label={t('lp.auth.upload_a_profile_photo', 'Upload a profile photo')}
                className="nc-onb-avatar"
                onClick={() => fileRef.current?.click()}
              >
                {photo ? <img src={photo} alt="" /> : <span>{initial}</span>}
                <span className="nc-onb-avatar-badge"><Icon name="camera" size={14} /></span>
              </div>
              <button type="button" className="nc-auth-textbtn" onClick={() => fileRef.current?.click()}>
                {photo ? t('lp.auth.change', 'Change') : t('lp.auth.choose_a_photo', 'Choose a photo')}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
            </div>
            <label className="nc-auth-label" htmlFor="name">{t('lp.auth.enter_your_name', 'Tell us your name')}</label>
            <div className="nc-auth-field">
              <input id="name" autoFocus autoComplete="name" placeholder={t('lp.auth.name', 'Name')} value={name} onChange={(e) => { setName(e.target.value); setNameErr(null); }} />
            </div>
            {showPassword ? (
              <>
                <label className="nc-auth-label second" htmlFor="onb-password">{t('lp.auth.create_a_password', 'Create a password')}</label>
                <div className="nc-auth-field">
                  <input id="onb-password" type="password" autoComplete="new-password" placeholder={t('lp.auth.password', 'Password')} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="nc-auth-hint-line">
                  {t('lp.auth.at_least_8_characters', 'At least 8 characters')} · {t('lp.auth.a_letter_and_a_number', 'A letter and a number')}
                </div>
                <button type="button" className="nc-auth-textbtn left" onClick={() => { setShowPassword(false); setPassword(''); }}>
                  {t('lp.auth.skip_password', 'Skip password')}
                </button>
              </>
            ) : (
              <button type="button" className="nc-auth-textbtn left" onClick={() => setShowPassword(true)}>
                {t('lp.auth.set_a_password_optional', 'Set a password (optional)')}
              </button>
            )}
            <button className="nc-auth-submit" type="submit" disabled={!name.trim()}>{t('lp.auth.continue', 'Continue')}</button>
            {nameErr && <div role="alert" className="nc-auth-error">{nameErr}</div>}
          </form>
        )}

        {step === 'use' && (
          <div className="nc-onb-card wide">
            <div className="nc-auth-heading">
              <h1>{t('lp.auth.how_will_you_use_litpage', 'How will you use Litpage?')}</h1>
              <h2>{t('lp.auth.we_ll_use_this_to_tailor', 'We’ll use this to tailor Litpage for you')}</h2>
            </div>
            <div className="nc-onb-choices" role="radiogroup">
              {([
                ['team', 'briefcase', t('lp.auth.for_work', 'For work'), t('lp.auth.stay_on_top_of_company_goals', 'Stay on top of company goals, projects, and meeting notes')],
                ['personal', 'heart', t('lp.auth.for_your_personal_life', 'For your personal life'), t('lp.auth.write_more_clearly_think_better_and', 'Write more clearly, think better, and stay organized')],
                ['school', 'graduationCap', t('lp.auth.for_school', 'For school'), t('lp.auth.bring_your_notes_research_and_to', 'Bring your notes, research, and to-dos together')],
              ] as const).map(([key, icon, title, desc]) => (
                <div
                  key={key}
                  role="radio"
                  aria-checked={use === key}
                  tabIndex={0}
                  className={`nc-onb-choice ${use === key ? 'selected' : ''}`}
                  onClick={() => setUse(key)}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setUse(key); } }}
                >
                  <Icon name={icon} size={28} />
                  <div className="nc-onb-choice-title">{title}</div>
                  <div className="nc-onb-choice-desc">{desc}</div>
                </div>
              ))}
            </div>
            <div className="nc-onb-narrow">
              <button className="nc-auth-submit" type="button" onClick={saveUseCase}>{t('lp.auth.continue', 'Continue')}</button>
            </div>
          </div>
        )}

        {step === 'workspace' && (
          <form className="nc-onb-card" noValidate onSubmit={(e) => { e.preventDefault(); void createWorkspace(); }}>
            <div className="nc-auth-heading">
              <h1>{t('lp.auth.create_a_workspace', 'Create a workspace')}</h1>
              <h2>{t('lp.auth.your_new_workspace_is_almost_ready', 'Your new workspace is almost ready. Only a few steps left.')}</h2>
            </div>
            <div className="nc-onb-avatar-wrap">
              <div
                role="button"
                aria-label={t('lp.auth.choose_an_icon_and_name', 'Choose an icon and name')}
                className="nc-onb-avatar square"
                onClick={(e) => openIconPicker(e.currentTarget, { current: wsIcon, onPick: (v) => setWsIcon(v ?? '') })}
              >
                {wsIcon ? <span className="emoji">{wsIcon}</span> : <span>{(wsName.trim()[0] ?? 'W').toUpperCase()}</span>}
              </div>
            </div>
            <label className="nc-auth-label" htmlFor="ws">{t('lp.auth.workspace_name', 'Workspace name')}</label>
            <div className="nc-auth-field">
              <input id="ws" autoFocus value={wsName} placeholder={t('lp.auth.my_workspace', 'My Workspace')} onChange={(e) => setWsName(e.target.value)} />
            </div>
            <div className="nc-auth-hint-line">{t('lp.auth.the_name_of_your_company_or', 'The name of your company or organization. You can change it later.')}</div>
            <div className="nc-onb-starters" role="group" aria-label={t('lp.auth.start_with_templates', 'Start with templates')}>
              <div className="nc-onb-starters-label">{t('lp.auth.start_with_templates', 'Start with templates')}</div>
              <div className="nc-onb-starters-list">
                {STARTER_TEMPLATES[use].map((tpl) => {
                  const on = chosenStarters.includes(tpl.id);
                  return (
                    <div
                      key={tpl.id}
                      role="checkbox"
                      aria-checked={on}
                      tabIndex={0}
                      className={`nc-onb-starter ${on ? 'on' : ''}`}
                      onClick={() => setStarters(on ? chosenStarters.filter((x) => x !== tpl.id) : [...chosenStarters, tpl.id])}
                    >
                      <span className="emoji">{tpl.icon}</span>
                      <span>{tpl.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <button className="nc-auth-submit" type="submit" disabled={busy}>{busy ? <span className="nc-auth-spinner" /> : t('lp.auth.continue', 'Continue')}</button>
          </form>
        )}

        {step === 'invite' && (
          <form className="nc-onb-card" noValidate onSubmit={(e) => { e.preventDefault(); void sendInvites(false); }}>
            <div className="nc-auth-heading">
              <h1>{t('lp.auth.who_else_works_with_you', 'Who else works with you?')}</h1>
              <h2>{t('lp.auth.add_teammates_by_email', 'Add teammates by email')}</h2>
            </div>
            {invites.map((v, i) => (
              <div key={i} className="nc-auth-field" style={{ marginBottom: 8 }}>
                <input
                  aria-label={t('lp.auth.email_address', 'Email address')}
                  autoFocus={i === 0}
                  type="email"
                  placeholder={t('lp.auth.name_company_com', 'you@example.com')}
                  value={v}
                  onChange={(e) => setInvites(invites.map((x, k) => (k === i ? e.target.value : x)))}
                />
              </div>
            ))}
            <button type="button" className="nc-auth-textbtn left" onClick={() => setInvites([...invites, ''])}>
              + {t('lp.auth.add_people_or_invite_in_bulk', 'Add people or invite in bulk')}
            </button>
            <button className="nc-auth-submit" type="submit" disabled={busy}>{t('lp.auth.invite_people', 'Invite people')}</button>
            <button type="button" className="nc-auth-textbtn" onClick={() => void sendInvites(true)}>{t('lp.auth.skip_for_now', 'Do this later')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
