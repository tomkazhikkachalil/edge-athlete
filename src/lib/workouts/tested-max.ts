// ── A tested max: a best the athlete typed in, dated (Training redesign PR 6) ─
// Nov 11 2026, Tom's decision: ONE system of bests. There were two — the bests
// derived from logged sets, and "Personal Bests" typed into athlete_vitals
// (plus five lifts copied there at the end of a workout) — and they could
// disagree about the same lift. Now a lift's best comes from one fold: its
// logged sets AND its tested maxes, each a dated entry.
//
// A tested max is an athlete_vitals row in the `strength` category that the
// athlete entered: source `manual` (every row typed before this change) or
// `tested_max` (typed on the exercise's page since). A row with source
// `edge_vitals` is a COPY of a set, written by the old finish-step confirm —
// it is not read: the set it copied is already in the fold, and counting the
// copy as "earlier" would cancel that session's own record when replayed.
//
// It reads into the fold as one pseudo-session holding one set: a weight for
// one rep (heaviest and estimated 1-rep max are the number itself), or a rep
// count for a bodyweight exercise. It RAISES the bar later sessions must beat
// and is never itself announced as a record. Pure.

import { EXERCISE_MAP, exerciseRefOf } from '@/lib/workout-config';
import type { EntrySet } from './entries';
import type { ExerciseSession } from './exercise-list';

export const TESTED_MAX_SOURCE = 'tested_max';
/** The sources an athlete's own entry can carry (the copy-of-a-set source is not one). */
export const TESTED_MAX_SOURCES: readonly string[] = ['manual', TESTED_MAX_SOURCE];
export const TESTED_MAX_ID_PREFIX = 'tested:';

export interface TestedMaxRow {
  id: string;
  metric_key: string;
  metric_category: string;
  metric_label: string | null;
  value: number | string | null;
  unit: string | null;
  source: string | null;
  /** A DATE column: "2026-08-01". */
  recorded_at: string;
}

export function isTestedMaxRow(r: Pick<TestedMaxRow, 'metric_category' | 'source' | 'value'>): boolean {
  const v = typeof r.value === 'string' ? Number(r.value) : r.value;
  return r.metric_category === 'strength' && TESTED_MAX_SOURCES.includes(r.source ?? 'manual') && typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** The exercise a row is a tested max of: its key when the catalog knows it (the five lifts typed before this change), else its label's identity. */
export function testedMaxRef(r: Pick<TestedMaxRow, 'metric_key' | 'metric_label'>): string {
  return exerciseRefOf(r.metric_key, r.metric_label ?? r.metric_key);
}

/** The row as a pseudo-session of one set, dated at the START of its day: a workout on the same day comes after it. Null when the row is not a tested max. */
export function testedMaxSession(r: TestedMaxRow): ExerciseSession | null {
  if (!isTestedMaxRow(r) || !/^\d{4}-\d{2}-\d{2}/.test(r.recorded_at)) return null;
  const value = Number(r.value);
  const ref = testedMaxRef(r);
  const def = EXERCISE_MAP[ref];
  const reps = def?.inputMode === 'reps_only' || r.unit === 'reps';
  const set: EntrySet = {
    setNumber: 1,
    reps: reps ? Math.round(value) : 1,
    weight: reps ? null : value,
    weightUnit: reps ? null : r.unit === 'kg' ? 'kg' : 'lbs',
    durationSeconds: null,
    distance: null,
    distanceUnit: null,
    completedAt: null,
    media: [],
  };
  return {
    id: `${TESTED_MAX_ID_PREFIX}${r.id}`,
    startedAt: `${r.recorded_at.slice(0, 10)}T00:00:00.000Z`,
    title: 'Tested max',
    tested: true,
    exercises: [{ clientId: r.id, name: def?.label ?? r.metric_label ?? r.metric_key, exerciseKey: def ? ref : null, category: 'strength', notes: null, sets: [set] }],
  };
}

/** Every tested max among the rows, as sessions — optionally one exercise's. */
export function testedMaxSessions(rows: readonly TestedMaxRow[], ref?: string): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  for (const r of rows) {
    if (ref && testedMaxRef(r) !== ref) continue;
    const s = testedMaxSession(r);
    if (s) out.push(s);
  }
  return out;
}
