// Lightweight i18n for the workspace shell (sidebar, search, settings, home, auth, import…).

// Default messages are supplemented by the generated Korean bundle.
// Regenerate it with python3 -I scripts/tools/gen_shell_i18n.py, which scans t('lp.shell.default', 'default') calls.

//
//   import { t } from '../shell/i18n.ts';
//   t('lp.shell.search_or_ask_here', 'Search or ask here')
//   t('lp.shell.count_plural_one_other', '{count, plural, one {# page} other {# pages}}', { count: 3 })
import ko from './i18n.ko-KR.json';

export type Locale = 'en-US' | 'ko-KR';
export const LOCALES: { id: Locale; label: string; native: string }[] = [
  { id: 'en-US', label: 'English (US)', native: 'English (US)' },
  { id: 'ko-KR', label: 'Korean', native: '한국어' },
];

const STORAGE_KEY = 'nc:locale';
const catalogs: Record<Locale, Record<string, string>> = { 'en-US': {}, 'ko-KR': ko as Record<string, string> };

function initialLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en-US' || v === 'ko-KR') return v;
  } catch {
    /* storage unavailable */
  }
  return 'en-US';
}

let current: Locale = initialLocale();
document.documentElement.lang = current.slice(0, 2);

export function getLocale(): Locale {
  return current;
}


export function setLocale(l: string | undefined | null, opts?: { reload?: boolean }): boolean {
  const next: Locale = l === 'ko-KR' ? 'ko-KR' : 'en-US';
  if (next === current) return false;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next.slice(0, 2);
  if (opts?.reload) location.reload();
  return true;
}

export type Values = Record<string, string | number | boolean | null | undefined>;


export function t(id: string, defaultMessage: string, values?: Values): string {
  const msg = (current !== 'en-US' && catalogs[current][id]) || defaultMessage;
  return values || msg.includes('{') ? format(msg, values ?? {}, current) : msg;
}

/**
 * Rich messages ("Close <invertedcolor>Click or {keyboardShortcut}</invertedcolor>"): returns [text, tag|null] runs so
 */
export function tParts(id: string, defaultMessage: string, values?: Values): { text: string; tag: string | null }[] {
  const msg = (current !== 'en-US' && catalogs[current][id]) || defaultMessage;
  const formatted = format(msg, values ?? {}, current, true);
  const out: { text: string; tag: string | null }[] = [];
  const re = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formatted))) {
    if (m.index > last) out.push({ text: formatted.slice(last, m.index), tag: null });
    out.push({ text: m[2], tag: m[1] });
    last = m.index + m[0].length;
  }
  if (last < formatted.length) out.push({ text: formatted.slice(last), tag: null });
  return out;
}

/** Same as t() but for an explicit locale (e.g. previews in the language picker). */
export function tIn(locale: Locale, id: string, defaultMessage: string, values?: Values): string {
  const msg = (locale !== 'en-US' && catalogs[locale][id]) || defaultMessage;
  return format(msg, values ?? {}, locale);
}

// ---- tiny ICU MessageFormat subset: {x}, {n, plural, =0 {…} one {# …} other {…}}, {v, select, a {…} other {…}},
// {n, number}; rich-text tags <b>…</b> are stripped to their text (use tRich for React nodes).
function format(msg: string, values: Values, locale: Locale, keepTags = false): string {
  let out = '';
  let i = 0;
  while (i < msg.length) {
    const ch = msg[i];
    if (ch === "'" && msg[i + 1] === "'") {
      out += "'";
      i += 2;
      continue;
    }
    if (ch === '{') {
      const end = matchBrace(msg, i);
      if (end < 0) {
        out += msg.slice(i);
        break;
      }
      out += formatArg(msg.slice(i + 1, end), values, locale);
      i = end + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return keepTags ? out : out.replace(/<\/?[a-zA-Z][\w-]*>/g, '');
}

function matchBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function formatArg(body: string, values: Values, locale: Locale): string {
  const firstComma = body.indexOf(',');
  if (firstComma < 0) {
    const v = values[body.trim()];
    return v == null ? '' : String(v);
  }
  const name = body.slice(0, firstComma).trim();
  const rest = body.slice(firstComma + 1);
  const secondComma = rest.indexOf(',');
  const type = (secondComma < 0 ? rest : rest.slice(0, secondComma)).trim();
  const opts = secondComma < 0 ? '' : rest.slice(secondComma + 1);
  const v = values[name];
  if (type === 'number') return typeof v === 'number' ? v.toLocaleString(locale) : String(v ?? '');
  if (type === 'plural' || type === 'selectordinal') {
    const n = Number(v ?? 0);
    const cases = parseCases(opts);
    const exact = cases.get(`=${n}`);
    const cat = new Intl.PluralRules(locale, { type: type === 'plural' ? 'cardinal' : 'ordinal' }).select(n);
    const chosen = exact ?? cases.get(cat) ?? cases.get('other') ?? '';
    return format(chosen.replace(/#/g, n.toLocaleString(locale)), values, locale);
  }
  if (type === 'select') {
    const cases = parseCases(opts);
    return format(cases.get(String(v)) ?? cases.get('other') ?? '', values, locale);
  }
  return v == null ? '' : String(v);
}

function parseCases(s: string): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    let key = '';
    while (i < s.length && s[i] !== '{' && !/\s/.test(s[i])) key += s[i++];
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '{') break;
    const end = matchBrace(s, i);
    if (end < 0) break;
    m.set(key, s.slice(i + 1, end));
    i = end + 1;
  }
  return m;
}
