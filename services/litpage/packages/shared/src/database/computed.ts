// Computed properties (formula / rollup) adapter.
// The formula language lives in packages/shared/src/formula/index.ts (owned by the formula/relation/rollup
// work stream) and is plugged in at runtime with registerFormulaEngine(evaluateFormula) — this keeps the
// engine compiling before that module exists. The web app registers it in features/database/formulaBridge.ts.
import type { BlockRecord, PropertySchema } from '../records.ts';
import { toPlainText } from '../richtext.ts';
import { aggregateValues } from './aggregations.ts';
import { dateValueToRange, msToRange } from './dates.ts';
import type { PropertyValue, QueryContext, Schema } from './types.ts';
import { getPropertyValue } from './values.ts';

export type FormulaEvaluator = (
  expression: string,
  row: BlockRecord,
  schema: Schema,
  ctx: QueryContext,
  extra: { propId: string; prop: PropertySchema },
) => unknown;

export type RollupEvaluator = (row: BlockRecord, propId: string, schema: Schema, ctx: QueryContext) => unknown;

let formulaEngine: FormulaEvaluator | null = null;
let rollupEngine: RollupEvaluator | null = null;

export function registerFormulaEngine(fn: FormulaEvaluator | null) {
  formulaEngine = fn;
}

export function registerRollupEngine(fn: RollupEvaluator | null) {
  rollupEngine = fn;
}

export function hasFormulaEngine(): boolean {
  return !!formulaEngine;
}

/** Source text of a formula property (formula2.code rich text, legacy expression, or plain string). */
export function formulaSource(prop: PropertySchema): string {
  const f2 = (prop as any).formula2;
  if (f2?.code !== undefined) return typeof f2.code === 'string' ? f2.code : toPlainText(f2.code);
  const f = prop.formula as any;
  if (typeof f === 'string') return f;
  if (typeof f?.expression === 'string') return f.expression;
  return typeof (prop as any).expression === 'string' ? (prop as any).expression : '';
}

export function computeFormula(row: BlockRecord, propId: string, schema: Schema, ctx: QueryContext): PropertyValue {
  const prop = schema[propId];
  if (!formulaEngine || !prop) return { kind: 'text', text: '' };
  try {
    const res = formulaEngine(formulaSource(prop), row, schema, ctx, { propId, prop });
    return normalizeComputed(res, (prop as any).formula2?.result_type?.type);
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Map arbitrary engine output (JS values or PropertyValue) to a PropertyValue. */
export function normalizeComputed(res: unknown, resultType?: string): PropertyValue {
  if (res === null || res === undefined) {
    if (resultType === 'number') return { kind: 'number', number: null };
    if (resultType === 'date') return { kind: 'date', date: null };
    if (resultType === 'checkbox') return { kind: 'checkbox', checked: false };
    return { kind: 'text', text: '' };
  }
  if (typeof res === 'object' && res && 'kind' in (res as any) && typeof (res as any).kind === 'string') return res as PropertyValue;
  if (typeof res === 'number') return { kind: 'number', number: Number.isFinite(res) ? res : null };
  if (typeof res === 'string') return { kind: 'text', text: res };
  if (typeof res === 'boolean') return { kind: 'checkbox', checked: res };
  if (res instanceof Date) return { kind: 'date', date: msToRange(res.getTime()) };
  if (Array.isArray(res)) return { kind: 'array', items: res.map((r) => normalizeComputed(r)) };
  const o = res as any;
  if (o.type === 'date' || o.start_date) return { kind: 'date', date: dateValueToRange(o.start_date ? o : o.value) };
  if (o.start instanceof Date) {
    const start = o.start.getTime();
    const r = msToRange(start);
    if (o.end instanceof Date) return { kind: 'date', date: { ...r, isRange: true, endMs: o.end.getTime(), end: msToRange(o.end.getTime()).start, endTime: msToRange(o.end.getTime()).startTime } };
    return { kind: 'date', date: r };
  }
  if (o.table === 'lit_user' || o.type === 'person' || o.type === 'user') return { kind: 'person', ids: [String(o.id)] };
  if (o.table === 'block' || o.type === 'page') return { kind: 'relation', ids: [String(o.id)] };
  return { kind: 'text', text: String(res) };
}

/** Default rollup: relation pages → target property values → aggregation (show_original by default). */
export function computeRollup(row: BlockRecord, propId: string, schema: Schema, ctx: QueryContext): PropertyValue {
  const prop = schema[propId];
  if (!prop) return { kind: 'text', text: '' };
  if (rollupEngine) {
    try {
      return normalizeComputed(rollupEngine(row, propId, schema, ctx));
    } catch (e) {
      return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
  const relId = prop.relation_property as string | undefined;
  const relProp = relId ? schema[relId] : undefined;
  if (!relId || !relProp || relProp.type !== 'relation') return { kind: 'text', text: '' };
  const rel = getPropertyValue(row, relId, schema, ctx);
  const ids = rel.kind === 'relation' ? rel.ids : [];
  const targetCollection = ctx.getRecord?.('collection', String(relProp.collection_id ?? ''));
  const targetSchema: Schema = targetCollection?.schema ?? {};
  const targetProp = String(prop.target_property ?? 'title');
  const pages = ids.map((id) => ctx.getRecord?.('block', id) as BlockRecord | undefined).filter((b): b is BlockRecord => !!b && b.alive !== false);
  const values = pages.map((p) => getPropertyValue(p, targetProp, targetSchema, ctx));
  const agg = typeof prop.aggregation === 'string' ? prop.aggregation : (prop.aggregation as any)?.operator ?? 'show_original';
  if (agg === 'show_original' || !agg) {
    if (targetProp === 'title') return { kind: 'relation', ids: pages.map((p) => p.id) };
    return { kind: 'array', items: values };
  }
  if (agg === 'show_unique') {
    const seen = new Set<string>();
    const items: PropertyValue[] = [];
    for (const v of values) {
      const k = JSON.stringify(v);
      if (!seen.has(k)) {
        seen.add(k);
        items.push(v);
      }
    }
    return { kind: 'array', items };
  }
  const res = aggregateValues(values, agg, targetSchema[targetProp], ctx, prop.aggregation as any);
  if (agg === 'earliest_date' || agg === 'latest_date') return { kind: 'date', date: res.value === null ? null : msToRange(res.value) };
  return { kind: 'number', number: res.value };
}
