import { describe, expect, it } from 'vitest';
import { applyPinChange, MAX_PINNED_SPORTS } from '../sport-pins';

describe('applyPinChange — the whole packed list, every time', () => {
  it('pin appends; pin at a position inserts; the cap refuses by name', () => {
    expect(applyPinChange([], { kind: 'pin', key: 'golf' })).toEqual({ pins: ['golf'] });
    expect(applyPinChange(['golf'], { kind: 'pin', key: 'soccer', position: 1 })).toEqual({ pins: ['soccer', 'golf'] });
    const full = ['a', 'b', 'c', 'd'];
    expect(MAX_PINNED_SPORTS).toBe(4);
    expect(applyPinChange(full, { kind: 'pin', key: 'e' })).toEqual({ pins: full, refused: 'pin_cap' });
    // re-pinning an already pinned sport is a move, never a refusal
    expect(applyPinChange(full, { kind: 'pin', key: 'd', position: 1 })).toEqual({ pins: ['d', 'a', 'b', 'c'] });
  });
  it('unpin removes and packs; unpinning an unpinned key is a no-op', () => {
    expect(applyPinChange(['golf', 'soccer', 'tennis'], { kind: 'unpin', key: 'soccer' })).toEqual({ pins: ['golf', 'tennis'] });
    expect(applyPinChange(['golf'], { kind: 'unpin', key: 'soccer' })).toEqual({ pins: ['golf'] });
  });
  it('move repositions; out-of-range positions clamp; a move of an unpinned key is refused', () => {
    expect(applyPinChange(['a', 'b', 'c'], { kind: 'move', key: 'c', position: 1 })).toEqual({ pins: ['c', 'a', 'b'] });
    expect(applyPinChange(['a', 'b', 'c'], { kind: 'move', key: 'a', position: 99 })).toEqual({ pins: ['b', 'c', 'a'] });
    expect(applyPinChange(['a', 'b'], { kind: 'move', key: 'z', position: 1 })).toEqual({ pins: ['a', 'b'], refused: 'not_pinned' });
  });
  it('duplicates in the stored list are collapsed', () => {
    expect(applyPinChange(['a', 'a', 'b'], { kind: 'unpin', key: 'b' })).toEqual({ pins: ['a'] });
  });
});
