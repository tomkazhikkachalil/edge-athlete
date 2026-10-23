import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyStopwatchToSet, completedSetDiff, describeTarget, REST_IDLE, REST_OVERDUE_S, REST_WARN_S, restElapsedS, restForCompletedSet, restPhase, restTargetReached, restTotalS, startRest, stopRest,
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
    const r = startRest(REST_IDLE, T0);
    expect(restElapsedS(r, T0 + 75_000)).toBe(75);
    const held = stopRest(r, T0 + 75_000);
    expect(held).toEqual({ startedAt: null, heldS: 75, bankedS: 0 });
    expect(restElapsedS(held, T0 + 999_000)).toBe(75);
    expect(stopRest(REST_IDLE, T0)).toBe(REST_IDLE);
    expect(startRest(r, T0 + 5_000)).toBe(r);
  });
  it('the set completed now takes the running rest, else the held one, else nothing', () => {
    expect(restForCompletedSet(startRest(REST_IDLE, T0), T0 + 90_000)).toBe(90);
    expect(restForCompletedSet({ startedAt: null, heldS: 40, bankedS: 0 }, T0)).toBe(40);
    expect(restForCompletedSet(REST_IDLE, T0)).toBeNull();
  });
  // Rest timer round (Oct 22 2026): a held rest followed by another rest is BANKED, never dropped.
  it('a held rest followed by a new rest is banked: it joins the next completed set and the total', () => {
    const held = stopRest(startRest(REST_IDLE, T0), T0 + 30_000); // 30 s, held
    const again = startRest(held, T0 + 40_000);
    expect(again).toEqual({ startedAt: T0 + 40_000, heldS: null, bankedS: 30 });
    expect(restForCompletedSet(again, T0 + 60_000)).toBe(50); // 20 running + 30 banked
    const heldAgain = stopRest(again, T0 + 60_000);
    expect(heldAgain).toEqual({ startedAt: null, heldS: 20, bankedS: 30 });
    expect(restForCompletedSet(heldAgain, T0 + 99_000)).toBe(50);
    expect(restForCompletedSet({ startedAt: null, heldS: null, bankedS: 30 }, T0)).toBe(30);
  });
  it('the total rest is every set\'s rest plus what is held or banked — a running rest is not in it until it ends', () => {
    const exercises = [ex('A', [{ ...set(1, 5), restSeconds: 60 }, { ...set(2, 5), restSeconds: 45 }, set(3, 5)]), ex('B', [{ ...set(1, 5), restSeconds: null }])];
    expect(restTotalS(REST_IDLE, exercises)).toBe(105);
    expect(restTotalS(startRest(REST_IDLE, T0), exercises)).toBe(105);
    expect(restTotalS(stopRest(startRest(REST_IDLE, T0), T0 + 12_000), exercises)).toBe(117);
    expect(restTotalS({ startedAt: T0, heldS: null, bankedS: 30 }, exercises)).toBe(135);
    expect(restTotalS(REST_IDLE, [])).toBe(0);
  });
  it('the target is reached only while running and only with a target', () => {
    expect(restTargetReached(startRest(REST_IDLE, T0), 60, T0 + 59_000)).toBe(false);
    expect(restTargetReached(startRest(REST_IDLE, T0), 60, T0 + 60_000)).toBe(true);
    expect(restTargetReached(startRest(REST_IDLE, T0), null, T0 + 999_000)).toBe(false);
    expect(restTargetReached({ startedAt: null, heldS: 400, bankedS: 0 }, 60, T0)).toBe(false);
  });
  it('the colour: purple from the start, yellow five seconds before the target, red at it, flashing five seconds after; Off is purple throughout; a tap resets', () => {
    const r = startRest(REST_IDLE, T0);
    expect(REST_WARN_S).toBe(5);
    expect(REST_OVERDUE_S).toBe(5);
    expect(restPhase(REST_IDLE, 60, T0)).toBe('idle');
    expect(restPhase(r, 60, T0)).toBe('running');
    expect(restPhase(r, 60, T0 + 54_000)).toBe('running');
    expect(restPhase(r, 60, T0 + 55_000)).toBe('warning');
    expect(restPhase(r, 60, T0 + 59_000)).toBe('warning');
    expect(restPhase(r, 60, T0 + 60_000)).toBe('reached');
    expect(restPhase(r, 60, T0 + 64_000)).toBe('reached');
    expect(restPhase(r, 60, T0 + 65_000)).toBe('overdue');
    expect(restPhase(r, 60, T0 + 999_000)).toBe('overdue');
    // Off: no target, purple the whole way.
    expect(restPhase(r, null, T0 + 999_000)).toBe('running');
    // A short target never starts red: the first second is at most a warning.
    expect(restPhase(r, 3, T0)).toBe('warning');
    expect(restPhase(r, 7, T0)).toBe('running');
    // The tap that ends the rest resets everything.
    expect(restPhase(stopRest(r, T0 + 70_000), 60, T0 + 70_000)).toBe('idle');
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
    // A device written before the bank (Oct 22 2026) reads with none.
    expect(parseTimers(JSON.stringify({ v: 1, rest: { startedAt: T0, heldS: null }, stopwatch: { runningSince: null, accumulatedMs: 5000 } }))).toEqual({ v: 1, rest: { startedAt: T0, heldS: null, bankedS: 0 }, stopwatch: { runningSince: null, accumulatedMs: 5000 } });
    expect(parseTimers(JSON.stringify({ v: 1, rest: { startedAt: null, heldS: 20, bankedS: 30 }, stopwatch: { runningSince: null, accumulatedMs: 0 } })).rest).toEqual({ startedAt: null, heldS: 20, bankedS: 30 });
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
  // Rest timer round (Oct 22 2026).
  it('the rest is coloured by its phase; the clock has no rest of its own; the total rest sits beside the clock; rest never reaches a public surface', () => {
    const bar = read('src/components/workouts/WorkoutControls.tsx');
    expect(bar).toMatch(/const phase = restPhase\(rest, targetS, now\);/);
    expect(bar).toMatch(/data-workout-rest-phase=\{phase\}/);
    expect(bar).toMatch(/phase === 'running' \? 'bg-brand text-white'/);
    expect(bar).toMatch(/phase === 'warning' \? 'bg-amber-400 text-black'/);
    expect(bar).toMatch(/phase === 'reached' \? 'bg-red-600 text-white'\s*:/);
    expect(bar).toMatch(/phase === 'overdue' \? 'bg-red-600 text-white animate-pulse'/);
    expect((bar.match(/animate-pulse/g) ?? []).length).toBe(1);
    expect(bar).toMatch(/startRest\(rest, Date\.now\(\)\)/);
    expect(bar).not.toMatch(/reached \? 'bg-brand text-white' : 'bg-red-600 text-white'/);
    const clock = read('src/components/workouts/LiveClock.tsx');
    expect(clock).not.toMatch(/lastCompletedMs|Rest \{formatElapsed/);
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).not.toMatch(/lastCompletedMs/);
    expect(editor).toMatch(/restTotalS\(timers\.rest, exercises\)/);
    expect(editor).toMatch(/data-workout-rest-total=\{restTotal\}/);
    // Rest is personal: never on the post, the tiles' stats line, or a visitor's diary card.
    expect(read('src/components/workouts/WorkoutPostCard.tsx')).not.toMatch(/rest_seconds|active_seconds|avg_rest_seconds|Rest \$\{/);
    expect(read('src/lib/sports/stats-summary.ts')).not.toMatch(/num\(statsData\.rest_seconds\)|\} rest`/);
    expect(read('src/components/workouts/WorkoutCard.tsx')).toMatch(/isOwnProfile && \(summary\.restSeconds \?\? 0\) > 0/);
    // The owner's finish summary keeps its rest cards.
    expect(read('src/components/workouts/FinishFlow.tsx')).toMatch(/data-summary-rest=/);
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

// ── A custom rest time, saved as a preset (Training fixes PR 3, Oct 21 2026) ──
import { addRestPreset, isValidRestSeconds, joinRest, MAX_SAVED_REST_PRESETS, parseRestPresets, removeRestPreset, REST_TARGET_PRESETS_S, restPresetChips, splitRest } from '../workouts/rest';
import { readRestPresets, REST_PRESETS_KEY, writeRestPresets } from '../workouts/timer-prefs';

describe('custom rest presets', () => {
  it('a valid rest is a whole number of seconds from 5 s to an hour', () => {
    expect(isValidRestSeconds(5)).toBe(true);
    expect(isValidRestSeconds(3600)).toBe(true);
    expect(isValidRestSeconds(4)).toBe(false);
    expect(isValidRestSeconds(3601)).toBe(false);
    expect(isValidRestSeconds(7.5)).toBe(false);
    expect(isValidRestSeconds('90')).toBe(false);
  });
  it('parses a stored list: valid, deduplicated, capped; garbage is empty', () => {
    expect(parseRestPresets([75, 75, 4, 'x', 105, 3601])).toEqual([75, 105]);
    expect(parseRestPresets(null)).toEqual([]);
    expect(parseRestPresets('[75]')).toEqual([]);
    expect(parseRestPresets([5, 10, 15, 20, 25, 35, 40, 45])).toHaveLength(MAX_SAVED_REST_PRESETS);
  });
  it('save puts the newest first without duplicates and never a built-in; remove drops it', () => {
    expect(addRestPreset([75], 105)).toEqual([105, 75]);
    expect(addRestPreset([105, 75], 75)).toEqual([75, 105]);
    expect(addRestPreset([75], 90)).toEqual([75]);
    expect(addRestPreset([75], 4)).toEqual([75]);
    expect(addRestPreset([5, 10, 15, 20, 25, 35], 40)).toEqual([40, 5, 10, 15, 20, 25]);
    expect(removeRestPreset([105, 75], 75)).toEqual([105]);
  });
  it('the chips are the built-in five and the saved ones together, ascending; only the saved carry a remove', () => {
    const chips = restPresetChips([105, 75, 60]);
    expect(chips.map(c => c.seconds)).toEqual([30, 60, 75, 90, 105, 120, 180]);
    expect(chips.filter(c => c.saved).map(c => c.seconds)).toEqual([75, 105]);
    expect(restPresetChips([]).map(c => c.seconds)).toEqual([...REST_TARGET_PRESETS_S]);
  });
  it('the two wheels split and join a time', () => {
    expect(splitRest(105)).toEqual({ minutes: 1, seconds: 45 });
    expect(joinRest(1, 45)).toBe(105);
    expect(joinRest(0, 0)).toBe(0);
  });
  it('the device list is a JSON array under its own key, fail-open', () => {
    expect(REST_PRESETS_KEY).toBe('ea:workout:rest-presets:v1');
    // No localStorage in node: the reader answers [] and the writer is silent.
    expect(readRestPresets(parseRestPresets)).toEqual([]);
    expect(() => writeRestPresets([75])).not.toThrow();
  });
  it('the sheet: the chips, Off, Custom; the two wheels (seconds by five); Use and Save as preset; a saved chip removes', () => {
    const src = read('src/components/workouts/WorkoutControls.tsx');
    expect(src).toMatch(/restPresetChips\(savedPresets\)\.map/);
    expect(src).toMatch(/data-workout-rest-preset="off"/);
    expect(src).toMatch(/data-workout-rest-custom=""/);
    expect(src).toMatch(/<NumberWheel label="Minutes" min=\{0\} max=\{10\}/);
    expect(src).toMatch(/<NumberWheel label="Seconds" min=\{0\} max=\{55\} step=\{5\}/);
    expect(src).toMatch(/data-workout-rest-custom-use=""/);
    expect(src).toMatch(/data-workout-rest-custom-save=""/);
    expect(src).toMatch(/data-workout-rest-preset-remove=\{chip\.seconds\}/);
    expect(src).not.toMatch(/REST_TARGET_PRESETS_S\.map/);
  });
});
