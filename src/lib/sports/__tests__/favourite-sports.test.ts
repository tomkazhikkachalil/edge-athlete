import { describe, expect, it } from 'vitest';
import {
  MAX_FAVOURITE_SPORTS,
  matchesSportQuery,
  partitionSports,
  sanitizeFavouriteSports,
  toggleFavourite,
  lastUsedSport,
  showFavouritesHint,
  moveOffset,
  TILE_MOVE_MS,
} from '../favourite-sports';

const KNOWN = ['golf', 'rowing', 'boxing', 'bjj', 'tennis', 'baseball', 'wrestling'];

describe('sanitizeFavouriteSports — any value in, the known keys out, order kept', () => {
  it('junk is an empty list, never a throw', () => {
    for (const junk of [null, undefined, 'golf', {}, 42, [1, null, {}, ['golf']]]) {
      expect(sanitizeFavouriteSports(junk, KNOWN)).toEqual([]);
    }
  });
  it('unknown keys are dropped; keys are exact (no trimming, no case folding)', () => {
    expect(sanitizeFavouriteSports(['golf', 'zzz', 'Golf', ' rowing'], KNOWN)).toEqual(['golf']);
  });
  it('duplicates collapse to the first mention and the order given is kept (never sorted)', () => {
    expect(sanitizeFavouriteSports(['rowing', 'golf', 'rowing', 'boxing', 'golf'], KNOWN)).toEqual(['rowing', 'golf', 'boxing']);
    const flood = Array.from({ length: 100 }, (_, i) => KNOWN[i % KNOWN.length]);
    expect(sanitizeFavouriteSports(flood, KNOWN)).toHaveLength(KNOWN.length);
  });
  it('the body cap sits above the registry', () => {
    expect(MAX_FAVOURITE_SPORTS).toBeGreaterThan(17);
  });
});

describe('toggleFavourite — a switch tap', () => {
  it('adds, then removes, round-tripping to the start', () => {
    const on = toggleFavourite([], 'golf', KNOWN);
    expect(on).toEqual(['golf']);
    expect(toggleFavourite(on, 'rowing', KNOWN)).toEqual(['golf', 'rowing']);
    expect(toggleFavourite(toggleFavourite(on, 'rowing', KNOWN), 'golf', KNOWN)).toEqual(['rowing']);
    expect(toggleFavourite(on, 'golf', KNOWN)).toEqual([]);
  });
  it('an unknown key is a no-op; junk in the current list is cleaned on the way', () => {
    expect(toggleFavourite(['golf'], 'zzz', KNOWN)).toEqual(['golf']);
    expect(toggleFavourite(['golf', 'zzz', 'golf'], 'boxing', KNOWN)).toEqual(['golf', 'boxing']);
  });
  it('the newest favourite goes at the END; one taken out leaves the others where they were', () => {
    const three = toggleFavourite(toggleFavourite(['wrestling'], 'boxing', KNOWN), 'golf', KNOWN);
    expect(three).toEqual(['wrestling', 'boxing', 'golf']);
    expect(toggleFavourite(three, 'boxing', KNOWN)).toEqual(['wrestling', 'golf']);
    // Off and on again: it re-joins at the end, not where it was.
    expect(toggleFavourite(toggleFavourite(three, 'wrestling', KNOWN), 'wrestling', KNOWN)).toEqual(['boxing', 'golf', 'wrestling']);
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

describe('partitionSports — one home per sport', () => {
  it('All Sports is alphabetical by display name, disabled sports included', () => {
    const { all } = partitionSports(SPORTS, [], '');
    expect(all.map(s => s.display_name)).toEqual(['Baseball', 'Golf', 'Jiu-Jitsu', 'Rowing', 'Tennis', 'Wrestling']);
  });
  it('Favourites holds the enabled favourites in the STORED order; All Sports holds the rest, alphabetical', () => {
    const { favourites, all } = partitionSports(SPORTS, ['rowing', 'golf', 'tennis'], '');
    expect(favourites.map(s => s.sport_key)).toEqual(['rowing', 'golf']);
    expect(all.map(s => s.display_name)).toEqual(['Baseball', 'Jiu-Jitsu', 'Tennis', 'Wrestling']);
  });
  it('a sport is never in both lists, and never in neither', () => {
    for (const favs of [[], ['golf'], ['wrestling', 'baseball', 'golf', 'rowing', 'bjj', 'tennis'], ['golf', 'golf', 'zzz']]) {
      const { favourites, all } = partitionSports(SPORTS, favs, '');
      const keys = [...favourites, ...all].map(s => s.sport_key);
      expect([...keys].sort()).toEqual(SPORTS.map(s => s.sport_key).sort());
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  it('a favourite of a sport that is off stays in All Sports (its locked row), never in Favourites', () => {
    const { favourites, all } = partitionSports(SPORTS, ['tennis'], '');
    expect(favourites).toEqual([]);
    expect(all.find(s => s.sport_key === 'tennis')?.enabled).toBe(false);
  });
  it('taken out of the favourites, a sport is back in its alphabetical place, not at the bottom', () => {
    const { all } = partitionSports(SPORTS, ['rowing'], '');
    expect(all.map(s => s.sport_key)).toEqual(['baseball', 'golf', 'bjj', 'tennis', 'wrestling']);
  });
  it('the query filters both sections; nothing found leaves both empty', () => {
    const hit = partitionSports(SPORTS, ['rowing', 'golf'], '  GoLF ');
    expect(hit.favourites.map(s => s.sport_key)).toEqual(['golf']);
    expect(hit.all).toEqual([]); // the one match lives in Favourites, so All Sports hides
    const both = partitionSports(SPORTS, ['rowing'], 'o'); // rOwing · gOlf
    expect(both.favourites.map(s => s.sport_key)).toEqual(['rowing']);
    expect(both.all.map(s => s.sport_key)).toEqual(['golf']);
    const miss = partitionSports(SPORTS, ['rowing'], 'zzz');
    expect(miss).toEqual({ favourites: [], all: [] });
  });
});

describe('lastUsedSport — the picker\'s LAST tag', () => {
  const SPORTS = [
    { sport_key: 'golf', display_name: 'Golf', enabled: true },
    { sport_key: 'rowing', display_name: 'Rowing', enabled: true },
    { sport_key: 'cricket', display_name: 'Cricket', enabled: false },
  ];
  it('a known, enabled sport is the tag', () => {
    expect(lastUsedSport('golf', SPORTS)).toBe('golf');
  });
  it('general, junk, an unknown key and a sport that is off are no tag', () => {
    for (const raw of ['general', '', 'zzz', 'Golf', null, undefined, 42, {}, 'cricket']) {
      expect(lastUsedSport(raw, SPORTS)).toBeNull();
    }
  });
});

describe('showFavouritesHint — the line that stands in for an empty Favourites section', () => {
  it('only with no favourite shown, no search, and an account that can favourite', () => {
    expect(showFavouritesHint(0, '', true)).toBe(true);
    expect(showFavouritesHint(0, '   ', true)).toBe(true);
    expect(showFavouritesHint(1, '', true)).toBe(false);
    expect(showFavouritesHint(0, 'row', true)).toBe(false);
    expect(showFavouritesHint(0, '', false)).toBe(false);
  });
});

describe('moveOffset — the slide draws a tile back to where it was', () => {
  it('the offset is old place minus new place', () => {
    expect(moveOffset({ left: 10, top: 300 }, { left: 130, top: 60 })).toEqual({ dx: -120, dy: 240 });
  });
  it('a tile that was not there before, or moved under a pixel, does not slide', () => {
    expect(moveOffset(undefined, { left: 0, top: 0 })).toBeNull();
    expect(moveOffset({ left: 10, top: 10 }, { left: 10.4, top: 9.6 })).toBeNull();
  });
  it('the slide is about 200 ms', () => {
    expect(TILE_MOVE_MS).toBe(200);
  });
});
