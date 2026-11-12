import { describe, it, expect } from 'vitest';
import { COVERAGE_COPY, gameHasSides, gameShowsScore, gameTitleLine, parseGameBody, parseGameDay, sideLabel } from '../game-rules';

/** The game on a linked video (Sprint 3 PR 2, 307): what a manager may save, and what the screen says. */
const TODAY = '2026-11-12';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

describe('parseGameBody', () => {
  it('the smallest game is a sport: highlights only, no spoilers, no sides, no day', () => {
    expect(parseGameBody({ sport_key: 'basketball' }, TODAY)).toEqual({
      ok: true,
      value: { sport_key: 'basketball', played_on: null, side1: { name: null, team_id: null }, side2: { name: null, team_id: null }, coverage: 'highlights', stats_hidden: true },
    });
  });
  it('a full game: names trimmed and single-spaced, teams, the day, the switches', () => {
    const r = parseGameBody({ sport_key: 'soccer', played_on: '2026-10-31', side1: { name: '  Maple   Ridge ', team_id: T1 }, side2: { name: 'Riverside', team_id: T2 }, coverage: 'full', stats_hidden: false }, TODAY);
    expect(r).toEqual({ ok: true, value: { sport_key: 'soccer', played_on: '2026-10-31', side1: { name: 'Maple Ridge', team_id: T1 }, side2: { name: 'Riverside', team_id: T2 }, coverage: 'full', stats_hidden: false } });
  });
  it('a sport needs a sheet — an unknown one, a missing one, are refused', () => {
    expect(parseGameBody({ sport_key: 'curling' }, TODAY)).toEqual({ ok: false, error: 'Choose the sport' });
    expect(parseGameBody({}, TODAY)).toEqual({ ok: false, error: 'Choose the sport' });
    expect(parseGameBody(null, TODAY).ok).toBe(false);
    expect(parseGameBody([], TODAY).ok).toBe(false);
  });
  it('unknown fields are refused, at the top and inside a side', () => {
    expect(parseGameBody({ sport_key: 'soccer', score: 3 }, TODAY)).toEqual({ ok: false, error: 'Unknown field score' });
    expect(parseGameBody({ sport_key: 'soccer', side1: { name: 'A', logo: 'x' } }, TODAY)).toEqual({ ok: false, error: 'Unknown field side1.logo' });
  });
  it('a side: a name of 80 at most, a team id that is one, never the same team twice; an empty name is no name', () => {
    expect(parseGameBody({ sport_key: 'soccer', side1: { name: 'x'.repeat(81) } }, TODAY).ok).toBe(false);
    expect(parseGameBody({ sport_key: 'soccer', side1: { team_id: 'nope' } }, TODAY).ok).toBe(false);
    expect(parseGameBody({ sport_key: 'soccer', side1: { team_id: T1 }, side2: { team_id: T1 } }, TODAY)).toEqual({ ok: false, error: 'The two sides cannot be the same team' });
    const r = parseGameBody({ sport_key: 'soccer', side1: { name: '   ' } }, TODAY);
    expect(r.ok && r.value.side1.name).toBeNull();
  });
  it('coverage and the spoiler switch are checked', () => {
    expect(parseGameBody({ sport_key: 'soccer', coverage: 'some' }, TODAY).ok).toBe(false);
    expect(parseGameBody({ sport_key: 'soccer', stats_hidden: 'yes' }, TODAY).ok).toBe(false);
  });
});

describe('parseGameDay', () => {
  it('a real day within range, or none', () => {
    expect(parseGameDay('2026-11-12', TODAY)).toEqual({ ok: true, value: '2026-11-12' });
    expect(parseGameDay('', TODAY)).toEqual({ ok: true, value: null });
    expect(parseGameDay(null, TODAY)).toEqual({ ok: true, value: null });
    expect(parseGameDay('2027-11-12', TODAY).ok).toBe(true); // a scheduled game, a year out at most
  });
  it('not a day, a day that does not exist, out of range', () => {
    expect(parseGameDay('12/11/2026', TODAY).ok).toBe(false);
    expect(parseGameDay('2026-02-30', TODAY)).toEqual({ ok: false, error: 'That date does not exist' });
    expect(parseGameDay('1899-12-31', TODAY).ok).toBe(false);
    expect(parseGameDay('2027-11-13', TODAY).ok).toBe(false);
    expect(parseGameDay(20261112, TODAY).ok).toBe(false);
  });
});

describe('what the screen says', () => {
  const g = (sport_key: string, a: string | null, b: string | null, coverage: 'highlights' | 'full' = 'highlights') => ({ sport_key, side1: { name: a, team_id: null }, side2: { name: b, team_id: null }, coverage });
  it('the sides by name, else the sport\'s noun and the number', () => {
    expect(gameTitleLine(g('basketball', 'Lakers', 'Celtics'))).toBe('Lakers vs Celtics');
    expect(gameTitleLine(g('basketball', null, 'Celtics'))).toBe('Team 1 vs Celtics');
    expect(sideLabel(g('mma', null, null), 2)).toBe('Fighter 2');
  });
  it('a race and a golf round have no sides', () => {
    expect(gameHasSides('running')).toBe(false);
    expect(gameHasSides('golf')).toBe(false);
    expect(gameHasSides('wrestling')).toBe(true);
    expect(gameTitleLine(g('running', null, null))).toBe('Race');
  });
  it('a score is claimed only when every scoring play is tagged AND the sport keeps a board', () => {
    expect(gameShowsScore(g('basketball', null, null, 'highlights'))).toBe(false);
    expect(gameShowsScore(g('basketball', null, null, 'full'))).toBe(true);
    expect(gameShowsScore(g('mma', null, null, 'full'))).toBe(false);
    expect(gameShowsScore(g('volleyball', null, null, 'full'))).toBe(true);
  });
  it('both coverage choices explain themselves', () => {
    expect(COVERAGE_COPY.highlights.note).toContain('No score');
    expect(COVERAGE_COPY.full.note).toContain('built from the tags');
  });
});
