import { describe, expect, it } from 'vitest';
import { buildPointsRace } from '../golf-race';
import { buildGolfBlock } from '../golf-weeks';

const contests = [
  { id: 'w1', round: 'Week 1', status: 'completed', play_from: '2026-09-01' },
  { id: 'w2', round: 'Week 2', status: 'completed', play_from: '2026-09-08' },
  { id: 'w3', round: 'Week 3', status: 'scheduled', play_from: '2026-09-15' },
];
const participants = [
  { id: 'p1a', contest_id: 'w1', entry_id: 'a' },
  { id: 'p1b', contest_id: 'w1', entry_id: 'b' },
  { id: 'p2a', contest_id: 'w2', entry_id: 'a' },
  { id: 'p2b', contest_id: 'w2', entry_id: 'b' },
  { id: 'p3a', contest_id: 'w3', entry_id: 'a' },
];
const names = new Map([['a', 'Alex A.'], ['b', 'Bo B.'], ['c', 'Cam C.']]);

describe('buildPointsRace', () => {
  it('weekly points, running totals, rank after each week, movement into the latest; open weeks excluded', () => {
    const race = buildPointsRace({
      contests,
      participants,
      results: [
        { contest_id: 'w1', participant_id: 'p1a', score: 78 },
        { contest_id: 'w1', participant_id: 'p1b', score: 82 },
        { contest_id: 'w2', participant_id: 'p2a', score: 80 },
        { contest_id: 'w2', participant_id: 'p2b', score: 80 },
      ],
      preset: 'pga',
      entryName: names,
      omittedEntries: new Set(),
    });
    expect(race?.weeks.map(w => w.round)).toEqual(['Week 1', 'Week 2']);
    expect(race?.rows.map(r => [r.entrant_name, r.weekly, r.cumulative, r.rank, r.total, r.movement])).toEqual([
      ['Alex A.', [100, 87.5], [100, 187.5], [1, 1], 187.5, 0],
      ['Bo B.', [75, 87.5], [75, 162.5], [2, 2], 162.5, 0],
    ]);
  });

  it('a lead change reads as movement; an unscored week is null and keeps the total', () => {
    const race = buildPointsRace({
      contests: [
        ...contests.slice(0, 2),
        { id: 'w3', round: 'Week 3', status: 'completed', play_from: '2026-09-15' },
      ],
      participants: [...participants, { id: 'p3b', contest_id: 'w3', entry_id: 'b' }],
      results: [
        { contest_id: 'w1', participant_id: 'p1a', score: 78 },
        { contest_id: 'w1', participant_id: 'p1b', score: 82 },
        { contest_id: 'w2', participant_id: 'p2b', score: 80 }, // Alex skipped week 2
        { contest_id: 'w3', participant_id: 'p3a', score: 81 },
        { contest_id: 'w3', participant_id: 'p3b', score: 76 },
      ],
      preset: 'pga',
      entryName: names,
      omittedEntries: new Set(),
    });
    const bo = race!.rows.find(r => r.entrant_name === 'Bo B.')!;
    const alex = race!.rows.find(r => r.entrant_name === 'Alex A.')!;
    expect(alex.weekly).toEqual([100, null, 75]);
    expect(alex.cumulative).toEqual([100, 100, 175]);
    expect(bo.weekly).toEqual([75, 100, 100]);
    expect(bo.rank).toEqual([2, 1, 1]);
    expect(alex.rank).toEqual([1, 2, 2]);
    expect(bo.movement).toBe(0);
    expect(alex.movement).toBe(0);
    expect(race!.rows[0].entrant_name).toBe('Bo B.');
  });

  it('DIVERGENCE PIN: a supervised entrant is awarded (the full field) then omitted — the others keep the table\'s points', () => {
    const input = {
      contests: contests.slice(0, 1),
      participants: [...participants.slice(0, 2), { id: 'p1c', contest_id: 'w1', entry_id: 'c' }],
      results: [
        { contest_id: 'w1', participant_id: 'p1c', score: 70 },
        { contest_id: 'w1', participant_id: 'p1a', score: 78 },
        { contest_id: 'w1', participant_id: 'p1b', score: 82 },
      ],
      preset: 'pga' as const,
      entryName: names,
      omittedEntries: new Set(['c']),
    };
    const race = buildPointsRace(input);
    expect(race?.rows.map(r => [r.entrant_name, r.weekly[0], r.rank[0]])).toEqual([
      ['Alex A.', 75, 2],
      ['Bo B.', 60, 3],
    ]);
    // …and the public week block agrees (award before omission).
    const block = buildGolfBlock({
      contests: [{ id: 'w1', round: 'Week 1', status: 'completed', venue_id: null, holes: 18, play_from: '2026-09-01', play_to: '2026-09-07' }],
      participants: input.participants,
      results: input.results.map(r => ({ ...r, payload: { gross: r.score, holes: 18 }, provenance: 'league_verified', dispute_status: null })),
      entryName: names,
      omittedEntries: new Set(['c']),
      courseNameByVenue: new Map(),
      pick: 'first',
      scoringRule: 'golf_gross',
      pointsPreset: 'pga',
      today: '2026-09-10',
    });
    expect(block?.weeks[0].results.map(r => [r.entrant_name, r.points])).toEqual([
      ['Alex A.', 75],
      ['Bo B.', 60],
    ]);
    expect(block?.weeks[0].posted).toBe(3);
  });

  it('nothing completed → null; a public handle rides the row', () => {
    expect(buildPointsRace({ contests: [contests[2]], participants, results: [], preset: 'pga', entryName: names, omittedEntries: new Set() })).toBeNull();
    const race = buildPointsRace({
      contests: contests.slice(0, 1),
      participants: participants.slice(0, 2),
      results: [{ contest_id: 'w1', participant_id: 'p1a', score: 78 }],
      preset: 'linear',
      entryName: names,
      omittedEntries: new Set(),
      entryHandle: new Map([['a', 'alex']]),
    });
    expect(race?.rows[0]).toMatchObject({ entrant_name: 'Alex A.', playerHandle: 'alex', weekly: [1], rank: [1], movement: null });
    expect(race?.rows[1]).toMatchObject({ entrant_name: 'Bo B.', weekly: [null], rank: [null], total: 0 });
    expect('playerHandle' in race!.rows[1]).toBe(false);
  });
});
