import { describe, expect, it } from 'vitest';
import { applySplice, diffSplice, invertSplice } from '../src/textmerge.ts';
import { applyOperation, invertOperation, op } from '../src/ops.ts';
import { text, toPlainText, type RichText } from '../src/richtext.ts';

const plain = (rt: RichText) => toPlainText(rt);

describe('textmerge', () => {
  it('diffSplice finds the minimal single splice (chars and annotations)', () => {
    expect(diffSplice(text('Hello world'), text('Hello big world'))).toEqual({ base: 'Hello world', start: 6, end: 6, insert: [['big ']] });
    expect(diffSplice(text('abc'), text('abc'))).toBeNull();
    const bolded: RichText = [['Hello '], ['world', [['b']]]];
    expect(diffSplice(text('Hello world'), bolded)).toEqual({ base: 'Hello world', start: 6, end: 11, insert: [['world', [['b']]]] });
  });

  it('applies directly when the text is unchanged', () => {
    const sp = diffSplice(text('Hello world'), text('Hello big world'))!;
    expect(plain(applySplice(text('Hello world'), sp))).toBe('Hello big world');
  });

  it('keeps a concurrent edit elsewhere in the block', () => {
    const mine = diffSplice(text('Hello world'), text('Hello big world'))!; // insert in the middle
    expect(plain(applySplice(text('Hello world!'), mine))).toBe('Hello big world!');
    expect(plain(applySplice(text('Oh, Hello world'), mine))).toBe('Oh, Hello big world');
  });

  it('two users typing at different places both survive in either order', () => {
    const base = text('The quick fox');
    const a = diffSplice(base, text('The quick brown fox'))!;
    const b = diffSplice(base, text('The very quick fox'))!;
    const ab = applySplice(applySplice(base, a), b);
    const ba = applySplice(applySplice(base, b), a);
    expect(plain(ab)).toBe('The very quick brown fox');
    expect(plain(ba)).toBe('The very quick brown fox');
  });

  it('typing at the same point keeps both insertions', () => {
    const base = text('ab');
    const a = diffSplice(base, text('aXb'))!;
    const b = diffSplice(base, text('aYb'))!;
    expect(plain(applySplice(applySplice(base, a), b)).length).toBe(4);
    expect(plain(applySplice(applySplice(base, a), b))).toMatch(/^a(XY|YX)b$/);
  });

  it('a deletion does not remove text another user inserted inside the deleted range', () => {
    const base = text('one two three');
    const del = diffSplice(base, text('one three'))!; // delete "two "
    const theirs = applySplice(base, diffSplice(base, text('one twoNEW three'))!);
    const merged = plain(applySplice(theirs, del));
    // the deletion's base characters are gone, the concurrently inserted text is kept
    expect(merged).toContain('NEW');
    expect(merged.length).toBe('one three'.length + 'NEW'.length);
  });

  it('inverse splice undoes even after a concurrent edit', () => {
    const before = text('Hello world');
    const sp = diffSplice(before, text('Hello big world'))!;
    const inv = invertSplice(before, sp);
    const after = applySplice(before, sp);
    const concurrent = applySplice(after, diffSplice(after, text('Hello big world!!'))!);
    expect(plain(applySplice(concurrent, inv))).toBe('Hello world!!');
  });

  it('works as a record operation with invert', () => {
    const rec: any = { id: 'b1', version: 3, properties: { title: [['Hi there']] } };
    const pointer = { table: 'block' as const, id: 'b1', spaceId: 's' };
    const o = op.spliceText(pointer, ['properties', 'title'], diffSplice([['Hi there']], [['Hi ', [['b']]], ['there']])!);
    const next: any = applyOperation(rec, o);
    expect(next.properties.title).toEqual([['Hi ', [['b']]], ['there']]);
    const undo = invertOperation(rec, o);
    expect((applyOperation(next, undo) as any).properties.title).toEqual([['Hi there']]);
  });

  it('handles atoms (mentions) as single characters', () => {
    const base: RichText = [['See '], ['‣', [['p', 'page1']]], [' now']];
    const sp = diffSplice(base, [['See '], ['‣', [['p', 'page1']]], [' right now']])!;
    const out = applySplice([['Please see '], ['‣', [['p', 'page1']]], [' now']], sp);
    expect(out).toEqual([['Please see '], ['‣', [['p', 'page1']]], [' right now']]);
  });
});
