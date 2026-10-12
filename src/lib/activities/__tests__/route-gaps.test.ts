import { describe, expect, it } from 'vitest';
import { gapBetween, splitAtGaps } from '../record/route-gaps';
import type { ActivityPoint } from '../types';

// Resume pill program (Oct 12 2026): the live route breaks where the app
// could not record, with a straight dashed bridge across the gap.

const T0 = Date.UTC(2026, 9, 12, 14, 0, 0);
const pt = (s: number, m: number): ActivityPoint => ({ t: T0 + s * 1000, lat: 43.65 + m / 111_195, lng: -79.38 });

describe('gapBetween', () => {
  it('a gap that falls between two fixes breaks the line; one elsewhere, or of zero length, does not', () => {
    const gaps = [{ fromMs: T0 + 10_000, toMs: T0 + 50_000 }];
    expect(gapBetween(pt(9, 0), pt(51, 0), gaps)).toBe(true);
    expect(gapBetween(pt(60, 0), pt(61, 0), gaps)).toBe(false);
    expect(gapBetween(pt(0, 0), pt(1, 0), gaps)).toBe(false);
    expect(gapBetween(pt(9, 0), pt(51, 0), [{ fromMs: T0 + 20_000, toMs: T0 + 20_000 }])).toBe(false);
    expect(gapBetween(pt(9, 0), pt(51, 0), [])).toBe(false);
  });
  it('an open gap (the page is hidden now) breaks the line after its start', () => {
    expect(gapBetween(pt(9, 0), pt(51, 0), [{ fromMs: T0 + 10_000, toMs: null }])).toBe(true);
    expect(gapBetween(pt(1, 0), pt(2, 0), [{ fromMs: T0 + 10_000, toMs: null }])).toBe(false);
  });
});

describe('splitAtGaps', () => {
  it('runs of solid line, one dashed bridge per gap, fixes without a position skipped', () => {
    const points: ActivityPoint[] = [pt(0, 0), pt(1, 1), pt(2, 2), { t: T0 + 3000 }, pt(60, 60), pt(61, 61), pt(120, 120)];
    const gaps = [
      { fromMs: T0 + 5_000, toMs: T0 + 55_000 },
      { fromMs: T0 + 70_000, toMs: T0 + 110_000 },
    ];
    const { runs, bridges } = splitAtGaps(points, gaps);
    expect(runs.map(r => r.length)).toEqual([3, 2, 1]);
    expect(bridges).toHaveLength(2);
    expect(bridges[0][0]).toEqual(runs[0][2]);
    expect(bridges[0][1]).toEqual(runs[1][0]);
    expect(bridges[1][0]).toEqual(runs[1][1]);
    expect(bridges[1][1]).toEqual(runs[2][0]);
  });
  it('no gaps: one run, no bridges; no fixes: nothing', () => {
    expect(splitAtGaps([pt(0, 0), pt(1, 1)], [])).toEqual({ runs: [[[43.65, -79.38], [43.65 + 1 / 111_195, -79.38]]], bridges: [] });
    expect(splitAtGaps([], [{ fromMs: T0, toMs: T0 + 1000 }])).toEqual({ runs: [], bridges: [] });
  });
});
