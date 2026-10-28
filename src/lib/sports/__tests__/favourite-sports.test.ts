import { describe, expect, it } from 'vitest';
import {
  MAX_FAVOURITE_SPORTS,
  matchesSportQuery,
  partitionSports,
  sanitizeFavouriteSports,
  toggleFavourite,
} from '../favourite-sports';

const KNOWN = ['golf', 'rowing', 'boxing', 'bjj', 'tennis', 'baseball', 'wrestling'];

describe('sanitizeFavouriteSports — any value in, the known keys out, sorted', () => {
  it('junk is an empty list, never a throw', () => {
    for (const junk of [null, undefined, 'golf', {}, 42, [1, null, {}, ['golf']]]) {
      expect(sanitizeFavouriteSports(junk, KNOWN)).toEqual([]);
    }
  });
  it('unknown keys are dropped; keys are exact (no trimming, no case folding)', () => {
    expect(sanitizeFavouriteSports(['golf', 'zzz', 'Golf', ' rowing'], KNOWN)).toEqual(['golf']);
  });
  it('duplicates collapse and the result is sorted — canonical bytes', () => {
    expect(sanitizeFavouriteSports(['rowing', 'golf', 'rowing', 'boxing', 'golf'], KNOWN)).toEqual(['boxing', 'golf', 'rowing']);
    const flood = Array.from({ length: 100 }, (_, i) => KNOWN[i % KNOWN.length]);
    expect(sanitizeFavouriteSports(flood, KNOWN)).toHaveLength(KNOWN.length);
  });
  it('the body cap sits above the registry', () => {
    expect(MAX_FAVOURITE_SPORTS).toBeGreaterThan(17);
  });
});

describe('toggleFavourite — a star tap', () => {
  it('adds, then removes, round-tripping to the start', () => {
    const on = toggleFavourite([], 'golf', KNOWN);
    expect(on).toEqual(['golf']);
    expect(toggleFavourite(on, 'rowing', KNOWN)).toEqual(['golf', 'rowing']);
    expect(toggleFavourite(toggleFavourite(on, 'rowing', KNOWN), 'golf', KNOWN)).toEqual(['rowing']);
    expect(toggleFavourite(on, 'golf', KNOWN)).toEqual([]);
  });
  it('an unknown key is a no-op; junk in the current list is cleaned on the way', () => {
    expect(toggleFavourite(['golf'], 'zzz', KNOWN)).toEqual(['golf']);
    expect(toggleFavourite(['golf', 'zzz', 'golf'], 'boxing', KNOWN)).toEqual(['boxing', 'golf']);
  });
});

const SPORTS = [
  { sport_key: 'wrestling', display_name: 'Wrestling', enabled: true },
  { sport_key: 'golf', display_name: 'Golf', enabled: true },
  { sport_key: 'bjj', display_name: 'Jiu-Jitsu', enabled: true },
  { sport_key: 'tennis', display_name: 'Tennis', enabled: false },
  { sport_key: 'baseball', display_name: 'Baseball', enabled: true },
  { sport_key: 'rowing', display_name: 'Rowing', enabled: true },
];

describe('matchesSportQuery', () => {
  it('empty matches everything; the query is trimmed and case-folded; the key counts too', () => {
    expect(matchesSportQuery(SPORTS[1], '')).toBe(true);
    expect(matchesSportQuery(SPORTS[1], '   ')).toBe(true);
    expect(matchesSportQuery(SPORTS[1], '  GoLF ')).toBe(true);
    expect(matchesSportQuery(SPORTS[2], 'bjj')).toBe(true);
    expect(matchesSportQuery(SPORTS[2], 'golf')).toBe(false);
  });
});

describe('partitionSports — Favourites then All Sports, both alphabetical', () => {
  it('All Sports is alphabetical by display name, disabled sports included', () => {
    const { all } = partitionSports(SPORTS, [], '');
    expect(all.map(s => s.display_name)).toEqual(['Baseball', 'Golf', 'Jiu-Jitsu', 'Rowing', 'Tennis', 'Wrestling']);
  });
  it('Favourites lists only enabled favourites, alphabetical; the sport stays in All Sports too', () => {
    const { favourites, all } = partitionSports(SPORTS, ['rowing', 'golf', 'tennis'], '');
    expect(favourites.map(s => s.sport_key)).toEqual(['golf', 'rowing']);
    expect(all.map(s => s.sport_key)).toContain('golf');
    expect(all.find(s => s.sport_key === 'tennis')?.enabled).toBe(false);
  });
  it('the query filters both sections; nothing found leaves both empty', () => {
    const hit = partitionSports(SPORTS, ['rowing', 'golf'], '  GoLF ');
    expect(hit.favourites.map(s => s.sport_key)).toEqual(['golf']);
    expect(hit.all.map(s => s.sport_key)).toEqual(['golf']);
    const miss = partitionSports(SPORTS, ['rowing'], 'zzz');
    expect(miss).toEqual({ favourites: [], all: [] });
  });
});
