import { describe, it, expect } from 'vitest';
import {
  flattenReplies,
  collectDescendantIds,
  MAX_VISUAL_DEPTH,
} from '../comment-thread';

type C = { id: string };
const c = (id: string): C => ({ id });

describe('flattenReplies', () => {
  it('returns direct replies at depth 1 in order', () => {
    const rows = flattenReplies('root', { root: [c('a'), c('b')] });
    expect(rows.map((r) => [r.comment.id, r.depth])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  it('nests one level deeper at depth 2, children directly after their parent', () => {
    const rows = flattenReplies('root', {
      root: [c('a'), c('b')],
      a: [c('a1')],
    });
    expect(rows.map((r) => [r.comment.id, r.depth])).toEqual([
      ['a', 1],
      ['a1', 2],
      ['b', 1],
    ]);
  });

  it('flattens a 5-level chain: everything below depth 1 renders at the cap', () => {
    const rows = flattenReplies('root', {
      root: [c('l1')],
      l1: [c('l2')],
      l2: [c('l3')],
      l3: [c('l4')],
      l4: [c('l5')],
    });
    expect(rows.map((r) => r.depth)).toEqual([1, 2, 2, 2, 2]);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(MAX_VISUAL_DEPTH);
    // Chain order is preserved even while flattened.
    expect(rows.map((r) => r.comment.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
  });

  it('interleaves sibling subtrees in walk order', () => {
    const rows = flattenReplies('root', {
      root: [c('a'), c('b')],
      a: [c('a1'), c('a2')],
      a1: [c('a1x')],
      b: [c('b1')],
    });
    expect(rows.map((r) => r.comment.id)).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b1']);
  });

  it('handles a root with no replies', () => {
    expect(flattenReplies('root', {})).toEqual([]);
  });

  it('survives a deep chain without recursion (stack safety)', () => {
    const map: Record<string, C[]> = { root: [c('n0')] };
    for (let i = 0; i < 20000; i++) map[`n${i}`] = [c(`n${i + 1}`)];
    const rows = flattenReplies('root', map);
    expect(rows).toHaveLength(20001); // n0 through n20000
    expect(rows[rows.length - 1].depth).toBe(MAX_VISUAL_DEPTH);
  });
});

describe('collectDescendantIds', () => {
  const map = {
    root: [c('a'), c('b')],
    a: [c('a1')],
    a1: [c('a1x')],
  };

  it('collects the whole subtree', () => {
    expect([...collectDescendantIds('a', map)].sort()).toEqual(['a1', 'a1x']);
  });

  it('does not include the comment itself or siblings', () => {
    const ids = collectDescendantIds('a', map);
    expect(ids.has('a')).toBe(false);
    expect(ids.has('b')).toBe(false);
  });

  it('empty for a leaf', () => {
    expect(collectDescendantIds('a1x', map).size).toBe(0);
  });
});
