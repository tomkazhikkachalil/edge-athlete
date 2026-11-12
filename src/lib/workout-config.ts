/**
 * Training exercise catalog — the curated exercise list for the workout
 * editor. Each exercise declares which inputs its sets use and (for the
 * mapped lifts) which body metric it can feed as a PR.
 */

import { buildSlugToKey, exerciseRef } from './workouts/exercise-identity';

export type ExerciseInputMode = 'reps_weight' | 'reps_only' | 'duration' | 'distance_duration';
export type ExerciseCategory = 'strength' | 'cardio' | 'mobility';

/**
 * Where an exercise lives in Training's Exercises view (Training redesign PR 5,
 * Nov 11 2026): the body area it trains first. A grouping for a list, not a
 * claim about anatomy — one area per exercise, no secondary muscles.
 */
export type BodyArea = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'full_body' | 'cardio' | 'mobility' | 'other';

/** The areas in the order the list shows them; `other` (an exercise the catalog does not know) is last. */
export const BODY_AREAS: ReadonlyArray<{ id: BodyArea; label: string }> = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back' },
  { id: 'legs', label: 'Legs' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'arms', label: 'Arms' },
  { id: 'core', label: 'Core' },
  { id: 'full_body', label: 'Full body' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'mobility', label: 'Mobility & Recovery' },
  { id: 'other', label: 'Other' },
];

export interface CatalogExercise {
  key: string;
  label: string;
  bodyArea: BodyArea;
  category: ExerciseCategory;
  inputMode: ExerciseInputMode;
  /** Maps to a body-metrics-config metric for PR detection (5 mapped lifts). */
  bodyMetricKey?: 'bench_press' | 'squat' | 'deadlift' | 'overhead_press' | 'pull_ups';
}

export const EXERCISE_CATALOG: CatalogExercise[] = [
  // ── Strength ──────────────────────────────────────────────────────────────
  { key: 'bench_press', label: 'Bench Press', bodyArea: 'chest', category: 'strength', inputMode: 'reps_weight', bodyMetricKey: 'bench_press' },
  { key: 'incline_bench_press', label: 'Incline Bench Press', bodyArea: 'chest', category: 'strength', inputMode: 'reps_weight' },
  { key: 'squat', label: 'Squat', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight', bodyMetricKey: 'squat' },
  { key: 'front_squat', label: 'Front Squat', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight' },
  { key: 'deadlift', label: 'Deadlift', bodyArea: 'back', category: 'strength', inputMode: 'reps_weight', bodyMetricKey: 'deadlift' },
  { key: 'romanian_deadlift', label: 'Romanian Deadlift', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight' },
  { key: 'overhead_press', label: 'Overhead Press', bodyArea: 'shoulders', category: 'strength', inputMode: 'reps_weight', bodyMetricKey: 'overhead_press' },
  { key: 'pull_ups', label: 'Pull-Ups', bodyArea: 'back', category: 'strength', inputMode: 'reps_only', bodyMetricKey: 'pull_ups' },
  { key: 'chin_ups', label: 'Chin-Ups', bodyArea: 'back', category: 'strength', inputMode: 'reps_only' },
  { key: 'push_ups', label: 'Push-Ups', bodyArea: 'chest', category: 'strength', inputMode: 'reps_only' },
  { key: 'dips', label: 'Dips', bodyArea: 'arms', category: 'strength', inputMode: 'reps_only' },
  { key: 'barbell_row', label: 'Barbell Row', bodyArea: 'back', category: 'strength', inputMode: 'reps_weight' },
  { key: 'dumbbell_row', label: 'Dumbbell Row', bodyArea: 'back', category: 'strength', inputMode: 'reps_weight' },
  { key: 'lat_pulldown', label: 'Lat Pulldown', bodyArea: 'back', category: 'strength', inputMode: 'reps_weight' },
  { key: 'bicep_curl', label: 'Bicep Curl', bodyArea: 'arms', category: 'strength', inputMode: 'reps_weight' },
  { key: 'tricep_extension', label: 'Tricep Extension', bodyArea: 'arms', category: 'strength', inputMode: 'reps_weight' },
  { key: 'lateral_raise', label: 'Lateral Raise', bodyArea: 'shoulders', category: 'strength', inputMode: 'reps_weight' },
  { key: 'lunge', label: 'Lunges', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight' },
  { key: 'leg_press', label: 'Leg Press', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight' },
  { key: 'leg_curl', label: 'Leg Curl', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight' },
  { key: 'calf_raise', label: 'Calf Raise', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight' },
  { key: 'hip_thrust', label: 'Hip Thrust', bodyArea: 'legs', category: 'strength', inputMode: 'reps_weight' },
  { key: 'kettlebell_swing', label: 'Kettlebell Swing', bodyArea: 'full_body', category: 'strength', inputMode: 'reps_weight' },
  { key: 'clean', label: 'Power Clean', bodyArea: 'full_body', category: 'strength', inputMode: 'reps_weight' },
  { key: 'snatch', label: 'Snatch', bodyArea: 'full_body', category: 'strength', inputMode: 'reps_weight' },
  { key: 'med_ball_slam', label: 'Med Ball Slam', bodyArea: 'full_body', category: 'strength', inputMode: 'reps_weight' },
  { key: 'sit_ups', label: 'Sit-Ups', bodyArea: 'core', category: 'strength', inputMode: 'reps_only' },

  // ── Cardio ────────────────────────────────────────────────────────────────
  // Live Activities (Oct 4 2026): a walk or a hike in a gym session is a
  // distance + time, never reps × weight — the recorder (/activities/record)
  // is the place for the live, mapped version.
  { key: 'walk', label: 'Walk', bodyArea: 'cardio', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'hike', label: 'Hike', bodyArea: 'cardio', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'run', label: 'Run', bodyArea: 'cardio', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'sprint', label: 'Sprints', bodyArea: 'cardio', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'bike', label: 'Bike', bodyArea: 'cardio', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'row_erg', label: 'Rowing (Erg)', bodyArea: 'cardio', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'swim', label: 'Swim', bodyArea: 'cardio', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'stair_climber', label: 'Stair Climber', bodyArea: 'cardio', category: 'cardio', inputMode: 'duration' },
  { key: 'elliptical', label: 'Elliptical', bodyArea: 'cardio', category: 'cardio', inputMode: 'duration' },
  { key: 'jump_rope', label: 'Jump Rope', bodyArea: 'cardio', category: 'cardio', inputMode: 'duration' },
  { key: 'hiit_circuit', label: 'HIIT Circuit', bodyArea: 'cardio', category: 'cardio', inputMode: 'duration' },

  // ── Mobility / recovery ───────────────────────────────────────────────────
  { key: 'plank', label: 'Plank', bodyArea: 'core', category: 'mobility', inputMode: 'duration' },
  { key: 'stretching', label: 'Stretching', bodyArea: 'mobility', category: 'mobility', inputMode: 'duration' },
  { key: 'yoga', label: 'Yoga', bodyArea: 'mobility', category: 'mobility', inputMode: 'duration' },
  { key: 'foam_roll', label: 'Foam Rolling', bodyArea: 'mobility', category: 'mobility', inputMode: 'duration' },
];

export const EXERCISE_MAP: Record<string, CatalogExercise> = Object.fromEntries(
  EXERCISE_CATALOG.map(e => [e.key, e])
);

/**
 * Other spellings athletes type for a catalog exercise (slugged: lowercase,
 * underscores). A label's own slug and the key need no entry here.
 */
export const EXERCISE_ALIASES: Readonly<Record<string, string>> = {
  bench: 'bench_press',
  back_squat: 'squat',
  ohp: 'overhead_press',
  rdl: 'romanian_deadlift',
  pull_up: 'pull_ups',
  pullup: 'pull_ups',
  pullups: 'pull_ups',
  chin_up: 'chin_ups',
  chinup: 'chin_ups',
  chinups: 'chin_ups',
  push_up: 'push_ups',
  pushup: 'push_ups',
  pushups: 'push_ups',
  sit_up: 'sit_ups',
  situp: 'sit_ups',
  situps: 'sit_ups',
  dip: 'dips',
  lunges: 'lunge',
  planks: 'plank',
};

const SLUG_TO_KEY = buildSlugToKey(EXERCISE_CATALOG, EXERCISE_ALIASES);

/** One exercise's identity across sessions (exercise-identity.ts, bound to this catalog): the ONE spelling every reader uses. */
export function exerciseRefOf(exerciseKey: string | null | undefined, name: string): string {
  return exerciseRef(exerciseKey, name, SLUG_TO_KEY);
}

export const EXERCISE_CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  strength: 'Strength',
  cardio: 'Cardio',
  mobility: 'Mobility & Recovery',
};

/** Case-insensitive substring search on label. Empty query returns all. */
export function searchCatalog(query: string): CatalogExercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return EXERCISE_CATALOG;
  return EXERCISE_CATALOG.filter(e => e.label.toLowerCase().includes(q));
}
