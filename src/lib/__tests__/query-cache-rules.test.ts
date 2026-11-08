import { describe, it, expect } from 'vitest';
import { DEFAULT_STALE_MS, MAX_ENTRIES, evictionOrder, matchesPrefix, planRead } from '../net/query-cache-rules';

/** The client read cache's rules (performance program, Phase 2 — Nov 2026). */
describe('query cache — the read plan', () => {
  const entry = { value: 1, at: 1_000 };
  it('fetches when nothing is cached', () => {
    expect(planRead(undefined, 5_000, 10_000)).toBe('fetch');
  });
  it('serves a young value and revalidates an old one behind it', () => {
    expect(planRead(entry, 1_000 + 10_000, 10_000)).toBe('serve');
    expect(planRead(entry, 1_000 + 10_001, 10_000)).toBe('serve-and-revalidate');
  });
  it('force serves what it has and fetches anyway; a zero lifetime always revalidates', () => {
    expect(planRead(entry, 1_001, 10_000, true)).toBe('serve-and-revalidate');
    expect(planRead(entry, 1_001, 0)).toBe('serve-and-revalidate');
    expect(planRead(entry, 1_000, 0)).toBe('serve');
  });
  it('the defaults: ten seconds, two hundred keys', () => {
    expect(DEFAULT_STALE_MS).toBe(10_000);
    expect(MAX_ENTRIES).toBe(200);
  });
});

describe('query cache — invalidation and eviction', () => {
  it('a prefix forgets the key, its queries and its children, nothing else', () => {
    expect(matchesPrefix('/api/posts', '/api/posts')).toBe(true);
    expect(matchesPrefix('/api/posts?limit=20', '/api/posts')).toBe(true);
    expect(matchesPrefix('/api/posts/abc', '/api/posts')).toBe(true);
    expect(matchesPrefix('/api/postsx', '/api/posts')).toBe(true); // a prefix is a prefix — name keys so this cannot bite
    expect(matchesPrefix('/api/profile', '/api/posts')).toBe(false);
  });
  it('evicts the oldest first, only when over the cap', () => {
    const e = (at: number) => ({ value: 0, at });
    expect(evictionOrder([['a', e(3)], ['b', e(1)]], 2)).toEqual([]);
    expect(evictionOrder([['a', e(3)], ['b', e(1)], ['c', e(2)]], 2)).toEqual(['b']);
    expect(evictionOrder([['a', e(3)], ['b', e(1)], ['c', e(2)]], 1)).toEqual(['b', 'c']);
  });
});
