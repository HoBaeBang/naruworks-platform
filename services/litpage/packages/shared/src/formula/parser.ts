// Formula 2.0 lexer + parser. Precedence, lowest first:
//   conditional(?:) < or/|| < and/&& < == != (non-assoc) < < <= > >= (non-assoc) < + - < * / % < ^ (right assoc)
//   < unary (- ! not) < member/call chains (x.fn(), x.<property token>, f()) < primary.
// Property references are inline tokens serialised as {{lit:...}}.
import type { LitDate } from './dates.ts';

export type FormulaToken =
  | { type: 'block_property'; property: string; collection?: { id: string; table: 'collection'; spaceId?: string } }
  | { type: 'block'; blockId: string; spaceId?: string }
  | { type: 'person'; userId: string }
  | { type: 'checkbox'; checked: boolean }
  | { type: 'date'; date: LitDate }
  /** automation / button context value ("Trigger page", "Time triggered", "Variable 1" …) resolved by the caller */
  | { type: 'context'; key: string };

export const TOKEN_PREFIX = '{{lit:';
export const TOKEN_SUFFIX = '}}';

export function encodeToken(t: FormulaToken): string {
  switch (t.type) {
    case 'block_property': {
      const parts = ['block_property', encodeURIComponent(t.property)];
      if (t.collection) parts.push(t.collection.id, t.collection.spaceId ?? '');
      return TOKEN_PREFIX + parts.join(':') + TOKEN_SUFFIX;
    }
    case 'block': return `${TOKEN_PREFIX}block:${t.blockId}${t.spaceId ? ':' + t.spaceId : ''}${TOKEN_SUFFIX}`;
    case 'person': return `${TOKEN_PREFIX}person:user:${t.userId}${TOKEN_SUFFIX}`;
    case 'checkbox': return `${TOKEN_PREFIX}checkbox:${t.checked ? 'true' : 'false'}${TOKEN_SUFFIX}`;
    case 'date': return `${TOKEN_PREFIX}date:${encodeURIComponent(JSON.stringify(t.date))}${TOKEN_SUFFIX}`;
    case 'context': return `${TOKEN_PREFIX}context:${encodeURIComponent(t.key)}${TOKEN_SUFFIX}`;
  }
}

export function decodeToken(body: string): FormulaToken | null {
  const parts = body.split(':');
  switch (parts[0]) {
    case 'block_property': {
      if (!parts[1]) return null;
      const property = decodeURIComponent(parts[1]);
      return parts[2] ? { type: 'block_property', property, collection: { id: parts[2], table: 'collection', spaceId: parts[3] || undefined } } : { type: 'block_property', property };
    }
    case 'block': return parts[1] ? { type: 'block', blockId: parts[1], spaceId: parts[2] } : null;
    case 'person': return parts[2] ? { type: 'person', userId: parts[2] } : null;
    case 'checkbox': return { type: 'checkbox', checked: parts[1] === 'true' };
    case 'date':
      try {
        return { type: 'date', date: JSON.parse(decodeURIComponent(parts.slice(1).join(':'))) };
      } catch {
        return null;
      }
    case 'context': return parts[1] ? { type: 'context', key: decodeURIComponent(parts[1]) } : null;
    default: return null;
  }
}

// ------------------------------------------------------------------ lexer
export type TokKind =
  | 'ws' | 'comment' | 'number' | 'string' | 'unclosedString' | 'unclosedComment' | 'input' | 'true' | 'false' | 'and' | 'or' | 'not'
  | 'ident' | 'eq' | 'neq' | 'plus' | 'minus' | 'bang' | 'star' | 'slash' | 'percent' | 'caret' | 'lparen' | 'rparen'
  | 'lbracket' | 'rbracket' | 'lt' | 'gt' | 'question' | 'colon' | 'comma' | 'dot' | 'invalid';

export interface Tok {
  kind: TokKind;
  text: string;
  start: number;
  end: number;
  token?: FormulaToken;
}

const RE = {
  ws: /\s+/y,
  number: /(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y,
  string: /"(?:[^\\"]|\\.)*"/y,
  unclosedString: /"(?:[^\\"]|\\.)*/y,
  comment: /\/\*(?:[^*]|\*(?:[^/]))*\*\//y,
  unclosedComment: /\/\*(?:[^*]|\*(?:[^/]))*/y,
  true: /true/iy,
  false: /false/iy,
  and: /and(?=\s)|&&/iy,
  or: /or(?=\s)|\|\|/iy,
  not: /not(?=\s)/iy,
  ident: /[\p{L}_][\p{N}\p{L}_]*/uy,
  // lenient: "===" / "!==" (used in help examples) lex as == / !=
  eq: /===?/y,
  neq: /!==?/y,
  lt: /<=?/y,
  gt: />=?/y,
};
const SINGLE: Record<string, TokKind> = {
  '+': 'plus', '-': 'minus', '!': 'bang', '*': 'star', '/': 'slash', '%': 'percent', '^': 'caret', '(': 'lparen', ')': 'rparen',
  '[': 'lbracket', ']': 'rbracket', '?': 'question', ':': 'colon', ',': 'comma', '.': 'dot',
};

function sticky(re: RegExp, s: string, i: number): string | null {
  re.lastIndex = i;
  const m = re.exec(s);
  return m && m.index === i ? m[0] : null;
}

/** Tokenize including whitespace/comments (for highlighting). Never throws. */
export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const push = (kind: TokKind, text: string, token?: FormulaToken) => {
    out.push({ kind, text, start: i, end: i + text.length, ...(token ? { token } : {}) });
    i += text.length;
  };
  while (i < src.length) {
    let m: string | null;
    if ((m = sticky(RE.ws, src, i))) { push('ws', m); continue; }
    if ((m = sticky(RE.number, src, i))) { push('number', m); continue; }
    if ((m = sticky(RE.string, src, i))) { push('string', m); continue; }
    if ((m = sticky(RE.unclosedString, src, i))) { push('unclosedString', m); continue; }
    if ((m = sticky(RE.comment, src, i))) { push('comment', m); continue; }
    if ((m = sticky(RE.unclosedComment, src, i))) { push('unclosedComment', m); continue; }
    if (src.startsWith(TOKEN_PREFIX, i)) {
      const end = src.indexOf(TOKEN_SUFFIX, i + TOKEN_PREFIX.length);
      if (end > 0) {
        const tok = decodeToken(src.slice(i + TOKEN_PREFIX.length, end));
        if (tok) { push('input', src.slice(i, end + TOKEN_SUFFIX.length), tok); continue; }
      }
    }
    if ((m = sticky(RE.true, src, i))) { push('true', m); continue; }
    if ((m = sticky(RE.false, src, i))) { push('false', m); continue; }
    if ((m = sticky(RE.and, src, i))) { push('and', m); continue; }
    if ((m = sticky(RE.or, src, i))) { push('or', m); continue; }
    if ((m = sticky(RE.not, src, i))) { push('not', m); continue; }
    if ((m = sticky(RE.ident, src, i))) { push('ident', m); continue; }
    if ((m = sticky(RE.eq, src, i))) { push('eq', m); continue; }
    if ((m = sticky(RE.neq, src, i))) { push('neq', m); continue; }
    if ((m = sticky(RE.lt, src, i))) { push('lt', m); continue; }
    if ((m = sticky(RE.gt, src, i))) { push('gt', m); continue; }
    const k = SINGLE[src[i]];
    if (k) { push(k, src[i]); continue; }
    const cp = String.fromCodePoint(src.codePointAt(i)!);
    push('invalid', cp);
  }
  return out;
}

// ------------------------------------------------------------------ AST
interface Base {
  start: number;
  end: number;
}
export type Node =
  | (Base & { kind: 'number'; text: string })
  | (Base & { kind: 'string'; text: string })
  | (Base & { kind: 'boolean'; value: boolean })
  | (Base & { kind: 'token'; token: FormulaToken })
  | (Base & { kind: 'identifier'; name: string })
  | (Base & { kind: 'array'; elements: Node[] })
  | (Base & { kind: 'unary'; op: '-' | '!' | 'not'; expression: Node })
  | (Base & { kind: 'binary'; op: '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>='; lhs: Node; rhs: Node })
  | (Base & { kind: 'and' | 'or'; elements: Node[] })
  | (Base & { kind: 'conditional'; condition: Node; ifTrue: Node; ifFalse: Node })
  | (Base & { kind: 'call'; callee: Node; args: Node[]; lParen: number; rParen?: number; commas: number[] })
  | (Base & { kind: 'method'; target: Node; name: string; nameStart: number; nameEnd: number })
  | (Base & { kind: 'member'; target: Node; token: FormulaToken & { type: 'block_property' } });

export type ParseErrorType =
  | 'InvalidCharacter' | 'UnclosedStringLiteral' | 'UnclosedComment' | 'TokenExpected' | 'ExpressionExpected'
  | 'PropertyTokenOrFunctionExpected' | 'EndOfInputExpected' | 'TooDeeplyNested';

export interface ParseError {
  kind: 'parse';
  type: ParseErrorType;
  offset: number; // -1 = end of input
  message: string;
  character?: string;
  token?: string;
}

export const PARSE_MESSAGES: Record<ParseErrorType, (e: ParseError) => string> = {
  InvalidCharacter: (e) => `The character “${e.character}” is not valid here.`,
  UnclosedStringLiteral: () => 'The text string is missing its closing quote.',
  UnclosedComment: () => 'The comment is unfinished. Close it with */.',
  TokenExpected: (e) => `Expected “${e.token}” here.`,
  ExpressionExpected: () => 'Expression expected.',
  PropertyTokenOrFunctionExpected: () => 'Enter a property reference or function.',
  EndOfInputExpected: () => 'The formula has unexpected text at the end.',
  TooDeeplyNested: () => 'This formula has too many nested expressions.',
};

class ParseFail extends Error {
  err: ParseError;
  constructor(err: ParseError) {
    super(err.message);
    this.err = err;
  }
}

function perr(type: ParseErrorType, offset: number, extra?: Partial<ParseError>): ParseFail {
  const e: ParseError = { kind: 'parse', type, offset, message: '', ...extra };
  e.message = PARSE_MESSAGES[type](e);
  return new ParseFail(e);
}

const MAX_NESTING = 120;

/** Unescape a string literal body (only \\ \n \t \" are escapes; other backslashes stay). */
export function unescapeString(body: string): string {
  return body.replace(/\\([\\nt"])/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

export function parse(src: string): { ast: Node | null; error?: ParseError; tokens: Tok[] } {
  const all = lex(src);
  for (const t of all) {
    if (t.kind === 'invalid') return { ast: null, error: perr('InvalidCharacter', t.start, { character: t.text }).err, tokens: all };
    if (t.kind === 'unclosedComment') return { ast: null, error: perr('UnclosedComment', t.start).err, tokens: all };
  }
  const toks = all.filter((t) => t.kind !== 'ws' && t.kind !== 'comment');
  if (!toks.length) return { ast: null, tokens: all };
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const at = (k: TokKind) => toks[p]?.kind === k;
  const offsetHere = () => (toks[p] ? toks[p].start : -1);
  const expect = (k: TokKind, sym: string): Tok => {
    if (!at(k)) throw perr('TokenExpected', offsetHere(), { token: sym });
    return toks[p++];
  };
  const enter = () => {
    if (++depth > MAX_NESTING) throw perr('TooDeeplyNested', offsetHere());
  };

  function expression(): Node {
    enter();
    try {
      return conditional();
    } finally {
      depth--;
    }
  }
  function conditional(): Node {
    const condition = logicalOr();
    if (!at('question')) return condition;
    p++;
    const ifTrue = logicalOr();
    expect('colon', ':');
    const ifFalse = logicalOr();
    return { kind: 'conditional', condition, ifTrue, ifFalse, start: condition.start, end: ifFalse.end };
  }
  function logicalOr(): Node {
    const first = logicalAnd();
    if (!at('or')) return first;
    const elements = [first];
    while (at('or')) {
      p++;
      elements.push(logicalAnd());
    }
    return { kind: 'or', elements, start: first.start, end: elements[elements.length - 1].end };
  }
  function logicalAnd(): Node {
    const first = equality();
    if (!at('and')) return first;
    const elements = [first];
    while (at('and')) {
      p++;
      elements.push(equality());
    }
    return { kind: 'and', elements, start: first.start, end: elements[elements.length - 1].end };
  }
  function equality(): Node {
    const lhs = relational();
    if (!at('eq') && !at('neq')) return lhs;
    const op = toks[p++].kind === 'eq' ? '==' : '!=';
    const rhs = relational();
    return { kind: 'binary', op, lhs, rhs, start: lhs.start, end: rhs.end };
  }
  function relational(): Node {
    const lhs = additive();
    if (!at('lt') && !at('gt')) return lhs;
    const op = toks[p++].text as '<' | '<=' | '>' | '>=';
    const rhs = additive();
    return { kind: 'binary', op, lhs, rhs, start: lhs.start, end: rhs.end };
  }
  function additive(): Node {
    let lhs = multiplicative();
    while (at('plus') || at('minus')) {
      const op = toks[p++].kind === 'plus' ? '+' : '-';
      const rhs = multiplicative();
      lhs = { kind: 'binary', op, lhs, rhs, start: lhs.start, end: rhs.end };
    }
    return lhs;
  }
  function multiplicative(): Node {
    let lhs = exponent();
    while (at('star') || at('slash') || at('percent')) {
      const k = toks[p++].kind;
      const op = k === 'star' ? '*' : k === 'slash' ? '/' : '%';
      const rhs = exponent();
      lhs = { kind: 'binary', op, lhs, rhs, start: lhs.start, end: rhs.end };
    }
    return lhs;
  }
  function exponent(): Node {
    const first = unary();
    if (!at('caret')) return first;
    const operands = [first];
    while (at('caret')) {
      p++;
      operands.push(unary());
    }
    // right associative: a ^ (b ^ c)
    let node = operands[operands.length - 1];
    for (let i = operands.length - 2; i >= 0; i--) node = { kind: 'binary', op: '^', lhs: operands[i], rhs: node, start: operands[i].start, end: node.end };
    return node;
  }
  function unary(): Node {
    let op: '-' | '!' | 'not' | null = null;
    let opStart = 0;
    if (at('minus') || at('bang') || at('not')) {
      const t = toks[p++];
      op = t.kind === 'minus' ? '-' : t.kind === 'bang' ? '!' : 'not';
      opStart = t.start;
    }
    let node = primary();
    const foldNumber = op === '-' && node.kind === 'number';
    if (foldNumber) node = { kind: 'unary', op: '-', expression: node, start: opStart, end: node.end };
    node = memberChain(node);
    if (op && !foldNumber) node = { kind: 'unary', op, expression: node, start: opStart, end: node.end };
    return node;
  }
  function memberChain(node: Node): Node {
    for (;;) {
      if (at('dot')) {
        p++;
        const t = peek();
        if (t?.kind === 'ident') {
          p++;
          node = { kind: 'method', target: node, name: t.text, nameStart: t.start, nameEnd: t.end, start: node.start, end: t.end };
          continue;
        }
        if (t?.kind === 'input' && t.token?.type === 'block_property') {
          p++;
          node = { kind: 'member', target: node, token: t.token, start: node.start, end: t.end };
          continue;
        }
        throw perr('PropertyTokenOrFunctionExpected', offsetHere());
      }
      if (at('lparen')) {
        const lp = toks[p++];
        const args: Node[] = [];
        const commas: number[] = [];
        if (!at('rparen')) {
          args.push(expression());
          while (at('comma')) {
            commas.push(toks[p++].start);
            args.push(expression());
          }
        }
        const rp = expect('rparen', ')');
        node = { kind: 'call', callee: node, args, lParen: lp.start, rParen: rp.start, commas, start: node.start, end: rp.end };
        continue;
      }
      return node;
    }
  }
  function primary(): Node {
    const t = peek();
    if (!t) throw perr('ExpressionExpected', -1);
    switch (t.kind) {
      case 'lparen': {
        p++;
        const e = expression();
        expect('rparen', ')');
        return e;
      }
      case 'lbracket': {
        p++;
        const elements: Node[] = [];
        if (!at('rbracket')) {
          elements.push(expression());
          while (at('comma')) {
            p++;
            elements.push(expression());
          }
        }
        const rb = expect('rbracket', ']');
        return { kind: 'array', elements, start: t.start, end: rb.end };
      }
      case 'number': p++; return { kind: 'number', text: t.text, start: t.start, end: t.end };
      case 'string': p++; return { kind: 'string', text: unescapeString(t.text.slice(1, -1)), start: t.start, end: t.end };
      case 'unclosedString': throw perr('UnclosedStringLiteral', t.start);
      case 'true': case 'false': p++; return { kind: 'boolean', value: t.kind === 'true', start: t.start, end: t.end };
      case 'ident': p++; return { kind: 'identifier', name: t.text, start: t.start, end: t.end };
      case 'input': p++; return { kind: 'token', token: t.token!, start: t.start, end: t.end };
      default: throw perr('ExpressionExpected', t.start);
    }
  }

  try {
    const ast = expression();
    if (p < toks.length) throw perr('EndOfInputExpected', toks[p].start);
    return { ast, tokens: all };
  } catch (e) {
    if (e instanceof ParseFail) return { ast: null, error: e.err, tokens: all };
    throw e;
  }
}
