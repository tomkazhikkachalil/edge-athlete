import { describe, it, expect } from 'vitest';
import { chunk } from '../chunk';

describe('chunk', () => {
  it('splits into consecutive batches of the given size', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('keeps the remainder as a short final batch', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns [] for empty input and one batch when size exceeds length', () => {
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});
