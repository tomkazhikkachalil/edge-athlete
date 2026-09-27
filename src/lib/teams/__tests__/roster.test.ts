import { describe, expect, it } from 'vitest';
import { pickRosterSeason } from '../roster';

// A team roster row names its season (242). The pick is the backfill's rule.

const s = (id: string, created_at: string, archived_at: string | null = null) => ({ id, created_at, archived_at });

describe('pickRosterSeason', () => {
  const seasons = [s('old', '2025-09-01T00:00:00Z'), s('new', '2026-09-01T00:00:00Z'), s('gone', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z')];

  it("the newest live season the team is entered in wins over the org's newest", () => {
    expect(pickRosterSeason(seasons, new Set(['old']))).toBe('old');
  });
  it("no entry → the org's newest LIVE season (an archived one never)", () => {
    expect(pickRosterSeason(seasons, new Set())).toBe('new');
    expect(pickRosterSeason(seasons, new Set(['gone']))).toBe('new');
  });
  it('no live season at all → null (the caller refuses)', () => {
    expect(pickRosterSeason([s('gone', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z')], new Set(['gone']))).toBeNull();
    expect(pickRosterSeason([], new Set())).toBeNull();
  });
});
