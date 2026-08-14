import { describe, it, expect } from 'vitest';
import {
  createCache,
  cacheRead,
  cacheSet,
  findNarrowableEntry,
  CACHE_MAX_ENTRIES,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
} from '../typeahead';

const complete = (items: string[]) => ({ items, truncated: false });
const truncated = (items: string[]) => ({ items, truncated: true });

describe('constants', () => {
  it('suggests from the first character', () => {
    expect(SUGGEST_MIN_CHARS).toBe(1);
  });

  it('debounces well under the threshold where typing stops feeling live', () => {
    expect(SUGGEST_DEBOUNCE_MS).toBeLessThan(150);
    // Still high enough to actually coalesce a burst of keystrokes.
    expect(SUGGEST_DEBOUNCE_MS).toBeGreaterThanOrEqual(80);
  });
});

describe('cache', () => {
  it('round-trips an entry', () => {
    const c = createCache<string>();
    cacheSet(c, 'tom', complete(['a']));
    expect(cacheRead(c, 'tom')?.items).toEqual(['a']);
  });

  it('misses cleanly on an unknown key', () => {
    expect(cacheRead(createCache<string>(), 'nope')).toBeUndefined();
  });

  // The hook reads this during render, so a read MUST NOT mutate.
  it('reading does not reorder or resize the cache', () => {
    const c = createCache<string>();
    cacheSet(c, 'a', complete(['1']));
    cacheSet(c, 'b', complete(['2']));
    const before = [...c.keys()];
    cacheRead(c, 'a');
    expect([...c.keys()]).toEqual(before);
    expect(c.size).toBe(2);
  });

  it('evicts the oldest entry past capacity', () => {
    const c = createCache<string>();
    for (let i = 0; i < CACHE_MAX_ENTRIES + 5; i++) cacheSet(c, `k${i}`, complete([`v${i}`]));
    expect(c.size).toBe(CACHE_MAX_ENTRIES);
    expect(cacheRead(c, 'k0')).toBeUndefined();
    expect(cacheRead(c, `k${CACHE_MAX_ENTRIES + 4}`)).toBeDefined();
  });

  it('overwriting a key does not grow the cache, and refreshes its position', () => {
    const c = createCache<string>();
    cacheSet(c, 'tom', complete(['a']));
    cacheSet(c, 'other', complete(['z']));
    cacheSet(c, 'tom', complete(['b']));
    expect(c.size).toBe(2);
    expect(cacheRead(c, 'tom')?.items).toEqual(['b']);
    expect([...c.keys()]).toEqual(['other', 'tom']);
  });
});

describe('findNarrowableEntry', () => {
  it('finds a complete shorter prefix to narrow from', () => {
    const c = createCache<string>();
    cacheSet(c, 'to', complete(['tom', 'toby']));
    expect(findNarrowableEntry(c, 'tom')?.items).toEqual(['tom', 'toby']);
  });

  it('prefers the LONGEST matching prefix — the smallest superset', () => {
    const c = createCache<string>();
    cacheSet(c, 't', complete(['1']));
    cacheSet(c, 'to', complete(['2']));
    expect(findNarrowableEntry(c, 'tom')?.items).toEqual(['2']);
  });

  // The correctness rule. A capped result set may be missing the very row the
  // longer query wants, so narrowing it locally would show a confidently
  // wrong list.
  it('REFUSES to narrow from a truncated result set', () => {
    const c = createCache<string>();
    cacheSet(c, 'to', truncated(['tom', 'toby']));
    expect(findNarrowableEntry(c, 'tom')).toBeNull();
  });

  it('falls back to a shorter COMPLETE prefix when the longer one was truncated', () => {
    const c = createCache<string>();
    cacheSet(c, 't', complete(['1']));
    cacheSet(c, 'to', truncated(['2']));
    expect(findNarrowableEntry(c, 'tom')?.items).toEqual(['1']);
  });

  it('ignores keys that are not prefixes', () => {
    const c = createCache<string>();
    cacheSet(c, 'xy', complete(['1']));
    expect(findNarrowableEntry(c, 'tom')).toBeNull();
  });

  it('never narrows from an equal or longer key', () => {
    const c = createCache<string>();
    cacheSet(c, 'tom', complete(['1']));
    cacheSet(c, 'tommy', complete(['2']));
    // Backspacing to a SHORTER query must refetch, not reuse a subset.
    expect(findNarrowableEntry(c, 'tom')).toBeNull();
  });

  it('returns null on an empty cache', () => {
    expect(findNarrowableEntry(createCache<string>(), 'tom')).toBeNull();
  });
});
