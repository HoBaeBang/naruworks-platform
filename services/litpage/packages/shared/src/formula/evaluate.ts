// Formula 2.0 evaluator (tree-walking interpreter):
// operator semantics, argument coercion, lazy if/ifs, let/lets bindings, list lambdas (current/index),
// property values per type, nested formulas/rollups with cycle detection and the 15-level depth limit.
import type { BlockRecord, CollectionRecord, PropertySchema } from '../records.ts';
import type { Annotation, Decoration, RichText } from '../richtext.ts';
import { aggregate, aggregationValueType, type AggregationSpec } from '../relation/aggregate.ts';
import { datetimeFromMs, compareDates, zoneOrSystem, type LitDate } from './dates.ts';
import { decAdd, decDiv, decMod, decMul, decSub, roundTo } from './numbers.ts';
import { formulaSourceOf, SYSTEM_TOKEN_PROPERTIES } from './code.ts';
import { parse, type FormulaToken, type Node, type ParseError } from './parser.ts';
import {
  FLATTENS_NUMBER_ARRAY_FNS, LIBRARY, LibError, TREAT_UNDEFINED_AS_ZERO_FNS, isLambdaParam, paramAt, requiredArgs, typeIncludes, valueMatches,
  type Arg, type FnDef, type LibApi,
} from './library.ts';
import {
  UNDEF, bool, list, num, page, person, plainText, rich, text, toRich, truthy, valuesEqual, type FValue, type TextResolver,
} from './values.ts';

export interface UserLike {
  id: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
}

/** Record access the engine needs (the web client passes its record store; the server passes db lookups). */
export interface FormulaContext {
  getBlock(id: string): BlockRecord | undefined;
  getCollection(id: string): CollectionRecord | undefined;
  getUser?(id: string): UserLike | undefined;
  timeZone?: string;
  /** fixed "now" (ms) for deterministic previews/tests */
  now?: number;
  dateFormat?: string;
  timeFormat?: string;
  /** automation / button context tokens ({{lit:context:key}}): Trigger page, Time triggered, variables … */
  contextValue?(key: string): FValue | undefined;
}

export const FORMULA_MAX_DEPTH = 15;

export interface FormulaError {
  kind: 'parse' | 'eval';
  type: string;
  message: string;
  /** source offsets of the failing node/token (-1 = end) */
  start?: number;
  end?: number;
}

export class EvalError extends Error {
  type: string;
  start?: number;
  end?: number;
  fatal: boolean;
  constructor(type: string, message: string, node?: { start: number; end: number }, fatal = false) {
    super(message);
    this.type = type;
    this.start = node?.start;
    this.end = node?.end;
    this.fatal = fatal;
  }
}

interface Scope {
  name: string;
  value: FValue;
  next: Scope | null;
}

interface Shared {
  ctx: FormulaContext;
  tz: string;
  now: number;
  visited: Set<string>;
  cache: Map<string, FValue>;
  regex: Map<string, RegExp>;
  resolver: TextResolver;
}

interface Env {
  sh: Shared;
  scope: Scope | null;
  row?: BlockRecord;
  collectionId?: string;
  schema: Record<string, PropertySchema>;
  depth: number;
}

const astCache = new Map<string, { ast: Node | null; error?: ParseError }>();
export function parseCached(src: string) {
  let r = astCache.get(src);
  if (!r) {
    const p = parse(src);
    r = { ast: p.ast, error: p.error };
    if (astCache.size > 2000) astCache.clear();
    astCache.set(src, r);
  }
  return r;
}

function lookup(scope: Scope | null, name: string): FValue | undefined {
  for (let s = scope; s; s = s.next) if (s.name === name) return s.value;
  return undefined;
}

function bind(scope: Scope | null, name: string, value: FValue): Scope {
  return { name, value, next: scope };
}

export function userDisplayName(u: UserLike | undefined): string {
  if (!u) return '';
  return u.name || [u.given_name, u.family_name].filter(Boolean).join(' ') || u.email || '';
}

function makeResolver(ctx: FormulaContext, tz: string): TextResolver {
  return {
    timeZone: tz,
    dateFormat: ctx.dateFormat,
    timeFormat: ctx.timeFormat,
    pageTitle: (id) => plainText(ctx.getBlock(id)?.properties?.title as RichText | undefined) || 'Untitled',
    userName: (id) => userDisplayName(ctx.getUser?.(id)),
  };
}

function libApi(env: Env): LibApi {
  const sh = env.sh;
  return {
    tz: sh.tz,
    nowMs: sh.now,
    resolver: sh.resolver,
    thisRowId: env.row?.id,
    userInfo: (id) => {
      const u = sh.ctx.getUser?.(id);
      return u ? { name: userDisplayName(u), email: u.email } : undefined;
    },
    regex: (pattern, flags) => {
      const key = `${pattern}|${flags ?? ''}`;
      let re = sh.regex.get(key);
      if (!re) {
        re = new RegExp(pattern, flags);
        sh.regex.set(key, re);
      }
      re.lastIndex = 0;
      return re;
    },
  };
}

// ------------------------------------------------------------------ property values
function decoText(v: Decoration[] | undefined): string {
  if (!v) return '';
  return v.map((d) => d[0]).join('');
}

function annotationsIn(v: Decoration[] | undefined, key: string): Annotation[] {
  const out: Annotation[] = [];
  for (const d of v ?? []) for (const a of (d[1] as Annotation[] | undefined) ?? []) if (a[0] === key) out.push(a);
  return out;
}

/** Relation ids stored as [["‣",[["p",id,spaceId]]],[","],…] */
export function relationIdsOf(v: Decoration[] | undefined): string[] {
  const ids: string[] = [];
  for (const a of annotationsIn(v, 'p')) if (typeof a[1] === 'string' && !ids.includes(a[1])) ids.push(a[1]);
  return ids;
}

export function relationTargetsOf(block: BlockRecord, propId: string, ps: PropertySchema, ctx: FormulaContext): BlockRecord[] {
  const out: BlockRecord[] = [];
  for (const id of relationIdsOf(block.properties?.[propId] as Decoration[] | undefined)) {
    const b = ctx.getBlock(id);
    if (!b || b.alive === false || b.is_template) continue;
    out.push(b);
    if (typeof ps.limit === 'number' && ps.limit > 0 && out.length >= ps.limit) break;
  }
  return out;
}

function systemProperty(block: BlockRecord, prop: string, tz: string): FValue {
  switch (prop) {
    case 'title': {
      const t = block.properties?.title as RichText | undefined;
      return t && t.length ? rich(t) : UNDEF;
    }
    case 'created_by': return block.created_by_id ? person(block.created_by_id) : UNDEF;
    case 'last_edited_by': return block.last_edited_by_id ? person(block.last_edited_by_id) : UNDEF;
    case 'created_time': return block.created_time ? { type: 'date', value: datetimeFromMs(block.created_time, tz) } : UNDEF;
    case 'last_edited_time': return block.last_edited_time ? { type: 'date', value: datetimeFromMs(block.last_edited_time, tz) } : UNDEF;
    default: return UNDEF;
  }
}

function collectionOf(block: BlockRecord, ctx: FormulaContext): CollectionRecord | undefined {
  return block.parent_table === 'collection' ? ctx.getCollection(block.parent_id) : undefined;
}

function placeText(v: Decoration[] | undefined): string {
  for (const d of v ?? []) for (const a of (d[1] as any[]) ?? []) if (a?.[0] === 'plc' && a[1]) return a[1].name || a[1].address || '';
  return decoText(v);
}

function fileUrls(v: Decoration[] | undefined): FValue[] {
  const out: FValue[] = [];
  for (const d of v ?? []) {
    if (d[0] === ',') continue;
    const link = ((d[1] as Annotation[] | undefined) ?? []).find((a) => a[0] === 'a');
    out.push(text(link ? String(link[1]) : d[0]));
  }
  return out;
}

function multiSelectValues(raw: string, ps: PropertySchema): string[] {
  if (!raw) return [];
  const names = (ps.options ?? []).map((o) => o.value).sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let rest = raw;
  while (rest.length) {
    const hit = names.find((n) => rest === n || rest.startsWith(n + ','));
    if (hit) {
      out.push(hit);
      rest = rest.slice(hit.length + 1);
    } else {
      const i = rest.indexOf(',');
      out.push(i < 0 ? rest : rest.slice(0, i));
      rest = i < 0 ? '' : rest.slice(i + 1);
    }
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Property value as a formula value: one entry point for this-row tokens, member access and rollups. */
function propertyValue(block: BlockRecord, propId: string, env: Env, node?: Node): FValue {
  const ctx = env.sh.ctx;
  const col = collectionOf(block, ctx);
  const schema = col?.schema ?? (block.id === env.row?.id ? env.schema : undefined);
  const ps = schema?.[propId];
  if (!ps) {
    if (SYSTEM_TOKEN_PROPERTIES.includes(propId)) return systemProperty(block, propId, env.sh.tz);
    throw new EvalError('MissingSchemaPropertyOnThisRow', `This row does not have property “${propId}”.`, node);
  }
  const raw = block.properties?.[propId] as Decoration[] | undefined;
  const tz = env.sh.tz;
  switch (ps.type) {
    case 'title': case 'text': case 'url': case 'email':
      return raw && raw.length && decoText(raw) !== '' ? rich(raw as RichText) : UNDEF;
    case 'place': {
      const s = placeText(raw);
      return s ? text(s) : UNDEF;
    }
    case 'phone_number': {
      const s = decoText(raw);
      return s ? text(s) : UNDEF;
    }
    case 'select': case 'status': {
      const s = decoText(raw);
      return s ? text(s) : UNDEF;
    }
    case 'multi_select': return list(multiSelectValues(decoText(raw), ps).map((s) => text(s)));
    case 'checkbox': return bool(decoText(raw) === 'Yes');
    case 'number': {
      const s = decoText(raw).replace(/,/g, '');
      if (!s.trim()) return UNDEF;
      const n = Number(s);
      return Number.isFinite(n) ? num(n) : UNDEF;
    }
    case 'date': {
      const d = annotationsIn(raw, 'd')[0];
      return d ? { type: 'date', value: d[1] as unknown as LitDate } : UNDEF;
    }
    case 'person': {
      const ids = annotationsIn(raw, 'u').map((a) => String(a[1]));
      if (!ids.length && (ps as any).default === 'created_by' && block.created_by_id) return list([person(block.created_by_id)]);
      return list(ids.map((id) => person(id)));
    }
    case 'file': return list(fileUrls(raw));
    case 'relation': return list(relationTargetsOf(block, propId, ps, ctx).map((b) => page(b.id, b.space_id)));
    case 'auto_increment_id': {
      const s = decoText(raw);
      if (!s) return UNDEF;
      const prefix = (ps.prefix as string | undefined) ?? '';
      return text(prefix ? `${prefix}-${s}` : s);
    }
    case 'created_time': case 'last_edited_time': case 'created_by': case 'last_edited_by':
      return systemProperty(block, ps.type, tz);
    case 'formula': return nestedFormula(block, propId, ps, col, env, node);
    case 'rollup': return rollupValue(block, propId, ps, col, env, node).value;
    default: return UNDEF;
  }
}

function guard(block: BlockRecord, propId: string, env: Env, node?: Node): { key: string; env: Env } {
  const key = `${block.id}:${propId}`;
  if (env.sh.visited.has(key)) throw new EvalError('CycleDetected', 'This formula refers back to itself.', node, true);
  if (env.depth + 1 > FORMULA_MAX_DEPTH) throw new EvalError('DepthExceeded', 'This formula is nested too deeply.', node, true);
  return { key, env: { ...env, depth: env.depth + 1 } };
}

function nestedFormula(block: BlockRecord, propId: string, ps: PropertySchema, col: CollectionRecord | undefined, env: Env, node?: Node): FValue {
  const cached = env.sh.cache.get(`${block.id}:${propId}`);
  if (cached) return cached;
  const g = guard(block, propId, env, node);
  const src = formulaSourceOf(ps);
  if (!src.trim()) return UNDEF;
  const { ast, error } = parseCached(src);
  if (error || !ast) throw new EvalError('DownstreamParseFailure', 'A referenced formula could not be parsed.', node);
  env.sh.visited.add(g.key);
  try {
    const inner: Env = { sh: env.sh, scope: null, row: block, collectionId: col?.id ?? env.collectionId, schema: col?.schema ?? env.schema, depth: g.env.depth };
    const v = ev(ast, inner);
    env.sh.cache.set(g.key, v);
    return v;
  } finally {
    env.sh.visited.delete(g.key);
  }
}

export interface RollupEvaluation {
  value: FValue;
  percent?: boolean;
  aggregation: string;
  /** schema of the rolled-up target property (for rendering chips/colors) */
  targetSchema?: PropertySchema;
  targetCollection?: CollectionRecord;
}

function rollupValue(block: BlockRecord, propId: string, ps: PropertySchema, col: CollectionRecord | undefined, env: Env, node?: Node): RollupEvaluation {
  const ctx = env.sh.ctx;
  const schema = col?.schema ?? env.schema;
  const relId = ps.relation_property as string | undefined;
  const targetProp = ps.target_property as string | undefined;
  const spec = ps.aggregation as AggregationSpec | undefined;
  const aggName = typeof spec === 'string' ? spec : spec?.operator ?? 'show_original';
  const relSchema = relId ? schema?.[relId] : undefined;
  if (!relId || !relSchema || relSchema.type !== 'relation' || !targetProp) return { value: UNDEF, aggregation: aggName };
  const targetCol = relSchema.collection_id ? ctx.getCollection(relSchema.collection_id as string) : undefined;
  const targetSchema = targetCol?.schema?.[targetProp] ?? (SYSTEM_TOKEN_PROPERTIES.includes(targetProp) ? ({ name: targetProp, type: targetProp === 'title' ? 'title' : (targetProp as PropertySchema['type']) } as PropertySchema) : undefined);
  const g = guard(block, propId, env, node);
  env.sh.visited.add(g.key);
  try {
    const targets = relationTargetsOf(block, relId, relSchema, ctx);
    const values = targets.map((t) => {
      try {
        return propertyValue(t, targetProp, g.env, node);
      } catch (e) {
        if (e instanceof EvalError && e.fatal) throw e;
        return UNDEF;
      }
    });
    const statusGroups = targetSchema?.type === 'status' ? targetSchema.groups ?? [] : [];
    const res = aggregate(values, spec ?? 'show_original', {
      resolver: env.sh.resolver,
      statusGroupOf: (name) => {
        const opt = targetSchema?.options?.find((o) => o.value === name);
        return statusGroups.find((gr) => opt && gr.optionIds.includes(opt.id))?.name;
      },
    });
    return { value: res.value, percent: res.percent, aggregation: aggName, targetSchema, targetCollection: targetCol };
  } finally {
    env.sh.visited.delete(g.key);
  }
}

// ------------------------------------------------------------------ evaluation
function typeLabel(v: FValue): string {
  return v.type;
}

function evalToken(tok: FormulaToken, env: Env, node: Node): FValue {
  switch (tok.type) {
    case 'block_property': {
      const row = env.row;
      if (!row) throw new EvalError('MissingThisRow', 'The current row is unavailable.', node);
      if (tok.collection && env.collectionId && tok.collection.id !== env.collectionId) {
        throw new EvalError('ThisRowBlockPropertyMismatchCollection', 'This property belongs to another database.', node);
      }
      if (!tok.collection && SYSTEM_TOKEN_PROPERTIES.includes(tok.property)) return systemProperty(row, tok.property, env.sh.tz);
      return propertyValue(row, tok.property, env, node);
    }
    case 'block': return page(tok.blockId, tok.spaceId);
    case 'person': return person(tok.userId);
    case 'checkbox': return bool(tok.checked);
    case 'date': return { type: 'date', value: tok.date };
    case 'context': {
      const v = env.sh.ctx.contextValue?.(tok.key);
      if (!v) throw new EvalError('MissingContextValue', 'Cannot find this value.', node);
      return v;
    }
  }
}

function mathCheck(v: FValue, op: string, node: Node) {
  if (v.type !== 'number' && v.type !== 'undefined') throw new EvalError('CannotDoMathOnType', `Math does not support type “${typeLabel(v)}”.`, node);
  void op;
}

function binary(node: Node & { kind: 'binary' }, env: Env): FValue {
  let a = ev(node.lhs, env);
  let b = ev(node.rhs, env);
  switch (node.op) {
    case '+': case '-': {
      if (a.type === 'undefined' && b.type === 'undefined') return num(0);
      if (a.type === 'undefined' && b.type === 'number') a = num(0);
      else if (b.type === 'undefined' && a.type === 'number') b = num(0);
      if (node.op === '+') {
        if (a.type === 'number' && b.type === 'number') return num(decAdd(a.value, b.value));
        return rich([...toRich(a), ...toRich(b)]);
      }
      mathCheck(a, '-', node.lhs);
      mathCheck(b, '-', node.rhs);
      return a.type === 'number' && b.type === 'number' ? num(decSub(a.value, b.value)) : UNDEF;
    }
    case '*': case '/': case '%': {
      mathCheck(a, node.op, node.lhs);
      mathCheck(b, node.op, node.rhs);
      if (a.type === 'undefined' && b.type === 'undefined') return num(0);
      if (a.type === 'undefined') a = num(0);
      if (b.type === 'undefined') b = num(0);
      const x = (a as { value: number }).value;
      const y = (b as { value: number }).value;
      if (node.op === '*') return num(decMul(x, y));
      if (y === 0) return UNDEF;
      return node.op === '/' ? num(decDiv(x, y)) : num(decMod(x, y));
    }
    case '^': {
      mathCheck(a, '^', node.lhs);
      mathCheck(b, '^', node.rhs);
      if (a.type === 'number' && b.type === 'number') return num(a.value ** b.value);
      return UNDEF;
    }
    case '==': return bool(valuesEqual(a, b, env.sh.resolver));
    case '!=': return bool(!valuesEqual(a, b, env.sh.resolver));
    default: {
      if (a.type === 'undefined' || b.type === 'undefined') return bool(false);
      let c: number;
      if (a.type === 'date' && b.type === 'date') c = compareDates(a.value, b.value, env.sh.tz);
      else if (a.type === 'text' && b.type === 'text') {
        const x = plainText(a.value, env.sh.resolver);
        const y = plainText(b.value, env.sh.resolver);
        c = x < y ? -1 : x > y ? 1 : 0;
      } else if ((a.type === 'number' && b.type === 'number') || (a.type === 'checkbox' && b.type === 'checkbox')) {
        const x = Number(a.value);
        const y = Number(b.value);
        c = x < y ? -1 : x > y ? 1 : 0;
      } else throw new EvalError('CannotRelativelyCompareTypes', `Values of type “${a.type}” and “${b.type}” cannot be compared.`, node);
      switch (node.op) {
        case '<': return bool(c < 0);
        case '<=': return bool(c <= 0);
        case '>': return bool(c > 0);
        default: return bool(c >= 0);
      }
    }
  }
}

function lambdaOf(node: Node, env: Env): (current: FValue, index: number) => FValue {
  return (current, index) => {
    const scope = bind(bind(env.scope, 'current', current), 'index', num(index));
    try {
      return ev(node, { ...env, scope });
    } catch (e) {
      if (e instanceof EvalError && e.fatal) throw e;
      return UNDEF;
    }
  };
}

function calleeTypeOf(n: Node): string {
  switch (n.kind) {
    case 'boolean': case 'and': case 'or': return 'checkbox';
    case 'number': return 'number';
    case 'string': return 'text';
    case 'array': return 'array';
    case 'binary': return ['==', '!=', '<', '<=', '>', '>='].includes(n.op) ? 'checkbox' : 'number';
    case 'unary': return n.op === '-' ? 'number' : 'checkbox';
    default: return 'undefined';
  }
}

function coerceArg(v: FValue, fn: FnDef, i: number, node: Node): FValue {
  const p = paramAt(fn, i);
  if (!p || valueMatches(v, p.type)) return v;
  if (typeIncludes(p.type, 'checkbox')) return bool(truthy(v));
  if (typeIncludes(p.type, 'text')) {
    if (v.type === 'array' && typeIncludes(p.type, 'array')) return list(v.values.map((x) => rich(toRich(x))));
    if (v.type === 'array' && v.values.length === 0) return text('');
    return rich(toRich(v));
  }
  if (!TREAT_UNDEFINED_AS_ZERO_FNS.includes(fn.name) && !FLATTENS_NUMBER_ARRAY_FNS.includes(fn.name)) {
    throw new EvalError('FunctionCallArgumentWrongType', `Function “${fn.name}” received type “${v.type}”.`, node);
  }
  return v;
}

function propByName(target: FValue, nameNode: Node | undefined, env: Env, node: Node): FValue {
  if (!nameNode || nameNode.kind !== 'string') throw new EvalError('FunctionCallArgumentWrongType', 'Called “prop” with wrong argument type.', node);
  const name = nameNode.text;
  if (target.type === 'undefined') return UNDEF;
  if (target.type !== 'block') throw new EvalError('AccessingPropertyOnNonBlock', 'The value is not a page or block.', node);
  const block = env.sh.ctx.getBlock(target.value.id);
  if (!block) throw new EvalError('MissingDataDependencyBlock', `The referenced block “${target.value.id}” is unavailable.`, node);
  const col = collectionOf(block, env.sh.ctx);
  const schema = col?.schema ?? (block.id === env.row?.id ? env.schema : {});
  const id = Object.keys(schema).find((k) => schema[k]?.name === name);
  if (!id) throw new EvalError('MissingPropertyOnSchemaForMemberProperty', `The database has no property named “${name}”.`, node);
  return propertyValue(block, id, env, node);
}

function evalCall(node: Node & { kind: 'call' }, env: Env): FValue {
  const callee = node.callee;
  let name: string;
  let argNodes: Node[];
  if (callee.kind === 'identifier') {
    if (callee.name === 'prop' && !lookup(env.scope, 'prop')) {
      if (!env.row) throw new EvalError('MissingThisRow', 'The current row is unavailable.', node);
      const nameNode = node.args[0];
      if (!nameNode || nameNode.kind !== 'string') throw new EvalError('FunctionCallArgumentWrongType', 'Called “prop” with wrong argument type.', node);
      const id = Object.keys(env.schema).find((k) => env.schema[k]?.name === nameNode.text);
      if (!id) throw new EvalError('InvalidPropCall', `${nameNode.text} is not a property in this database.`, nameNode);
      return propertyValue(env.row, id, env, node);
    }
    if (!Object.hasOwn(LIBRARY, callee.name)) throw new EvalError('IdentifierNotFound', `No function or variable named “${callee.name}” exists.`, callee);
    name = callee.name;
    argNodes = node.args;
  } else if (callee.kind === 'method') {
    if (callee.name === 'prop') return propByName(ev(callee.target, env), node.args[0], env, node);
    if (!Object.hasOwn(LIBRARY, callee.name)) throw new EvalError('UnifiedFunctionPropertyNotFound', `The function ${callee.name}() does not exist.`, { start: callee.nameStart, end: callee.nameEnd });
    name = callee.name;
    argNodes = [callee.target, ...node.args];
  } else {
    throw new EvalError('CannotCallNonFunction', `Values of type “${calleeTypeOf(callee)}” cannot be called.`, node);
  }
  const fn = LIBRARY[name];
  if (fn.special === 'if' || fn.special === 'ifs') {
    const min = fn.special === 'if' ? 3 : 2;
    if (argNodes.length < min) throw new EvalError('FunctionCallTooFewArguments', `Function “${name}” needs more arguments.`, node);
    if (fn.special === 'if' && argNodes.length !== 3) throw new EvalError('FunctionCallUnexpectedArgument', `Function “${name}” received an extra argument.`, node);
    for (let i = 0; i + 1 < argNodes.length; i += 2) {
      if (truthy(ev(argNodes[i], env))) return ev(argNodes[i + 1], env);
    }
    return argNodes.length % 2 === 1 ? ev(argNodes[argNodes.length - 1], env) : UNDEF;
  }
  if (fn.special === 'let' || fn.special === 'lets') {
    if (argNodes.length < 3 || argNodes.length % 2 !== 1 || (fn.special === 'let' && argNodes.length !== 3)) {
      throw new EvalError('FunctionCallTooFewArguments', `Function “${name}” needs more arguments.`, node);
    }
    let scope = env.scope;
    for (let i = 0; i < argNodes.length - 1; i += 2) {
      const n = argNodes[i];
      if (n.kind !== 'identifier') throw new EvalError('LetBindingNameNotIdentifier', 'Expected identifier.', n);
      let v: FValue;
      try {
        v = ev(argNodes[i + 1], { ...env, scope });
      } catch (e) {
        if (e instanceof EvalError && e.fatal) throw e;
        v = UNDEF;
      }
      scope = bind(scope, n.name, v);
    }
    return ev(argNodes[argNodes.length - 1], { ...env, scope });
  }
  if (argNodes.length < requiredArgs(fn)) throw new EvalError('FunctionCallTooFewArguments', `Function “${name}” needs more arguments.`, node);
  const args: Arg[] = argNodes.map((n, i) => {
    const p = paramAt(fn, i);
    if (!p) throw new EvalError('FunctionCallUnexpectedArgument', `Function “${name}” received an extra argument.`, n);
    if (isLambdaParam(p)) return lambdaOf(n, env);
    return coerceArg(ev(n, env), fn, i, n);
  });
  try {
    return fn.eval!(args, libApi(env));
  } catch (e) {
    if (e instanceof EvalError) throw e;
    if (e instanceof LibError) throw new EvalError(e.type, e.message, node);
    throw new EvalError('LibraryFunctionExecutionError', `Function “${name}” failed while running.`, node);
  }
}

function ev(node: Node, env: Env): FValue {
  switch (node.kind) {
    case 'number': return num(parseFloat(node.text));
    case 'string': return text(node.text);
    case 'boolean': return bool(node.value);
    case 'token': return evalToken(node.token, env, node);
    case 'identifier': {
      const b = lookup(env.scope, node.name);
      if (b) return b;
      if (Object.hasOwn(LIBRARY, node.name)) return { type: 'function', name: node.name };
      throw new EvalError('IdentifierNotFound', `“${node.name}” is not defined in this formula.`, node);
    }
    case 'array': return list(node.elements.map((e) => ev(e, env)));
    case 'unary': {
      const v = ev(node.expression, env);
      if (node.op === '-') {
        if (v.type !== 'number') throw new EvalError('UnaryMinusOnNonNumber', `Cannot negate a ${v.type} value.`, node.expression);
        return num(-v.value);
      }
      return bool(!truthy(v));
    }
    case 'binary': return binary(node, env);
    case 'and': {
      const vs = node.elements.map((e) => ev(e, env));
      return bool(vs.every(truthy));
    }
    case 'or': {
      const vs = node.elements.map((e) => ev(e, env));
      return bool(vs.some(truthy));
    }
    case 'conditional': return truthy(ev(node.condition, env)) ? ev(node.ifTrue, env) : ev(node.ifFalse, env);
    case 'call': return evalCall(node, env);
    case 'method':
      // lenient: `x.length` behaves like `x.length()` (help examples use this form)
      return evalCall({ kind: 'call', callee: node, args: [], lParen: node.end, rParen: node.end, commas: [], start: node.start, end: node.end }, env);
    case 'member': {
      const target = ev(node.target, env);
      if (target.type === 'undefined') return UNDEF;
      if (target.type !== 'block') throw new EvalError('AccessingPropertyOnNonBlock', 'The value is not a page or block.', node);
      const block = env.sh.ctx.getBlock(target.value.id);
      if (!block) throw new EvalError('MissingDataDependencyBlock', `The referenced block “${target.value.id}” is unavailable.`, node);
      if (!node.token.collection) return systemProperty(block, node.token.property, env.sh.tz);
      if (block.parent_table !== 'collection' || block.parent_id !== node.token.collection.id) {
        throw new EvalError('MemberPropertyMismatchCollection', 'This property belongs to a different database.', node);
      }
      return propertyValue(block, node.token.property, env, node);
    }
  }
}

/** Round final numbers to 12 decimals. */
function finalize(v: FValue): FValue {
  if (v.type === 'number') return num(roundTo(v.value, 12));
  if (v.type === 'array') return list(v.values.map((x) => (x.type === 'number' ? num(roundTo(x.value, 12)) : x)));
  return v;
}

export interface EvalOptions {
  /** collection the row/schema belong to (inferred from row.parent_id when omitted) */
  collectionId?: string;
}

export interface EvalResult {
  value: FValue;
  error?: FormulaError;
}

function newShared(ctx: FormulaContext): Shared {
  const tz = zoneOrSystem(ctx.timeZone).name;
  return { ctx, tz, now: ctx.now ?? Date.now(), visited: new Set(), cache: new Map(), regex: new Map(), resolver: makeResolver(ctx, tz) };
}

/** Evaluate an engine source string for a row. Errors are returned (value = empty), never thrown. */
export function evaluateSource(src: string, row: BlockRecord | null | undefined, schema: Record<string, PropertySchema>, ctx: FormulaContext, opts?: EvalOptions): EvalResult {
  const { ast, error } = parseCached(src);
  if (error) return { value: UNDEF, error: { kind: 'parse', type: error.type, message: error.message, start: error.offset, end: error.offset } };
  if (!ast) return { value: UNDEF };
  const sh = newShared(ctx);
  const collectionId = opts?.collectionId ?? (row?.parent_table === 'collection' ? row.parent_id : undefined);
  try {
    return { value: finalize(ev(ast, { sh, scope: null, row: row ?? undefined, collectionId, schema, depth: 0 })) };
  } catch (e) {
    if (e instanceof EvalError) return { value: UNDEF, error: { kind: 'eval', type: e.type, message: e.message, start: e.start, end: e.end } };
    return { value: UNDEF, error: { kind: 'eval', type: 'UnexpectedError', message: 'Unexpected error.' } };
  }
}

/** Value of any property of a row as a formula value (used by views/charts/rollups). */
export function propertyFValue(row: BlockRecord, propId: string, ctx: FormulaContext): FValue {
  const col = collectionOf(row, ctx);
  const sh = newShared(ctx);
  try {
    return finalize(propertyValue(row, propId, { sh, scope: null, row, collectionId: col?.id, schema: col?.schema ?? {}, depth: 0 }));
  } catch {
    return UNDEF;
  }
}

/** Rollup evaluation with metadata (aggregation, percent flag, target schema) for rendering. */
export function evaluateRollupWith(row: BlockRecord, propId: string, ctx: FormulaContext, schemaOverride?: Record<string, PropertySchema>): RollupEvaluation {
  const col = collectionOf(row, ctx);
  const schema = schemaOverride ?? col?.schema ?? {};
  const ps = schema[propId];
  if (!ps || ps.type !== 'rollup') return { value: UNDEF, aggregation: 'show_original' };
  const sh = newShared(ctx);
  try {
    const r = rollupValue(row, propId, ps, col, { sh, scope: null, row, collectionId: col?.id, schema, depth: 0 }, undefined);
    return { ...r, value: finalize(r.value) };
  } catch {
    return { value: UNDEF, aggregation: typeof ps.aggregation === 'string' ? ps.aggregation : 'show_original' };
  }
}

export { aggregationValueType };
