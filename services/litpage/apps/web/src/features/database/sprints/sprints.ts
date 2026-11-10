// Sprints on the client (…017): "Turn on sprints" creates a Sprints database (Sprint name, Sprint status,
// Dates, Sprint ID, Tasks ↔ Sprint relation, Completed / Total tasks rollups; views All sprints + Timeline; Sprint 1–3),
// a "Sprint board" page (linked Tasks views Current sprint / Sprint planning / Backlog), and sprint settings on the
// Tasks database. "Complete sprint" applies planSprintCompletion in one transaction.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, Table } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import {
  DEFAULT_SPRINT_SETTINGS, SPRINTS_COLLECTION_URI, SPRINT_ROLES, TASK_ROLES, dayIndex, dayString, defaultGroupBy, encodeDateRange,
  nextWeekday, planSprintCompletion, rolePropertyOf, sprintInfoOf, sprintSpan, type SprintInfo, type SprintSettings,
} from '@nc/shared/database/index.ts';
import { records } from '../../../lib/store/records.ts';
import { createBlockIn, deleteBlocksIn, getBlock, me, run } from '../../../lib/blocks.ts';
import { currentSpaceView } from '../../../lib/store/session.ts';
import type { Tx } from '../../../lib/store/transactions.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { createViewIn, newPropertyId, nullify } from '../actions.ts';
import { createDatabaseIn } from '../createDatabase.ts';
import { collectionRows } from '../data.ts';

export function sprintInfo(tasks: CollectionRecord | undefined): SprintInfo | null {
  return sprintInfoOf(tasks, (id) => records.get<CollectionRecord>('collection', id));
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where new pages go next to a database block (same parent list, right after it). */
function siblingSpot(host: BlockRecord): { parentId: string; parentTable: 'block' | 'space' | 'team'; after?: string; list?: { table: Table; id: string; path: string[] } | null } {
  if (host.parent_table === 'block') return { parentId: host.parent_id, parentTable: 'block', after: host.id };
  if (host.parent_table === 'team') return { parentId: host.parent_id, parentTable: 'team', after: host.id };
  const sv = currentSpaceView();
  if (sv?.private_pages?.includes(host.id)) return { parentId: host.space_id, parentTable: 'space', after: host.id, list: { table: 'space_view', id: sv.id, path: ['private_pages'] } };
  return { parentId: host.space_id, parentTable: 'space', after: host.id, list: { table: 'space', id: host.space_id, path: ['pages'] } };
}

const leaf = (property: string, operator: string, value?: unknown) => ({ property, filter: value === undefined ? { operator } : { operator, value } });

export function turnOnSprints(tasks: CollectionRecord, settings: Partial<SprintSettings> = {}): { sprintsCollectionId: string; boardId: string } | null {
  const host = getBlock(tasks.parent_id);
  if (!host) return null;
  const spot = siblingSpot(host);
  const s: SprintSettings = { ...DEFAULT_SPRINT_SETTINGS, ...settings };
  let out: { sprintsCollectionId: string; boardId: string } | null = null;
  run('sprints.turnOn', (tx) => {
    // --- Sprints database
    const db = createDatabaseIn(tx, { ...spot, inline: false, viewType: 'table', name: 'Sprints', setupPanel: false, list: spot.list });
    const sc = db.collectionId;
    const schema: Record<string, unknown> = { title: true };
    const pid = () => {
      const id = newPropertyId(schema);
      schema[id] = true;
      return id;
    };
    const statusPid = pid();
    const datesPid = pid();
    const idPid = pid();
    const tasksRel = pid();
    const totalPid = pid();
    const donePid = pid();
    const sprintRel = newPropertyId(tasks.schema);
    const ptr = (id: string) => ({ id, table: 'collection', spaceId: tasks.space_id });
    tx.update('collection', sc, ['schema', 'title'], { name: 'Sprint name' });
    tx.set('collection', sc, ['schema', statusPid], {
      name: 'Sprint status', type: 'select', description: 'Track whether a sprint is active.',
      options: [
        { id: newId(), value: 'Current', color: 'blue' }, { id: newId(), value: 'Next', color: 'green' }, { id: newId(), value: 'Last', color: 'gray' },
        { id: newId(), value: 'Past', color: 'default' }, { id: newId(), value: 'Future', color: 'purple' },
      ],
    } as PropertySchema);
    tx.set('collection', sc, ['schema', datesPid], { name: 'Dates', type: 'date' } as PropertySchema);
    tx.set('collection', sc, ['schema', idPid], { name: 'Sprint ID', type: 'auto_increment_id', prefix: '' } as PropertySchema);
    tx.set('collection', sc, ['schema', tasksRel], { name: 'Tasks', type: 'relation', collection_id: tasks.id, collection_pointer: ptr(tasks.id), property: sprintRel, version: 'v2', autoRelate: { enabled: false } } as PropertySchema);
    tx.set('collection', tasks.id, ['schema', sprintRel], { name: 'Sprint', type: 'relation', collection_id: sc, collection_pointer: ptr(sc), property: tasksRel, version: 'v2', limit: 1, autoRelate: { enabled: false } } as PropertySchema);
    const statusTask = rolePropertyOf(tasks, TASK_ROLES.status) ?? 'title';
    tx.set('collection', sc, ['schema', totalPid], { name: 'Total tasks', type: 'rollup', relation_property: tasksRel, target_property: 'title', target_property_type: 'title', aggregation: 'count' } as PropertySchema);
    tx.set('collection', sc, ['schema', donePid], { name: 'Completed tasks', type: 'rollup', relation_property: tasksRel, target_property: statusTask, target_property_type: tasks.schema[statusTask]?.type ?? 'status', aggregation: { operator: 'count_per_group', groupName: 'Complete' } } as unknown as PropertySchema);
    tx.update('collection', sc, ['format'], {
      app_config_uri: SPRINTS_COLLECTION_URI,
      app_uri_map: { [SPRINT_ROLES.status]: statusPid, [SPRINT_ROLES.dates]: datesPid, [SPRINT_ROLES.id]: idPid, [SPRINT_ROLES.tasks]: tasksRel, [SPRINT_ROLES.total]: totalPid, [SPRINT_ROLES.completed]: donePid },
    });
    tx.update('collection_view', db.viewId, [], { name: 'All sprints' });
    tx.update('collection_view', db.viewId, ['format'], { table_properties: ['title', statusPid, datesPid, idPid, donePid, totalPid, tasksRel].map((p) => ({ property: p, visible: true, width: p === 'title' ? 280 : 160 })) });
    const tl = createViewIn(tx, db.blockId, 'timeline', sc, { name: 'Timeline', extraQuery: { timeline_by: datesPid }, extraFormat: { timeline_preference: { zoomLevel: 'month', centerTimestamp: Date.now() }, timeline_show_table: false, timeline_table_properties: [{ property: 'title', visible: true, width: 280 }], timeline_properties: [{ property: statusPid, visible: true }] } });
    tx.listAfter('block', db.blockId, ['view_ids'], tl, db.viewId);
    // Sprint 1 (current, this week's start day), 2 (next), 3 (future)
    const start = nextWeekday(dayIndex(todayStr()) - 6, s.start_day);
    ['Current', 'Next', 'Future'].forEach((st, i) => {
      const span = sprintSpan(start + i * s.duration_weeks * 7, s);
      createBlockIn(tx, { type: 'page', parentId: sc, parentTable: 'collection', title: [[`Sprint ${i + 1}`]], properties: { [statusPid]: [[st]], [datesPid]: encodeDateRange(span.start, span.end), [idPid]: [[String(i + 1)]] }, list: null });
    });
    // --- Tasks database: Sprint role + settings
    const boardId = newId();
    tx.update('collection', tasks.id, ['format'], {
      app_uri_map: { ...((tasks.format?.app_uri_map as Record<string, string>) ?? {}), [TASK_ROLES.sprint]: sprintRel },
      sprint_settings: { ...s, sprints_collection_id: sc, board_block_id: boardId },
    });
    // --- Sprint board page with linked Tasks views
    createBlockIn(tx, { id: boardId, type: 'page', parentId: spot.parentId, parentTable: spot.parentTable, after: db.blockId, title: [['Sprint board']], format: { page_icon: '🏃' }, list: spot.list ? { ...spot.list } : undefined });
    const linkedId = newId();
    const pointer = ptr(tasks.id);
    createBlockIn(tx, { id: linkedId, type: 'collection_view', parentId: boardId, parentTable: 'block', format: { collection_pointer: pointer } as never, extra: { collection_id: tasks.id, view_ids: [] } });
    const statusProp = tasks.schema[statusTask];
    const current = createViewIn(tx, linkedId, 'board', tasks.id, {
      name: 'Current sprint', linkedCollection: true,
      extraFormat: {
        sprint_view: 'current',
        property_filters: [{ id: newId(), filter: leaf(sprintRel, 'relation_contains', [{ type: 'relative', value: 'current_sprint' }]) }],
        ...(statusProp ? { board_columns_by: { ...defaultGroupBy(statusProp, statusTask, { board: true }), hideEmptyGroups: false } } : {}),
      },
      extraQuery: statusProp ? { group_by: statusTask } : {},
    });
    const planning = createViewIn(tx, linkedId, 'table', tasks.id, {
      name: 'Sprint planning', linkedCollection: true,
      extraFormat: { sprint_view: 'planning', collection_group_by: { ...defaultGroupBy({ name: 'Sprint', type: 'relation' } as PropertySchema, sprintRel), hideEmptyGroups: false } },
      extraQuery: { filter: { operator: 'or', filters: [leaf(sprintRel, 'relation_contains', [{ type: 'relative', value: 'current_sprint' }]), leaf(sprintRel, 'relation_contains', [{ type: 'relative', value: 'next_sprint' }]), leaf(sprintRel, 'is_empty')] } },
    });
    const backlog = createViewIn(tx, linkedId, 'table', tasks.id, {
      name: 'Backlog', linkedCollection: true,
      extraFormat: { sprint_view: 'backlog', property_filters: [{ id: newId(), filter: leaf(sprintRel, 'is_empty') }] },
    });
    for (const v of [current, planning, backlog]) tx.listAfter('block', linkedId, ['view_ids'], v);
    out = { sprintsCollectionId: sc, boardId };
  });
  if (out) useUI.getState().toast('Sprints turned on · Sprint board and Sprints database added');
  return out;
}

export function updateSprintSettings(tasks: CollectionRecord, patch: Partial<SprintSettings>) {
  const cur = (tasks.format?.sprint_settings ?? {}) as Record<string, unknown>;
  // automated completion runs on the server as the person who turned it on
  const extra = patch.automated ? { automated_by: me() } : {};
  run('sprints.updateSettings', (tx) => tx.update('collection', tasks.id, ['format'], { sprint_settings: { ...cur, ...patch, ...extra } }));
}

/** "Turn off sprints": deletes the sprint board, the Sprints database and the Sprint relation. */
export function turnOffSprints(tasks: CollectionRecord) {
  const info = sprintInfo(tasks);
  const s = tasks.format?.sprint_settings as Partial<SprintSettings> | undefined;
  const sprintsHost = s?.sprints_collection_id ? records.get<CollectionRecord>('collection', s.sprints_collection_id)?.parent_id : undefined;
  run('sprints.turnOff', (tx) => {
    const ids = [s?.board_block_id, sprintsHost].filter((x): x is string => !!x && !!getBlock(x));
    deleteBlocksIn(tx, ids);
    if (info) {
      tx.set('collection', tasks.id, ['deleted_schema', info.sprintRel], { ...tasks.schema[info.sprintRel], deleted_time: Date.now() });
      tx.set('collection', tasks.id, ['schema', info.sprintRel], undefined);
    }
    const map = { ...((tasks.format?.app_uri_map as Record<string, string>) ?? {}) };
    delete map[TASK_ROLES.sprint];
    tx.update('collection', tasks.id, ['format'], { ...nullify({ sprint_settings: undefined }), app_uri_map: map });
  });
}

/** Rows of the Sprints / Tasks databases. */
export function sprintRows(info: SprintInfo) {
  return { sprints: collectionRows(info.sprints.id), tasks: collectionRows(info.tasks.id) };
}

/** "Complete sprint" — one transaction, undoable. */
export function completeSprint(tasks: CollectionRecord, opts: { incomplete: SprintSettings['incomplete_tasks']; nextDates?: { start: string; end: string } | null }): boolean {
  const info = sprintInfo(tasks);
  if (!info) return false;
  const plan = planSprintCompletion(info, sprintRows(info), { incomplete: opts.incomplete, nextDates: opts.nextDates, today: todayStr(), newId });
  if (!plan.completedSprintId) return false;
  run('sprints.complete', (tx: Tx) => {
    for (const c of plan.creates) createBlockIn(tx, { id: c.id, type: 'page', parentId: info.sprints.id, parentTable: 'collection', properties: c.properties, list: null });
    for (const w of plan.writes) {
      tx.set('block', w.rowId, ['properties', w.propId], w.value);
      tx.update('block', w.rowId, [], { last_edited_time: Date.now(), last_edited_by_id: me() });
    }
  });
  return true;
}

/** "Manage sprint from this view": filters for the current sprint + the Complete sprint button. */
export function manageSprintFromView(view: CollectionViewRecord, tasks: CollectionRecord) {
  const info = sprintInfo(tasks);
  if (!info) return;
  run('sprints.manageFromView', (tx) => tx.update('collection_view', view.id, ['format'], {
    sprint_view: 'current',
    property_filters: [...(((view.format as Record<string, unknown>)?.property_filters as unknown[]) ?? []).filter((f) => (f as { filter?: { property?: string } })?.filter?.property !== info.sprintRel), { id: newId(), filter: leaf(info.sprintRel, 'relation_contains', [{ type: 'relative', value: 'current_sprint' }]) }],
  }));
}

export { dayIndex, dayString, todayStr };
