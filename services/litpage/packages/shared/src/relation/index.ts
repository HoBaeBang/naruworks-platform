// Relations & rollups: value encoding, target resolution, two-way sync planning and rollup computation.
// Schema shapes: relation {collection_id, collection_pointer, property?(two-way counterpart),
// version:"v2", limit?:1}; rollup {relation_property, target_property, target_property_type, aggregation, show_as?}.
import type { BlockRecord, PropertySchema } from '../records.ts';
import type { Decoration, RichText } from '../richtext.ts';
import { evaluateRollupWith, relationIdsOf, relationTargetsOf, type FormulaContext, type RollupEvaluation } from '../formula/evaluate.ts';

export * from './aggregate.ts';
export { relationIdsOf };
export type RelationContext = FormulaContext;
export type { RollupEvaluation };

function schemaOf(row: BlockRecord, ctx: RelationContext): Record<string, PropertySchema> | undefined {
  return row.parent_table === 'collection' ? ctx.getCollection(row.parent_id)?.schema : undefined;
}

/** Related pages of a row's relation property (alive, non-template, limit applied) in stored order. */
export function getRelationTargets(row: BlockRecord, propId: string, ctx: RelationContext, schema?: Record<string, PropertySchema>): BlockRecord[] {
  const ps = (schema ?? schemaOf(row, ctx))?.[propId];
  if (!ps || ps.type !== 'relation') return [];
  return relationTargetsOf(row, propId, ps, ctx);
}

/** Rollup value of a row (value + aggregation + target schema for rendering). */
export function computeRollup(row: BlockRecord, propId: string, schema: Record<string, PropertySchema> | undefined, ctx: RelationContext): RollupEvaluation {
  return evaluateRollupWith(row, propId, ctx, schema);
}

/** Relation value encoding: [["‣",[["p",id,spaceId]]],[","],["‣",[["p",id2,spaceId]]]] */
export function encodeRelation(ids: string[], spaceId?: string): RichText {
  const out: Decoration[] = [];
  ids.forEach((id, i) => {
    if (i) out.push([',']);
    out.push(['‣', [(spaceId ? ['p', id, spaceId] : ['p', id]) as unknown as ['p', string]]]);
  });
  return out;
}

export interface RelationChange {
  blockId: string;
  propId: string;
  value: RichText;
}

/**
 * Plan the property writes for setting a relation value, including the reverse side of a two-way relation
 * (Litpage keeps both sides in sync: adding B to A.Rel adds A to B.Reverse; removal likewise).
 */
export function planRelationChange(opts: {
  row: BlockRecord;
  propId: string;
  schema: Record<string, PropertySchema>;
  nextIds: string[];
  getBlock(id: string): BlockRecord | undefined;
  getSchema(collectionId: string): Record<string, PropertySchema> | undefined;
}): RelationChange[] {
  const { row, propId, schema, getBlock } = opts;
  const ps = schema[propId];
  if (!ps || ps.type !== 'relation') return [];
  let next = [...new Set(opts.nextIds)];
  if (typeof ps.limit === 'number' && ps.limit > 0) next = next.slice(-ps.limit);
  const before = relationIdsOf(row.properties?.[propId] as Decoration[] | undefined);
  const changes: RelationChange[] = [{ blockId: row.id, propId, value: encodeRelation(next, row.space_id) }];
  const reverse = ps.property as string | undefined;
  const targetCol = ps.collection_id as string | undefined;
  if (!reverse || !targetCol) return changes;
  const reverseSchema = opts.getSchema(targetCol)?.[reverse];
  if (!reverseSchema || reverseSchema.type !== 'relation') return changes;
  const pending = new Map<string, string[]>(); // target id -> new reverse ids
  const current = (t: BlockRecord) => pending.get(t.id) ?? relationIdsOf(t.properties?.[reverse] as Decoration[] | undefined);
  for (const id of next.filter((x) => !before.includes(x))) {
    const t = getBlock(id);
    if (!t || t.id === row.id && reverse === propId) continue;
    let ids = current(t);
    if (!ids.includes(row.id)) {
      ids = [...ids, row.id];
      if (typeof reverseSchema.limit === 'number' && reverseSchema.limit > 0) ids = ids.slice(-reverseSchema.limit);
      pending.set(t.id, ids);
    }
  }
  for (const id of before.filter((x) => !next.includes(x))) {
    const t = getBlock(id);
    if (!t) continue;
    const ids = current(t);
    if (ids.includes(row.id)) pending.set(t.id, ids.filter((x) => x !== row.id));
  }
  for (const [id, ids] of pending) changes.push({ blockId: id, propId: reverse, value: encodeRelation(ids, getBlock(id)?.space_id) });
  return changes;
}

/** Schema objects for a new relation property (+ reverse property for two-way relations). */
export function relationSchemas(opts: {
  name: string;
  sourceCollectionId: string;
  sourcePropId: string;
  targetCollectionId: string;
  spaceId?: string;
  limit?: number;
  twoWay: boolean;
  reverseName?: string;
  reversePropId?: string;
}): { source: PropertySchema; reverse?: { collectionId: string; propId: string; schema: PropertySchema } } {
  const self = opts.sourceCollectionId === opts.targetCollectionId;
  const pointer = (id: string) => ({ id, table: 'collection', spaceId: opts.spaceId });
  const source: PropertySchema = {
    name: opts.name, type: 'relation', collection_id: opts.targetCollectionId, collection_pointer: pointer(opts.targetCollectionId), version: 'v2',
    ...(opts.limit ? { limit: opts.limit } : {}),
  } as PropertySchema;
  if (opts.twoWay && opts.reversePropId) {
    source.property = opts.reversePropId;
    const reverse: PropertySchema = {
      name: opts.reverseName || 'Related', type: 'relation', collection_id: opts.sourceCollectionId, collection_pointer: pointer(opts.sourceCollectionId),
      property: opts.sourcePropId, version: 'v2',
    } as PropertySchema;
    return { source, reverse: { collectionId: opts.targetCollectionId, propId: opts.reversePropId, schema: reverse } };
  }
  // self relation without a second property acts symmetrically (Litpage: one property, both directions)
  if (self) source.property = opts.sourcePropId;
  return { source };
}

/** Rollup schema (aggregation "show_original" when undefined). */
export function rollupSchema(opts: { name: string; relationProperty?: string; targetProperty?: string; targetPropertyType?: string; aggregation?: string }): PropertySchema {
  return {
    name: opts.name, type: 'rollup',
    ...(opts.relationProperty ? { relation_property: opts.relationProperty } : {}),
    ...(opts.targetProperty ? { target_property: opts.targetProperty } : {}),
    ...(opts.targetPropertyType ? { target_property_type: opts.targetPropertyType } : {}),
    aggregation: opts.aggregation ?? 'show_original',
  } as PropertySchema;
}
