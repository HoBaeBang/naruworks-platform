import { describe, expect, it } from 'vitest';
import type { BlockRecord, CollectionRecord } from '../records.ts';
import { encodeToken } from '../formula/parser.ts';
import {
  AutomationPlanner, AutomationError, buttonBlockSteps, buttonPropertySteps, automationCaption, conditionText, eventMatches, instantiateRichText,
  nextOccurrence, presetRecurrence, recurrenceLabel, templateDate, TEMPLATE_ME, triggerMatches, validateAutomation, webhookPayload, combine, planDataSteps,
  type AutomationTrigger, type RunContext,
} from './index.ts';

const SPACE = 'space-1';
const col: CollectionRecord = {
  id: 'col-1', version: 1, parent_id: 'dbblock', space_id: SPACE, alive: true, template_pages: ['tpl-1'],
  schema: {
    title: { name: 'Name', type: 'title' },
    st: { name: 'Status', type: 'status', options: [{ id: 'o1', value: 'Not started', color: 'default' }, { id: 'o2', value: 'Done', color: 'green' }], groups: [] },
    tags: { name: 'Tags', type: 'multi_select', options: [{ id: 't1', value: 'Bug', color: 'red' }] },
    who: { name: 'Assignee', type: 'person' },
    due: { name: 'Due', type: 'date' },
    est: { name: 'Estimate', type: 'number' },
    done: { name: 'Done', type: 'checkbox' },
    pri: { name: 'Priority', type: 'select', options: [{ id: 'p1', value: 'High', color: 'red' }] },
    rel: { name: 'Project', type: 'relation', collection_id: 'col-1' },
    btn: { name: 'Action', type: 'button' },
  },
} as any;

function row(id: string, props: Record<string, any> = {}, extra: Partial<BlockRecord> = {}): BlockRecord {
  return {
    id, version: 1, type: 'page', parent_id: 'col-1', parent_table: 'collection', space_id: SPACE, alive: true, properties: props,
    created_time: 1, created_by_id: 'alice', last_edited_time: 1, last_edited_by_id: 'alice', ...extra,
  } as BlockRecord;
}

function ctxWith(rows: BlockRecord[], page?: BlockRecord, extra: Partial<RunContext> = {}): RunContext {
  const store = new Map<string, any>([['collection:col-1', col], ['block:dbblock', { id: 'dbblock', alive: true, space_id: SPACE }], ['lit_user:alice', { id: 'alice', name: 'Alice' }], ['lit_user:bob', { id: 'bob', name: 'Bob' }]]);
  for (const r of rows) store.set(`block:${r.id}`, r);
  let n = 0;
  return {
    kind: 'automation', getRecord: (t, id) => store.get(`${t}:${id}`), rowsOf: (cid) => rows.filter((r) => r.parent_id === cid),
    actorId: 'bob', runAsId: 'alice', page, now: Date.UTC(2026, 9, 20, 3, 0), timeZone: 'Asia/Seoul', spaceId: SPACE, newId: () => `new-${++n}`, ...extra,
  };
}

describe('triggers', () => {
  const before = row('r1', { title: [['Task']], st: [['Not started']], tags: [['Bug']] });
  it('page added only for new rows', () => {
    const t: AutomationTrigger = { type: 'event', mode: 'any', events: [{ id: 'e', type: 'page_added' }] };
    expect(triggerMatches(t, { before: undefined, after: before, collection: col })).toBe(true);
    expect(triggerMatches(t, { before, after: before, collection: col })).toBe(false);
    // a template is not a page added
    expect(triggerMatches(t, { before: undefined, after: { ...before, is_template: true }, collection: col })).toBe(false);
  });
  it('status set to Done (net change only)', () => {
    const t: AutomationTrigger = { type: 'event', mode: 'any', events: [{ id: 'e', type: 'property_edited', property: 'st', condition: { op: 'is', values: ['Done'] } }] };
    const after = row('r1', { ...before.properties, st: [['Done']] });
    expect(triggerMatches(t, { before, after, collection: col })).toBe(true);
    expect(triggerMatches(t, { before: after, after, collection: col })).toBe(false); // no net change
    expect(triggerMatches(t, { before, after: row('r1', { ...before.properties, title: [['x']] }), collection: col })).toBe(false);
  });
  it('multi-select contains fires when the value is added', () => {
    const ev = { id: 'e', type: 'property_edited' as const, property: 'tags', condition: { op: 'contains' as const, values: ['UI'] } };
    expect(eventMatches(ev, { before, after: row('r1', { ...before.properties, tags: [['Bug,UI']] }), collection: col })).toBe(true);
    const withUi = row('r1', { ...before.properties, tags: [['Bug,UI']] });
    expect(eventMatches(ev, { before: withUi, after: row('r1', { ...before.properties, tags: [['Bug,UI,X']] }), collection: col })).toBe(false);
  });
  it('checkbox / number / any property / all mode', () => {
    const chk = { id: 'c', type: 'property_edited' as const, property: 'done', condition: { op: 'is' as const, values: ['checked'] } };
    expect(eventMatches(chk, { before, after: row('r1', { ...before.properties, done: [['Yes']] }), collection: col })).toBe(true);
    expect(eventMatches(chk, { before: row('r1', { done: [['Yes']] }), after: row('r1', { done: [['No']] }), collection: col })).toBe(false);
    const num = { id: 'n', type: 'property_edited' as const, property: 'est', condition: { op: 'greater_than' as const, values: ['3'] } };
    expect(eventMatches(num, { before, after: row('r1', { ...before.properties, est: [['5']] }), collection: col })).toBe(true);
    expect(eventMatches(num, { before, after: row('r1', { ...before.properties, est: [['2']] }), collection: col })).toBe(false);
    const any: AutomationTrigger = { type: 'event', mode: 'any', events: [{ id: 'a', type: 'any_property_edited' }] };
    expect(triggerMatches(any, { before, after: row('r1', { ...before.properties, est: [['1']] }), collection: col })).toBe(true);
    const all: AutomationTrigger = { type: 'event', mode: 'all', events: [chk, num] };
    expect(triggerMatches(all, { before, after: row('r1', { ...before.properties, done: [['Yes']] }), collection: col })).toBe(false);
    expect(triggerMatches(all, { before, after: row('r1', { ...before.properties, done: [['Yes']], est: [['9']] }), collection: col })).toBe(true);
  });
  it('summary texts', () => {
    expect(conditionText(col.schema.st, { op: 'is', values: ['Done'] })).toBe('Status matches Done');
    expect(conditionText(col.schema.pri, { op: 'is', values: ['High'] })).toBe('Priority matches High');
    expect(conditionText(col.schema.done, { op: 'is', values: ['checked'] })).toBe('Done is checked');
    expect(conditionText(col.schema.who, { op: 'edited' })).toBe('Assignee changed');
    const caption = automationCaption({ type: 'event', mode: 'any', events: [{ id: 'e', type: 'page_added' }] }, [{ id: 's', type: 'edit_pages', collection_id: 'col-1', edits: [] }], { collectionId: 'col-1', schema: col.schema });
    expect(caption).toBe('When page added, change pages here');
  });
});

describe('planner', () => {
  it('edit property: set status, add tag, person = whoever triggered, date = date triggered', () => {
    const page = row('r1', { title: [['T']], tags: [['Bug']] });
    const p = new AutomationPlanner(ctxWith([page], page));
    p.editProperty({ id: 's1', type: 'edit_property', edits: [
      { property: 'st', op: 'set', values: [{ type: 'option', name: 'Done' }] },
      { property: 'tags', op: 'add', values: [{ type: 'option', name: 'UI' }] },
      { property: 'who', op: 'set', values: [{ type: 'context', key: 'actor' }] },
      { property: 'due', op: 'set', values: [{ type: 'context', key: 'today' }] },
      { property: 'done', op: 'toggle', values: [] },
    ] });
    const after = p.get<BlockRecord>('block', 'r1')!;
    expect(after.properties?.st).toEqual([['Done']]);
    expect(after.properties?.tags).toEqual([['Bug,UI']]);
    expect(after.properties?.who).toEqual([['‣', [['u', 'bob']]]]);
    expect((after.properties?.due as any)[0][1][0][1].start_date).toBe('2026-10-20');
    expect(after.properties?.done).toEqual([['Yes']]);
    // the new option "UI" was added to the schema
    expect(p.get<CollectionRecord>('collection', 'col-1')!.schema.tags.options!.map((o) => o.value)).toEqual(['Bug', 'UI']);
    expect(after.last_edited_by_id).toBe('alice');
  });
  it('add page then edit it in a later step (overlay), title from trigger page property + formula', () => {
    const page = row('r1', { title: [['Launch']], est: [['2']] });
    const p = new AutomationPlanner(ctxWith([page], page));
    const titleFormula = `${encodeToken({ type: 'context', key: 'page' })}.${encodeToken({ type: 'block_property', property: 'est', collection: { id: 'col-1', table: 'collection' } })} * 2`;
    planDataSteps(p, [
      { id: 'a', type: 'add_page', collection_id: 'col-1', edits: [{ property: 'title', op: 'set', values: [{ type: 'text', text: 'Follow up: ' }, { type: 'property', property: 'title' }] }] },
      { id: 'b', type: 'edit_pages', source: { type: 'step', step: 'a' }, edits: [{ property: 'est', op: 'set', values: [{ type: 'formula', formula: titleFormula }] }] },
    ]);
    const created = p.created[0];
    const b = p.get<BlockRecord>('block', created)!;
    expect(b.parent_id).toBe('col-1');
    expect(b.created_by_id).toBe('alice');
    expect(b.properties?.title).toEqual([['Follow up: Launch']]);
    expect(b.properties?.est).toEqual([['4']]);
    expect(p.ops.length).toBeGreaterThan(2);
  });
  it('edit pages in applies the filter (not every row)', () => {
    const rows = [row('a', { st: [['Done']] }), row('b', { st: [['Not started']] }), row('c', {})];
    const p = new AutomationPlanner(ctxWith(rows, undefined, { kind: 'button' }));
    const edited = p.editPages({ id: 's', type: 'edit_pages', collection_id: 'col-1', filter: { operator: 'and', filters: [{ property: 'st', filter: { operator: 'status_is', value: [{ type: 'is_option', value: 'Done' }] } }] }, edits: [{ property: 'done', op: 'set', values: [{ type: 'checkbox', checked: true }] }] });
    expect(edited).toEqual(['a']);
    expect(p.get<BlockRecord>('block', 'b')!.properties?.done).toBeUndefined();
  });
  it('variables cannot reference variables of the same step; later steps can', () => {
    const page = row('r1', { est: [['3']] });
    const p = new AutomationPlanner(ctxWith([page], page));
    p.defineVariables({ id: 'v', type: 'define_variables', variables: [{ id: 'x', name: 'Variable 1', formula: '1 + 2' }] });
    expect(p.contextValue('var:v:x')).toEqual({ type: 'number', value: 3 });
    expect(() => p.defineVariables({ id: 'w', type: 'define_variables', variables: [{ id: 'y', name: 'V', formula: encodeToken({ type: 'context', key: 'var:w:y' }) }] })).toThrow(AutomationError);
    const r = p.resolve({ type: 'formula', formula: `${encodeToken({ type: 'context', key: 'var:v:x' })} * 10` });
    expect(r).toEqual([{ kind: 'number', value: 30 }]);
  });
  it('errors: deleted property, missing database, status option', () => {
    const page = row('r1');
    const p = new AutomationPlanner(ctxWith([page], page));
    expect(() => p.editProperty({ id: 's', type: 'edit_property', edits: [{ property: 'gone', op: 'set', values: [] }] })).toThrow('The property no longer exists');
    expect(() => p.addPage({ id: 's', type: 'add_page', edits: [] })).toThrow('Choose a database for the new page');
    expect(() => p.editProperty({ id: 's', type: 'edit_property', edits: [{ property: 'st', op: 'set', values: [{ type: 'option', name: 'Nope' }] }] })).toThrow(/not an option/);
  });
  it('combine list ops', () => {
    expect(combine(['a', 'b'], ['b', 'c'], 'add')).toEqual(['a', 'b', 'c']);
    expect(combine(['a', 'b'], ['b'], 'remove')).toEqual(['a']);
    expect(combine(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
    expect(combine(['a'], ['c'], 'set')).toEqual(['c']);
  });
});

describe('recurrence', () => {
  it('daily at 9:00 in Seoul', () => {
    const r = presetRecurrence('day', Date.UTC(2026, 9, 20, 3, 0), 'Asia/Seoul', '09:00');
    // 2026-10-20 12:00 KST now → next is 2026-10-21 09:00 KST = 00:00 UTC
    expect(nextOccurrence(r, Date.UTC(2026, 9, 20, 3, 0))).toBe(Date.UTC(2026, 9, 21, 0, 0));
    expect(recurrenceLabel(r)).toBe('Every day at 9:00 AM');
  });
  it('weekdays, 2 weeks, monthly last day, end conditions', () => {
    const wk = { frequency: 'week' as const, interval: 1, weekdays: [1, 2, 3, 4, 5], start: '2026-10-23', time: '10:00', time_zone: 'UTC' };
    // 2026-10-23 is a Friday → next after Fri 11:00 is Mon 26th 10:00
    expect(nextOccurrence(wk, Date.UTC(2026, 9, 23, 11, 0))).toBe(Date.UTC(2026, 9, 26, 10, 0));
    const two = { frequency: 'week' as const, interval: 2, weekdays: [2], start: '2026-10-20', time: '08:00', time_zone: 'UTC' };
    expect(nextOccurrence(two, Date.UTC(2026, 9, 20, 9, 0))).toBe(Date.UTC(2026, 10, 3, 8, 0));
    const last = { frequency: 'month' as const, interval: 1, month_day: 'last' as const, start: '2026-01-01', time: '00:00', time_zone: 'UTC' };
    expect(nextOccurrence(last, Date.UTC(2026, 1, 1))).toBe(Date.UTC(2026, 1, 28));
    expect(nextOccurrence({ ...last, end: { type: 'count', count: 2 } }, Date.UTC(2026, 1, 1), 2)).toBeNull();
    expect(nextOccurrence({ ...last, end: { type: 'date', date: '2026-02-10' } }, Date.UTC(2026, 1, 1))).toBeNull();
    const hourly = { frequency: 'hour' as const, interval: 3, start: '2026-10-20', time: '00:00', time_zone: 'UTC' };
    expect(nextOccurrence(hourly, Date.UTC(2026, 9, 20, 4, 30))).toBe(Date.UTC(2026, 9, 20, 6, 0));
  });
});

describe('validation / buttons / template variables / webhook', () => {
  it('validates steps with Litpage messages', () => {
    const look = { surface: 'automation' as const, schema: col.schema, collection: (id: string) => (id === 'col-1' ? col : undefined), block: () => undefined, webhooksAllowed: true };
    const issues = validateAutomation({ type: 'event', mode: 'any', events: [] }, [
      { id: 'a', type: 'add_page', edits: [] },
      { id: 'b', type: 'webhook', url: 'ftp://x', headers: [], properties: 'all' },
      { id: 'c', type: 'notify', target: { type: 'users', user_ids: [] }, message: [] },
    ], look);
    expect(issues.map((i) => i.message)).toEqual(['Add trigger', 'Choose a database for the new page', 'Enter a valid URL', 'Choose at least one recipient', 'Add a notification message']);
  });
  it('formula errors in actions (DB-FX-114.2 / 114.4)', () => {
    const look = { surface: 'automation' as const, collectionId: 'col-1', schema: col.schema, collection: (id: string) => (id === 'col-1' ? col : undefined), block: () => undefined, webhooksAllowed: true };
    const P = encodeToken({ type: 'context', key: 'page' });
    const prop = (id: string) => `${P}.${encodeToken({ type: 'block_property', property: id, collection: { id: 'col-1', table: 'collection' } } as any)}`;
    const trigger: AutomationTrigger = { type: 'event', mode: 'any', events: [{ id: 'e1', type: 'page_added' }] };
    const fx = (formula: string, property = 'due') => ({ id: 's', type: 'edit_property' as const, edits: [{ property, op: 'set' as const, values: [{ type: 'formula' as const, formula }] }] });
    const msgs = (actions: any[]) => validateAutomation(trigger, actions, look).map((i) => i.message);
    // a date property needs a date; Trigger page.Due is typed through the trigger data source
    expect(msgs([fx(`${prop('due')}.dateAdd(1, "days")`)])).toEqual([]);
    expect(msgs([fx(`${prop('est')} + 1`)])).toEqual(['The formula has a type error']);
    // "" as the empty branch leaves the type unknown — use empty()
    expect(msgs([fx(`if(${prop('due')}, ${prop('due')}.dateAdd(1, "days"), "")`)])).toEqual(['The formula must return a value']);
    expect(msgs([fx(`if(${prop('due')}, ${prop('due')}.dateAdd(1, "days"), empty())`)])).toEqual([]);
    // people lists are fine for a person property, not for a date
    expect(msgs([fx(prop('who'), 'who')])).toEqual([]);
    expect(msgs([fx(prop('who'), 'due')])).toEqual(['The formula has a type error']);
    // variables of one action can't reference each other; a later action can use them
    const v1 = encodeToken({ type: 'context', key: 'var:v:x' });
    expect(msgs([{ id: 'v', type: 'define_variables', variables: [{ id: 'x', name: 'Variable 1', formula: '1' }, { id: 'y', name: 'Variable 2', formula: `${v1} + 1` }] }])).toEqual(['The referenced variable is unavailable']);
    expect(msgs([
      { id: 'v', type: 'define_variables', variables: [{ id: 'x', name: 'Variable 1', formula: prop('due') }] },
      fx(v1),
    ])).toEqual([]);
    expect(msgs([
      { id: 'v', type: 'define_variables', variables: [{ id: 'x', name: 'Variable 1', formula: '"text"' }] },
      fx(v1),
    ])).toEqual(['The formula has a type error']);
  });
  it('converts first-wave button configs', () => {
    const steps = buttonBlockSteps({ format: { button_automation: { trigger: 'button_clicked', actions: [{ id: 'x', type: 'edit_pages', collectionId: 'col-1', propertyId: 'pri', value: 'High' }, { id: 'y', type: 'add_page', collectionId: 'col-1', title: 'Daily @today' }] } } } as any, () => col.schema);
    expect(steps[0]).toEqual({ id: 'x', type: 'edit_pages', collection_id: 'col-1', filter: null, edits: [{ property: 'pri', op: 'set', values: [{ type: 'option', name: 'High' }] }] });
    expect((steps[1] as any).edits[0].values).toEqual([{ type: 'text', text: 'Daily ' }, { type: 'context', key: 'today' }]);
    const prop = buttonPropertySteps({ name: 'B', type: 'button', button_actions: [{ type: 'edit_property', property: 'done', value: 'toggle' }, { type: 'show_confirmation', message: 'Sure?' }] } as any, col.schema);
    expect(prop.map((s) => s.type)).toEqual(['edit_property', 'confirm']);
  });
  it('instantiates template variables', () => {
    const rt: any = [['Due '], ['‣', [['d', templateDate('today', Date.UTC(2026, 0, 1), 'UTC')]]], [' by '], ['‣', [['u', TEMPLATE_ME]]]];
    const out: any = instantiateRichText(rt, { now: Date.UTC(2026, 9, 20, 12), timeZone: 'UTC', userId: 'bob' });
    expect(out[1][1][0][1].start_date).toBe('2026-10-20');
    expect(out[1][1][0][1].template_variable).toBeUndefined();
    expect(out[3][1][0]).toEqual(['u', 'bob']);
  });
  it('webhook payload has selected properties in API shape', () => {
    const r = row('r1', { title: [['Ship']], st: [['Done']], est: [['3']] });
    const body: any = webhookPayload(r, col, ['title', 'st', 'est'], { automationId: 'a', actionId: 's', eventId: 'e' });
    expect(body.source).toEqual({ type: 'automation', automation_id: 'a', action_id: 's', event_id: 'e', attempt: 1 });
    expect(body.data.properties.Name.title[0].plain_text).toBe('Ship');
    expect(body.data.properties.Status.status.name).toBe('Done');
    expect(body.data.properties.Estimate.number).toBe(3);
    expect(body.data.properties.Tags).toBeUndefined();
  });
});
