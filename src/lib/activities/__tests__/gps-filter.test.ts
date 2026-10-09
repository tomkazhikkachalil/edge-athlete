import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCURACY_M, filterTrack, initialFilterState, SETTLE_FIXES, stepFilter, type RawFix } from '../gps-filter';
import { cumulativeDistances } from '../normalize';
import type { ActivityType } from '../catalog';

// Seeded synthetic tracks (GPS accuracy round, Oct 9 2026). One fix a second,
// Gaussian noise, a phone's REPORTED accuracy at 1.5 × the noise (phones
// report a ~68 % radius), occasional 40 m outliers. The raw sum of hops at
// that rate overshoots a 1 km loop by 5–15×; the filter must land within a
// few percent and stand still at 0.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function gauss(r: () => number) {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const LAT0 = 45.4;
const LNG0 = -75.7;
const M_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const T0 = 1_760_000_000_000;
const at = (t: number, e: number, n: number, acc: number): RawFix => ({ t: T0 + t * 1000, lat: LAT0 + n / 111_320, lng: LNG0 + e / M_LNG, acc });
const total = (points: readonly { t: number; lat?: number; lng?: number }[]) => {
  const d = cumulativeDistances(points);
  return d.length ? d[d.length - 1] : 0;
};

function circle(seed: number, sigma: number, speed: number, lengthM: number, outlierP = 0.05): RawFix[] {
  const r = rng(seed);
  const radius = lengthM / (2 * Math.PI);
  const out: RawFix[] = [];
  for (let t = 0; t <= lengthM / speed; t++) {
    const a = (speed * t) / radius;
    let e = radius * Math.cos(a) + gauss(r) * sigma;
    let n = radius * Math.sin(a) + gauss(r) * sigma;
    if (r() < outlierP) {
      e += (r() - 0.5) * 80;
      n += (r() - 0.5) * 80;
    }
    out.push(at(t, e, n, sigma * 1.5));
  }
  return out;
}

function square(seed: number, sigma: number): RawFix[] {
  const r = rng(seed);
  const side = 250;
  const perimeter = 4 * side;
  const pos = (s: number): [number, number] => {
    if (s < side) return [s, 0];
    if (s < 2 * side) return [side, s - side];
    if (s < 3 * side) return [3 * side - s, side];
    return [0, perimeter - s];
  };
  const out: RawFix[] = [];
  for (let t = 0; t <= perimeter / 1.4; t++) {
    const [e, n] = pos(Math.min(1.4 * t, perimeter - 1e-6));
    out.push(at(t, e + gauss(r) * sigma, n + gauss(r) * sigma, sigma * 1.5));
  }
  return out;
}

describe('gps-filter — a faithful route from a noisy phone', () => {
  it('a 1 km loop walked with 5–12 m of noise and 5 % outliers reads within 4 % (raw overshoots by 5× or more)', () => {
    for (const sigma of [5, 8, 12]) {
      for (const seed of [1, 2, 3]) {
        const raw = circle(seed, sigma, 1.4, 1000);
        const filtered = filterTrack(raw, 'walk').points;
        expect(total(raw)).toBeGreaterThan(5000);
        expect(Math.abs(total(filtered) - 1000) / 1000, `sigma ${sigma} seed ${seed}: ${total(filtered).toFixed(0)} m`).toBeLessThan(0.04);
      }
    }
  });

  it('a square block with sharp corners: distance within 3 % and the path closer to the streets than the raw fixes', () => {
    const offRoute = ([e, n]: [number, number]) => {
      const side = 250;
      const onE = e >= 0 && e <= side ? Math.min(Math.abs(n), Math.abs(n - side)) : Infinity;
      const onN = n >= 0 && n <= side ? Math.min(Math.abs(e), Math.abs(e - side)) : Infinity;
      const corner = Math.min(Math.hypot(e, n), Math.hypot(e - side, n), Math.hypot(e, n - side), Math.hypot(e - side, n - side));
      return Math.min(onE, onN, corner);
    };
    const rms = (ps: readonly { lat?: number; lng?: number }[]) =>
      Math.sqrt(ps.reduce((acc, p) => acc + offRoute([((p.lng as number) - LNG0) * M_LNG, ((p.lat as number) - LAT0) * 111_320]) ** 2, 0) / ps.length);
    for (const sigma of [5, 8, 12]) {
      const raw = square(4, sigma);
      const filtered = filterTrack(raw, 'walk').points;
      const drawn = filtered.filter((p, i, a) => i === 0 || p.lat !== a[i - 1].lat || p.lng !== a[i - 1].lng);
      expect(Math.abs(total(filtered) - 1000) / 1000, `sigma ${sigma}`).toBeLessThan(0.03);
      expect(rms(drawn), `sigma ${sigma}`).toBeLessThan(rms(raw) * 0.6);
    }
  });

  it('standing still for two minutes with 10 m of noise adds nothing and draws nothing new', () => {
    const r = rng(9);
    const still: RawFix[] = [];
    for (let t = 0; t < 120; t++) still.push(at(t, gauss(r) * 10, gauss(r) * 10, 15));
    const { points } = filterTrack(still, 'walk');
    expect(total(still)).toBeGreaterThan(1000);
    expect(total(points)).toBe(0);
    expect(new Set(points.map(p => `${p.lat},${p.lng}`)).size).toBe(1);
    // Time still passes: the track ends at the last fix, so the elapsed clock is whole.
    expect(points[points.length - 1].t - points[0].t).toBeGreaterThan(110_000);
  });

  it('a jittery walk at two fixes a second keeps honest moving time (the server would refuse a walk "too fast" otherwise)', () => {
    const r = rng(7);
    const fixes: RawFix[] = [];
    for (let k = 0; k <= 180; k++) fixes.push(at(k * 0.5, 0.7 * k + (r() - 0.5) * 10, (r() - 0.5) * 10, 8));
    const pts = filterTrack(fixes, 'walk').points;
    const d = cumulativeDistances(pts);
    let moving = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt > 0 && dt <= 30 && (d[i] - d[i - 1]) / dt >= 0.4) moving += dt;
    }
    expect(moving, `moving ${moving}s of 90s`).toBeGreaterThan(70);
    expect(d[d.length - 1] / moving).toBeLessThan(4 * 1.5); // a walker's pace, not a jump's
  });

  it('walk, stand, walk: the standing minute adds no distance', () => {
    const r = rng(11);
    const fixes: RawFix[] = [];
    let t = 0;
    for (; t <= 200; t++) fixes.push(at(t, 1.4 * t + gauss(r) * 6, gauss(r) * 6, 9));
    for (let k = 0; k < 120; k++, t++) fixes.push(at(t, 280 + gauss(r) * 6, gauss(r) * 6, 9));
    for (let k = 0; k <= 200; k++, t++) fixes.push(at(t, 280 + 1.4 * k + gauss(r) * 6, gauss(r) * 6, 9));
    const pts = filterTrack(fixes, 'walk').points;
    const d = total(pts);
    expect(Math.abs(d - 560) / 560, `${d.toFixed(0)} m`).toBeLessThan(0.05);
    // …and its two minutes are not moving time: 400 s walked, 120 s stood.
    const cd = cumulativeDistances(pts);
    let moving = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt > 0 && dt <= 30 && (cd[i] - cd[i - 1]) / dt >= 0.4) moving += dt;
    }
    expect(moving, `moving ${moving.toFixed(0)} s`).toBeGreaterThan(360);
    expect(moving, `moving ${moving.toFixed(0)} s`).toBeLessThan(440);
  });

  it('runs and rides keep their pace through the filter', () => {
    const cases: Array<[ActivityType, number, number]> = [['run', 3.2, 3000], ['ride', 8, 6000]];
    for (const [type, speed, length] of cases) {
      const filtered = filterTrack(circle(5, 6, speed, length, 0.02), type).points;
      expect(Math.abs(total(filtered) - length) / length, `${type}: ${total(filtered).toFixed(0)} m`).toBeLessThan(0.04);
    }
  });

  it('a cold start waits for the signal to settle: bad first fixes never start the route', () => {
    const fixes: RawFix[] = [
      at(0, 0, 0, 25), at(1, 40, -30, 25), at(2, -20, 15, 25), // poor (over 20 m) — the run resets
      at(3, 0, 0, 8), at(4, 1, 0, 8), at(5, 2, 0, 8), // three good fixes settle it
      at(6, 3, 0, 8),
    ];
    const { points, tally } = filterTrack(fixes, 'walk');
    expect(tally.settling).toBe(5);
    expect(points[0].t).toBe(T0 + 5000);
    expect(SETTLE_FIXES).toBe(3);
  });

  it('a fix worse than the type allows is refused, at any time', () => {
    const fixes = [at(0, 0, 0, 5), at(1, 1, 0, 5), at(2, 2, 0, 5), at(3, 3, 0, 80)];
    expect(filterTrack(fixes, 'walk').tally.inaccurate).toBe(1);
  });

  it('refuses a fix that is not after the last one, and a jump no walker could make', () => {
    let s = initialFilterState('walk');
    for (let t = 0; t < 4; t++) s = stepFilter(s, at(t, t, 0, 5)).state;
    expect(stepFilter(s, at(2, 2, 0, 5)).verdict).toBe('stale');
    expect(stepFilter(s, at(4, 400, 0, 5)).verdict).toBe('too_fast');
    // A refused fix leaves the state as it was.
    expect(stepFilter(s, at(4, 400, 0, 5)).state).toBe(s);
  });

  it('a fix without an accuracy is read as the default, so older recordings still filter', () => {
    const noAcc = { t: T0, lat: LAT0, lng: LNG0 } as RawFix;
    expect(DEFAULT_ACCURACY_M).toBe(15);
    const step = stepFilter(initialFilterState('walk'), noAcc);
    expect(step.verdict).toBe('settling');
  });

  it('positionless samples pass through untouched (a timer type’s bookends)', () => {
    const bookends = [{ t: T0, dist: 0 }, { t: T0 + 60_000, dist: 500 }];
    expect(filterTrack(bookends, 'treadmill' as ActivityType).points).toEqual(bookends);
  });

  it('is deterministic — the phone and the server get the same route from the same fixes', () => {
    const raw = circle(7, 8, 1.4, 500);
    const a = filterTrack(raw, 'walk');
    const b = filterTrack(raw.map(p => ({ ...p })), 'walk');
    expect(b).toEqual(a);
    let s = initialFilterState('walk');
    const stepped = [];
    for (const f of raw) {
      const out = stepFilter(s, f);
      s = out.state;
      if (out.point) stepped.push(out.point);
    }
    // The fold adds only the end of the track (the last accepted fix's time).
    expect(a.points.slice(0, stepped.length)).toEqual(stepped);
    expect(a.points.length - stepped.length).toBeLessThanOrEqual(1);
    expect(a.points[a.points.length - 1].t).toBe(raw[raw.length - 1].t);
  });
});
