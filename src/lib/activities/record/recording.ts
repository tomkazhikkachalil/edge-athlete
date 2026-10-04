// ── The recorder's state machine (Live Activities, Oct 4 2026) — pure ──────
// Tom: walks, runs, rides and every timed activity recorded LIVE from the
// phone — a timer, GPS, a map, segments marked on the way, photos as tiles.
// This file is the whole rule, with no browser in it: the screen feeds it
// events (a fix, a tap, the page hidden) and reads totals from it; storage.ts
// persists it so a reload loses nothing; toRecordingWire() turns the finished
// state into the ONE payload the server already knows (`format: 'live'`).
//
// Facts the design rests on: a web page gets GPS only in the FOREGROUND with
// the screen on (iOS and Android alike), so the screen holds a wake lock and
// a hidden page opens a GAP that is shown honestly; nothing is admitted while
// paused, so a pause is a gap the server's 30 s rule already keeps out of
// moving time; steps are an ESTIMATE (normalize.ts estimateSteps — the same
// function the server runs); every total here is for the live display — the
// server recomputes all of them at import.

import { ACTIVITY_TYPE_DEFS, type ActivityType } from '../catalog';
import { cumulativeDistances, estimateSteps, haversineM, PAUSE_GAP_S } from '../normalize';
import { normalizeSegments, SEGMENT_MIN_S, type ActivitySegment, type SegmentKind } from '../segments';
import { toWire } from '../wire';
import type { ActivityPoint } from '../types';
import type { WireActivity } from '../wire';

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'finished';

/** A fix the recorder rejects: too imprecise, a GPS jump, or out of order. */
export type FixVerdict = 'ok' | 'inaccurate' | 'too_fast' | 'stale';

/** Fixes less precise than this are not a position. */
export const MAX_ACCURACY_M = 50;
/** A hop faster than the type's maxSpeed × this is a GPS jump (the server
 *  cleans again at 3×). */
export const SPEED_SLACK = 1.5;
/** The window the live "current pace" reads over. */
export const PACE_WINDOW_S = 30;
/** A hidden page longer than this is told about on return. */
export const GAP_NOTICE_S = PAUSE_GAP_S;

export interface RecordingPhoto {
  /** The device's own id for the tile (the pending blob's key in storage.ts). */
  localId: string;
  type: 'image' | 'video';
  /** Seconds into the recording when it was taken. */
  atS: number;
  /** Set once the upload finished (the stored URL the server returns). */
  url: string | null;
  thumbnailUrl: string | null;
  /** The upload failed; the finish sheet offers Retry / Drop. */
  failed: boolean;
}

export interface RecordingGap {
  fromMs: number;
  toMs: number | null;
}

export interface RecordingState {
  v: 1;
  id: string;
  profileId: string;
  type: ActivityType;
  status: RecordingStatus;
  /** Epoch ms — the start, and the last pause's start while paused. */
  startedAt: number | null;
  pausedAt: number | null;
  /** Total paused time so far (closed pauses only). */
  pausedTotalMs: number;
  finishedAt: number | null;
  points: ActivityPoint[];
  rejected: { inaccurate: number; tooFast: number; stale: number };
  segments: ActivitySegment[];
  /** A segment opened by Mark and not yet ended (seconds into the recording). */
  openSegmentFromS: number | null;
  photos: RecordingPhoto[];
  /** Spans the page was hidden (GPS cannot arrive) — shown honestly. */
  gaps: RecordingGap[];
  /** A timer type's distance, typed at finish. */
  manualDistanceM: number | null;
  name: string | null;
}

export type RecordingEvent =
  | { type: 'start'; now: number }
  | { type: 'fix'; fix: { t: number; lat: number; lng: number; ele?: number | null; accuracy?: number | null } }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'markStart'; now: number }
  | { type: 'markEnd'; now: number; kind: SegmentKind; label?: string | null; id: string }
  | { type: 'photoAdded'; localId: string; mediaType: 'image' | 'video'; now: number }
  | { type: 'photoUploaded'; localId: string; url: string; thumbnailUrl?: string | null }
  | { type: 'photoFailed'; localId: string }
  | { type: 'photoRemoved'; localId: string }
  | { type: 'hidden'; now: number }
  | { type: 'visible'; now: number }
  | { type: 'setManualDistance'; distanceM: number | null }
  | { type: 'setName'; name: string | null }
  | { type: 'finish'; now: number };

export function newRecording(id: string, profileId: string, type: ActivityType): RecordingState {
  return {
    v: 1,
    id,
    profileId,
    type,
    status: 'idle',
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    finishedAt: null,
    points: [],
    rejected: { inaccurate: 0, tooFast: 0, stale: 0 },
    segments: [],
    openSegmentFromS: null,
    photos: [],
    gaps: [],
    manualDistanceM: null,
    name: null,
  };
}

/** Whether a type records a GPS track (else a timer, distance at finish). */
export function recordsGps(type: ActivityType): boolean {
  return ACTIVITY_TYPE_DEFS[type].recording === 'gps';
}

/** Whether a type takes a distance at finish (a timer type). */
export function takesManualDistance(type: ActivityType): boolean {
  return ACTIVITY_TYPE_DEFS[type].recording === 'timer';
}

/** Seconds into the recording at `now`, pauses excluded. */
export function elapsedS(state: RecordingState, now: number): number {
  if (state.startedAt === null) return 0;
  const end = state.finishedAt ?? (state.status === 'paused' && state.pausedAt !== null ? state.pausedAt : now);
  return Math.max(0, Math.floor((end - state.startedAt - state.pausedTotalMs) / 1000));
}

/** Is a fix admitted, and if not, why. Nothing is admitted while paused. */
export function admitFix(
  state: RecordingState,
  fix: { t: number; lat: number; lng: number; accuracy?: number | null }
): FixVerdict {
  if (typeof fix.accuracy === 'number' && fix.accuracy > MAX_ACCURACY_M) return 'inaccurate';
  const prev = state.points[state.points.length - 1];
  if (prev) {
    if (fix.t <= prev.t) return 'stale';
    if (typeof prev.lat === 'number' && typeof prev.lng === 'number') {
      const dt = (fix.t - prev.t) / 1000;
      const speed = haversineM(prev.lat, prev.lng, fix.lat, fix.lng) / Math.max(dt, 0.001);
      if (speed > ACTIVITY_TYPE_DEFS[state.type].maxSpeed * SPEED_SLACK) return 'too_fast';
    }
  }
  return 'ok';
}

export function reduce(state: RecordingState, event: RecordingEvent): RecordingState {
  switch (event.type) {
    case 'start': {
      if (state.status !== 'idle') return state;
      return { ...state, status: 'recording', startedAt: event.now };
    }
    case 'fix': {
      if (state.status !== 'recording') return state;
      const verdict = admitFix(state, event.fix);
      if (verdict !== 'ok') {
        const key = verdict === 'inaccurate' ? 'inaccurate' : verdict === 'too_fast' ? 'tooFast' : 'stale';
        return { ...state, rejected: { ...state.rejected, [key]: state.rejected[key] + 1 } };
      }
      const point: ActivityPoint = { t: event.fix.t, lat: event.fix.lat, lng: event.fix.lng };
      if (typeof event.fix.ele === 'number' && Number.isFinite(event.fix.ele)) point.ele = event.fix.ele;
      return { ...state, points: [...state.points, point] };
    }
    case 'pause': {
      if (state.status !== 'recording') return state;
      // An open segment ends with the pause — a sprint does not span a rest.
      const next = closeOpenSegment(state, event.now, 'interval', null, `seg-${event.now}`);
      return { ...next, status: 'paused', pausedAt: event.now };
    }
    case 'resume': {
      if (state.status !== 'paused' || state.pausedAt === null) return state;
      return { ...state, status: 'recording', pausedAt: null, pausedTotalMs: state.pausedTotalMs + Math.max(0, event.now - state.pausedAt) };
    }
    case 'markStart': {
      if (state.status !== 'recording' || state.openSegmentFromS !== null) return state;
      return { ...state, openSegmentFromS: elapsedS(state, event.now) };
    }
    case 'markEnd': {
      if (state.status !== 'recording' || state.openSegmentFromS === null) return state;
      return closeOpenSegment(state, event.now, event.kind, event.label ?? null, event.id);
    }
    case 'photoAdded': {
      if (state.status === 'idle' || state.status === 'finished') return state;
      if (state.photos.some(p => p.localId === event.localId)) return state;
      const photo: RecordingPhoto = { localId: event.localId, type: event.mediaType, atS: elapsedS(state, event.now), url: null, thumbnailUrl: null, failed: false };
      return { ...state, photos: [...state.photos, photo] };
    }
    case 'photoUploaded':
      return { ...state, photos: state.photos.map(p => (p.localId === event.localId ? { ...p, url: event.url, thumbnailUrl: event.thumbnailUrl ?? null, failed: false } : p)) };
    case 'photoFailed':
      return { ...state, photos: state.photos.map(p => (p.localId === event.localId ? { ...p, failed: true } : p)) };
    case 'photoRemoved':
      return { ...state, photos: state.photos.filter(p => p.localId !== event.localId) };
    case 'hidden': {
      if (state.status !== 'recording') return state;
      if (state.gaps.some(g => g.toMs === null)) return state;
      return { ...state, gaps: [...state.gaps, { fromMs: event.now, toMs: null }] };
    }
    case 'visible': {
      const open = state.gaps.findIndex(g => g.toMs === null);
      if (open === -1) return state;
      const gaps = state.gaps.slice();
      gaps[open] = { ...gaps[open], toMs: event.now };
      return { ...state, gaps };
    }
    case 'setManualDistance':
      return { ...state, manualDistanceM: event.distanceM !== null && Number.isFinite(event.distanceM) && event.distanceM >= 0 ? event.distanceM : null };
    case 'setName':
      return { ...state, name: event.name && event.name.trim() ? event.name.trim().slice(0, 120) : null };
    case 'finish': {
      if (state.status !== 'recording' && state.status !== 'paused') return state;
      let next = state;
      if (state.status === 'paused' && state.pausedAt !== null) {
        next = { ...next, pausedTotalMs: next.pausedTotalMs + Math.max(0, event.now - state.pausedAt), pausedAt: null, status: 'recording' };
      }
      next = closeOpenSegment(next, event.now, 'interval', null, `seg-${event.now}`);
      const gaps = next.gaps.map(g => (g.toMs === null ? { ...g, toMs: event.now } : g));
      return { ...next, status: 'finished', finishedAt: event.now, gaps };
    }
    default:
      return state;
  }
}

function closeOpenSegment(state: RecordingState, now: number, kind: SegmentKind, label: string | null, id: string): RecordingState {
  if (state.openSegmentFromS === null) return state;
  const to = elapsedS(state, now);
  const seg: ActivitySegment = { id, kind, from_s: state.openSegmentFromS, to_s: to };
  if (label && label.trim()) seg.label = label.trim().slice(0, 40);
  const segments = to - seg.from_s >= SEGMENT_MIN_S ? [...state.segments, seg] : state.segments;
  return { ...state, segments, openSegmentFromS: null };
}

/** The last gap the page was hidden for, in seconds — the return toast. */
export function lastGapS(state: RecordingState): number {
  const g = state.gaps[state.gaps.length - 1];
  if (!g || g.toMs === null) return 0;
  return Math.round((g.toMs - g.fromMs) / 1000);
}

export interface LiveTotals {
  elapsedS: number;
  distanceM: number;
  movingS: number;
  elevGainM: number | null;
  /** Seconds per metre over the last PACE_WINDOW_S of points (null when still). */
  currentPaceSPerM: number | null;
  avgPaceSPerM: number | null;
  /** The live speed (m/s) over the same window. */
  currentSpeedMps: number | null;
  steps: number | null;
  /** The last admitted fix's accuracy is the screen's; this says how long ago it came. */
  lastFixAgeS: number | null;
}

/** What the screen shows while recording. The server recomputes every one. */
export function liveTotals(state: RecordingState, now: number, heightCm: number | null | undefined): LiveTotals {
  const elapsed = elapsedS(state, now);
  const def = ACTIVITY_TYPE_DEFS[state.type];
  const pts = state.points;
  let distanceM = 0;
  let movingS = 0;
  let gain: number | null = null;
  if (pts.length >= 2) {
    const d = cumulativeDistances(pts);
    distanceM = d[d.length - 1];
    let anchor: number | null = null;
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt <= 0 || dt > PAUSE_GAP_S) continue;
      const speed = (d[i] - d[i - 1]) / dt;
      if (speed >= def.movingSpeed) movingS += dt;
    }
    for (const p of pts) {
      if (typeof p.ele !== 'number') continue;
      if (anchor === null) {
        anchor = p.ele;
        gain = 0;
        continue;
      }
      const delta = p.ele - anchor;
      if (delta >= 3) {
        gain = (gain ?? 0) + delta;
        anchor = p.ele;
      } else if (delta <= -3) anchor = p.ele;
    }
  } else if (state.manualDistanceM !== null) {
    distanceM = state.manualDistanceM;
    movingS = elapsed;
  }
  if (state.manualDistanceM !== null && pts.length < 2) movingS = elapsed;
  movingS = Math.round(movingS);

  // The current pace: the window's distance over its time, from the fixes.
  let currentPace: number | null = null;
  let currentSpeed: number | null = null;
  if (pts.length >= 2 && state.status === 'recording') {
    const last = pts[pts.length - 1];
    const windowStart = last.t - PACE_WINDOW_S * 1000;
    let i = pts.length - 1;
    while (i > 0 && pts[i - 1].t >= windowStart) i--;
    const first = pts[i];
    const dt = (last.t - first.t) / 1000;
    if (dt >= 5 && typeof first.lat === 'number' && typeof first.lng === 'number' && typeof last.lat === 'number' && typeof last.lng === 'number') {
      let dist = 0;
      for (let k = i + 1; k < pts.length; k++) {
        dist += haversineM(pts[k - 1].lat as number, pts[k - 1].lng as number, pts[k].lat as number, pts[k].lng as number);
      }
      const speed = dist / dt;
      currentSpeed = speed;
      currentPace = speed >= def.movingSpeed ? dt / dist : null;
    }
  }
  const avgPace = distanceM > 0 && movingS > 0 ? movingS / distanceM : null;
  const lastFix = pts[pts.length - 1];
  return {
    elapsedS: elapsed,
    distanceM: Math.round(distanceM * 10) / 10,
    movingS,
    elevGainM: gain === null ? null : Math.round(gain * 10) / 10,
    currentPaceSPerM: currentPace,
    avgPaceSPerM: avgPace,
    currentSpeedMps: currentSpeed,
    steps: estimateSteps(state.type, distanceM, movingS, heightCm),
    lastFixAgeS: lastFix ? Math.max(0, Math.round((now - lastFix.t) / 1000)) : null,
  };
}

/**
 * The finished recording as the ONE payload the import route knows — a GPS
 * type sends its fixes; a timer or duration type sends the two bookend
 * samples (start, finish) and the typed distance as the device total, which
 * the server's existing device-total branch keeps when the fixes measure
 * nothing. Segments are clamped to the recording's seconds.
 */
export function toRecordingWire(state: RecordingState, tz: string | null): WireActivity {
  if (state.status !== 'finished' || state.startedAt === null || state.finishedAt === null) {
    throw new Error('not finished');
  }
  const elapsed = elapsedS(state, state.finishedAt);
  const points: ActivityPoint[] =
    state.points.length >= 2
      ? state.points
      : [
          { t: state.startedAt, dist: 0 },
          { t: state.finishedAt, dist: state.manualDistanceM ?? 0 },
        ];
  const wire = toWire(
    {
      format: 'live',
      type: state.type,
      name: state.name,
      points,
      device: {
        elapsedS: elapsed,
        ...(state.manualDistanceM !== null && state.points.length < 2 ? { distanceM: state.manualDistanceM, movingS: elapsed } : {}),
      },
      tzOffsetMin: null,
    },
    tz
  );
  return { ...wire, recordingId: state.id, segments: normalizeSegments(state.segments, elapsed) };
}
