/**
 * Edge Vitals exercise catalog — the curated exercise list for the workout
 * editor. Each exercise declares which inputs its sets use and (for the
 * mapped lifts) which vitals metric it can feed as a PR.
 */

export type ExerciseInputMode = 'reps_weight' | 'reps_only' | 'duration' | 'distance_duration';
export type ExerciseCategory = 'strength' | 'cardio' | 'mobility';

export interface CatalogExercise {
  key: string;
  label: string;
  category: ExerciseCategory;
  inputMode: ExerciseInputMode;
  /** Maps to a vitals-config metric for PR detection (5 mapped lifts). */
  vitalMetricKey?: 'bench_press' | 'squat' | 'deadlift' | 'overhead_press' | 'pull_ups';
}

export const EXERCISE_CATALOG: CatalogExercise[] = [
  // ── Strength ──────────────────────────────────────────────────────────────
  { key: 'bench_press', label: 'Bench Press', category: 'strength', inputMode: 'reps_weight', vitalMetricKey: 'bench_press' },
  { key: 'incline_bench_press', label: 'Incline Bench Press', category: 'strength', inputMode: 'reps_weight' },
  { key: 'squat', label: 'Squat', category: 'strength', inputMode: 'reps_weight', vitalMetricKey: 'squat' },
  { key: 'front_squat', label: 'Front Squat', category: 'strength', inputMode: 'reps_weight' },
  { key: 'deadlift', label: 'Deadlift', category: 'strength', inputMode: 'reps_weight', vitalMetricKey: 'deadlift' },
  { key: 'romanian_deadlift', label: 'Romanian Deadlift', category: 'strength', inputMode: 'reps_weight' },
  { key: 'overhead_press', label: 'Overhead Press', category: 'strength', inputMode: 'reps_weight', vitalMetricKey: 'overhead_press' },
  { key: 'pull_ups', label: 'Pull-Ups', category: 'strength', inputMode: 'reps_only', vitalMetricKey: 'pull_ups' },
  { key: 'chin_ups', label: 'Chin-Ups', category: 'strength', inputMode: 'reps_only' },
  { key: 'push_ups', label: 'Push-Ups', category: 'strength', inputMode: 'reps_only' },
  { key: 'dips', label: 'Dips', category: 'strength', inputMode: 'reps_only' },
  { key: 'barbell_row', label: 'Barbell Row', category: 'strength', inputMode: 'reps_weight' },
  { key: 'dumbbell_row', label: 'Dumbbell Row', category: 'strength', inputMode: 'reps_weight' },
  { key: 'lat_pulldown', label: 'Lat Pulldown', category: 'strength', inputMode: 'reps_weight' },
  { key: 'bicep_curl', label: 'Bicep Curl', category: 'strength', inputMode: 'reps_weight' },
  { key: 'tricep_extension', label: 'Tricep Extension', category: 'strength', inputMode: 'reps_weight' },
  { key: 'lateral_raise', label: 'Lateral Raise', category: 'strength', inputMode: 'reps_weight' },
  { key: 'lunge', label: 'Lunges', category: 'strength', inputMode: 'reps_weight' },
  { key: 'leg_press', label: 'Leg Press', category: 'strength', inputMode: 'reps_weight' },
  { key: 'leg_curl', label: 'Leg Curl', category: 'strength', inputMode: 'reps_weight' },
  { key: 'calf_raise', label: 'Calf Raise', category: 'strength', inputMode: 'reps_weight' },
  { key: 'hip_thrust', label: 'Hip Thrust', category: 'strength', inputMode: 'reps_weight' },
  { key: 'kettlebell_swing', label: 'Kettlebell Swing', category: 'strength', inputMode: 'reps_weight' },
  { key: 'clean', label: 'Power Clean', category: 'strength', inputMode: 'reps_weight' },
  { key: 'snatch', label: 'Snatch', category: 'strength', inputMode: 'reps_weight' },
  { key: 'med_ball_slam', label: 'Med Ball Slam', category: 'strength', inputMode: 'reps_weight' },
  { key: 'sit_ups', label: 'Sit-Ups', category: 'strength', inputMode: 'reps_only' },

  // ── Cardio ────────────────────────────────────────────────────────────────
  { key: 'run', label: 'Run', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'sprint', label: 'Sprints', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'bike', label: 'Bike', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'row_erg', label: 'Rowing (Erg)', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'swim', label: 'Swim', category: 'cardio', inputMode: 'distance_duration' },
  { key: 'stair_climber', label: 'Stair Climber', category: 'cardio', inputMode: 'duration' },
  { key: 'jump_rope', label: 'Jump Rope', category: 'cardio', inputMode: 'duration' },
  { key: 'hiit_circuit', label: 'HIIT Circuit', category: 'cardio', inputMode: 'duration' },

  // ── Mobility / recovery ───────────────────────────────────────────────────
  { key: 'plank', label: 'Plank', category: 'mobility', inputMode: 'duration' },
  { key: 'stretching', label: 'Stretching', category: 'mobility', inputMode: 'duration' },
  { key: 'yoga', label: 'Yoga', category: 'mobility', inputMode: 'duration' },
  { key: 'foam_roll', label: 'Foam Rolling', category: 'mobility', inputMode: 'duration' },
];

export const EXERCISE_MAP: Record<string, CatalogExercise> = Object.fromEntries(
  EXERCISE_CATALOG.map(e => [e.key, e])
);

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
