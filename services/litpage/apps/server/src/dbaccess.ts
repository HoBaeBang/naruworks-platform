// Database write rules for applyTransactions (hooked into authz.ts TxGuard; shared predicates in
// packages/shared/src/database/access.ts):
//   - "Lock database": client operations may not change a locked database's views (filters, sorts, groups, layout),
//     its data source (schema, options, templates, page layout) or the database block itself (views list, trash,
//     appearance) — except the lock toggle and sharing. Rows stay editable, and "+ New page" may still append to a
//     view's manual order (page_sort).
//   - "Can edit content" (content_only_editor) and "Can also create pages": rows can be added by those people even though
//     they can't edit the database block; content editors may also maintain page_sort.
//   - page-level access rules (collection.permission_rules) and property access rules (schema[p].property_permissions)
//     are changed by people with full access only; restricted property values / settings follow the property rule
//     (reads are redacted in propaccess.ts) — on existing rows, on rows created or moved in by the call (any write:
//     client, API or server-built), and on deleted properties (deleted_schema keeps the rule).
//   - automated sprints run as format.sprint_settings.automated_by: only that person names themselves, for a Sprints
//     database they can edit.
// The structure rules (lock, schema guards) and value checks on existing rows apply to client writes and to server-built
// writes the person asked for (applyTransactions opts.userInitiated: Merge with CSV, Restore version, …).
// Every function returns a reason string to reject, null to allow, or undefined for "no opinion" (default checks run).
import type { BlockRecord, CollectionRecord, PropertySchema, Role, SpaceRecord, Table } from '@nc/shared/records.ts';
import {
  MAX_RESTRICTED_PROPERTIES, canEditPropertySettings, canEditPropertyValues, canRestrictProperty, groupIdsOf, hasPropertyRule,
  isEmptyPropertyValue, propertyRoleFor, restrictedPropertyIds, schemaWithDeleted,
} from '@nc/shared/database/propertyAccess.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import {
  canEditDatabaseContent, hasCreatePermission, isDatabaseBlock, isDatabaseLocked,
} from '@nc/shared/database/access.ts';
import { SUBITEM_MAX_DEPTH, childIdsOf, parentIdOf, subitemConfigOf, subitemLinkProblem, type SubitemConfig } from '@nc/shared/database/subitems.ts';

type Rec = Record<string, any>;

/** Stable JSON (sorted keys) for value comparison (same idea as authz.ts; kept local to avoid an import cycle). */
function stableJson(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Rec;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

/** The part of TxGuard these rules need (records as they are inside the running call). */
export interface GuardLike {
  readonly userId: string;
  readonly client: boolean;
  /** a server-built write the person asked for: the client rules below apply too */
  readonly userInitiated?: boolean;
  readonly created: Set<string>;
  get(table: Table, id: string | undefined | null): any;
  role(blockId: string | undefined | null): Role;
}

export const LOCKED_MESSAGE = 'This database is locked. Unlock it to change its views and properties.';

/** Client writes and server-built writes the person asked for (not server bookkeeping / automations). */
const enforced = (g: GuardLike) => g.client || !!g.userInitiated;

/** Format keys of a database block that stay editable while it is locked (the lock itself). */
const LOCK_KEYS = new Set(['block_locked', 'block_locked_by']);
/** Database block keys that never count as "structure" (sharing, comments, bookkeeping). */
const FREE_BLOCK_KEYS = new Set(['permissions', 'discussions', 'last_edited_time', 'last_edited_by_id', 'last_edited_by_table', 'parent_id', 'parent_table', 'moved']);

function formatChangedBeyondLock(before: Rec | undefined, after: Rec | undefined): boolean {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (LOCK_KEYS.has(k)) continue;
    if (stableJson(before?.[k]) !== stableJson(after?.[k])) return true;
  }
  return false;
}

/** Decision for an update of an existing block / collection / collection_view (see header). */
export function databaseUpdateDecision(g: GuardLike, table: Table, before: Rec, after: Rec, keys: Set<string>): string | null | undefined {
  if (table === 'collection') {
    const host = (g.get('block', before.parent_id) as BlockRecord | undefined);
    // page-level access rules are sharing: Full access only, and allowed while the database is locked
    if (keys.has('permission_rules') && !roleAtLeast(g.role(before.parent_id), 'editor')) return 'Only people with full access can change page-level access';
    if (keys.has('schema') && enforced(g)) {
      const problem = uniqueIdSchemaProblem(before, after) ?? propertySchemaProblem(g, before, after);
      if (problem) return problem;
    }
    // deleted properties keep their access rule (their values stay on the rows): changed by full access only
    if (keys.has('deleted_schema')) {
      const problem = deletedSchemaProblem(g, before, after);
      if (problem) return problem;
    }
    if (keys.has('format') && enforced(g)) {
      const problem = sprintSettingsProblem(g, before, after);
      if (problem) return problem;
    }
    const sharingOnly = [...keys].every((k) => k === 'permission_rules');
    if (!sharingOnly && enforced(g) && isDatabaseLocked(host) && !g.created.has(`block:${host?.id}`)) return LOCKED_MESSAGE;
    return undefined;
  }
  if (table === 'collection_view') {
    const host = (g.get('block', before.parent_id) as BlockRecord | undefined);
    const onlyOrder = [...keys].every((k) => k === 'page_sort');
    if (onlyOrder) {
      // manual row order is data entry: content editors, and everyone while the database is locked
      if (canEditDatabaseContent(g.role(before.parent_id))) return null;
      // "Can also create pages": may append the pages they create in this call, nothing else
      const col = host?.collection_id ? (g.get('collection', host.collection_id) as CollectionRecord | undefined) : undefined;
      if (col && canAddDatabaseRows(g, col) && onlyAppendsCreatedRows(g, before.page_sort, after.page_sort)) return null;
      return undefined;
    }
    if (enforced(g) && isDatabaseLocked(host)) return LOCKED_MESSAGE;
    return undefined;
  }
  if (table === 'block' && before.parent_table === 'collection' && keys.has('properties')) {
    const problem = subitemProblem(g, before, after) ?? relationLimitProblem(g, before, after) ?? (enforced(g) ? propertyValueProblem(g, before, after) : null);
    if (problem) return problem;
  }
  if (table === 'block' && isDatabaseBlock(before) && enforced(g) && isDatabaseLocked(before)) {
    for (const k of keys) {
      if (FREE_BLOCK_KEYS.has(k)) continue;
      if (k === 'format') {
        if (formatChangedBeyondLock(before.format, after.format)) return LOCKED_MESSAGE;
        continue;
      }
      if (k === 'alive') return 'Unlock this database before moving it to Trash.';
      return LOCKED_MESSAGE;
    }
  }
  return undefined;
}

function onlyAppendsCreatedRows(g: GuardLike, before: unknown, after: unknown): boolean {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const kept = next.filter((id) => !(typeof id === 'string' && g.created.has(`block:${id}`) && !prev.includes(id)));
  return kept.length === prev.length && kept.every((id, i) => id === prev[i]);
}

/** At most 10,000 related pages per page and relation. */
export const MAX_RELATED_PAGES = 10_000;
function relationLimitProblem(g: GuardLike, before: Rec, after: Rec): string | null {
  const col = g.get('collection', before.parent_id) as CollectionRecord | undefined;
  for (const [pid, p] of Object.entries(col?.schema ?? {})) {
    if (p?.type !== 'relation') continue;
    const v = after.properties?.[pid];
    if (!Array.isArray(v) || v.length <= MAX_RELATED_PAGES || stableJson(v) === stableJson(before.properties?.[pid])) continue;
    let n = 0;
    for (const d of v) if (Array.isArray(d) && Array.isArray(d[1]) && d[1].some((a: unknown) => Array.isArray(a) && a[0] === 'p')) n++;
    if (n > MAX_RELATED_PAGES) {
      const title = ((after.properties?.title ?? []) as unknown[][]).map((x) => String(x?.[0] ?? '')).join('') || 'Untitled';
      return `${title} has reached the 10,000 related-page limit`;
    }
  }
  return null;
}

/** Sub-item integrity (transactionErrors.collection_subitem_*): no self-parenting, no cycles, depth limit. */
function subitemProblem(g: GuardLike, before: Rec, after: Rec): string | null {
  const col = g.get('collection', before.parent_id) as CollectionRecord | undefined;
  const cfg = subitemConfigOf(col as never);
  if (!cfg) return null;
  const rowOf = (id: string) => (id === after.id ? after : g.get('block', id)) as BlockRecord | undefined;
  const parentOf = (id: string) => parentIdOf(rowOf(id), cfg);
  const heightOf = (id: string) => subtreeHeight(id, cfg, rowOf);
  const raw = (row: Rec, prop: string): string[] => {
    const out: string[] = [];
    for (const d of (row?.properties?.[prop] ?? []) as unknown[]) {
      const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as unknown[]) : [];
      for (const a of anns) if (Array.isArray(a) && a[0] === 'p' && typeof a[1] === 'string') out.push(a[1]);
    }
    return out;
  };
  // an item listing itself (as parent or sub-item) is refused outright
  if (raw(after, cfg.inverse).includes(after.id) || raw(after, cfg.property).includes(after.id)) {
    if (!raw(before, cfg.inverse).includes(after.id) && !raw(before, cfg.property).includes(after.id)) return 'An item cannot be its own parent or child.';
  }
  const prevParent = parentIdOf(before as BlockRecord, cfg);
  const nextParent = parentIdOf(after as BlockRecord, cfg);
  if (nextParent && nextParent !== prevParent) {
    const p = subitemLinkProblem(after.id, nextParent, (id) => (id === after.id ? nextParent : parentOf(id)), heightOf);
    if (p) return p;
  }
  const prevKids = new Set(childIdsOf(before as BlockRecord, cfg));
  for (const k of childIdsOf(after as BlockRecord, cfg)) {
    if (prevKids.has(k)) continue;
    const p = subitemLinkProblem(k, after.id, (id) => (id === k ? after.id : parentOf(id)), heightOf);
    if (p) return p;
  }
  return null;
}

function subtreeHeight(id: string, cfg: SubitemConfig, rowOf: (id: string) => BlockRecord | undefined, depth = 0, seen = new Set<string>()): number {
  if (depth > SUBITEM_MAX_DEPTH + 1 || seen.has(id)) return 0;
  seen.add(id);
  let h = 0;
  for (const c of childIdsOf(rowOf(id), cfg)) h = Math.max(h, 1 + subtreeHeight(c, cfg, rowOf, depth + 1, seen));
  return h;
}

// ------------------------------------------------------------------ Unique ID property (DB-UID)

const ID_PREFIX = /^[A-Za-z][A-Za-z0-9-]{1,9}$/;
export const MAX_PROPERTIES = 500;

/** Validate the database ID property and its prefix. */
function uniqueIdSchemaProblem(before: Rec, after: Rec): string | null {
  const bs = (before.schema ?? {}) as Record<string, PropertySchema>;
  const as = (after.schema ?? {}) as Record<string, PropertySchema>;
  const count = (s: Record<string, PropertySchema>) => Object.values(s).filter((p) => p?.type === 'auto_increment_id').length;
  if (count(as) > 1 && count(as) > count(bs)) return 'A database can have only one ID property';
  // transactionErrors.collection_properties_max_count_error 
  if (Object.keys(as).length > MAX_PROPERTIES && Object.keys(as).length > Object.keys(bs).length) return 'This database has reached its property limit. Delete one before adding another.';
  const verifications = (s: Record<string, PropertySchema>) => Object.values(s).filter((p) => p?.type === 'verification').length;
  if (verifications(as) > 1 && verifications(as) > verifications(bs)) return 'A database can have only one verification property.';
  for (const [pid, a] of Object.entries(as)) {
    const b = bs[pid];
    if (!a || !b || a.type === b.type) {
      if (a?.type === 'auto_increment_id' && a.prefix && a.prefix !== b?.prefix && !ID_PREFIX.test(String(a.prefix))) {
        return 'The prefix must begin with a letter, followed by up to 9 letters, numbers, or hyphens.';
      }
      continue;
    }
    if (b.type === 'auto_increment_id') return 'The ID property cannot be changed to another property type';
    if (a.type === 'auto_increment_id') return 'Other properties cannot be changed into an ID property';
  }
  return null;
}

// ------------------------------------------------------------------ property access 

const NO_PROPERTY_ACCESS = 'You don’t have access to edit this property';

function groupsOf(g: GuardLike, spaceId: string | undefined): string[] {
  return groupIdsOf(spaceId ? (g.get('space', spaceId) as SpaceRecord | undefined) : undefined, g.userId);
}

/** Schema changes: rules need Full access (and an eligible property, within the limit); settings of a restricted
 *  property need "Can edit property & values". */
function propertySchemaProblem(g: GuardLike, before: Rec, after: Rec): string | null {
  const bs = (before.schema ?? {}) as Record<string, PropertySchema>;
  const as = (after.schema ?? {}) as Record<string, PropertySchema>;
  const dbRole = g.role(before.parent_id);
  const full = roleAtLeast(dbRole, 'editor');
  const cfg = subitemConfigOf(after as never);
  const subitemIds = cfg ? [cfg.property, cfg.inverse] : [];
  let groups: string[] | null = null;
  for (const pid of new Set([...Object.keys(bs), ...Object.keys(as)])) {
    const b = bs[pid];
    const a = as[pid];
    if (stableJson(b) === stableJson(a)) continue;
    if (stableJson(b?.property_permissions) !== stableJson(a?.property_permissions)) {
      if (!full) return 'Only people with full access to this database can change property access.';
      if (a && hasPropertyRule(a) && !canRestrictProperty(a, pid, subitemIds)) return 'This property can’t have an access rule';
    }
    if (!full && b && hasPropertyRule(b)) {
      groups ??= groupsOf(g, before.space_id);
      if (!canEditPropertySettings(propertyRoleFor(b, { userId: g.userId, databaseRole: dbRole, groupIds: groups }))) return NO_PROPERTY_ACCESS;
    }
  }
  const count = (s: Record<string, PropertySchema>) => Object.values(s).filter((p) => hasPropertyRule(p)).length;
  if (count(as) > MAX_RESTRICTED_PROPERTIES && count(as) > count(bs)) return 'The property access rule limit has been reached';
  return null;
}

/** Row values of restricted properties: "Can edit values only" and up (people with full access always can). Deleted
 *  properties count with their rule. `before` is the row as it was (an empty row for one created / moved in). */
function propertyValueProblem(g: GuardLike, before: Rec, after: Rec, entering = false): string | null {
  const col = g.get('collection', after.parent_id) as CollectionRecord | undefined;
  const all = schemaWithDeleted(col?.schema, (col as Rec | undefined)?.deleted_schema);
  const ids = restrictedPropertyIds(all);
  if (!col || !ids.length) return null;
  // a data source created by this call (a copy, a template's inline database) belongs to its creator
  if (g.created.has(`collection:${col.id}`)) return null;
  const dbRole = g.role(col.parent_id);
  if (roleAtLeast(dbRole, 'editor')) return null;
  const rowRole = g.role(after.id);
  const groups = groupsOf(g, col.space_id);
  for (const pid of ids) {
    if (entering ? isEmptyPropertyValue(after.properties?.[pid]) : stableJson(before.properties?.[pid]) === stableJson(after.properties?.[pid])) continue;
    // the page as it was decides (a new page: as it is created — "Page creator" exceptions count for its creator)
    const role = propertyRoleFor(all[pid], { userId: g.userId, databaseRole: dbRole, rowRole, groupIds: groups, row: (entering ? after : before) as BlockRecord, schema: all });
    if (!canEditPropertyValues(role)) return NO_PROPERTY_ACCESS;
  }
  return null;
}

/** deleted_schema changes: a deleted property's rule is changed by full access only, and an entry only comes from the
 *  live schema (soft delete) — never invented for ids whose values a rule no longer masks. Removing one is allowed. */
function deletedSchemaProblem(g: GuardLike, before: Rec, after: Rec): string | null {
  const bd = (before.deleted_schema ?? {}) as Record<string, PropertySchema | undefined>;
  const ad = (after.deleted_schema ?? {}) as Record<string, PropertySchema | undefined>;
  const bs = (before.schema ?? {}) as Record<string, PropertySchema | undefined>;
  const full = roleAtLeast(g.role(before.parent_id), 'editor');
  for (const pid of Object.keys(ad)) {
    const a = ad[pid];
    if (!a || stableJson(a) === stableJson(bd[pid])) continue;
    const from = bd[pid] ?? bs[pid];
    if (!from && enforced(g)) return 'This property can’t be restored';
    if (stableJson(from?.property_permissions) !== stableJson(a.property_permissions) && !full) return 'Only people with full access to this database can change property access.';
  }
  return null;
}

/** Records created by this call (authz.ts finalize; may normalize them): new rows — and rows moved in from elsewhere —
 *  only carry values of restricted properties the writer can edit; a copied Tasks database doesn't keep someone else's
 *  sprint automation. */
export function checkCreatedRecord(g: GuardLike, table: Table, rec: Rec, moved = false): string | null {
  if (table === 'block' && rec.parent_table === 'collection') return propertyValueProblem(g, { properties: {} }, rec, true);
  if (table === 'collection' && !moved) {
    const s = rec.format?.sprint_settings as Rec | undefined;
    // automated sprints run as automated_by: a copy (or a write naming someone else) comes without it
    if (s?.automated_by && sprintSettingsProblem(g, undefined, rec)) rec.format = { ...rec.format, sprint_settings: { ...s, automated: false, automated_by: undefined } };
  }
  return null;
}

// ------------------------------------------------------------------ automated sprints 

/**
 * "Automated sprints": the hourly job (dbstruct.ts sprints.tick) completes sprints as format.sprint_settings.automated_by.
 * Only the writer can name themselves, and only for a Sprints database they can edit (else a Tasks editor could make the
 * job write — as someone else — into a database they can't open). Re-checked when the job runs.
 */
function sprintSettingsProblem(g: GuardLike, before: Rec | undefined, after: Rec): string | null {
  const b = (before?.format?.sprint_settings ?? {}) as Rec;
  const a = (after.format?.sprint_settings ?? {}) as Rec;
  const by = typeof a.automated_by === 'string' ? a.automated_by : undefined;
  if (!by) return null;
  if (by === b.automated_by && a.sprints_collection_id === b.sprints_collection_id && (!a.automated || b.automated)) return null;
  if (by !== g.userId) return 'Only the person turning on automated sprints can run them';
  const sid = typeof a.sprints_collection_id === 'string' ? a.sprints_collection_id : '';
  const sprints = sid ? (g.get('collection', sid) as CollectionRecord | undefined) : undefined;
  if (sid && !g.created.has(`collection:${sid}`) && (!sprints || !canEditDatabaseContent(g.role(sprints.parent_id)))) return 'You need edit access to the Sprints database to automate sprints';
  return null;
}

/** New rows (or rows moved in): Can edit content and up, or "Can also create pages" on the database. */
export function canAddDatabaseRows(g: GuardLike, c: CollectionRecord): boolean {
  if (g.created.has(`collection:${c.id}`)) return true;
  if (canEditDatabaseContent(g.role(c.parent_id))) return true;
  const host = g.get('block', c.parent_id) as BlockRecord | undefined;
  return hasCreatePermission({ space: (id) => g.get('space', id) as SpaceRecord | undefined }, host, g.userId);
}
