import { describe, expect, it } from 'vitest';
import { toPlainText, type RichText } from '../src/richtext.ts';
import {
  acceptSuggestion, acceptedView, adjacentSuggestionId, isSuggestionOnlyEdit, rejectSuggestion, suggestEdit, suggestFormat, suggestionIds,
  summarizeSuggestion,
} from '../src/richtextSuggest.ts';

const mine = (id: string) => id.startsWith('me');

describe('suggested edits', () => {
  it('typing becomes a suggested insertion that keeps the left formatting', () => {
    const prev: RichText = [['Hello '], ['bold', [['b']]]];
    const r = suggestEdit(prev, 10, 10, '!', { insertId: 'me1', removeId: 'me1', mine });
    expect(r.value).toEqual([['Hello '], ['bold', [['b']]], ['!', [['b'], ['si', 'me1']]]]);
    expect(r.caret).toBe(11);
    expect(acceptedView(r.value)).toEqual(prev);
  });

  it('deleting accepted text strikes it instead of removing it; Backspace leaves the caret before it', () => {
    const prev: RichText = [['abcdef']];
    const r = suggestEdit(prev, 2, 4, '', { insertId: 'me2', removeId: 'me2', mine });
    expect(toPlainText(r.value)).toBe('abcdef');
    expect(r.value).toEqual([['ab'], ['cd', [['sr', 'me2']]], ['ef']]);
    expect(r.caret).toBe(2);
    expect(suggestEdit(prev, 2, 4, '', { insertId: 'x', removeId: 'me2', mine, forward: true }).caret).toBe(4);
  });

  it('deleting your own suggested text really removes it', () => {
    const prev: RichText = [['ab'], ['XY', [['si', 'me1']]], ['c']];
    const r = suggestEdit(prev, 2, 4, '', { insertId: 'me1', removeId: 'me1', mine });
    expect(r.value).toEqual([['abc']]);
    // someone else's suggested insertion is struck like accepted text
    const other: RichText = [['ab'], ['XY', [['si', 'zz']]], ['c']];
    expect(suggestEdit(other, 2, 4, '', { insertId: 'me1', removeId: 'me1', mine }).value).toEqual([['ab'], ['XY', [['si', 'zz'], ['sr', 'me1']]], ['c']]);
  });

  it('typing over a selection suggests a replacement (struck old text, new text after it)', () => {
    const prev: RichText = [['the cat sat']];
    const r = suggestEdit(prev, 4, 7, 'dog', { insertId: 'me3', removeId: 'me3', mine });
    expect(toPlainText(r.value)).toBe('the catdog sat');
    expect(summarizeSuggestion(r.value, 'me3')).toMatchObject({ kind: 'replace', removed: 'cat', added: 'dog' });
    expect(r.caret).toBe(10);
    expect(acceptSuggestion(r.value, 'me3')).toEqual([['the dog sat']]);
    expect(rejectSuggestion(r.value, 'me3')).toEqual([['the cat sat']]);
  });

  it('format suggestions apply on accept and vanish on reject', () => {
    const prev: RichText = [['make this bold']];
    const v = suggestFormat(prev, 10, 14, ['b'], 'me4');
    expect(summarizeSuggestion(v, 'me4')).toMatchObject({ kind: 'format', target: 'bold' });
    expect(acceptSuggestion(v, 'me4')).toEqual([['make this '], ['bold', [['b']]]]);
    expect(rejectSuggestion(v, 'me4')).toEqual(prev);
    const un = suggestFormat([['x', [['b']]]], 0, 1, ['b'], 'me5');
    expect(acceptSuggestion(un, 'me5')).toEqual([['x']]);
  });

  it('commenters may only change text through their own suggestions', () => {
    const before: RichText = [['Final paragraph.']];
    const typed = suggestEdit(before, 16, 16, ' Suggested', { insertId: 'me1', removeId: 'me1', mine }).value;
    const owns = (id: string) => id === 'me1';
    expect(isSuggestionOnlyEdit(before, typed, owns)).toBe(true);
    // a plain edit of the accepted text is refused
    expect(isSuggestionOnlyEdit(before, [['Final paragraph!']], owns)).toBe(false);
    // accepting (suggested text becomes real) is refused
    expect(isSuggestionOnlyEdit(typed, acceptSuggestion(typed, 'me1'), owns)).toBe(false);
    // rejecting your own suggestion is fine, removing someone else's is not
    expect(isSuggestionOnlyEdit(typed, rejectSuggestion(typed, 'me1'), owns)).toBe(true);
    expect(isSuggestionOnlyEdit(typed, rejectSuggestion(typed, 'me1'), () => false)).toBe(false);
    // formatting the accepted text directly is refused
    expect(isSuggestionOnlyEdit(before, [['Final', [['b']]], [' paragraph.']], owns)).toBe(false);
  });

  it('finds an adjacent own suggestion so consecutive typing extends it', () => {
    const v: RichText = [['ab'], ['XY', [['si', 'me1']]], ['c']];
    expect(adjacentSuggestionId(v, 4, 4, mine)).toBe('me1');
    expect(adjacentSuggestionId(v, 2, 2, mine)).toBe('me1');
    expect(adjacentSuggestionId(v, 5, 5, mine)).toBe(null);
    expect(adjacentSuggestionId(v, 4, 4, () => false)).toBe(null);
    expect(suggestionIds(v)).toEqual(['me1']);
  });
});
