// Tasks databases: "Turn into Tasks database" maps Status / Assignee / Due date roles
// (collection.format.app_config_uri + app_uri_map, field names); "Undo Task database" removes the type.
// A Tasks database feeds Home › My Tasks (server endpoint getMyTasks) and unlocks sprints.
import type { CollectionRecord, PropertySchema, PropertyType } from '@nc/shared/records.ts';
import {
  TASK_ROLES, TASKS_COLLECTION_URI, defaultStatusSchema, dependencyConfigOf, isTaskDatabase as isTaskDb, subitemConfigOf,
} from '@nc/shared/database/index.ts';
import { run } from '../../lib/blocks.ts';
import { useUI } from '../../lib/store/ui.ts';
import { changePropertyType, newPropertyId, nullify } from './actions.ts';

export function isTaskDatabase(c: CollectionRecord | undefined): boolean {
  return isTaskDb(c);
}

export type RoleChoice = string | 'new' | undefined;

/** Candidates for each role: status, assignee, and due date. */
export function roleCandidates(c: CollectionRecord, role: 'status' | 'assignee' | 'due'): [string, PropertySchema][] {
  const types: Record<string, PropertyType[]> = { status: ['status', 'select', 'checkbox'], assignee: ['person'], due: ['date'] };
  return Object.entries(c.schema).filter(([, p]) => types[role].includes(p.type));
}

/** Default pick: the first property of the preferred type, else "Create new". */
export function defaultRoleChoice(c: CollectionRecord, role: 'status' | 'assignee' | 'due'): RoleChoice {
  const pref: Record<string, PropertyType> = { status: 'status', assignee: 'person', due: 'date' };
  return Object.entries(c.schema).find(([, p]) => p.type === pref[role])?.[0] ?? roleCandidates(c, role)[0]?.[0] ?? 'new';
}

export function turnIntoTaskDatabase(c: CollectionRecord, choice: { status: RoleChoice; assignee: RoleChoice; due: RoleChoice }) {
  // non-status picks for the status role become Status properties (CheckboxSelectMappingInfo)
  const statusPid = choice.status && choice.status !== 'new' ? choice.status : undefined;
  if (statusPid && c.schema[statusPid]?.type !== 'status') changePropertyType(c.id, statusPid, 'status');
  run('turnIntoTaskDatabase', (tx) => {
    const schema = { ...c.schema } as Record<string, unknown>;
    const make = (role: string, type: PropertyType, name: string): string => {
      const pid = newPropertyId(schema);
      schema[pid] = true;
      const p: PropertySchema = { name, type };
      if (type === 'status') {
        const s = defaultStatusSchema();
        Object.assign(p, { options: s.options, groups: s.groups, defaultOption: s.defaultOption });
      }
      tx.set('collection', c.id, ['schema', pid], p);
      void role;
      return pid;
    };
    const status = choice.status === 'new' || !choice.status ? make('status', 'status', 'Status') : choice.status;
    const assignee = choice.assignee === 'new' || !choice.assignee ? make('assignee', 'person', 'Assignee') : choice.assignee;
    const due = choice.due === 'new' || !choice.due ? make('due', 'date', 'Due') : choice.due;
    const map: Record<string, string> = { [TASK_ROLES.status]: status, [TASK_ROLES.assignee]: assignee, [TASK_ROLES.due]: due };
    const sub = subitemConfigOf(c);
    if (sub) Object.assign(map, { [TASK_ROLES.subTask]: sub.property, [TASK_ROLES.parentTask]: sub.inverse });
    const dep = dependencyConfigOf(c);
    if (dep) Object.assign(map, { [TASK_ROLES.blocking]: dep.blocking, ...(dep.blockedBy ? { [TASK_ROLES.blockedBy]: dep.blockedBy } : {}) });
    tx.update('collection', c.id, ['format'], { app_config_uri: TASKS_COLLECTION_URI, app_uri_map: { ...((c.format?.app_uri_map as Record<string, string>) ?? {}), ...map } });
  });
  useUI.getState().toast('Turned into task database · Add to Home to see your assigned tasks in My Tasks');
}

export function undoTaskDatabase(c: CollectionRecord) {
  run('undoTaskDatabase', (tx) => tx.update('collection', c.id, ['format'], nullify({ app_config_uri: undefined, app_uri_map: undefined })));
}
