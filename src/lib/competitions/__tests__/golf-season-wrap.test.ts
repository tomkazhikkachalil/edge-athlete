import { describe, expect, it } from 'vitest';
import { buildSeasonSummary, seasonAnnouncement } from '../golf-season-wrap';
import type { PublicGolfWeek } from '../golf-weeks';

const week = (over: Partial<PublicGolfWeek>): PublicGolfWeek => ({
  id: 'w',
  round: 'Week 1',
  holes: 18,
  playFrom: '2026-09-01',
  playTo: '2026-09-07',
  courseName: null,
  status: 'completed',
  state: 'closed',
  participants: 2,
  posted: 2,
  results: [],
  ...over,
});
const rows = [
  { rank: 1, entrant_name: 'Alex A.', playerHandle: 'alex', played: 2, points: 187.5, stats: {} },
  { rank: 2, entrant_name: 'Bo B.', played: 2, points: 162.5, stats: {} },
  { rank: 3, entrant_name: 'Cam C.', played: 0, points: null, stats: {} },
];

describe('buildSeasonSummary', () => {
  it('null while any week is still open, or nothing has been played', () => {
    expect(buildSeasonSummary({ weeks: [week({ state: 'open', status: 'scheduled' })], rows, scoringRule: 'golf_gross' })).toBeNull();
    expect(buildSeasonSummary({ weeks: [week({ results: [] })], rows, scoringRule: 'golf_gross' })).toBeNull();
    expect(buildSeasonSummary({ weeks: [], rows, scoringRule: 'golf_gross' })).toBeNull();
  });

  it('champion, runner-up, most wins (points weeks), best round; a canceled week is ignored', () => {
    const s = buildSeasonSummary({
      weeks: [
        week({
          id: 'w1',
          results: [
            { entrant_name: 'Alex A.', playerHandle: 'alex', gross: 78, net: null, holes: 18, tee: null, status: 'final', disputed: false, points: 100 },
            { entrant_name: 'Bo B.', gross: 82, net: null, holes: 18, tee: null, status: 'final', disputed: false, points: 75 },
          ],
        }),
        week({
          id: 'w2',
          round: 'Week 2',
          results: [
            { entrant_name: 'Alex A.', playerHandle: 'alex', gross: 80, net: null, holes: 18, tee: null, status: 'final', disputed: false, points: 87.5 },
            { entrant_name: 'Bo B.', gross: 76, net: null, holes: 18, tee: null, status: 'final', disputed: false, points: 87.5 },
          ],
        }),
        week({ id: 'w3', round: 'Week 3', status: 'canceled', state: 'upcoming' }),
      ],
      rows,
      scoringRule: 'golf_gross',
    });
    expect(s).toEqual({
      weeksPlayed: 2,
      champion: { name: 'Alex A.', playerHandle: 'alex', points: 187.5 },
      runnerUp: { name: 'Bo B.', points: 162.5 },
      mostWins: { name: 'Alex A.', playerHandle: 'alex', wins: 2 }, // week 2's tie counts for both; Alex has 2
      bestRound: { name: 'Bo B.', gross: 76, round: 'Week 2' },
    });
  });

  it('without points, a week is won on the rule score (net on a net league)', () => {
    const s = buildSeasonSummary({
      weeks: [
        week({
          results: [
            { entrant_name: 'Alex A.', gross: 78, net: 70, holes: 18, tee: null, status: 'final', disputed: false },
            { entrant_name: 'Bo B.', gross: 76, net: 72, holes: 18, tee: null, status: 'final', disputed: false },
          ],
        }),
      ],
      rows: [
        { rank: 1, entrant_name: 'Alex A.', played: 1, points: 70, stats: {} },
        { rank: 2, entrant_name: 'Bo B.', played: 1, points: 72, stats: {} },
      ],
      scoringRule: 'golf_net',
    });
    expect(s?.mostWins).toEqual({ name: 'Alex A.', wins: 1 });
    expect(s?.bestRound).toEqual({ name: 'Bo B.', gross: 76, round: 'Week 1' });
  });
});

describe('seasonAnnouncement', () => {
  it('a self-contained title and message within the announce caps', () => {
    const out = seasonAnnouncement('Thursday Nine', {
      weeksPlayed: 2,
      champion: { name: 'Alex A.', points: 187.5 },
      runnerUp: { name: 'Bo B.', points: 162.5 },
      mostWins: { name: 'Alex A.', wins: 2 },
      bestRound: { name: 'Bo B.', gross: 76, round: 'Week 2' },
    });
    expect(out.title).toBe('Thursday Nine: Alex A. wins the season');
    expect(out.message).toBe(
      'Alex A. takes the Thursday Nine title with 187.5 pts over 2 weeks. Runner-up: Bo B. (162.5 pts). Most wins: Alex A. (2). Best round: Bo B., 76 in Week 2.'
    );
    expect(out.title.length).toBeLessThanOrEqual(80);
    expect(out.message.length).toBeLessThanOrEqual(500);
  });
});
