import { describe, it, expect } from 'vitest';
import { emptyHistory, push, undo, redo, HISTORY_CAP } from '../history';

describe('push', () => {
  it('stacks entries and clears the redo stack', () => {
    let h = emptyHistory<number>();
    h = push(h, 1);
    h = push(h, 2);
    expect(h.past).toEqual([1, 2]);
    const u = undo(h, 3)!;
    expect(u.history.future).toEqual([3]);
    const afterNewPush = push(u.history, u.value);
    expect(afterNewPush.future).toEqual([]);
  });

  it('caps the stack by dropping the oldest entries', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_CAP + 5; i++) h = push(h, i);
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]).toBe(5);
  });

  it('coalesces consecutive pushes with the same keys signature', () => {
    let h = emptyHistory<number>();
    h = push(h, 0, 'adjustments'); // drag starts — pre-drag snapshot stacked
    h = push(h, 1, 'adjustments'); // still dragging
    h = push(h, 2, 'adjustments');
    expect(h.past).toEqual([0]); // one undo step for the whole drag
    h = push(h, 3, 'filterId'); // different control — new step
    expect(h.past).toEqual([0, 3]);
  });

  it('does not coalesce across an undo (signature cleared)', () => {
    let h = emptyHistory<number>();
    h = push(h, 0, 'adjustments');
    const u = undo(h, 1)!;
    const next = push(u.history, u.value, 'adjustments');
    expect(next.past).toEqual([0]);
  });
});

describe('undo/redo', () => {
  it('round-trips: undo returns the prior value, redo restores the present', () => {
    let h = emptyHistory<string>();
    h = push(h, 'a');
    const u = undo(h, 'b')!;
    expect(u.value).toBe('a');
    const r = redo(u.history, u.value)!;
    expect(r.value).toBe('b');
    expect(r.history.past).toEqual(['a']);
    expect(r.history.future).toEqual([]);
  });

  it('returns null when there is nothing to undo or redo', () => {
    expect(undo(emptyHistory<number>(), 1)).toBeNull();
    expect(redo(emptyHistory<number>(), 1)).toBeNull();
  });
});
