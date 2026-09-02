import { describe, expect, it } from 'vitest';
import { matchRosterName, normalizeName } from '../roster-match';

const roster = [
  { profileId: 'p1', displayName: 'José Núñez' },
  { profileId: 'p2', displayName: 'Jose Nunez' },
  { profileId: 'p3', displayName: "Liam O'Brien" },
  { profileId: 'p4', displayName: 'Ava  Chen' },
];

describe('roster-match', () => {
  it('normalizes diacritics, case and whitespace', () => {
    expect(normalizeName('  José  NÚÑEZ ')).toBe('jose nunez');
    expect(normalizeName("Liam O'Brien")).toBe("liam o'brien");
  });

  it('matches exactly and uniquely; flips "Last, First"', () => {
    expect(matchRosterName('ava chen', roster)).toMatchObject({ ok: true, profileId: 'p4' });
    expect(matchRosterName('Chen, Ava', roster)).toMatchObject({ ok: true, profileId: 'p4' });
    expect(matchRosterName("liam o'brien", roster)).toMatchObject({ ok: true, profileId: 'p3' });
  });

  it('refuses ambiguity and misses — never guesses', () => {
    // José Núñez and Jose Nunez normalize to the same name → ambiguous.
    expect(matchRosterName('Jose Nunez', roster)).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(matchRosterName('Ava', roster)).toEqual({ ok: false, error: 'not found' });
    expect(matchRosterName('', roster)).toEqual({ ok: false, error: 'not found' });
  });
});
