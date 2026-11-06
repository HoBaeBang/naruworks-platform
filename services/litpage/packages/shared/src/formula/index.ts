// Public formula API (Formula 2.0). Used by the database core (cells, sorting, filters) and the advanced UI.
//   evaluateFormula(expression, row, schema, ctx) -> { value, error? }
//   formulaResultType(expression, schema, ctx?)   -> FormulaType ("number", "text list", …)
import type { BlockRecord, PropertySchema } from '../records.ts';
import { codeToSource, formulaSourceOf, type FormulaCode } from './code.ts';
import { evaluateRollupWith, evaluateSource, type EvalResult, type FormulaContext, type RollupEvaluation } from './evaluate.ts';
import { toCompat, type CompatValue } from './compat.ts';
import { inferSource, typeLabel, toResultType, type FormulaType, type TypeEnv } from './typecheck.ts';
import { displayText, type FValue } from './values.ts';
import { formatLitDate } from './dates.ts';
import { formatNumberValue } from './numbers.ts';

export type FormulaInput = string | FormulaCode | PropertySchema | null | undefined;

/** Engine source text of a formula given as source text, formula2.code rich text or a formula property schema. */
export function formulaSource(input: FormulaInput): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return codeToSource(input);
  return formulaSourceOf(input);
}

/** Record lookups as passed by the database engine (QueryContext: getRecord(table, id), now, …). */
interface RecordLookupContext {
  getRecord?: (table: string, id: string) => any;
  now?: number;
  timeZone?: string;
}

/** Accept both FormulaContext and the database engine's QueryContext. */
export function toFormulaContext(ctx: FormulaContext | RecordLookupContext | undefined): FormulaContext {
  const c = (ctx ?? {}) as Partial<FormulaContext> & RecordLookupContext;
  if (typeof c.getBlock === 'function' && typeof c.getCollection === 'function') return c as FormulaContext;
  const get = c.getRecord;
  return {
    getBlock: (id) => get?.('block', id),
    getCollection: (id) => get?.('collection', id),
    getUser: (id) => get?.('lit_user', id),
    timeZone: c.timeZone,
    now: c.now,
  };
}

/** Evaluation result: formula value + error, also shaped as a database PropertyValue (`kind`). */
export type FormulaEvalResult = EvalResult & CompatValue;

/**
 * Evaluate a formula for a row. `schema` is the row's collection schema (property tokens and prop("Name") resolve
 * against it); `ctx` gives record access + time zone. Never throws: errors come back in `error` with an empty value.
 * When the database engine calls this with `extra.prop`, the property's stored formula2.code (with property tokens)
 * is used instead of the flattened expression string.
 */
export function evaluateFormula(
  expression: FormulaInput,
  row: BlockRecord | null | undefined,
  schema: Record<string, PropertySchema>,
  ctx: FormulaContext | RecordLookupContext,
  extra?: { propId?: string; prop?: PropertySchema },
): FormulaEvalResult {
  const fctx = toFormulaContext(ctx);
  const src = extra?.prop && extra.prop.type === 'formula' ? formulaSourceOf(extra.prop) : formulaSource(expression);
  const res = evaluateSource(src, row, schema, fctx);
  const resultType = (extra?.prop as any)?.formula2?.result_type?.type as string | undefined;
  const compat: CompatValue = res.error ? { kind: 'error', message: res.error.message } : toCompat(res.value, { emptyAs: resultType, resolver: { timeZone: fctx.timeZone } });
  return { ...res, ...compat } as FormulaEvalResult;
}

/** Rollup value of a row (database engine hook signature: row, propId, schema, ctx). */
export function evaluateRollup(row: BlockRecord, propId: string, schema: Record<string, PropertySchema> | undefined, ctx: FormulaContext | RecordLookupContext): RollupEvaluation & CompatValue {
  const fctx = toFormulaContext(ctx);
  const r = evaluateRollupWith(row, propId, fctx, schema);
  const agg = r.aggregation;
  const target = agg === 'show_original' || agg === 'show_unique' ? r.targetSchema : undefined;
  const emptyAs = ['earliest_date', 'latest_date'].includes(agg) ? 'date' : agg === 'show_original' || agg === 'show_unique' || agg === 'date_range' ? undefined : 'number';
  return { ...r, ...toCompat(r.value, { target, emptyAs, resolver: { timeZone: fctx.timeZone } }) } as RollupEvaluation & CompatValue;
}

/** Static result type (shown as "Type: …" in the editor, persisted as formula2.result_type). */
export function formulaResultType(expression: FormulaInput, schema: Record<string, PropertySchema>, ctx?: Partial<Pick<FormulaContext, 'getCollection'>> & { collectionId?: string; contextType?: TypeEnv['contextType'] }): FormulaType {
  const env: TypeEnv = { schema, collectionId: ctx?.collectionId, getCollection: ctx?.getCollection, contextType: ctx?.contextType };
  return inferSource(formulaSource(expression), env);
}

/** Plain display text for a formula/rollup value using the property's number/date formats. */
export function formatFormulaValue(value: FValue, opts?: { schema?: PropertySchema; ctx?: Partial<FormulaContext>; percent?: boolean }): string {
  const ps = opts?.schema;
  const ctx = opts?.ctx;
  const resolver = {
    timeZone: ctx?.timeZone,
    dateFormat: (ps?.date_format as string | undefined) ?? ctx?.dateFormat,
    timeFormat: (ps?.time_format as string | undefined) ?? ctx?.timeFormat,
    pageTitle: (id: string) => {
      const t = ctx?.getBlock?.(id)?.properties?.title;
      return t ? t.map((d) => d[0]).join('') || 'Untitled' : 'Untitled';
    },
    userName: (id: string) => {
      const u = ctx?.getUser?.(id);
      return u ? u.name || [u.given_name, u.family_name].filter(Boolean).join(' ') || u.email || '' : '';
    },
  };
  if (value.type === 'number') {
    if (opts?.percent) return formatNumberValue(value.value, 'percent', (ps?.number_precision as string | undefined) ?? 0);
    return formatNumberValue(value.value, (ps?.number_format as string | undefined) ?? 'number', ps?.number_precision as string | undefined);
  }
  if (value.type === 'date') return formatLitDate(value.value, { tz: ctx?.timeZone, dateFormat: resolver.dateFormat, timeFormat: resolver.timeFormat });
  return displayText(value, resolver);
}

export { typeLabel, toResultType };
export type { FormulaType, TypeEnv, EvalResult, FormulaContext };
export { evaluateSource, propertyFValue, evaluateRollupWith, relationIdsOf, relationTargetsOf, userDisplayName, FORMULA_MAX_DEPTH, parseCached } from './evaluate.ts';
export type { FormulaError, RollupEvaluation, UserLike } from './evaluate.ts';
export { parse, lex, encodeToken, decodeToken, TOKEN_PREFIX, TOKEN_SUFFIX, type Node, type Tok, type FormulaToken, type ParseError } from './parser.ts';
export { codeToSource, sourceToCode, formulaSourceOf, resolvePropCalls, sourceToPlain, formulaSchema, SYSTEM_TOKEN_PROPERTIES, type FormulaCode } from './code.ts';
export { LIBRARY, MENU_ORDER, CATEGORY_ORDER, CATEGORY_LABEL, paramAt, type FnDef, type TypeSpec, type Category } from './library.ts';
export { propertyFormulaType, inferSource } from './typecheck.ts';
export * from './values.ts';
export {
  DT, parseZone, zoneOrSystem, dateInterval, dateStartMs, dateEndMs, datetimeFromMs, dateFromMs, formatLitDate, formatMoment, parseISODate,
  addToDate, isRange, hasTime, rangeStart, rangeEnd, monthName, weekdayName, systemZoneName, daysInMonth, isoDayOf, type LitDate, type DateUnit,
} from './dates.ts';
export { formatNumberValue, resolveNumberFormat, NUMBER_FORMATS, CURRENCY_FORMATS, roundTo } from './numbers.ts';
export { toCompat, dateToRange, type CompatValue, type CompatDateRange } from './compat.ts';
export { FUNCTION_DOCS, BUILTIN_DOCS, type FormulaFunctionDoc, type FormulaBuiltinDoc, type FormulaDocExample } from './docs.ts';
export { SCHEMA_SIZE_LIMIT, schemaSize, largestProperty, schemaLimitProblem } from './schemaLimit.ts';
