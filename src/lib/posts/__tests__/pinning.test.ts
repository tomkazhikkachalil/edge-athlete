import { describe, it, expect } from 'vitest';
import { MAX_PINNED_POSTS, canPin, sortByPinnedAt } from '../pinning';

describe('canPin', () => {
  it('allows pinning below the cap', () => {
    expect(canPin(0)).toBe(true);
    expect(canPin(MAX_PINNED_POSTS - 1)).toBe(true);
  });

  it('blocks pinning at and above the cap', () => {
    expect(canPin(MAX_PINNED_POSTS)).toBe(false);
    expect(canPin(MAX_PINNED_POSTS + 1)).toBe(false);
  });

  it('the cap is 3 featured posts', () => {
    // The UI copy ("up to 3 posts") and the Featured row's 3-up grid assume
    // this — changing the cap means changing both.
    expect(MAX_PINNED_POSTS).toBe(3);
  });
});

describe('sortByPinnedAt', () => {
  it('orders newest pin first', () => {
    const sorted = sortByPinnedAt([
      { id: 'a', pinned_at: '2026-07-01T00:00:00Z' },
      { id: 'c', pinned_at: '2026-07-20T00:00:00Z' },
      { id: 'b', pinned_at: '2026-07-10T00:00:00Z' },
    ]);
    expect(sorted.map(p => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('sinks rows without pinned_at to the end and does not mutate input', () => {
    const input = [
      { id: 'x', pinned_at: null },
      { id: 'y', pinned_at: '2026-07-10T00:00:00Z' },
    ];
    const sorted = sortByPinnedAt(input);
    expect(sorted.map(p => p.id)).toEqual(['y', 'x']);
    expect(input.map(p => p.id)).toEqual(['x', 'y']);
  });
});
