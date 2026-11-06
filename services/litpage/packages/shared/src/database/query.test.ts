import { describe, expect, it } from 'vitest';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '../records.ts';
import type { RichText } from '../richtext.ts';
import { aggregateRows } from './aggregations.ts';
import { msToYmd, ymdToMs, formatDateRange, relativeRange, startOfDay, addDays, parseDateInput, parseTimeInput } from './dates.ts';
import { evaluateOperator, matchesFilter, valuesFromFilters } from './filters.ts';
import { computeGroups, groupAssignment } from './groups.ts';
import { formatNumber, parseNumberInput } from './numbers.ts';
import { runQuery } from './query.ts';
import { registerFormulaEngine } from './computed.ts';
import type { FilterGroup, QueryContext, Schema } from './types.ts';
import { encodeCheckbox, encodeDate, encodeNumber, encodePeople, encodeRelation, encodeSelect, getPropertyValue, valueToText } from './values.ts';

const NOW = ymdToMs('2026-10-20', '12:00');
const U1 = 'user-1';
const U2 = 'user-2';

const status: PropertySchema = {
  name: 'Status', type: 'status',
  options: [{ id: 's1', value: 'Not started', color: 'default' }, { id: 's2', value: 'In progress', color: 'blue' }, { id: 's3', value: 'Done', color: 'green' }],
  groups: [
    { id: 'g1', name: 'To-do', color: 'gray', optionIds: ['s1'] },
    { id: 'g2', name: 'In progress', color: 'blue', optionIds: ['s2'] },
    { id: 'g3', name: 'Complete', color: 'green', optionIds: ['s3'] },
  ],
  defaultOption: 'Not started',
};

const schema: Schema = {
  title: { name: 'Name', type: 'title' },
  pri: { name: 'Priority', type: 'select', options: [{ id: 'p1', value: 'High', color: 'red' }, { id: 'p2', value: 'Medium', color: 'yellow' }, { id: 'p3', value: 'Low', color: 'green' }] },
  tags: { name: 'Tags', type: 'multi_select', options: [{ id: 't1', value: 'UI', color: 'orange' }, { id: 't2', value: 'Web', color: 'blue' }, { id: 't3', value: 'Bug', color: 'yellow' }] },
  st: status,
  due: { name: 'Due', type: 'date' },
  pts: { name: 'Points', type: 'number', number_format: 'dollar' },
  done: { name: 'Done', type: 'checkbox' },
  who: { name: 'Assignee', type: 'person' },
  url: { name: 'Link', type: 'url' },
  rel: { name: 'Project', type: 'relation', collection_id: 'col-b' },
  created: { name: 'Created', type: 'created_time' },
  f: { name: 'Score', type: 'formula', formula: { expression: 'prop("Points") * 2' } },
};

let seq = 0;
function row(title: string, props: Record<string, RichText | undefined> = {}, extra: Partial<BlockRecord> = {}): BlockRecord {
  seq++;
  const properties: Record<string, any> = { title: [[title]] };
  for (const [k, v] of Object.entries(props)) if (v) properties[k] = v;
  return {
    id: `r${seq}`, version: 1, type: 'page', properties, parent_id: 'col-a', parent_table: 'collection', space_id: 'sp', alive: true,
    created_time: NOW - (100 - seq) * 86_400_000, created_by_id: U1, last_edited_time: NOW, last_edited_by_id: U1, ...extra,
  } as BlockRecord;
}

const date = (d: string, end?: string): RichText => encodeDate(end ? { type: 'daterange', start_date: d, end_date: end } : { type: 'date', start_date: d })!;

const rows = [
  row('Design homepage', { pri: encodeSelect(['High']), tags: encodeSelect(['UI', 'Web']), st: encodeSelect(['In progress']), due: date('2026-10-20', '2026-10-24'), pts: encodeNumber(5), done: encodeCheckbox(false), who: encodePeople([U1]), rel: encodeRelation(['pb1']) }),
  row('Write API spec', { pri: encodeSelect(['Medium']), st: encodeSelect(['Not started']), due: date('2026-10-22'), pts: encodeNumber(3), who: encodePeople([U2]) }),
  row('Fix login bug', { pri: encodeSelect(['High']), tags: encodeSelect(['Bug']), st: encodeSelect(['Done']), due: date('2026-10-15'), pts: encodeNumber(8), done: encodeCheckbox(true), who: encodePeople([U1, U2]) }),
  row('Plan Q4 roadmap', { pri: encodeSelect(['Low']), st: encodeSelect(['In progress']), due: date('2026-10-27'), pts: encodeNumber(13), url: [['https://example.com/q4']] }),
  row('Update docs', { pri: encodeSelect(['Low']), tags: encodeSelect(['Web']), due: date('2026-10-30') }),
  row('', {}),
];

const otherRows: Record<string, BlockRecord> = {
  pb1: { id: 'pb1', version: 1, type: 'page', properties: { title: [['Website']], b1: [['100']] }, parent_id: 'col-b', parent_table: 'collection', space_id: 'sp', alive: true, created_time: 0, created_by_id: U1, last_edited_time: 0, last_edited_by_id: U1 } as BlockRecord,
};

const ctx: QueryContext = {
  now: NOW,
  userId: U1,
  getRecord: (table, id) => {
    if (table === 'lit_user') return { id, name: id === U1 ? 'Alice' : 'Bob' };
    if (table === 'block') return otherRows[id] ?? rows.find((r) => r.id === id);
    if (table === 'collection' && id === 'col-b') return { id: 'col-b', name: [['Projects']], schema: { title: { name: 'Name', type: 'title' }, b1: { name: 'Budget', type: 'number' } } };
    return undefined;
  },
};

const collection = { id: 'col-a', schema } as unknown as CollectionRecord;
function view(over: Partial<CollectionViewRecord> = {}): CollectionViewRecord {
  // manual order = fixture order (rows added with "+ New page" are appended to page_sort)
  return { id: 'v1', version: 1, type: 'table', name: 'Table', format: {}, query2: {}, parent_id: 'b', parent_table: 'block', alive: true, space_id: 'sp', page_sort: rows.map((r) => r.id), ...over } as CollectionViewRecord;
}
const titles = (rs: BlockRecord[]) => rs.map((r) => (r.properties?.title as any)?.[0]?.[0] ?? '');
const leaf = (property: string, operator: string, value?: any) => ({ property, filter: { operator, ...(value !== undefined ? { value } : {}) } });
const and = (...filters: any[]): FilterGroup => ({ operator: 'and', filters });
const or = (...filters: any[]): FilterGroup => ({ operator: 'or', filters });
const exact = (value: any) => ({ type: 'exact' as const, value });

describe('values', () => {
  it('decodes every stored encoding', () => {
    const r = rows[0];
    expect(getPropertyValue(r, 'pri', schema, ctx)).toMatchObject({ kind: 'select', options: [{ value: 'High', color: 'red' }] });
    expect(getPropertyValue(r, 'tags', schema, ctx)).toMatchObject({ kind: 'select', options: [{ value: 'UI' }, { value: 'Web' }] });
    expect(getPropertyValue(r, 'st', schema, ctx)).toMatchObject({ kind: 'status', option: { value: 'In progress' }, group: { name: 'In progress' } });
    expect(getPropertyValue(r, 'pts', schema, ctx)).toEqual({ kind: 'number', number: 5 });
    expect(getPropertyValue(r, 'done', schema, ctx)).toEqual({ kind: 'checkbox', checked: false });
    expect(getPropertyValue(r, 'who', schema, ctx)).toEqual({ kind: 'person', ids: [U1] });
    expect(getPropertyValue(r, 'rel', schema, ctx)).toEqual({ kind: 'relation', ids: ['pb1'] });
    const d = getPropertyValue(r, 'due', schema, ctx);
    expect(d.kind === 'date' && d.date?.isRange).toBe(true);
    expect(valueToText(getPropertyValue(r, 'pts', schema, ctx), schema.pts)).toBe('$5.00');
  });
  it('status falls back to the default option when empty', () => {
    expect(getPropertyValue(rows[4], 'st', schema, ctx)).toMatchObject({ kind: 'status', option: { value: 'Not started' }, group: { name: 'To-do' } });
  });
  it('created time comes from the block record', () => {
    const v = getPropertyValue(rows[0], 'created', schema, ctx);
    expect(v.kind === 'date' && v.date?.startMs).toBe(rows[0].created_time);
  });
  it('formula uses the registered engine (prop() through getPropertyValue)', () => {
    registerFormulaEngine((expr, r, s, c) => {
      expect(expr).toBe('prop("Points") * 2');
      const v = getPropertyValue(r, 'pts', s, c);
      return v.kind === 'number' && v.number !== null ? v.number * 2 : null;
    });
    expect(getPropertyValue(rows[2], 'f', schema, ctx)).toEqual({ kind: 'number', number: 16 });
    const res = runQuery(rows, collection, view({ query2: { sort: [{ property: 'f', direction: 'descending' }] } }), ctx);
    expect(titles(res.rows).slice(0, 2)).toEqual(['Plan Q4 roadmap', 'Fix login bug']);
    registerFormulaEngine(null);
  });
});

describe('filters', () => {
  const q = (filter: FilterGroup) => titles(runQuery(rows, collection, view({ query2: { filter } }), ctx).rows);
  it('text operators (case-insensitive)', () => {
    expect(q(and(leaf('title', 'string_contains', exact('DOC'))))).toEqual(['Update docs']);
    expect(q(and(leaf('title', 'string_is', exact('fix login bug'))))).toEqual(['Fix login bug']);
    expect(q(and(leaf('title', 'string_starts_with', exact('Plan'))))).toEqual(['Plan Q4 roadmap']);
    expect(q(and(leaf('title', 'string_ends_with', exact('spec'))))).toEqual(['Write API spec']);
    expect(q(and(leaf('title', 'string_does_not_contain', exact('e'))))).toEqual(['Fix login bug', 'Plan Q4 roadmap', '']);
    expect(q(and(leaf('title', 'is_empty')))).toEqual(['']);
    expect(q(and(leaf('url', 'is_not_empty')))).toEqual(['Plan Q4 roadmap']);
  });
  it('filters without a value are ignored', () => {
    expect(q(and(leaf('title', 'string_contains', exact(''))))).toHaveLength(rows.length);
    expect(q(and(leaf('pts', 'number_greater_than')))).toHaveLength(rows.length);
  });
  it('number operators', () => {
    expect(q(and(leaf('pts', 'number_greater_than', exact(5))))).toEqual(['Fix login bug', 'Plan Q4 roadmap']);
    expect(q(and(leaf('pts', 'number_less_than_or_equal_to', exact(5))))).toEqual(['Design homepage', 'Write API spec']);
    expect(q(and(leaf('pts', 'number_equals', exact(3))))).toEqual(['Write API spec']);
    expect(q(and(leaf('pts', 'number_does_not_equal', exact(3))))).toEqual(['Design homepage', 'Fix login bug', 'Plan Q4 roadmap', 'Update docs', '']);
    expect(q(and(leaf('pts', 'is_empty')))).toEqual(['Update docs', '']);
  });
  it('select / multi-select / status', () => {
    expect(q(and(leaf('pri', 'enum_is', exact('High'))))).toEqual(['Design homepage', 'Fix login bug']);
    expect(q(and(leaf('pri', 'enum_is', [exact('Medium'), exact('Low')])))).toEqual(['Write API spec', 'Plan Q4 roadmap', 'Update docs']);
    expect(q(and(leaf('pri', 'enum_is_not', exact('Low'))))).toEqual(['Design homepage', 'Write API spec', 'Fix login bug', '']);
    expect(q(and(leaf('tags', 'enum_contains', exact('Web'))))).toEqual(['Design homepage', 'Update docs']);
    expect(q(and(leaf('tags', 'enum_does_not_contain', exact('Web'))))).toEqual(['Write API spec', 'Fix login bug', 'Plan Q4 roadmap', '']);
    expect(q(and(leaf('st', 'status_is', { type: 'is_group', value: 'Complete' })))).toEqual(['Fix login bug']);
    expect(q(and(leaf('st', 'status_is', { type: 'is_option', value: 'In progress' })))).toEqual(['Design homepage', 'Plan Q4 roadmap']);
    expect(q(and(leaf('st', 'status_is_not', { type: 'is_group', value: 'To-do' })))).toEqual(['Design homepage', 'Fix login bug', 'Plan Q4 roadmap']);
  });
  it('checkbox / person (Me) / relation', () => {
    expect(q(and(leaf('done', 'checkbox_is', exact(true))))).toEqual(['Fix login bug']);
    expect(q(and(leaf('done', 'checkbox_is_not', exact(true))))).toHaveLength(5);
    expect(q(and(leaf('who', 'person_contains', { type: 'relative', value: 'me' })))).toEqual(['Design homepage', 'Fix login bug']);
    expect(q(and(leaf('who', 'person_does_not_contain', exact(U2))))).toEqual(['Design homepage', 'Plan Q4 roadmap', 'Update docs', '']);
    expect(q(and(leaf('rel', 'relation_contains', exact('pb1'))))).toEqual(['Design homepage']);
    expect(q(and(leaf('rel', 'is_empty')))).toHaveLength(5);
  });
  it('date operators incl. relative values, ranges and end dates', () => {
    expect(q(and(leaf('due', 'date_is', { type: 'relative', value: 'today' })))).toEqual(['Design homepage']);
    expect(q(and(leaf('due', 'date_is_before', { type: 'relative', value: 'today' })))).toEqual(['Fix login bug']);
    expect(q(and(leaf('due', 'date_is_on_or_after', exact({ type: 'date', start_date: '2026-10-27' }))))).toEqual(['Plan Q4 roadmap', 'Update docs']);
    expect(q(and(leaf('due', 'date_is_after', exact('2026-10-22'))))).toEqual(['Plan Q4 roadmap', 'Update docs']);
    expect(q(and(leaf('due', 'date_is_on_or_before', { type: 'relative', value: 'yesterday' })))).toEqual(['Fix login bug']);
    expect(q(and(leaf('due', 'date_is_on_or_before', { type: 'relative', value: 'one_week_ago' })))).toEqual([]);
    // the past week = [Oct 13, Oct 20]
    expect(q(and(leaf('due', 'date_is_within', { type: 'relative', value: 'the_past_week' })))).toEqual(['Design homepage', 'Fix login bug']);
    // next 1 week = [Oct 20, Oct 27]
    expect(q(and(leaf('due', 'date_is_within', { type: 'relative', value: 'custom', direction: 'future', count: 1, unit: 'week' })))).toEqual(['Design homepage', 'Write API spec', 'Plan Q4 roadmap']);
    // this week (Sun Oct 18 – Sat Oct 24)
    expect(q(and(leaf('due', 'date_is_relative_to', { type: 'relative', value: 'surrounding', unit: 'week' })))).toEqual(['Design homepage', 'Write API spec']);
    expect(q(and(leaf('due', 'date_is_within', exact({ type: 'daterange', start_date: '2026-10-21', end_date: '2026-10-28' }))))).toEqual(['Write API spec', 'Plan Q4 roadmap']);
    // end date of the range (Oct 24)
    expect(titles(runQuery(rows, collection, view({ query2: { filter: and({ property: 'due', filter: { operator: 'date_is', value: exact('2026-10-24'), use_end: true } }) } }), ctx).rows)).toEqual(['Design homepage']);
    expect(q(and(leaf('created', 'date_is_within', { type: 'relative', value: 'the_past_year' })))).toHaveLength(rows.length);
  });
  it('nested AND / OR groups', () => {
    const f = or(and(leaf('pri', 'enum_is', exact('High')), leaf('done', 'checkbox_is', exact(true))), and(leaf('pri', 'enum_is', exact('Low')), leaf('tags', 'enum_contains', exact('Web'))));
    expect(q(and(f))).toEqual(['Fix login bug', 'Update docs']);
    const deep = and(leaf('pts', 'is_not_empty'), or(leaf('title', 'string_contains', exact('API')), and(or(leaf('tags', 'enum_contains', exact('UI'))))));
    expect(q(deep)).toEqual(['Design homepage', 'Write API spec']);
    expect(q(or())).toHaveLength(rows.length);
    expect(q(or(leaf('title', 'string_contains', exact(''))))).toHaveLength(rows.length);
  });
  it('property_filters chips AND with query2.filter', () => {
    const v = view({ format: { property_filters: [{ id: 'x', filter: leaf('pri', 'enum_is', exact('High')) }] }, query2: { filter: and(leaf('done', 'checkbox_is', exact(false))) } });
    expect(titles(runQuery(rows, collection, v, ctx).rows)).toEqual(['Design homepage']);
  });
  it('quantifiers on list results', () => {
    const arr = { kind: 'array' as const, items: [{ kind: 'number' as const, number: 1 }, { kind: 'number' as const, number: 7 }] };
    expect(evaluateOperator(arr.items[1], 'number_greater_than', exact(5), undefined, ctx)).toBe(true);
    const r = row('arr');
    const s: Schema = { title: { name: 'Name', type: 'title' }, ro: { name: 'R', type: 'rollup' } };
    registerFormulaEngine(null);
    expect(matchesFilter(r, and({ property: 'ro', filter: { operator: 'any', subfilter: { operator: 'is_empty' } } }), s, ctx)).toBe(true);
  });
  it('search matches title and property text', () => {
    expect(titles(runQuery(rows, collection, view(), ctx, { search: 'bob' }).rows)).toEqual(['Write API spec', 'Fix login bug']);
    expect(titles(runQuery(rows, collection, view(), ctx, { search: 'website' }).rows)).toEqual(['Design homepage']);
  });
  it('values inherited from filters for new rows', () => {
    const vals = valuesFromFilters([leaf('pri', 'enum_is', exact('High')), leaf('who', 'person_contains', { type: 'relative', value: 'me' }), or(leaf('done', 'checkbox_is', exact(true)))], schema, ctx);
    expect(vals).toEqual({ pri: { type: 'select', value: ['High'] }, who: { type: 'person', value: [U1] } });
  });
});

describe('sorts', () => {
  const s = (...sort: { property: string; direction: 'ascending' | 'descending' }[]) => titles(runQuery(rows, collection, view({ query2: { sort } }), ctx).rows);
  it('select sorts by option order, empty last in both directions', () => {
    expect(s({ property: 'pri', direction: 'ascending' })).toEqual(['Design homepage', 'Fix login bug', 'Write API spec', 'Plan Q4 roadmap', 'Update docs', '']);
    expect(s({ property: 'pri', direction: 'descending' })).toEqual(['Plan Q4 roadmap', 'Update docs', 'Write API spec', 'Design homepage', 'Fix login bug', '']);
  });
  it('multi-level sort', () => {
    expect(s({ property: 'pri', direction: 'ascending' }, { property: 'pts', direction: 'descending' })).toEqual(['Fix login bug', 'Design homepage', 'Write API spec', 'Plan Q4 roadmap', 'Update docs', '']);
  });
  it('title / date / number / checkbox / status', () => {
    expect(s({ property: 'title', direction: 'ascending' })).toEqual(['Design homepage', 'Fix login bug', 'Plan Q4 roadmap', 'Update docs', 'Write API spec', '']);
    expect(s({ property: 'due', direction: 'descending' }).slice(0, 2)).toEqual(['Update docs', 'Plan Q4 roadmap']);
    expect(s({ property: 'pts', direction: 'ascending' })).toEqual(['Write API spec', 'Design homepage', 'Fix login bug', 'Plan Q4 roadmap', 'Update docs', '']);
    expect(s({ property: 'done', direction: 'descending' })[0]).toBe('Fix login bug');
    expect(s({ property: 'st', direction: 'ascending' })).toEqual(['Write API spec', 'Update docs', '', 'Design homepage', 'Plan Q4 roadmap', 'Fix login bug']);
  });
  it('manual order: unlisted rows newest first, then page_sort order', () => {
    const v = view({ page_sort: [rows[3].id, rows[0].id] });
    expect(titles(runQuery(rows, collection, v, ctx).rows)).toEqual(['', 'Update docs', 'Fix login bug', 'Write API spec', 'Plan Q4 roadmap', 'Design homepage']);
    const all = view({ page_sort: rows.map((r) => r.id) });
    expect(titles(runQuery(rows, collection, all, ctx).rows)).toEqual(titles(rows));
  });
});

describe('groups', () => {
  it('board columns by status option with counts and saved manual order + hidden', () => {
    const v = view({
      type: 'board',
      format: {
        board_columns_by: { type: 'status', property: 'st', groupBy: 'option', sort: { type: 'manual' }, hideEmptyGroups: false },
        board_columns: [
          { property: 'st', value: { type: 'status', value: { type: 'by_option', option: 'Done' } } },
          { property: 'st', value: { type: 'status', value: { type: 'by_option', option: 'Not started' } }, hidden: true },
        ],
      },
      query2: { aggregations: [{ aggregator: 'count' }] },
    });
    const res = runQuery(rows, collection, v, ctx);
    expect(res.groups!.map((g) => [g.label, g.rows.length, g.hidden, g.aggregation?.display])).toEqual([
      ['Done', 1, false, '1'],
      ['Not started', 3, true, '3'],
      ['In progress', 2, false, '2'],
    ]);
  });
  it('status grouped by group (To-do / In progress / Complete)', () => {
    const v = view({ format: { collection_group_by: { type: 'status', property: 'st', groupBy: 'group', sort: { type: 'ascending' } } } });
    expect(runQuery(rows, collection, v, ctx).groups!.map((g) => [g.label, g.color, g.rows.length])).toEqual([['To-do', 'gray', 3], ['In progress', 'blue', 2], ['Complete', 'green', 1]]);
  });
  it('multi-select puts rows in several groups; uncategorized "No Tags" first; hideEmptyGroups', () => {
    const v = view({ format: { collection_group_by: { type: 'multi_select', property: 'tags', sort: { type: 'manual' }, hideEmptyGroups: true } } });
    const g = runQuery(rows, collection, v, ctx).groups!;
    expect(g.map((x) => [x.label, titles(x.rows)])).toEqual([
      ['No Tags', ['Write API spec', 'Plan Q4 roadmap', '']],
      ['UI', ['Design homepage']],
      ['Web', ['Design homepage', 'Update docs']],
      ['Bug', ['Fix login bug']],
    ]);
  });
  it('select groups keep empty options unless hidden; descending order', () => {
    const extra = row('Only high', { pri: encodeSelect(['High']) });
    const g = computeGroups([extra], { type: 'select', property: 'pri', sort: { type: 'descending' }, hideEmptyGroups: false }, schema, ctx, {});
    expect(g.map((x) => x.label)).toEqual(['Low', 'Medium', 'High']);
  });
  it('person, checkbox, number ranges, text prefixes, date buckets', () => {
    const person = computeGroups(rows, { type: 'person', property: 'who', sort: { type: 'manual' } }, schema, ctx);
    expect(person.map((g) => [g.label, g.rows.length])).toEqual([['No Assignee', 3], ['Alice', 2], ['Bob', 2]]);
    const cb = computeGroups(rows, { type: 'checkbox', property: 'done', sort: { type: 'manual' } }, schema, ctx);
    expect(cb.map((g) => [g.label, g.rows.length])).toEqual([['Unchecked', 5], ['Checked', 1]]);
    const num = computeGroups(rows, { type: 'number', property: 'pts', groupBy: { type: 'range' }, start: 0, end: 10, size: 5, sort: { type: 'ascending' } }, schema, ctx);
    expect(num.map((g) => [g.label, g.rows.length])).toEqual([['No Points', 2], ['0 through 5', 1], ['5 through 10', 2], ['Outside range', 1]]);
    const txt = computeGroups(rows, { type: 'title', property: 'title', groupBy: 'alphabet_prefix', sort: { type: 'ascending' } }, schema, ctx);
    expect(txt.map((g) => g.label)).toEqual(['No Name', 'D', 'F', 'P', 'U', 'W']);
    const rel = computeGroups(rows, { type: 'date', property: 'due', groupBy: 'relative', sort: { type: 'ascending' } }, schema, ctx);
    expect(rel.map((g) => [g.label, g.rows.length])).toEqual([['No Due', 1], ['Last 7 days', 1], ['Today', 1], ['Next 7 days', 2], ['Next 30 days', 1]]);
    const month = computeGroups(rows, { type: 'date', property: 'due', groupBy: 'month', sort: { type: 'ascending' } }, schema, ctx);
    expect(month.map((g) => g.label)).toEqual(['No Due', 'October 2026']);
  });
  it('board sub-groups (collection_group_by on a board)', () => {
    const v = view({ type: 'board', format: { board_columns_by: { type: 'select', property: 'pri', sort: { type: 'manual' } }, collection_group_by: { type: 'checkbox', property: 'done', sort: { type: 'manual' } } } });
    const g = runQuery(rows, collection, v, ctx).groups!;
    const high = g.find((x) => x.label === 'High')!;
    expect(high.subgroups!.map((s) => [s.label, s.rows.length])).toEqual([['Unchecked', 1], ['Checked', 1]]);
  });
  it('group assignment for new rows / drags', () => {
    const g = computeGroups(rows, { type: 'status', property: 'st', groupBy: 'group', sort: { type: 'ascending' } }, schema, ctx);
    expect(groupAssignment(g.find((x) => x.label === 'Complete')!, status)).toEqual({ kind: 'status', value: 'Done' });
  });
});

describe('calculations', () => {
  const agg = (property: string | undefined, aggregator: string) => aggregateRows(rows, { property, aggregator: aggregator as any }, schema, ctx).display;
  it('counts and percents', () => {
    expect(agg('title', 'count')).toBe('6');
    expect(agg('tags', 'count_values')).toBe('4');
    expect(agg('tags', 'unique')).toBe('3');
    expect(agg('pts', 'empty')).toBe('2');
    expect(agg('pts', 'not_empty')).toBe('4');
    expect(agg('pts', 'percent_empty')).toBe('33.33%');
    expect(agg('pts', 'percent_not_empty')).toBe('66.67%');
    expect(agg('who', 'unique')).toBe('2');
    expect(agg('who', 'count_values')).toBe('4');
  });
  it('checkbox', () => {
    expect(agg('done', 'checked')).toBe('1');
    expect(agg('done', 'unchecked')).toBe('5');
    expect(agg('done', 'percent_checked')).toBe('16.67%');
  });
  it('number statistics with the property number format', () => {
    expect(agg('pts', 'sum')).toBe('$29.00');
    expect(agg('pts', 'average')).toBe('$7.25');
    expect(agg('pts', 'median')).toBe('$6.50');
    expect(agg('pts', 'min')).toBe('$3.00');
    expect(agg('pts', 'max')).toBe('$13.00');
    expect(agg('pts', 'range')).toBe('$10.00');
  });
  it('dates', () => {
    expect(agg('due', 'earliest_date')).toBe('Oct 15, 2026');
    expect(agg('due', 'latest_date')).toBe('Oct 30, 2026');
    expect(agg('due', 'date_range')).toBe('15 days');
  });
  it('status per group', () => {
    expect(aggregateRows(rows, { property: 'st', aggregator: { operator: 'count_per_group', groupName: 'To-do' } }, schema, ctx).display).toBe('3');
    expect(aggregateRows(rows, { property: 'st', aggregator: { operator: 'percent_per_group', groupName: 'Complete' } }, schema, ctx).display).toBe('16.67%');
  });
  it('footer aggregations come from query2.aggregations', () => {
    const res = runQuery(rows, collection, view({ query2: { aggregations: [{ property: 'pts', aggregator: 'sum' }, { property: 'title', aggregator: 'count' }], filter: and(leaf('pri', 'enum_is', exact('High'))) } }), ctx);
    expect(res.aggregations.pts.display).toBe('$13.00');
    expect(res.aggregations.title.display).toBe('2');
  });
  it('rollup default engine (sum over a relation)', () => {
    const s: Schema = { ...schema, ro: { name: 'Budget', type: 'rollup', relation_property: 'rel', target_property: 'b1', aggregation: 'sum' } };
    expect(getPropertyValue(rows[0], 'ro', s, { ...ctx, cache: new Map() })).toEqual({ kind: 'number', number: 100 });
  });
});

describe('formatting & parsing', () => {
  it('number formats', () => {
    expect(formatNumber(1234.5, 'number')).toBe('1234.5');
    expect(formatNumber(1234.5, 'number_with_commas')).toBe('1,234.5');
    expect(formatNumber(0.5, 'percent')).toBe('50%');
    expect(formatNumber(1200, 'dollar')).toBe('$1,200.00');
    expect(formatNumber(1200, 'won')).toBe('₩1,200');
    expect(formatNumber(1200, 'euro')).toBe('€1,200.00');
    expect(formatNumber(2, 'number', 'precision_2')).toBe('2.00');
    expect(formatNumber(1.5, 'bitcoin')).toBe('₿1.5');
    expect(parseNumberInput('1,234.5')).toBe(1234.5);
    expect(parseNumberInput('12%')).toBe(0.12);
    expect(parseNumberInput('$1,200')).toBe(1200);
    expect(parseNumberInput('abc')).toBe(null);
  });
  it('date formats and ranges', () => {
    const r = getPropertyValue(rows[0], 'due', schema, ctx);
    expect(formatDateRange(r.kind === 'date' ? r.date : null)).toBe('October 20, 2026 → October 24, 2026');
    const dt = encodeDate({ type: 'datetime', start_date: '2026-10-20', start_time: '16:00' });
    const v = getPropertyValue(row('t', { due: dt }), 'due', schema, ctx);
    expect(valueToText(v, schema.due, ctx)).toBe('October 20, 2026 4:00 PM');
    expect(valueToText(v, { ...schema.due, date_format: 'relative', time_format: 'H:mm' } as PropertySchema, ctx)).toBe('Today 16:00');
    expect(valueToText(v, { ...schema.due, date_format: 'MM/DD/YYYY' } as PropertySchema, ctx)).toBe('10/20/2026 4:00 PM');
  });
  it('relative ranges', () => {
    const [s, e] = relativeRange({ value: 'the_past_month' }, NOW)!;
    expect(msToYmd(s)).toBe('2026-09-20');
    expect(msToYmd(e)).toBe('2026-10-21');
    expect(startOfDay(addDays(NOW, 1))).toBe(ymdToMs('2026-10-21'));
  });
  it('date and time input parsing', () => {
    expect(parseDateInput('Oct 20, 2026')).toBe('2026-10-20');
    expect(parseDateInput('2026/10/05')).toBe('2026-10-05');
    expect(parseDateInput('10/05/2026')).toBe('2026-10-05');
    expect(parseDateInput('10/05/2026', NOW, 'DD/MM/YYYY')).toBe('2026-05-10');
    expect(parseDateInput('tomorrow', NOW)).toBe('2026-10-21');
    expect(parseTimeInput('4:30 PM')).toBe('16:30');
    expect(parseTimeInput('09:05')).toBe('09:05');
  });
});

describe('conditional colors', () => {
  it('colors rows / cells whose values match a rule; inactive rules never match', async () => {
    const { conditionalColorsFor } = await import('./conditional.ts');
    const rules = [
      { id: 'a', property: 'pri', filter: { operator: 'enum_is', value: { type: 'exact', value: 'High' } }, color: 'red_background' },
      { id: 'b', property: 'done', filter: { operator: 'checkbox_is', value: { type: 'exact', value: true } }, color: 'green_background', apply_to: 'property' as const },
      { id: 'c', property: 'pri', filter: { operator: 'enum_is' }, color: 'blue_background' },
    ];
    const design = conditionalColorsFor(rows[0], rules as any, schema, ctx);
    expect(design.row).toBe('red');
    expect(design.cells.done).toBeUndefined();
    const fix = conditionalColorsFor(rows[2], rules as any, schema, ctx);
    expect(fix.row).toBe('red');
    expect(fix.cells.done).toBe('green');
    const docs = conditionalColorsFor(rows[4], rules as any, schema, ctx);
    expect(docs.row).toBeUndefined();
  });
});
