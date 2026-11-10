// Record-store backed contexts for the formula/relation engines (packages/shared/src/formula, relation).
import type { BlockRecord, CollectionRecord, PropertySchema, UserRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { systemZoneName, type FormulaContext } from '@nc/shared/formula/index.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';

export function userTimeZone(): string {
  const userId = useSession.getState().userId;
  const settings = records.get<UserSettingsRecord>('user_settings', userId);
  const tz = settings?.settings?.time_zone;
  // Settings › Set time zone automatically (default on) → the device zone; off → the chosen zone
  if (settings?.settings?.time_zone_auto !== false) return systemZoneName();
  return typeof tz === 'string' && tz ? tz : systemZoneName();
}

/** 0 = Sunday (en-US default), 1 = Monday (Settings › Start week on Monday). */
export function startOfWeekSetting(): 0 | 1 {
  const userId = useSession.getState().userId;
  const settings = records.get<UserSettingsRecord>('user_settings', userId);
  return settings?.settings?.start_day_of_week === 1 ? 1 : 0;
}

export function formulaContext(): FormulaContext {
  return {
    getBlock: (id) => records.get<BlockRecord>('block', id),
    getCollection: (id) => records.get<CollectionRecord>('collection', id),
    getUser: (id) => records.get<UserRecord>('lit_user', id),
    timeZone: userTimeZone(),
  };
}

export function getCollection(id: string | undefined | null): CollectionRecord | undefined {
  return records.get<CollectionRecord>('collection', id);
}

export function schemaOf(collectionId: string | undefined | null): Record<string, PropertySchema> {
  return getCollection(collectionId)?.schema ?? {};
}

/** Alive, non-template rows of a data source (creation order). */
export function rowsOfCollection(collectionId: string | undefined | null): BlockRecord[] {
  if (!collectionId) return [];
  const out: BlockRecord[] = [];
  for (const b of records.all<BlockRecord>('block')) {
    if (b.parent_table === 'collection' && b.parent_id === collectionId && b.alive && !b.is_template) out.push(b);
  }
  return out.sort((a, b) => (a.created_time ?? 0) - (b.created_time ?? 0) || (a.id < b.id ? -1 : 1));
}

export function titleOf(b: BlockRecord | undefined): string {
  return (b?.properties?.title ?? []).map((d) => d[0]).join('');
}

/** Name of a data source (collection.name rich text). */
export function collectionName(c: CollectionRecord | undefined): string {
  return (c?.name ?? []).map((d) => d[0]).join('') || 'Untitled';
}
