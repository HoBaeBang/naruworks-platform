// shared helpers: page layout normalization, Korean date input, type-change conversions (Text → Date / Place),
// Place text filters, property access redaction, page-level rules and sub-item link checks.
import { describe, expect, it } from 'vitest';
import type { BlockRecord, PropertySchema } from '../records.ts';
import { parseDateInput, ymdToMs } from './dates.ts';
import { evaluateOperator } from './filters.ts';
import { defaultPageLayout, normalizePageLayout, MAX_PINNED_PROPERTIES, canMoveToPanel } from './layout.ts';
import { redactRowProperties, redactSchema, canRestrictProperty, hasPropertyRule, isEmptyPropertyValue, schemaWithDeleted } from './propertyAccess.ts';
import { pageAccessRulesOf, rowRuleRole } from './access.ts';
import { subitemLinkProblem } from './subitems.ts';
import { encodeText, encodePlace, encodeValueAs, getPropertyValue } from './values.ts';
import type { PropertyValue } from './types.ts';

const NOW = ymdToMs('2026-10-20', '12:00');
const schema: Record<string, PropertySchema> = {
  title: { name: 'Name', type: 'title' },
  a: { name: 'Status', type: 'status' },
  b: { name: 'Due', type: 'date' },
  c: { name: 'Owner', type: 'person' },
};

describe('page layout (DB-LAY)', () => {
  it('defaults to heading, property group, discussions, content', () => {
    const l = defaultPageLayout(schema);
    expect(l.structure).toBe('simple');
    expect(l.modules.page_main.map((m) => m.type)).toEqual(['title', 'properties', 'discussions', 'editor']);
    const group = l.modules.page_main[1];
    expect(group.type === 'properties' && group.sections[0].properties).toEqual(['a', 'b', 'c']);
  });

  it('drops deleted properties, appends new ones and keeps a single heading', () => {
    const stored = {
      structure: 'simple',
      modules: {
        page_main: [
          { id: 'title', type: 'title', pinned: ['b', 'zz'] },
          { id: 'properties', type: 'properties', sections: [{ id: 's1', name: 'Main', properties: ['a', 'gone'] }], hidden: [] },
          { id: 'x', type: 'title', pinned: [] },
          { id: 'editor', type: 'editor' },
        ],
        page_details: [{ id: 'p1', type: 'property', property: 'c' }],
      },
      settings: { property_icons: false },
    };
    const l = normalizePageLayout(stored, schema);
    const titles = l.modules.page_main.filter((m) => m.type === 'title');
    expect(titles).toHaveLength(1);
    expect(titles[0].type === 'title' && titles[0].pinned).toEqual(['b']);
    const group = l.modules.page_main.find((m) => m.type === 'properties');
    const all = group?.type === 'properties' ? group.sections.flatMap((s) => s.properties) : [];
    expect(all).not.toContain('gone');
    expect(all).toContain('a');
    expect(l.settings.property_icons).toBe(false);
    expect(MAX_PINNED_PROPERTIES).toBe(15);
  });

  it('keeps relation modules on the page (not the details panel)', () => {
    const s: Record<string, PropertySchema> = { ...schema, r: { name: 'Projects', type: 'relation' } };
    expect(canMoveToPanel({ id: 'm', type: 'property', property: 'r' }, s)).toBe(false);
    expect(canMoveToPanel({ id: 'm', type: 'property', property: 'b' }, s)).toBe(true);
  });
});

describe('date input', () => {
  it('reads Korean dates and relative words', () => {
    expect(parseDateInput('2026년 3월 5일', NOW)).toBe('2026-03-05');
    expect(parseDateInput('3월 5일', NOW)).toBe('2026-03-05');
    expect(parseDateInput('2026. 3. 5.', NOW)).toBe('2026-03-05');
    expect(parseDateInput('오늘', NOW)).toBe('2026-10-20');
    expect(parseDateInput('내일', NOW)).toBe('2026-10-21');
    expect(parseDateInput('어제', NOW)).toBe('2026-10-19');
    expect(parseDateInput('2월 30일', NOW)).toBeNull();
    expect(parseDateInput('Oct 20, 2026', NOW)).toBe('2026-10-20');
  });
});

describe('type changes keep values', () => {
  const text = (t: string): PropertyValue => ({ kind: 'text', text: t });
  it('Text → Date keeps values that read as dates', () => {
    const raw = encodeValueAs(text('2026-03-05'), { name: 'D', type: 'date' }, { now: NOW });
    const row = { id: 'r', properties: { d: raw } } as unknown as BlockRecord;
    const v = getPropertyValue(row, 'd', { d: { name: 'D', type: 'date' } }, { now: NOW });
    expect(v.kind === 'date' && v.date?.start).toBe('2026-03-05');
    expect(encodeValueAs(text('not a date'), { name: 'D', type: 'date' }, { now: NOW })).toBeUndefined();
  });

  it('Text → Place uses the text as the place name', () => {
    const raw = encodeValueAs(text('Seoul Station'), { name: 'P', type: 'place' });
    const row = { id: 'r', properties: { p: raw } } as unknown as BlockRecord;
    const v = getPropertyValue(row, 'p', { p: { name: 'P', type: 'place' } });
    expect(v.kind === 'place' && v.place?.name).toBe('Seoul Station');
  });
});

describe('Place filters', () => {
  it('matches the place name and address text', () => {
    const prop: PropertySchema = { name: 'P', type: 'place' };
    const row = { id: 'r', properties: { p: encodePlace({ name: 'Cafe Onion', address: 'Seongsu-dong, Seoul' }) } } as unknown as BlockRecord;
    const v = getPropertyValue(row, 'p', { p: prop });
    expect(evaluateOperator(v, 'string_contains', { type: 'exact', value: 'seoul' }, prop, {})).toBe(true);
    expect(evaluateOperator(v, 'string_does_not_contain', { type: 'exact', value: 'onion' }, prop, {})).toBe(false);
  });
});

describe('property access redaction', () => {
  const s: Record<string, PropertySchema> = {
    title: { name: 'Name', type: 'title' },
    pay: { name: 'Salary', type: 'number', property_permissions: { default_access: 'none' } } as PropertySchema,
    note: { name: 'Note', type: 'text', property_permissions: { default_access: 'schema_only' } } as PropertySchema,
    open: { name: 'Open', type: 'text' },
  };
  const row = { id: 'r', properties: { title: [['A']], pay: [['10']], note: [['n']], open: [['o']] } } as unknown as BlockRecord;

  it('hides values and properties by role; full access sees everything', () => {
    const asEditor = redactRowProperties(row, s, { userId: 'u', databaseRole: 'read_and_write' });
    expect(Object.keys(asEditor.properties ?? {}).sort()).toEqual(['open', 'title']);
    expect(Object.keys(redactSchema(s, { userId: 'u', databaseRole: 'read_and_write' })).sort()).toEqual(['note', 'open', 'title']);
    expect(redactRowProperties(row, s, { userId: 'u', databaseRole: 'editor' })).toBe(row);
    expect(redactSchema(s, { userId: 'u', databaseRole: 'editor' })).toBe(s);
  });

  it('masks deleted properties by their rule and drops values no property describes', () => {
    const live = { title: s.title, open: s.open };
    const deleted = { pay: { ...s.pay, deleted_time: 1 }, note: { ...s.note, deleted_time: 1 } } as Record<string, PropertySchema>;
    const withGhost = { ...row, properties: { ...row.properties, ghost: [['left behind']] } } as BlockRecord;
    expect(Object.keys(schemaWithDeleted(live, deleted)).sort()).toEqual(['note', 'open', 'pay', 'title']);
    const asEditor = redactRowProperties(withGhost, live, { userId: 'u', databaseRole: 'read_and_write' }, { deleted, orphans: true });
    expect(Object.keys(asEditor.properties ?? {}).sort()).toEqual(['open', 'title']);
    const asOwner = redactRowProperties(withGhost, live, { userId: 'u', databaseRole: 'editor' }, { deleted, orphans: true });
    expect(Object.keys(asOwner.properties ?? {}).sort()).toEqual(['note', 'open', 'pay', 'title']);
    // without the options: the live schema only, as before
    expect(Object.keys(redactRowProperties(withGhost, live, { userId: 'u', databaseRole: 'read_and_write' }).properties ?? {})).toContain('pay');
    expect(isEmptyPropertyValue([])).toBe(true);
    expect(isEmptyPropertyValue([['']])).toBe(true);
    expect(isEmptyPropertyValue([['No']])).toBe(false);
    expect(isEmptyPropertyValue([['‣', [['u', 'x']]]])).toBe(false);
  });

  it('knows which properties can carry a rule', () => {
    expect(canRestrictProperty(s.title, 'title')).toBe(false);
    expect(canRestrictProperty({ name: 'ID', type: 'auto_increment_id' }, 'id')).toBe(false);
    expect(canRestrictProperty(s.open, 'open')).toBe(true);
    expect(canRestrictProperty({ name: 'Parent', type: 'relation' }, 'par', ['par', 'kids'])).toBe(false);
    expect(hasPropertyRule({ name: 'x', type: 'text', property_permissions: { default_access: 'inherit', overrides: [] } } as PropertySchema)).toBe(false);
  });
});

describe('page-level rules and sub-item links', () => {
  it('gives the widest matching rule role', () => {
    const col = {
      schema: { own: { name: 'Owner', type: 'person' }, cb: { name: 'Created by', type: 'created_by' } } as Record<string, PropertySchema>,
      permission_rules: [{ id: '1', property: 'own', role: 'reader' }, { id: '2', property: 'cb', role: 'read_and_write' }, { id: '3', property: 'missing', role: 'editor' }],
    };
    expect(pageAccessRulesOf(col as never)).toHaveLength(2);
    const r = { id: 'r', created_by_id: 'u1', properties: { own: [['‣', [['u', 'u2']]]] } } as unknown as BlockRecord;
    expect(rowRuleRole(r, col as never, 'u1')).toBe('read_and_write');
    expect(rowRuleRole(r, col as never, 'u2')).toBe('reader');
    expect(rowRuleRole(r, col as never, 'u3')).toBe('none');
  });

  it('refuses self links, loops and too-deep trees', () => {
    const parents: Record<string, string | undefined> = { b: 'a', c: 'b' };
    const parentOf = (id: string) => parents[id];
    expect(subitemLinkProblem('a', 'a', parentOf, () => 0)).toMatch(/cannot contain itself/);
    expect(subitemLinkProblem('a', 'c', parentOf, () => 2)).toMatch(/cycle/i);
    expect(subitemLinkProblem('d', 'c', parentOf, () => 0)).toBeNull();
    const deep: Record<string, string | undefined> = {};
    for (let i = 1; i <= 10; i++) deep[`n${i}`] = `n${i - 1}`;
    expect(subitemLinkProblem('x', 'n10', (id) => deep[id], () => 0)).not.toBeNull();
    void encodeText;
  });
});
