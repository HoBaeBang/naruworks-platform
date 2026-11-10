import { describe, expect, it } from 'vitest';
import type { PropertySchema } from '../records.ts';
import { conditionMet, defaultFormConfig, encodeAnswer, questionFor, questionName, supportedPropertyIds, supportsQuestion, validateAnswer, visibleQuestionIds } from './index.ts';

const schema: Record<string, PropertySchema> = {
  title: { name: 'Name', type: 'title' },
  aaaa: { name: 'Done', type: 'checkbox' },
  bbbb: { name: 'Status', type: 'status' },
  cccc: { name: 'Tags', type: 'multi_select', options: [{ id: '1', value: 'UI', color: 'orange' }, { id: '2', value: 'Web', color: 'blue' }] },
  dddd: { name: 'Score', type: 'formula' },
  eeee: { name: 'Place', type: 'place' },
  ffff: { name: 'Email', type: 'email' },
} as never;

describe('form model', () => {
  it('supports Litpage question types (status / formula excluded)', () => {
    expect(supportsQuestion(schema.title)).toBe(true);
    expect(supportsQuestion(schema.bbbb)).toBe(false);
    expect(supportsQuestion(schema.dddd)).toBe(false);
    expect(supportsQuestion(schema.eeee)).toBe(true);
  });

  it('auto-creates questions title-first and skips place (captured "Create 13 questions")', () => {
    expect(supportedPropertyIds(schema)).toEqual(['title', 'aaaa', 'cccc', 'ffff']);
    const all = defaultFormConfig(schema, { all: true, ownerId: 'u1' });
    expect(all.questions.map((q) => q.config.propertyId)).toEqual(['title', 'aaaa', 'cccc', 'ffff']);
    expect(all.initialized).toBe(true);
    const scratch = defaultFormConfig(schema, { all: false });
    expect(scratch.questions.map((q) => q.config.propertyId)).toEqual(['title']);
    expect(defaultFormConfig(schema).initialized).toBe(false);
  });

  it('names follow the property unless sync is off', () => {
    const q = questionFor('cccc');
    expect(questionName(q, schema)).toBe('Tags');
    expect(questionName({ ...q, config: { ...q.config, shouldSyncQuestionNameToPropertyName: false, name: 'Which tags?' } }, schema)).toBe('Which tags?');
  });

  it('validates answers with Litpage messages', () => {
    const req = { ...questionFor('title'), config: { propertyId: 'title', isRequired: true } };
    expect(validateAnswer(req, schema.title, '')).toBe('Please answer this question');
    expect(validateAnswer(req, schema.title, 'x')).toBeNull();
    expect(validateAnswer(questionFor('ffff'), schema.ffff, 'nope')).toBe('Invalid email');
    expect(validateAnswer(questionFor('ffff'), schema.ffff, 'a@b.co')).toBeNull();
    expect(validateAnswer(questionFor('n'), { name: 'N', type: 'number' } as never, '12a')).toBe('Invalid number');
    expect(validateAnswer(questionFor('u'), { name: 'U', type: 'url' } as never, 'example.com')).toBeNull();
    expect(validateAnswer(questionFor('u'), { name: 'U', type: 'url' } as never, 'hello')).toBe('Invalid URL');
  });

  it('encodes answers as stored property values', () => {
    expect(encodeAnswer(schema.title, ' Hi ')).toEqual([['Hi']]);
    expect(encodeAnswer(schema.aaaa, true)).toEqual([['Yes']]);
    expect(encodeAnswer(schema.aaaa, undefined)).toEqual([['No']]);
    expect(encodeAnswer(schema.cccc, ['UI', 'Web'])).toEqual([['UI,Web']]);
    expect(encodeAnswer({ name: 'N', type: 'number' } as never, '1,200')).toEqual([['1200']]);
    expect(encodeAnswer({ name: 'D', type: 'date' } as never, { start_date: '2026-10-20' })).toEqual([['‣', [['d', { type: 'date', start_date: '2026-10-20' }]]]]);
    expect(encodeAnswer({ name: 'P', type: 'person' } as never, ['u1', 'u2'])).toEqual([['‣', [['u', 'u1']]], [','], ['‣', [['u', 'u2']]]]);
    expect(encodeAnswer({ name: 'R', type: 'relation' } as never, ['p1'], 's1')).toEqual([['‣', [['p', 'p1', 's1']]]]);
    expect(encodeAnswer(schema.eeee, 'Seoul')).toEqual([['‣', [['plc', { name: 'Seoul', address: 'Seoul' }]]]]);
  });
});

describe('conditional logic', () => {
  const q = (id: string, condition?: { questionId: string; operator: 'any' | 'all'; values: string[] }) => ({ id, config: { propertyId: id, ...(condition ? { condition } : {}) } });
  it('any / all of the selected options, checkbox checked / unchecked', () => {
    expect(conditionMet({ questionId: 'k', operator: 'any', values: ['Bug', 'Crash'] }, ['Crash'])).toBe(true);
    expect(conditionMet({ questionId: 'k', operator: 'all', values: ['Bug', 'Crash'] }, ['Crash'])).toBe(false);
    expect(conditionMet({ questionId: 'k', operator: 'any', values: ['Bug'] }, 'Bug')).toBe(true);
    expect(conditionMet({ questionId: 'k', operator: 'any', values: ['checked'] }, true)).toBe(true);
    expect(conditionMet({ questionId: 'k', operator: 'any', values: ['unchecked'] }, undefined)).toBe(true);
    expect(conditionMet({ questionId: 'k', operator: 'any', values: [] }, 'Bug')).toBe(false);
  });
  it('nested groups follow their trigger', () => {
    const qs = [q('kind'), q('steps', { questionId: 'kind', operator: 'any', values: ['Bug'] }), q('device', { questionId: 'steps', operator: 'any', values: ['Mobile'] })];
    expect([...visibleQuestionIds(qs, { kind: 'Idea', steps: 'Mobile' })]).toEqual(['kind']);
    expect([...visibleQuestionIds(qs, { kind: 'Bug', steps: 'Mobile' })]).toEqual(['kind', 'steps', 'device']);
  });
});
