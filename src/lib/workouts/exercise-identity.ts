// ── One exercise, one identity (Training redesign PR 1, Nov 11 2026) ─────────
// Pure, zero-import. An exercise's bests, its progress chart and a workout's
// per-exercise summary each spelled the identity themselves
// (`exerciseKey ?? name.trim().toLowerCase()`), and that spelling kept a typed
// "Bench Press" apart from the catalog's bench_press: two histories for one
// lift, and a "record" the day the other spelling was used. Here is the one
// rule, and every reader calls it:
//
//   1. a key the catalog knows wins (a renamed catalog lift stays that lift);
//   2. otherwise the NAME is slugged, and a slug the catalog knows (a label,
//      a key or an alias) is that catalog exercise;
//   3. otherwise the slug itself is the identity ("DB Bench" and "db-bench"
//      are one custom exercise).
//
// A key the catalog does not know is treated as absent: the entries route
// accepts any string there, and an identity is shown in a URL.

export const EXERCISE_REF_MAX = 80;

/** "Pull-Ups" → "pull_ups", " DB  Bench " → "db_bench": lowercase, every run of anything but a letter or a digit is one underscore. */
export function slugExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, EXERCISE_REF_MAX);
}

/**
 * The identity of an exercise across sessions. `slugToKey` maps every slug the
 * catalog answers to (each key, each label's slug, each alias) to its key —
 * the caller binds it (workout-config.ts), so this file imports nothing.
 */
export function exerciseRef(key: string | null | undefined, name: string, slugToKey: ReadonlyMap<string, string>): string {
  if (key && slugToKey.get(key) === key) return key;
  const slug = slugExerciseName(name);
  if (!slug) return name.trim().toLowerCase().slice(0, EXERCISE_REF_MAX);
  return slugToKey.get(slug) ?? slug;
}

/** The catalog's side of the rule: every key, every label's slug and every alias, each pointing at its key. A slug two exercises claim keeps the first. */
export function buildSlugToKey(catalog: ReadonlyArray<{ key: string; label: string }>, aliases: Readonly<Record<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of catalog) out.set(e.key, e.key);
  for (const e of catalog) {
    const slug = slugExerciseName(e.label);
    if (slug && !out.has(slug)) out.set(slug, e.key);
  }
  for (const [alias, key] of Object.entries(aliases)) {
    if (out.get(key) === key && !out.has(alias)) out.set(alias, key);
  }
  return out;
}
