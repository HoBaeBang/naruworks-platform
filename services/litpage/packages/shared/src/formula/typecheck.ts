// Static result-type inference for formulas (the "Type: number" badge in the editor and `formula2.result_type`).
// Mirrors Litpage's typechecker rules for literals, operators, property tokens and library return types.
import type { CollectionRecord, PropertySchema } from '../records.ts';
import { formulaSourceOf, SYSTEM_TOKEN_PROPERTIES } from './code.ts';
import { LIBRARY, T, isLambdaParam, paramAt, unifyTypes, type TypeSpec } from './library.ts';
import { parse, type Node } from './parser.ts';

/** Block types may carry the collection id so member property tokens can be typed. */
export type FormulaType = TypeSpec & { collection?: string };

export interface TypeEnv {
  schema: Record<string, PropertySchema>;
  collectionId?: string;
  getCollection?(id: string): CollectionRecord | undefined;
  /** type of an automation context token ({{lit:context:key}}) */
  contextType?(key: string): FormulaType | undefined;
}

interface Scope {
  name: string;
  type: FormulaType;
  next: Scope | null;
}

interface Ctx {
  env: TypeEnv;
  schema: Record<string, PropertySchema>;
  scope: Scope | null;
  visiting: Set<string>;
  depth: number;
}

function find(scope: Scope | null, name: string): FormulaType | undefined {
  for (let s = scope; s; s = s.next) if (s.name === name) return s.type;
  return undefined;
}

function elem(t: FormulaType | undefined): FormulaType {
  return t?.type === 'array' ? (t.of as FormulaType) : T.u;
}

/** Formula type of a property. */
export function propertyFormulaType(ps: PropertySchema | undefined, env: TypeEnv, visiting = new Set<string>(), depth = 0): FormulaType {
  if (!ps) return T.u;
  switch (ps.type) {
    case 'title': case 'text': case 'url': case 'email': case 'phone_number': case 'place': case 'select': case 'status': case 'auto_increment_id': return T.t;
    case 'multi_select': case 'file': return T.a(T.t);
    case 'checkbox': return T.c;
    case 'number': return T.n;
    case 'date': case 'created_time': case 'last_edited_time': return T.d;
    case 'person': return T.a(T.p);
    case 'created_by': case 'last_edited_by': return T.p;
    case 'relation': return T.a({ type: 'block', collection: ps.collection_id as string | undefined } as FormulaType);
    case 'formula': {
      const stored = (ps as any).formula2?.result_type as FormulaType | undefined;
      const key = JSON.stringify(ps.formula2 ?? ps.formula ?? '');
      if (depth > 15 || visiting.has(key)) return stored ?? T.u;
      const src = formulaSourceOf(ps);
      if (!src.trim()) return stored ?? T.u;
      visiting.add(key);
      try {
        return inferSource(src, env, visiting, depth + 1);
      } finally {
        visiting.delete(key);
      }
    }
    case 'rollup': {
      const spec = ps.aggregation as string | { operator: string } | undefined;
      const agg = typeof spec === 'string' ? spec : spec?.operator ?? 'show_original';
      if (agg === 'earliest_date' || agg === 'latest_date') return T.d;
      if (agg === 'date_range') return T.t;
      if (agg !== 'show_original' && agg !== 'show_unique') return T.n;
      const rel = ps.relation_property ? env.schema[ps.relation_property as string] : undefined;
      const target = rel?.collection_id ? env.getCollection?.(rel.collection_id as string) : undefined;
      const tps = target?.schema?.[ps.target_property as string];
      if (!tps) return T.a(T.u);
      const inner = propertyFormulaType(tps, { ...env, schema: target!.schema, collectionId: target!.id }, visiting, depth + 1);
      return T.a(inner.type === 'array' ? (inner.of as FormulaType) : inner);
    }
    default: return T.u;
  }
}

function infer(node: Node, c: Ctx): FormulaType {
  switch (node.kind) {
    case 'number': return T.n;
    case 'string': return T.t;
    case 'boolean': return T.c;
    case 'token': {
      const t = node.token;
      if (t.type === 'block_property') {
        if (!t.collection && SYSTEM_TOKEN_PROPERTIES.includes(t.property)) return t.property === 'title' ? T.t : t.property.endsWith('_by') ? T.p : T.d;
        return propertyFormulaType(c.schema[t.property], { ...c.env, schema: c.schema }, c.visiting, c.depth);
      }
      if (t.type === 'block') return T.b;
      if (t.type === 'person') return T.p;
      if (t.type === 'checkbox') return T.c;
      if (t.type === 'context') return c.env.contextType?.(t.key) ?? T.u;
      return T.d;
    }
    case 'identifier': return find(c.scope, node.name) ?? (LIBRARY[node.name] ? { type: 'function' } : T.u);
    case 'array': {
      if (!node.elements.length) return T.a(T.u);
      const ts = node.elements.map((e) => infer(e, c));
      return T.a(ts.every((t) => JSON.stringify(t) === JSON.stringify(ts[0])) ? ts[0] : T.u);
    }
    case 'unary': return node.op === '-' ? T.n : T.c;
    case 'binary': {
      if (['==', '!=', '<', '<=', '>', '>='].includes(node.op)) return T.c;
      if (node.op !== '+') return T.n;
      const a = infer(node.lhs, c);
      const b = infer(node.rhs, c);
      const numeric = (t: FormulaType) => t.type === 'number' || t.type === 'undefined';
      if (numeric(a) && numeric(b)) return T.n;
      if (a.type === 'unknown' || b.type === 'unknown') return T.u;
      return T.t;
    }
    case 'and': case 'or': return T.c;
    case 'conditional': return unifyTypes(infer(node.ifTrue, c), infer(node.ifFalse, c));
    case 'member': {
      const tt = infer(node.target, c);
      const colId = (tt as FormulaType).collection ?? node.token.collection?.id;
      if (!node.token.collection && SYSTEM_TOKEN_PROPERTIES.includes(node.token.property)) return node.token.property === 'title' ? T.t : node.token.property.endsWith('_by') ? T.p : T.d;
      const col = colId ? c.env.getCollection?.(colId) : undefined;
      return col ? propertyFormulaType(col.schema[node.token.property], { ...c.env, schema: col.schema, collectionId: col.id }, c.visiting, c.depth + 1) : T.u;
    }
    case 'method': return inferCall(node.name, [node.target], c, true);
    case 'call': {
      if (node.callee.kind === 'identifier') {
        if (node.callee.name === 'prop' && node.args[0]?.kind === 'string') {
          const name = node.args[0].text;
          const id = Object.keys(c.schema).find((k) => c.schema[k]?.name === name);
          return id ? propertyFormulaType(c.schema[id], { ...c.env, schema: c.schema }, c.visiting, c.depth) : T.u;
        }
        return inferCall(node.callee.name, node.args, c, false);
      }
      if (node.callee.kind === 'method') {
        if (node.callee.name === 'prop' && node.args[0]?.kind === 'string') {
          const tt = infer(node.callee.target, c);
          const col = (tt as FormulaType).collection ? c.env.getCollection?.((tt as FormulaType).collection!) : undefined;
          const name = node.args[0].text;
          const id = col ? Object.keys(col.schema).find((k) => col.schema[k]?.name === name) : undefined;
          return col && id ? propertyFormulaType(col.schema[id], { ...c.env, schema: col.schema, collectionId: col.id }, c.visiting, c.depth + 1) : T.u;
        }
        return inferCall(node.callee.name, [node.callee.target, ...node.args], c, true);
      }
      return T.u;
    }
  }
}

function inferCall(name: string, args: Node[], c: Ctx, _method: boolean): FormulaType {
  const fn = LIBRARY[name];
  if (!fn) return T.u;
  if (fn.special === 'let' || fn.special === 'lets') {
    let scope = c.scope;
    for (let i = 0; i < args.length - 1; i += 2) {
      const n = args[i];
      if (n.kind !== 'identifier') return T.u;
      scope = { name: n.name, type: infer(args[i + 1], { ...c, scope }), next: scope };
    }
    return args.length ? infer(args[args.length - 1], { ...c, scope }) : T.u;
  }
  const argTypes: FormulaType[] = [];
  let listType: FormulaType | undefined;
  args.forEach((a, i) => {
    const p = paramAt(fn, i);
    if (isLambdaParam(p)) {
      const scope: Scope = { name: 'index', type: T.n, next: { name: 'current', type: elem(listType), next: c.scope } };
      argTypes.push(infer(a, { ...c, scope }));
    } else {
      const t = infer(a, c);
      if (i === 0) listType = t;
      argTypes.push(t);
    }
  });
  const r = typeof fn.returns === 'function' ? fn.returns(argTypes) : fn.returns;
  return r as FormulaType;
}

/** Result types of the branches of a top-level condition (`c ? a : b`, `if()`, `ifs()`), or null when the formula
 *  is not one. Automations use it to explain an unknown return type such as `if(Date, Date.dateAdd(1, "day"), "")`. */
export function branchTypes(src: string, env: TypeEnv): FormulaType[] | null {
  const { ast } = parse(src);
  if (!ast) return null;
  const c: Ctx = { env, schema: env.schema, scope: null, visiting: new Set(), depth: 0 };
  const safe = (n: Node): FormulaType => {
    try {
      return infer(n, c);
    } catch {
      return T.u;
    }
  };
  if (ast.kind === 'conditional') return [safe(ast.ifTrue), safe(ast.ifFalse)];
  if (ast.kind === 'call' && ast.callee.kind === 'identifier' && (ast.callee.name === 'if' || ast.callee.name === 'ifs')) {
    const args = ast.args;
    if (ast.callee.name === 'if') return args.length === 3 ? [safe(args[1]), safe(args[2])] : null;
    const out: FormulaType[] = [];
    for (let i = 1; i < args.length; i += 2) out.push(safe(args[i]));
    if (args.length % 2 === 1) out.push(safe(args[args.length - 1]));
    return out;
  }
  return null;
}

export function inferSource(src: string, env: TypeEnv, visiting = new Set<string>(), depth = 0): FormulaType {
  const { ast } = parse(src);
  if (!ast) return T.u;
  try {
    return infer(ast, { env, schema: env.schema, scope: null, visiting, depth });
  } catch {
    return T.u;
  }
}

const PLURAL: Record<string, string> = {
  number: 'number list', text: 'text list', checkbox: 'checkbox list', date: 'date list', person: 'people list',
  block: 'block list', array: 'nested list', function: 'function list', undefined: 'list', unknown: 'unknown list',
};
const SINGULAR: Record<string, string> = {
  number: 'number', text: 'text', checkbox: 'checkbox', date: 'date', person: 'person', block: 'block', function: 'function', unknown: 'unknown', undefined: 'empty', expression: 'unknown',
};

/** Human-readable labels such as "number" and "text list". */
export function typeLabel(t: FormulaType | TypeSpec | undefined): string {
  if (!t) return 'unknown';
  if (t.type === 'array') return PLURAL[t.of.type] ?? 'unknown list';
  return SINGULAR[t.type] ?? 'unknown';
}

/** Serializable result_type for the schema. */
export function toResultType(t: FormulaType): unknown {
  if (t.type === 'array') return { type: 'array', of: toResultType(t.of as FormulaType) };
  if (t.type === 'block') return { type: 'block', ...(t.collection ? { collection: t.collection } : {}) };
  if (t.type === 'expression' || t.type === 'function') return { type: 'unknown' };
  return { type: t.type };
}
