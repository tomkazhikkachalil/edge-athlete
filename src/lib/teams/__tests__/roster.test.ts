import { describe, expect, it } from 'vitest';
import { isCurrentTeamRow, pickRosterSeason, planCarry, planTeamAdd } from '../roster';

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


describe('isCurrentTeamRow', () => {
  const archived = new Set(['old']);
  it('a live season or a legacy season-less row counts; an archived season does not', () => {
    expect(isCurrentTeamRow({ status: 'active', season_id: 'new' }, archived)).toBe(true);
    expect(isCurrentTeamRow({ status: 'active', season_id: null }, archived)).toBe(true);
    expect(isCurrentTeamRow({ status: 'active', season_id: 'old' }, archived)).toBe(false);
  });
  it('only active / placed count', () => {
    expect(isCurrentTeamRow({ status: 'placed', season_id: 'new' }, archived)).toBe(true);
    expect(isCurrentTeamRow({ status: 'pending', season_id: 'new' }, archived)).toBe(false);
    expect(isCurrentTeamRow({ status: 'released', season_id: 'new' }, archived)).toBe(false);
  });
});

describe('planTeamAdd', () => {
  it('a member on the roster may go on a team', () => {
    expect(planTeamAdd({ followRole: 'member', orgRosterStatuses: ['active'] })).toBe('ok');
    expect(planTeamAdd({ followRole: 'member', orgRosterStatuses: ['released', 'placed'] })).toBe('ok');
  });
  it('a non-member is refused; a member off the roster (or only offered) needs the roster first', () => {
    expect(planTeamAdd({ followRole: null, orgRosterStatuses: ['active'] })).toBe('not_member');
    expect(planTeamAdd({ followRole: 'member', orgRosterStatuses: [] })).toBe('needs_org_roster');
    expect(planTeamAdd({ followRole: 'member', orgRosterStatuses: ['pending'] })).toBe('needs_org_roster');
  });
});

describe('planCarry', () => {
  const row = (profile_id: string, scope_id: string, season_id: string | null, status = 'active') => ({ profile_id, scope_id, season_id, status });
  it("the chosen teams' current players, each once; other teams, other seasons and released rows stay behind", () => {
    const rows = [
      row('a', 'blazers', 's-old'),
      row('a', 'blazers', null), // a legacy twin of the same spot
      row('b', 'blazers', 's-old', 'placed'),
      row('c', 'blazers', 's-older'),
      row('d', 'blazers', 's-old', 'released'),
      row('e', 'comets', 's-old'),
    ];
    expect(planCarry(rows, { teamIds: ['blazers'], closingSeasonId: 's-old' })).toEqual([
      { profileId: 'a', teamId: 'blazers' },
      { profileId: 'b', teamId: 'blazers' },
    ]);
  });
  it('no team chosen carries nothing', () => {
    expect(planCarry([row('a', 'blazers', 's-old')], { teamIds: [], closingSeasonId: 's-old' })).toEqual([]);
  });
});
