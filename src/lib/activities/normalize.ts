// ── Clean, total and sanity-check a NormalizedActivity — pure ──────────────
// The SERVER runs summarize() on whatever it receives (never the client's
// numbers); the import sheet runs the same code only to preview. A device's
// own total (a barometric ascent, a wheel-sensor distance) is kept only when
// it agrees with the points within bounds — otherwise the points win.

import { ACTIVITY_TYPE_DEFS, type ActivityType, STEP_TYPES } from './catalog';
import type { ActivityPoint, ActivitySummary, NormalizedActivity } from './types';

/** At most this many samples travel from the browser to the server. */
export const UPLOAD_POINTS = 10_000;
/** Longest activity accepted (48 h — an ultra, a multi-day hike stage). */
export const MAX_ELAPSED_S = 172_800;
/** A gap longer than this between samples is a pause, never moving time. */
/** A gap longer than this between samples is a pause — out of moving time
 *  (and the recorder's explicit Pause admits no samples, so it IS one). */
export const PAUSE_GAP_S = 30;
/** Elevation noise band: a change smaller than this is not a climb. */
const ELEVATION_HYSTERESIS_M = 3;
const EARTH_R = 6_371_008.8;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const hasFix = (p: ActivityPoint): p is ActivityPoint & { lat: number; lng: number } =>
  typeof p.lat === 'number' && typeof p.lng === 'number';

const inRange = (v: number | undefined, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

/**
 * Sort by time, drop duplicate timestamps, drop out-of-range sensor values,
 * and drop the FIX (never the sample) of a GPS jump — a hop faster than 3×
 * the type's plausible top speed. Returns new objects; the input is untouched.
 */
export function cleanPoints(n: NormalizedActivity): ActivityPoint[] {
  const max = ACTIVITY_TYPE_DEFS[n.type].maxSpeed * 3;
  const sorted = n.points
    .filter(p => Number.isFinite(p.t))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.t - b.p.t || a.i - b.i)
    .map(({ p }) => p);
  const out: ActivityPoint[] = [];
  let lastFix: (ActivityPoint & { lat: number; lng: number }) | null = null;
  for (const raw of sorted) {
    if (out.length > 0 && out[out.length - 1].t === raw.t) continue;
    const p: ActivityPoint = { t: raw.t };
    const lat = inRange(raw.lat, -90, 90);
    const lng = inRange(raw.lng, -180, 180);
    if (lat !== undefined && lng !== undefined) {
      const candidate = { t: raw.t, lat, lng };
      const dt = lastFix ? (raw.t - lastFix.t) / 1000 : 0;
      const jump = lastFix && dt > 0 ? haversineM(lastFix.lat, lastFix.lng, lat, lng) / dt > max : false;
      if (!jump) {
        p.lat = lat;
        p.lng = lng;
        lastFix = candidate;
      }
    }
    const ele = inRange(raw.ele, -500, 9000);
    if (ele !== undefined) p.ele = ele;
    const hr = inRange(raw.hr, 20, 250);
    if (hr !== undefined) p.hr = Math.round(hr);
    const cad = inRange(raw.cad, 0, 300);
    if (cad !== undefined) p.cad = Math.round(cad);
    const pwr = inRange(raw.pwr, 0, 2500);
    if (pwr !== undefined) p.pwr = Math.round(pwr);
    const dist = inRange(raw.dist, 0, 2_000_000);
    if (dist !== undefined) p.dist = dist;
    out.push(p);
  }
  return out;
}

/** Keep at most `max` samples, evenly by index, always keeping both ends. */
export function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max || max < 2) return items.slice();
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/**
 * Cumulative distance (m) at every sample. GPS fixes drive it; where a
 * device distance exists and there is NO fix (an indoor ride, a treadmill),
 * the device's own counter does. Never decreases.
 */
export function cumulativeDistances(points: readonly ActivityPoint[]): number[] {
  const fixes = points.filter(hasFix).length;
  const useDevice = fixes < 2 && points.some(p => typeof p.dist === 'number');
  const d: number[] = [];
  let total = 0;
  let prevFix: (ActivityPoint & { lat: number; lng: number }) | null = null;
  let prevDev: number | null = null;
  for (const p of points) {
    if (useDevice) {
      if (typeof p.dist === 'number') {
        if (prevDev !== null && p.dist > prevDev) total += p.dist - prevDev;
        prevDev = p.dist;
      }
    } else if (hasFix(p)) {
      if (prevFix) total += haversineM(prevFix.lat, prevFix.lng, p.lat, p.lng);
      prevFix = p;
    }
    d.push(total);
  }
  return d;
}

export function elevationTotals(points: readonly ActivityPoint[]): { gain: number; loss: number } | null {
  let ref: number | null = null;
  let gain = 0;
  let loss = 0;
  for (const p of points) {
    if (typeof p.ele !== 'number') continue;
    if (ref === null) {
      ref = p.ele;
      continue;
    }
    const diff = p.ele - ref;
    if (diff >= ELEVATION_HYSTERESIS_M) {
      gain += diff;
      ref = p.ele;
    } else if (diff <= -ELEVATION_HYSTERESIS_M) {
      loss -= diff;
      ref = p.ele;
    }
  }
  return ref === null ? null : { gain, loss };
}

const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
const round = (v: number | null, dp = 0) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** Prefer the device's number when it is within [lo, hi] × the computed one. */
function agree(device: number | undefined, computed: number | null, lo: number, hi: number, slack = 0): number | null {
  if (device === undefined || !Number.isFinite(device) || device < 0) return computed;
  if (computed === null || computed === 0) return device;
  return device >= computed * lo - slack && device <= computed * hi + slack ? device : computed;
}

export function summarize(n: NormalizedActivity, cleaned?: ActivityPoint[]): ActivitySummary {
  const pts = cleaned ?? cleanPoints(n);
  if (pts.length === 0) throw new Error('summarize: no points');
  const def = ACTIVITY_TYPE_DEFS[n.type];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const elapsedS = Math.max(0, Math.round((last.t - first.t) / 1000));
  const d = cumulativeDistances(pts);
  const computedDist = d[d.length - 1];
  const hasDistanceData = computedDist > 0;
  const fixes = pts.filter(hasFix).length;

  let moving: number | null = null;
  if (hasDistanceData) {
    moving = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt <= 0 || dt > PAUSE_GAP_S) continue;
      if ((d[i] - d[i - 1]) / dt >= def.movingSpeed) moving += dt;
    }
  }
  const movingS = moving !== null ? Math.round(moving) : (n.device.movingS !== undefined && n.device.movingS <= elapsedS ? Math.round(n.device.movingS) : null);

  const distanceM = agree(n.device.distanceM, hasDistanceData ? computedDist : null, 0.85, 1.15);
  const elev = elevationTotals(pts);
  const elevGainM = agree(n.device.elevGainM, elev ? elev.gain : null, 0.5, 2, 50);
  const elevLossM = agree(n.device.elevLossM, elev ? elev.loss : null, 0.5, 2, 50);

  const hrs = pts.map(p => p.hr).filter((v): v is number => typeof v === 'number');
  const pwrs = pts.map(p => p.pwr).filter((v): v is number => typeof v === 'number');
  const cads = pts.map(p => p.cad).filter((v): v is number => typeof v === 'number' && v > 0);
  const calories = n.device.calories !== undefined && n.device.calories >= 0 && n.device.calories <= 50_000 ? Math.round(n.device.calories) : null;

  return {
    startedAt: first.t,
    elapsedS,
    movingS,
    distanceM: round(distanceM, 1),
    elevGainM: round(elevGainM, 1),
    elevLossM: round(elevLossM, 1),
    avgHr: round(mean(hrs)),
    maxHr: hrs.length > 0 ? hrs.reduce((m, v) => (v > m ? v : m), hrs[0]) : null,
    avgPower: round(mean(pwrs)),
    avgCadence: round(mean(cads)),
    calories,
    hasRoute: fixes >= 2 && computedDist >= 50,
  };
}

/** Earliest and latest start we accept. */
const EARLIEST = Date.UTC(2000, 0, 1);

/**
 * Why this activity cannot be imported, or null when it can. The message is
 * shown to the athlete, so it says what to do.
 */
export function implausibility(n: NormalizedActivity, s: ActivitySummary, now = Date.now()): string | null {
  const def = ACTIVITY_TYPE_DEFS[n.type];
  if (s.elapsedS <= 0) return 'This file has only one moment in it — there is no activity to import.';
  if (s.elapsedS > MAX_ELAPSED_S) return 'This activity is longer than 48 hours. Split it in your app and import the parts.';
  if (s.startedAt < EARLIEST || s.startedAt > now + 86_400_000) return 'This file’s date is not a real one — check the device clock.';
  const time = s.movingS && s.movingS > 0 ? s.movingS : s.elapsedS;
  if (s.distanceM !== null && time > 0 && s.distanceM / time > def.maxSpeed) {
    return `This is faster than a ${def.label.toLowerCase()} can go. If it was a different activity, pick that type and try again.`;
  }
  return null;
}

/** The start in the athlete's local time: the file's own offset first,
 *  else the uploader's zone, else UTC (the date-only TZ trap). */
export function localParts(startedAt: number, tzOffsetMin: number | null, timeZone: string | null): { date: string; hour: number } {
  if (tzOffsetMin !== null && Number.isFinite(tzOffsetMin) && Math.abs(tzOffsetMin) <= 14 * 60) {
    const iso = new Date(startedAt + tzOffsetMin * 60_000).toISOString();
    return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
  }
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(startedAt));
      const get = (k: string) => parts.find(p => p.type === k)?.value;
      const y = get('year');
      const m = get('month');
      const d = get('day');
      const h = Number(get('hour'));
      if (y && m && d && Number.isFinite(h)) return { date: `${y}-${m}-${d}`, hour: h % 24 };
    } catch {
      // an unknown zone falls through to UTC
    }
  }
  const iso = new Date(startedAt).toISOString();
  return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
}

/** The athlete's local calendar day it started on. */
export function occurredOn(startedAt: number, tzOffsetMin: number | null, timeZone: string | null): string {
  return localParts(startedAt, tzOffsetMin, timeZone).date;
}

/** "Morning Run", "Evening Ride" — the name when the file has none. */
export function defaultActivityName(type: ActivityType, hour: number): string {
  const part = hour < 5 ? 'Night' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Night';
  return `${part} ${ACTIVITY_TYPE_DEFS[type].label}`;
}

/** The dedupe key for a FILE: an athlete cannot start two activities in the
 *  same second, so the start is the identity — the same run exported as a
 *  .FIT and a .GPX is still one activity. */
export function fileExternalId(startedAt: number): string {
  return `start:${Math.floor(startedAt / 1000)}`;
}

// ── Steps (Live Activities, mig 251) ────────────────────────────────────────
// The web has no pedometer, so steps are an ESTIMATE from distance and
// stride, labelled "est." wherever they show (Tom, Oct 4 2026). Stride from
// the athlete's height when known — the pedometer rule of thumb: 0.413 ×
// height walking, 0.65 × height running — else 0.75 m / 1.0 m. Walking or
// running is decided by the average MOVING speed (2 m/s ≈ a 13:20 min/mile
// jog), not by the type: a treadmill is either. Computed on the SERVER at
// import (and by the recorder for its live display, the same function).
// Only the step types (catalog STEP_TYPES) get a number; others null.

export const STEP_WALK_STRIDE_FACTOR = 0.413;
export const STEP_RUN_STRIDE_FACTOR = 0.65;
export const STEP_WALK_STRIDE_M = 0.75;
export const STEP_RUN_STRIDE_M = 1.0;
/** Above this average moving speed the stride is a running stride. */
export const STEP_RUN_SPEED_MPS = 2.0;
export const STEPS_MAX = 200_000;

export function strideM(running: boolean, heightCm: number | null | undefined): number {
  if (typeof heightCm === 'number' && Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 250) {
    return (heightCm / 100) * (running ? STEP_RUN_STRIDE_FACTOR : STEP_WALK_STRIDE_FACTOR);
  }
  return running ? STEP_RUN_STRIDE_M : STEP_WALK_STRIDE_M;
}

export function estimateSteps(
  type: ActivityType,
  distanceM: number | null | undefined,
  movingS: number | null | undefined,
  heightCm: number | null | undefined
): number | null {
  if (!STEP_TYPES.has(type)) return null;
  if (typeof distanceM !== 'number' || !Number.isFinite(distanceM) || distanceM <= 0) return null;
  const speed = typeof movingS === 'number' && movingS > 0 ? distanceM / movingS : 0;
  const steps = Math.round(distanceM / strideM(speed >= STEP_RUN_SPEED_MPS, heightCm));
  return Math.min(STEPS_MAX, Math.max(0, steps));
}
