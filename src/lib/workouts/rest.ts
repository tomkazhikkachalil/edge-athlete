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
  /** Rests ended by hand and then followed by another rest before a set was
   *  completed — banked, never dropped (Oct 22 2026): they join the next
   *  completed set's rest and the workout's total. */
  bankedS: number;
}

export const REST_IDLE: RestTimer = { startedAt: null, heldS: null, bankedS: 0 };

// ── The rest's colour (Rest timer round, Oct 22 2026) ────────────────────────
// Tom: "Purple from the moment the user starts the rest. Never red at the
// start. Yellow: a warning 5 seconds before the target time. Red: when the
// target time is reached. Flashing red: from 5 seconds after the target time.
// Everything stops and resets when the user taps the rest timer to end the
// rest." With the target Off a rest is purple the whole way (still timed,
// still counted — Tom's decision).
export const REST_WARN_S = 5;
export const REST_OVERDUE_S = 5;
export type RestPhase = 'idle' | 'running' | 'warning' | 'reached' | 'overdue';

export function restPhase(rest: RestTimer, targetS: number | null, now: number): RestPhase {
  if (rest.startedAt === null) return 'idle';
  if (targetS === null) return 'running';
  const elapsed = restElapsedS(rest, now);
  if (elapsed >= targetS + REST_OVERDUE_S) return 'overdue';
  if (elapsed >= targetS) return 'reached';
  if (targetS - elapsed <= REST_WARN_S) return 'warning';
  return 'running';
}

/**
 * The workout's total rest so far (the bubble beside the clock, Oct 22 2026):
 * every set's recorded rest, plus what is banked or held for the next
 * completed set. A RUNNING rest is not in it until it ends — the bubble
 * appears when the athlete ends a rest, and each later rest is added.
 */
export function restTotalS(rest: RestTimer, exercises: ReadonlyArray<Pick<EntryExercise, 'sets'>>): number {
  let total = rest.bankedS + (rest.heldS ?? 0);
  for (const e of exercises) for (const s of e.sets) if (typeof s.restSeconds === 'number' && s.restSeconds > 0) total += s.restSeconds;
  return total;
}
// Rest timer round (Oct 22 2026): there are NO built-in rest presets — every
// time is the athlete's own (the wheels), used for this workout or saved as
// a preset that stays until deleted.

// ── A custom rest time, saved as a preset (Training fixes PR 3, Oct 21 2026) ──
// Tom: "Let the user set their own rest time, not only the presets … a quick
// scroll picker for minutes and seconds, and save the chosen time as a preset
// they can reuse." The saved ones are a device list (timer-prefs.ts) read
// through these rules. Oct 22 2026: the built-in five are gone — the panel
// opens on the wheels, and the chips are the athlete's saved times only.

/** The most saved presets kept. */
export const MAX_SAVED_REST_PRESETS = 6;
export const MIN_REST_PRESET_S = 5;
export const MAX_REST_PRESET_S = 60 * 60;

/** A whole number of seconds a rest target may be: 5 s to an hour. */
export function isValidRestSeconds(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_REST_PRESET_S && v <= MAX_REST_PRESET_S;
}

/** A stored value → the valid, deduplicated seconds it names, at most `max`. */
export function parseRestPresets(raw: unknown, max = MAX_SAVED_REST_PRESETS): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) if (isValidRestSeconds(v) && !out.includes(v)) out.push(v);
  return out.slice(0, max);
}

/** Save a time: the newest first, no duplicate, at most `max`. */
export function addRestPreset(saved: readonly number[], seconds: number, max = MAX_SAVED_REST_PRESETS): number[] {
  if (!isValidRestSeconds(seconds)) return [...saved];
  return [seconds, ...saved.filter(s => s !== seconds)].slice(0, max);
}

export function removeRestPreset(saved: readonly number[], seconds: number): number[] {
  return saved.filter(s => s !== seconds);
}

/** The chips the panel shows: the athlete's saved times, ascending, no duplicate; every one carries a remove. */
export function restPresetChips(saved: readonly number[]): Array<{ seconds: number; saved: boolean }> {
  return [...new Set(saved)].sort((a, b) => a - b).map(s => ({ seconds: s, saved: true }));
}

/** The picker's two wheels from a number of seconds, and back. */
export function splitRest(seconds: number): { minutes: number; seconds: number } {
  const s = Math.max(0, Math.floor(seconds));
  return { minutes: Math.floor(s / 60), seconds: s % 60 };
}
export function joinRest(minutes: number, seconds: number): number {
  return Math.max(0, Math.floor(minutes)) * 60 + Math.max(0, Math.floor(seconds));
}

/** Start a rest; a rest held from before is BANKED (it still counts), never dropped. */
export function startRest(rest: RestTimer, now: number): RestTimer {
  if (rest.startedAt !== null) return rest;
  return { startedAt: now, heldS: null, bankedS: rest.bankedS + (rest.heldS ?? 0) };
}

/** Stop by hand: the seconds are HELD for the next completed set. */
export function stopRest(rest: RestTimer, now: number): RestTimer {
  if (rest.startedAt === null) return rest;
  return { startedAt: null, heldS: restElapsedS(rest, now), bankedS: rest.bankedS };
}

export function restElapsedS(rest: RestTimer, now: number): number {
  if (rest.startedAt !== null) return Math.max(0, Math.floor((now - rest.startedAt) / 1000));
  return rest.heldS ?? 0;
}

/** The rest the set completed now carries: the running one (ended here) or the held one, plus what was banked; null when nothing. */
export function restForCompletedSet(rest: RestTimer, now: number): number | null {
  const own = rest.startedAt !== null ? restElapsedS(rest, now) : rest.heldS;
  if (own === null && rest.bankedS === 0) return null;
  return (own ?? 0) + rest.bankedS;
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
