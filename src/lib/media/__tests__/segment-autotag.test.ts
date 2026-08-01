import { describe, it, expect } from 'vitest';
import { inferSegment, segmentTimesFromScores, type SegmentTime } from '../segment-autotag';

const MIN = 60 * 1000;
const T0 = Date.parse('2026-08-01T09:00:00Z');

/** A round genuinely played over time — 18 holes, ~10 minutes apart. */
const playedRound = (): SegmentTime[] =>
  Array.from({ length: 18 }, (_, i) => ({ segment: i + 1, atMs: T0 + i * 10 * MIN }));

describe('inferSegment — the happy path', () => {
  it('picks the nearest segment to the capture time', () => {
    // Hole 5 was scored at T0+40min; a photo at T0+42min is hole 5's.
    expect(inferSegment(T0 + 42 * MIN, playedRound())).toEqual({ segment: 5, confidence: 'high' });
  });

  it('matches a photo taken BEFORE its hole was scored', () => {
    // A tee shot is photographed before the score is written — "nearest",
    // not "last one before", is what makes this work.
    expect(inferSegment(T0 + 38 * MIN, playedRound()).segment).toBe(5);
  });

  it('matches the first and last segments', () => {
    expect(inferSegment(T0, playedRound()).segment).toBe(1);
    expect(inferSegment(T0 + 170 * MIN, playedRound()).segment).toBe(18);
  });

  it('is stable for a capture exactly between two segments', () => {
    // T0+5min sits equidistant from hole 1 and hole 2; the earlier wins, and
    // does so consistently rather than depending on iteration order.
    const r1 = inferSegment(T0 + 5 * MIN, playedRound());
    const r2 = inferSegment(T0 + 5 * MIN, [...playedRound()].reverse());
    expect(r1.segment).toBe(1);
    expect(r2.segment).toBe(1);
  });
});

describe('inferSegment — the retrospective-round guard', () => {
  it('refuses to guess when the whole card was entered at once', () => {
    // THE HIGHEST-VALUE CASE. Every hole stamped within seconds means the
    // timestamps carry no positional information; matching against them would
    // produce a confident, arbitrary answer.
    const enteredAtOnce = Array.from({ length: 18 }, (_, i) => ({
      segment: i + 1,
      atMs: T0 + i * 800, // ~14s across the whole card
    }));
    const out = inferSegment(T0 + 5 * MIN, enteredAtOnce);
    expect(out.segment).toBeNull();
    expect(out.reason).toBe('entered-at-once');
  });

  it('scales the guard to the round length, so a short round is not misjudged', () => {
    // 3 holes over 20 minutes is genuinely played, and must NOT trip the guard
    // just because the total span is small.
    const shortRound = [
      { segment: 1, atMs: T0 },
      { segment: 2, atMs: T0 + 10 * MIN },
      { segment: 3, atMs: T0 + 20 * MIN },
    ];
    expect(inferSegment(T0 + 11 * MIN, shortRound).segment).toBe(2);
  });

  it('still trips for a short round entered in one go', () => {
    const shortAtOnce = [
      { segment: 1, atMs: T0 },
      { segment: 2, atMs: T0 + 2000 },
      { segment: 3, atMs: T0 + 4000 },
    ];
    expect(inferSegment(T0 + 1000, shortAtOnce).reason).toBe('entered-at-once');
  });
});

describe('inferSegment — declining to guess', () => {
  it('declines for a capture from outside the round', () => {
    expect(inferSegment(T0 - 5 * 60 * MIN, playedRound()).reason).toBe('outside-round');
    expect(inferSegment(T0 + 40 * 60 * MIN, playedRound()).reason).toBe('outside-round');
  });

  it('declines when the nearest segment is still too far away', () => {
    // A gap in play — nothing scored for two hours mid-round.
    const gappy = [
      { segment: 1, atMs: T0 },
      { segment: 2, atMs: T0 + 200 * MIN },
    ];
    const out = inferSegment(T0 + 100 * MIN, gappy);
    expect(out.segment).toBeNull();
    expect(out.reason).toBe('too-far');
  });

  it('honours a custom maxGap', () => {
    expect(inferSegment(T0 + 45 * MIN, playedRound(), { maxGapMs: 60 * 1000 }).reason)
      .toBe('too-far');
    expect(inferSegment(T0 + 45 * MIN, playedRound(), { maxGapMs: 60 * MIN }).segment).toBe(5);
  });

  it('declines on missing or unusable input rather than throwing', () => {
    expect(inferSegment(null, playedRound()).reason).toBe('no-data');
    expect(inferSegment(undefined, playedRound()).reason).toBe('no-data');
    expect(inferSegment(NaN, playedRound()).reason).toBe('no-data');
    expect(inferSegment(T0, []).reason).toBe('no-data');
    expect(inferSegment(T0, null).reason).toBe('no-data');
    expect(inferSegment(T0, [{ segment: 1, atMs: NaN }]).reason).toBe('no-data');
  });

  it('NEVER returns high confidence without a segment', () => {
    // The caller preselects on 'high'; the two must never disagree.
    for (const out of [
      inferSegment(null, playedRound()),
      inferSegment(T0 - 999 * MIN, playedRound()),
      inferSegment(T0, [{ segment: 1, atMs: T0 }, { segment: 2, atMs: T0 + 1000 }]),
    ]) {
      if (out.confidence === 'high') expect(out.segment).not.toBeNull();
      else expect(out.segment).toBeNull();
    }
  });
});

describe('segmentTimesFromScores', () => {
  it('builds a timeline sorted by segment', () => {
    expect(
      segmentTimesFromScores([
        { hole_number: 3, created_at: '2026-08-01T09:30:00Z' },
        { hole_number: 1, created_at: '2026-08-01T09:00:00Z' },
      ])
    ).toEqual([
      { segment: 1, atMs: Date.parse('2026-08-01T09:00:00Z') },
      { segment: 3, atMs: Date.parse('2026-08-01T09:30:00Z') },
    ]);
  });

  it('keeps the EARLIEST stamp per segment, so a later edit does not move it', () => {
    const out = segmentTimesFromScores([
      { hole_number: 1, created_at: '2026-08-01T12:00:00Z' },
      { hole_number: 1, created_at: '2026-08-01T09:00:00Z' },
    ]);
    expect(out).toEqual([{ segment: 1, atMs: Date.parse('2026-08-01T09:00:00Z') }]);
  });

  it('skips rows with no hole or an unparseable date', () => {
    expect(
      segmentTimesFromScores([
        { hole_number: null, created_at: '2026-08-01T09:00:00Z' },
        { hole_number: 2, created_at: null },
        { hole_number: 3, created_at: 'not a date' },
      ])
    ).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(segmentTimesFromScores([])).toEqual([]);
    expect(segmentTimesFromScores(null)).toEqual([]);
    expect(segmentTimesFromScores(undefined)).toEqual([]);
  });
});
