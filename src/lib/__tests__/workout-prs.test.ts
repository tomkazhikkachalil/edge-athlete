import { describe, expect, it } from 'vitest';
import { beats, bestsOf, capPRs, epley, foldBests, formatHold, formatPr, holdRecord, isHoldExercise, newPRs, prLines, rankPRs, workoutUnit, type PrHit } from '../workouts/prs';
import type { EntryExercise, EntrySet } from '../workouts/entries';

const set = (reps: number | null, weight: number | null, unit: 'lbs' | 'kg' | null = 'lbs'): EntrySet => ({
  setNumber: 1,
  reps,
  weight,
  weightUnit: weight === null ? null : unit,
  durationSeconds: null,
  distance: null,
  distanceUnit: null,
  completedAt: null,
  media: [],
});
const ex = (name: string, key: string | null, sets: EntrySet[]): EntryExercise => ({ clientId: name, name, exerciseKey: key, category: 'strength', notes: null, sets });

describe('Epley', () => {
  it('a single is itself; 5 reps add a sixth; past 12 there is none', () => {
    expect(epley(225, 1)).toBe(225);
    expect(epley(200, 5)).toBeCloseTo(233.33, 1);
    expect(epley(100, 13)).toBeNull();
    expect(epley(0, 5)).toBeNull();
  });
});

describe('bests and records', () => {
  const lastWeek = bestsOf([ex('Bench Press', 'bench_press', [set(5, 185), set(3, 205)]), ex('Pull-ups', 'pull_ups', [set(10, null)])]);
  const twoWeeks = bestsOf([ex('bench press', null, [set(1, 215)])]);
  const history = foldBests([lastWeek, twoWeeks]);

  it('folds every session into all-time bests; a typed name and the catalog key are ONE lift', () => {
    expect(history.get('bench_press')).toMatchObject({ heaviest: 215, reps: null });
    expect(history.get('bench_press')!.e1rm).toBeCloseTo(225.5, 5); // 205 × 3, above the single at 215
    expect(history.has('bench press')).toBe(false);
    expect(history.get('pull_ups')).toMatchObject({ reps: 10, heaviest: null });
  });

  it('a key the catalog does not know is ignored: the name decides', () => {
    const b = bestsOf([ex('Pull-ups', 'pullups_v2', [set(11, null)]), ex('My Lift', 'not_a_key', [set(5, 50)])]);
    expect(b.get('pull_ups')).toMatchObject({ reps: 11 });
    expect(b.get('my_lift')).toMatchObject({ heaviest: 50 });
  });

  it('a new best is a record; equal is not; a first-ever lift is a baseline', () => {
    const today = bestsOf([
      ex('Bench Press', 'bench_press', [set(5, 195), set(1, 205)]), // e1rm 227.5 > 225.5; heaviest below the typed 215
      ex('pull ups', null, [set(12, null)]), // typed today, catalog last week: one lift
      ex('Deadlift', 'deadlift', [set(5, 315)]),
    ]);
    const hits = newPRs(today, history);
    expect(hits.map(h => [h.exerciseId, h.kind])).toEqual([
      ['bench_press', 'e1rm'], // volume 1,180 lb is below last week's 1,540: no record
      ['pull_ups', 'reps'],
    ]);
    expect(hits.find(h => h.kind === 'reps')).toMatchObject({ value: 12, previous: 10 });
  });

  it('mixes kg and lb through the one conversion', () => {
    const kg = bestsOf([ex('Squat', 'squat', [set(1, 100, 'kg')])]);
    expect(kg.get('squat')!.heaviest).toBeCloseTo(220.46, 1);
    // 100 kg after 220 lbs is the same lift on another bar, not three records (Nov 11 2026)…
    const hist = bestsOf([ex('Squat', 'squat', [set(1, 220, 'lbs')])]);
    expect(newPRs(kg, hist)).toEqual([]);
    // …and the next plate up is one.
    expect(newPRs(bestsOf([ex('Squat', 'squat', [set(1, 102.5, 'kg')])]), hist).map(h => h.kind)).toEqual(['heaviest', 'e1rm', 'volume']);
  });

  it('a record beats the old one by a real margin, per kind', () => {
    expect(beats('heaviest', 225.4, 225)).toBe(false);
    expect(beats('heaviest', 226, 225)).toBe(true);
    expect(beats('e1rm', 225.5, 225)).toBe(false);
    expect(beats('reps', 12, 12)).toBe(false);
    expect(beats('reps', 13, 12)).toBe(true);
    expect(beats('duration', 90.4, 90)).toBe(false);
    expect(beats('duration', 91, 90)).toBe(true);
    expect(beats('volume', 10_020, 10_000)).toBe(false);
    expect(beats('volume', 10_030, 10_000)).toBe(true);
  });

  it('reads a record in the workout’s own unit', () => {
    expect(formatPr('heaviest', 220.462, 'kg')).toBe('100 kg');
    expect(formatPr('heaviest', 225, 'lb')).toBe('225 lbs');
    expect(formatPr('heaviest', 225, 'lb', true)).toBe('225');
    expect(formatPr('reps', 12, 'lb', true)).toBe('12');
    expect(formatPr('reps', 12, 'kg')).toBe('12 reps');
    expect(workoutUnit([ex('Squat', 'squat', [set(5, 100, 'kg'), set(5, 100, 'kg'), set(5, 225, 'lbs')])])).toBe('kg');
    expect(workoutUnit([])).toBe('lb');
  });
});

// ── What is announced (Training redesign PR 1, Nov 11 2026) ──────────────────
describe('ranked, capped, said once', () => {
  const hit = (exerciseId: string, kind: PrHit['kind'], value = 100): PrHit => ({ exerciseId, name: exerciseId, kind, value, previous: 1 });
  const hits = [hit('bench_press', 'heaviest', 195), hit('bench_press', 'e1rm', 227.5), hit('bench_press', 'volume', 975), hit('pull_ups', 'reps', 12), hit('squat', 'volume', 3000), hit('plank', 'duration', 130)];

  it('every exercise\'s strongest kind comes first, in the workout\'s order, then the rest', () => {
    expect(rankPRs(hits).map(h => `${h.exerciseId}:${h.kind}`)).toEqual([
      'bench_press:heaviest', 'pull_ups:reps', 'squat:volume', 'plank:duration',
      'bench_press:e1rm', 'bench_press:volume',
    ]);
    expect(rankPRs([hit('squat', 'volume'), hit('squat', 'e1rm')]).map(h => h.kind)).toEqual(['e1rm', 'volume']);
    expect(rankPRs([])).toEqual([]);
  });

  it('three show, the rest are a count', () => {
    expect(capPRs(rankPRs(hits))).toMatchObject({ more: 3 });
    expect(capPRs(rankPRs(hits)).shown.map(h => h.exerciseId)).toEqual(['bench_press', 'pull_ups', 'squat']);
    expect(capPRs([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(capPRs([])).toEqual({ shown: [], more: 0 });
  });

  it('a post\'s lines: ranked; a confirmed five-lift best only when it beat something and the sets did not already say so', () => {
    const confirmed = [
      { metricKey: 'bench_press', metricLabel: 'Bench Press', valueDisplay: '195 lbs', previousBest: 185 }, // the sets say it
      { metricKey: 'deadlift', metricLabel: 'Deadlift', valueDisplay: '315 lbs', previousBest: null }, // a first entry: a baseline
      { metricKey: 'overhead_press', metricLabel: 'Overhead Press', valueDisplay: '135 lbs', previousBest: 130 },
    ];
    expect(prLines(hits, 'lb', confirmed)).toEqual([
      { label: 'Overhead Press', display: '135 lbs' },
      { label: 'bench_press · Heaviest', display: '195 lbs' },
      { label: 'pull_ups · Most reps', display: '12 reps' },
      { label: 'squat · Best volume', display: '3,000 lbs' },
      { label: 'plank · Longest hold', display: '2:10' },
      { label: 'bench_press · Est. 1-rep max', display: '227.5 lbs' },
      { label: 'bench_press · Best volume', display: '975 lbs' },
    ]);
    expect(prLines([], 'lb')).toEqual([]);
  });
});

// ── Longest hold (Stopwatch additions, Oct 23 2026) ──────────────────────────
describe('longest hold', () => {
  const hold = (name: string, key: string | null, seconds: number[]): EntryExercise => ex(name, key, seconds.map(d => ({ ...set(null, null), durationSeconds: d })));
  it('a hold is a catalog duration exercise outside cardio; a machine, a distance exercise or a free-text name never is', () => {
    expect(isHoldExercise({ exerciseKey: 'plank' })).toBe(true);
    expect(isHoldExercise({ exerciseKey: 'stretching' })).toBe(true);
    expect(isHoldExercise({ exerciseKey: 'elliptical' })).toBe(false);
    expect(isHoldExercise({ exerciseKey: 'run' })).toBe(false);
    expect(isHoldExercise({ exerciseKey: 'bench_press' })).toBe(false);
    expect(isHoldExercise({ exerciseKey: null })).toBe(false);
    expect(isHoldExercise({ exerciseKey: null, name: 'Wall sit' })).toBe(false);
    expect(isHoldExercise({ exerciseKey: null, name: 'planks' })).toBe(true); // a typed name the catalog knows
  });
  it('the longest hold is a best; a longer one later is a record; equal or shorter is not; the first ever is a baseline; a machine has none', () => {
    const lastWeek = bestsOf([hold('Plank', 'plank', [60, 90]), hold('Elliptical', 'elliptical', [1200])]);
    expect(lastWeek.get('plank')).toMatchObject({ duration: 90, heaviest: null, reps: null });
    expect(lastWeek.get('elliptical')!.duration).toBeNull();
    const history = foldBests([lastWeek, bestsOf([hold('Plank', 'plank', [75])])]);
    expect(history.get('plank')!.duration).toBe(90);
    expect(newPRs(bestsOf([hold('Plank', 'plank', [130])]), history)).toEqual([{ exerciseId: 'plank', name: 'Plank', kind: 'duration', value: 130, previous: 90 }]);
    expect(newPRs(bestsOf([hold('Plank', 'plank', [90])]), history)).toEqual([]);
    expect(newPRs(bestsOf([hold('Plank', 'plank', [85])]), history)).toEqual([]);
    expect(newPRs(bestsOf([hold('Wall sit', null, [200])]), history)).toEqual([]);
    expect(newPRs(bestsOf([hold('Elliptical', 'elliptical', [2000])]), history)).toEqual([]);
  });
  it('reads as the clock does', () => {
    expect(formatHold(130)).toBe('2:10');
    expect(formatHold(3723)).toBe('1:02:03');
    expect(formatPr('duration', 130, 'lb')).toBe('2:10');
    expect(formatPr('duration', 130, 'kg', true)).toBe('2:10');
  });
  it('the live check: against the history AND this session\'s earlier sets; the first ever is a baseline', () => {
    const history = bestsOf([hold('Plank', 'plank', [90])]);
    const plank = hold('Plank', 'plank', [100]);
    const session = [plank, ex('Bench', 'bench_press', [set(5, 185)])];
    expect(holdRecord(history, session, plank, 130)).toBe('pr');
    expect(holdRecord(history, session, plank, 95)).toBe('no'); // this session already held 100
    expect(holdRecord(null, session, plank, 101)).toBe('pr');
    expect(holdRecord(null, [], plank, 40)).toBe('baseline');
    expect(holdRecord(history, session, session[1], 40)).toBe('no');
    expect(holdRecord(history, session, plank, 0)).toBe('no');
  });
});
