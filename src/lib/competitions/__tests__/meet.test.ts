import { describe, expect, it } from 'vitest';
import { MEET_EVENTS_TRACK } from '@/lib/sports/competition-profiles';
import { computeMeetStandings, formatMark, meetEventFor, meetIndividualLeaders, parseMark, parseMeetConfig, placeEvent } from '../meet';

describe('marks', () => {
  it('parses seconds, m:ss.xx, metres; refuses nonsense', () => {
    expect(parseMark('11.85')).toBe(11.85);
    expect(parseMark('4:05.30')).toBeCloseTo(245.3, 5);
    expect(parseMark('6.42m')).toBe(6.42);
    expect(parseMark(' 12s ')).toBe(12);
    expect(parseMark('fast')).toBeNull();
    expect(parseMark('')).toBeNull();
    expect(formatMark(245.3, 's')).toBe('4:05.30');
    expect(formatMark(6.4, 'm')).toBe('6.40m');
  });
  it('the config: a non-increasing list of ≤ 16 points, else the default', () => {
    expect(parseMeetConfig(null).points).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(parseMeetConfig({ meet: { points: [5, 3, 1] } }).points).toEqual([5, 3, 1]);
    expect(parseMeetConfig({ meet: { points: [1, 3] } }).points).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(parseMeetConfig({ meet: { points: [] } }).points).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
  });
  it('finds the event by the round label or the results key', () => {
    expect(meetEventFor(MEET_EVENTS_TRACK, { round: '200m' })?.key).toBe('time_200m');
    expect(meetEventFor(MEET_EVENTS_TRACK, { round: 'Sprint', eventKey: 'time_100m' })?.key).toBe('time_100m');
    expect(meetEventFor(MEET_EVENTS_TRACK, { round: 'Sprint' })).toBeNull();
  });
});

describe('placeEvent — by direction, ties share, a DQ or no mark unranked', () => {
  it('a race ascends; a throw descends', () => {
    expect(placeEvent([{ entryId: 'a', mark: 12 }, { entryId: 'b', mark: 11.5 }, { entryId: 'c', mark: 12 }, { entryId: 'd', mark: null }, { entryId: 'e', mark: 10, dq: true }], 'asc').map(p => [p.entryId, p.place])).toEqual([['b', 1], ['a', 2], ['c', 2], ['d', null], ['e', null]]);
    expect(placeEvent([{ entryId: 'a', mark: 6.1 }, { entryId: 'b', mark: 6.4 }], 'desc').map(p => [p.entryId, p.place])).toEqual([['b', 1], ['a', 2]]);
  });
});

describe('computeMeetStandings — the affiliation roll-up as team entries', () => {
  const teams = [{ id: 'T1', teamId: 'red' }, { id: 'T2', teamId: 'blue' }];
  const athletes = [{ id: 'a', affiliationTeamId: 'red' }, { id: 'b', affiliationTeamId: 'blue' }, { id: 'c', affiliationTeamId: 'red' }, { id: 'u', affiliationTeamId: null }];
  it('sums the points of the places per affiliation over completed events; an unattached athlete scores for nobody', () => {
    const rows = computeMeetStandings(teams, athletes, [
      { id: 'e1', status: 'completed', direction: 'asc', results: [{ entryId: 'a', mark: 11 }, { entryId: 'b', mark: 12 }, { entryId: 'u', mark: 10 }] },
      { id: 'e2', status: 'completed', direction: 'asc', results: [{ entryId: 'b', mark: 22 }, { entryId: 'c', mark: 23 }, { entryId: 'a', mark: 24, dq: true }] },
      { id: 'e3', status: 'scheduled', direction: 'asc', results: [{ entryId: 'b', mark: 1 }] },
    ], { points: [10, 8, 6] });
    // e1: u 1st (nobody), a 2nd (8, red), b 3rd (6, blue). e2: b 1st (10, blue), c 2nd (8, red), a DQ.
    // 16 each; blue holds the gold → blue first.
    expect(rows.map(r => [r.entry_id, r.rank, r.points])).toEqual([['T2', 1, 16], ['T1', 2, 16]]);
  });
  it('medals break the points tie; the leaders list formats marks', () => {
    const rows = computeMeetStandings(teams, athletes, [
      { id: 'e1', status: 'completed', direction: 'asc', results: [{ entryId: 'a', mark: 11 }, { entryId: 'b', mark: 12 }] },
      { id: 'e2', status: 'completed', direction: 'asc', results: [{ entryId: 'b', mark: 22 }, { entryId: 'c', mark: 23 }] },
    ], { points: [10, 8] });
    expect(rows.map(r => [r.entry_id, r.rank, r.points, r.stats.golds])).toEqual([['T1', 1, 18, 1], ['T2', 1, 18, 1]]);
    const leaders = meetIndividualLeaders({ id: 'e1', status: 'completed', direction: 'asc', results: [{ entryId: 'a', mark: 245.3 }, { entryId: 'b', mark: null }] }, 's', id => id.toUpperCase());
    expect(leaders).toEqual([{ entryId: 'a', name: 'A', place: 1, mark: '4:05.30', dq: false }, { entryId: 'b', name: 'B', place: null, mark: null, dq: false }]);
  });
});
