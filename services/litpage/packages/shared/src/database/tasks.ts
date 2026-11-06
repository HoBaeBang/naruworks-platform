// Typed databases: a Tasks database is marked with
// collection.format.app_config_uri = "litpage://tasks_collection" and maps roles to property ids in
// collection.format.app_uri_map {"litpage://tasks/status_property": pid, …}; a Sprints database uses
// "litpage://sprints_collection". Sprint state lives in collection.format.sprint_settings.
import type { CollectionRecord, PropertySchema } from '../records.ts';

export const TASKS_COLLECTION_URI = 'litpage://tasks_collection';
export const SPRINTS_COLLECTION_URI = 'litpage://sprints_collection';

export const TASK_ROLES = {
  status: 'litpage://tasks/status_property',
  assignee: 'litpage://tasks/assign_property',
  due: 'litpage://tasks/due_date_property',
  subTask: 'litpage://tasks/sub_task_relation',
  parentTask: 'litpage://tasks/parent_task_relation',
  blocking: 'litpage://tasks/task_blocking_relation',
  blockedBy: 'litpage://tasks/task_blocked_by_relation',
  sprint: 'litpage://tasks/task_sprint_relation',
} as const;

export const SPRINT_ROLES = {
  status: 'litpage://sprints/sprint_status_property',
  dates: 'litpage://sprints/dates_property',
  tasks: 'litpage://sprints/sprint_task_relation',
  id: 'litpage://sprints/unique_id_property',
  total: 'litpage://sprints/total_tasks_property',
  completed: 'litpage://sprints/completed_tasks_property',
} as const;

type FormatHolder = { format?: Record<string, unknown>; schema?: Record<string, PropertySchema> } | undefined;

export function isTaskDatabase(c: FormatHolder): boolean {
  return c?.format?.app_config_uri === TASKS_COLLECTION_URI;
}

export function isSprintsDatabase(c: FormatHolder): boolean {
  return c?.format?.app_config_uri === SPRINTS_COLLECTION_URI;
}

/** Property id playing `role` in a typed database (only when it still exists). */
export function rolePropertyOf(c: FormatHolder, role: string): string | undefined {
  const pid = (c?.format?.app_uri_map as Record<string, string> | undefined)?.[role];
  return pid && c?.schema?.[pid] ? pid : undefined;
}

export interface TaskDatabaseInfo {
  status?: string;
  assignee?: string;
  due?: string;
  sprint?: string;
}

export function taskDatabaseInfo(c: FormatHolder): TaskDatabaseInfo | null {
  if (!isTaskDatabase(c)) return null;
  return { status: rolePropertyOf(c, TASK_ROLES.status), assignee: rolePropertyOf(c, TASK_ROLES.assignee), due: rolePropertyOf(c, TASK_ROLES.due), sprint: rolePropertyOf(c, TASK_ROLES.sprint) };
}

// ------------------------------------------------------------------ sprints

/** Sprint status option names. */
export const SPRINT_STATUSES = ['Current', 'Next', 'Last', 'Past', 'Future'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

export interface SprintSettings {
  /** Sprints database (data source) linked to this Tasks database */
  sprints_collection_id?: string;
  /** sprint board page */
  board_block_id?: string;
  /** weeks per sprint (1…8) */
  duration_weeks: number;
  /** 0 = Sunday … 6 = Saturday */
  start_day: number;
  incomplete_tasks: 'next_sprint' | 'backlog' | 'current_sprint';
  automated: boolean;
}

export const DEFAULT_SPRINT_SETTINGS: SprintSettings = { duration_weeks: 2, start_day: 1, incomplete_tasks: 'next_sprint', automated: false };

export function sprintSettingsOf(c: FormatHolder): SprintSettings | null {
  const s = c?.format?.sprint_settings as Partial<SprintSettings> | undefined;
  if (!s?.sprints_collection_id) return null;
  return { ...DEFAULT_SPRINT_SETTINGS, ...s };
}

/** Tasks whose status is in the "Complete" group count as done (sprint summary / incomplete tasks). */
export function isCompleteStatus(prop: PropertySchema | undefined, value: string | undefined): boolean {
  if (!prop || !value) return false;
  if (prop.type === 'checkbox') return value === 'Yes';
  const opt = prop.options?.find((o) => o.value.toLowerCase() === value.toLowerCase());
  const groups = (prop.groups ?? []) as { name: string; optionIds?: string[] }[];
  return !!opt && groups.some((g) => g.name === 'Complete' && g.optionIds?.includes(opt.id));
}

export type { CollectionRecord };
