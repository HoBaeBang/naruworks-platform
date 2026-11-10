// Formula storage: schema `{type:"formula", version:"v2", formula2:{code, result_type}}` where `code` is rich text whose
// property references are mention tokens `["‣",[["fpp",{property, collection:{id,table:"collection",spaceId}}]]]`
// The engine works on a linear source string where each token is serialised as
// `{{lit:block_property:<id>:<collectionId>:<spaceId>}}`; prop("Name") is accepted and converted to tokens.
import type { PropertySchema } from '../records.ts';
import { encodeToken, lex, unescapeString, type FormulaToken } from './parser.ts';

export type CodeDecoration = [string] | [string, unknown[]];
export type FormulaCode = CodeDecoration[];

export const SYSTEM_TOKEN_PROPERTIES = ['title', 'created_by', 'created_time', 'last_edited_by', 'last_edited_time'];

function tokenFromAnnotations(anns: unknown[]): FormulaToken | null {
  for (const a of anns) {
    if (!Array.isArray(a)) continue;
    const [k, v] = a as [string, any];
    if (k === 'fpp' && v && typeof v === 'object' && v.property) return { type: 'block_property', property: v.property, collection: v.collection ? { id: v.collection.id, table: 'collection', spaceId: v.collection.spaceId } : undefined };
    if (k === 'p' && typeof v === 'string') return { type: 'block', blockId: v, spaceId: (a as any)[2] };
    if (k === 'u' && typeof v === 'string') return { type: 'person', userId: v };
    if (k === 'd' && v && typeof v === 'object') return { type: 'date', date: v };
    if (k === 'fctx' && typeof v === 'string') return { type: 'context', key: v };
  }
  return null;
}

/** formula2.code rich text -> engine source string */
export function codeToSource(code: FormulaCode | string | undefined | null): string {
  if (!code) return '';
  if (typeof code === 'string') return code;
  let out = '';
  for (const d of code) {
    const tok = d[1] ? tokenFromAnnotations(d[1]) : null;
    out += tok ? encodeToken(tok) : d[0];
  }
  return out;
}

/** engine source string -> formula2.code rich text (tokens become ‣ mentions). */
export function sourceToCode(src: string): FormulaCode {
  const out: FormulaCode = [];
  let buf = '';
  for (const t of lex(src)) {
    if (t.kind === 'input' && t.token) {
      if (buf) out.push([buf]);
      buf = '';
      const tok = t.token;
      if (tok.type === 'block_property') out.push(['‣', [['fpp', { property: tok.property, ...(tok.collection ? { collection: { id: tok.collection.id, table: 'collection', spaceId: tok.collection.spaceId } } : {}) }]]]);
      else if (tok.type === 'block') out.push(['‣', [['p', tok.blockId, ...(tok.spaceId ? [tok.spaceId] : [])]]]);
      else if (tok.type === 'person') out.push(['‣', [['u', tok.userId]]]);
      else if (tok.type === 'date') out.push(['‣', [['d', tok.date]]]);
      else if (tok.type === 'context') out.push(['‣', [['fctx', tok.key]]]);
      else buf += tok.checked ? 'true' : 'false';
    } else buf += t.text;
  }
  if (buf) out.push([buf]);
  return out;
}

/** Source of a formula property schema (v2 code, or a plain `expression` string for hand-written schemas). */
export function formulaSourceOf(ps: PropertySchema | undefined): string {
  if (!ps) return '';
  const f2 = (ps as any).formula2;
  if (f2?.code !== undefined) return codeToSource(f2.code);
  const f = (ps as any).formula;
  if (typeof f === 'string') return f;
  if (f && typeof f.expression === 'string') return f.expression;
  return '';
}

/** Replace `prop("Name")` calls with property tokens (Litpage converts typed/pasted prop() into tokens). */
export function resolvePropCalls(src: string, schema: Record<string, PropertySchema>, collection?: { id: string; spaceId?: string }): string {
  const toks = lex(src);
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // pattern: [dot]? ident(prop) ( string )
    if (t.kind === 'ident' && t.text === 'prop' && toks[i + 1]?.kind === 'lparen' && toks[i + 2]?.kind === 'string' && toks[i + 3]?.kind === 'rparen') {
      const prev = [...toks.slice(0, i)].reverse().find((x) => x.kind !== 'ws' && x.kind !== 'comment');
      const name = unescapeString(toks[i + 2].text.slice(1, -1));
      const id = Object.keys(schema).find((k) => schema[k]?.name === name);
      if (id && prev?.kind !== 'dot') {
        out += encodeToken({ type: 'block_property', property: id, collection: collection ? { id: collection.id, table: 'collection', spaceId: collection.spaceId } : undefined });
        i += 3;
        continue;
      }
    }
    out += t.text;
  }
  return out;
}

/** Tokens -> prop("Name") text (for copying a formula as plain text). */
export function sourceToPlain(src: string, nameOf: (propId: string, collectionId?: string) => string | undefined): string {
  let out = '';
  for (const t of lex(src)) {
    if (t.kind === 'input' && t.token?.type === 'block_property') {
      const n = nameOf(t.token.property, t.token.collection?.id) ?? t.token.property;
      out += `prop(${JSON.stringify(n)})`;
    } else out += t.text;
  }
  return out;
}

/** Make a formula property schema in Litpage's v2 shape. */
export function formulaSchema(name: string, src: string, resultType?: unknown): PropertySchema {
  return { name, type: 'formula', version: 'v2', formula2: { code: sourceToCode(src), result_type: resultType ?? { type: 'unknown' } } } as unknown as PropertySchema;
}
