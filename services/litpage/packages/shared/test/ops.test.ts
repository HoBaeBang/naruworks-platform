import { describe, expect, it } from 'vitest';
import { applyOperation, invertOperation, op, type Operation } from '../src/ops.ts';

const ptr = { table: 'block' as const, id: 'b1' };

function applyAll(rec: any, ops: Operation[]) {
  for (const o of ops) rec = applyOperation(rec, o);
  return rec;
}

describe('ops', () => {
  it('set at root creates a record', () => {
    const r = applyOperation(undefined, op.set(ptr, [], { type: 'text', alive: true }));
    expect(r).toEqual({ id: 'b1', type: 'text', alive: true });
  });
  it('set at path and update merge', () => {
    let r: any = { id: 'b1', version: 1, properties: { title: [['a']] } };
    r = applyOperation(r, op.set(ptr, ['properties', 'title'], [['b']]));
    r = applyOperation(r, op.update(ptr, ['format'], { page_icon: '🔥' }));
    expect(r.properties.title).toEqual([['b']]);
    expect(r.format).toEqual({ page_icon: '🔥' });
  });
  it('list ops are idempotent and position-aware (Litpage semantics)', () => {
    let r: any = { id: 'p', version: 1, content: ['a', 'b'] };
    r = applyOperation(r, op.listAfter(ptr, ['content'], 'c', 'a'));
    expect(r.content).toEqual(['a', 'c', 'b']);
    r = applyOperation(r, op.listAfter(ptr, ['content'], 'c', 'a'));
    expect(r.content).toEqual(['a', 'c', 'b']);
    r = applyOperation(r, op.listBefore(ptr, ['content'], 'b'));
    expect(r.content).toEqual(['b', 'a', 'c']);
    r = applyOperation(r, op.listRemove(ptr, ['content'], 'a'));
    expect(r.content).toEqual(['b', 'c']);
    r = applyOperation(r, op.listAfter(ptr, ['content'], 'z'));
    expect(r.content).toEqual(['b', 'c', 'z']);
  });
  it('inverse operations restore the previous state', () => {
    const before: any = { id: 'b1', version: 3, type: 'text', properties: { title: [['x']] }, format: { a: 1 }, content: ['k'] };
    const ops: Operation[] = [
      op.set(ptr, ['properties', 'title'], [['y']]),
      op.update(ptr, ['format'], { a: 2, b: 3 }),
      op.listAfter(ptr, ['content'], 'm'),
      op.update(ptr, [], { type: 'header' }),
    ];
    let cur = before;
    const inverses: Operation[] = [];
    for (const o of ops) {
      inverses.push(invertOperation(cur, o));
      cur = applyOperation(cur, o);
    }
    const restored = applyAll(cur, inverses.reverse());
    expect(restored).toEqual(before);
  });
  it('inverse of creation marks the record dead', () => {
    const inv = invertOperation(undefined, op.set(ptr, [], { type: 'text' }));
    expect(inv).toEqual({ pointer: ptr, path: [], command: 'update', args: { alive: false } });
  });
});
