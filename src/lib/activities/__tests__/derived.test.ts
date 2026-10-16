import { describe, expect, it } from 'vitest';
import { bestEfforts, climbRate, deriveAll, downhillRuns, gradeAdjustedDistance, gradeCost, maxElevation, maxSpeed } from '../derived';
import type { ActivityStream } from '../types';

/** A steady line: `n` samples, `dt` seconds and `dd` metres apart, elevation from `ele(i)`. */
function line(n: number, dt: number, dd: number, ele?: (i: number) => number): ActivityStream {
  const s = Array.from({ length: n }, (_, i) => i * dt);
  const d = Array.from({ length: n }, (_, i) => i * dd);
  return { v: 1, s, d, ...(ele ? { ele: s.map((_, i) => ele(i)) } : {}) };
}

describe('bestEfforts', () => {
  it('finds a steady 5:00 /km over every distance the run covers', () => {
    // 10 m every 3 s = 5:00 /km, 6 km long
    const e = bestEfforts(line(601, 3, 10));
    expect(e.map(x => x.key)).toEqual(['1k', '1mi', '5k']);
    expect(e.find(x => x.key === '1k')!.seconds).toBe(300);
    expect(e.find(x => x.key === '5k')!.seconds).toBe(1500);
  });

  it('finds the fast kilometre in the middle', () => {
    const st = line(301, 3, 10); // 3 km at 5:00 /km
    // the middle kilometre (samples 100..200) at 4:00 /km: compress its time
    st.s = st.s.map((_, i) => (i <= 100 ? i * 3 : i <= 200 ? 300 + (i - 100) * 2.4 : 540 + (i - 200) * 3));
    expect(bestEfforts(st).find(x => x.key === '1k')!.seconds).toBe(240);
  });

  it('leaves out distances longer than the activity', () => {
    expect(bestEfforts(line(50, 3, 10))).toEqual([]);
  });
});

describe('downhillRuns', () => {
  it('counts three runs on a sawtooth lift day', () => {
    // up 200 m over 40 samples, down 200 m over 20, three times
    const ele = (i: number) => {
      const k = i % 60;
      return k < 40 ? 1000 + k * 5 : 1200 - (k - 40) * 10;
    };
    expect(downhillRuns(line(180, 10, 20, ele))).toBe(3);
  });

  it('ignores jitter smaller than a run', () => {
    expect(downhillRuns(line(200, 5, 10, i => 1000 + (i % 2 === 0 ? 5 : -5)))).toBe(0);
  });
});

describe('maxSpeed', () => {
  it('reads a ride sprint and ignores a GPS jump above the ceiling', () => {
    const st = line(100, 1, 8); // 8 m/s
    st.d = st.d.map((v, i) => (i >= 50 && i < 60 ? v + (i - 49) * 4 : i >= 60 ? v + 40 : v)); // ten seconds at 12 m/s
    const v = maxSpeed(st, 'ride')!;
    expect(v).toBeGreaterThan(11);
    expect(v).toBeLessThanOrEqual(12.01);
    const jump = line(100, 1, 8);
    jump.d = jump.d.map((v, i) => (i >= 50 ? v + 5000 : v));
    expect(maxSpeed(jump, 'ride')!).toBeLessThan(30);
  });

  it('is null without distance', () => {
    expect(maxSpeed(line(10, 1, 0), 'ride')).toBeNull();
  });
});

describe('elevation measures', () => {
  it('reads the high point and the climb rate of a steady climb', () => {
    // 600 m gained in an hour
    const st = line(361, 10, 10, i => 500 + i * (600 / 360));
    expect(maxElevation(st)).toBe(1100);
    expect(climbRate(st)).toBeGreaterThan(560);
    expect(climbRate(st)).toBeLessThan(640);
  });

  it('is null without elevation', () => {
    expect(maxElevation(line(10, 1, 1))).toBeNull();
    expect(climbRate(line(10, 1, 1))).toBeNull();
  });
});

describe('grade-adjusted distance', () => {
  it('equals the distance on the flat', () => {
    expect(gradeCost(0)).toBeCloseTo(1, 5);
    const st = line(201, 5, 10, () => 300);
    expect(gradeAdjustedDistance(st)).toBeCloseTo(2000, 0);
  });

  it('is longer than the distance uphill (a faster adjusted pace)', () => {
    const st = line(201, 5, 10, i => 300 + i * 1); // 10 % grade
    expect(gradeAdjustedDistance(st)!).toBeGreaterThan(2000 * 1.3);
  });
});

describe('deriveAll', () => {
  it('computes only what the type shows', () => {
    const st = line(601, 3, 10, i => 100 + i);
    expect(deriveAll(st, 'run').bestEfforts.length).toBeGreaterThan(0);
    expect(deriveAll(st, 'run').maxElevationM).toBeNull();
    expect(deriveAll(st, 'hike').bestEfforts).toEqual([]);
    expect(deriveAll(st, 'hike').maxElevationM).toBe(700);
    expect(deriveAll(null, 'ski').runs).toBe(0);
  });
});
