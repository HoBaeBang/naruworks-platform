// Property access ("Property access" / column permissions): per-property rules that narrow (or, for
// specific people, change) who can see a property and edit its values.
// schema[propId].property_permissions = { default_access, overrides[] }
// The rule lives on the property; the server redacts values when records are sent (apps/server
// propaccess.ts) and refuses writes the rule doesn't allow (apps/server dbaccess.ts).
// Resolution:
// - Full access to the database → always full access to the property
// - otherwise the highest matching exception (person, group, person property / page creator on that page) wins;
// person-property exceptions only apply to people who can see the property at all
// - no exception → the default ("Use database access" = the person's role on the database / the page)
// Editing values also needs edit access to the page itself (a rule never lifts a viewer to an editor).
import type { BlockRecord, PropertySchema, Role, SpaceRecord } from '../records.ts';
import { roleAtLeast } from '../permissions.ts';
import { rowPeople } from './access.ts';

export type PropertyRole = 'editor' | 'read_and_write' | 'content_only_editor' | 'comment_only' | 'reader' | 'schema_only' | 'none';
export type PropertyDefaultAccess = 'inherit' | 'read_and_write' | 'content_only_editor' | 'reader' | 'schema_only' | 'none';

export interface PropertyPermissionOverride {
  type: 'user_permission' | 'group_permission' | 'collection_property_permission';
  user_id?: string;
  group_id?: string;
  /** person-like property of this database ("When selected in …" / "Page creator") */
  property_info?: { property_id: string; type: 'person' | 'created_by' };
  role: PropertyRole;
}

export interface PropertyPermissions {
  default_access: PropertyDefaultAccess;
  overrides?: PropertyPermissionOverride[];
}

/** Most properties with access rules per database ("Properties with access rules have exceeded the limit"). */
export const MAX_RESTRICTED_PROPERTIES = 20;

/** Types that can't have access rules (title, ID, created/edited, place). */
export const NON_RESTRICTABLE_TYPES = new Set(['title', 'created_by', 'created_time', 'last_edited_by', 'last_edited_time', 'auto_increment_id', 'location', 'place']);

const RANK: Record<string, number> = { none: 0, schema_only: 0.5, reader: 1, comment_only: 2, content_only_editor: 2.5, read_and_write: 3, editor: 4 };
const rank = (r: string | undefined) => RANK[r ?? 'none'] ?? 0;

export const DEFAULT_ACCESS_OPTIONS: { id: PropertyDefaultAccess; label: string; description: string }[] = [
  { id: 'inherit', label: 'Use database access', description: 'Follow each person’s access to this database' },
  { id: 'read_and_write', label: 'Edit property and values', description: 'Change this property’s settings and values' },
  { id: 'content_only_editor', label: 'Edit values only', description: 'Change values in this property' },
  { id: 'reader', label: 'View property and values', description: 'See this property and its values' },
  { id: 'schema_only', label: 'View property only', description: 'See the property without its values' },
  { id: 'none', label: 'No access', description: 'Hide this property and its values' },
];

export const OVERRIDE_ROLE_OPTIONS: { id: PropertyRole; label: string; description: string }[] = [
  { id: 'editor', label: 'Full access', description: 'Change settings, values, and permissions' },
  { id: 'read_and_write', label: 'Edit property and values', description: 'Change this property’s settings and values' },
  { id: 'content_only_editor', label: 'Edit values only', description: 'Change values in this property' },
  { id: 'reader', label: 'View property and values', description: 'See this property and its values' },
  { id: 'schema_only', label: 'View property only', description: 'See the property without its values' },
  { id: 'none', label: 'No access', description: 'Hide this property and its values' },
];

/** Roles of a person-property / page-creator exception (they only apply on pages, after the property is visible). */
export const DYNAMIC_OVERRIDE_ROLE_OPTIONS: { id: PropertyRole; label: string; description: string }[] = [
  { id: 'content_only_editor', label: 'Edit values only', description: 'Change values in this property' },
  { id: 'reader', label: 'View values only', description: 'See this property’s values' },
  { id: 'none', label: 'No access', description: 'Hide this property’s values' },
];

export function propertyRoleLabel(role: string | undefined): string {
  if (role === 'inherit') return 'Use database access';
  return OVERRIDE_ROLE_OPTIONS.find((o) => o.id === role)?.label ?? (role === 'comment_only' ? 'Can comment' : 'No access');
}

export function propertyPermissionsOf(prop: PropertySchema | undefined): PropertyPermissions | undefined {
  const v = (prop as { property_permissions?: unknown } | undefined)?.property_permissions as PropertyPermissions | undefined;
  if (!v || typeof v !== 'object' || typeof v.default_access !== 'string') return undefined;
  return v;
}

/** The property has a rule that changes anyone's access (default isn't "inherit" or there are exceptions). */
export function hasPropertyRule(prop: PropertySchema | undefined): boolean {
  const p = propertyPermissionsOf(prop);
  return !!p && (p.default_access !== 'inherit' || (p.overrides?.length ?? 0) > 0);
}

export function restrictedPropertyIds(schema: Record<string, PropertySchema> | undefined): string[] {
  return Object.entries(schema ?? {}).filter(([, p]) => hasPropertyRule(p)).map(([id]) => id);
}

/** Can this property get an access rule? (not title/ID/created/edited/place, not the sub-item relation pair) */
export function canRestrictProperty(prop: PropertySchema | undefined, propId: string, subitemPropertyIds: string[] = []): boolean {
  if (!prop || propId === 'title') return false;
  if (NON_RESTRICTABLE_TYPES.has(prop.type)) return false;
  return !subitemPropertyIds.includes(propId);
}

/** Group ids `userId` belongs to (workspace settings groups). */
export function groupIdsOf(space: SpaceRecord | undefined, userId: string | null | undefined): string[] {
  if (!space || !userId) return [];
  const groups = ((space.settings as { groups?: { id: string; member_ids?: string[] }[] } | undefined)?.groups ?? []);
  return groups.filter((g) => g && g.id && (g.member_ids ?? []).includes(userId)).map((g) => g.id);
}

export interface PropertyAccessContext {
  userId: string | null | undefined;
  /** role on the database (schema-level visibility) */
  databaseRole: Role | string;
  /** role on the row page (value access; defaults to the database role) */
  rowRole?: Role | string;
  groupIds?: string[];
  row?: Pick<BlockRecord, 'properties' | 'created_by_id' | 'last_edited_by_id'>;
  schema?: Record<string, PropertySchema>;
}

function inheritRole(role: string | undefined): PropertyRole {
  if (!role || role === 'none') return 'none';
  if (role === 'editor' || role === 'owner' || role === 'membership_admin') return 'editor';
  if (role === 'read_and_write' || role === 'content_only_editor' || role === 'comment_only' || role === 'reader') return role;
  return 'none';
}

/**
 * Bounds on some principals' property roles: a Custom Agent never sees or edits more of a property than the
 * people who manage it (apps/server agents/access.ts registers that cap). A cap may only lower a role.
 */
export type PropertyRoleCap = (prop: PropertySchema | undefined, ctx: PropertyAccessContext, role: PropertyRole) => PropertyRole;
const roleCaps: PropertyRoleCap[] = [];
export function registerPropertyRoleCap(fn: PropertyRoleCap) {
  if (!roleCaps.includes(fn)) roleCaps.push(fn);
}

/** Role of the current person on a property (and, with `row`, on its value on that page). */
export function propertyRoleFor(prop: PropertySchema | undefined, ctx: PropertyAccessContext): PropertyRole {
  let role = ownPropertyRole(prop, ctx);
  for (const cap of roleCaps) {
    const capped = cap(prop, ctx, role);
    if (rank(capped) < rank(role)) role = capped;
  }
  return role;
}

function ownPropertyRole(prop: PropertySchema | undefined, ctx: PropertyAccessContext): PropertyRole {
  const base = ctx.row ? (ctx.rowRole ?? ctx.databaseRole) : ctx.databaseRole;
  if (roleAtLeast(String(ctx.databaseRole), 'editor')) return 'editor';
  if (!ctx.userId || ctx.databaseRole === 'none' && base === 'none') return 'none';
  const rules = propertyPermissionsOf(prop);
  if (!rules || !hasPropertyRule(prop)) return inheritRole(String(base));
  const fallback: PropertyRole = rules.default_access === 'inherit' ? inheritRole(String(base)) : rules.default_access;
  let best: PropertyRole | undefined;
  const take = (r: PropertyRole) => { if (best === undefined || rank(r) > rank(best)) best = r; };
  const groups = new Set(ctx.groupIds ?? []);
  for (const o of rules.overrides ?? []) {
    if (o.type === 'user_permission' && o.user_id === ctx.userId) take(o.role);
    else if (o.type === 'group_permission' && o.group_id && groups.has(o.group_id)) take(o.role);
  }
  const staticRole: PropertyRole = best ?? fallback;
  if (!ctx.row || staticRole === 'none') return staticRole;
  // person-property / page-creator exceptions (only for people who can see the property)
  let dyn: PropertyRole | undefined;
  for (const o of rules.overrides ?? []) {
    if (o.type !== 'collection_property_permission' || !o.property_info) continue;
    const pid = o.property_info.property_id;
    const people = o.property_info.type === 'created_by'
      ? (ctx.row.created_by_id ? [ctx.row.created_by_id] : [])
      : rowPeople(ctx.row, ctx.schema?.[pid] ?? { name: '', type: 'person' } as PropertySchema, pid);
    if (people.includes(String(ctx.userId)) && (dyn === undefined || rank(o.role) > rank(dyn))) dyn = o.role;
  }
  return dyn !== undefined && rank(dyn) > rank(staticRole) ? dyn : staticRole;
}

/** A stored property value that holds nothing ([] / [[""]]): new rows may carry it in any property. */
export function isEmptyPropertyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (!Array.isArray(v)) return false;
  return v.every((d) => Array.isArray(d) && !d[0] && !(Array.isArray(d[1]) && d[1].length));
}

/** Sees the property (column / page row) at all. */
export const canSeeProperty = (r: PropertyRole) => r !== 'none';
/** Sees its values. */
export const canSeePropertyValues = (r: PropertyRole) => rank(r) >= rank('reader');
/** May change values (also needs edit access to the page, see canEditDatabaseContent). */
export const canEditPropertyValues = (r: PropertyRole) => r === 'editor' || r === 'read_and_write' || r === 'content_only_editor';
/** May change the property's settings (name, type, options…). */
export const canEditPropertySettings = (r: PropertyRole) => r === 'editor' || r === 'read_and_write';

/** Where a person's access comes from (Preview as …). */
export function propertyAccessSource(prop: PropertySchema | undefined, ctx: PropertyAccessContext): { role: PropertyRole; via: string; conditional: { label: string; role: PropertyRole }[] } {
  const rules = propertyPermissionsOf(prop);
  const role = propertyRoleFor(prop, { ...ctx, row: undefined });
  const conditional: { label: string; role: PropertyRole }[] = [];
  if (roleAtLeast(String(ctx.databaseRole), 'editor')) return { role: 'editor', via: 'From database access', conditional };
  if (!ctx.databaseRole || ctx.databaseRole === 'none') return { role: 'none', via: 'No access to this database', conditional };
  let via = rules && rules.default_access !== 'inherit' ? 'From the default rule' : 'From database access';
  for (const o of rules?.overrides ?? []) {
    if (o.type === 'user_permission' && o.user_id === ctx.userId) via = 'From a person-specific rule';
    else if (o.type === 'group_permission' && o.group_id && (ctx.groupIds ?? []).includes(o.group_id) && via !== 'From a person-specific rule') via = 'From a group rule';
  }
  if (role !== 'none') {
    for (const o of rules?.overrides ?? []) {
      if (o.type !== 'collection_property_permission' || !o.property_info || rank(o.role) <= rank(role)) continue;
      const name = o.property_info.type === 'created_by' ? '' : ctx.schema?.[o.property_info.property_id]?.name ?? 'a person property';
      conditional.push({ label: o.property_info.type === 'created_by' ? 'When they created the item' : `When chosen in ${name}`, role: o.role });
    }
  }
  return { role, via, conditional };
}

/**
 * A data source's properties for access decisions: the live schema plus the deleted ones (collection.deleted_schema keeps
 * a deleted property — with its access rule — while its values stay on the rows, so "Restore" can bring it back).
 */
export function schemaWithDeleted(schema: Record<string, PropertySchema> | undefined, deleted: unknown): Record<string, PropertySchema> {
  const base = schema ?? {};
  if (!deleted || typeof deleted !== 'object') return base;
  let out: Record<string, PropertySchema> | null = null;
  for (const [pid, p] of Object.entries(deleted as Record<string, PropertySchema | null | undefined>)) {
    if (!p || typeof p !== 'object' || base[pid]) continue;
    out ??= { ...base };
    out[pid] = p;
  }
  return out ?? base;
}

export interface RedactRowOptions {
  /** collection.deleted_schema: values of deleted properties are masked by their rule like live ones */
  deleted?: unknown;
  /** drop values of properties in neither schema (deleted for good: no rule is left to mask them, nothing shows them) */
  orphans?: boolean;
}

/** A row as `ctx` may see it: values of properties the person can't see are dropped. */
export function redactRowProperties<T extends Pick<BlockRecord, 'properties' | 'created_by_id' | 'last_edited_by_id'>>(row: T, schema: Record<string, PropertySchema>, ctx: Omit<PropertyAccessContext, 'row' | 'schema'>, opts: RedactRowOptions = {}): T {
  const props = row.properties as Record<string, unknown> | undefined;
  if (!props) return row;
  const all = schemaWithDeleted(schema, opts.deleted);
  let out: Record<string, unknown> | null = null;
  for (const pid of restrictedPropertyIds(all)) {
    if (props[pid] === undefined) continue;
    if (canSeePropertyValues(propertyRoleFor(all[pid], { ...ctx, row, schema: all }))) continue;
    out ??= { ...props };
    delete out[pid];
  }
  // a restricted property deleted for good leaves its values on the rows without a rule to mask them
  if (opts.orphans) {
    for (const pid of Object.keys(props)) {
      if (pid === 'title' || all[pid]) continue;
      out ??= { ...props };
      delete out[pid];
    }
  }
  return out ? { ...row, properties: out } : row;
}

/** A schema as `ctx` may see it: properties with "No access" disappear. */
export function redactSchema(schema: Record<string, PropertySchema>, ctx: Omit<PropertyAccessContext, 'row' | 'schema'>): Record<string, PropertySchema> {
  let out: Record<string, PropertySchema> | null = null;
  for (const pid of restrictedPropertyIds(schema)) {
    if (canSeeProperty(propertyRoleFor(schema[pid], { ...ctx, row: undefined }))) continue;
    out ??= { ...schema };
    delete out[pid];
  }
  return out ?? schema;
}
