import { describe, expect, it } from 'vitest';
import {
  defaultShareOrder,
  moveShare,
  pruneShareOrder,
  removeMediaAt,
  replaceMediaAt,
  replaceShareUrl,
  shareList,
  toggleShare,
} from '../workouts/share-media';
import { collectWorkoutMedia } from '../workouts/summary';
import type { EntryExercise } from '../workouts/entries';

const clips = [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }];

describe('share-media — the carousel is the order the athlete chose', () => {
  it('defaults to the first N clips in reading order, once each', () => {
    expect(defaultShareOrder(clips, 10)).toEqual(['a', 'b', 'c', 'd']);
    expect(defaultShareOrder(clips, 2)).toEqual(['a', 'b']);
    expect(defaultShareOrder([{ url: 'a' }, { url: 'a' }], 10)).toEqual(['a']);
  });

  it('includes at the end, excludes anywhere, refuses an include at the cap', () => {
    expect(toggleShare(['a'], 'c', 10)).toEqual(['a', 'c']);
    expect(toggleShare(['a', 'c'], 'a', 10)).toEqual(['c']);
    const full = ['a', 'b'];
    expect(toggleShare(full, 'c', 2)).toBe(full);
    expect(toggleShare(full, 'a', 2)).toEqual(['b']); // an exclude always works
  });

  it('moves a selected clip one place and is a no-op at the edges or when unselected', () => {
    expect(moveShare(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveShare(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    const order = ['a', 'b', 'c'];
    expect(moveShare(order, 'a', -1)).toBe(order);
    expect(moveShare(order, 'c', 1)).toBe(order);
    expect(moveShare(order, 'zzz', 1)).toBe(order);
  });

  it('keeps a clip’s place through an edit and prunes a removed one', () => {
    expect(replaceShareUrl(['a', 'b'], 'a', 'a2')).toEqual(['a2', 'b']);
    const order = ['a', 'b'];
    expect(replaceShareUrl(order, 'nope', 'x')).toBe(order);
    expect(pruneShareOrder(['a', 'b', 'c'], [{ url: 'a' }, { url: 'c' }])).toEqual(['a', 'c']);
    expect(pruneShareOrder(order, clips)).toBe(order);
  });

  it('lists the selected clips in carousel order, then the rest in reading order', () => {
    const { selected, rest } = shareList(clips, ['c', 'a']);
    expect(selected.map(c => c.url)).toEqual(['c', 'a']);
    expect(rest.map(c => c.url)).toEqual(['b', 'd']);
    expect(shareList(clips, ['ghost']).selected).toEqual([]);
  });
});

const set = (setNumber: number, media: Array<{ url: string; type: 'image' | 'video' }>) => ({
  setNumber, reps: null, weight: null, weightUnit: null, durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media,
});

describe('share-media — the set-level edits by position', () => {
  const exercises = [
    { name: 'Bench', exerciseKey: 'bench_press', notes: null, sets: [set(1, [{ url: 'a', type: 'image' }, { url: 'b', type: 'video' }]), set(2, [])] },
    { name: 'Row', exerciseKey: null, notes: null, sets: [set(1, [{ url: 'c', type: 'image' }])] },
  ] as EntryExercise[];

  it('collectWorkoutMedia names every clip’s position', () => {
    const all = collectWorkoutMedia(exercises);
    expect(all.map(m => [m.url, m.exerciseIndex, m.setIndex, m.mediaIndex])).toEqual([
      ['a', 0, 0, 0],
      ['b', 0, 0, 1],
      ['c', 1, 0, 0],
    ]);
    expect(all[2].exerciseName).toBe('Row');
    expect(all[1].setNumber).toBe(1);
  });

  it('replaces the clip at a position and leaves every other exercise by identity', () => {
    const next = replaceMediaAt(exercises, { exerciseIndex: 0, setIndex: 0, mediaIndex: 1 }, { url: 'b2', type: 'video' });
    expect(next[0].sets[0].media).toEqual([{ url: 'a', type: 'image' }, { url: 'b2', type: 'video' }]);
    expect(next[1]).toBe(exercises[1]);
    expect(next[0].sets[1]).toBe(exercises[0].sets[1]);
  });

  it('removes the clip at a position and is a no-op for a position that does not exist', () => {
    const next = removeMediaAt(exercises, { exerciseIndex: 1, setIndex: 0, mediaIndex: 0 });
    expect(next[1].sets[0].media).toEqual([]);
    expect(removeMediaAt(exercises, { exerciseIndex: 0, setIndex: 1, mediaIndex: 0 })).toBe(exercises);
    expect(removeMediaAt(exercises, { exerciseIndex: 5, setIndex: 0, mediaIndex: 0 })).toBe(exercises);
    expect(replaceMediaAt(exercises, { exerciseIndex: 0, setIndex: 0, mediaIndex: 9 }, { url: 'x', type: 'image' })).toBe(exercises);
  });
});
