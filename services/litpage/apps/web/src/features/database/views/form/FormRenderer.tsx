// Respondent view of a form (preview modal + /form/<viewId> share page): questions rendered from
// getPublicForm, answers validated with the shared rules, submitted through
// submitFormResponse; confirmation "Thank you!" / "Your submission is recorded." + "Submit another".
// Metrics: (question titles 24px/700, 40px inputs, 16px text).
import { useMemo, useState } from 'react';
import { validateAnswer, visibleQuestionIds, type DateAnswer, type FileAnswer, type FormAnswer, type FormCondition, type FormQuestion, type FormSubmitScreen } from '@nc/shared/form/index.ts';
import { api, uploadFile } from '../../../../lib/api.ts';
import { Icon } from '../../../../components/Icon.tsx';
import { OptionPill } from '../../properties/ValueView.tsx';
import './form.css';

export interface PublicQuestion {
  id: string;
  propertyId: string;
  type: string;
  name: string;
  description: string;
  required: boolean;
  longAnswer: boolean;
  displayMode?: 'dropdown' | 'list';
  checkboxLabel: string;
  maxSelection?: number;
  /** conditional logic: asked only when the trigger question's answer matches */
  condition?: FormCondition;
  options: { id: string; value: string; color?: string }[];
  numberFormat?: string;
  relationCollectionId?: string;
  relationLimit?: number;
}

export interface PublicForm {
  viewId: string;
  blockId: string;
  collectionId: string;
  spaceId: string;
  title: string;
  description: string;
  icon?: string;
  cover?: string;
  permission: 'space' | 'public' | 'closed';
  anonymous: boolean;
  submitAs: { id: string; name: string; photo?: string } | null;
  submitScreen: FormSubmitScreen;
  questions: PublicQuestion[];
  members: { id: string; name: string; email?: string }[];
  relationRows: Record<string, { id: string; title: string }[]>;
}

const asQuestion = (q: PublicQuestion): FormQuestion => ({ id: q.id, config: { propertyId: q.propertyId, isRequired: q.required, maxSelection: q.maxSelection, condition: q.condition } });

/** Submit button colors (Form settings › Submit › Color): accent palette. */
const SUBMIT_COLORS: Record<string, string> = {
  default: 'var(--lp-blue-bg-accent)', blue: 'var(--lp-blue-bg-accent)', gray: 'var(--lp-gray-bg-accent, #a1a1aa)', brown: 'var(--lp-brown-bg-accent, #a8a29e)',
  orange: 'var(--lp-orange-bg-accent, #fb923c)', yellow: 'var(--lp-yellow-bg-accent, #fbbf24)', green: 'var(--lp-green-bg-accent, #34d399)', purple: 'var(--lp-purple-bg-accent, #a78bfa)',
  pink: 'var(--lp-pink-bg-accent, #f472b6)', red: 'var(--lp-red-bg-accent, #d44c47)',
};
export function submitColor(c: string | undefined): string {
  return SUBMIT_COLORS[c ?? 'blue'] ?? SUBMIT_COLORS.blue;
}

/** "Email me a copy": signed-in respondents get the copy at their address; public forms ask for one ("Enter your email to receive a copy of your submission."). */
function EmailCopy({ form, pageId }: { form: PublicForm; pageId: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const send = async () => {
    setState('busy');
    try {
      const r = await api<{ to: string }>('emailFormResponse', { viewId: form.viewId, pageId, email: form.submitAs ? undefined : email.trim() });
      setState('sent');
      setMsg(form.submitAs ? `Email sent to ${r.to}` : 'Email sent!');
    } catch (e) {
      setState('error');
      setMsg((e as Error).message || 'Something went wrong while processing that request. Please try again later.');
    }
  };
  if (state === 'sent') return <div className="nc-form-done-sub" data-testid="form-email-sent">{msg}</div>;
  return (
    <div className="nc-form-email-copy">
      {!form.submitAs && <div className="nc-form-done-sub">Enter your email to receive a copy of your submission.</div>}
      {!form.submitAs && <div className="nc-form-input"><input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" /></div>}
      <div role="button" className={`nc-form-btn secondary ${state === 'busy' ? 'busy' : ''}`} onClick={() => state !== 'busy' && (form.submitAs || email.trim()) && void send()}>Email me a copy</div>
      {state === 'error' && <div className="nc-form-error" role="alert">{msg}</div>}
    </div>
  );
}


function QuestionInput({ q, form, value, onChange, disabled }: { q: PublicQuestion; form: PublicForm; value: FormAnswer; onChange: (v: FormAnswer) => void; disabled?: boolean }) {
  const [uploading, setUploading] = useState(false);
  switch (q.type) {
    case 'checkbox':
      return (
        <label className="nc-form-checkbox">
          <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          <span className="nc-form-checkbox-box"><Icon name="check" size={12} /></span>
          {q.checkboxLabel && <span className="nc-form-checkbox-label">{q.checkboxLabel}</span>}
        </label>
      );
    case 'select':
    case 'multi_select': {
      const multi = q.type === 'multi_select';
      const sel = new Set(Array.isArray(value) ? (value as string[]) : value ? [String(value)] : []);
      if (q.displayMode === 'dropdown' && !multi) {
        return (
          <div className="nc-form-input nc-form-select">
            <select value={String((Array.isArray(value) ? (value as string[])[0] : (value as string | undefined)) ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
              <option value="">Choose an option</option>
              {q.options.map((o) => <option key={o.id} value={o.value}>{o.value}</option>)}
            </select>
            <Icon name="chevronDown" size={14} color="var(--lp-icon-secondary)" />
          </div>
        );
      }
      return (
        <div className="nc-form-options" role={multi ? 'group' : 'radiogroup'}>
          {q.options.map((o) => {
            const on = sel.has(o.value);
            return (
              <label key={o.id} className={`nc-form-option ${on ? 'on' : ''}`}>
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={`q-${q.id}`}
                  checked={on}
                  disabled={disabled}
                  onChange={() => {
                    if (multi) {
                      const next = new Set(sel);
                      if (on) next.delete(o.value); else next.add(o.value);
                      onChange([...next]);
                    } else onChange(on ? undefined : o.value);
                  }}
                />
                <span className={`nc-form-option-mark ${multi ? 'square' : 'round'}`} />
                <OptionPill option={{ value: o.value, color: o.color as never }} />
              </label>
            );
          })}
          {!multi && sel.size > 0 && !disabled && <div role="button" className="nc-form-clear" onClick={() => onChange(undefined)}>Clear selection</div>}
          {multi && <div className="nc-form-hint">{q.maxSelection ? `(Respondents can choose up to ${q.maxSelection})` : '(Respondents can choose any number of options)'}</div>}
        </div>
      );
    }
    case 'date': {
      const d = (value as DateAnswer | undefined) ?? undefined;
      return (
        <div className="nc-form-input">
          <input type="date" value={d?.start_date ?? ''} disabled={disabled} placeholder="Your answer" onChange={(e) => onChange(e.target.value ? { start_date: e.target.value } : undefined)} />
        </div>
      );
    }
    case 'person': {
      const sel = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <div className="nc-form-options">
          {form.members.map((m) => (
            <label key={m.id} className={`nc-form-option ${sel.has(m.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={sel.has(m.id)} disabled={disabled} onChange={() => { const n = new Set(sel); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); onChange([...n]); }} />
              <span className="nc-form-option-mark square" />
              <span className="nc-form-person"><span className="nc-form-avatar">{(m.name || '?')[0].toUpperCase()}</span>{m.name}</span>
            </label>
          ))}
        </div>
      );
    }
    case 'relation': {
      const rows = q.relationCollectionId ? form.relationRows[q.relationCollectionId] ?? [] : [];
      const sel = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="nc-form-input nc-form-select">
          <select value={sel[0] ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? [e.target.value] : undefined)}>
            <option value="">Your answer</option>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <Icon name="chevronDown" size={14} color="var(--lp-icon-secondary)" />
        </div>
      );
    }
    case 'file': {
      const files = (Array.isArray(value) ? value : []) as unknown as FileAnswer[];
      return (
        <div className="nc-form-files">
          {files.map((f, i) => (
            <div key={i} className="nc-form-file"><Icon name="paperClip" size={14} /><span>{f.name}</span>
              {!disabled && <span role="button" aria-label="Delete file" className="nc-form-file-del" onClick={() => onChange(files.filter((_, j) => j !== i) as unknown as FormAnswer)}><Icon name="close" size={12} /></span>}
            </div>
          ))}
          <label className={`nc-form-upload ${disabled || form.anonymous ? 'disabled' : ''}`}>
            <Icon name="upload" size={14} />{uploading ? 'Uploading…' : 'Upload'}
            <input type="file" disabled={disabled || form.anonymous || uploading} onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try {
                const r = await uploadFile(f, f.name, form.spaceId);
                onChange([...files, { name: r.name, url: r.url }] as unknown as FormAnswer);
              } finally {
                setUploading(false);
              }
            }} />
          </label>
        </div>
      );
    }
    default: {
      const props = {
        value: (value as string | undefined) ?? '',
        disabled,
        placeholder: 'Your answer',
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
        inputMode: q.type === 'number' ? ('decimal' as const) : undefined,
        type: q.type === 'email' ? 'email' : q.type === 'url' ? 'url' : q.type === 'phone_number' ? 'tel' : 'text',
      };
      return (
        <div className={`nc-form-input ${q.longAnswer ? 'long' : ''}`}>
          {q.longAnswer ? <textarea rows={4} {...(props as object)} /> : <input {...props} />}
        </div>
      );
    }
  }
}

export function FormRenderer({ form, preview, onDone }: { form: PublicForm; preview?: boolean; onDone?: (pageId: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [canView, setCanView] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // conditional logic: only the questions whose conditions hold are asked, validated and sent
  const shown = useMemo(() => visibleQuestionIds(form.questions.map(asQuestion), answers), [form.questions, answers]);
  const qs = form.questions.filter((q) => shown.has(q.id));
  const titleText = form.title.trim();
  const setAnswer = (id: string, v: FormAnswer) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    if (errors[id]) setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
  };
  const submit = async () => {
    const errs: Record<string, string> = {};
    for (const q of qs) {
      const err = validateAnswer(asQuestion(q), { name: q.name, type: q.type } as never, answers[q.id]);
      if (err) errs[q.id] = err;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.querySelector(`[data-question-id="${Object.keys(errs)[0]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const sent: Record<string, FormAnswer> = {};
      for (const q of qs) if (answers[q.id] !== undefined) sent[q.id] = answers[q.id];
      const res = await api<{ pageId?: string; canView?: boolean; errors?: Record<string, string> }>('submitFormResponse', { viewId: form.viewId, answers: sent, preview: !!preview });
      if (res.errors) setErrors(res.errors);
      else if (res.pageId) {
        setDone(res.pageId);
        setCanView(!!res.canView);
        onDone?.(res.pageId);
      }
    } catch (e) {
      setFailure((e as Error).message || 'The form could not be submitted. Try again, or reach out to the form owner.');
    } finally {
      setBusy(false);
    }
  };
  const header = useMemo(() => (
    <>
      {form.icon && <div className="nc-form-r-icon">{form.icon}</div>}
      {titleText && <h1 className="nc-form-r-title">{titleText}</h1>}
      {form.description && <div className="nc-form-r-desc">{form.description}</div>}
    </>
  ), [form.icon, titleText, form.description]);

  if (done) {
    const ss = form.submitScreen;
    const publicCopy = form.anonymous && form.permission === 'public';
    return (
      <div className="nc-form-r nc-form-done" data-testid="form-confirmation">
        <div className="nc-form-done-icon"><Icon name="check" size={28} /></div>
        {/* Form settings › Submit › Confirmation title / body defaults */}
        <div className="nc-form-done-title">{ss.confirmationTitle?.trim() || (publicCopy ? 'Your submission is recorded.' : 'Thank you!')}</div>
        <div className="nc-form-done-sub">{ss.confirmationBody?.trim() || (publicCopy ? 'Thanks for filling out this form.' : 'Your submission was sent successfully.')}</div>
        <div className="nc-form-done-actions">
          {ss.allowSubmitAnotherResponse !== false && (
            <div role="button" className="nc-form-btn secondary" onClick={() => { setAnswers({}); setErrors({}); setDone(null); }}>Submit another</div>
          )}
          {ss.allowViewResponse && canView && (
            <a className="nc-form-btn secondary" data-testid="form-view-response" href={`/${done.replace(/-/g, '')}`} target="_blank" rel="noopener noreferrer">Open my submission</a>
          )}
        </div>
        {ss.allowEmailResponse && !preview && <EmailCopy form={form} pageId={done} />}
      </div>
    );
  }

  return (
    <div className="nc-form-r">
      {form.cover && <div className="nc-form-r-cover" style={{ background: form.cover }} />}
      <div className="nc-form-r-body">
        {header}
        <div className="nc-form-r-as">
          {form.submitAs ? (
            <span className="nc-form-r-pill">Submitting as <span className="nc-form-avatar sm">{form.submitAs.name[0]?.toUpperCase()}</span>{form.submitAs.name}</span>
          ) : (
            <span className="nc-form-r-pill">Sending anonymously</span>
          )}
        </div>
        {qs.map((q) => (
          <div key={q.id} className={`nc-form-r-q ${errors[q.id] ? 'invalid' : ''}`} data-question-id={q.id}>
            <div className="nc-form-r-qtitle" id={`form-question-title-${q.id}`}>{q.name || '(Untitled question)'}{q.required && <span className="nc-form-req" aria-label="required"> *</span>}</div>
            {q.description && <div className="nc-form-r-qdesc">{q.description}</div>}
            <QuestionInput q={q} form={form} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} disabled={busy} />
            {errors[q.id] && <div className="nc-form-error" role="alert">{errors[q.id]}</div>}
          </div>
        ))}
        {failure && <div className="nc-form-error big" role="alert">Something went wrong while processing that request. {failure}</div>}
        <div className="nc-form-r-submit">
          <div role="button" className={`nc-form-btn primary ${busy ? 'busy' : ''}`} data-testid="form-submit" style={{ background: submitColor(form.submitScreen.submitButtonColor) }} onClick={() => !busy && void submit()}>{busy ? 'Submitting…' : form.submitScreen.submitButtonText?.trim() || 'Submit'}</div>
        </div>
      </div>
    </div>
  );
}
