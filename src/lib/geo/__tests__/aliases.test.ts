import { describe, expect, it } from 'vitest';
import { foldAlias, selectPlaceAliases } from '../aliases';

describe('foldAlias', () => {
  it('matches the SQL search_normalize shape', () => {
    expect(foldAlias('Montréal')).toBe('montreal');
    expect(foldAlias("  Sant Julià de  Lòria ")).toBe("sant julia de loria");
    expect(foldAlias('New York/NYC')).toBe('new york nyc');
  });
});

describe('selectPlaceAliases', () => {
  const nyc =
    'Big Apple,NYC,New York,City of New York,Nueva York,Нью-Йорк,ニューヨーク,نيويورك,New York City,new york city,Novum Eboracum,Ню Йорк';

  it('keeps Latin-script aliases, drops the place’s own names and other scripts, related names first', () => {
    const out = selectPlaceAliases('New York City', 'New York City', nyc);
    // Name-related aliases first (they share "new"/"york"), then the rest shortest-first.
    expect(out).toEqual(['New York', 'Nueva York', 'City of New York', 'NYC', 'Big Apple', 'Novum Eboracum']);
  });

  it('folds accents for dedupe but keeps a readable form', () => {
    const out = selectPlaceAliases('Montréal', 'Montreal', 'Monreal,Monréal,Mont-real,Монреаль,Montreal');
    expect(out).toEqual(['Monreal', 'Mont-real']);
  });

  it('caps per place and ignores junk', () => {
    const many = Array.from({ length: 80 }, (_, i) => `Alias ${String(i).padStart(2, '0')}`).join(',');
    expect(selectPlaceAliases('X', null, many)).toHaveLength(60);
    expect(selectPlaceAliases('X', null, ',,a,,')).toEqual([]);
    expect(selectPlaceAliases('X', null, null)).toEqual([]);
  });
});
