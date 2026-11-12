import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chartKindOf, describeExercise, exerciseTimeline, groupByArea, headlineOf, summarizeExercises, type ExerciseSession } from '../workouts/exercise-list';
import { BODY_AREAS, EXERCISE_CATALOG } from '../workout-config';
import type { EntryExercise, EntrySet } from '../workouts/entries';

// Training's Exercises view (Training redesign PR 5, Nov 11 2026).
const set = (reps: number | null, weight: number | null, extra: Partial<EntrySet> = {}): EntrySet => ({ setNumber: 1, reps, weight, weightUnit: weight === null ? null : 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [], ...extra });
const ex = (name: string, key: string | null, sets: EntrySet[]): EntryExercise => ({ clientId: name, name, exerciseKey: key, category: 'strength', notes: null, sets });
const session = (id: string, day: string, exercises: EntryExercise[]): ExerciseSession => ({ id, startedAt: `${day}T10:00:00Z`, title: `Day ${id}`, exercises });

const history: ExerciseSession[] = [
  session('s1', '2026-10-01', [ex('Bench Press', 'bench_press', [set(5, 185)]), ex('Plank', 'plank', [set(null, null, { durationSeconds: 60 })])]),
  session('s2', '2026-10-08', [ex('bench press', null, [set(5, 195), set(3, 205)]), ex('Sled Push', null, [set(10, 90)])]),
  session('s3', '2026-10-15', [ex('Bench Press', 'bench_press', [set(5, 195)]), ex('Pull-Ups', 'pull_ups', [set(12, null)]), ex('Empty', null, [set(null, null)])]),
];

describe('the catalog', () => {
  it('gives every exercise one body area the list knows', () => {
    const areas = new Set(BODY_AREAS.map(a => a.id));
    for (const e of EXERCISE_CATALOG) expect(areas.has(e.bodyArea), e.key).toBe(true);
    expect(BODY_AREAS[BODY_AREAS.length - 1].id).toBe('other');
    expect(describeExercise('bench_press', 'whatever')).toEqual({ name: 'Bench Press', area: 'chest' });
    expect(describeExercise('sled_push', 'Sled Push')).toEqual({ name: 'Sled Push', area: 'other' });
  });
});

describe('the list', () => {
  const list = summarizeExercises(history);
  it('is one row per exercise — a typed name is the catalog\'s lift — most recently trained first; an empty card is not an exercise', () => {
    expect(list.map(e => [e.ref, e.name, e.sessions, e.lastAt.slice(0, 10)])).toEqual([
      ['bench_press', 'Bench Press', 3, '2026-10-15'],
      ['pull_ups', 'Pull-Ups', 1, '2026-10-15'],
      ['sled_push', 'Sled Push', 1, '2026-10-08'],
      ['plank', 'Plank', 1, '2026-10-01'],
    ]);
  });
  it('a row leads with ONE number: the weight, else the reps, else the hold', () => {
    const by = Object.fromEntries(list.map(e => [e.ref, e.headline]));
    expect(by.bench_press).toEqual({ kind: 'heaviest', value: 205 });
    expect(by.pull_ups).toEqual({ kind: 'reps', value: 12 });
    expect(by.plank).toEqual({ kind: 'duration', value: 60 });
    expect(headlineOf({ name: 'x', heaviest: null, e1rm: null, reps: null, volume: null, duration: null })).toBeNull();
  });
  it('groups by body area in the catalog\'s order; an area with nothing is not shown; unknown names are Other, last', () => {
    expect(groupByArea(list).map(g => [g.label, g.items.map(i => i.ref)])).toEqual([
      ['Chest', ['bench_press']],
      ['Back', ['pull_ups']],
      ['Core', ['plank']],
      ['Other', ['sled_push']],
    ]);
    expect(groupByArea([])).toEqual([]);
  });
});

describe('one exercise, session by session', () => {
  const timeline = exerciseTimeline(history, 'bench_press');
  it('is newest first, across both spellings, with every set that has a number', () => {
    expect(timeline.map(p => [p.sessionId, p.sets])).toEqual([
      ['s3', ['5 reps × 195 lbs']],
      ['s2', ['5 reps × 195 lbs', '3 reps × 205 lbs']],
      ['s1', ['5 reps × 185 lbs']],
    ]);
  });
  it('a record is what beat every EARLIER session by the margin; the first session is the baseline; equal is not a record', () => {
    const records = Object.fromEntries(timeline.map(p => [p.sessionId, p.records]));
    expect(records.s1).toEqual([]);
    expect(records.s2).toEqual(['heaviest', 'e1rm', 'volume']);
    expect(records.s3).toEqual([]); // 195 × 5 again: nothing beaten
  });
  it('the order the sessions arrive in does not matter', () => {
    expect(exerciseTimeline([...history].reverse(), 'bench_press')).toEqual(timeline);
  });
  it('charts the weight, else the reps, else the hold; an exercise nobody logged has no page', () => {
    expect(chartKindOf(timeline)).toBe('heaviest');
    expect(chartKindOf(exerciseTimeline(history, 'pull_ups'))).toBe('reps');
    expect(chartKindOf(exerciseTimeline(history, 'plank'))).toBe('duration');
    expect(exerciseTimeline(history, 'squat')).toEqual([]);
    expect(exerciseTimeline(history, 'empty')).toEqual([]);
    expect(chartKindOf([])).toBeNull();
  });
});

describe('the route and the reader hold the privacy rules', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
  it('the gate, then the records aspect, before any read; every answer is private, no-store; the ref is checked before it reaches a filter', () => {
    const route = src('app/api/profile/[profileId]/training/bests/route.ts');
    const order = ['resolveActivityAccess(', "aspectHidden(privacy, 'records', isOwner)", 'REF.test(ref)', 'readBestsSources('].map(m => route.indexOf(m));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const answers = route.match(/NextResponse\.json\(/g)?.length ?? 0;
    expect(answers).toBeGreaterThan(6);
    expect((route.match(/headers: NO_STORE/g)?.length ?? 0)).toBe(answers);
  });
  it('a non-owner\'s bests come only from sessions that viewer could open; with workouts private the sessions and their timing are withheld', () => {
    const route = src('app/api/profile/[profileId]/training/bests/route.ts');
    expect(route).toContain('readBestsSources(admin, profileId, { visitor: !isOwner,');
    expect(route).toContain('timeline: sessionsHidden ? [] : timeline');
    expect(route).toContain('lastAt: null, sessions: null');
    const reader = src('lib/workouts/bests-server.ts');
    expect(reader).toContain(".eq('session.status', 'completed')");
    expect(reader).toContain("if (opts.visitor) q = q.is('session.profile_hidden_at', null).not('session.share_decided_at', 'is', null);");
    expect(reader).toContain('workout_sessions!inner');
    // The stored reference is a filter; identity is recomputed, and a row written before 306 is still read.
    expect(reader).toContain('exercise_ref.is.null');
    expect(reader).toContain('if (opts.ref && exerciseRefOf(r.exercise_key, r.name) !== opts.ref) continue;');
    expect(reader).not.toMatch(/SELECT =[\s\S]{0,500}media/);
  });
  it('the athlete\'s own bests route reads through the same narrow reader, and still compares with EARLIER sessions only', () => {
    const prs = src('app/api/workouts/prs/route.ts');
    expect(prs).toContain('readBestsSources(admin, user.id, { visitor: false })');
    expect(prs).toContain('Date.parse(s.startedAt) < before');
    expect(prs).not.toContain('workout_sets (*)');
  });
  it('Training no longer reads the last fifty workouts at all', () => {
    const tab = src('components/TrainingTab.tsx');
    expect(tab).not.toContain('/api/workouts?profileId');
    expect(tab).toContain('<TrainingExercises');
  });
});
