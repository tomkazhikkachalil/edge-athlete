// ── What a stream says beyond the row's totals — pure (Oct 16 2026) ─────────
// Best efforts, downhill runs, max speed, the high point, the climb rate and
// grade-adjusted pace: each is DERIVED from the stored stream when the page
// reads it, never stored. A richer stream (a watch file replacing a phone
// recording) then re-derives everything with no write. At most
// DISPLAY_POINTS samples, so one pass each is cheap; the page computes them
// once per fetched stream (deriveAll in a useMemo).

import { ACTIVITY_TYPE_DEFS, type ActivityType } from './catalog';
import type { ActivityStream } from './types';

/** The distances runners compare (Strava's "best efforts"), metres. */
export const BEST_EFFORT_DISTANCES: readonly { key: string; label: string; m: number }[] = [
  { key: '1k', label: '1 km', m: 1000 },
  { key: '1mi', label: '1 mile', m: 1609.344 },
  { key: '5k', label: '5 km', m: 5000 },
  { key: '10k', label: '10 km', m: 10000 },
];

export interface BestEffort {
  key: string;
  label: string;
  seconds: number;
}

/** The time (s) at a cumulative distance between samples j-1 and j. */
function timeAt(s: readonly number[], d: readonly number[], j: number, target: number): number {
  const span = d[j] - d[j - 1];
  const f = span > 0 ? (target - d[j - 1]) / span : 0;
  return s[j - 1] + f * (s[j] - s[j - 1]);
}

/**
 * The fastest time over each distance, anywhere in the stream: a two-pointer
 * sweep, each start i paired with the first sample j that reaches d[i] + m,
 * interpolated. Distances longer than the activity are left out.
 */
export function bestEfforts(stream: ActivityStream): BestEffort[] {
  const { s, d } = stream;
  if (d.length < 2) return [];
  const total = d[d.length - 1];
  const out: BestEffort[] = [];
  for (const target of BEST_EFFORT_DISTANCES) {
    if (total < target.m) continue;
    let best = Infinity;
    let j = 1;
    for (let i = 0; i < d.length; i++) {
      const goal = d[i] + target.m;
      if (goal > total) break;
      if (j <= i) j = i + 1;
      while (j < d.length && d[j] < goal) j++;
      if (j >= d.length) break;
      const t = timeAt(s, d, j, goal) - s[i];
      if (t > 0 && t < best) best = t;
    }
    if (Number.isFinite(best)) out.push({ key: target.key, label: target.label, seconds: Math.round(best) });
  }
  return out;
}

/** The elevation column aligned with `s`/`d`, gaps filled from the nearest
 *  known value (forward, and the first known value backward), or null when
 *  fewer than two samples have one. */
function elevations(stream: ActivityStream): number[] | null {
  const col = stream.ele;
  if (!col || col.filter(v => typeof v === 'number').length < 2) return null;
  let last = col.find((v): v is number => typeof v === 'number') as number;
  return col.map(v => {
    if (typeof v === 'number') last = v;
    return last;
  });
}

/** A centred moving average — barometric and GPS elevation both jitter a few metres. */
function smooth(v: readonly number[], half: number): number[] {
  return v.map((_, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(v.length - 1, i + half);
    let sum = 0;
    for (let k = a; k <= b; k++) sum += v[k];
    return sum / (b - a + 1);
  });
}

/** The highest point on the stream (m), or null. */
export function maxElevation(stream: ActivityStream): number | null {
  const e = elevations(stream);
  if (!e) return null;
  let m = -Infinity;
  for (const v of e) if (v > m) m = v;
  return Math.round(m);
}

/** A downhill run must drop at least this far, and a climb this far ends one. */
export const RUN_MIN_DROP_M = 30;

/**
 * Downhill runs on a lift day (Slopes): a zig-zag over the smoothed
 * elevation with hysteresis. A run starts once the line has fallen
 * RUN_MIN_DROP_M below its last high and ends once it has risen the same
 * above its low (the lift). Jitter smaller than that never makes a run.
 */
export function downhillRuns(stream: ActivityStream, minDrop = RUN_MIN_DROP_M): number {
  const raw = elevations(stream);
  if (!raw) return 0;
  const e = smooth(raw, 2);
  let runs = 0;
  let high = e[0];
  let low = e[0];
  let descending = false;
  for (const v of e) {
    if (descending) {
      if (v < low) low = v;
      if (v - low >= minDrop) {
        descending = false;
        high = v;
      }
    } else {
      if (v > high) high = v;
      if (high - v >= minDrop) {
        descending = true;
        runs++;
        low = v;
      }
    }
  }
  return runs;
}

/** The speed (m/s) over a short window either side of sample i, or null when no time passes. */
function windowSpeed(s: readonly number[], d: readonly number[], i: number, half: number): number | null {
  const a = Math.max(0, i - half);
  const b = Math.min(d.length - 1, i + half);
  const dt = s[b] - s[a];
  const dd = d[b] - d[a];
  return dt > 0 && dd >= 0 ? dd / dt : null;
}

/**
 * The fastest sustained speed (m/s): a short window, so a single GPS jump
 * cannot set it, and anything above the type's own ceiling (a car, a train)
 * is ignored. Null without distance.
 */
export function maxSpeed(stream: ActivityStream, type: ActivityType): number | null {
  const { s, d } = stream;
  if (d.length < 3 || d[d.length - 1] <= 0) return null;
  const ceiling = ACTIVITY_TYPE_DEFS[type].maxSpeed;
  let best = 0;
  for (let i = 0; i < d.length; i++) {
    const v = windowSpeed(s, d, i, 2);
    if (v !== null && v <= ceiling && v > best) best = v;
  }
  return best > 0 ? best : null;
}

/**
 * The climb rate (m/h, cyclists' VAM): metres gained over the time spent
 * gaining them, on the smoothed line. Null when less than a minute was spent
 * climbing or less than 10 m was gained.
 */
export function climbRate(stream: ActivityStream): number | null {
  const raw = elevations(stream);
  if (!raw || raw.length !== stream.s.length) return null;
  const e = smooth(raw, 2);
  let up = 0;
  let t = 0;
  for (let i = 1; i < e.length; i++) {
    const dz = e[i] - e[i - 1];
    const dt = stream.s[i] - stream.s[i - 1];
    if (dz > 0 && dt > 0) {
      up += dz;
      t += dt;
    }
  }
  if (t < 60 || up < 10) return null;
  return Math.round((up / t) * 3600);
}

/**
 * The metabolic cost of running on a grade relative to the flat (Minetti et
 * al. 2002, the curve grade-adjusted pace is built on), the grade clamped to
 * ±45 % where the fit holds. 1 on the flat, above 1 uphill, below 1 on a
 * gentle descent.
 */
export function gradeCost(grade: number): number {
  const g = Math.max(-0.45, Math.min(0.45, grade));
  const c = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  return c / 3.6;
}

/** Grades are measured over at least this much horizontal distance. */
const GAP_STEP_M = 20;

/**
 * Grade-adjusted distance (m): the flat distance that would have cost the
 * same effort. Divided by the moving time it gives grade-adjusted pace
 * (Strava's GAP) — on the flat it equals the distance. Null without elevation.
 */
export function gradeAdjustedDistance(stream: ActivityStream): number | null {
  const raw = elevations(stream);
  if (!raw || raw.length !== stream.d.length) return null;
  const e = smooth(raw, 2);
  const { d } = stream;
  let total = 0;
  let from = 0;
  for (let i = 1; i < d.length; i++) {
    const run = d[i] - d[from];
    if (run < GAP_STEP_M && i < d.length - 1) continue;
    if (run > 0) total += run * gradeCost((e[i] - e[from]) / run);
    from = i;
  }
  return total > 0 ? total : null;
}

export interface Derived {
  bestEfforts: BestEffort[];
  maxSpeedMps: number | null;
  maxElevationM: number | null;
  climbRateMph: number | null;
  runs: number;
  gradeAdjustedM: number | null;
}

/** Every derived measure the type uses, from one stream (null stream → nothing). */
export function deriveAll(stream: ActivityStream | null, type: ActivityType): Derived {
  const none: Derived = { bestEfforts: [], maxSpeedMps: null, maxElevationM: null, climbRateMph: null, runs: 0, gradeAdjustedM: null };
  if (!stream || stream.d.length < 2) return none;
  const uses = DERIVED_BY_TYPE[type] ?? [];
  return {
    bestEfforts: uses.includes('bestEfforts') ? bestEfforts(stream) : [],
    maxSpeedMps: uses.includes('maxSpeed') ? maxSpeed(stream, type) : null,
    maxElevationM: uses.includes('maxElevation') ? maxElevation(stream) : null,
    climbRateMph: uses.includes('climbRate') ? climbRate(stream) : null,
    runs: uses.includes('runs') ? downhillRuns(stream) : 0,
    gradeAdjustedM: uses.includes('gap') ? gradeAdjustedDistance(stream) : null,
  };
}

type DerivedKey = 'bestEfforts' | 'maxSpeed' | 'maxElevation' | 'climbRate' | 'runs' | 'gap';

/** Which derived measures each type shows (the rest are never computed). */
export const DERIVED_BY_TYPE: Partial<Record<ActivityType, readonly DerivedKey[]>> = {
  run: ['bestEfforts'],
  trail_run: ['bestEfforts', 'maxElevation', 'climbRate', 'gap'],
  hike: ['maxElevation', 'climbRate'],
  xc_ski: ['maxElevation', 'climbRate'],
  ride: ['maxSpeed'],
  mountain_bike: ['maxSpeed', 'maxElevation'],
  ski: ['maxSpeed', 'runs'],
  snowboard: ['maxSpeed', 'runs'],
  skate: ['maxSpeed'],
  paddle: ['maxSpeed'],
};
