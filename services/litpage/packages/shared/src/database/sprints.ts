// Sprints: a Tasks database with sprints on has collection.format.sprint_settings
// {sprints_collection_id, board_block_id, duration_weeks, start_day, incomplete_tasks, automated} and a "Sprint" relation
// (app_uri_map litpage://tasks/task_sprint_relation) to a Sprints database (app_config_uri litpage://sprints_collection)
// whose rows carry "Sprint status" (Current / Next / Last / Past / Future) and "Dates". Completing a sprint is planned
// here so the client (Complete sprint button) and the server (Automated sprints) apply the same writes.
import type { BlockRecord, CollectionRecord, PropertySchema } from '../records.ts';
import type { DateValue, RichText } from '../richtext.ts';
import { dayIndex, dayString } from './dependencies.ts';
import {
  SPRINT_ROLES, TASK_ROLES, isCompleteStatus, rolePropertyOf, sprintSettingsOf, type SprintSettings, type SprintStatus,
} from './tasks.ts';

export interface SprintInfo {
  tasks: CollectionRecord;
  sprints: CollectionRecord;
  settings: SprintSettings;
  /** Tasks › "Sprint" relation */
  sprintRel: string;
  /** Sprints › "Tasks" relation */
  tasksRel: string;
  /** Sprints › "Sprint status" */
  statusProp: string;
  /** Sprints › "Dates" */
  datesProp: string;
  /** Tasks › status (completion) */
  taskStatus?: string;
}

export function sprintInfoOf(tasks: CollectionRecord | undefined, getCollection: (id: string) => CollectionRecord | undefined): SprintInfo | null {
  const settings = sprintSettingsOf(tasks);
  if (!tasks || !settings?.sprints_collection_id) return null;
  const sprints = getCollection(settings.sprints_collection_id);
  if (!sprints || sprints.alive === false) return null;
  const sprintRel = rolePropertyOf(tasks, TASK_ROLES.sprint);
  const tasksRel = rolePropertyOf(sprints, SPRINT_ROLES.tasks);
  const statusProp = rolePropertyOf(sprints, SPRINT_ROLES.status);
  const datesProp = rolePropertyOf(sprints, SPRINT_ROLES.dates);
  if (!sprintRel || !tasksRel || !statusProp || !datesProp) return null;
  return { tasks, sprints, settings, sprintRel, tasksRel, statusProp, datesProp, taskStatus: rolePropertyOf(tasks, TASK_ROLES.status) };
}

function plain(raw: unknown): string {
  return Array.isArray(raw) ? raw.map((d) => (Array.isArray(d) ? String(d[0] ?? '') : '')).join('') : '';
}

export function sprintStatusOf(row: BlockRecord | undefined, info: Pick<SprintInfo, 'statusProp'>): SprintStatus | null {
  const v = plain(row?.properties?.[info.statusProp]).trim();
  return (['Current', 'Next', 'Last', 'Past', 'Future'] as const).find((s) => s.toLowerCase() === v.toLowerCase()) ?? null;
}

function dateAtom(raw: unknown): DateValue | undefined {
  for (const d of Array.isArray(raw) ? raw : []) {
    const anns = Array.isArray(d?.[1]) ? d[1] : [];
    for (const a of anns) if (Array.isArray(a) && a[0] === 'd' && a[1]) return a[1] as DateValue;
  }
  return undefined;
}

export function sprintDatesOf(row: BlockRecord | undefined, info: Pick<SprintInfo, 'datesProp'>): { start: string; end: string } | null {
  const v = dateAtom(row?.properties?.[info.datesProp]);
  if (!v?.start_date) return null;
  return { start: v.start_date, end: v.end_date ?? v.start_date };
}

export function relIds(row: BlockRecord | undefined, propId: string): string[] {
  const out: string[] = [];
  for (const d of (row?.properties?.[propId] ?? []) as unknown[]) {
    const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as unknown[]) : [];
    for (const a of anns) if (Array.isArray(a) && a[0] === 'p' && typeof a[1] === 'string') out.push(a[1]);
  }
  return out;
}

export function encodeRel(ids: string[], spaceId?: string): RichText | undefined {
  if (!ids.length) return undefined;
  const out: unknown[] = [];
  ids.forEach((id, i) => {
    if (i) out.push([',']);
    out.push(['‣', [spaceId ? ['p', id, spaceId] : ['p', id]]]);
  });
  return out as RichText;
}

export function encodeDateRange(start: string, end: string): RichText {
  return [['‣', [['d', { type: 'daterange', start_date: start, end_date: end }]]]] as unknown as RichText;
}

/** First start day on or after `fromDay` falling on `weekday` (0 = Sunday). */
export function nextWeekday(fromDay: number, weekday: number): number {
  for (let i = 0; i < 7; i++) if (new Date((fromDay + i) * 864e5).getUTCDay() === weekday) return fromDay + i;
  return fromDay;
}

/** Dates of a sprint starting on `startDay` (inclusive end). */
export function sprintSpan(startDay: number, settings: Pick<SprintSettings, 'duration_weeks'>): { start: string; end: string } {
  return { start: dayString(startDay), end: dayString(startDay + Math.max(1, settings.duration_weeks) * 7 - 1) };
}

/** Sprint name "Sprint N" with the next free N. */
export function nextSprintName(sprints: BlockRecord[]): string {
  let max = 0;
  for (const r of sprints) {
    const m = /(\d+)\s*$/.exec(plain(r.properties?.title));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Sprint ${max + 1}`;
}

export interface SprintPlan {
  /** property writes on existing rows */
  writes: { rowId: string; propId: string; value: RichText | undefined }[];
  /** new sprint rows (properties already encoded) */
  creates: { id: string; properties: Record<string, RichText> }[];
  completedSprintId: string | null;
  newCurrentId: string | null;
}

/**
 * Complete the current sprint: Current → Last (previous Last → Past), Next → Current (created when missing, with
 * `nextDates` or the following sprint span), a fresh Next sprint after it, and incomplete tasks moved per `incomplete`.
 */
export function planSprintCompletion(info: SprintInfo, rows: { sprints: BlockRecord[]; tasks: BlockRecord[] }, opts: {
  incomplete: SprintSettings['incomplete_tasks'];
  nextDates?: { start: string; end: string } | null;
  today: string;
  newId: () => string;
}): SprintPlan {
  const plan: SprintPlan = { writes: [], creates: [], completedSprintId: null, newCurrentId: null };
  const sprints = rows.sprints.filter((r) => r.alive !== false && !r.is_template);
  const byStatus = (s: SprintStatus) => sprints.filter((r) => sprintStatusOf(r, info) === s);
  const current = byStatus('Current')[0];
  if (!current) return plan;
  plan.completedSprintId = current.id;
  const status = (rowId: string, s: SprintStatus) => plan.writes.push({ rowId, propId: info.statusProp, value: [[s]] as RichText });
  for (const r of byStatus('Last')) status(r.id, 'Past');
  status(current.id, 'Last');
  const curDates = sprintDatesOf(current, info);
  const space = info.tasks.space_id;
  let next = byStatus('Next')[0];
  let nextId: string;
  if (next) {
    nextId = next.id;
    status(next.id, 'Current');
    if (opts.nextDates) plan.writes.push({ rowId: next.id, propId: info.datesProp, value: encodeDateRange(opts.nextDates.start, opts.nextDates.end) });
  } else {
    nextId = opts.newId();
    const start = curDates ? dayIndex(curDates.end) + 1 : dayIndex(opts.today);
    const span = opts.nextDates ?? sprintSpan(start, info.settings);
    plan.creates.push({ id: nextId, properties: { title: [[nextSprintName(sprints)]], [info.statusProp]: [['Current']], [info.datesProp]: encodeDateRange(span.start, span.end) } as Record<string, RichText> });
  }
  plan.newCurrentId = nextId;
  // keep one "Next" sprint queued after the new current one (a Future sprint becomes Next first)
  const future = byStatus('Future')[0];
  const newCurrentDates = opts.nextDates ?? (next ? sprintDatesOf(next, info) : null) ?? (plan.creates[0] ? sprintDatesOf({ properties: plan.creates[0].properties } as unknown as BlockRecord, info) : null);
  if (future) status(future.id, 'Next');
  else {
    const start = newCurrentDates ? dayIndex(newCurrentDates.end) + 1 : dayIndex(opts.today) + info.settings.duration_weeks * 7;
    const span = sprintSpan(start, info.settings);
    const name = nextSprintName([...sprints, ...plan.creates.map((c) => ({ properties: c.properties }) as unknown as BlockRecord)]);
    plan.creates.push({ id: opts.newId(), properties: { title: [[name]], [info.statusProp]: [['Next']], [info.datesProp]: encodeDateRange(span.start, span.end) } as Record<string, RichText> });
  }
  // incomplete tasks of the completed sprint
  const taskStatusProp: PropertySchema | undefined = info.taskStatus ? info.tasks.schema[info.taskStatus] : undefined;
  const sprintTasks = rows.tasks.filter((t) => t.alive !== false && relIds(t, info.sprintRel).includes(current.id));
  const incomplete = sprintTasks.filter((t) => !isCompleteStatus(taskStatusProp, plain(t.properties?.[info.taskStatus ?? ''])));
  if (opts.incomplete !== 'current_sprint' && incomplete.length) {
    const moved = new Set(incomplete.map((t) => t.id));
    for (const t of incomplete) {
      const ids = relIds(t, info.sprintRel).filter((id) => id !== current.id);
      if (opts.incomplete === 'next_sprint') ids.push(nextId);
      plan.writes.push({ rowId: t.id, propId: info.sprintRel, value: encodeRel(ids, space) });
    }
    // reverse side (Sprints › Tasks) of the completed and the new current sprint
    plan.writes.push({ rowId: current.id, propId: info.tasksRel, value: encodeRel(relIds(current, info.tasksRel).filter((id) => !moved.has(id)), space) });
    if (opts.incomplete === 'next_sprint') {
      if (next) plan.writes.push({ rowId: next.id, propId: info.tasksRel, value: encodeRel([...relIds(next, info.tasksRel), ...incomplete.map((t) => t.id)], space) });
      else {
        const created = plan.creates.find((c) => c.id === nextId);
        const enc = encodeRel(incomplete.map((t) => t.id), space);
        if (created && enc) created.properties[info.tasksRel] = enc;
      }
    }
  }
  return plan;
}

/** Summary numbers of a sprint ({completed} / {total} total tasks). */
export function sprintSummary(info: SprintInfo, sprintId: string, tasks: BlockRecord[]): { total: number; completed: number; incomplete: number } {
  const prop = info.taskStatus ? info.tasks.schema[info.taskStatus] : undefined;
  const list = tasks.filter((t) => t.alive !== false && relIds(t, info.sprintRel).includes(sprintId));
  const completed = list.filter((t) => isCompleteStatus(prop, plain(t.properties?.[info.taskStatus ?? '']))).length;
  return { total: list.length, completed, incomplete: list.length - completed };
}
