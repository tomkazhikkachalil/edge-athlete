import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSlugToKey, exerciseRef, EXERCISE_REF_MAX, slugExerciseName } from '../workouts/exercise-identity';
import { EXERCISE_ALIASES, EXERCISE_CATALOG, EXERCISE_MAP, exerciseRefOf } from '../workout-config';

// One exercise, one identity (Training redesign PR 1, Nov 11 2026).
describe('exercise identity', () => {
  it('slugs a name: lowercase, one underscore per run of anything but letters and digits', () => {
    expect(slugExerciseName('Pull-Ups')).toBe('pull_ups');
    expect(slugExerciseName('  DB   Bench ')).toBe('db_bench');
    expect(slugExerciseName('db-bench')).toBe('db_bench');
    expect(slugExerciseName('Rowing (Erg)')).toBe('rowing_erg');
    expect(slugExerciseName("Farmer's Carry / 40m")).toBe('farmer_s_carry_40m');
    expect(slugExerciseName('Élévation latérale')).toBe('élévation_latérale');
    expect(slugExerciseName('***')).toBe('');
    expect(slugExerciseName('x'.repeat(200))).toHaveLength(EXERCISE_REF_MAX);
  });

  it('GOLDEN: every catalog key is its own identity, whatever the row is named (nothing keyed changes)', () => {
    for (const e of EXERCISE_CATALOG) {
      expect(exerciseRefOf(e.key, e.label)).toBe(e.key);
      expect(exerciseRefOf(e.key, 'Renamed by the athlete')).toBe(e.key);
    }
  });

  it('a typed label is the catalog exercise, in any case, spacing or punctuation', () => {
    for (const e of EXERCISE_CATALOG) {
      expect(exerciseRefOf(null, e.label)).toBe(e.key);
      expect(exerciseRefOf(null, ` ${e.label.toUpperCase()} `)).toBe(e.key);
    }
    expect(exerciseRefOf(null, 'bench press')).toBe('bench_press');
    expect(exerciseRefOf(null, 'Pull ups')).toBe('pull_ups');
    expect(exerciseRefOf(null, 'pullups')).toBe('pull_ups');
    expect(exerciseRefOf(null, 'OHP')).toBe('overhead_press');
    expect(exerciseRefOf(null, 'Lunge')).toBe('lunge');
  });

  it('a name the catalog does not know is its own slug; two spellings of it are one exercise', () => {
    expect(exerciseRefOf(null, 'DB Bench')).toBe('db_bench');
    expect(exerciseRefOf(null, 'db-bench')).toBe('db_bench');
    expect(exerciseRefOf(null, 'Dumbbell Bench')).toBe('dumbbell_bench');
    expect(exerciseRefOf(undefined, 'Box Squat')).toBe('box_squat');
  });

  it('a key the catalog does not know is treated as absent; an unsluggable name keeps its own text', () => {
    expect(exerciseRefOf('not_a_key', 'Bench Press')).toBe('bench_press');
    expect(exerciseRefOf('../../etc', 'My Lift')).toBe('my_lift');
    expect(exerciseRefOf(null, ' 🔥 ')).toBe('🔥');
    // An alias is not a key: only the catalog's own keys win as keys.
    expect(exerciseRef('ohp', 'Something else', buildSlugToKey(EXERCISE_CATALOG, EXERCISE_ALIASES))).toBe('something_else');
  });

  it('every alias is slugged, points at a real key, and shadows no label or key', () => {
    const labelSlugs = new Map(EXERCISE_CATALOG.map(e => [slugExerciseName(e.label), e.key]));
    for (const [alias, key] of Object.entries(EXERCISE_ALIASES)) {
      expect(slugExerciseName(alias)).toBe(alias);
      expect(EXERCISE_MAP[key]).toBeDefined();
      expect(EXERCISE_MAP[alias]).toBeUndefined();
      expect(labelSlugs.get(alias) ?? key).toBe(key);
    }
    // No two catalog labels share a slug, and a label's slug never names ANOTHER exercise's key.
    expect(labelSlugs.size).toBe(EXERCISE_CATALOG.length);
    for (const [slug, key] of labelSlugs) expect(EXERCISE_MAP[slug]?.key ?? key).toBe(key);
  });

  it('every writer of workout_exercises stores the reference the SERVER computed (migration 306)', () => {
    const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
    const start = src('app/api/workouts/route.ts');
    const entries = src('app/api/workouts/[id]/entries/route.ts');
    expect(start).toContain('exercise_ref: exerciseRefOf(exercise.exerciseKey, exercise.name)');
    expect(entries).toContain('exerciseRef: exerciseRefOf(exercise.exerciseKey, exercise.name)');
    expect(entries).toContain('exercise_ref: exerciseRefOf(exercise.exerciseKey, exercise.name)');
    // One insert per writer of the table, and each one sets the column.
    const inserts = (s: string) => s.split(".from('workout_exercises')").slice(1).filter(part => /^\s*\.insert\(/.test(part)).length;
    expect(inserts(start)).toBe(1);
    expect(inserts(entries)).toBe(1);
    const sql = readFileSync(join(process.cwd(), 'database/migrations/306_training_exercise_ref_pins.sql'), 'utf8');
    expect(sql).toContain("left(NULLIF(v_exercise.ex->>'exerciseRef', ''), 80)");
    // The backfill's catalog is the catalog of the day it was written: every key and every alias of today is in it.
    for (const e of EXERCISE_CATALOG) expect(sql).toContain(`('${e.key}')`);
  });

  it('the rule file imports nothing, and no reader spells the identity itself', () => {
    const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
    expect(src('lib/workouts/exercise-identity.ts')).not.toMatch(/^import /m);
    // (dashboard.ts's progression — the third copy — was removed with the chart it fed, Training redesign PR 8.)
    for (const p of ['lib/workouts/prs.ts', 'lib/workouts/summary.ts']) {
      expect(src(p)).not.toMatch(/exerciseKey \?\? [\w.]*name\.trim\(\)\.toLowerCase\(\)/);
      expect(src(p)).toContain('exerciseRefOf(');
    }
  });
});
