import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEntriesPayload, type EntryExercise } from '../workouts/entries';
import { patchMediaByUrl } from '../workouts/set-media-pending';
import { collectSetMediaPaths } from '../storage-sweep';

// Video posters PR 2b (Oct 13 2026): a workout clip carries its poster on the
// set's media entry; the validator keeps it, the sweep keeps the file, the
// share hands it to the post, and the upload hook is the house queue.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const SB = 'https://abc.supabase.co/storage/v1/object/public/uploads';

describe('SetMedia.thumbnailUrl through the validator', () => {
  // The validator takes the exercises array (the PUT's `exercises`).
  const payload = (media: unknown[]) => [
    { name: 'Bench', exerciseKey: null, category: 'strength', notes: null, sets: [{ setNumber: 1, reps: 5, weight: null, weightUnit: null, durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media }] },
  ];
  it('keeps a poster that is a media URL of ours, drops anything else on the item', () => {
    const out = validateEntriesPayload(payload([{ url: `${SB}/posts/u1/clip.mp4`, type: 'video', thumbnailUrl: `${SB}/posts/u1/poster.jpg`, foo: 'bar' }]));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.exercises[0].sets[0].media).toEqual([{ url: `${SB}/posts/u1/clip.mp4`, type: 'video', thumbnailUrl: `${SB}/posts/u1/poster.jpg` }]);
  });
  it('a poster that is not ours is dropped silently (the clip stays); the pre-PR shape is untouched', () => {
    const out = validateEntriesPayload(payload([{ url: `${SB}/posts/u1/clip.mp4`, type: 'video', thumbnailUrl: 'https://elsewhere.com/x.jpg' }]));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.exercises[0].sets[0].media).toEqual([{ url: `${SB}/posts/u1/clip.mp4`, type: 'video' }]);
    const plain = validateEntriesPayload(payload([{ url: `${SB}/posts/u1/a.jpg`, type: 'image' }]));
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(Object.keys(plain.exercises[0].sets[0].media[0])).toEqual(['url', 'type']);
  });
});

describe('patchMediaByUrl', () => {
  const set = (media: EntryExercise['sets'][number]['media']): EntryExercise['sets'][number] => ({ setNumber: 1, reps: null, weight: null, weightUnit: null, durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media });
  const ex = (sets: EntryExercise['sets']): EntryExercise => ({ clientId: 'c', name: 'Bench', exerciseKey: null, category: 'strength', notes: null, sets });
  it('patches the ONE entry with the URL, found by URL; the same array when nothing changed', () => {
    const exercises = [ex([set([{ url: 'u1', type: 'video' }, { url: 'u2', type: 'video' }])]), ex([set([{ url: 'u3', type: 'image' }])])];
    const next = patchMediaByUrl(exercises, 'u2', { thumbnailUrl: 'p2' });
    expect(next).not.toBe(exercises);
    expect(next[0].sets[0].media).toEqual([{ url: 'u1', type: 'video' }, { url: 'u2', type: 'video', thumbnailUrl: 'p2' }]);
    expect(next[1]).toBe(exercises[1]); // untouched exercises keep their identity
    expect(patchMediaByUrl(next, 'u2', { thumbnailUrl: 'p2' })).toBe(next); // already so
    expect(patchMediaByUrl(exercises, 'nope', { thumbnailUrl: 'p' })).toBe(exercises);
  });
});

describe("the sweep keeps a clip's poster", () => {
  it('collectSetMediaPaths reads thumbnailUrl beside url', () => {
    expect(collectSetMediaPaths([[{ url: `${SB}/posts/u1/clip.mp4`, type: 'video', thumbnailUrl: `${SB}/posts/u1/poster.jpg` }]])).toEqual(['posts/u1/clip.mp4', 'posts/u1/poster.jpg']);
    expect(collectSetMediaPaths([[{ url: `${SB}/posts/u1/a.jpg`, type: 'image', thumbnailUrl: 'junk' }]])).toEqual(['posts/u1/a.jpg']);
  });
});

describe('source pins — the workout clips on the house queue', () => {
  it('useSetMediaUploads is an adapter over useMediaUploadQueue, grabs a poster after the tile, writes it by URL; the thumbs and the share carry it', () => {
    const hook = read('src/components/workouts/useSetMediaUploads.ts');
    expect(hook).toMatch(/useMediaUploadQueue\(\{ sessionId, onStored, notify \}\)/);
    expect(hook).not.toMatch(/uploadPostMedia/);
    expect(hook).toMatch(/grabPreviewsInto\(queue, localId, file\)/);
    const grab = read('src/components/media/grab-poster.ts');
    expect(grab).toMatch(/queue\.device\(async \(\) =>/);
    expect(grab).toMatch(/capturePoster\(file, posterTimeFor\(null\)\)/);
    expect(hook).toMatch(/patchMediaByUrl\(current, item\.storedUrl, \{ thumbnailUrl: item\.posterUrl \}\)/);
    expect(hook).toMatch(/export type SetMediaStatus = 'pending' \| 'failed' \| 'processing';/);
    expect(read('src/components/workouts/ExerciseCard.tsx')).toMatch(/thumbnailUrl=\{media\.thumbnailUrl\}/);
    expect(read('src/components/workouts/FinishFlow.tsx')).toMatch(/thumbnailUrl=\{clip\.thumbnailUrl\}/);
    expect(read('src/components/workouts/SetImageStack.tsx')).toMatch(/thumbnailUrl=\{first\.thumbnailUrl\}/);
    expect(read('src/components/workouts/WorkoutEditorScreen.tsx')).toMatch(/sortOrder: order, thumbnailUrl: media\.thumbnailUrl/);
    expect(read('src/lib/storage-sweep.ts')).toMatch(/thumbnailUrl\?: unknown/);
    // Edit post uploads through the queue too.
    const edit = read('src/components/EditPostModal.tsx');
    expect(edit).toMatch(/useMediaUploadQueue\(\{ sessionId: `edit-post:\$\{post\.id\}` \}\)/);
    expect(edit).not.toMatch(/uploadPostMedia/);
  });
});
