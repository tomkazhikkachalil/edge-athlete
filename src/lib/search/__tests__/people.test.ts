import { describe, it, expect } from 'vitest';
import {
  normalizeQuery,
  matchRank,
  rankPeople,
  WIDE_MATCH_MIN_CHARS,
  type PersonSuggestion,
} from '../people';

function person(over: Partial<PersonSuggestion> & { id: string }): PersonSuggestion {
  return {
    handle: null,
    first_name: null,
    middle_name: null,
    last_name: null,
    full_name: null,
    avatar_url: null,
    location: null,
    sport: null,
    school: null,
    visibility: 'public',
    ...over,
  };
}

const tom = person({
  id: 'a',
  handle: 'tomk',
  first_name: 'Tom',
  last_name: 'Kazhikkachalil',
  full_name: 'Tom Kazhikkachalil',
});
const preston = person({
  id: 'b',
  handle: 'preston',
  first_name: 'Preston',
  last_name: 'Doe',
  full_name: 'Preston Doe',
});

describe('normalizeQuery', () => {
  it('trims, lowercases and collapses internal whitespace', () => {
    expect(normalizeQuery('  Tom   Kaz  ')).toBe('tom kaz');
  });

  it('treats @handle and handle identically — people type both', () => {
    expect(normalizeQuery('@TomK')).toBe(normalizeQuery('TomK'));
    expect(normalizeQuery('@TomK')).toBe('tomk');
  });

  it('strips repeated leading @ but never an internal one', () => {
    expect(normalizeQuery('@@tom')).toBe('tom');
    expect(normalizeQuery('a@b')).toBe('a@b');
  });

  it('reduces whitespace-only input to the empty string', () => {
    expect(normalizeQuery('   ')).toBe('');
    expect(normalizeQuery('')).toBe('');
  });
});

describe('matchRank ladder', () => {
  it('ranks an exact handle above a handle prefix', () => {
    expect(matchRank(tom, 'tomk')).toBe(0);
    expect(matchRank(tom, 'tom')).toBeLessThan(2);
  });

  it('ranks a handle prefix above a name prefix', () => {
    const byHandle = person({ id: 'h', handle: 'zach', full_name: 'Zach Smith' });
    const byName = person({ id: 'n', handle: 'qqq', first_name: 'Zach', full_name: 'Zach Jones' });
    expect(matchRank(byHandle, 'zac')!).toBeLessThan(matchRank(byName, 'zac')!);
  });

  it('matches a last-name prefix, not just the first name', () => {
    expect(matchRank(tom, 'kazh')).toBe(2);
  });

  it('finds a word-boundary prefix inside a full name', () => {
    const only = person({ id: 'c', full_name: 'Ana Maria Silva' });
    expect(matchRank(only, 'sil')).toBe(3);
  });

  it('falls back to a substring anywhere', () => {
    expect(matchRank(tom, 'hikka')).toBe(4);
  });

  it('returns null when nothing matches', () => {
    expect(matchRank(tom, 'zzz')).toBeNull();
  });

  it('returns null for an empty query', () => {
    expect(matchRank(tom, '')).toBeNull();
  });

  // The gate that keeps the client honest about what the server would return.
  it('does not substring-match below the wide-match threshold', () => {
    const short = 'az'; // inside "Kazhikkachalil" but not a prefix of anything
    expect(short.length).toBeLessThan(WIDE_MATCH_MIN_CHARS);
    expect(matchRank(tom, short)).toBeNull();
  });

  it('still prefix-matches below the threshold', () => {
    expect(matchRank(tom, 't')).not.toBeNull();
    expect(matchRank(tom, 'ka')).toBe(2);
  });
});

describe('rankPeople', () => {
  it('puts a prefix match above a substring match', () => {
    // "tom" prefixes Tom's name and handle; it does not appear in Preston at
    // all, so Tom is the only match. The ordering point is made below.
    expect(rankPeople([preston, tom], 'tom').map(p => p.id)).toEqual([tom.id]);
  });

  it('ranks a name prefix above a mid-word substring for the same query', () => {
    // "res" prefixes nothing in Tom but sits mid-word in "Preston"; give it a
    // competitor whose name STARTS with it and the prefix must come first.
    const resa = person({ id: 'r', first_name: 'Resa', full_name: 'Resa Vance' });
    expect(rankPeople([preston, resa], 'res').map(p => p.id)).toEqual([resa.id, preston.id]);
  });

  it('drops non-matching people entirely', () => {
    expect(rankPeople([tom, preston], 'preston').map(p => p.id)).toEqual([preston.id]);
  });

  it('returns [] for an empty or whitespace query', () => {
    expect(rankPeople([tom, preston], '')).toEqual([]);
    expect(rankPeople([tom, preston], '   ')).toEqual([]);
  });

  it('normalizes the query itself, so callers need not', () => {
    expect(rankPeople([tom], '  @TOMK ').map(p => p.id)).toEqual([tom.id]);
  });

  it('breaks ties by name length, then alphabetically', () => {
    const long = person({ id: 'x', first_name: 'Samantha', full_name: 'Samantha Long' });
    const short = person({ id: 'y', first_name: 'Sam', full_name: 'Sam Ray' });
    expect(rankPeople([long, short], 'sam').map(p => p.id)).toEqual(['y', 'x']);
  });

  it('is a total order — same input in any arrival order gives one result', () => {
    const a = person({ id: '1', full_name: 'Chris Ray' });
    const b = person({ id: '2', full_name: 'Chris Ray' });
    expect(rankPeople([a, b], 'chris').map(p => p.id)).toEqual(
      rankPeople([b, a], 'chris').map(p => p.id)
    );
  });

  it('never places a worse tier above a better one', () => {
    const ranked = rankPeople([preston, tom], 'tom');
    const tiers = ranked.map(p => matchRank(p, 'tom')!);
    expect([...tiers].sort((x, y) => x - y)).toEqual(tiers);
  });
});
