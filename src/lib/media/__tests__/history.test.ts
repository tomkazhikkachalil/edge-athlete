import { describe, it, expect } from 'vitest';
import {
  emptyHistory,
  historyTimeline,
  jumpTo,
  push,
  undo,
  redo,
  HISTORY_CAP,
} from '../history';

const values = <T,>(entries: Array<{ value: T }>) => entries.map(e => e.value);

describe('push', () => {
  it('stacks entries and clears the redo stack', () => {
    let h = emptyHistory<number>();
    h = push(h, 1);
    h = push(h, 2);
    expect(values(h.past)).toEqual([1, 2]);
    const u = undo(h, 3)!;
    expect(values(u.history.future)).toEqual([3]);
    const afterNewPush = push(u.history, u.value);
    expect(afterNewPush.future).toEqual([]);
  });

  it('caps the stack by dropping the oldest entries', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_CAP + 5; i++) h = push(h, i);
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0].value).toBe(5);
  });

  it('coalesces consecutive pushes with the same keys signature', () => {
    let h = emptyHistory<number>();
    h = push(h, 0, 'adjustments'); // drag starts — pre-drag snapshot stacked
    h = push(h, 1, 'adjustments'); // still dragging
    h = push(h, 2, 'adjustments');
    expect(values(h.past)).toEqual([0]); // one undo step for the whole drag
    h = push(h, 3, 'filterId'); // different control — new step
    expect(values(h.past)).toEqual([0, 3]);
  });

  it('does not coalesce across an undo (signature cleared)', () => {
    let h = emptyHistory<number>();
    h = push(h, 0, 'adjustments');
    const u = undo(h, 1)!;
    const next = push(u.history, u.value, 'adjustments');
    expect(values(next.past)).toEqual([0]);
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
    expect(values(r.history.past)).toEqual(['a']);
    expect(r.history.future).toEqual([]);
  });

  it('returns null when there is nothing to undo or redo', () => {
    expect(undo(emptyHistory<number>(), 1)).toBeNull();
    expect(redo(emptyHistory<number>(), 1)).toBeNull();
  });

  it("undo/redo carry each state's producing signature (rail labels survive)", () => {
    let h = emptyHistory<string>();
    h = push(h, 'a', 'crop'); // 'b' was produced by 'crop'
    const u = undo(h, 'b')!;
    expect(u.history.future[0]).toEqual({ value: 'b', keys: 'crop' });
    const r = redo(u.history, u.value)!;
    expect(r.history.past[0]).toEqual({ value: 'a', keys: 'crop' });
  });
});

describe('historyTimeline', () => {
  it('lists states oldest-first with the change that produced each', () => {
    let h = emptyHistory<string>();
    h = push(h, 'a', 'crop'); // b = a + crop
    h = push(h, 'b', 'light.exposure'); // c = b + exposure
    const rows = historyTimeline(h); // present = 'c'
    expect(rows).toEqual([
      { index: 0, keys: null, isPresent: false }, // 'a' — original
      { index: 1, keys: 'crop', isPresent: false }, // 'b'
      { index: 2, keys: 'light.exposure', isPresent: true }, // 'c'
    ]);
  });

  it('includes redo states after an undo', () => {
    let h = emptyHistory<string>();
    h = push(h, 'a', 'crop');
    h = push(h, 'b', 'filterId');
    const u = undo(h, 'c')!;
    const rows = historyTimeline(u.history);
    expect(rows).toEqual([
      { index: 0, keys: null, isPresent: false },
      { index: 1, keys: 'crop', isPresent: true }, // present = 'b'
      { index: 2, keys: 'filterId', isPresent: false }, // redo → 'c'
    ]);
  });

  it('an empty history is a single Original present row', () => {
    expect(historyTimeline(emptyHistory<string>())).toEqual([
      { index: 0, keys: null, isPresent: true },
    ]);
  });
});

describe('jumpTo', () => {
  function build(): { h: ReturnType<typeof emptyHistory<string>>; present: string } {
    let h = emptyHistory<string>();
    h = push(h, 'a', 'crop');
    h = push(h, 'b', 'light.exposure');
    h = push(h, 'c', 'filterId');
    return { h, present: 'd' };
  }

  it('jumps straight back to any earlier state', () => {
    const { h, present } = build();
    const jumped = jumpTo(h, present, 0)!;
    expect(jumped.value).toBe('a');
    expect(jumped.history.past).toHaveLength(0);
    expect(values(jumped.history.future)).toEqual(['d', 'c', 'b']);
  });

  it('jumps forward again through the redo stack', () => {
    const { h, present } = build();
    const back = jumpTo(h, present, 1)!; // at 'b'
    const forward = jumpTo(back.history, back.value, 3)!;
    expect(forward.value).toBe('d');
    expect(values(forward.history.past)).toEqual(['a', 'b', 'c']);
    expect(forward.history.future).toEqual([]);
  });

  it('round-trip preserves every label', () => {
    const { h, present } = build();
    const back = jumpTo(h, present, 0)!;
    const forward = jumpTo(back.history, back.value, 3)!;
    expect(historyTimeline(forward.history)).toEqual(historyTimeline(h));
  });

  it('rejects out-of-range and no-op indices', () => {
    const { h, present } = build();
    expect(jumpTo(h, present, 3)).toBeNull(); // already present
    expect(jumpTo(h, present, 4)).toBeNull();
    expect(jumpTo(h, present, -1)).toBeNull();
  });
});
