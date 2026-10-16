// ── Personal records for every exercise (activities details A10, Oct 16 2026) ─
// Pure. Hevy and Strong keep a record per exercise; the old detector knew
// five lifts (bench, squat, deadlift, OHP, pull-ups) as body metrics. Here the
// SETS are the one fact: an exercise's bests are derived from its logged sets
// — never stored — and a finished workout's new records are its bests that
// beat every earlier session's. The first time an exercise is logged sets a
// baseline, not a record (a record needs something to beat).
//
// Four kinds, all in lbs internally (toLbs is the one conversion):
//   heaviest  the heaviest weight lifted for at least one rep
//   e1rm      the best estimated one-rep max (Epley, sets of 1–12 reps —
//             past 12 the estimate is not worth a record)
//   reps      the most reps in one set with no weight (bodyweight work)
//   volume    the most reps × weight in one session

import { toLbs } from './summary';
import type { EntryExercise } from './entries';

export type PrKind = 'heaviest' | 'e1rm' | 'reps' | 'volume';

export const PR_LABELS: Readonly<Record<PrKind, string>> = {
  heaviest: 'Heaviest',
  e1rm: 'Est. 1-rep max',
  reps: 'Most reps',
  volume: 'Best volume',
};

export interface ExerciseBests {
  name: string;
  heaviest: number | null;
  e1rm: number | null;
  reps: number | null;
  volume: number | null;
}

export interface PrHit {
  exerciseId: string;
  name: string;
  kind: PrKind;
  /** lbs for weights, a count for reps. */
  value: number;
  previous: number;
}

/** One lift's identity across sessions: the catalog key, else the name (free-text "Bench Press" and catalog bench_press are one lift — summary.ts's rule). */
export const exerciseIdOf = (e: Pick<EntryExercise, 'exerciseKey' | 'name'>): string => e.exerciseKey ?? e.name.trim().toLowerCase();

/** Epley: weight × (1 + reps / 30); a single is itself; past 12 reps, none. */
export function epley(weightLbs: number, reps: number): number | null {
  if (!(weightLbs > 0) || !(reps >= 1) || reps > 12) return null;
  return reps === 1 ? weightLbs : weightLbs * (1 + reps / 30);
}

const max = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

/** The bests of ONE session's exercises (an exercise logged twice in a session is one lift). */
export function bestsOf(exercises: readonly EntryExercise[]): Map<string, ExerciseBests> {
  const out = new Map<string, ExerciseBests>();
  for (const ex of exercises) {
    const id = exerciseIdOf(ex);
    const b = out.get(id) ?? { name: ex.name, heaviest: null, e1rm: null, reps: null, volume: null };
    let volume = 0;
    for (const s of ex.sets) {
      const reps = s.reps !== null && s.reps > 0 ? s.reps : null;
      const lbs = s.weight !== null && s.weight > 0 ? toLbs(s.weight, s.weightUnit) : null;
      if (lbs !== null && reps !== null) {
        b.heaviest = max(b.heaviest, lbs);
        b.e1rm = max(b.e1rm, epley(lbs, reps));
        volume += lbs * reps;
      } else if (reps !== null && lbs === null) {
        b.reps = max(b.reps, reps);
      }
    }
    if (volume > 0) b.volume = (b.volume ?? 0) + volume;
    out.set(id, b);
  }
  return out;
}

/** Every session's bests folded into all-time bests. */
export function foldBests(sessions: Iterable<Map<string, ExerciseBests>>): Map<string, ExerciseBests> {
  const out = new Map<string, ExerciseBests>();
  for (const s of sessions) {
    for (const [id, b] of s) {
      const prev = out.get(id);
      out.set(
        id,
        prev
          ? { name: prev.name, heaviest: max(prev.heaviest, b.heaviest), e1rm: max(prev.e1rm, b.e1rm), reps: max(prev.reps, b.reps), volume: max(prev.volume, b.volume) }
          : { ...b }
      );
    }
  }
  return out;
}

const KINDS: readonly PrKind[] = ['heaviest', 'e1rm', 'reps', 'volume'];
/** A record must beat the old one by more than rounding (0.1 lb / 1 rep). */
const EPS = 0.05;

/**
 * This session's new records: a kind whose value beats the athlete's earlier
 * best for that exercise. An exercise (or a kind) with no earlier value is a
 * baseline, never a record. Ordered by exercise, then kind.
 */
export function newPRs(current: Map<string, ExerciseBests>, history: ReadonlyMap<string, ExerciseBests>): PrHit[] {
  const out: PrHit[] = [];
  for (const [id, now] of current) {
    const before = history.get(id);
    if (!before) continue;
    for (const kind of KINDS) {
      const v = now[kind];
      const p = before[kind];
      if (v === null || p === null) continue;
      if (v > p + EPS) out.push({ exerciseId: id, name: now.name, kind, value: v, previous: p });
    }
  }
  return out;
}

/** The ONE spelling of a record: "225 lbs" (the app's spelling) / "102.1 kg" / "15 reps"; `bare` drops the unit (a table column says it). */
export function formatPr(kind: PrKind, value: number, unit: 'lb' | 'kg', bare = false): string {
  if (kind === 'reps') return bare ? `${Math.round(value)}` : `${Math.round(value)} reps`;
  const v = unit === 'kg' ? value / 2.20462 : value;
  const shown = kind === 'volume' ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString();
  return bare ? shown : `${shown} ${unit === 'kg' ? 'kg' : 'lbs'}`;
}

/** Column headers short enough for 375 px. */
export const PR_SHORT_LABELS: Readonly<Record<PrKind, string>> = { heaviest: 'Heaviest', e1rm: 'Est. 1RM', reps: 'Reps', volume: 'Volume' };

/** The unit a workout reads in: the one most of its weighted sets were logged in (lb on a tie). */
export function workoutUnit(exercises: readonly EntryExercise[]): 'lb' | 'kg' {
  let kg = 0;
  let lb = 0;
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (s.weight === null || !(s.weight > 0)) continue;
      if (s.weightUnit === 'kg') kg++;
      else lb++;
    }
  }
  return kg > lb ? 'kg' : 'lb';
}
