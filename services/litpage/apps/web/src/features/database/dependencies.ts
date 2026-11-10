// Dependencies on the client (…011): automatic date shifting runs as a transaction commit hook, so every
// way of changing a date (cell date picker, timeline drag / resize, calendar drag, property menus, buttons) shifts the
// blocked items in the same transaction — one undo step reverts the edit and its shifts. Also turn on / off.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import {
  dependencyConfigOf, itemDatesOf, planDependencyShifts, shiftWrites, type DateShiftMode, type DependencyConfig,
} from '@nc/shared/database/index.ts';
import { transactions, type Tx } from '../../lib/store/transactions.ts';
import { records } from '../../lib/store/records.ts';
import { run, touch } from '../../lib/blocks.ts';
import { newPropertyId as newPropId, nullify } from './actions.ts';

function shiftOnCommit(tx: Tx) {
  if (tx.userAction === 'dependencies.shift') return;
  const n = tx.ops.length;
  // rows whose shifting date property changed in this transaction → their properties before it
  const touched = new Map<string, { cfg: DependencyConfig; before: Record<string, unknown> }>();
  for (let i = 0; i < n; i++) {
    const op = tx.ops[i];
    if (op.pointer.table !== 'block' || op.command !== 'set' || op.path[0] !== 'properties' || op.path.length !== 2) continue;
    const row = records.get<BlockRecord>('block', op.pointer.id);
    if (!row || row.parent_table !== 'collection') continue;
    let entry = touched.get(row.id);
    if (!entry) {
      const cfg = dependencyConfigOf(records.get<CollectionRecord>('collection', row.parent_id));
      if (!cfg?.mode || !cfg.dateProperty) continue;
      entry = { cfg, before: {} };
      touched.set(row.id, entry);
    }
    const pid = op.path[1];
    // the first write's inverse holds the value from before the transaction
    if (!(pid in entry.before)) entry.before[pid] = tx.inverse[i]?.args;
  }
  for (const [rowId, { cfg, before }] of touched) {
    if (!(cfg.dateProperty! in before) && !(cfg.endDateProperty && cfg.endDateProperty in before)) continue;
    const row = records.get<BlockRecord>('block', rowId);
    if (!row) continue;
    const prevRow = { ...row, properties: { ...(row.properties ?? {}) } } as BlockRecord;
    for (const [pid, v] of Object.entries(before)) {
      if (v === undefined) delete (prevRow.properties as Record<string, unknown>)[pid];
      else (prevRow.properties as Record<string, unknown>)[pid] = v;
    }
    const shifts = planDependencyShifts({
      changedRowId: rowId,
      before: itemDatesOf(prevRow, cfg),
      after: itemDatesOf(row, cfg),
      config: cfg,
      getRow: (id) => records.get<BlockRecord>('block', id),
    });
    for (const s of shifts) {
      for (const w of shiftWrites(s, cfg)) tx.set('block', s.rowId, ['properties', w.propId], w.value);
      touch(tx, s.rowId);
    }
  }
}

transactions.addCommitHook(shiftOnCommit);

/** First date property of a data source (default "Shift using"). */
export function firstDateProperty(schema: Record<string, PropertySchema>): string | undefined {
  return Object.keys(schema).find((id) => schema[id].type === 'date');
}

/* * “Turn on dependencies”: use an existing self relation or create “Blocking” and “Blocked by”. * Default date shifting uses overlap checks and avoids weekends.
 */
export function turnOnDependencies(collection: CollectionRecord, opts: { relation?: string; name?: string; mode?: DateShiftMode | null; avoidWeekends?: boolean; dateProperty?: string; endDateProperty?: string; view?: CollectionViewRecord } = {}): string {
  let blocking = opts.relation;
  run('dependencies.turnOn', (tx) => {
    const schema = { ...collection.schema };
    if (!blocking) {
      blocking = newPropId(schema);
      const inverse = newPropId({ ...schema, [blocking]: true });
      const pointer = { id: collection.id, table: 'collection', spaceId: collection.space_id };
      tx.set('collection', collection.id, ['schema', blocking], { name: opts.name?.trim() || 'Blocking', type: 'relation', collection_id: collection.id, collection_pointer: pointer, property: inverse, version: 'v2', autoRelate: { enabled: false } } as PropertySchema);
      tx.set('collection', collection.id, ['schema', inverse], { name: 'Blocked by', type: 'relation', collection_id: collection.id, collection_pointer: pointer, property: blocking, version: 'v2', autoRelate: { enabled: false } } as PropertySchema);
    }
    let dateProperty = opts.dateProperty ?? firstDateProperty(collection.schema);
    if (!dateProperty) {
      dateProperty = newPropId({ ...schema, [blocking]: true });
      tx.set('collection', collection.id, ['schema', dateProperty], { name: 'Date', type: 'date' } as PropertySchema);
    }
    tx.update('collection', collection.id, ['format'], {
      collection_default_arrows_by: blocking,
      dependency_date_shifting_config: { mode: opts.mode === null ? undefined : opts.mode ?? 'consume_gap', avoid_weekends: opts.avoidWeekends ?? true, date_property: dateProperty, ...(opts.endDateProperty ? { end_date_property: opts.endDateProperty } : {}) },
    });
    if (opts.view?.type === 'timeline') tx.update('collection_view', opts.view.id, ['format'], { timeline_arrows_by: { property: blocking } });
  });
  return blocking ?? '';
}

export function updateDependencySettings(collection: CollectionRecord, patch: Partial<{ mode: DateShiftMode | null; avoid_weekends: boolean; date_property: string; end_date_property: string | null }>) {
  const cur = (collection.format?.dependency_date_shifting_config ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...cur, ...patch };
  if (next.mode === null) delete next.mode;
  if (next.end_date_property === null) delete next.end_date_property;
  run('dependencies.update', (tx) => tx.update('collection', collection.id, ['format'], { dependency_date_shifting_config: next }));
}

/** "Turn off dependencies" (optionally deleting the relation pair: "Remove properties"). */
export function turnOffDependencies(collection: CollectionRecord, removeProperties: boolean) {
  const cfg = dependencyConfigOf(collection);
  run('dependencies.turnOff', (tx) => {
    tx.update('collection', collection.id, ['format'], nullify({ collection_default_arrows_by: undefined, dependency_date_shifting_config: undefined }));
    for (const v of records.all<CollectionViewRecord>('collection_view')) {
      const ab = (v.format as Record<string, any> | undefined)?.timeline_arrows_by?.property;
      if (cfg && ab && (ab === cfg.blocking || ab === cfg.blockedBy)) tx.update('collection_view', v.id, ['format'], { timeline_arrows_by: null });
    }
    if (removeProperties && cfg) {
      for (const pid of [cfg.blocking, cfg.blockedBy]) {
        if (!pid || !collection.schema[pid]) continue;
        tx.set('collection', collection.id, ['deleted_schema', pid], { ...collection.schema[pid], deleted_time: Date.now() });
        tx.set('collection', collection.id, ['schema', pid], undefined);
      }
    }
  });
}

export type { RichText };
