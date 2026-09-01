import { describe, expect, it } from 'vitest';
import { mapDivisionsByName } from '../rollover-server';

describe('mapDivisionsByName — the clone-forward join key', () => {
  it('maps old to new by exact name', () => {
    const map = mapDivisionsByName(
      [
        { id: 'o1', name: 'U11 A' },
        { id: 'o2', name: 'U13 Girls B' },
      ],
      [
        { id: 'n2', name: 'U13 Girls B' },
        { id: 'n1', name: 'U11 A' },
      ]
    );
    expect(map.get('o1')).toBe('n1');
    expect(map.get('o2')).toBe('n2');
  });

  it('an absent counterpart simply maps nothing (entries for it are dropped)', () => {
    const map = mapDivisionsByName([{ id: 'o1', name: 'U11 A' }], []);
    expect(map.size).toBe(0);
  });

  it('names are unique per season (the DB constraint) — last write is moot but deterministic', () => {
    const map = mapDivisionsByName(
      [{ id: 'o1', name: 'U11 A' }],
      [
        { id: 'nA', name: 'U11 A' },
        { id: 'nB', name: 'U11 A' },
      ]
    );
    // Impossible in a real season (divisions_season_name_uniq); the pure
    // fn stays deterministic anyway: the later entry wins the name map.
    expect(map.get('o1')).toBe('nB');
  });
});
