// React bindings for the record store.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type {
  BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, SpaceViewRecord, Table, TeamRecord, UserRecord, UserRootRecord, UserSettingsRecord,
} from '@nc/shared/records.ts';
import { records } from './store/records.ts';
import { useSession } from './store/session.ts';

export function useRecord<T = any>(table: Table, id: string | null | undefined): T | undefined {
  const key = id ? `${table}:${id}` : '';
  const subscribe = useCallback((cb: () => void) => (key ? records.subscribe(key, cb) : () => {}), [key]);
  const get = useCallback(() => (id ? (records.get(table, id) as T | undefined) : undefined), [table, id]);
  return useSyncExternalStore(subscribe, get, get);
}

export const useBlock = (id: string | null | undefined) => useRecord<BlockRecord>('block', id);
export const useCollection = (id: string | null | undefined) => useRecord<CollectionRecord>('collection', id);
export const useCollectionView = (id: string | null | undefined) => useRecord<CollectionViewRecord>('collection_view', id);
export const useUser = (id: string | null | undefined) => useRecord<UserRecord>('lit_user', id);
export const useSpace = (id: string | null | undefined) => useRecord<SpaceRecord>('space', id);
export const useTeam = (id: string | null | undefined) => useRecord<TeamRecord>('team', id);

export function useRole(table: Table, id: string | null | undefined) {
  const key = id ? `${table}:${id}` : '';
  const subscribe = useCallback((cb: () => void) => (key ? records.subscribe(key, cb) : () => {}), [key]);
  const get = useCallback(() => records.role(table, id), [table, id]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Subscribe to several records at once; returns a stable array until any of them changes. */
export function useRecords<T = any>(table: Table, ids: readonly string[] | undefined): (T | undefined)[] {
  const list = ids ?? [];
  const cache = useRef<(T | undefined)[]>([]);
  const subscribe = useCallback(
    (cb: () => void) => {
      const unsubs = list.map((id) => records.subscribe(`${table}:${id}`, cb));
      return () => unsubs.forEach((u) => u());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, list.join(',')],
  );
  const get = useCallback(() => {
    const values = list.map((id) => records.get(table, id) as T | undefined);
    const prev = cache.current;
    if (values.length === prev.length && values.every((v, i) => v === prev[i])) return prev;
    cache.current = values;
    return values;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, list.join(',')]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Re-render whenever any record of `table` changes (use sparingly: sidebar trees, database views). */
export function useTableVersion(tables: Table[]): number {
  const ver = useRef(0);
  const subscribe = useCallback(
    (cb: () => void) =>
      records.subscribeAll((keys) => {
        if (keys.some((k) => tables.some((t) => k.startsWith(t + ':')))) {
          ver.current++;
          cb();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables.join(',')],
  );
  const get = useCallback(() => ver.current, []);
  return useSyncExternalStore(subscribe, get, get);
}

export function useCurrentUser(): UserRecord | undefined {
  const userId = useSession((s) => s.userId);
  return useUser(userId);
}

export function useUserSettings(): UserSettingsRecord | undefined {
  const userId = useSession((s) => s.userId);
  return useRecord<UserSettingsRecord>('user_settings', userId);
}

export function useCurrentSpace(): SpaceRecord | undefined {
  const spaceId = useSession((s) => s.spaceId);
  return useSpace(spaceId);
}

export function useCurrentSpaceView(): SpaceViewRecord | undefined {
  const userId = useSession((s) => s.userId);
  const spaceId = useSession((s) => s.spaceId);
  const root = useRecord<UserRootRecord>('user_root', userId);
  const views = useRecords<SpaceViewRecord>('space_view', root?.space_views);
  return views.find((v) => v?.space_id === spaceId);
}
