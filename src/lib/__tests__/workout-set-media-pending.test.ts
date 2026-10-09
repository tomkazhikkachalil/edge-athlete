import { describe, expect, it } from 'vitest';
import {
  PENDING_MEDIA_PREFIX,
  isPendingMedia,
  pendingIdOf,
  pendingLocalIds,
  pendingUrl,
  reattachPendingMedia,
  removePendingMedia,
  replacePendingMedia,
  stripPendingMedia,
} from '../workouts/set-media-pending';
import { fileFromStashRecord, isStashExpired, STASH_TTL_MS, toStashRecord } from '../workouts/media-stash';
import { collectWorkoutMedia } from '../workouts/summary';
import type { EntryExercise } from '../workouts/entries';

const set = (setNumber: number, media: Array<{ url: string; type: 'image' | 'video' }>) => ({
  setNumber,
  reps: null,
  weight: null,
  weightUnit: null,
  durationSeconds: null,
  distance: null,
  distanceUnit: null,
  completedAt: null,
  media,
});

const STORED = 'https://x.supabase.co/storage/v1/object/public/uploads/posts/u/a.jpg';

function workout(): EntryExercise[] {
  return [
    { name: 'Bench', exerciseKey: 'bench_press', notes: null, sets: [set(1, [{ url: STORED, type: 'image' }, { url: pendingUrl('p1'), type: 'image' }]), set(2, [])] },
    { name: 'Row', exerciseKey: null, notes: null, sets: [set(1, [{ url: pendingUrl('p2'), type: 'video' }])] },
  ] as EntryExercise[];
}

describe('set-media-pending — the pending clip spelled once', () => {
  it('round-trips a localId through the pending URL and reads stored URLs as not pending', () => {
    expect(pendingUrl('abc')).toBe(`${PENDING_MEDIA_PREFIX}abc`);
    expect(pendingIdOf(pendingUrl('abc'))).toBe('abc');
    expect(pendingIdOf(STORED)).toBeNull();
    expect(pendingIdOf('/api/media/token')).toBeNull();
    expect(pendingIdOf(PENDING_MEDIA_PREFIX)).toBeNull(); // an empty id is not a pending clip
    expect(isPendingMedia({ url: pendingUrl('x') })).toBe(true);
    expect(isPendingMedia({ url: STORED })).toBe(false);
  });

  it('lists the pending ids in reading order', () => {
    expect(pendingLocalIds(workout())).toEqual(['p1', 'p2']);
    expect(pendingLocalIds([])).toEqual([]);
  });

  it('strips every pending clip from a PUT body and leaves the stored ones', () => {
    const stripped = stripPendingMedia(workout());
    expect(stripped[0].sets[0].media).toEqual([{ url: STORED, type: 'image' }]);
    expect(stripped[1].sets[0].media).toEqual([]);
    expect(stripped[0].sets[1].media).toEqual([]);
  });

  it('returns the SAME array when nothing is pending (the debounced sync sees no change)', () => {
    const clean = stripPendingMedia(workout());
    expect(stripPendingMedia(clean)).toBe(clean);
    const untouched = [{ name: 'A', exerciseKey: null, notes: null, sets: [set(1, [{ url: STORED, type: 'image' }])] }] as EntryExercise[];
    expect(stripPendingMedia(untouched)).toBe(untouched);
    expect(stripPendingMedia(untouched)[0]).toBe(untouched[0]);
  });

  it('replaces a pending clip with its stored URL wherever its set is, keeping order and type', () => {
    const next = replacePendingMedia(workout(), 'p1', STORED + '?v=2');
    expect(next[0].sets[0].media).toEqual([
      { url: STORED, type: 'image' },
      { url: STORED + '?v=2', type: 'image' },
    ]);
    // Untouched exercises keep their identity (index-keyed rows do not re-render).
    const before = workout();
    const after = replacePendingMedia(before, 'p2', STORED);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].sets[0].media[0]).toEqual({ url: STORED, type: 'video' });
  });

  it('removes a pending clip and is a no-op for one that is already gone', () => {
    const before = workout();
    const next = removePendingMedia(before, 'p1');
    expect(next[0].sets[0].media).toEqual([{ url: STORED, type: 'image' }]);
    expect(removePendingMedia(next, 'p1')).toBe(next);
    expect(replacePendingMedia(next, 'p1', STORED)).toBe(next);
    expect(removePendingMedia(before, 'nope')).toBe(before);
  });

  it('re-attaches an orphaned clip to its place, and refuses when the place is gone, the clip is present, or the set is full', () => {
    const base = workout();
    const back = reattachPendingMedia(base, { localId: 'p9', type: 'image', exerciseName: 'Row', setNumber: 1 }, 4);
    expect(back[1].sets[0].media.map(m => m.url)).toEqual([pendingUrl('p2'), pendingUrl('p9')]);
    expect(back[0]).toBe(base[0]);
    // already present → same array
    expect(reattachPendingMedia(base, { localId: 'p1', type: 'image', exerciseName: 'Bench', setNumber: 1 }, 4)).toBe(base);
    // the exercise or the set is gone → same array
    expect(reattachPendingMedia(base, { localId: 'p9', type: 'image', exerciseName: 'Deadlift', setNumber: 1 }, 4)).toBe(base);
    expect(reattachPendingMedia(base, { localId: 'p9', type: 'image', exerciseName: 'Bench', setNumber: 7 }, 4)).toBe(base);
    // the set is at its cap → same array
    expect(reattachPendingMedia(base, { localId: 'p9', type: 'video', exerciseName: 'Bench', setNumber: 1 }, 2)).toBe(base);
    // an empty set takes it
    const toEmpty = reattachPendingMedia(base, { localId: 'p9', type: 'video', exerciseName: 'Bench', setNumber: 2 }, 4);
    expect(toEmpty[0].sets[1].media).toEqual([{ url: pendingUrl('p9'), type: 'video' }]);
  });

  it('collectWorkoutMedia carries pending entries (the share step filters them)', () => {
    const all = collectWorkoutMedia(workout());
    expect(all.map(m => m.url)).toEqual([STORED, pendingUrl('p1'), pendingUrl('p2')]);
    expect(all.filter(m => !isPendingMedia(m)).map(m => m.url)).toEqual([STORED]);
  });
});

describe('media-stash — the bytes codec and the expiry rule', () => {
  it('stores an ArrayBuffer (never a Blob — WebKit) and rebuilds the File with its name and type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const rec = toStashRecord('s1', 'l1', bytes, { type: 'image/jpeg', name: 'IMG_1.jpg' }, 1_000);
    expect(rec).toEqual({ sessionId: 's1', localId: 'l1', bytes, type: 'image/jpeg', name: 'IMG_1.jpg', savedAt: 1_000 });
    expect(rec.bytes).toBeInstanceOf(ArrayBuffer);
    const file = fileFromStashRecord(rec);
    expect(file.name).toBe('IMG_1.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('carries the clip’s place when given, and leaves the key absent otherwise (older records)', () => {
    const withPlace = toStashRecord('s', 'l', new ArrayBuffer(0), { type: 'image/jpeg', name: 'a.jpg' }, 0, { exerciseName: 'Bench', setNumber: 2 });
    expect(withPlace.place).toEqual({ exerciseName: 'Bench', setNumber: 2 });
    const without = toStashRecord('s', 'l', new ArrayBuffer(0), { type: 'image/jpeg', name: 'a.jpg' }, 0);
    expect('place' in without).toBe(false);
  });

  it('names a file that arrived nameless', () => {
    const rec = toStashRecord('s', 'l9', new ArrayBuffer(0), { type: 'video/mp4', name: '' }, 0);
    expect(fileFromStashRecord(rec).name).toBe('clip-l9');
  });

  it('expires with the draft (48 h), not a moment before', () => {
    expect(isStashExpired({ savedAt: 0 }, STASH_TTL_MS)).toBe(false);
    expect(isStashExpired({ savedAt: 0 }, STASH_TTL_MS + 1)).toBe(true);
    expect(STASH_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });
});
