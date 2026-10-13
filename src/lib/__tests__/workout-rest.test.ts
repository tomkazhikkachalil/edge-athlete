import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyStopwatchToSet, completedSetDiff, describeTarget, REST_IDLE, restElapsedS, restForCompletedSet, restTargetReached, startRest, stopRest,
  STOPWATCH_IDLE, stopwatchElapsedMs, stopwatchReset, stopwatchStart, stopwatchStop, stopwatchTarget,
} from '../workouts/rest';
import { parseTimers, TIMERS_IDLE, timersKey } from '../workouts/timers-store';
import { emptyEntrySet, type EntryExercise, type EntrySet } from '../workouts/entries';
import { showsTabBar } from '../tab-bar';

// Workout screen PR 4 (Oct 12 2026): the rest timer records each rest on the
// set completed next; the stopwatch saves to the current set in one tap;
// neither touches the workout clock.

const T0 = Date.UTC(2026, 9, 12, 8, 0, 0);
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
const set = (n: number, reps: number | null = null): EntrySet => ({ ...emptyEntrySet(n), reps, weight: reps === null ? null : 100, weightUnit: reps === null ? null : 'lbs' });
const ex = (name: string, sets: EntrySet[], over: Partial<EntryExercise> = {}): EntryExercise => ({ clientId: `c-${name}`, name, exerciseKey: null, category: 'strength', notes: null, sets, ...over });

describe('the rest timer', () => {
  it('runs from its start; a stop by hand HOLDS the seconds for the next completed set', () => {
    const r = startRest(T0);
    expect(restElapsedS(r, T0 + 75_000)).toBe(75);
    const held = stopRest(r, T0 + 75_000);
    expect(held).toEqual({ startedAt: null, heldS: 75 });
    expect(restElapsedS(held, T0 + 999_000)).toBe(75);
    expect(stopRest(REST_IDLE, T0)).toBe(REST_IDLE);
  });
  it('the set completed now takes the running rest, else the held one, else nothing', () => {
    expect(restForCompletedSet(startRest(T0), T0 + 90_000)).toBe(90);
    expect(restForCompletedSet({ startedAt: null, heldS: 40 }, T0)).toBe(40);
    expect(restForCompletedSet(REST_IDLE, T0)).toBeNull();
  });
  it('the target is reached only while running and only with a target', () => {
    expect(restTargetReached(startRest(T0), 60, T0 + 59_000)).toBe(false);
    expect(restTargetReached(startRest(T0), 60, T0 + 60_000)).toBe(true);
    expect(restTargetReached(startRest(T0), null, T0 + 999_000)).toBe(false);
    expect(restTargetReached({ startedAt: null, heldS: 400 }, 60, T0)).toBe(false);
  });
  it('completedSetDiff names the set whose completion just happened', () => {
    const before = ex('A', [set(1, 5), set(2, 5)]);
    const after = { ...before, sets: [before.sets[0], { ...before.sets[1], completedAt: '2026-10-12T08:05:00Z' }] };
    expect(completedSetDiff(before, after)).toBe(1);
    expect(completedSetDiff(after, after)).toBeNull();
    expect(completedSetDiff(after, { ...after, sets: [after.sets[0], { ...after.sets[1], completedAt: null }] })).toBeNull();
    // A set added already complete counts too (index 2 is new).
    expect(completedSetDiff(after, { ...after, sets: [...after.sets, { ...set(3, 5), completedAt: 'x' }] })).toBe(2);
  });
});

describe('the stopwatch', () => {
  it('accumulates runs; reset clears', () => {
    const a = stopwatchStart(STOPWATCH_IDLE, T0);
    expect(stopwatchElapsedMs(a, T0 + 4_000)).toBe(4_000);
    const b = stopwatchStop(a, T0 + 4_000);
    expect(stopwatchElapsedMs(b, T0 + 99_000)).toBe(4_000);
    const c = stopwatchStart(b, T0 + 10_000);
    expect(stopwatchElapsedMs(c, T0 + 12_500)).toBe(6_500);
    expect(stopwatchStart(c, T0 + 20_000)).toBe(c);
    expect(stopwatchStop(STOPWATCH_IDLE, T0)).toBe(STOPWATCH_IDLE);
    expect(stopwatchReset()).toEqual(STOPWATCH_IDLE);
  });
  it('the target set: the last-edited exercise\'s first empty set, else a duration exercise\'s, else the first empty anywhere, else none', () => {
    const plank = ex('Plank', [set(1, 5), set(2)], { exerciseKey: 'plank' });
    const bench = ex('Bench', [set(1), set(2)], { exerciseKey: 'bench_press' });
    const full = ex('Row', [set(1, 5)]);
    expect(stopwatchTarget([bench, plank], 'c-Bench')).toEqual({ clientId: 'c-Bench', setIndex: 0 });
    expect(stopwatchTarget([bench, plank], null)).toEqual({ clientId: 'c-Plank', setIndex: 1 });
    expect(stopwatchTarget([bench, full], null)).toEqual({ clientId: 'c-Bench', setIndex: 0 });
    expect(stopwatchTarget([full], null)).toBeNull();
    expect(stopwatchTarget([bench, plank], 'c-Row')).toEqual({ clientId: 'c-Plank', setIndex: 1 });
    expect(describeTarget([bench, plank], { clientId: 'c-Plank', setIndex: 1 })).toBe('Plank · set 2');
    expect(describeTarget([ex('Sq', [set(1)], { groupId: 'g', groupKind: 'circuit', groupRounds: 1 })], { clientId: 'c-Sq', setIndex: 0 })).toBe('Sq · round 1');
    expect(describeTarget([], null)).toBeNull();
  });
  it('Save to set writes whole seconds into the duration and completes the set if it was not', () => {
    const s = applyStopwatchToSet(set(1), 42_600, '2026-10-12T08:00:00Z');
    expect(s).toMatchObject({ durationSeconds: 43, completedAt: '2026-10-12T08:00:00Z' });
    expect(applyStopwatchToSet({ ...set(1), completedAt: 'kept' }, 400, 'now').completedAt).toBe('kept');
    expect(applyStopwatchToSet(set(1), 400, 'now').durationSeconds).toBe(1);
  });
});

describe('the timers survive a reload under their own device key', () => {
  it('parses what it wrote and tolerates garbage', () => {
    expect(timersKey('w1')).toBe('ea:workout-timers:v1:w1');
    expect(parseTimers(null)).toBe(TIMERS_IDLE);
    expect(parseTimers('nope')).toBe(TIMERS_IDLE);
    expect(parseTimers(JSON.stringify({ v: 2 }))).toBe(TIMERS_IDLE);
    expect(parseTimers(JSON.stringify({ v: 1, rest: { startedAt: T0, heldS: null }, stopwatch: { runningSince: null, accumulatedMs: 5000 } }))).toEqual({ v: 1, rest: { startedAt: T0, heldS: null }, stopwatch: { runningSince: null, accumulatedMs: 5000 } });
    expect(parseTimers(JSON.stringify({ v: 1, rest: { startedAt: 'x' }, stopwatch: { accumulatedMs: -1 } }))).toEqual(TIMERS_IDLE);
  });
});

describe('the screen', () => {
  it('owns its bottom edge (no tab bar), mounts the bar in live mode, and routes every exercise edit through the rest rule', () => {
    expect(showsTabBar('/app/workout/w1')).toBe(false);
    expect(showsTabBar('/app/profile')).toBe(true);
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).toMatch(/onChange=\{next => handleExerciseChange\(item\.exercise\.clientId, next\)\}/);
    expect(editor).toMatch(/onChangeMember=\{handleExerciseChange\}/);
    expect(editor).toMatch(/restForCompletedSet\(timers\.rest, Date\.now\(\)\)/);
    expect(editor).toMatch(/clearTimers\(draftId\)/);
    expect(editor).toMatch(/<WorkoutControls/);
    const bar = read('src/components/workouts/WorkoutControls.tsx');
    expect(bar).toMatch(/data-workout-rest=/);
    expect(bar).toMatch(/data-workout-stopwatch-save=""/);
    expect(bar).toMatch(/haptic\(\)/);
    expect(editor).not.toMatch(/span\.tabular-nums/);
    expect(read('e2e/workout-capture.spec.ts')).toMatch(/\[data-live-clock\]/);
  });
  it('the bar takes its own space (Oct 13 2026): it publishes its measured height, the editor\'s clearance follows it, the panel animates in place', () => {
    const bar = read('src/components/workouts/WorkoutControls.tsx');
    expect(bar).toMatch(/root\.style\.setProperty\('--ea-workout-bar-h', `\$\{el\.offsetHeight\}px`\)/);
    expect(bar).toMatch(/new ResizeObserver\(update\)/);
    expect(bar).toMatch(/data-workout-stopwatch-open=\{stopwatchOpen \? 'true' : 'false'\}/);
    expect(bar).toMatch(/transition-\[max-height,opacity\]/);
    expect(bar).not.toMatch(/\{stopwatchOpen && \(/);
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).not.toMatch(/pb-48/);
    expect(editor).toMatch(/'ea-bar-clearance'/);
    const css = read('src/app/globals.css');
    expect(css).toMatch(/\.ea-bar-clearance \{\s*padding-bottom: calc\(var\(--ea-workout-bar-h, 11rem\) \+ 1rem\);\s*transition: padding-bottom 200ms ease;/);
  });
});
