// Formula editor suggestions (left panel): context detection at the caret and the item catalogue —

import type { PropertySchema } from '@nc/shared/records.ts';
import {
  BUILTIN_DOCS, CATEGORY_LABEL, FUNCTION_DOCS, LIBRARY, MENU_ORDER, encodeToken, lex, type Category, type FormulaToken, type Tok,
} from '@nc/shared/formula/index.ts';

export type ItemKind = 'property' | 'builtin' | 'function' | 'variable' | 'context';

export interface CompletionItem {
  kind: ItemKind;
  key: string;
  label: string;
  
  suffix?: string;
  section: string;
  icon: string;
  propId?: string;
  prop?: PropertySchema;
  
  insert?: string;
  
  description?: string;
}

export interface CaretContext {
  mode: 'operand' | 'operator' | 'member';
  prefix: string;
  prefixStart: number;
  
  variables: string[];
}

const LAMBDA_FNS = new Set(['map', 'filter', 'find', 'findIndex', 'some', 'every', 'sort', 'count']);
const OPERAND_PREV = new Set(['plus', 'minus', 'bang', 'star', 'slash', 'percent', 'caret', 'eq', 'neq', 'lt', 'gt', 'question', 'colon', 'lparen', 'lbracket', 'comma', 'and', 'or', 'not']);

export function caretContext(src: string, caret: number): CaretContext {
  const toks = lex(src).filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
  let prefix = '';
  let prefixStart = caret;
  let idx = toks.findIndex((t) => t.start < caret && caret <= t.end);
  if (idx >= 0 && toks[idx].kind === 'ident') {
    prefix = src.slice(toks[idx].start, caret);
    prefixStart = toks[idx].start;
  } else {
    idx = toks.findIndex((t) => t.start >= caret);
    idx = idx < 0 ? toks.length : idx;
  }
  const before = toks.filter((t) => t.end <= prefixStart);
  const prev = before[before.length - 1];
  let mode: CaretContext['mode'] = 'operand';
  if (prev?.kind === 'dot') mode = 'member';
  else if (!prefix && prev && !OPERAND_PREV.has(prev.kind)) mode = 'operator';
  return { mode, prefix, prefixStart, variables: visibleVariables(toks, prefixStart) };
}


function visibleVariables(toks: Tok[], caret: number): string[] {
  const out = new Set<string>();
  const stack: { fn?: string; argIndex: number; letNames: string[] }[] = [];
  for (let i = 0; i < toks.length && toks[i].end <= caret; i++) {
    const t = toks[i];
    if (t.kind === 'lparen') {
      const prev = toks[i - 1];
      stack.push({ fn: prev?.kind === 'ident' ? prev.text : undefined, argIndex: 0, letNames: [] });
    } else if (t.kind === 'rparen') stack.pop();
    else if (t.kind === 'comma' && stack.length) stack[stack.length - 1].argIndex++;
    else if (t.kind === 'ident' && stack.length) {
      const top = stack[stack.length - 1];
      if ((top.fn === 'let' || top.fn === 'lets') && top.argIndex % 2 === 0 && toks[i + 1]?.kind === 'comma') top.letNames.push(t.text);
    }
  }
  for (const f of stack) {
    if (f.fn && LAMBDA_FNS.has(f.fn) && f.argIndex >= 1) {
      out.add('current');
      out.add('index');
    }
    for (const n of f.letNames) out.add(n);
  }
  return [...out];
}


export function returnIcon(name: string): string {
  const fn = LIBRARY[name];
  const r = typeof fn?.returns === 'function' ? null : fn?.returns;
  switch (r?.type) {
    case 'number': return 'numberProp';
    case 'checkbox': return 'checkboxChecked';
    case 'text': return 'textProp';
    case 'date': return 'date';
    case 'array': return 'multiSelect';
    default: return 'formula';
  }
}

export const OPERATORS = ['*', '/', '+', '-', '>', '>=', '<', '<=', '==', '!=', '%', '^', 'and', 'or'];

export function builtinType(symbol: string): string {
  const d = BUILTIN_DOCS.find((b) => b.symbol === symbol);
  return d?.type ?? 'unknown';
}

function matches(label: string, prefix: string): boolean {
  if (!prefix) return true;
  return label.toLowerCase().includes(prefix.toLowerCase());
}

export function propertyIconFor(type: string): string {
  return ({
    title: 'textProp', text: 'textProp', number: 'numberProp', select: 'select', multi_select: 'multiSelect', status: 'status', date: 'date',
    person: 'person', file: 'files', checkbox: 'checkboxChecked', url: 'url', email: 'email', phone_number: 'phone', formula: 'formula',
    relation: 'relation', rollup: 'rollup', created_time: 'createdTime', created_by: 'createdBy', last_edited_time: 'editedTime',
    last_edited_by: 'editedBy', button: 'button', auto_increment_id: 'id', place: 'location', location: 'location',
  } as Record<string, string>)[type] ?? 'textProp';
}


export const FORMULA_PROPERTY_TYPES = new Set(['title', 'text', 'url', 'email', 'phone_number', 'place', 'checkbox', 'person', 'created_by', 'last_edited_by', 'select', 'multi_select', 'status', 'number', 'date', 'created_time', 'last_edited_time', 'last_visited_time', 'formula', 'relation', 'rollup', 'auto_increment_id']);

export function buildItems(ctx: CaretContext, schema: Record<string, PropertySchema>, selfPropId: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const functionItems = (section?: string) => {
    for (const cat of Object.keys(MENU_ORDER) as Exclude<Category, 'internal'>[]) {
      for (const name of MENU_ORDER[cat]) {
        if (!FUNCTION_DOCS[name] || !matches(name, ctx.prefix)) continue;
        items.push({ kind: 'function', key: `fn:${name}`, label: name, suffix: '()', section: section ?? CATEGORY_LABEL[cat], icon: returnIcon(name) });
      }
    }
  };
  if (ctx.mode === 'operator') {
    for (const op of OPERATORS) items.push({ kind: 'builtin', key: `op:${op}`, label: op, section: 'Built-ins', icon: builtinType(op) === 'checkbox' ? 'checkboxChecked' : 'numberProp' });
    return items;
  }
  if (ctx.mode === 'member') {
    functionItems();
    return items;
  }
  const props = Object.entries(schema).filter(([id, p]) => id !== selfPropId && FORMULA_PROPERTY_TYPES.has(p.type));
  
  props.sort((a, b) => (a[0] === 'title' ? 1 : 0) - (b[0] === 'title' ? 1 : 0));
  for (const [id, p] of props) if (matches(p.name, ctx.prefix)) items.push({ kind: 'property', key: `prop:${id}`, label: p.name, section: 'Properties', icon: propertyIconFor(p.type), propId: id, prop: p });
  for (const v of ctx.variables) if (matches(v, ctx.prefix)) items.push({ kind: 'variable', key: `var:${v}`, label: v, section: 'Variables', icon: 'formula' });
  for (const b of ['not', 'true', 'false']) if (matches(b, ctx.prefix)) items.push({ kind: 'builtin', key: `kw:${b}`, label: b, section: 'Built-ins', icon: 'checkboxChecked' });
  functionItems();
  return items;
}

export interface Insertion {
  src: string;
  caret: number;
}


export function applyItem(src: string, caret: number, ctx: CaretContext, item: CompletionItem, collection?: { id: string; spaceId?: string }): Insertion {
  const before = src.slice(0, ctx.prefixStart);
  const after = src.slice(Math.max(caret, ctx.prefixStart + ctx.prefix.length));
  let ins = '';
  let caretIn = -1;
  if (item.insert !== undefined) {
    const next = before + item.insert + after;
    return { src: next, caret: before.length + item.insert.length };
  }
  switch (item.kind) {
    case 'property': {
      const tok: FormulaToken = { type: 'block_property', property: item.propId!, collection: collection ? { id: collection.id, table: 'collection', spaceId: collection.spaceId } : undefined };
      ins = encodeToken(tok);
      break;
    }
    case 'variable': ins = item.label; break;
    case 'function': {
      const fn = LIBRARY[item.label];
      const noArgs = fn && !fn.params.length && !fn.varargs?.length;
      ins = `${item.label}()`;
      caretIn = noArgs ? ins.length : ins.length - 1;
      break;
    }
    case 'builtin': {
      const word = item.label;
      if (item.key.startsWith('op:')) {
        const needSpaceBefore = before.length > 0 && !/\s$/.test(before);
        ins = `${needSpaceBefore ? ' ' : ''}${word} `;
      } else ins = word === 'not' ? 'not ' : word;
      break;
    }
  }
  const next = before + ins + after;
  return { src: next, caret: before.length + (caretIn >= 0 ? caretIn : ins.length) };
}
