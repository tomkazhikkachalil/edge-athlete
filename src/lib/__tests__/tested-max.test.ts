import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isTestedMaxRow, testedMaxRef, testedMaxSession, testedMaxSessions, type TestedMaxRow } from '../workouts/tested-max';
import { exerciseTimeline, summarizeExercises, type ExerciseSession } from '../workouts/exercise-list';
import { bestsOf, foldBests, newPRs } from '../workouts/prs';
import type { EntryExercise, EntrySet } from '../workouts/entries';

// ONE system of bests (Training redesign PR 6, Nov 11 2026): a best the athlete types in is a tested max.
const row = (over: Partial<TestedMaxRow> = {}): TestedMaxRow => ({ id: 'v1', metric_key: 'bench_press', metric_category: 'strength', metric_label: 'Bench Press', value: 225, unit: 'lbs', source: 'manual', recorded_at: '2026-08-01', ...over });
const set = (reps: number | null, weight: number | null): EntrySet => ({ setNumber: 1, reps, weight, weightUnit: weight === null ? null : 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });
const ex = (name: string, key: string | null, sets: EntrySet[]): EntryExercise => ({ clientId: name, name, exerciseKey: key, category: 'strength', notes: null, sets });
const workout = (id: string, day: string, exercises: EntryExercise[]): ExerciseSession => ({ id, startedAt: `${day}T15:00:00Z`, title: `Day ${id}`, exercises });

describe('what a tested max is', () => {
  it('a strength row the athlete entered, above zero — never the copy the old finish-step confirm wrote, never a test or a body number', () => {
    expect(isTestedMaxRow(row())).toBe(true);
    expect(isTestedMaxRow(row({ source: 'tested_max' }))).toBe(true);
    expect(isTestedMaxRow(row({ source: null }))).toBe(true); // the column's default is manual
    expect(isTestedMaxRow(row({ source: 'edge_vitals' }))).toBe(false);
    expect(isTestedMaxRow(row({ metric_category: 'conditioning' }))).toBe(false);
    expect(isTestedMaxRow(row({ metric_category: 'body' }))).toBe(false);
    expect(isTestedMaxRow(row({ value: 0 }))).toBe(false);
    expect(isTestedMaxRow(row({ value: null }))).toBe(false);
    expect(isTestedMaxRow(row({ value: '225' }))).toBe(true); // numeric columns arrive as strings
  });

  it('belongs to its exercise by the one identity: the five lifts by key, anything else by its name', () => {
    expect(testedMaxRef(row())).toBe('bench_press');
    expect(testedMaxRef(row({ metric_key: 'db_curl', metric_label: 'DB Curl' }))).toBe('db_curl');
    expect(testedMaxRef(row({ metric_key: 'whatever', metric_label: 'Pull ups' }))).toBe('pull_ups');
  });

  it('reads as one set at the START of its day: a weight for one rep, or reps for a bodyweight exercise; kg stays kg', () => {
    const s = testedMaxSession(row())!;
    expect(s).toMatchObject({ id: 'tested:v1', startedAt: '2026-08-01T00:00:00.000Z', title: 'Tested max', tested: true });
    expect(s.exercises[0]).toMatchObject({ name: 'Bench Press', exerciseKey: 'bench_press' });
    expect(s.exercises[0].sets[0]).toMatchObject({ reps: 1, weight: 225, weightUnit: 'lbs' });
    expect(testedMaxSession(row({ metric_key: 'pull_ups', metric_label: 'Pull-Ups', value: 15, unit: 'reps' }))!.exercises[0].sets[0]).toMatchObject({ reps: 15, weight: null });
    expect(testedMaxSession(row({ value: 100, unit: 'kg' }))!.exercises[0].sets[0]).toMatchObject({ weight: 100, weightUnit: 'kg' });
    expect(testedMaxSession(row({ source: 'edge_vitals' }))).toBeNull();
    expect(testedMaxSession(row({ recorded_at: 'yesterday' }))).toBeNull();
    expect(testedMaxSessions([row(), row({ id: 'v2', metric_key: 'squat', metric_label: 'Squat' }), row({ id: 'v3', source: 'edge_vitals' })], 'squat').map(x => x.id)).toEqual(['tested:v2']);
  });
});

describe('one fold: the logged sets and the tested maxes', () => {
  const sessions: ExerciseSession[] = [
    workout('w1', '2026-07-01', [ex('Bench Press', 'bench_press', [set(5, 185)])]),
    testedMaxSession(row())!, // 225 on Aug 1
    workout('w2', '2026-08-10', [ex('Bench Press', 'bench_press', [set(3, 205)])]),
    workout('w3', '2026-09-01', [ex('Bench Press', 'bench_press', [set(1, 230)])]),
  ];

  it('the best is the best of both; "N sessions" counts workouts only', () => {
    const [bench] = summarizeExercises(sessions);
    expect(bench).toMatchObject({ ref: 'bench_press', sessions: 3 });
    expect(bench.bests.heaviest).toBe(230);
    expect(summarizeExercises(sessions.slice(0, 3))[0].bests.heaviest).toBe(225); // the tested max leads until it is beaten
  });

  it('a tested max RAISES the bar and is never itself a record: 205 after a tested 225 is nothing; 230 is', () => {
    const t = Object.fromEntries(exerciseTimeline(sessions, 'bench_press').map(p => [p.sessionId, p]));
    expect(t['tested:v1']).toMatchObject({ tested: true, records: [] });
    expect(t.w2.records).not.toContain('heaviest');
    expect(t.w2.records).not.toContain('e1rm');
    expect(t.w3.records).toEqual(['heaviest', 'e1rm']);
    expect(t.w1.tested).toBeUndefined();
  });

  it('the finish summary agrees: against a history that holds the tested max, 205 is no record', () => {
    const history = foldBests(sessions.slice(0, 2).map(s => bestsOf(s.exercises)));
    expect(newPRs(bestsOf(sessions[2].exercises), history).map(h => h.kind)).toEqual([]);
    expect(newPRs(bestsOf(sessions[3].exercises), history).map(h => h.kind)).toEqual(['heaviest', 'e1rm']);
  });

  it('an exercise with only a tested max has a row and a page', () => {
    const only = [testedMaxSession(row({ metric_key: 'squat', metric_label: 'Squat', value: 315 }))!];
    expect(summarizeExercises(only).map(e => [e.ref, e.headline, e.sessions])).toEqual([['squat', { kind: 'heaviest', value: 315 }, 0]]);
    expect(exerciseTimeline(only, 'squat')).toHaveLength(1);
  });
});

describe('the second system is gone', () => {
  const root = process.cwd();
  const src = (p: string) => readFileSync(join(root, 'src', p), 'utf8');
  it('no detector, no confirm at Finish, no copy written to athlete_vitals', () => {
    expect(existsSync(join(root, 'src/lib/workouts/pr-detection.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/components/training/PBShowcase.tsx'))).toBe(false);
    const editor = src('components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).not.toMatch(/detectPRs|recordPRs|prCandidates|edge_vitals/);
    expect(src('components/workouts/FinishFlow.tsx')).not.toMatch(/prCandidates|Save (it|them) to your Personal Bests/);
  });
  it('both bests routes read the sets AND the tested maxes; the reader never takes the old copies', () => {
    expect(src('app/api/profile/[profileId]/training/bests/route.ts')).toContain('readBestsSources(');
    expect(src('app/api/workouts/prs/route.ts')).toContain('readBestsSources(');
    const reader = src('lib/workouts/bests-server.ts');
    expect(reader).toContain(".eq('metric_category', 'strength')");
    expect(reader).toContain(".in('source', [...TESTED_MAX_SOURCES])");
  });
  it('the one door to remove a tested max takes the athlete\'s OWN entered strength row and nothing else', () => {
    const route = src('app/api/vitals/route.ts');
    const del = route.slice(route.indexOf('export async function DELETE'));
    for (const clause of ["requireAuth(request)", ".eq('profile_id', user.id)", ".eq('metric_category', 'strength')", ".in('source', [...TESTED_MAX_SOURCES])"]) expect(del).toContain(clause);
  });
  it('a lift is not a second record in Body & tests or in the metric modal', () => {
    const tab = src('components/TrainingTab.tsx');
    expect(tab).toContain("entry.metric_category !== 'strength'");
    expect(tab).toContain("BODY_METRIC_CATEGORIES.filter(category => category.key !== 'strength')");
    expect(src('components/AddBodyMetricModal.tsx')).toContain("BODY_METRIC_CATEGORIES.filter(cat => cat.key !== 'strength')");
  });
});
