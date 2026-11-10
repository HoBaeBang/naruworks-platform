// What the current user may do with a database (client side of packages/shared/src/database/access.ts):
// lock state, structure (views / schema) vs content (rows) editing, "Can also create pages".
import type { BlockRecord, CollectionRecord, Role, SpaceRecord } from '@nc/shared/records.ts';
import {
  canEditDatabaseContent, canEditDatabaseStructure, canEditPropertyValues, canSeePropertyValues, canToggleDatabaseLock, createPermissionOf, groupIdsOf,
  hasPropertyRule, isDatabaseLocked, propertyRoleFor,
} from '@nc/shared/database/index.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useBlock, useRole } from '../../lib/hooks.ts';

export interface DatabaseAccess {
  role: Role;
  
  locked: boolean;
  
  canEditStructure: boolean;
  
  canEditContent: boolean;
  
  canCreate: boolean;
  
  canToggleLock: boolean;
}

export function databaseAccessOf(block: BlockRecord | undefined, role: Role): DatabaseAccess {
  const locked = isDatabaseLocked(block);
  const canEditContent = canEditDatabaseContent(role);
  const uid = useSession.getState().userId;
  const space = block ? records.get<SpaceRecord>('space', block.space_id) : undefined;
  const canCreate = canEditContent || !!createPermissionOf(block, uid, !!uid && isSpaceMember(space, uid));
  return { role, locked, canEditStructure: canEditDatabaseStructure(role, block), canEditContent, canCreate, canToggleLock: canToggleDatabaseLock(role) };
}


export function useDatabaseAccess(blockId: string | undefined): DatabaseAccess {
  const block = useBlock(blockId);
  const role = useRole('block', blockId);
  return databaseAccessOf(block, role);
}


export function hostBlockOfCollection(collectionId: string | undefined): BlockRecord | undefined {
  const c = collectionId ? records.get<CollectionRecord>('collection', collectionId) : undefined;
  return c ? records.get<BlockRecord>('block', c.parent_id) : undefined;
}


export function useCollectionAccess(collectionId: string | undefined): DatabaseAccess {
  const c = collectionId ? records.get<CollectionRecord>('collection', collectionId) : undefined;
  return useDatabaseAccess(c?.parent_id);
}


export function collectionAccess(collectionId: string | undefined): DatabaseAccess {
  const host = hostBlockOfCollection(collectionId);
  return databaseAccessOf(host, records.role('block', host?.id));
}


export function propertyAccessFor(collectionId: string | undefined, propId: string, row?: BlockRecord): { canSeeValues: boolean; canEditValues: boolean } {
  const c = collectionId ? records.get<CollectionRecord>('collection', collectionId) : undefined;
  const prop = c?.schema[propId];
  if (!c || !prop || !hasPropertyRule(prop)) return { canSeeValues: true, canEditValues: true };
  const uid = useSession.getState().userId;
  const space = records.get<SpaceRecord>('space', c.space_id);
  const role = propertyRoleFor(prop, {
    userId: uid, databaseRole: records.role('block', c.parent_id), rowRole: row ? records.role('block', row.id) : undefined,
    groupIds: groupIdsOf(space, uid), row, schema: c.schema,
  });
  return { canSeeValues: canSeePropertyValues(role), canEditValues: canEditPropertyValues(role) };
}


export function canEditRow(rowId: string): boolean {
  return canEditDatabaseContent(records.role('block', rowId));
}


export function canWriteNewRowValue(collectionId: string | undefined, propId: string, props: Record<string, unknown> = {}): boolean {
  const c = collectionId ? records.get<CollectionRecord>('collection', collectionId) : undefined;
  const prop = c?.schema[propId];
  if (!c || !prop || !hasPropertyRule(prop)) return true;
  const uid = useSession.getState().userId;
  const space = records.get<SpaceRecord>('space', c.space_id);
  const role = propertyRoleFor(prop, {
    userId: uid, databaseRole: records.role('block', c.parent_id), rowRole: 'editor', groupIds: groupIdsOf(space, uid),
    row: { properties: props as BlockRecord['properties'], created_by_id: uid ?? '' } as BlockRecord, schema: c.schema,
  });
  return canEditPropertyValues(role);
}
