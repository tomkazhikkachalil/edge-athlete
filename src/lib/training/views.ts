// ── Training's four views (Training redesign PR 3, Nov 11 2026) ──────────────
// Pure, zero-import. Training was one scroll of nine stacked sections; it is
// four views behind one switcher (Tom's decision): what happened lately, the
// whole diary, one page per exercise, the body and the tests. The view lives
// in the URL (`?tab=training&view=history`) so a link, a refresh and a remount
// land where the athlete was.

export type TrainingView = 'overview' | 'history' | 'exercises' | 'body';

export const TRAINING_VIEWS: ReadonlyArray<{ id: TrainingView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History' },
  { id: 'exercises', label: 'Exercises' },
  { id: 'body', label: 'Body & tests' },
];

const IDS: readonly string[] = TRAINING_VIEWS.map(v => v.id);

/**
 * The view a URL asks for. `view` arrives from the query string, so anything
 * unrecognised is the Overview. The old `?tab=activities` link (the activity
 * screen and shared links use it) opens History, where the activities live.
 */
export function parseTrainingView(view: string | null | undefined, tab?: string | null): TrainingView {
  if (view && IDS.includes(view)) return view as TrainingView;
  return tab === 'activities' ? 'history' : 'overview';
}

/**
 * The query string that names a view: the Overview is the bare tab (the address
 * every old link already has). An open exercise page (PR 5) rides the Exercises
 * view: `?tab=training&view=exercises&exercise=bench_press`.
 */
export function trainingViewSearch(view: TrainingView, exercise?: string | null): string {
  if (view === 'overview') return '?tab=training';
  return `?tab=training&view=${view}${view === 'exercises' && exercise ? `&exercise=${encodeURIComponent(exercise)}` : ''}`;
}

/** `?exercise=` arrives from the URL: an identity is letters, digits and underscores (exercise-identity.ts), at most 80; anything else is no exercise. */
export function parseExerciseParam(value: string | null | undefined): string | null {
  return value && /^[\p{L}\p{N}_]{1,80}$/u.test(value) ? value : null;
}
