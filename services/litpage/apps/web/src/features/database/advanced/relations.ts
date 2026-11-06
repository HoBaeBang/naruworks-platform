
// writing A.Rel also writes B.Reverse in the same transaction (planRelationChange in packages/shared/src/relation).
import type { CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { encodeRelation, planRelationChange, relationIdsOf, relationSchemas, rollupSchema } from '@nc/shared/relation/index.ts';
import { propertiesKeyFor } from '@nc/shared/database/schema.ts';
import { getBlock, run, setProperty } from '../../../lib/blocks.ts';
import type { Tx } from '../../../lib/store/transactions.ts';
import { records } from '../../../lib/store/records.ts';
import { collectionName, getCollection, rowsOfCollection } from './context.ts';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+-./:;<=>?@[]^_`{|}~';


export function newPropId(schema: Record<string, unknown> = {}): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    if (s !== 'titl' && !schema[s]) return s;
  }
}


export function setRelationValue(rowId: string, propId: string, ids: string[], opts?: { action?: string }) {
  const row = getBlock(rowId);
  if (!row || row.parent_table !== 'collection') return;
  const col = getCollection(row.parent_id);
  if (!col) return;
  const changes = planRelationChange({
    row, propId, schema: col.schema, nextIds: ids,
    getBlock: (id) => getBlock(id),
    getSchema: (cid) => getCollection(cid)?.schema,
  });
  run(opts?.action ?? 'setRelationValue', (tx) => {
    for (const c of changes) setProperty(tx, c.blockId, c.propId, c.value.length ? c.value : undefined);
  });
}

export function addRelationTarget(rowId: string, propId: string, targetId: string) {
  const row = getBlock(rowId);
  const cur = relationIdsOf(row?.properties?.[propId] as never);
  if (cur.includes(targetId)) return;
  setRelationValue(rowId, propId, [...cur, targetId], { action: 'addRelation' });
}

export function removeRelationTarget(rowId: string, propId: string, targetId: string) {
  const row = getBlock(rowId);
  const cur = relationIdsOf(row?.properties?.[propId] as never);
  setRelationValue(rowId, propId, cur.filter((x) => x !== targetId), { action: 'removeRelation' });
}

interface ViewEntry {
  property: string;
  visible: boolean;
  width?: number;
  [k: string]: unknown;
}


function showInView(tx: Tx, view: CollectionViewRecord, propId: string, afterPropId?: string) {
  const key = propertiesKeyFor(view.type);
  const list = [...(((view.format as Record<string, unknown>)?.[key] as ViewEntry[] | undefined) ?? [])].filter((e) => e.property !== propId);
  let idx = list.length;
  if (afterPropId) {
    const i = list.findIndex((e) => e.property === afterPropId);
    if (i >= 0) idx = i + 1;
  }
  list.splice(idx, 0, { property: propId, visible: true, ...(view.type === 'table' ? { width: 200 } : {}) });
  tx.update('collection_view', view.id, ['format'], { [key]: list });
}


export function createRelationProperty(opts: {
  collectionId: string;
  name: string;
  targetCollectionId: string;
  limit?: number;
  twoWay: boolean;
  reverseName?: string;
  view?: CollectionViewRecord;
  afterPropId?: string;
  
  propId?: string;
}): string {
  const source = getCollection(opts.collectionId);
  const target = getCollection(opts.targetCollectionId);
  if (!source || !target) return '';
  const sourcePropId = opts.propId ?? newPropId(source.schema);
  const self = source.id === target.id;
  const reversePropId = opts.twoWay ? newPropId({ ...target.schema, ...(self ? { [sourcePropId]: true } : {}) }) : undefined;
  const { source: srcSchema, reverse } = relationSchemas({
    name: opts.name.trim() || target.schema.title?.name || collectionName(target),
    sourceCollectionId: source.id,
    sourcePropId,
    targetCollectionId: target.id,
    spaceId: source.space_id,
    limit: opts.limit,
    twoWay: opts.twoWay,
    reverseName: opts.reverseName?.trim() || collectionName(source),
    reversePropId,
  });
  run('collectionPropertyActions.addRelation', (tx) => {
    tx.set('collection', source.id, ['schema', sourcePropId], { ...srcSchema, autoRelate: { enabled: false } });
    if (reverse) tx.set('collection', reverse.collectionId, ['schema', reverse.propId], { ...reverse.schema, autoRelate: { enabled: false } });
    if (opts.view) showInView(tx, opts.view, sourcePropId, opts.afterPropId);
  });
  return sourcePropId;
}


export function setRelationLimit(collectionId: string, propId: string, limit: number | undefined) {
  run('collectionPropertyActions.setRelationLimit', (tx) => {
    if (limit) tx.update('collection', collectionId, ['schema', propId], { limit });
    else {
      const ps = getCollection(collectionId)?.schema[propId];
      if (ps) {
        const { limit: _l, ...rest } = ps;
        tx.set('collection', collectionId, ['schema', propId], rest);
      }
    }
  });
}


export function setRelationTwoWay(collectionId: string, propId: string, on: boolean, reverseName?: string) {
  const source = getCollection(collectionId);
  const ps = source?.schema[propId];
  if (!source || !ps || ps.type !== 'relation') return;
  const targetId = ps.collection_id as string | undefined;
  const target = getCollection(targetId);
  if (!target) return;
  const currentReverse = ps.property as string | undefined;
  const isSymmetricSelf = currentReverse === propId;
  run('collectionPropertyActions.setRelationTwoWay', (tx) => {
    if (on) {
      if (currentReverse && !isSymmetricSelf && target.schema[currentReverse]) return;
      const rid = newPropId(target.schema);
      tx.set('collection', target.id, ['schema', rid], {
        name: reverseName?.trim() || collectionName(source), type: 'relation', collection_id: source.id,
        collection_pointer: { id: source.id, table: 'collection', spaceId: source.space_id }, property: propId, version: 'v2', autoRelate: { enabled: false },
      });
      tx.update('collection', source.id, ['schema', propId], { property: rid });
      // backfill: every source row that points at a target adds itself to the target's reverse property
      const reverseValues = new Map<string, string[]>();
      for (const row of rowsOfCollection(source.id)) {
        for (const t of relationIdsOf(row.properties?.[propId] as never)) {
          const arr = reverseValues.get(t) ?? [];
          arr.push(row.id);
          reverseValues.set(t, arr);
        }
      }
      for (const [t, ids] of reverseValues) setProperty(tx, t, rid, encodeRelation(ids, target.space_id));
    } else {
      if (currentReverse && !isSymmetricSelf && target.schema[currentReverse]) {
        tx.set('collection', target.id, ['deleted_schema', currentReverse], { ...target.schema[currentReverse], deleted_time: Date.now() });
        tx.set('collection', target.id, ['schema', currentReverse], undefined);
      }
      const { property: _p, ...rest } = ps;
      tx.set('collection', source.id, ['schema', propId], source.id === target.id ? { ...rest, property: propId } : rest);
    }
  });
}


export function setRelationTarget(collectionId: string, propId: string, targetCollectionId: string) {
  const source = getCollection(collectionId);
  const ps = source?.schema[propId];
  const target = getCollection(targetCollectionId);
  if (!source || !ps || !target) return;
  run('collectionPropertyActions.setRelationTarget', (tx) => {
    const { property: _p, ...rest } = ps;
    tx.set('collection', source.id, ['schema', propId], {
      ...rest, type: 'relation', collection_id: target.id, collection_pointer: { id: target.id, table: 'collection', spaceId: target.space_id }, version: 'v2',
      ...(source.id === target.id ? { property: propId } : {}),
    });
    for (const row of rowsOfCollection(source.id)) if (row.properties?.[propId]) setProperty(tx, row.id, propId, undefined);
  });
}


export function updateRollup(collectionId: string, propId: string, patch: Partial<PropertySchema>) {
  const c = getCollection(collectionId);
  const ps = c?.schema[propId];
  if (!c || !ps) return;
  const next = { ...rollupSchema({ name: ps.name, relationProperty: ps.relation_property as string | undefined, targetProperty: ps.target_property as string | undefined, aggregation: ps.aggregation as string | undefined }), ...ps, ...patch };
  run('collectionPropertyActions.updateRollup', (tx) => tx.set('collection', c.id, ['schema', propId], next));
}


export function knownCollections(): CollectionRecord[] {
  return records.all<CollectionRecord>('collection').filter((c) => c.alive !== false && !!c.schema);
}

export { newId };
