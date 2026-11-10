// Formula 2.0 function library: the 97 functions with their parameter specs,
// categories (autocomplete menu order) and evaluation semantics.
import type { Annotation, Decoration, RichText } from '../richtext.ts';
import {
  addToDate, dateBetween, datePart, datetimeFromMs, dateInterval, dateStartMs, formatMoment, makeRange, normalizeUnit, nowValue,
  parseISODate, parseZone, rangeEnd, rangeStart, todayValue, zoneOrSystem, DT, type LitDate,
} from './dates.ts';
import { decAdd, decDiv, decMod, decMul, decSub, formatNumberValue, resolveNumberFormat } from './numbers.ts';
import {
  UNDEF, bool, compareForSort, flattenDeep, list, normalizeRich, num, numbersOf, plainText, rich, richLength, text, toRich, truthy, valuesEqual,
  type FValue, type TextResolver,
} from './values.ts';

// ---------------------------------------------------------------- type specs
export type TypeSpec =
  | { type: 'number' | 'text' | 'checkbox' | 'date' | 'person' | 'block' | 'unknown' | 'undefined' | 'expression' | 'function' }
  | { type: 'array'; of: TypeSpec };

export const T = {
  n: { type: 'number' } as TypeSpec,
  t: { type: 'text' } as TypeSpec,
  c: { type: 'checkbox' } as TypeSpec,
  d: { type: 'date' } as TypeSpec,
  p: { type: 'person' } as TypeSpec,
  b: { type: 'block' } as TypeSpec,
  u: { type: 'unknown' } as TypeSpec,
  x: { type: 'expression' } as TypeSpec,
  undef: { type: 'undefined' } as TypeSpec,
  a: (of: TypeSpec): TypeSpec => ({ type: 'array', of }),
};

export interface Param {
  name: string;
  type: TypeSpec | TypeSpec[];
  optional?: boolean;
}

export type Category = 'generic' | 'text' | 'number' | 'date' | 'people' | 'list' | 'special' | 'internal';
export const CATEGORY_ORDER: Category[] = ['generic', 'text', 'number', 'date', 'people', 'list', 'special'];
export const CATEGORY_LABEL: Record<Category, string> = {
  generic: 'General', text: 'Text', number: 'Number', date: 'Date', people: 'People', list: 'List', special: 'Special', internal: 'Internal',
};

/** Lambda argument: evaluates the expression for an element (errors inside become empty). */
export type Lambda = (current: FValue, index: number) => FValue;
export type Arg = FValue | Lambda;

export interface LibApi {
  tz: string;
  nowMs: number;
  resolver: TextResolver;
  regex(pattern: string, flags?: string): RegExp;
  userInfo(id: string): { name: string; email?: string } | undefined;
  thisRowId?: string;
}

export interface FnDef {
  name: string;
  category: Category;
  params: Param[];
  varargs?: Param[];
  /** static return type; dynamic ones are computed from argument types */
  returns: TypeSpec | ((args: TypeSpec[]) => TypeSpec);
  special?: 'if' | 'ifs' | 'let' | 'lets';
  eval?: (args: Arg[], api: LibApi) => FValue;
}

export class LibError extends Error {
  type: string;
  info: Record<string, unknown>;
  constructor(type: string, message: string, info: Record<string, unknown> = {}) {
    super(message);
    this.type = type;
    this.info = info;
  }
}

function assert(c: unknown): asserts c {
  if (!c) throw new Error('Assertion failed in formulaLibraryFunctions');
}

const V = (a: Arg | undefined) => a as FValue | undefined;
const L = (a: Arg | undefined) => a as Lambda;
const plain = (v: FValue | undefined, api: LibApi) => (v && v.type === 'text' ? plainText(v.value, api.resolver) : '');
const elemType = ([a]: TypeSpec[]): TypeSpec => (a?.type === 'array' ? a.of : T.u);
const sameList = ([a]: TypeSpec[]): TypeSpec => (a?.type === 'array' ? a : T.a(T.u));

function sameType(a: TypeSpec, b: TypeSpec): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'array' && b.type === 'array') return sameType(a.of, b.of);
  return true;
}

/** if()/ternary result type: common type of both branches, empty branches defer to the other. */
export function unifyTypes(a: TypeSpec | undefined, b: TypeSpec | undefined): TypeSpec {
  if (!a || !b) return T.u;
  if (a.type === 'undefined' && b.type !== 'undefined') return b;
  if (b.type === 'undefined' && a.type !== 'undefined') return a;
  return sameType(a, b) ? a : T.u;
}

// rich-text helpers -------------------------------------------------------------------------------
function anns(d: Decoration): Annotation[] {
  return (d[1] as Annotation[] | undefined) ?? [];
}
function mapRuns(rt: RichText, fn: (s: string, a: Annotation[]) => Decoration): RichText {
  return rt.map((d) => fn(d[0], anns(d)));
}
function trimRich(rt: RichText): RichText {
  const out = rt.map((d) => [...d] as Decoration);
  while (out.length && !out[0][0].trimStart()) out.shift();
  while (out.length && !out[out.length - 1][0].trimEnd()) out.pop();
  if (out.length) {
    out[0] = [out[0][0].trimStart(), ...(out[0].slice(1) as [Annotation[]?])] as Decoration;
    const l = out.length - 1;
    out[l] = [out[l][0].trimEnd(), ...(out[l].slice(1) as [Annotation[]?])] as Decoration;
  }
  return out.filter((d) => d[0]);
}
function sliceRich(rt: RichText, start: number, end: number): RichText {
  const out: RichText = [];
  let pos = 0;
  for (const d of rt) {
    const len = d[0].length;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + len);
    if (s < e) out.push(anns(d).length ? [d[0].slice(s - pos, e - pos), anns(d)] : [d[0].slice(s - pos, e - pos)]);
    pos += len;
  }
  return out;
}

const COLOR_NAMES = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const STYLE_KEYS: Record<string, Annotation> = { b: ['b'], i: ['i'], s: ['s'], u: ['_'], c: ['c'] };

/** style()/unstyle() argument parsing: comma lists, color names, *_background, grey alias. */
export function parseStyles(args: RichText[]): Annotation[] {
  const out: Annotation[] = [];
  for (const rt of args) {
    const first = rt?.[0]?.[0];
    if (!first) continue;
    for (const raw of first.toLowerCase().split(',')) {
      const t = raw.trim().replace(/^grey/, 'gray').replace(/^teal/, 'green');
      const base = t.replace(/_background$/, '');
      if (COLOR_NAMES.includes(base) && base !== 'default') out.push(['h', t]);
      else if (STYLE_KEYS[t]) out.push(STYLE_KEYS[t]);
    }
  }
  return out;
}

function padText(src: RichText, target: number, padRt: RichText, side: 'start' | 'end', api: LibApi): FValue {
  const measured = plainText(src, api.resolver);
  const padStr = plainText(padRt, api.resolver);
  const limit = Math.min(Math.floor(target), 10000);
  const len = measured.length;
  if (len >= target) return rich(src);
  const p = padStr.length;
  const d = limit - len;
  const times = p > 0 ? Math.floor(d / p) : 0;
  const rest = p > 0 ? d % p : 0;
  const out: RichText = [];
  if (side === 'end') out.push(...src);
  for (let i = 0; i < times; i++) out.push(...padRt);
  if (rest > 0) out.push(...sliceRich(padRt, 0, rest));
  if (side === 'start') out.push(...src);
  return rich(normalizeRich(out));
}

function needDate(v: FValue | undefined): LitDate {
  assert(v?.type === 'date');
  return v.value;
}

function unitArg(v: FValue | undefined, fnName: string, api: LibApi) {
  const raw = plain(v, api);
  const u = normalizeUnit(raw);
  if (!u) {
    const shown = raw.endsWith('s') ? raw : raw + 's';
    throw new LibError('DateInvalidDurationUnit', `“${shown}” is not a supported time unit for ${fnName}().`, { invalidUnit: shown, functionName: fnName });
  }
  return u;
}

function mathFn(name: string, f: (x: number) => number): FnDef {
  return {
    name, category: 'number', params: [{ name: 'input', type: T.n }], returns: T.n,
    eval: ([a]) => {
      const v = V(a);
      assert(v?.type === 'number');
      return num(f(v.value));
    },
  };
}

/** Binary numeric functions where an empty side counts as 0 (TREAT_UNDEFINED_AS_ZERO_FNS). */
function binaryNum(name: string, f: (a: number, b: number) => FValue, undefinedAsZero: boolean): FnDef {
  return {
    name, category: 'number', params: [{ name: 'lhs', type: T.n }, { name: 'rhs', type: T.n }], returns: T.n,
    eval: ([a, b]) => {
      let x = V(a)!;
      let y = V(b)!;
      if (undefinedAsZero) {
        if (x.type === 'undefined' && y.type === 'undefined') return num(0);
        if (x.type === 'undefined' && y.type === 'number') x = num(0);
        else if (y.type === 'undefined' && x.type === 'number') y = num(0);
      }
      assert(x.type === 'number' && y.type === 'number');
      return f(x.value, y.value);
    },
  };
}

function extreme(args: Arg[], api: LibApi, pick: 'min' | 'max'): FValue {
  const flat = flattenDeep(args as FValue[]);
  if (!flat.length) return UNDEF;
  if (flat.every((v) => v.type === 'date')) {
    const ts = flat.map((v) => dateStartMs((v as { value: LitDate }).value, api.tz));
    const target = pick === 'min' ? Math.min(...ts) : Math.max(...ts);
    return flat[ts.indexOf(target)];
  }
  const ns = flat.flatMap((v) => (v.type === 'number' ? [v.value] : []));
  if (!ns.length) return UNDEF;
  return num(pick === 'min' ? Math.min(...ns) : Math.max(...ns));
}

function listArg(a: Arg | undefined): FValue[] {
  const v = V(a);
  assert(v?.type === 'array');
  return v.values;
}

const LIST_LAMBDA: Param = { name: 'expression', type: T.x };

const defs: FnDef[] = [
  // ------------------------------------------------------------- generic
  {
    name: 'if', category: 'generic', special: 'if',
    params: [{ name: 'condition', type: T.c }, { name: 'ifTrue', type: T.x }, { name: 'ifFalse', type: T.x }],
    returns: ([, a, b]) => unifyTypes(a, b),
  },
  {
    name: 'ifs', category: 'generic', special: 'ifs',
    params: [{ name: 'condition', type: T.c }, { name: 'ifTrue', type: T.x }], varargs: [{ name: 'rest', type: T.x }],
    returns: (e) => {
      if (e.length < 2) return T.u;
      const t = e[1];
      let r = 2;
      for (; r < e.length - 1; r += 2) if (!sameType(e[r + 1], t)) return T.u;
      if (r === e.length - 1 && !sameType(e[r], t)) return T.u;
      return t;
    },
  },
  { name: 'and', category: 'generic', params: [], varargs: [{ name: 'value', type: [T.u] }], returns: T.c, eval: (args) => bool((args as FValue[]).every(truthy)) },
  { name: 'or', category: 'generic', params: [], varargs: [{ name: 'value', type: [T.u] }], returns: T.c, eval: (args) => bool((args as FValue[]).some(truthy)) },
  { name: 'not', category: 'generic', params: [], varargs: [{ name: 'value', type: [T.u] }], returns: T.c, eval: ([a]) => bool(!truthy(V(a) ?? UNDEF)) },
  {
    name: 'empty', category: 'generic', params: [{ name: 'input', type: T.u, optional: true }],
    returns: (e) => (e.length === 0 ? T.undef : T.c),
    eval: (args) => {
      if (!args.length) return UNDEF;
      const v = V(args[0])!;
      return bool(v.type === 'array' ? v.values.length === 0 : !truthy(v));
    },
  },
  {
    name: 'length', category: 'generic', params: [{ name: 'input', type: [T.t, T.a(T.u)] }], returns: T.n,
    eval: ([a]) => {
      const v = V(a)!;
      if (v.type === 'array') return num(v.values.length);
      assert(v.type === 'text');
      return num(richLength(v.value));
    },
  },
  {
    name: 'format', category: 'generic', params: [{ name: 'input', type: T.u }], returns: T.t,
    eval: ([a], api) => text(plainText(toRich(V(a) ?? UNDEF), api.resolver)),
  },
  { name: 'equal', category: 'generic', params: [{ name: 'lhs', type: T.u }, { name: 'rhs', type: T.u }], returns: T.c, eval: ([a, b], api) => bool(valuesEqual(V(a)!, V(b)!, api.resolver)) },
  { name: 'unequal', category: 'generic', params: [{ name: 'lhs', type: T.u }, { name: 'rhs', type: T.u }], returns: T.c, eval: ([a, b], api) => bool(!valuesEqual(V(a)!, V(b)!, api.resolver)) },
  { name: 'let', category: 'generic', special: 'let', params: [], varargs: [{ name: 'args', type: T.x }], returns: (e) => e[2] ?? T.u },
  { name: 'lets', category: 'generic', special: 'lets', params: [], varargs: [{ name: 'args', type: T.x }], returns: (e) => e[e.length - 1] ?? T.u },

  // ------------------------------------------------------------- text
  {
    name: 'substring', category: 'text', params: [{ name: 'target', type: T.t }, { name: 'startIndex', type: T.n }, { name: 'endIndex', type: T.n, optional: true }], returns: T.t,
    eval: ([a, s, e], api) => {
      const v = V(a)!;
      const st = V(s)!;
      assert(v.type === 'text' && st.type === 'number');
      const en = V(e);
      return text(plainText(v.value, api.resolver).slice(st.value, en?.type === 'number' ? en.value : undefined));
    },
  },
  {
    name: 'contains', category: 'text', params: [{ name: 'input', type: T.t }, { name: 'search', type: T.t }], returns: T.c,
    eval: ([a, b], api) => bool(plain(V(a), api).includes(plain(V(b), api))),
  },
  {
    name: 'test', category: 'text', params: [{ name: 'input', type: T.t }, { name: 'pattern', type: T.t }], returns: T.c,
    eval: ([a, b], api) => bool(api.regex(plain(V(b), api)).test(plain(V(a), api))),
  },
  {
    name: 'match', category: 'text', params: [{ name: 'input', type: T.t }, { name: 'pattern', type: T.t }], returns: T.a(T.t),
    eval: ([a, b], api) => {
      const m = plain(V(a), api).match(api.regex(plain(V(b), api), 'g'));
      return list(m ? m.map((s) => text(s)) : []);
    },
  },
  {
    name: 'replace', category: 'text', params: [{ name: 'input', type: T.t }, { name: 'pattern', type: T.t }, { name: 'replacement', type: T.t, optional: true }], returns: T.t,
    eval: ([a, b, c], api) => text(plain(V(a), api).replace(api.regex(plain(V(b), api)), c ? plain(V(c), api) : '')),
  },
  {
    name: 'replaceAll', category: 'text', params: [{ name: 'input', type: T.t }, { name: 'pattern', type: T.t }, { name: 'replacement', type: T.t, optional: true }], returns: T.t,
    eval: ([a, b, c], api) => text(plain(V(a), api).replace(api.regex(plain(V(b), api), 'g'), c ? plain(V(c), api) : '')),
  },
  {
    name: 'lower', category: 'text', params: [{ name: 'text', type: T.t }], returns: T.t,
    eval: ([a]) => {
      const v = V(a)!;
      assert(v.type === 'text');
      return rich(mapRuns(v.value, (s, an) => (an.length ? [s.toLowerCase(), an] : [s.toLowerCase()])));
    },
  },
  {
    name: 'upper', category: 'text', params: [{ name: 'text', type: T.t }], returns: T.t,
    eval: ([a]) => {
      const v = V(a)!;
      assert(v.type === 'text');
      return rich(mapRuns(v.value, (s, an) => (an.length ? [s.toUpperCase(), an] : [s.toUpperCase()])));
    },
  },
  {
    name: 'trim', category: 'text', params: [{ name: 'text', type: T.t }], returns: T.t,
    eval: ([a]) => {
      const v = V(a)!;
      assert(v.type === 'text');
      return rich(trimRich(v.value));
    },
  },
  {
    name: 'repeat', category: 'text', params: [{ name: 'text', type: T.t }, { name: 'count', type: T.n }], returns: T.t,
    eval: ([a, c]) => {
      const v = V(a)!;
      const n = V(c)!;
      assert(v.type === 'text' && n.type === 'number');
      const out: RichText = [];
      const times = Math.min(n.value, 1e4);
      for (let i = 0; i < times; i++) out.push(...v.value);
      return rich(normalizeRich(out));
    },
  },
  {
    name: 'padStart', category: 'text', params: [{ name: 'text', type: T.t }, { name: 'targetLength', type: T.n }, { name: 'padString', type: T.t }], returns: T.t,
    eval: ([a, n, p], api) => {
      const v = V(a)!, l = V(n)!, s = V(p)!;
      assert(v.type === 'text' && l.type === 'number' && s.type === 'text');
      return padText(v.value, l.value, s.value, 'start', api);
    },
  },
  {
    name: 'padEnd', category: 'text', params: [{ name: 'text', type: T.t }, { name: 'targetLength', type: T.n }, { name: 'padString', type: T.t }], returns: T.t,
    eval: ([a, n, p], api) => {
      const v = V(a)!, l = V(n)!, s = V(p)!;
      assert(v.type === 'text' && l.type === 'number' && s.type === 'text');
      return padText(v.value, l.value, s.value, 'end', api);
    },
  },
  {
    name: 'link', category: 'text', params: [{ name: 'input', type: T.t }, { name: 'url', type: T.t }], returns: T.t,
    eval: ([a, u], api) => {
      const v = V(a)!;
      assert(v.type === 'text');
      const url = plain(V(u), api);
      return rich(mapRuns(v.value, (s, an) => [s, [...an.filter((x) => x[0] !== 'a'), ['a', url]]]));
    },
  },
  {
    name: 'style', category: 'text', params: [{ name: 'input', type: T.t }], varargs: [{ name: 'styles', type: T.t }], returns: T.t,
    eval: ([a, ...styles]) => {
      const v = V(a)!;
      assert(v.type === 'text');
      const add = parseStyles((styles as FValue[]).map((s) => (s.type === 'text' ? s.value : [])));
      return rich(mapRuns(v.value, (s, an) => (an.length || add.length ? [s, [...an, ...add]] : [s])));
    },
  },
  {
    name: 'unstyle', category: 'text', params: [{ name: 'input', type: T.t }], varargs: [{ name: 'styles', type: T.t, optional: true }], returns: T.t,
    eval: ([a, ...styles]) => {
      const v = V(a)!;
      assert(v.type === 'text');
      const removable = ['b', 'i', 's', '_', 'c', 'h'];
      const only = styles.length ? parseStyles((styles as FValue[]).map((s) => (s.type === 'text' ? s.value : []))) : undefined;
      return rich(mapRuns(v.value, (s, an) => {
        const keep = an.filter((x) => !removable.includes(x[0]) || !(only === undefined || only.some((o) => o[0] === x[0] && (o[1] === undefined || o[1] === x[1]))));
        return keep.length ? [s, keep] : [s];
      }));
    },
  },
  {
    name: 'concat', category: 'text', params: [], varargs: [{ name: 'arg', type: T.a(T.u) }],
    returns: (e) => {
      const t = e[0];
      if (!t) return T.a(T.u);
      for (let r = 1; r < e.length; r++) if (e[r] && !sameType(e[r], t)) return T.a(T.u);
      return t;
    },
    eval: (args) => list((args as FValue[]).flatMap((a) => {
      assert(a.type === 'array');
      return a.values.filter((x) => x.type !== 'undefined');
    })),
  },
  {
    name: 'join', category: 'text', params: [{ name: 'input', type: T.a(T.u) }, { name: 'joiner', type: T.t }], returns: T.t,
    eval: ([a, j]) => {
      const items = listArg(a);
      const sep = V(j)!;
      assert(sep.type === 'text');
      const out: RichText = [];
      items.forEach((v, i) => {
        if (i) out.push(...sep.value);
        out.push(...toRich(v));
      });
      return rich(normalizeRich(out));
    },
  },
  {
    name: 'split', category: 'text', params: [{ name: 'input', type: T.t }, { name: 'separator', type: T.t, optional: true }], returns: T.a(T.t),
    eval: ([a, s], api) => {
      const str = plain(V(a), api);
      if (str === '') return list([]);
      const sepV = V(s);
      const sep = sepV ? plain(sepV, api) : undefined;
      const ws = sep === ' ' || sepV === undefined;
      return list(str.split(ws ? /\s+/ : (sep as string)).filter((x) => !ws || x.length > 0).map((x) => text(x)));
    },
  },

  // ------------------------------------------------------------- number
  {
    name: 'formatNumber', category: 'number', params: [{ name: 'input', type: T.n }, { name: 'format', type: T.t, optional: true }, { name: 'precision', type: T.n, optional: true }], returns: T.t,
    eval: ([a, f, p], api) => {
      const v = V(a)!;
      assert(v.type === 'number');
      const fv = V(f);
      let fmt = 'number_with_commas';
      if (fv) {
        const raw = plain(fv, api);
        const r = resolveNumberFormat(raw);
        if (!r) throw new LibError('NumberFormatInvalid', `“${raw}” is not a supported number format.`, { invalidFormat: raw });
        fmt = r;
      }
      const pv = V(p);
      return text(formatNumberValue(v.value, fmt, pv?.type === 'number' ? pv.value : undefined));
    },
  },
  binaryNum('add', (a, b) => num(decAdd(a, b)), true),
  binaryNum('subtract', (a, b) => num(decSub(a, b)), true),
  binaryNum('multiply', (a, b) => num(decMul(a, b)), true),
  binaryNum('mod', (a, b) => (b === 0 ? UNDEF : num(decMod(a, b))), false),
  binaryNum('pow', (a, b) => num(a ** b), false),
  binaryNum('divide', (a, b) => (b === 0 ? UNDEF : num(decDiv(a, b))), false),
  { name: 'min', category: 'number', params: [], varargs: [{ name: 'value', type: [T.n, T.a(T.n)] }], returns: T.n, eval: (args, api) => extreme(args, api, 'min') },
  { name: 'max', category: 'number', params: [], varargs: [{ name: 'value', type: [T.n, T.a(T.n)] }], returns: T.n, eval: (args, api) => extreme(args, api, 'max') },
  {
    name: 'sum', category: 'number', params: [], varargs: [{ name: 'value', type: [T.n, T.a(T.n)] }], returns: T.n,
    eval: (args) => num(numbersOf(args as FValue[]).reduce((s, x) => decAdd(s, x), 0)),
  },
  {
    name: 'median', category: 'number', params: [], varargs: [{ name: 'value', type: [T.n, T.a(T.n)] }], returns: T.n,
    eval: (args) => {
      const ns = numbersOf(args as FValue[]).sort((a, b) => a - b);
      if (!ns.length) return UNDEF;
      if (ns.length % 2) return num(ns[Math.floor(ns.length / 2)]);
      return num(decDiv(decAdd(ns[ns.length / 2 - 1], ns[ns.length / 2]), 2));
    },
  },
  {
    name: 'mean', category: 'number', params: [], varargs: [{ name: 'value', type: [T.n, T.a(T.n)] }], returns: T.n,
    eval: (args) => {
      const ns = numbersOf(args as FValue[]);
      if (!ns.length) return UNDEF;
      return num(decDiv(ns.reduce((s, x) => decAdd(s, x), 0), ns.length));
    },
  },
  mathFn('abs', Math.abs),
  {
    name: 'round', category: 'number', params: [{ name: 'value', type: T.n }, { name: 'precision', type: T.n, optional: true }], returns: T.n,
    eval: ([a, p]) => {
      const v = V(a)!;
      assert(v.type === 'number');
      const pv = V(p);
      if (pv === undefined || (pv.type === 'number' && pv.value === 0)) return num(Math.round(v.value));
      assert(pv.type === 'number');
      if (!Number.isInteger(pv.value)) throw new LibError('CannotRoundToNonInteger', `Rounding precision must be a whole number, not ${pv.value}.`, { precision: pv.value });
      if (Math.abs(pv.value) > 12) throw new LibError('CannotRoundToTooManyDecimalPlaces', `Rounding supports at most 12 decimal places, not ${pv.value}.`, { precision: pv.value });
      const f = Math.pow(10, pv.value);
      return num(Math.round(v.value * f) / f);
    },
  },
  mathFn('ceil', Math.ceil),
  mathFn('floor', Math.floor),
  mathFn('sqrt', Math.sqrt),
  mathFn('cbrt', Math.cbrt),
  mathFn('exp', Math.exp),
  mathFn('ln', Math.log),
  mathFn('log10', Math.log10),
  mathFn('log2', Math.log2),
  mathFn('sign', Math.sign),
  { name: 'pi', category: 'number', params: [], returns: T.n, eval: () => num(Math.PI) },
  { name: 'e', category: 'number', params: [], returns: T.n, eval: () => num(Math.E) },
  {
    name: 'toNumber', category: 'number', params: [{ name: 'input', type: T.u }], returns: T.n,
    eval: ([a], api) => {
      const v = V(a)!;
      switch (v.type) {
        case 'number': return v;
        case 'checkbox': return num(v.value ? 1 : 0);
        case 'text': {
          const s = plainText(v.value, api.resolver);
          const n = /^0[xbo]/.test(s) ? Number(s) : parseFloat(s);
          return Number.isFinite(n) ? num(n) : UNDEF;
        }
        case 'date': return num(dateStartMs(v.value, api.tz));
        case 'array': throw new LibError('CannotUseToNumberOnList', 'toNumber cannot convert a list. Pick an item with first(), at(), or map() first.');
        default: return UNDEF;
      }
    },
  },

  // ------------------------------------------------------------- date
  { name: 'now', category: 'date', params: [], returns: T.d, eval: (_a, api) => ({ type: 'date', value: nowValue(api.tz, api.nowMs) }) },
  { name: 'today', category: 'date', params: [], returns: T.d, eval: (_a, api) => ({ type: 'date', value: todayValue(api.tz, api.nowMs) }) },
  ...(['minute', 'hour', 'day', 'date', 'week', 'month', 'year'] as const).map((name): FnDef => ({
    name, category: 'date', params: [{ name: 'date', type: T.d }], returns: T.n,
    eval: ([a], api) => num(datePart(needDate(V(a)), name === 'day' ? 'weekday' : name === 'date' ? 'day' : name, api.tz)),
  })),
  ...(['dateAdd', 'dateSubtract'] as const).map((name): FnDef => ({
    name, category: 'date', params: [{ name: 'input', type: T.d }, { name: 'num', type: T.n }, { name: 'unit', type: T.t }], returns: T.d,
    eval: ([a, n, u], api) => {
      const d = needDate(V(a));
      const amount = V(n)!;
      assert(amount.type === 'number');
      const unit = unitArg(V(u), name, api);
      return { type: 'date', value: addToDate(d, name === 'dateAdd' ? amount.value : -amount.value, unit, api.tz) };
    },
  })),
  {
    name: 'dateBetween', category: 'date', params: [{ name: 'left', type: T.d }, { name: 'right', type: T.d }, { name: 'unit', type: T.t }], returns: T.n,
    eval: ([a, b, u], api) => num(dateBetween(needDate(V(a)), needDate(V(b)), unitArg(V(u), 'dateBetween', api), api.tz)),
  },
  {
    name: 'dateRange', category: 'date', params: [{ name: 'start', type: T.d }, { name: 'end', type: T.d }], returns: T.d,
    eval: ([a, b], api) => ({ type: 'date', value: makeRange(needDate(V(a)), needDate(V(b)), api.tz) }),
  },
  { name: 'dateStart', category: 'date', params: [{ name: 'input', type: T.d }], returns: T.d, eval: ([a]) => ({ type: 'date', value: rangeStart(needDate(V(a))) }) },
  { name: 'dateEnd', category: 'date', params: [{ name: 'input', type: T.d }], returns: T.d, eval: ([a]) => ({ type: 'date', value: rangeEnd(needDate(V(a))) }) },
  { name: 'timestamp', category: 'date', params: [{ name: 'input', type: T.d }], returns: T.n, eval: ([a], api) => num(dateStartMs(needDate(V(a)), api.tz)) },
  {
    name: 'fromTimestamp', category: 'date', params: [{ name: 'input', type: T.n }], returns: T.d,
    eval: ([a], api) => {
      const v = V(a)!;
      assert(v.type === 'number');
      return { type: 'date', value: datetimeFromMs(v.value, api.tz) };
    },
  },
  {
    name: 'formatDate', category: 'date', params: [{ name: 'date', type: T.d }, { name: 'format', type: T.t }, { name: 'timezone', type: T.t, optional: true }], returns: T.t,
    eval: ([a, f, z], api) => {
      const d = needDate(V(a));
      const fmt = V(f);
      assert(fmt?.type === 'text');
      let zoneName = api.tz;
      const zv = V(z);
      if (zv?.type === 'text') {
        const raw = plain(zv, api);
        zoneName = raw.startsWith('GMT') && raw.length > 3 && /^GMT[+-]\d{1,2}$/.test(raw) ? `Etc/GMT${raw[3] === '-' ? '+' : '-'}${raw.slice(4)}` : raw;
      }
      const zone = parseZone(zoneName);
      if (!zone) throw new Error(`Invalid DateTime: unsupported zone "${zoneName}"`);
      let dt = dateInterval(rangeStart(d), zone.name).start;
      if (d.type === 'datetime' || d.type === 'datetimerange') dt = dt.setZone(zone);
      return text(formatMoment(dt, plain(fmt, api)));
    },
  },
  {
    name: 'parseDate', category: 'date', params: [{ name: 'dateString', type: T.t }], returns: T.d,
    eval: ([a], api) => {
      const d = parseISODate(plain(V(a), api), api.tz);
      return d ? { type: 'date', value: d } : UNDEF;
    },
  },

  // ------------------------------------------------------------- people
  {
    name: 'name', category: 'people', params: [{ name: 'person', type: T.p }], returns: T.t,
    eval: ([a], api) => {
      const v = V(a)!;
      assert(v.type === 'person');
      const u = api.userInfo(v.value.id);
      if (!u) throw new LibError('UserNotFound', `The referenced person “${v.value.id}” is unavailable.`, { personId: v.value.id });
      return text(u.name);
    },
  },
  {
    name: 'email', category: 'people', params: [{ name: 'person', type: T.p }], returns: T.t,
    eval: ([a], api) => {
      const v = V(a)!;
      assert(v.type === 'person');
      const u = api.userInfo(v.value.id);
      if (!u) throw new LibError('UserNotFound', `The referenced person “${v.value.id}” is unavailable.`, { personId: v.value.id });
      return u.email !== undefined ? text(u.email) : UNDEF;
    },
  },

  // ------------------------------------------------------------- list
  {
    name: 'at', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, { name: 'index', type: T.n }], returns: elemType,
    eval: ([a, i]) => {
      const vs = listArg(a);
      const idx = V(i)!;
      assert(idx.type === 'number');
      return vs.at(idx.value) ?? UNDEF;
    },
  },
  { name: 'first', category: 'list', params: [{ name: 'list', type: T.a(T.u) }], returns: elemType, eval: ([a]) => listArg(a)[0] ?? UNDEF },
  { name: 'last', category: 'list', params: [{ name: 'list', type: T.a(T.u) }], returns: elemType, eval: ([a]) => listArg(a).at(-1) ?? UNDEF },
  {
    name: 'slice', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, { name: 'startIndex', type: T.n }, { name: 'endIndex', type: T.n, optional: true }], returns: sameList,
    eval: ([a, s, e]) => {
      const vs = listArg(a);
      const st = V(s)!;
      assert(st.type === 'number');
      const en = V(e);
      return list(vs.slice(st.value, en?.type === 'number' ? en.value : undefined));
    },
  },
  {
    name: 'splice', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, { name: 'startIndex', type: T.n }, { name: 'deleteCount', type: T.n, optional: true }],
    varargs: [{ name: 'items', type: T.u }], returns: sameList,
    eval: ([a, s, c, ...items]) => {
      const vs = [...listArg(a)];
      const st = V(s)!;
      assert(st.type === 'number');
      const cnt = V(c);
      vs.splice(st.value, cnt?.type === 'number' ? cnt.value : 0, ...(items as FValue[]));
      return list(vs);
    },
  },
  {
    name: 'sort', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, { ...LIST_LAMBDA, optional: true }], returns: sameList,
    eval: ([a, fn], api) => {
      const vs = listArg(a).filter((v) => v.type !== 'undefined');
      if (!fn) return list([...vs].sort((x, y) => compareForSort(x, y, api.resolver)));
      const keys = vs.map((v, i) => L(fn)(v, i));
      const idx = vs.map((_, i) => i).sort((x, y) => compareForSort(keys[x], keys[y], api.resolver));
      return list(idx.map((i) => vs[i]));
    },
  },
  { name: 'reverse', category: 'list', params: [{ name: 'list', type: T.a(T.u) }], returns: sameList, eval: ([a]) => list([...listArg(a)].reverse()) },
  {
    name: 'unique', category: 'list', params: [{ name: 'list', type: T.a(T.u) }], returns: sameList,
    eval: ([a], api) => {
      const out: FValue[] = [];
      for (const v of listArg(a)) if (!out.some((u) => valuesEqual(u, v, api.resolver))) out.push(v);
      return list(out);
    },
  },
  {
    name: 'includes', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, { name: 'needle', type: T.u }], returns: T.c,
    eval: ([a, n], api) => bool(listArg(a).some((v) => valuesEqual(v, V(n)!, api.resolver))),
  },
  {
    name: 'find', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, LIST_LAMBDA], returns: elemType,
    eval: ([a, fn]) => {
      const vs = listArg(a);
      for (let i = 0; i < vs.length; i++) if (truthy(L(fn)(vs[i], i))) return vs[i];
      return UNDEF;
    },
  },
  {
    name: 'findIndex', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, LIST_LAMBDA], returns: T.n,
    eval: ([a, fn]) => {
      const vs = listArg(a);
      for (let i = 0; i < vs.length; i++) if (truthy(L(fn)(vs[i], i))) return num(i);
      return num(-1);
    },
  },
  {
    name: 'filter', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, LIST_LAMBDA], returns: ([a]) => (a?.type === 'array' ? a : T.u),
    eval: ([a, fn]) => list(listArg(a).filter((v, i) => truthy(L(fn)(v, i)))),
  },
  {
    name: 'some', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, LIST_LAMBDA], returns: T.c,
    eval: ([a, fn]) => bool(listArg(a).some((v, i) => truthy(L(fn)(v, i)))),
  },
  {
    name: 'every', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, LIST_LAMBDA], returns: T.c,
    eval: ([a, fn]) => bool(listArg(a).every((v, i) => truthy(L(fn)(v, i)))),
  },
  {
    name: 'map', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, LIST_LAMBDA], returns: ([, t]) => T.a(t ?? T.u),
    eval: ([a, fn]) => list(listArg(a).map((v, i) => L(fn)(v, i))),
  },
  {
    name: 'flat', category: 'list', params: [{ name: 'list', type: T.a(T.u) }],
    returns: ([a]) => (a?.type === 'array' ? T.a(a.of.type === 'array' ? a.of.of : a.of) : T.a(T.u)),
    eval: ([a]) => list(listArg(a).flatMap((v) => (v.type === 'array' ? v.values : [v]))),
  },
  {
    name: 'count', category: 'list', params: [{ name: 'list', type: T.a(T.u) }, { ...LIST_LAMBDA, optional: true }],
    returns: ([a]) => (a?.type === 'array' ? T.n : T.u),
    eval: ([a, fn]) => {
      const vs = listArg(a);
      if (!fn) return num(vs.length);
      return num(vs.filter((v, i) => truthy(L(fn)(v, i))).length);
    },
  },

  // ------------------------------------------------------------- special / internal
  {
    name: 'id', category: 'special', params: [{ name: 'value', type: [T.p, T.b], optional: true }], returns: T.t,
    eval: ([a], api) => {
      const v = V(a);
      if (!v) {
        if (!api.thisRowId) throw new LibError('TryingToGetIdWithoutThisRow', 'The current row is unavailable.');
        return text(api.thisRowId.replace(/-/g, ''));
      }
      assert(v.type === 'block' || v.type === 'person');
      return text(v.value.id.replace(/-/g, ''));
    },
  },
  {
    name: '_unsafeCastArray', category: 'internal', params: [{ name: 'arrayToConvert', type: T.a(T.u) }, { name: 'typeTemplate', type: T.a(T.u) }],
    returns: ([, t]) => t ?? T.u, eval: ([a]) => V(a)!,
  },
  { name: '_wait', category: 'internal', params: [{ name: 'length', type: T.n }, { name: 'result', type: T.u }], returns: T.u, eval: ([, r]) => V(r)! },
];

export const LIBRARY: Record<string, FnDef> = Object.fromEntries(defs.map((d) => [d.name, d]));

/** Functions in autocomplete order per category. */
export const MENU_ORDER: Record<Exclude<Category, 'internal'>, string[]> = {
  generic: ['if', 'ifs', 'and', 'or', 'not', 'empty', 'length', 'format', 'equal', 'unequal', 'let', 'lets'],
  text: ['substring', 'contains', 'test', 'match', 'replace', 'replaceAll', 'lower', 'upper', 'trim', 'repeat', 'padStart', 'padEnd', 'link', 'style', 'unstyle', 'concat', 'join', 'split'],
  number: ['formatNumber', 'add', 'subtract', 'multiply', 'mod', 'pow', 'divide', 'min', 'max', 'sum', 'median', 'mean', 'abs', 'round', 'ceil', 'floor', 'sqrt', 'cbrt', 'exp', 'ln', 'log10', 'log2', 'sign', 'pi', 'e', 'toNumber'],
  date: ['now', 'today', 'minute', 'hour', 'day', 'date', 'week', 'month', 'year', 'dateAdd', 'dateSubtract', 'dateBetween', 'dateRange', 'dateStart', 'dateEnd', 'timestamp', 'fromTimestamp', 'formatDate', 'parseDate'],
  people: ['name', 'email'],
  list: ['at', 'first', 'last', 'slice', 'splice', 'sort', 'reverse', 'unique', 'includes', 'find', 'findIndex', 'filter', 'some', 'every', 'map', 'flat', 'count'],
  special: ['id'],
};

/** Functions where empty arguments become 0 / non-number args are tolerated. */
export const TREAT_UNDEFINED_AS_ZERO_FNS = ['add', 'subtract', 'multiply', 'divide', 'sum'];
export const FLATTENS_NUMBER_ARRAY_FNS = ['min', 'max', 'mean', 'median'];

/** Parameter definition for argument position `i`. */
export function paramAt(fn: FnDef, i: number): Param | undefined {
  if (i < fn.params.length) return fn.params[i];
  if (!fn.varargs?.length) return undefined;
  return fn.varargs[(i - fn.params.length) % fn.varargs.length];
}

export function requiredArgs(fn: FnDef): number {
  return fn.params.filter((p) => !p.optional).length;
}

export function isLambdaParam(p: Param | undefined): boolean {
  return !!p && !Array.isArray(p.type) && p.type.type === 'expression';
}

/** Result of typeof check used by argument coercion. */
export function valueMatches(v: FValue, t: TypeSpec | TypeSpec[]): boolean {
  if (Array.isArray(t)) return t.some((x) => valueMatches(v, x));
  switch (t.type) {
    case 'text': case 'number': case 'checkbox': case 'date': case 'person': return v.type === t.type;
    case 'array': return v.type === 'array' && v.values.every((x) => valueMatches(x, t.of));
    case 'unknown': case 'undefined': case 'expression': return true;
    case 'block': return v.type === 'block';
    default: return false;
  }
}

export function typeIncludes(t: TypeSpec | TypeSpec[], kind: TypeSpec['type']): boolean {
  return Array.isArray(t) ? t.some((x) => x.type === kind) : t.type === kind;
}

/** dateTime helpers re-exported for UI previews. */
export { DT, zoneOrSystem };
