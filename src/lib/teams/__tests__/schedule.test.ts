import { describe, expect, it } from 'vitest';
import { divisionSchedule, gameResultLine, mergeTeamSchedule, nextGameOf, teamResultLine, type ContestInput, type DivisionEventInput, inGameWindow } from '../schedule';
import type { ContestOutcome } from '@/lib/competitions/contest-outcome';

// Teams & divisions PR 7: a team's schedule from three sources, each game once.

const side = (entryId: string, name: string, score: number | null) => ({ participantId: `p-${entryId}`, entryId, name, score });
const fixture = (home: ReturnType<typeof side>, away: ReturnType<typeof side>, winner: string | null, tie = false): ContestOutcome => ({
  kind: 'fixture', complete: true, home, away, winnerEntryId: winner, tie, scoreline: `${home.score}–${away.score}`,
});
const contest = (over: Partial<ContestInput>): ContestInput => ({
  id: 'c1', competitionName: 'House League', round: null, scheduledAt: '2026-10-03T18:00:00Z', playFrom: null, status: 'scheduled',
  eventId: null, sportEventRoundId: null, myEntryId: 'me', outcome: { kind: 'unscored', complete: false }, href: '/event/c1', ...over,
});

describe('teamResultLine', () => {
  it("reads the score from the team's side — away wins read W with its own score first", () => {
    expect(teamResultLine(fixture(side('them', 'Comets', 2), side('me', 'Blazers', 3), 'me'), 'me')).toEqual({ outcome: 'W', score: '3–2' });
    expect(teamResultLine(fixture(side('me', 'Blazers', 1), side('them', 'Comets', 4), 'them'), 'me')).toEqual({ outcome: 'L', score: '1–4' });
    expect(teamResultLine(fixture(side('me', 'Blazers', 2), side('them', 'Comets', 2), null, true), 'me')).toEqual({ outcome: 'T', score: '2–2' });
  });
  it('unscored, a leaderboard, or an entry not in the fixture → no result', () => {
    expect(teamResultLine(fixture(side('me', 'B', null), side('them', 'C', 1), null), 'me')).toBeNull();
    expect(teamResultLine({ kind: 'unscored', complete: false }, 'me')).toBeNull();
    expect(teamResultLine(fixture(side('x', 'X', 1), side('y', 'Y', 0), 'x'), 'me')).toBeNull();
  });
});

describe('gameResultLine', () => {
  it("side 2's view flips the score; a level game is a T; no score is null", () => {
    expect(gameResultLine(2, 1, 4)).toEqual({ outcome: 'W', score: '4–1' });
    expect(gameResultLine(1, 3, 3)).toEqual({ outcome: 'T', score: '3–3' });
    expect(gameResultLine(1, null, 2)).toBeNull();
  });
});

describe('mergeTeamSchedule', () => {
  const played = contest({ id: 'c-played', status: 'completed', scheduledAt: '2026-09-20T18:00:00Z', eventId: 'cal-mirror', sportEventRoundId: 'round-linked', outcome: fixture(side('me', 'Blazers', 3), side('them', 'Comets', 1), 'me') });
  const next = contest({ id: 'c-next', scheduledAt: '2026-10-10T18:00:00Z', outcome: { kind: 'fixture', complete: false, home: side('them', 'Comets', null), away: side('me', 'Blazers', null), winnerEntryId: null, tie: false, scoreline: null } });
  const out = mergeTeamSchedule({
    contests: [played, next, contest({ id: 'c-gone', status: 'canceled' })],
    calendar: [
      { id: 'cal-mirror', title: 'Mirror', starts_at: '2026-09-20T18:00:00Z', all_day: false, timezone: 'America/Toronto', location: null, status: 'active', href: null },
      { id: 'cal-practice', title: 'Practice', starts_at: '2026-10-01T17:00:00Z', all_day: false, timezone: 'America/Toronto', location: 'Rink 2', status: 'active', href: null },
      { id: 'cal-off', title: 'Off', starts_at: '2026-10-02T17:00:00Z', all_day: false, timezone: null, location: null, status: 'cancelled', href: null },
    ],
    events: [
      { id: 'ev-linked', name: 'Linked game', status: 'completed', startsAt: '2026-09-20T18:00:00Z', date: null, mySide: 1, opponentName: 'Comets', side1Score: 3, side2Score: 1, roundIds: ['round-linked'], timezone: null, href: '/events/ev-linked' },
      { id: 'ev-scrim', name: 'Scrimmage', status: 'completed', startsAt: null, date: '2026-09-25', mySide: 2, opponentName: 'Rockets', side1Score: 2, side2Score: 5, roundIds: ['r9'], timezone: null, href: '/events/ev-scrim' },
    ],
  });

  it('each game once: a calendar mirror and a linked event fold into the contest; cancelled items leave', () => {
    const keys = [...out.upcoming, ...out.results].map(i => i.key);
    expect(keys).not.toContain('calendar:cal-mirror');
    expect(keys).not.toContain('event:ev-linked');
    expect(keys).not.toContain('contest:c-gone');
    expect(keys).not.toContain('calendar:cal-off');
  });
  it('upcoming soonest first; results newest first, each from the team side', () => {
    expect(out.upcoming.map(i => i.key)).toEqual(['calendar:cal-practice', 'contest:c-next']);
    expect(out.upcoming[1].opponent).toBe('Comets');
    // A contest borrows its calendar mirror's zone.
    expect(out.results.find(i => i.key === 'contest:c-played')!.timezone).toBe('America/Toronto');
    expect(out.results.map(i => [i.key, i.result])).toEqual([
      ['event:ev-scrim', { outcome: 'W', score: '5–2' }],
      ['contest:c-played', { outcome: 'W', score: '3–1' }],
    ]);
  });
  it('the items carry names and hrefs — never an entry id, a profile id or an email', () => {
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/"me"|"them"|@|profile/);
  });
});


describe('divisionSchedule', () => {
  const played: ContestOutcome = { kind: 'fixture', complete: true, home: side('h', 'Comets', 2), away: side('a', 'Blazers', 3), winnerEntryId: 'a', tie: false, scoreline: '2–3' };
  const next: ContestOutcome = { kind: 'fixture', complete: false, home: side('h', 'Rockets', null), away: side('a', 'Comets', null), winnerEntryId: null, tie: false, scoreline: null };
  const out = divisionSchedule({
    contests: [
      { id: 'c1', competitionName: 'U13 League', round: 'Week 1', scheduledAt: '2026-09-20T18:00:00Z', playFrom: null, status: 'completed', eventId: 'mirror', outcome: played, href: null },
      { id: 'c2', competitionName: 'U13 League', round: 'Week 2', scheduledAt: '2026-10-04T18:00:00Z', playFrom: null, status: 'scheduled', eventId: null, outcome: next, href: null },
      { id: 'c3', competitionName: 'U13 League', round: null, scheduledAt: null, playFrom: null, status: 'canceled', eventId: null, outcome: next, href: null },
    ],
    calendar: [
      { id: 'mirror', title: 'Mirror', starts_at: '2026-09-20T18:00:00Z', all_day: false, timezone: 'America/Toronto', location: null, status: 'active', href: null },
      { id: 'clinic', title: 'Skills clinic', starts_at: '2026-10-01T17:00:00Z', all_day: false, timezone: 'America/Toronto', location: 'Rink 1', status: 'active', href: null },
    ],
  });
  it('a played game reads home-first with the score; an upcoming one as a pairing; the mirror folds in; cancelled leaves', () => {
    expect(out.results.map(i => i.title)).toEqual(['Comets 2–3 Blazers']);
    expect(out.upcoming.map(i => i.title)).toEqual(['Skills clinic', 'Rockets vs Comets']);
    expect(out.upcoming[1].location).toBe('U13 League · Week 2');
    expect(out.results[0].timezone).toBe('America/Toronto');
    expect(out.results.every(i => i.result === null)).toBe(true);
  });
});

describe('inGameWindow (G1)', () => {
  const NOW = Date.parse('2026-09-28T12:00:00Z');
  it('±60 days of now counts; further out does not; unscheduled counts', () => {
    expect(inGameWindow('2026-10-20T19:00:00Z', NOW)).toBe(true);
    expect(inGameWindow('2026-08-01', NOW)).toBe(true);
    expect(inGameWindow('2027-01-15T19:00:00Z', NOW)).toBe(false);
    expect(inGameWindow('2026-06-01', NOW)).toBe(false);
    expect(inGameWindow(null, NOW)).toBe(true);
  });
});

describe('G4 — sport-event games and the sides as data', () => {
  const ev = (over: Partial<DivisionEventInput>): DivisionEventInput => ({
    id: 'e1', name: 'Scrimmage', status: 'open', startsAt: '2026-10-05T18:00:00Z', date: null, side1Name: 'Hawks', side2Name: 'Storm',
    side1Score: null, side2Score: null, roundIds: ['r1'], timezone: null, href: '/events/e1', teamIds: ['t1', 't2'], ...over,
  });

  it('a division folds its teams’ games: home-first, scored once final, tagged with its teams; a contest-linked one folds away', () => {
    const out = divisionSchedule({
      calendar: [],
      contests: [{ id: 'c1', competitionName: 'Cup', round: null, scheduledAt: '2026-10-01T18:00:00Z', playFrom: null, status: 'scheduled', eventId: null, sportEventRoundId: 'r-linked', outcome: { kind: 'unscored', complete: false }, href: null }],
      events: [
        ev({}),
        ev({ id: 'e2', status: 'completed', startsAt: '2026-09-20T18:00:00Z', side1Score: 4, side2Score: 1, roundIds: ['r2'] }),
        ev({ id: 'e3', roundIds: ['r-linked'] }),
        ev({ id: 'e4', status: 'cancelled', roundIds: ['r4'] }),
      ],
    });
    const keys = [...out.upcoming, ...out.results].map(i => i.key);
    expect(keys).not.toContain('event:e3');
    expect(keys).not.toContain('event:e4');
    const upcoming = out.upcoming.find(i => i.key === 'event:e1')!;
    expect(upcoming.title).toBe('Hawks vs Storm');
    expect(upcoming.location).toBe('Scrimmage');
    expect(upcoming.teamIds).toEqual(['t1', 't2']);
    expect(upcoming.pair).toEqual({ home: 'Hawks', away: 'Storm', homeScore: null, awayScore: null });
    expect(out.results[0].title).toBe('Hawks 4–1 Storm');
    expect(out.results[0].pair).toEqual({ home: 'Hawks', away: 'Storm', homeScore: 4, awayScore: 1 });
  });

  it('a game with an unnamed side reads its event name and carries no pair', () => {
    const out = divisionSchedule({ calendar: [], contests: [], events: [ev({ side2Name: null })] });
    expect(out.upcoming[0].title).toBe('Scrimmage');
    expect(out.upcoming[0].pair).toBeUndefined();
  });

  it('a team’s items carry the sides: a contest from its outcome, an event from the team’s side (side 1 = home)', () => {
    const out = mergeTeamSchedule({
      calendar: [],
      contests: [contest({ id: 'c-next', outcome: { kind: 'fixture', complete: false, home: side('them', 'Comets', null), away: side('me', 'Blazers', null), winnerEntryId: null, tie: false, scoreline: null } })],
      events: [
        { id: 'e-away', name: 'Friendly', status: 'live', startsAt: '2026-10-02T18:00:00Z', date: null, mySide: 2, opponentName: 'Rockets', myName: 'Blazers', side1Score: 1, side2Score: 2, roundIds: ['r'], timezone: null, href: null },
        { id: 'e-anon', name: 'Pickup', status: 'open', startsAt: '2026-10-04T18:00:00Z', date: null, mySide: 1, opponentName: null, myName: 'Blazers', side1Score: null, side2Score: null, roundIds: ['r2'], timezone: null, href: null },
      ],
    });
    const byKey = new Map(out.upcoming.map(i => [i.key, i]));
    expect(byKey.get('contest:c-next')!.pair).toEqual({ home: 'Comets', away: 'Blazers', homeScore: null, awayScore: null });
    expect(byKey.get('event:e-away')!.pair).toEqual({ home: 'Rockets', away: 'Blazers', homeScore: 1, awayScore: 2 });
    expect(byKey.get('event:e-anon')!.pair).toBeUndefined();
  });

  it('nextGameOf: the soonest game — never a practice on the calendar; none → null', () => {
    const out = mergeTeamSchedule({
      calendar: [{ id: 'p', title: 'Practice', starts_at: '2026-10-01T17:00:00Z', all_day: false, timezone: null, location: null, status: 'active', href: null }],
      contests: [contest({ id: 'c-next', scheduledAt: '2026-10-03T18:00:00Z' })],
      events: [],
    });
    expect(nextGameOf(out)?.key).toBe('contest:c-next');
    expect(nextGameOf({ upcoming: out.upcoming.filter(i => i.kind === 'calendar') })).toBeNull();
  });
});
