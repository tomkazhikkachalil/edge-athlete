// ── The rest timer and the stopwatch — pure rules (workout screen PR 4) ─────
// Tom: "Rest. Starts a rest timer between sets. It records how long each rest
// lasted. Users can set an optional target rest time with a gentle alert when
// it is up. Stopwatch. A separate stopwatch for timed exercises such as planks
// or sprints. The time can be saved to the current set with one tap. Rest and
// stopwatch times do not pause the main workout timer."
//
// Both are SCREEN state (timers-store.ts keeps them on the device so a reload
// keeps a running rest or stopwatch); what they produce lands on the SET: a
// rest on `restSeconds` of the set completed next (260), a stopwatch time on
// `durationSeconds` (a plank's time IS the set's duration). Every number here
// is derived from timestamps, never counted.

import { EXERCISE_MAP } from '@/lib/workout-config';
import type { EntryExercise, EntrySet } from './entries';
import { setHasData } from './summary';

/** A rest in progress, or one stopped by hand and held for the next completed set. */
export interface RestTimer {
  /** Epoch ms the rest started; null when not running. */
  startedAt: number | null;
  /** A stopped rest's seconds, waiting for the next completed set; null when none. */
  heldS: number | null;
}

export const REST_IDLE: RestTimer = { startedAt: null, heldS: null };
export const REST_TARGET_PRESETS_S = [30, 60, 90, 120, 180] as const;

export function startRest(now: number): RestTimer {
  return { startedAt: now, heldS: null };
}

/** Stop by hand: the seconds are HELD for the next completed set. */
export function stopRest(rest: RestTimer, now: number): RestTimer {
  if (rest.startedAt === null) return rest;
  return { startedAt: null, heldS: restElapsedS(rest, now) };
}

export function restElapsedS(rest: RestTimer, now: number): number {
  if (rest.startedAt !== null) return Math.max(0, Math.floor((now - rest.startedAt) / 1000));
  return rest.heldS ?? 0;
}

/** The rest the set completed now carries: the running one (ended here) or the held one; null when neither. */
export function restForCompletedSet(rest: RestTimer, now: number): number | null {
  if (rest.startedAt !== null) return restElapsedS(rest, now);
  return rest.heldS;
}

/** True once a running rest has reached its target (a target of null is no target). */
export function restTargetReached(rest: RestTimer, targetS: number | null, now: number): boolean {
  return rest.startedAt !== null && targetS !== null && restElapsedS(rest, now) >= targetS;
}

/** The set whose completion just happened (completedAt null → set), by index; null when none did. */
export function completedSetDiff(prev: EntryExercise, next: EntryExercise): number | null {
  for (let i = 0; i < next.sets.length; i++) {
    const before = prev.sets[i];
    const after = next.sets[i];
    if (after?.completedAt && (!before || !before.completedAt)) return i;
  }
  return null;
}

// ── The stopwatch ────────────────────────────────────────────────────────────

export interface Stopwatch {
  /** Epoch ms of the current run; null while stopped. */
  runningSince: number | null;
  /** Closed runs, ms. */
  accumulatedMs: number;
}

export const STOPWATCH_IDLE: Stopwatch = { runningSince: null, accumulatedMs: 0 };

export function stopwatchStart(sw: Stopwatch, now: number): Stopwatch {
  return sw.runningSince !== null ? sw : { ...sw, runningSince: now };
}
export function stopwatchStop(sw: Stopwatch, now: number): Stopwatch {
  return sw.runningSince === null ? sw : { runningSince: null, accumulatedMs: sw.accumulatedMs + Math.max(0, now - sw.runningSince) };
}
export function stopwatchReset(): Stopwatch {
  return STOPWATCH_IDLE;
}
export function stopwatchElapsedMs(sw: Stopwatch, now: number): number {
  return sw.accumulatedMs + (sw.runningSince !== null ? Math.max(0, now - sw.runningSince) : 0);
}

export interface SetTarget {
  clientId: string;
  /** 0-based index into the exercise's sets. */
  setIndex: number;
}

/** A timed-exercise input mode (a plank, a sprint): the stopwatch's natural home. */
export function isDurationExercise(e: Pick<EntryExercise, 'exerciseKey'>): boolean {
  const mode = e.exerciseKey ? EXERCISE_MAP[e.exerciseKey]?.inputMode : undefined;
  return mode === 'duration' || mode === 'distance_duration';
}

/**
 * "The current set" for Save to set: the first set without data of the
 * exercise touched last, else of the first duration-mode exercise, else of
 * the first exercise with such a set; null when every set is filled.
 */
export function stopwatchTarget(exercises: ReadonlyArray<EntryExercise>, lastEditedClientId: string | null): SetTarget | null {
  const firstEmpty = (e: EntryExercise): SetTarget | null => {
    const i = e.sets.findIndex(s => !setHasData(s));
    return i >= 0 ? { clientId: e.clientId, setIndex: i } : null;
  };
  const last = lastEditedClientId ? exercises.find(e => e.clientId === lastEditedClientId) : undefined;
  const fromLast = last ? firstEmpty(last) : null;
  if (fromLast) return fromLast;
  for (const e of exercises) if (isDurationExercise(e)) { const t = firstEmpty(e); if (t) return t; }
  for (const e of exercises) { const t = firstEmpty(e); if (t) return t; }
  return null;
}

/** The stopwatch's time onto a set: whole seconds into durationSeconds; the set is complete if it was not. */
export function applyStopwatchToSet(set: EntrySet, elapsedMs: number, nowIso: string): EntrySet {
  return { ...set, durationSeconds: Math.max(1, Math.round(elapsedMs / 1000)), completedAt: set.completedAt ?? nowIso };
}

/** "Plank · set 2" — the target's name in the bar. */
export function describeTarget(exercises: ReadonlyArray<EntryExercise>, t: SetTarget | null): string | null {
  if (!t) return null;
  const e = exercises.find(x => x.clientId === t.clientId);
  if (!e) return null;
  return `${e.name} · ${e.groupId ? 'round' : 'set'} ${t.setIndex + 1}`;
}
