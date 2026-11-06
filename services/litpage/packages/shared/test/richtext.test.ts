import { describe, expect, it } from 'vitest';
import {
  addAnnotation, annotationsAt, concat, deleteRange, hasAnnotation, insertText, length, normalize, removeAnnotation, slice, splitAt,
  toPlainText, toggleAnnotation, mention, type RichText,
} from '../src/richtext.ts';

const rt: RichText = [['Hello '], ['bold', [['b']]], [' world']];

describe('richtext', () => {
  it('plain text and length', () => {
    expect(toPlainText(rt)).toBe('Hello bold world');
    expect(length(rt)).toBe(16);
  });
  it('normalize merges equal runs and drops empties', () => {
    expect(normalize([['a'], ['b'], ['', [['b']]], ['c', [['b']]], ['d', [['b']]]])).toEqual([['ab'], ['cd', [['b']]]]);
  });
  it('slice keeps annotations', () => {
    expect(slice(rt, 4, 9)).toEqual([['o '], ['bol', [['b']]]]);
  });
  it('split at offset', () => {
    const [a, b] = splitAt(rt, 8);
    expect(toPlainText(a)).toBe('Hello bo');
    expect(toPlainText(b)).toBe('ld world');
    expect(b[0]).toEqual(['ld', [['b']]]);
  });
  it('insert inherits annotations from the left run (typing at end of bold continues bold)', () => {
    const next = insertText(rt, 10, 'er');
    expect(next).toEqual([['Hello '], ['bolder', [['b']]], [' world']]);
  });
  it('typing after a link or code does not extend it', () => {
    const linked: RichText = [['go', [['a', 'https://x']]]];
    expect(annotationsAt(linked, 2)).toEqual([]);
    const code: RichText = [['x', [['c']]]];
    expect(annotationsAt(code, 1)).toEqual([]);
  });
  it('delete range across runs', () => {
    expect(deleteRange(rt, 3, 13)).toEqual([['Helrld']]);
  });
  it('add/remove/toggle annotations', () => {
    const it1 = addAnnotation([['abcdef']], 1, 4, ['i']);
    expect(it1).toEqual([['a'], ['bcd', [['i']]], ['ef']]);
    expect(hasAnnotation(it1, 1, 4, 'i')).toBe(true);
    expect(removeAnnotation(it1, 0, 6, 'i')).toEqual([['abcdef']]);
    expect(toggleAnnotation(it1, 1, 4, ['i'])).toEqual([['abcdef']]);
  });
  it('text and background colors are independent', () => {
    let v: RichText = [['abc']];
    v = addAnnotation(v, 0, 3, ['h', 'red']);
    v = addAnnotation(v, 0, 3, ['h', 'blue_background']);
    expect(v[0][1]).toEqual([['h', 'red'], ['h', 'blue_background']]);
    v = addAnnotation(v, 0, 3, ['h', 'green']);
    expect(v[0][1]).toEqual([['h', 'blue_background'], ['h', 'green']]);
  });
  it('mentions are atoms of length 1 and never merge', () => {
    const v = concat([['see ']], mention('p', 'abc'), mention('p', 'def'));
    expect(length(v)).toBe(6);
    expect(v.length).toBe(3);
  });
});
