/**
 * The phone recorder's GPS filter (GPS accuracy round, Oct 9 2026). Pure and
 * deterministic: the SAME fold runs on the phone (the live map and the live
 * totals) and on the server (the stored route and every total), so the
 * numbers the athlete watched are the numbers saved.
 *
 * Tom, after a test walk: "the recorded path was jittery and inaccurate. My
 * position jumped back and forth." Until this round every admitted raw fix
 * was a route point and distance summed raw hops — ordinary 10–30 m phone
 * wobble passed the old 50 m / 1.5 × maxSpeed gate and drew zigzags.
 *
 * What a fix goes through, in order:
 *   1. Refusals — worse than the type's accuracy limit; not after the last
 *      accepted fix; an implied speed past maxSpeed × SPEED_SLACK measured
 *      against the FILTERED position (a wild fix cannot drag the next one).
 *   2. Cold start — nothing is recorded until SETTLE_FIXES consecutive fixes
 *      are within SETTLE_ACCURACY_M, or SETTLE_TIMEOUT_S has passed (then the
 *      first fix within the type's limit starts the route).
 *   3. Smoothing — a constant-velocity Kalman filter per axis in a local
 *      metre frame (east / north around the first settled fix): measurement
 *      noise = accuracy², process noise from the type's expected acceleration.
 *   4. Emission — a point is emitted at the filtered position only once it
 *      has left the last emitted one by more than its own uncertainty AND the
 *      filter is confidently moving. Otherwise — under a step, unsure, or
 *      standing still — NOTHING is drawn, so the next hop spans its true time
 *      (moving time and pace stay honest) and standing still adds no distance
 *      and no zigzag. The track ends at the last accepted fix — at the filtered
 *      position while still moving, at the last drawn one when not.
 *
 * Raw fixes are never thrown away by this module: callers keep them (the
 * recorder's IndexedDB, the server's stored stream) so a better filter can
 * re-process later.
 */

import { ACTIVITY_TYPE_DEFS, type ActivityType } from './catalog';
import type { ActivityPoint } from './types';

/** A fix the filter considers (an ActivityPoint with lat / lng; `acc` optional). */
export interface RawFix extends ActivityPoint {
  lat: number;
  lng: number;
  acc?: number;
}

export type FilterVerdict = 'ok' | 'held' | 'between' | 'settling' | 'inaccurate' | 'stale' | 'too_fast';

/** Read when a browser or an older recording omits the accuracy. */
export const DEFAULT_ACCURACY_M = 15;
export const SETTLE_ACCURACY_M = 20;
export const SETTLE_FIXES = 3;
export const SETTLE_TIMEOUT_S = 30;
/** A jump past maxSpeed × this (beyond the fix's own accuracy) is refused. */
export const SPEED_SLACK = 1.5;
/** The filtered position must move at least this far before a new point is drawn … */
export const MIN_STEP_M = 3;
/** … and further than this many of its own standard deviations. */
export const STEP_SD_K = 6;
/** Moving needs the filtered speed this many of its own standard deviations clear of zero. */
export const SPEED_SD_K = 1.5;
/** A fix whose normalised innovation (2 axes) passes this is a manoeuvre … */
export const MANOEUVRE_NIS = 9;
/** … and the process noise is boosted by this for that step. */
export const MANOEUVRE_Q_BOOST = 25;
/** The jump gate's slack: this many of the fix's accuracy radii. */
export const JUMP_ACCURACY_K = 3;

export interface GpsProfile {
  maxAccuracyM: number;
  /** Expected acceleration (m/s²) — the Kalman process noise. */
  accelSigma: number;
}

/** By the type's catalog group; a type not listed uses `default`. */
export function gpsProfile(type: ActivityType): GpsProfile {
  const def = ACTIVITY_TYPE_DEFS[type];
  if (def.maxSpeed >= 15) return { maxAccuracyM: 35, accelSigma: 1.5 }; // rides
  if (type.includes('swim')) return { maxAccuracyM: 50, accelSigma: 0.5 };
  if (def.maxSpeed >= 8) return { maxAccuracyM: 30, accelSigma: 1.0 }; // runs
  return { maxAccuracyM: 30, accelSigma: 0.2 }; // walks, hikes, everything slower
}

interface Axis {
  p: number;
  v: number;
  /** Covariance [[a, b], [b, c]]. */
  a: number;
  b: number;
  c: number;
}

export interface FilterState {
  type: ActivityType;
  phase: 'settling' | 'tracking';
  /** Settling: the run of good fixes so far, and when settling began. */
  goodRun: number;
  firstT: number | null;
  /** The good run's summed position — the route starts at its MEAN, not at
   *  one raw fix (a single fix can be its full accuracy off). */
  runLat: number;
  runLng: number;
  /** Tracking: the local frame's origin and the two axes. */
  lat0: number;
  lng0: number;
  mPerDegLng: number;
  e: Axis;
  n: Axis;
  lastT: number;
  /** The last EMITTED position (metres in the frame). */
  outE: number;
  outN: number;
  /** The filter was standing still on the last fix — the next moving fix
   *  marks the restart at the held position, so a stop and the walk after it
   *  are separate hops (moving time stays honest). */
  still: boolean;
}

const M_PER_DEG_LAT = 111_320;

export function initialFilterState(type: ActivityType): FilterState {
  const zero: Axis = { p: 0, v: 0, a: 0, b: 0, c: 0 };
  return { type, phase: 'settling', goodRun: 0, firstT: null, runLat: 0, runLng: 0, lat0: 0, lng0: 0, mPerDegLng: M_PER_DEG_LAT, e: zero, n: zero, lastT: 0, outE: 0, outN: 0, still: false };
}

function predict(x: Axis, dt: number, q: number): Axis {
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  return {
    p: x.p + x.v * dt,
    v: x.v,
    a: x.a + dt * (2 * x.b + dt * x.c) + (q * dt3) / 3,
    b: x.b + dt * x.c + (q * dt2) / 2,
    c: x.c + q * dt,
  };
}

function update(x: Axis, z: number, r: number): Axis {
  const s = x.a + r;
  const k0 = x.a / s;
  const k1 = x.b / s;
  const y = z - x.p;
  return {
    p: x.p + k0 * y,
    v: x.v + k1 * y,
    a: (1 - k0) * x.a,
    b: (1 - k0) * x.b,
    c: x.c - k1 * x.b,
  };
}

function startTracking(state: FilterState, fix: RawFix, acc: number): FilterState {
  const mPerDegLng = M_PER_DEG_LAT * Math.max(0.01, Math.cos((fix.lat * Math.PI) / 180));
  const axis: Axis = { p: 0, v: 0, a: acc * acc, b: 0, c: 4 };
  return { ...state, phase: 'tracking', lat0: fix.lat, lng0: fix.lng, mPerDegLng, e: axis, n: axis, lastT: fix.t, outE: 0, outN: 0, still: true };
}

function toLatLng(state: FilterState, e: number, n: number): { lat: number; lng: number } {
  return { lat: state.lat0 + n / M_PER_DEG_LAT, lng: state.lng0 + e / state.mPerDegLng };
}

function emit(fix: RawFix, ll: { lat: number; lng: number }): ActivityPoint {
  const p: ActivityPoint = { t: fix.t, lat: ll.lat, lng: ll.lng };
  if (typeof fix.ele === 'number') p.ele = fix.ele;
  if (typeof fix.hr === 'number') p.hr = fix.hr;
  if (typeof fix.cad === 'number') p.cad = fix.cad;
  if (typeof fix.pwr === 'number') p.pwr = fix.pwr;
  return p;
}

/** One fix in; the next state, the point to draw (or null), and why. */
export function stepFilter(state: FilterState, fix: RawFix): { state: FilterState; point: ActivityPoint | null; verdict: FilterVerdict } {
  const profile = gpsProfile(state.type);
  const acc = typeof fix.acc === 'number' && Number.isFinite(fix.acc) && fix.acc > 0 ? fix.acc : DEFAULT_ACCURACY_M;
  if (acc > profile.maxAccuracyM) return { state, point: null, verdict: 'inaccurate' };

  if (state.phase === 'settling') {
    const firstT = state.firstT ?? fix.t;
    const good = acc <= SETTLE_ACCURACY_M;
    const goodRun = good ? state.goodRun + 1 : 0;
    const runLat = good ? state.runLat + fix.lat : 0;
    const runLng = good ? state.runLng + fix.lng : 0;
    const timedOut = (fix.t - firstT) / 1000 >= SETTLE_TIMEOUT_S;
    if (goodRun >= SETTLE_FIXES || timedOut) {
      const start = goodRun >= SETTLE_FIXES ? { ...fix, lat: runLat / goodRun, lng: runLng / goodRun } : fix;
      const startAcc = goodRun >= SETTLE_FIXES ? acc / Math.sqrt(goodRun) : acc;
      const next = startTracking({ ...state, goodRun, firstT, runLat, runLng }, start, startAcc);
      return { state: next, point: emit(fix, { lat: start.lat, lng: start.lng }), verdict: 'ok' };
    }
    return { state: { ...state, goodRun, firstT, runLat, runLng }, point: null, verdict: 'settling' };
  }

  if (fix.t <= state.lastT) return { state, point: null, verdict: 'stale' };
  const dt = (fix.t - state.lastT) / 1000;
  const ze = (fix.lng - state.lng0) * state.mPerDegLng;
  const zn = (fix.lat - state.lat0) * M_PER_DEG_LAT;

  // The jump gate, against the FILTERED position, with the fix's own accuracy as slack.
  const def = ACTIVITY_TYPE_DEFS[state.type];
  const fromFiltered = Math.hypot(ze - state.e.p, zn - state.n.p);
  if (fromFiltered - JUMP_ACCURACY_K * acc > def.maxSpeed * SPEED_SLACK * dt) return { state, point: null, verdict: 'too_fast' };

  const q = profile.accelSigma * profile.accelSigma;
  const r = acc * acc;
  let pe = predict(state.e, dt, q);
  let pn = predict(state.n, dt, q);
  // Manoeuvre detection: a fix far outside the prediction's own uncertainty
  // (a corner, a U-turn) — the walker changed course, so the filter is
  // allowed to turn with them this step instead of overshooting the corner.
  const nis = (ze - pe.p) ** 2 / (pe.a + r) + (zn - pn.p) ** 2 / (pn.a + r);
  if (nis > MANOEUVRE_NIS) {
    pe = predict(state.e, dt, q * MANOEUVRE_Q_BOOST);
    pn = predict(state.n, dt, q * MANOEUVRE_Q_BOOST);
  }
  const e = update(pe, ze, r);
  const n = update(pn, zn, r);
  const speed = Math.hypot(e.v, n.v);
  const moved = Math.hypot(e.p - state.outE, n.p - state.outN);
  // A step is drawn only once the filtered position has left the last drawn
  // one by more than its own uncertainty — wobble inside it is not travel.
  const posSd = Math.sqrt(Math.max(0, (e.a + n.a) / 2));
  const stepM = Math.max(MIN_STEP_M, STEP_SD_K * posSd);

  // Moving means confidently moving: the filtered speed above the type's
  // threshold AND clear of its own uncertainty (noise alone gives a
  // stationary filter a small, uncertain velocity).
  const velSd = Math.sqrt(Math.max(0, (e.c + n.c) / 2));
  const moving = speed >= def.movingSpeed && speed >= SPEED_SD_K * velSd;

  if (moving && state.still) {
    // The restart: a point at the held position, now — the stop ends here.
    const next: FilterState = { ...state, e, n, lastT: fix.t, still: false };
    return { state: next, point: emit(fix, toLatLng(next, state.outE, state.outN)), verdict: 'between' };
  }
  if (moving && moved >= stepM) {
    const next: FilterState = { ...state, e, n, lastT: fix.t, outE: e.p, outN: n.p, still: false };
    return { state: next, point: emit(fix, toLatLng(next, e.p, n.p)), verdict: 'ok' };
  }
  const next: FilterState = { ...state, e, n, lastT: fix.t, still: !moving };
  // Not a step yet — moving under one, unsure, or standing still: draw
  // NOTHING. The next drawn hop then spans its true time, so moving time and
  // pace stay honest (repeating the held point made the next step look like
  // a 10 m jump in half a second: a walk read as 4 s of moving time and the
  // server refused it as "faster than a walk"). Standing still adds nothing;
  // the track's end point keeps the elapsed time whole.
  return { state: next, point: null, verdict: moving ? 'between' : 'held' };
}

export interface FilterTally {
  ok: number;
  held: number;
  between: number;
  settling: number;
  inaccurate: number;
  stale: number;
  tooFast: number;
}

/** The fold: every fix through `stepFilter`. A track with no positions at all
 *  (a timer type's bookends) passes through untouched. */
export function filterTrack(points: readonly ActivityPoint[], type: ActivityType): { points: ActivityPoint[]; tally: FilterTally } {
  let state = initialFilterState(type);
  const out: ActivityPoint[] = [];
  const tally: FilterTally = { ok: 0, held: 0, between: 0, settling: 0, inaccurate: 0, stale: 0, tooFast: 0 };
  // A GPS track drops its position-less samples (a lost fix carries no place,
  // and a timestamp without one would break the moving-time arithmetic); a
  // track with NO positions at all — a timer type's bookends — passes whole.
  const hasPositions = points.some(p => typeof p.lat === 'number' && typeof p.lng === 'number');
  for (const p of points) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
      if (!hasPositions) out.push(p);
      continue;
    }
    const step = stepFilter(state, p as RawFix);
    state = step.state;
    if (step.verdict === 'too_fast') tally.tooFast += 1;
    else tally[step.verdict] += 1;
    if (step.point) out.push(step.point);
  }
  // The end of the track: the drawn route trails the filter by up to one step
  // while moving — the LAST point moves to the filtered position when it has
  // left the last drawn one by more than its own uncertainty (a walker who
  // stopped at the end does not: the wobble stays inside it).
  // The end of the track keeps the whole elapsed time: a final point at the
  // last accepted fix, at the filtered position when it has left the last
  // drawn one by more than its own uncertainty, else where it was drawn.
  let lastPos = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (typeof out[i].lat === 'number') {
      lastPos = i;
      break;
    }
  }
  if (state.phase === 'tracking' && lastPos >= 0) {
    const last = out[lastPos];
    const posSd = Math.sqrt(Math.max(0, (state.e.a + state.n.a) / 2));
    const moved = Math.hypot(state.e.p - state.outE, state.n.p - state.outN);
    const speed = Math.hypot(state.e.v, state.n.v);
    const velSd = Math.sqrt(Math.max(0, (state.e.c + state.n.c) / 2));
    const stillMoving = speed >= ACTIVITY_TYPE_DEFS[state.type].movingSpeed && speed >= SPEED_SD_K * velSd;
    const useFiltered = stillMoving || moved >= Math.max(MIN_STEP_M, STEP_SD_K * posSd);
    const ll = useFiltered ? toLatLng(state, state.e.p, state.n.p) : { lat: last.lat as number, lng: last.lng as number };
    if (state.lastT > last.t) out.push({ t: state.lastT, lat: ll.lat, lng: ll.lng });
    else out[lastPos] = { ...last, lat: ll.lat, lng: ll.lng };
  }
  return { points: out, tally };
}

/** A phone's altitude wobbles by metres a second: a 5-sample running median
 *  before the 3 m hysteresis keeps that noise out of the elevation gain. */
export const ELEVATION_MEDIAN_WINDOW = 5;

export function smoothElevation(points: readonly ActivityPoint[]): ActivityPoint[] {
  const idx: number[] = [];
  points.forEach((p, i) => {
    if (typeof p.ele === 'number') idx.push(i);
  });
  if (idx.length < ELEVATION_MEDIAN_WINDOW) return points.slice();
  const half = Math.floor(ELEVATION_MEDIAN_WINDOW / 2);
  const out = points.slice();
  for (let k = 0; k < idx.length; k++) {
    const window: number[] = [];
    for (let j = Math.max(0, k - half); j <= Math.min(idx.length - 1, k + half); j++) window.push(points[idx[j]].ele as number);
    window.sort((a, b) => a - b);
    out[idx[k]] = { ...points[idx[k]], ele: window[Math.floor(window.length / 2)] };
  }
  return out;
}

/** The phone recorder's route, as the phone and the server both draw and
 *  total it: the filter, then the elevation median. */
export function liveRoute(points: readonly ActivityPoint[], type: ActivityType): ActivityPoint[] {
  return smoothElevation(filterTrack(points, type).points);
}
