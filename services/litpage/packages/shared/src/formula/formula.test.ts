// Formula 2.0 engine tests: every library function (examples from the function docs), operators,
// properties, lambdas, let/lets, dates/time zones, errors, and relations/rollups.
import { describe, expect, it } from 'vitest';
import type { BlockRecord, CollectionRecord, PropertySchema } from '../records.ts';
import {
  evaluateFormula, formulaResultType, typeLabel, LIBRARY, MENU_ORDER, plainText, sourceToCode, codeToSource, resolvePropCalls, formatFormulaValue,
  formatMoment, DT, parseZone, encodeToken, FUNCTION_DOCS, type FValue, type FormulaContext,
} from './index.ts';
import { computeRollup, getRelationTargets, planRelationChange, encodeRelation, relationSchemas, aggregate } from '../relation/index.ts';

// ------------------------------------------------------------------ fixtures
const SPACE = 'space-1';
const TZ = 'America/Los_Angeles';
// 2023-08-30 17:55 PDT (UTC-7) — the "now" used in the help examples
const NOW = Date.UTC(2023, 7, 31, 0, 55);

const tasksSchema: Record<string, PropertySchema> = {
  title: { name: 'Name', type: 'title' },
  est: { name: 'Estimate', type: 'number' },
  done: { name: 'Done', type: 'checkbox' },
  tags: { name: 'Tags', type: 'multi_select', options: [{ id: 'o1', value: 'Finance', color: 'blue' }, { id: 'o2', value: 'Ops', color: 'red' }] },
  due: { name: 'Due', type: 'date' },
  who: { name: 'Assignee', type: 'person' },
  proj: { name: 'Project', type: 'relation', collection_id: 'projects', property: 'tasks' },
  stat: { name: 'Status', type: 'status', options: [{ id: 's1', value: 'Not started', color: 'default' }, { id: 's2', value: 'Done', color: 'green' }], groups: [{ id: 'g1', name: 'To-do', color: 'gray', optionIds: ['s1'] }, { id: 'g3', name: 'Complete', color: 'green', optionIds: ['s2'] }] },
  link: { name: 'Link', type: 'url' },
  tid: { name: 'Task ID', type: 'auto_increment_id', prefix: 'TASK' },
  score: { name: 'Score', type: 'formula', version: 'v2', formula2: { code: [['prop("Estimate") * 10']], result_type: { type: 'number' } } } as unknown as PropertySchema,
  loop: { name: 'Loop', type: 'formula', formula2: { code: [['prop("Loop") + 1']] } } as unknown as PropertySchema,
};
const projectsSchema: Record<string, PropertySchema> = {
  title: { name: 'Name', type: 'title' },
  budget: { name: 'Budget', type: 'number' },
  tasks: { name: 'Tasks', type: 'relation', collection_id: 'tasks', property: 'proj' },
  total: { name: 'Total estimate', type: 'rollup', relation_property: 'tasks', target_property: 'est', aggregation: 'sum' },
  count: { name: 'Task count', type: 'rollup', relation_property: 'tasks', target_property: 'title', aggregation: 'count' },
  names: { name: 'Task names', type: 'rollup', relation_property: 'tasks', target_property: 'title', aggregation: 'show_original' },
  tagsAll: { name: 'All tags', type: 'rollup', relation_property: 'tasks', target_property: 'tags', aggregation: 'show_unique' },
  doneCnt: { name: 'Done', type: 'rollup', relation_property: 'tasks', target_property: 'done', aggregation: 'checked' },
  pctDone: { name: 'Done %', type: 'rollup', relation_property: 'tasks', target_property: 'done', aggregation: 'percent_checked' },
  firstDue: { name: 'First due', type: 'rollup', relation_property: 'tasks', target_property: 'due', aggregation: 'earliest_date' },
  scoreSum: { name: 'Score sum', type: 'rollup', relation_property: 'tasks', target_property: 'score', aggregation: 'sum' },
  complete: { name: 'Complete', type: 'rollup', relation_property: 'tasks', target_property: 'stat', aggregation: { operator: 'count_per_group', groupName: 'Complete' } as unknown as string },
};

function row(id: string, col: string, props: Record<string, unknown>, extra: Partial<BlockRecord> = {}): BlockRecord {
  return {
    id, version: 1, type: 'page', parent_id: col, parent_table: 'collection', space_id: SPACE, alive: true,
    created_time: Date.UTC(2023, 6, 10, 21, 35), created_by_id: 'u1', last_edited_time: Date.UTC(2023, 6, 11, 0, 0), last_edited_by_id: 'u2',
    properties: props as BlockRecord['properties'], ...extra,
  } as BlockRecord;
}

const dateProp = (d: Record<string, string>) => [['‣', [['d', d]]]];
const blocks: Record<string, BlockRecord> = {
  t1: row('t1', 'tasks', {
    title: [['Design homepage']], est: [['5']], done: [['Yes']], tags: [['Finance,Ops']], due: dateProp({ type: 'date', start_date: '2023-09-07' }),
    who: [['‣', [['u', 'u1']]], [','], ['‣', [['u', 'u2']]]], proj: encodeRelation(['p1']), stat: [['Done']], link: [['https://docs.litpage.dev']], tid: [['12']],
  }),
  t2: row('t2', 'tasks', { title: [['Write docs']], est: [['3']], done: [['No']], tags: [['Ops']], due: dateProp({ type: 'daterange', start_date: '2022-09-07', end_date: '2023-09-07' }), proj: encodeRelation(['p1']), stat: [['Not started']] }),
  t3: row('t3', 'tasks', { title: [['Orphan']], loop: [] }),
  dead: row('dead', 'tasks', { title: [['Deleted']] }, { alive: false }),
  p1: row('p1', 'projects', { title: [['Alpha']], budget: [['1000']], tasks: encodeRelation(['t1', 't2', 'dead']) }),
  p2: row('p2', 'projects', { title: [['Beta']] }),
};
const collections: Record<string, CollectionRecord> = {
  tasks: { id: 'tasks', version: 1, schema: tasksSchema, parent_id: 'db1', parent_table: 'block', alive: true, space_id: SPACE },
  projects: { id: 'projects', version: 1, schema: projectsSchema, parent_id: 'db2', parent_table: 'block', alive: true, space_id: SPACE },
};
const users: Record<string, { id: string; name: string; email: string }> = {
  u1: { id: 'u1', name: 'Grace Hopper', email: 'grace@example.com' },
  u2: { id: 'u2', name: 'Ada Lovelace', email: 'ada@example.com' },
};
const ctx: FormulaContext = {
  getBlock: (id) => blocks[id],
  getCollection: (id) => collections[id],
  getUser: (id) => users[id],
  timeZone: TZ,
  now: NOW,
};

/** Simplify a formula value for assertions. */
function js(v: FValue): unknown {
  switch (v.type) {
    case 'number': case 'checkbox': return v.value;
    case 'text': return plainText(v.value, { pageTitle: (id) => plainText(blocks[id]?.properties?.title as never), userName: (id) => users[id]?.name ?? '', timeZone: TZ });
    case 'date': return v.value;
    case 'array': return v.values.map(js);
    case 'block': return `page:${v.value.id}`;
    case 'person': return `user:${v.value.id}`;
    case 'undefined': return undefined;
    default: return `fn:${v.name}`;
  }
}
function ev(src: string, r: BlockRecord | null = blocks.t1, schema = r?.parent_id === 'projects' ? projectsSchema : tasksSchema) {
  const res = evaluateFormula(src, r, schema, ctx);
  return res;
}
const val = (src: string, r: BlockRecord | null = blocks.t1) => {
  const res = ev(src, r);
  if (res.error) throw new Error(`${src} -> ${res.error.type}: ${res.error.message}`);
  return js(res.value);
};
const err = (src: string, r: BlockRecord | null = blocks.t1) => ev(src, r).error;

// ------------------------------------------------------------------ library coverage
describe('library', () => {
  it('defines all 97 Litpage formula functions', () => {
    expect(Object.keys(LIBRARY).length).toBe(97);
    const listed = Object.values(MENU_ORDER).flat();
    expect(listed.length).toBe(95);
    for (const n of listed) expect(LIBRARY[n], n).toBeDefined();
    for (const n of listed) expect(FUNCTION_DOCS[n], `docs for ${n}`).toBeDefined();
  });
});

describe('generic', () => {
  it('if / ternary', () => {
    expect(val('if(true, 1, 2)')).toBe(1);
    expect(val('if(false, 1, 2)')).toBe(2);
    expect(val('true.if(1, 2)')).toBe(1);
    expect(val('prop("Done") == true ? "Complete" : "Incomplete"')).toBe('Complete');
    expect(val('if(prop("Estimate") > 10, 1 / 0, "small")')).toBe('small'); // lazy branches
    expect(err('if(true, 1)')?.type).toBe('FunctionCallTooFewArguments');
  });
  it('ifs', () => {
    expect(val('ifs(true, 1, true, 2, 3)')).toBe(1);
    expect(val('ifs(false, 1, false, 2, 3)')).toBe(3);
    expect(val('true.ifs(1, true, 2, 3)')).toBe(1);
    expect(val('false.ifs(1, false, 2, 3)')).toBe(3);
    expect(val('ifs(false, 1, false, 2)')).toBe(undefined);
  });
  it('and / or / not', () => {
    expect(val('and(true, true, true)')).toBe(true);
    expect(val('and(3 > 2, 2 > 3)')).toBe(false);
    expect(val('true.and(true, true)')).toBe(true);
    expect(val('or(true, false, false)')).toBe(true);
    expect(val('(3 > 2).or(2 < 3)')).toBe(true);
    expect(val('not(true)')).toBe(false);
    expect(val('not(2 > 3)')).toBe(true);
    expect(val('true.not()')).toBe(false);
    expect(val('3 > 2 and 2 > 3 == false')).toBe(true);
    expect(val('true && false || true')).toBe(true);
    expect(val('not prop("Done")')).toBe(false);
    expect(val('!prop("Done")')).toBe(false);
  });
  it('empty', () => {
    expect(val('empty()')).toBe(undefined);
    expect(val('empty(0)')).toBe(true);
    expect(val('empty([])')).toBe(true);
    expect(val('0.empty()')).toBe(true);
    expect(val('empty("")')).toBe(true);
    expect(val('empty("a")')).toBe(false);
    expect(val('empty(prop("Link"))', blocks.t2)).toBe(true);
  });
  it('length', () => {
    expect(val('length("hello")')).toBe(5);
    expect(val('length([1, 2, 3])')).toBe(3);
    expect(val('"hello".length()')).toBe(5);
    expect(val('prop("Tags").length()')).toBe(2);
    expect(val('length(12345)')).toBe(5); // number coerced to text
  });
  it('format', () => {
    expect(val('format(1234)')).toBe('1234');
    expect(val('1234.format()')).toBe('1234');
    expect(val('format(true)')).toBe('true');
    expect(val('format([1, 2, 3])')).toBe('1,2,3');
    expect(val('format(parseDate("2023-07-10"))')).toBe('July 10, 2023');
    expect(val('format(now())')).toBe('August 30, 2023 5:55 PM');
  });
  it('equal / unequal', () => {
    expect(val('equal(1, 1)')).toBe(true);
    expect(val('"a" == "b"')).toBe(false);
    expect(val('1.equal(1)')).toBe(true);
    expect(val('unequal(1, 2)')).toBe(true);
    expect(val('"a" != "a"')).toBe(false);
    expect(val('[1, 2] == [1, 2]')).toBe(true);
    expect(val('1 == "1"')).toBe(false);
    expect(val('"a" !== "b"')).toBe(true); // lenient strict form used in help examples
  });
  it('let / lets', () => {
    expect(val('let(name, "Doug Engelbart", "Hello, " + name + "!")')).toBe('Hello, Doug Engelbart!');
    expect(val('let(radius, 4, round(pi() * radius ^ 2))')).toBe(50);
    expect(val('name.let("Alan Kay", "Hello, " + name + "!")')).toBe('Hello, Alan Kay!');
    expect(val('lets(a, "Hello", b, "world", a + " " + b)')).toBe('Hello world');
    expect(val('lets(base, 3, height, 8, base * height / 2)')).toBe(12);
    expect(val('lets(a, 1, b, a + 1, b * 10)')).toBe(20);
    expect(err('let("x", 1, x)')?.type).toBe('LetBindingNameNotIdentifier');
  });
});

describe('text', () => {
  it('substring / contains / test / match', () => {
    expect(val('substring("Litpage", 0, 3)')).toBe('Lit');
    expect(val('substring("Litpage", 3)')).toBe('page');
    expect(val('"Litpage".substring(0, 3)')).toBe('Lit');
    expect(val('contains("Litpage", "it")')).toBe(true);
    expect(val('"Litpage".contains("it")')).toBe(true);
    expect(val('prop("Tags").contains("Fin")')).toBe(true);
    expect(val('test("Litpage", "Lit")')).toBe(true);
    expect(val('test("Litpage", "\\d")')).toBe(false);
    expect(val('"Litpage".test("Lit")')).toBe(true);
    expect(val('match("Litpage Litpage", "Lit")')).toEqual(['Lit', 'Lit']);
    expect(val('match("Litpage 123 Litpage 456", "\\d+")')).toEqual(['123', '456']);
    expect(val('"Litpage 123 Litpage 456".match("\\d+")')).toEqual(['123', '456']);
    expect(val('match("abc", "x")')).toEqual([]);
  });
  it('replace / replaceAll', () => {
    expect(val('replace("Litpage Litpage", "L", "M")')).toBe('Mitpage Litpage');
    expect(val('"Litpage Litpage".replace("L", "M")')).toBe('Mitpage Litpage');
    expect(val('replaceAll("Litpage Litpage", "L", "M")')).toBe('Mitpage Mitpage');
    expect(val('replaceAll("Litpage 123", "\\d", "")')).toBe('Litpage ');
    expect(val('"Litpage 123".replaceAll("\\d", "").trim()')).toBe('Litpage');
  });
  it('lower / upper / trim / repeat', () => {
    expect(val('lower("LITPAGE")')).toBe('litpage');
    expect(val('"LITPAGE".lower()')).toBe('litpage');
    expect(val('upper("litpage")')).toBe('LITPAGE');
    expect(val('trim("  litpage  ")')).toBe('litpage');
    expect(val('"  litpage  ".trim()')).toBe('litpage');
    expect(val('repeat("0", 4)')).toBe('0000');
    expect(val('"0".repeat(4)')).toBe('0000');
    expect(val('repeat("~=", 10)')).toBe('~=~=~=~=~=~=~=~=~=~=');
  });
  it('padStart / padEnd', () => {
    expect(val('padStart("A", 3, ".")')).toBe('..A');
    expect(val('padStart(123, 5, 0)')).toBe('00123');
    expect(val('"A".padStart(3, ".")')).toBe('..A');
    expect(val('padEnd("A", 3, ".")')).toBe('A..');
    expect(val('padEnd(123, 5, 0)')).toBe('12300');
    expect(val('padStart("abc", 2, "x")')).toBe('abc');
    expect(val('padStart("A", 6, "xy")')).toBe('xyxyxA');
  });
  it('link / style / unstyle keep rich annotations', () => {
    const l = ev('link("Litpage", "https://docs.litpage.dev")').value;
    expect(l).toEqual({ type: 'text', value: [['Litpage', [['a', 'https://docs.litpage.dev']]]] });
    const s = ev('style("Litpage", "b", "u")').value;
    expect(s).toEqual({ type: 'text', value: [['Litpage', [['b'], ['_']]]] });
    const c = ev('"Litpage".style("blue", "gray_background")').value;
    expect(c).toEqual({ type: 'text', value: [['Litpage', [['h', 'blue'], ['h', 'gray_background']]]] });
    expect(ev('unstyle(style("Text", "b", "c"))').value).toEqual({ type: 'text', value: [['Text']] });
    expect(ev('unstyle(style("Text", "blue", "b"), "blue")').value).toEqual({ type: 'text', value: [['Text', [['b']]]] });
    expect(ev('repeat("~=", 2).style("blue")').value).toEqual({ type: 'text', value: [['~=~=', [['h', 'blue']]]] });
  });
  it('concat / join / split', () => {
    expect(val('concat([1, 2], [3, 4])')).toEqual([1, 2, 3, 4]);
    expect(val('concat(["a", "b"], ["c", "d"])')).toEqual(['a', 'b', 'c', 'd']);
    expect(val('[1, 2].concat([3, 4])')).toEqual([1, 2, 3, 4]);
    expect(val('join(["a", "b", "c"], ", ")')).toBe('a, b, c');
    expect(val('join(["dog", "go"], "")')).toBe('doggo');
    expect(val('["a", "b", "c"].join(", ")')).toBe('a, b, c');
    expect(val('split("apple,pear,orange", ",")')).toEqual(['apple', 'pear', 'orange']);
    expect(val('"apple,pear,orange".split(",")')).toEqual(['apple', 'pear', 'orange']);
    expect(val('split("a  b c")')).toEqual(['a', 'b', 'c']);
    expect(val('prop("Task ID").split("-").first()')).toBe('TASK');
    expect(val('prop("Task ID").split("-").last()')).toBe('12');
  });
});

describe('number', () => {
  it('formatNumber', () => {
    expect(val('formatNumber(12.345, "usd")')).toBe('$12.35');
    expect(val('formatNumber(12.345, "usd", 0)')).toBe('$12');
    expect(val('formatNumber(1234567890, "commas")')).toBe('1,234,567,890');
    expect(val('formatNumber(1234567890, "humanize")')).toBe('1.2B');
    expect(val('12.345.formatNumber("usd")')).toBe('$12.35');
    expect(val('formatNumber(0.5, "percent")')).toBe('50%');
    expect(val('formatNumber(1234.5)')).toBe('1,234.5');
    expect(val('formatNumber(2048, "bytes")')).toBe('2 KiB');
    expect(val('formatNumber(1500, "krw")')).toBe('₩1,500');
    expect(err('formatNumber(1, "nope")')?.type).toBe('NumberFormatInvalid');
  });
  it('arithmetic functions', () => {
    expect(val('add(5, 10)')).toBe(15);
    expect(val('5 + 10')).toBe(15);
    expect(val('subtract(5, 10)')).toBe(-5);
    expect(val('multiply(5, 10)')).toBe(50);
    expect(val('multiply(-1, 2)')).toBe(-2);
    expect(val('mod(5, 10)')).toBe(5);
    expect(val('5 % 10')).toBe(5);
    expect(val('pow(5, 10)')).toBe(9765625);
    expect(val('5 ^ 10')).toBe(9765625);
    expect(val('divide(5, 10)')).toBe(0.5);
    expect(val('5.divide(10)')).toBe(0.5);
    expect(val('divide(1, 0)')).toBe(undefined);
    expect(val('0.1 + 0.2')).toBe(0.3);
    expect(val('0.3 / 0.1')).toBe(3);
    expect(val('add(prop("Link"), 2)', blocks.t2)).toBe(undefined === undefined ? 2 : 0); // empty counts as 0
  });
  it('min / max / sum / median / mean', () => {
    expect(val('min(1, 2, 3)')).toBe(1);
    expect(val('min([1, 2, 3])')).toBe(1);
    expect(val('[1, 2, 3].min()')).toBe(1);
    expect(val('max(1, 2, 3)')).toBe(3);
    expect(val('max([1, 2, 3])')).toBe(3);
    expect(val('sum(1, 2, 3)')).toBe(6);
    expect(val('sum([1, 2, 3], 4, 5)')).toBe(15);
    expect(val('[1, 2, 3].sum(4, 5)')).toBe(15);
    expect(val('median(1, 2, 4)')).toBe(2);
    expect(val('median([1, 2, 3], 4)')).toBe(2.5);
    expect(val('mean(1, 2, 3)')).toBe(2);
    expect(val('mean([1, 2, 3], 4, 5)')).toBe(3);
    expect(val('max([])')).toBe(undefined);
    expect(js(ev('min(parseDate("2023-01-02"), parseDate("2022-05-01"))').value)).toEqual({ type: 'date', start_date: '2022-05-01' });
  });
  it('rounding and math', () => {
    expect(val('round(1.2345)')).toBe(1);
    expect(val('round(1.2345, 2)')).toBe(1.23);
    expect(val('round(0.4)')).toBe(0);
    expect(val('round(-0.6)')).toBe(-1);
    expect(val('round(1234, -2)')).toBe(1200);
    expect(err('round(1.5, 0.5)')?.type).toBe('CannotRoundToNonInteger');
    expect(err('round(1.5, 13)')?.type).toBe('CannotRoundToTooManyDecimalPlaces');
    expect(val('abs(-10)')).toBe(10);
    expect(val('ceil(0.4)')).toBe(1);
    expect(val('ceil(-0.6)')).toBe(0);
    expect(val('floor(0.4)')).toBe(0);
    expect(val('floor(-0.6)')).toBe(-1);
    expect(val('sqrt(4)')).toBe(2);
    expect(val('sqrt(7)')).toBe(2.645751311065);
    expect(val('cbrt(64)')).toBe(4);
    expect(val('cbrt(9)')).toBe(2.080083823052);
    expect(val('exp(1)')).toBe(2.718281828459);
    expect(val('ln(e())')).toBe(1);
    expect(val('ln(10)')).toBe(2.302585092994);
    expect(val('log10(100000)')).toBe(5);
    expect(val('log2(1024)')).toBe(10);
    expect(val('sign(-10)')).toBe(-1);
    expect(val('sign(10)')).toBe(1);
    expect(val('pi()')).toBe(3.14159265359);
    expect(val('e()')).toBe(2.718281828459);
  });
  it('toNumber', () => {
    expect(val('toNumber("2")')).toBe(2);
    expect(val('toNumber(true)')).toBe(1);
    expect(val('"2".toNumber()')).toBe(2);
    expect(val('toNumber("12px")')).toBe(12);
    expect(val('toNumber("0x10")')).toBe(16);
    expect(val('toNumber("abc")')).toBe(undefined);
    expect(val('toNumber(now())')).toBe(NOW);
    expect(err('toNumber([1])')?.type).toBe('CannotUseToNumberOnList');
  });
});

describe('date', () => {
  it('now / today in the user time zone', () => {
    expect(val('now()')).toEqual({ type: 'datetime', start_date: '2023-08-30', start_time: '17:55', time_zone: TZ });
    expect(val('today()')).toEqual({ type: 'date', start_date: '2023-08-30' });
  });
  it('date parts', () => {
    expect(val('minute(parseDate("2023-07-10T17:35Z"))')).toBe(35);
    expect(val('hour(parseDate("2023-07-10T17:35Z"))')).toBe(10); // 17:35Z = 10:35 PDT
    expect(val('day(parseDate("2023-07-10T17:35Z"))')).toBe(1);
    expect(val('date(parseDate("2023-07-10T17:35Z"))')).toBe(10);
    expect(val('week(parseDate("2023-01-02"))')).toBe(1);
    expect(val('month(parseDate("2023-07-10T17:35Z"))')).toBe(7);
    expect(val('year(now())')).toBe(2023);
    expect(val('now().year()')).toBe(2023);
    expect(val('day(parseDate("2023-07-16"))')).toBe(7); // Sunday
  });
  it('dateAdd / dateSubtract', () => {
    expect(val('dateAdd(now(), 1, "days")')).toEqual({ type: 'datetime', start_date: '2023-08-31', start_time: '17:55', time_zone: TZ });
    expect(val('dateAdd(now(), 2, "months")')).toEqual({ type: 'datetime', start_date: '2023-10-30', start_time: '17:55', time_zone: TZ });
    expect(val('dateAdd(now(), 3, "years")')).toEqual({ type: 'datetime', start_date: '2026-08-30', start_time: '17:55', time_zone: TZ });
    expect(val('dateSubtract(now(), 1, "days")')).toEqual({ type: 'datetime', start_date: '2023-08-29', start_time: '17:55', time_zone: TZ });
    expect(val('now().dateSubtract(2, "months")')).toEqual({ type: 'datetime', start_date: '2023-06-30', start_time: '17:55', time_zone: TZ });
    expect(val('dateAdd(parseDate("2023-01-31"), 1, "month")')).toEqual({ type: 'date', start_date: '2023-02-28' });
    expect(val('dateAdd(today(), 2, "hours")')).toEqual({ type: 'datetime', start_date: '2023-08-30', start_time: '02:00', time_zone: TZ });
    expect(val('dateAdd(parseDate("2023-03-12"), 1, "quarters")')).toEqual({ type: 'date', start_date: '2023-06-12' });
    expect(err('dateAdd(now(), 1, "fortnights")')?.type).toBe('DateInvalidDurationUnit');
  });
  it('dateBetween', () => {
    expect(val('dateBetween(now(), parseDate("2022-09-07"), "days")')).toBe(357);
    expect(val('dateBetween(parseDate("2030-01-01"), now(), "years")')).toBe(6);
    expect(val('now().dateBetween(parseDate("2022-09-07"), "days")')).toBe(357);
    expect(val('dateBetween(parseDate("2022-09-07"), now(), "days")')).toBe(-357);
    expect(val('dateBetween(parseDate("2023-03-31"), parseDate("2023-02-28"), "months")')).toBe(1);
    expect(val('dateBetween(parseDate("2023-01-01"), parseDate("2022-12-31"), "weeks")')).toBe(0);
    expect(val('dateBetween(parseDate("2023-01-01T10:00"), parseDate("2023-01-01T08:30"), "minutes")')).toBe(90);
    expect(val('dateBetween(parseDate("2024-01-01"), parseDate("2023-01-01"), "quarters")')).toBe(4);
  });
  it('dateRange / dateStart / dateEnd', () => {
    expect(val('dateRange(parseDate("2022-09-07"), parseDate("2023-09-07"))')).toEqual({ type: 'daterange', start_date: '2022-09-07', end_date: '2023-09-07' });
    expect(val('dateStart(prop("Due"))', blocks.t2)).toEqual({ type: 'date', start_date: '2022-09-07' });
    expect(val('dateEnd(prop("Due"))', blocks.t2)).toEqual({ type: 'date', start_date: '2023-09-07' });
    expect(val('dateBetween(dateStart(prop("Due")), dateEnd(prop("Due")), "days")', blocks.t2)).toBe(-365);
    expect(val('prop("Due").dateEnd().dateBetween(prop("Due").dateStart(), "days")', blocks.t2)).toBe(365);
    const r = val('dateRange(parseDate("2023-01-01T09:00"), parseDate("2023-01-02T10:00"))') as Record<string, string>;
    expect(r.type).toBe('datetimerange');
    expect(r.end_time).toBe('10:00');
  });
  it('timestamp / fromTimestamp', () => {
    expect(val('timestamp(now())')).toBe(NOW);
    expect(val('now().timestamp()')).toBe(NOW);
    expect(val('fromTimestamp(1689024900000)')).toEqual({ type: 'datetime', start_date: '2023-07-10', start_time: '14:35', time_zone: TZ });
    expect(val('1689024900000.fromTimestamp()')).toEqual({ type: 'datetime', start_date: '2023-07-10', start_time: '14:35', time_zone: TZ });
  });
  it('formatDate tokens and time zones', () => {
    expect(val('formatDate(now(), "MMMM D, Y")')).toBe('August 30, 2023');
    expect(val('formatDate(now(), "YYYY-MM-DD HH:mm")')).toBe('2023-08-30 17:55');
    expect(val('formatDate(now(), "MM/DD/YYYY")')).toBe('08/30/2023');
    expect(val('formatDate(now(), "h:mm A")')).toBe('5:55 PM');
    expect(val('formatDate(now(), "h:mm A", "UTC+1")')).toBe('1:55 AM');
    expect(val('formatDate(now(), "HH:mm", "Asia/Seoul")')).toBe('09:55');
    expect(val('formatDate(now(), "dddd, Do [of] MMMM")')).toBe('Wednesday, 30th of August');
    expect(val('formatDate(now(), "ddd D MMM YY Q W")')).toBe('Wed 30 Aug 23 3 35');
    expect(val('formatDate(parseDate("2023-07-10"), "LL")')).toBe('July 10, 2023');
    expect(val('formatDate(parseDate("2023-07-10"), "dddd", "Asia/Seoul")')).toBe('Monday');
    expect(val('now().formatDate("YYYY-MM-DD HH:mm")')).toBe('2023-08-30 17:55');
  });
  it('parseDate', () => {
    expect(val('parseDate("2022-01-01")')).toEqual({ type: 'date', start_date: '2022-01-01' });
    expect(val('parseDate("2022-01-01T00:00Z")')).toEqual({ type: 'datetime', start_date: '2021-12-31', start_time: '16:00', time_zone: TZ });
    expect(val('"2022-01-01".parseDate()')).toEqual({ type: 'date', start_date: '2022-01-01' });
    expect(val('parseDate("not a date")')).toBe(undefined);
    expect(val('parseDate("2022-02-30")')).toBe(undefined);
  });
  it('relative comparisons', () => {
    expect(val('prop("Due") > now()')).toBe(true);
    expect(val('parseDate("2023-01-01") < parseDate("2023-01-02")')).toBe(true);
  });
});

describe('people', () => {
  it('name / email', () => {
    expect(val('name(prop("Assignee").first())')).toBe('Grace Hopper');
    expect(val('prop("Assignee").map(name(current)).join(", ")')).toBe('Grace Hopper, Ada Lovelace');
    expect(val('prop("Assignee").map(current.name()).join(", ")')).toBe('Grace Hopper, Ada Lovelace');
    expect(val('prop("Assignee").map(email(current)).join(", ")')).toBe('grace@example.com, ada@example.com');
    expect(val('email(prop("Assignee").at(1))')).toBe('ada@example.com');
    expect(val('prop("Assignee").at(0).name()')).toBe('Grace Hopper');
  });
});

describe('list', () => {
  it('at / first / last / slice / splice', () => {
    expect(val('at([1, 2, 3], 1)')).toBe(2);
    expect(val('[1, 2, 3].at(-1)')).toBe(3);
    expect(val('first([1, 2, 3])')).toBe(1);
    expect(val('[].first()')).toBe(undefined);
    expect(val('last([1, 2, 3])')).toBe(3);
    expect(val('slice([1, 2, 3], 1, 2)')).toEqual([2]);
    expect(val('slice(["a", "b", "c"], 1)')).toEqual(['b', 'c']);
    expect(val('splice([1, 2, 3], 1, 1)')).toEqual([1, 3]);
    expect(val('splice(["a", "b", "c"], 0, 1, "d")')).toEqual(['d', 'b', 'c']);
    expect(val('[1, 2, 3].splice(1)')).toEqual([1, 2, 3]);
  });
  it('sort / reverse / unique / includes', () => {
    expect(val('sort([3, 1, 2])')).toEqual([1, 2, 3]);
    expect(val('sort([1, 2, 3]).reverse()')).toEqual([3, 2, 1]);
    expect(val('sort(["Yash", "Stephen", "Paul", "Simon", "Ryo"])')).toEqual(['Paul', 'Ryo', 'Simon', 'Stephen', 'Yash']);
    expect(val('sort([3, 1, 2], 0 - current)')).toEqual([3, 2, 1]);
    expect(val('reverse(["green", "eggs", "ham"])')).toEqual(['ham', 'eggs', 'green']);
    expect(val('unique([1, 1, 2])')).toEqual([1, 2]);
    expect(val('[1, 1, 2].unique()')).toEqual([1, 2]);
    expect(val('includes(["a", "b", "c"], "b")')).toBe(true);
    expect(val('includes([1, 2, 3], 4)')).toBe(false);
    expect(val('prop("Tags").includes("Finance")')).toBe(true);
  });
  it('find / findIndex / filter / some / every / map / flat / count', () => {
    expect(val('find(["a", "b", "c"], current == "b")')).toBe('b');
    expect(val('find([1, 2, 3], current > 100)')).toBe(undefined);
    expect(val('findIndex(["a", "b", "c"], current == "b")')).toBe(1);
    expect(val('findIndex([1, 2, 3], current > 100)')).toBe(-1);
    expect(val('filter([1, 2, 3], current > 1)')).toEqual([2, 3]);
    expect(val('["a", "b", "c"].filter(current == "a")')).toEqual(['a']);
    expect(val('some([1, 2, 3], current == 2)')).toBe(true);
    expect(val('some(["a", "b", "c"], current.length > 2)')).toBe(false);
    expect(val('every([1, 2, 3], current > 0)')).toBe(true);
    expect(val('every(["a", "b", "c"], current == "b")')).toBe(false);
    expect(val('map([1, 2, 3], current + 1)')).toEqual([2, 3, 4]);
    expect(val('map([1, 2, 3], current + index)')).toEqual([1, 3, 5]);
    expect(val('flat([1, 2, 3])')).toEqual([1, 2, 3]);
    expect(val('flat([[1, 2], [3, 4]])')).toEqual([1, 2, 3, 4]);
    expect(val('count([1, 2, 3, 4], current % 2 == 0)')).toBe(2);
    expect(val('count(["a", "b", "c"], current == "d")')).toBe(0);
    expect(val('[1, 2, 3].count()')).toBe(3);
    expect(val('map([1, 2], current / 0)')).toEqual([undefined, undefined]);
    expect(val('map([1, "a"], current * 2)')).toEqual([2, undefined]); // lambda errors become empty
  });
});

describe('special', () => {
  it('id', () => {
    expect(val('id()')).toBe('t1');
    expect(val('id(prop("Project").first())')).toBe('p1');
    expect(val('prop("Project").first().id()')).toBe('p1');
  });
  it('internal helpers', () => {
    expect(val('_unsafeCastArray([1, 2, 3], [true, false])')).toEqual([1, 2, 3]);
    expect(val('_wait(100, true)')).toBe(true);
  });
});

describe('operators & semantics', () => {
  it('precedence and associativity', () => {
    expect(val('2 + 3 * 2 + 3')).toBe(11);
    expect(val('(2 + 3) * (2 + 3)')).toBe(25);
    expect(val('2 ^ 3 ^ 2')).toBe(512);
    expect(val('-2 ^ 2')).toBe(4);
    expect(val('-5.abs()')).toBe(5);
    expect(val('10 - 2 - 3')).toBe(5);
    expect(val('100 / 10 / 2')).toBe(5);
  });
  it('text concatenation and coercion', () => {
    expect(val('"Revenue: " + formatNumber(1500, "usd", 0)')).toBe('Revenue: $1,500');
    expect(val('"a" + 1')).toBe('a1');
    expect(val('1 + "a"')).toBe('1a');
    expect(val('true + "x"')).toBe('truex');
    expect(val('"Due " + prop("Due")')).toBe('Due September 7, 2023');
    expect(err('"a" - 1')?.type).toBe('CannotDoMathOnType');
    expect(err('-"a"')?.type).toBe('UnaryMinusOnNonNumber');
    expect(err('1 < "a"')?.type).toBe('CannotRelativelyCompareTypes');
  });
  it('empty values', () => {
    expect(val('prop("Estimate") + 1', blocks.t3)).toBe(1);
    expect(val('prop("Estimate") * 2', blocks.t3)).toBe(0);
    expect(val('prop("Estimate") > 1', blocks.t3)).toBe(false);
    expect(val('prop("Estimate") == empty()', blocks.t3)).toBe(true);
  });
  it('comments, strings and whitespace', () => {
    expect(val('/* comment */ 1 + /* inline */ 2')).toBe(3);
    expect(val('"line\\nbreak"')).toBe('line\nbreak');
    expect(val('"quote \\"inside\\""')).toBe('quote "inside"');
    expect(val('lower("A")\n  + "b"')).toBe('ab');
  });
  it('parse errors', () => {
    expect(err('1 +')?.type).toBe('ExpressionExpected');
    expect(err('(1 + 2')?.type).toBe('TokenExpected');
    expect(err('1 2')?.type).toBe('EndOfInputExpected');
    expect(err('"abc')?.type).toBe('UnclosedStringLiteral');
    expect(err('1 # 2')?.type).toBe('InvalidCharacter');
    expect(err('/* x')?.type).toBe('UnclosedComment');
    expect(err('[1, 2].')?.type).toBe('PropertyTokenOrFunctionExpected');
    expect(err('foo(1)')?.type).toBe('IdentifierNotFound');
    expect(err('[1].nope()')?.type).toBe('UnifiedFunctionPropertyNotFound');
    expect(err('substring()')?.type).toBe('FunctionCallTooFewArguments');
    expect(err('lower("a", "b")')?.type).toBe('FunctionCallUnexpectedArgument');
    expect(err('join("abc", ",")')?.type).toBe('FunctionCallArgumentWrongType');
    expect(ev('').value).toEqual({ type: 'undefined' });
  });
});

describe('properties', () => {
  it('reads every property type', () => {
    expect(val('prop("Name")')).toBe('Design homepage');
    expect(val('prop("Estimate")')).toBe(5);
    expect(val('prop("Done")')).toBe(true);
    expect(val('prop("Done")', blocks.t3)).toBe(false);
    expect(val('prop("Tags")')).toEqual(['Finance', 'Ops']);
    expect(val('prop("Tags")', blocks.t3)).toEqual([]);
    expect(val('prop("Status")')).toBe('Done');
    expect(val('prop("Link")')).toBe('https://docs.litpage.dev');
    expect(val('prop("Task ID")')).toBe('TASK-12');
    expect(val('prop("Assignee")')).toEqual(['user:u1', 'user:u2']);
    expect(val('prop("Project")')).toEqual(['page:p1']);
    expect(val('prop("Score")')).toBe(50);
    expect(err('prop("Nope")')?.type).toBe('InvalidPropCall');
  });
  it('property tokens (formula2 code) and conversions', () => {
    const code = sourceToCode(resolvePropCalls('prop("Estimate") * 10', tasksSchema, { id: 'tasks', spaceId: SPACE }));
    expect(code[0]).toEqual(['‣', [['fpp', { property: 'est', collection: { id: 'tasks', table: 'collection', spaceId: SPACE } }]]]);
    expect(js(evaluateFormula(code, blocks.t1, tasksSchema, ctx).value)).toBe(50);
    expect(codeToSource(code)).toBe(`${encodeToken({ type: 'block_property', property: 'est', collection: { id: 'tasks', table: 'collection', spaceId: SPACE } })} * 10`);
    // tokens from a different collection are rejected on this row
    const other = encodeToken({ type: 'block_property', property: 'budget', collection: { id: 'projects', table: 'collection' } });
    expect(err(other)?.type).toBe('ThisRowBlockPropertyMismatchCollection');
  });
  it('relations: page lists, member access and filters', () => {
    expect(val('prop("Tasks").length()', blocks.p1)).toBe(2); // dead page excluded
    expect(val('prop("Tasks").map(current.prop("Estimate")).sum()', blocks.p1)).toBe(8);
    expect(val('prop("Tasks").filter(current.prop("Status") != "Done").map(current.prop("Name")).join(", ")', blocks.p1)).toBe('Write docs');
    expect(val('prop("Tasks").first().prop("Name")', blocks.p1)).toBe('Design homepage');
    expect(val('prop("Project").first().prop("Budget") / 2')).toBe(500);
    const member = encodeToken({ type: 'block_property', property: 'budget', collection: { id: 'projects', table: 'collection' } });
    expect(val(`prop("Project").first().${member}`)).toBe(1000);
  });
  it('detects cycles', () => {
    expect(err('prop("Loop")', blocks.t3)?.type).toBe('CycleDetected');
  });
});

describe('rollups & relations', () => {
  const r = (prop: string, b = blocks.p1) => computeRollup(b, prop, projectsSchema, ctx);
  it('computes every aggregation family', () => {
    expect(js(r('total').value)).toBe(8);
    expect(js(r('count').value)).toBe(2);
    expect(js(r('names').value)).toEqual(['Design homepage', 'Write docs']);
    expect(js(r('tagsAll').value)).toEqual(['Finance', 'Ops']);
    expect(js(r('doneCnt').value)).toBe(1);
    expect(r('pctDone').percent).toBe(true);
    expect(js(r('pctDone').value)).toBe(0.5);
    expect(js(r('firstDue').value)).toEqual({ type: 'daterange', start_date: '2022-09-07', end_date: '2023-09-07' });
    expect(js(r('scoreSum').value)).toBe(80);
    expect(js(r('complete').value)).toBe(1);
    expect(js(r('total', blocks.p2).value)).toBe(0);
    expect(js(r('names', blocks.p2).value)).toEqual([]);
  });
  it('rollups inside formulas', () => {
    expect(val('prop("Total estimate") * 2', blocks.p1)).toBe(16);
    expect(val('prop("Task names").join(" / ")', blocks.p1)).toBe('Design homepage / Write docs');
  });
  it('aggregate() covers count/percent/date helpers', () => {
    const vals: FValue[] = [{ type: 'number', value: 1 }, { type: 'undefined' }, { type: 'number', value: 5 }];
    expect(js(aggregate(vals, 'count').value)).toBe(3);
    expect(js(aggregate(vals, 'count_values').value)).toBe(2);
    expect(js(aggregate(vals, 'empty').value)).toBe(1);
    expect(js(aggregate(vals, 'not_empty').value)).toBe(2);
    expect(js(aggregate(vals, 'percent_empty').value)).toBeCloseTo(1 / 3);
    expect(js(aggregate(vals, 'unique').value)).toBe(2);
    expect(js(aggregate(vals, 'average').value)).toBe(3);
    expect(js(aggregate(vals, 'median').value)).toBe(3);
    expect(js(aggregate(vals, 'min').value)).toBe(1);
    expect(js(aggregate(vals, 'max').value)).toBe(5);
    expect(js(aggregate(vals, 'range').value)).toBe(4);
    const dates: FValue[] = [{ type: 'date', value: { type: 'date', start_date: '2023-01-01' } }, { type: 'date', value: { type: 'date', start_date: '2023-01-04' } }];
    expect(js(aggregate(dates, 'latest_date').value)).toEqual({ type: 'date', start_date: '2023-01-04' });
    expect(js(aggregate(dates, 'date_range').value)).toBe('3 days');
  });
  it('getRelationTargets respects alive + limit', () => {
    expect(getRelationTargets(blocks.p1, 'tasks', ctx).map((b) => b.id)).toEqual(['t1', 't2']);
    const limited = { ...projectsSchema, tasks: { ...projectsSchema.tasks, limit: 1 } };
    expect(getRelationTargets(blocks.p1, 'tasks', ctx, limited).map((b) => b.id)).toEqual(['t1']);
  });
  it('plans two-way relation updates', () => {
    const changes = planRelationChange({
      row: blocks.p2, propId: 'tasks', schema: projectsSchema, nextIds: ['t1', 't3'],
      getBlock: (id) => blocks[id], getSchema: (id) => collections[id]?.schema,
    });
    expect(changes[0]).toEqual({ blockId: 'p2', propId: 'tasks', value: encodeRelation(['t1', 't3'], SPACE) });
    const t1 = changes.find((c) => c.blockId === 't1')!;
    expect(t1.propId).toBe('proj');
    expect(t1.value).toEqual(encodeRelation(['p1', 'p2'], SPACE));
    const removal = planRelationChange({
      row: blocks.p1, propId: 'tasks', schema: projectsSchema, nextIds: ['t1'],
      getBlock: (id) => blocks[id], getSchema: (id) => collections[id]?.schema,
    });
    expect(removal.find((c) => c.blockId === 't2')?.value).toEqual([]);
  });
  it('builds relation schemas (two-way, self, limit)', () => {
    const two = relationSchemas({ name: 'Project', sourceCollectionId: 'tasks', sourcePropId: 'a', targetCollectionId: 'projects', twoWay: true, reverseName: 'Tasks', reversePropId: 'b', spaceId: SPACE, limit: 1 });
    expect(two.source).toMatchObject({ type: 'relation', collection_id: 'projects', property: 'b', limit: 1, version: 'v2' });
    expect(two.reverse?.schema).toMatchObject({ name: 'Tasks', collection_id: 'tasks', property: 'a' });
    const self = relationSchemas({ name: 'Related', sourceCollectionId: 'tasks', sourcePropId: 'a', targetCollectionId: 'tasks', twoWay: false });
    expect(self.source.property).toBe('a');
  });
});

describe('types', () => {
  it('infers result types', () => {
    expect(typeLabel(formulaResultType('prop("Estimate") * 10', tasksSchema))).toBe('number');
    expect(typeLabel(formulaResultType('', tasksSchema))).toBe('unknown');
    expect(typeLabel(formulaResultType('prop("Tags")', tasksSchema))).toBe('text list');
    expect(typeLabel(formulaResultType('prop("Assignee")', tasksSchema))).toBe('people list');
    expect(typeLabel(formulaResultType('prop("Project")', tasksSchema))).toBe('block list');
    expect(typeLabel(formulaResultType('prop("Done") ? "a" : "b"', tasksSchema))).toBe('text');
    expect(typeLabel(formulaResultType('now()', tasksSchema))).toBe('date');
    expect(typeLabel(formulaResultType('[1, 2].map(current > 1)', tasksSchema))).toBe('checkbox list');
    expect(typeLabel(formulaResultType('let(x, 2, x * 3)', tasksSchema))).toBe('number');
    expect(typeLabel(formulaResultType('prop("Tags").first()', tasksSchema))).toBe('text');
    expect(typeLabel(formulaResultType('empty()', tasksSchema))).toBe('empty');
    expect(typeLabel(formulaResultType('prop("Total estimate")', projectsSchema, { getCollection: ctx.getCollection }))).toBe('number');
    expect(typeLabel(formulaResultType('prop("Task names")', projectsSchema, { getCollection: ctx.getCollection }))).toBe('text list');
  });
  it('formats values for display', () => {
    expect(formatFormulaValue({ type: 'number', value: 1234.5 }, { schema: { name: 'x', type: 'formula', number_format: 'dollar' } })).toBe('$1,234.50');
    expect(formatFormulaValue({ type: 'number', value: 0.25 }, { percent: true })).toBe('25%');
    expect(formatFormulaValue({ type: 'date', value: { type: 'datetimerange', start_date: '2023-01-01', start_time: '09:00', end_date: '2023-01-01', end_time: '10:30', time_zone: TZ } }, { ctx: { timeZone: TZ } })).toBe('January 1, 2023 9:00 AM → 10:30 AM');
  });
  it('moment-style formatter edge tokens', () => {
    const d = new DT(Date.UTC(2023, 0, 1, 0, 5, 9, 45), parseZone('UTC')!);
    expect(formatMoment(d, 'YYYY-MM-DDTHH:mm:ss.SSS[Z]')).toBe('2023-01-01T00:05:09.045Z');
    expect(formatMoment(d, 'k:mm a X')).toBe('24:05 am 1672531509');
    expect(formatMoment(d, 'Z ZZ')).toBe('+00:00 +0000');
  });
});
