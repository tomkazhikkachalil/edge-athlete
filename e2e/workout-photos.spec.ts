import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';

// Workout set photos (Oct 4 2026). Tom: "the picture capture and upload is
// broken — it's not showing the images when it uploads, you can't go back
// and make edits to them either." Two causes, both pinned here:
//   1. a set's photo URL is a media-proxy path (or, right after an upload, a
//      private-bucket URL) and was drawn through Next's image optimizer,
//      which fetches without the viewer's cookie → a broken thumbnail;
//   2. the editor sends the proxied paths the GET handed it back in its
//      entries PUT, and the server stored them as-is — the storage sweep
//      parses `public/uploads/…`, so the files looked unused. The server
//      now heals a proxied path to the stored URL and refuses one it cannot
//      verify by name.

const STORED_URL = /\/storage\/v1\/object\/public\/uploads\/posts\//;

async function tinyJpeg(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#7c3aed' } }).jpeg().toBuffer();
}

/** The direct upload, as the editor does it: intent → PUT to storage → complete. */
async function uploadPhoto(api: import('@playwright/test').APIRequestContext): Promise<{ url: string; path: string }> {
  const bytes = await tinyJpeg();
  const intent = await api.post('/api/upload/post-media/intent', { data: { type: 'image/jpeg', size: bytes.length } });
  expect(intent.ok(), await intent.text()).toBe(true);
  const { path, signedUrl } = await intent.json();
  const put = await api.put(signedUrl, { data: bytes, headers: { 'Content-Type': 'image/jpeg' } });
  expect(put.ok(), await put.text()).toBe(true);
  const complete = await api.post('/api/upload/post-media/complete', { data: { path, type: 'image/jpeg' } });
  expect(complete.ok(), await complete.text()).toBe(true);
  const body = await complete.json();
  expect(body.url).toMatch(STORED_URL);
  return { url: body.url as string, path: body.url.split('/public/uploads/')[1] as string };
}

test('a set photo shows after upload and after an edit, and the stored URL stays the storage URL @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  let workoutId: string | null = null;
  let storagePath: string | null = null;
  try {
    const photo = await uploadPhoto(api);
    storagePath = photo.path;

    // A finished workout whose one set carries the photo (the stored URL).
    const setOf = (media: Array<{ url: string; type: string }>) => ({
      setNumber: 1, reps: 5, weight: 185, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media,
    });
    const exerciseOf = (media: Array<{ url: string; type: string }>) => [{ name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [setOf(media)] }];
    const created = await api.post('/api/workouts', {
      data: { mode: 'manual', startedAt: new Date().toISOString(), durationSeconds: 1800, title: `QA photo ${Date.now()}`, exercises: exerciseOf([{ url: photo.url, type: 'image' }]) },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const createdBody = await created.json();
    workoutId = (createdBody.session?.id ?? createdBody.id) as string;
    expect(workoutId).toBeTruthy();

    // The GET hands the editor a proxied path, never the storage URL.
    const read = await api.get(`/api/workouts/${workoutId}`);
    expect(read.ok()).toBe(true);
    const session = (await read.json()).session;
    const proxied = session.exercises[0].sets[0].media[0].url as string;
    expect(proxied.startsWith('/api/media/')).toBe(true);

    // The editor saves the snapshot back with that proxied path — the row
    // must hold the storage URL again (the sweep can see it).
    const saved = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: Date.now(), exercises: exerciseOf([{ url: proxied, type: 'image' }]) },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const { data: rows } = await admin.from('workout_sets').select('media, workout_exercises!inner(session_id)').eq('workout_exercises.session_id', workoutId);
    const storedMedia = (rows ?? []).flatMap(r => (Array.isArray(r.media) ? r.media : [])) as Array<{ url: string }>;
    expect(storedMedia).toHaveLength(1);
    expect(storedMedia[0].url).toMatch(STORED_URL);
    expect(storedMedia[0].url).toBe(photo.url);

    // A proxied path the server cannot verify is refused by name.
    const forged = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: Date.now() + 1, exercises: exerciseOf([{ url: '/api/media/forged.token', type: 'image' }]) },
    });
    expect(forged.status()).toBe(400);
    expect((await forged.json()).error).toMatch(/media URL/i);

    // The review screen draws the thumbnail (unoptimized, through the proxy
    // with the viewer's cookie) and offers the pencil.
    await page.goto(`/app/workout/${workoutId}`);
    const tile = page.locator('[data-set-media-tile]').first();
    await expect(tile).toBeVisible({ timeout: 20_000 });
    const img = tile.locator('img');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(tile.getByRole('button', { name: 'Edit media' })).toBeVisible();
    await expect(tile.getByRole('button', { name: 'Remove media' })).toBeVisible();
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`).catch(() => undefined);
    if (storagePath) await admin.storage.from('uploads').remove([storagePath]).catch(() => undefined);
    await api.dispose();
    void user;
  }
});
