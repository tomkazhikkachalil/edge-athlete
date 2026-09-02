import { describe, expect, it } from 'vitest';
import { buildCourseStats, selectPublicRounds, type CourseStatsRound } from '../course-stats';

const r = (over: Partial<CourseStatsRound> & { id: string; profileId: string; gross: number }): CourseStatsRound => ({
  date: '2026-09-01',
  tee: 'white',
  holes: 9,
  createdAt: '2026-09-01T10:00:00Z',
  ...over,
});

describe('selectPublicRounds — the two-key rule', () => {
  const rounds = [
    r({ id: 'a', profileId: 'pub', gross: 41 }), // public post + public profile → in
    r({ id: 'b', profileId: 'pub', gross: 38 }), // private post → out
    r({ id: 'c', profileId: 'pub', gross: 44 }), // no post at all → out
    r({ id: 'd', profileId: 'priv', gross: 36 }), // public post, private profile → out
    r({ id: 'e', profileId: 'kid', gross: 35 }), // supervised (excluded upstream) → out
  ];
  it('keeps only rounds with a public post AND a public profile', () => {
    const out = selectPublicRounds(rounds, new Set(['a', 'd', 'e']), new Set(['pub']));
    expect(out.map(x => x.id)).toEqual(['a']);
  });
});

describe('buildCourseStats', () => {
  const names = new Map([
    ['p1', 'Edge A.'],
    ['p2', 'Jane Doe'],
  ]);
  const rounds: CourseStatsRound[] = [
    r({ id: 'r1', profileId: 'p1', gross: 41, date: '2026-08-10' }),
    r({ id: 'r2', profileId: 'p2', gross: 38, date: '2026-08-12', createdAt: '2026-08-12T09:00:00Z' }),
    r({ id: 'r3', profileId: 'p1', gross: 38, date: '2026-08-20' }), // ties r2 — the earlier date holds the record
    r({ id: 'r4', profileId: 'p2', gross: 76, holes: 18, date: '2026-08-25' }),
    r({ id: 'r5', profileId: 'p1', gross: 40, tee: 'gold', date: '2026-09-01' }),
    r({ id: 'r6', profileId: 'p1', gross: 0, date: '2026-09-02' }), // no gross → ignored
    r({ id: 'r7', profileId: 'p1', gross: 60, holes: 12, date: '2026-09-02' }), // odd length → ignored
  ];
  const holes = [
    // hole 3 par 4: strokes 6,6,5,6,5 over five rounds → +1.6
    ...['r1', 'r2', 'r3', 'r4', 'r5'].map((id, i) => ({ roundId: id, hole: 3, par: 4, strokes: [6, 6, 5, 6, 5][i] })),
    // hole 1 par 5: 5,5,5,5,5 → 0
    ...['r1', 'r2', 'r3', 'r4', 'r5'].map(id => ({ roundId: id, hole: 1, par: 5, strokes: 5 })),
    // hole 7: only 4 tracked (below minTracked) + one untracked
    ...['r1', 'r2', 'r3', 'r4'].map(id => ({ roundId: id, hole: 7, par: 3, strokes: 5 })),
    { roundId: 'r5', hole: 7, par: 3, strokes: null },
    // a hole on an ignored round never counts
    { roundId: 'r6', hole: 3, par: 4, strokes: 9 },
  ];

  it('buckets by (holes, tee); nine and eighteen never compete; records tie to the earliest date', () => {
    const s = buildCourseStats({ rounds, holes, nameById: names });
    expect(s.roundsPosted).toBe(5);
    expect(s.byTee.map(b => [b.holes, b.tee, b.rounds, b.avgGross])).toEqual([
      [18, 'white', 1, 76],
      [9, 'white', 3, 39],
      [9, 'gold', 1, 40],
    ]);
    expect(s.courseRecord).toEqual([
      { holes: 18, tee: 'white', gross: 76, date: '2026-08-25', name: 'Jane Doe' },
      { holes: 9, tee: 'white', gross: 38, date: '2026-08-12', name: 'Jane Doe' },
      { holes: 9, tee: 'gold', gross: 40, date: '2026-09-01', name: 'Edge A.' },
    ]);
  });
  it('hardest holes: tracked strokes only, min-N, top 3 by average over par', () => {
    const s = buildCourseStats({ rounds, holes, nameById: names });
    expect(s.hardestHoles).toEqual([
      { hole: 3, par: 4, avgOverPar: 1.6, tracked: 5 },
      { hole: 1, par: 5, avgOverPar: 0, tracked: 5 },
    ]);
    expect(buildCourseStats({ rounds, holes, nameById: names, minTracked: 4 }).hardestHoles[0]).toEqual({
      hole: 7,
      par: 3,
      avgOverPar: 2,
      tracked: 4,
    });
  });
  it('recent rounds: newest first, bounded, named', () => {
    const s = buildCourseStats({ rounds, holes, nameById: names, recent: 3 });
    expect(s.recentRounds.map(x => [x.date, x.gross, x.name])).toEqual([
      ['2026-09-01', 40, 'Edge A.'],
      ['2026-08-25', 76, 'Jane Doe'],
      ['2026-08-20', 38, 'Edge A.'],
    ]);
  });
  it('catalog par fills a holes row without one; empty input → empty stats', () => {
    const s = buildCourseStats({
      rounds: rounds.slice(0, 5),
      holes: ['r1', 'r2', 'r3', 'r4', 'r5'].map(id => ({ roundId: id, hole: 2, par: null, strokes: 6 })),
      nameById: names,
      parByHole: new Map([[2, 4]]),
    });
    expect(s.hardestHoles[0]).toEqual({ hole: 2, par: 4, avgOverPar: 2, tracked: 5 });
    expect(buildCourseStats({ rounds: [], holes: [], nameById: names })).toEqual({
      roundsPosted: 0,
      byTee: [],
      courseRecord: [],
      hardestHoles: [],
      recentRounds: [],
    });
  });
});
