// Form view model, shared by the web form builder / respondent renderer and the server's
// public form endpoints (apps/server/src/api/modules/forms.ts).
// A form lives on its 'form' view record:
// collection_view.format.form_config = { title, description, icon, cover, questions:[{id, config}], permission,
// anonymous, submissionAccess, submitScreen }.
import type { PropertySchema } from '../records.ts';
import type { RichText } from '../richtext.ts';

export type FormPermission = 'space' | 'public' | 'closed';
export type SubmissionAccess = 'none' | 'reader' | 'comment_only' | 'read_and_write' | 'editor';

export interface FormQuestionConfig {
  propertyId: string;
  /** question title when not synced with the property name */
  name?: string;
  shouldSyncQuestionNameToPropertyName?: boolean;
  isRequired?: boolean;
  hasDescription?: boolean;
  description?: string;
  /** text questions: multi-line answer */
  isLongAnswer?: boolean;
  /** select / multi-select: "Show options as" */
  displayMode?: 'dropdown' | 'list';
  checkboxLabel?: string;
  /** multi-select / person / relation questions: most answers a respondent may pick ("Max selection") */
  maxSelection?: number;
  /** conditional logic: this question is asked only when the answer to `questionId` (a select,
   * multi-select or checkbox question) matches — "If any / all of … is selected", checkbox "checked" / "unchecked" */
  condition?: FormCondition;
}

export interface FormCondition {
  questionId: string;
  operator: 'any' | 'all';
  /** option values; for a checkbox question 'checked' or 'unchecked' */
  values: string[];
}

export interface FormQuestion {
  id: string;
  config: FormQuestionConfig;
}

export interface FormSubmitScreen {
  allowSubmitAnotherResponse?: boolean;
  allowViewResponse?: boolean;
  /** "Email me a copy" button on the confirmation screen */
  allowEmailResponse?: boolean;
  /** Submit button › Text (default "Submit") / Color (an option color name, default blue) */
  submitButtonText?: string;
  submitButtonColor?: string;
  /** Confirmation title / body (default "Thank you!" / "Your response has been submitted successfully.") */
  confirmationTitle?: string;
  confirmationBody?: string;
}

export interface FormConfig {
  version: 1;
  title?: string;
  description?: string;
  icon?: string;
  cover?: string;
  questions: FormQuestion[];
  /** "Who can fill out": Anyone at {space} with link / Anyone on the web with link / No access (closed) */
  permission?: FormPermission;
  /** submissions are anonymous (always true for public forms) */
  anonymous?: boolean;
  /** "Access to submission" granted to the respondent on the created page */
  submissionAccess?: SubmissionAccess;
  submitScreen?: FormSubmitScreen;
  /** user whose access writes anonymous / non-editor submissions */
  ownerId?: string;
  /** the "Auto-create form questions" choice was made */
  initialized?: boolean;
  /** Form settings › Select template: a database template applied to every new submission */
  templateId?: string;
}

/** Does the answer to a condition's trigger question satisfy it? */
export function conditionMet(c: FormCondition, answer: unknown): boolean {
  if (!c.values.length) return false;
  if (c.values.includes('checked') || c.values.includes('unchecked')) {
    const on = answer === true || answer === 'true' || answer === 'Yes';
    return c.values.includes(on ? 'checked' : 'unchecked');
  }
  const picked = new Set((Array.isArray(answer) ? answer : answer === undefined || answer === null || answer === '' ? [] : [answer]).map(String));
  return c.operator === 'all' ? c.values.every((v) => picked.has(v)) : c.values.some((v) => picked.has(v));
}

/** Questions a respondent is asked given their answers so far: a conditional question shows only while its condition
 * holds and its trigger question is itself shown (nested groups). */
export function visibleQuestionIds(questions: FormQuestion[], answers: Record<string, unknown>): Set<string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const memo = new Map<string, boolean>();
  const shown = (q: FormQuestion, depth = 0): boolean => {
    if (memo.has(q.id)) return memo.get(q.id)!;
    let ok = true;
    const c = q.config.condition;
    if (c && depth < 20) {
      const trigger = byId.get(c.questionId);
      ok = !!trigger && trigger.id !== q.id && shown(trigger, depth + 1) && conditionMet(c, answers[trigger.id]);
    }
    memo.set(q.id, ok);
    return ok;
  };
  return new Set(questions.filter((q) => shown(q)).map((q) => q.id));
}

/** Property types that can back a question: Title, Checkbox, Text, Date, Phone, Person, Email,
 * Relation, Number, Multi-select, Files, Place, URL, Select (Status/Formula/Rollup/Created/Edited/ID/Button excluded). */
export const FORM_QUESTION_TYPES = ['title', 'text', 'number', 'select', 'multi_select', 'date', 'person', 'file', 'checkbox', 'url', 'email', 'phone_number', 'relation', 'place'] as const;
/** "Create N questions" leaves out Place (it can still be added as a question by hand). */
const AUTO_CREATE_EXCLUDED = new Set(['place']);
/** Question types public (anonymous) forms cannot show. */
export const PUBLIC_UNSUPPORTED_TYPES = new Set(['person', 'relation']);

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  title: 'Title', text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', date: 'Date', person: 'Person',
  file: 'Files & media', checkbox: 'Checkbox', url: 'URL', email: 'Email', phone_number: 'Phone', relation: 'Relation', place: 'Place',
};

export function supportsQuestion(p: Pick<PropertySchema, 'type'> | undefined): boolean {
  return !!p && (FORM_QUESTION_TYPES as readonly string[]).includes(p.type);
}

export function formConfigOf(format: Record<string, unknown> | undefined): FormConfig | undefined {
  const c = format?.form_config as FormConfig | undefined;
  if (!c || !Array.isArray(c.questions)) return undefined;
  return c;
}

export function newQuestionId(): string {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20)}`;
}

export function questionFor(propertyId: string, extra?: Partial<FormQuestionConfig>): FormQuestion {
  return { id: newQuestionId(), config: { propertyId, shouldSyncQuestionNameToPropertyName: true, ...extra } };
}

/** Supported properties in "Create N questions" order: title first, then schema order. */
export function supportedPropertyIds(schema: Record<string, PropertySchema>): string[] {
  const ids = Object.keys(schema).filter((id) => id !== 'title' && supportsQuestion(schema[id]) && !AUTO_CREATE_EXCLUDED.has(schema[id].type));
  return schema.title ? ['title', ...ids] : ids;
}

export function defaultFormConfig(schema: Record<string, PropertySchema>, opts?: { all?: boolean; ownerId?: string }): FormConfig {
  const ids = opts?.all ? supportedPropertyIds(schema) : schema.title ? ['title'] : supportedPropertyIds(schema).slice(0, 1);
  return { version: 1, questions: ids.map((id) => questionFor(id)), permission: 'space', anonymous: false, submissionAccess: 'none', ownerId: opts?.ownerId, initialized: !!opts };
}

export function questionName(q: FormQuestion, schema: Record<string, PropertySchema>): string {
  const p = schema[q.config.propertyId];
  if (q.config.shouldSyncQuestionNameToPropertyName !== false && p) return p.name;
  return q.config.name ?? p?.name ?? '';
}

// ---------- answers ---------

export interface FileAnswer { name: string; url: string }
export interface DateAnswer { start_date: string; start_time?: string; end_date?: string; end_time?: string; time_zone?: string }
export type FormAnswer = string | number | boolean | string[] | DateAnswer | FileAnswer[] | null | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\-.\s\d]{3,}$/;

export function isEmptyAnswer(v: FormAnswer): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return !(v as DateAnswer).start_date;
  return false;
}

/** Per-question validation messages. */
export function validateAnswer(q: FormQuestion, p: PropertySchema | undefined, v: FormAnswer): string | null {
  if (!p) return null;
  if (isEmptyAnswer(v)) return q.config.isRequired ? 'Please answer this question' : null;
  switch (p.type) {
    case 'email': return EMAIL.test(String(v).trim()) ? null : 'Invalid email';
    case 'number': return Number.isFinite(Number(String(v).replace(/,/g, ''))) ? null : 'Invalid number';
    case 'url': {
      const s = String(v).trim();
      try {
        new URL(/^[a-z]+:\/\//i.test(s) ? s: `https://${s}`);
        return /\./.test(s) || /^[a-z]+:\/\//i.test(s) ? null: 'Invalid URL';
      } catch {
        return 'Invalid URL';
      }
    }
    case 'phone_number': return PHONE.test(String(v).trim()) ? null : 'Enter a valid phone number';
    case 'multi_select':
    case 'person':
    case 'relation':
      if (q.config.maxSelection && Array.isArray(v) && v.length > q.config.maxSelection) return `Choose no more than ${q.config.maxSelection}`;
      return null;
    default: return null;
  }
}

/** Encode an answer as the property's stored value (rich-text property encodings). */
export function encodeAnswer(p: PropertySchema, v: FormAnswer, spaceId?: string): RichText | undefined {
  if (isEmptyAnswer(v)) return p.type === 'checkbox' ? ([['No']] as RichText) : undefined;
  switch (p.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number':
      return [[String(v).trim()]] as RichText;
    case 'place': {
      const s = String(v).trim();
      return [['‣', [['plc', { name: s, address: s }]]]] as unknown as RichText;
    }
    case 'number': {
      const n = Number(String(v).replace(/,/g, ''));
      return Number.isFinite(n) ? ([[String(n)]] as RichText) : undefined;
    }
    case 'select': {
      const s = Array.isArray(v) ? v[0] : String(v);
      return s ? ([[s]] as RichText) : undefined;
    }
    case 'multi_select': {
      const list = (Array.isArray(v) ? v : [String(v)]).map((x) => String(x).replace(/,/g, ' ').trim()).filter(Boolean);
      return list.length ? ([[list.join(',')]] as RichText) : undefined;
    }
    case 'checkbox':
      return [[v ? 'Yes' : 'No']] as RichText;
    case 'date': {
      const d = v as DateAnswer;
      const type = d.end_date ? (d.start_time ? 'datetimerange' : 'daterange') : d.start_time ? 'datetime' : 'date';
      return [['‣', [['d', { type, ...d }]]]] as unknown as RichText;
    }
    case 'person': {
      const ids = (Array.isArray(v) ? v : [String(v)]).map(String);
      const out: unknown[] = [];
      ids.forEach((id, i) => {
        if (i) out.push([',']);
        out.push(['‣', [['u', id]]]);
      });
      return out as RichText;
    }
    case 'relation': {
      const ids = (Array.isArray(v) ? v : [String(v)]).map(String);
      const out: unknown[] = [];
      ids.forEach((id, i) => {
        if (i) out.push([',']);
        out.push(['‣', [['p', id, spaceId ?? '']]]);
      });
      return out as RichText;
    }
    case 'file': {
      const files = (Array.isArray(v) ? v : []) as unknown as FileAnswer[];
      const out: unknown[] = [];
      files.forEach((f, i) => {
        if (i) out.push([',']);
        out.push([f.name, [['a', f.url]]]);
      });
      return out.length ? (out as RichText) : undefined;
    }
    default:
      return undefined;
  }
}
