// Database access rules shared by the web client and the server (DB-PERM):
//   - "Lock database" = format.block_locked on the database block (collection_view / collection_view_page). It freezes
//     views (filters, sorts, groups, layout), the property schema (incl. select options) and templates; rows can still be
//     added and edited (Litpage: "Lock database … still allows them to enter and edit data").
//   - database-only share roles: "Can edit content" = role 'content_only_editor' (rows editable, views/schema not) and
//     "Can also create pages" = Permission.can_create_pages_in_collection (Can view and create / Can comment and
//     create / Can only create: new rows yes, existing rows only through other access).
//   - page-level access rules (collection.permission_rules [편차: storage key is ours]): people selected in a Person /
//     Created by property get a role on that row page (and everything inside it). The widest access wins.
// The server applies these through the role extension below (permissions.ts effectiveRole) and the TxGuard hook in
// apps/server/src/dbaccess.ts; the client uses the same predicates to decide what to offer.
import type { BlockRecord, CollectionRecord, Permission, PropertySchema, Role, SpaceRecord } from '../records.ts';
import { isSpaceMember, maxRole, registerRoleExtension, roleAtLeast, type PermissionLookup } from '../permissions.ts';

export const DATABASE_BLOCK_TYPES = new Set(['collection_view', 'collection_view_page']);

export function isDatabaseBlock(b: { type?: string } | undefined | null): boolean {
  return !!b && DATABASE_BLOCK_TYPES.has(String(b.type));
}

/** "Lock database" is on (views, filters/sorts and the property schema are frozen; data entry still works). */
export function isDatabaseLocked(block: { format?: Record<string, unknown> } | undefined | null): boolean {
  return !!block?.format?.block_locked;
}

/** May change views, filters, sorts, groups and properties: Can edit / Full access, and the database is unlocked. */
export function canEditDatabaseStructure(role: string | undefined, block?: { format?: Record<string, unknown> } | null): boolean {
  return roleAtLeast(role, 'read_and_write') && !isDatabaseLocked(block);
}

/** May add, edit and delete rows: Can edit content and up (a lock does not matter). */
export function canEditDatabaseContent(role: string | undefined): boolean {
  return role === 'content_only_editor' || roleAtLeast(role, 'read_and_write');
}

/** Lock / unlock the database: anyone with edit access (Litpage: "편집 권한자는 누구나 토글 가능"). */
export function canToggleDatabaseLock(role: string | undefined): boolean {
  return roleAtLeast(role, 'read_and_write');
}

// ------------------------------------------------------------------ Can create

/** The permission item of `dbBlock` that lets `userId` create pages (its own entry or the workspace entry). */
export function createPermissionOf(dbBlock: Pick<BlockRecord, 'permissions'> | undefined, userId: string | null | undefined, spaceMember: boolean): Permission | undefined {
  if (!dbBlock || !userId) return undefined;
  return (dbBlock.permissions ?? []).find((p) => !!p && p.can_create_pages_in_collection === true
    && ((p.type === 'user_permission' && p.user_id === userId) || (p.type === 'space_permission' && spaceMember)));
}

export function hasCreatePermission(lookup: Pick<PermissionLookup, 'space'>, dbBlock: BlockRecord | undefined, userId: string | null | undefined): boolean {
  if (!dbBlock || !userId) return false;
  const member = isSpaceMember(lookup.space(dbBlock.space_id) as SpaceRecord | undefined, userId);
  return !!createPermissionOf(dbBlock, userId, member);
}

// ------------------------------------------------------------------ page-level access rules

export interface PageAccessRule {
  id: string;
  /** Person or Created by property of the data source */
  property: string;
  role: Role;
  added_timestamp?: number;
}

/** Roles a page-level rule can grant (Share › Page-level access › role). */
export const PAGE_RULE_ROLES: Role[] = ['editor', 'read_and_write', 'comment_only', 'reader'];

export function pageAccessRulesOf(c: Pick<CollectionRecord, 'schema'> & { permission_rules?: unknown } | undefined): PageAccessRule[] {
  const list = (c as { permission_rules?: unknown } | undefined)?.permission_rules;
  if (!Array.isArray(list)) return [];
  return list.filter((r): r is PageAccessRule => !!r && typeof r === 'object' && typeof (r as PageAccessRule).property === 'string' && typeof (r as PageAccessRule).role === 'string'
    && !!c?.schema?.[(r as PageAccessRule).property]);
}

/** Properties a page-level rule can be based on: Person and Created by. */
export function ruleCandidateProperties(schema: Record<string, PropertySchema>): [string, PropertySchema][] {
  return Object.entries(schema).filter(([, p]) => p.type === 'person' || p.type === 'created_by');
}

/** User ids "in" a person-like property of a row (Person values, Created by). */
export function rowPeople(row: Pick<BlockRecord, 'properties' | 'created_by_id' | 'last_edited_by_id'>, prop: PropertySchema | undefined, propId: string): string[] {
  if (!prop) return [];
  if (prop.type === 'created_by') return row.created_by_id ? [row.created_by_id] : [];
  if (prop.type === 'last_edited_by') return row.last_edited_by_id ? [row.last_edited_by_id] : [];
  if (prop.type !== 'person') return [];
  const out: string[] = [];
  for (const d of (row.properties?.[propId] ?? []) as unknown[]) {
    const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as unknown[]) : [];
    for (const a of anns) if (Array.isArray(a) && a[0] === 'u' && typeof a[1] === 'string') out.push(a[1]);
  }
  return out;
}

/** Highest role the page-level rules of `collection` give `userId` on `row` ('none' when no rule matches). */
export function rowRuleRole(row: Pick<BlockRecord, 'properties' | 'created_by_id' | 'last_edited_by_id'>, collection: Pick<CollectionRecord, 'schema'> & { permission_rules?: unknown }, userId: string): Role {
  let role: Role = 'none';
  for (const rule of pageAccessRulesOf(collection)) {
    if (rowPeople(row, collection.schema[rule.property], rule.property).includes(userId)) role = maxRole(role, rule.role);
  }
  return role;
}

// ------------------------------------------------------------------ role extension (server: effectiveRole)

/**
 * Raises the inherited role of block `id`:
 *   - inside a database row: page-level rules of every database the chain passes through; "Can edit content" on the
 *     database becomes "Can edit" on its rows (and their contents)
 *   - the database block itself for "Can only create" people: they see the database (views, schema) but not its rows
 */
export function databaseRoleExtension(lookup: PermissionLookup, id: string, userId: string | null, role: Role): Role {
  if (!userId) return role;
  const start = lookup.block(id);
  if (!start) return role;
  let out = role;
  let inRow = false;
  let cur: BlockRecord | undefined = start;
  for (let i = 0; cur && i < 500; i++) {
    if (cur.parent_table === 'collection') {
      const col = lookup.collection(cur.parent_id) as (CollectionRecord & { permission_rules?: unknown }) | undefined;
      if (!col) break;
      inRow = true;
      if (Array.isArray(col.permission_rules) && col.permission_rules.length) out = maxRole(out, rowRuleRole(cur, col, userId));
      cur = lookup.block(col.parent_id);
      continue;
    }
    if (cur.parent_table !== 'block') break;
    cur = lookup.block(cur.parent_id);
  }
  if (inRow && out === 'content_only_editor') out = 'read_and_write';
  if (!roleAtLeast(out, 'reader') && isDatabaseBlock(start) && hasCreatePermission(lookup, start, userId)) out = 'reader';
  return out;
}

registerRoleExtension(databaseRoleExtension);
