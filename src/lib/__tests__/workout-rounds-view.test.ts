import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advanceAfterComplete, completionSignature, initialSlide, roundComplete, slideIndexFromScroll } from '../workouts/rounds-view';
import { copyRound, groupVolumeLbs, roundHasData } from '../workouts/groups';
import { GROUP_VIEW_KEY, readGroupView, readSwipeHintSeen, SWIPE_HINT_KEY, writeGroupView, writeSwipeHintSeen } from '../workouts/timer-prefs';
import type { EntryExercise, EntrySet } from '../workouts/entries';

// Workout fixes (Oct 13 2026): rounds of a superset / circuit as a horizontal
// stack — the pure rules the track and the cards lean on.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

const set = (n: number, over: Partial<EntrySet> = {}): EntrySet => ({
  setNumber: n, reps: null, weight: null, weightUnit: null, durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [], ...over,
});
const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const member = (name: string, sets: EntrySet[]): EntryExercise => ({ clientId: `c-${name}`, name, exerciseKey: null, category: 'strength', notes: null, sets, groupId: G, groupKind: 'circuit', groupRounds: sets.length });

describe('slideIndexFromScroll', () => {
  it('the nearest slide, clamped', () => {
    expect(slideIndexFromScroll(0, 300, 4)).toBe(0);
    expect(slideIndexFromScroll(140, 300, 4)).toBe(0);
    expect(slideIndexFromScroll(160, 300, 4)).toBe(1);
    expect(slideIndexFromScroll(900, 300, 4)).toBe(3);
    expect(slideIndexFromScroll(5000, 300, 4)).toBe(3);
    expect(slideIndexFromScroll(-20, 300, 4)).toBe(0);
    // A zero width (a hidden track) and no slides never divide by zero.
    expect(slideIndexFromScroll(100, 0, 4)).toBe(0);
    expect(slideIndexFromScroll(100, 300, 0)).toBe(0);
  });
});

describe('roundComplete / completionSignature / initialSlide', () => {
  const done = { completedAt: '2026-10-13T00:00:00.000Z' };
  const members = [
    member('Squat', [set(1, { reps: 10, ...done }), set(2, { reps: 10 }), set(3)]),
    member('Push-Ups', [set(1, { reps: 15, ...done }), set(2, { reps: 12, ...done }), set(3)]),
  ];
  it('a round is complete only when EVERY member marked it — data alone is not completion', () => {
    expect(roundComplete(members, 0)).toBe(true);
    expect(roundComplete(members, 1)).toBe(false); // Squat's round 2 has reps but no mark
    expect(roundComplete(members, 2)).toBe(false);
    expect(roundComplete(members, -1)).toBe(false);
    expect(roundComplete([], 0)).toBe(false);
    expect(completionSignature(members, 3)).toBe('100');
    expect(completionSignature(members, 4)).toBe('1000'); // a round beyond the sets is incomplete
  });
  it('the first slide is the first incomplete round, else the last', () => {
    expect(initialSlide(members, 3)).toBe(1);
    const all = [member('A', [set(1, done), set(2, done)])];
    expect(initialSlide(all, 2)).toBe(1);
    expect(initialSlide([], 0)).toBe(0);
  });
});

describe('advanceAfterComplete', () => {
  it('moves to the next round on the false → true edge of the round IN VIEW only', () => {
    expect(advanceAfterComplete('000', '100', 0, 3)).toBe(1);
    expect(advanceAfterComplete('100', '110', 1, 3)).toBe(2);
    // The last round completing stays.
    expect(advanceAfterComplete('110', '111', 2, 3)).toBe(2);
    // A different round completing (the athlete swiped back and marked round 1) does not move the view.
    expect(advanceAfterComplete('010', '110', 1, 3)).toBe(1);
    // Un-marking never moves.
    expect(advanceAfterComplete('100', '000', 0, 3)).toBe(0);
    // Already complete and unchanged: stay.
    expect(advanceAfterComplete('100', '100', 0, 3)).toBe(0);
    // Out of range is clamped.
    expect(advanceAfterComplete('11', '11', 5, 2)).toBe(1);
    expect(advanceAfterComplete('', '', 0, 0)).toBe(0);
  });
});

describe('copyRound', () => {
  const exercises: EntryExercise[] = [
    { clientId: 'solo', name: 'Deadlift', exerciseKey: null, category: 'strength', notes: null, sets: [set(1, { reps: 5, weight: 200, weightUnit: 'lbs' }), set(2)] },
    member('Squat', [set(1, { reps: 10, weight: 50, weightUnit: 'kg', completedAt: 'x', restSeconds: 60, media: [{ url: 'https://x/a.jpg', type: 'image' }] }), set(2, { restSeconds: 45 }), set(3)]),
    member('Row', [set(1, { durationSeconds: 120, distance: 500, distanceUnit: 'm', completedAt: 'x' }), set(2), set(3)]),
  ];
  it('round k takes round k−1’s values on every member — never media, completion or rest', () => {
    const out = copyRound(exercises, G, 1);
    const squat = out[1].sets[1];
    expect(squat).toMatchObject({ setNumber: 2, reps: 10, weight: 50, weightUnit: 'kg', completedAt: null, media: [], restSeconds: 45 });
    expect(out[2].sets[1]).toMatchObject({ setNumber: 2, durationSeconds: 120, distance: 500, distanceUnit: 'm', completedAt: null });
    // The previous round itself is untouched; the single exercise is untouched.
    expect(out[1].sets[0]).toEqual(exercises[1].sets[0]);
    expect(out[0]).toBe(exercises[0]);
    // Round 3 stays empty.
    expect(out[1].sets[2]).toEqual(set(3));
  });
  it('round 0, an unknown group or a round beyond the count change nothing', () => {
    expect(copyRound(exercises, G, 0)).toEqual(exercises);
    expect(copyRound(exercises, G, 3)).toEqual(exercises);
    expect(copyRound(exercises, 'nope', 1)).toEqual(exercises);
  });
  it('roundHasData says whether Copy is offered', () => {
    expect(roundHasData(exercises.slice(1), 0)).toBe(true);
    expect(roundHasData(exercises.slice(1), 1)).toBe(false); // a rest alone is not data
    expect(roundHasData(exercises.slice(1), 2)).toBe(false);
  });
});

describe('groupVolumeLbs', () => {
  it('Σ reps × weight in lbs over the members, rounded; cardio and empty rounds add nothing', () => {
    const members = [
      member('Squat', [set(1, { reps: 10, weight: 50, weightUnit: 'kg' }), set(2, { reps: 10, weight: 100, weightUnit: 'lbs' })]),
      member('Row', [set(1, { durationSeconds: 120 }), set(2)]),
    ];
    expect(groupVolumeLbs(members)).toBe(Math.round(10 * 50 * 2.20462 + 1000));
    expect(groupVolumeLbs([member('Row', [set(1, { durationSeconds: 120 })])])).toBe(0);
    expect(groupVolumeLbs([])).toBe(0);
  });
});

describe('the device preferences', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  it('the group view defaults to swipe; list is remembered; swipe clears the key', () => {
    expect(readGroupView()).toBe('swipe');
    writeGroupView('list');
    expect(store.get(GROUP_VIEW_KEY)).toBe('list');
    expect(readGroupView()).toBe('list');
    writeGroupView('swipe');
    expect(store.has(GROUP_VIEW_KEY)).toBe(false);
    store.set(GROUP_VIEW_KEY, 'garbage');
    expect(readGroupView()).toBe('swipe');
  });
  it('the swipe hint is seen once', () => {
    expect(readSwipeHintSeen()).toBe(false);
    writeSwipeHintSeen();
    expect(store.get(SWIPE_HINT_KEY)).toBe('1');
    expect(readSwipeHintSeen()).toBe(true);
  });
  it('without storage the hint never nags and the view is swipe', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => { throw new Error('blocked'); } };
    expect(readSwipeHintSeen()).toBe(true);
    expect(readGroupView()).toBe('swipe');
  });
});

describe('source pins — rounds as a swipe', () => {
  it('RoundsTrack is the one carousel: it sets scrollLeft (never scrollIntoView), honours reduced motion, hides its own moves from the scroll handler, and sets no touch-action', () => {
    const track = read('src/components/workouts/RoundsTrack.tsx');
    expect(track).toMatch(/el\.scrollTo\(\{ left,/);
    expect(track).not.toMatch(/\.scrollIntoView\(/);
    expect(track).toMatch(/prefers-reduced-motion: reduce/);
    expect(track).toMatch(/programmatic\.current = true/);
    expect(track).toMatch(/if \(programmatic\.current\) return;/);
    expect(track).toMatch(/snap-x snap-mandatory/);
    expect(track).toMatch(/overscroll-x-contain/);
    // No touch-action on the track: the effective value is the INTERSECTION down the chain, so `pan-x` would stop the page scrolling from a touch on a round.
    expect(track).not.toMatch(/touchAction|touch-pan-|className="[^"]*touch-/);
    expect(track).toMatch(/data-rounds-current=\{safeIndex \+ 1\}/);
    expect(track).toMatch(/aria-label=\{`Round \$\{k \+ 1\}`\}/);
    expect(track).toMatch(/hidden lg:inline-flex[^"]*"\s+aria-label="Previous round"/);
    expect(track).toMatch(/data-rounds-slide=\{k \+ 1\}/);
    expect(track).toMatch(/inert: true/);
  });
  it('the live group card reads the view the editor passes, renders one round per slide, offers Copy previous round and the one-time hint', () => {
    const card = read('src/components/workouts/ExerciseGroupCard.tsx');
    expect(card).toMatch(/view: GroupView;/);
    expect(card).toMatch(/<RoundsTrack/);
    expect(card).toMatch(/grouped=\{\{ onDeleteRound, onRemoveFromGroup: [^}]+, \.\.\.\(onlyRound === undefined \? \{\} : \{ onlyRound \}\) \}\}/);
    expect(card).toMatch(/data-group-copy-round=\{k \+ 1\}/);
    expect(card).toMatch(/disabled=\{roundHasData\(group\.members, k\)\}/);
    expect(card).toMatch(/advanceAfterComplete\(before, signature/);
    expect(card).toMatch(/data-rounds-hint=""/);
    expect(card).toMatch(/label: 'List view'/);
    expect(card).toMatch(/label: 'Swipe view'/);
    expect(card).toMatch(/data-group-view=\{view\}/);
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).toMatch(/readGroupView\(\)/);
    expect(editor).toMatch(/writeGroupView\(next\)/);
    expect(editor).toMatch(/copyRound\(exercises, item\.group\.groupId, roundIndex\)/);
    const exerciseCard = read('src/components/workouts/ExerciseCard.tsx');
    expect(exerciseCard).toMatch(/grouped\?\.onlyRound === undefined \|\| grouped\.onlyRound === index/);
  });
  it('the post and the history card share GroupDetailCard; a single exercise keeps its "Set N" lines', () => {
    for (const f of ['src/components/workouts/WorkoutPostCard.tsx', 'src/components/workouts/WorkoutCard.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/renderItems\(/);
      expect(src, f).toMatch(/<GroupDetailCard key=\{item\.group\.groupId\}/);
      expect(src, f).toMatch(/<span className="text-faint">Set \{set\.setNumber\}<\/span>/);
      expect(src, f).not.toMatch(/exercise\.groupId \? 'Round' : 'Set'/);
    }
    const detail = read('src/components/workouts/GroupDetailCard.tsx');
    expect(detail).toMatch(/data-post-group-card=\{kind\}/);
    expect(detail).toMatch(/aria-expanded=\{expanded\}/);
    expect(detail).toMatch(/data-post-group-expanded=\{expanded \? 'true' : 'false'\}/);
    expect(detail).toMatch(/groupVolumeLbs\(members\)/);
    expect(detail).toMatch(/<RoundsTrack/);
  });
});
