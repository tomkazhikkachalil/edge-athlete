import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

// Workout capture round (Oct 8 2026). Tom: taking a photo or video during a
// Vitals workout "kicked me out of the workout and the capture did not
// complete". The fix is Capture v2's rule on the set row: a capture ATTACHES
// AT ONCE as a tile (no editor, no decode), its bytes go to IndexedDB, the
// upload runs in the background one at a time, and a page iOS threw away
// while the camera was up comes back with the clip and resumes the upload.
// Pinned here: the tile within 5 s with no editor; the timer keeps running;
// a reload mid-upload restores the tile and the upload lands by itself; a
// failed upload stays in the workout as a Retry tile; Finish carries every
// clip into the review step.

const FIXTURE = path.join(__dirname, 'fixtures', 'photo.png');
const CAPTURE_PHOTO = 'input[type="file"][accept="image/*"]';
const CAPTURE_VIDEO = 'input[type="file"][accept="video/*"]';

const exerciseOf = () => [{
  name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null,
  sets: [{ setNumber: 1, reps: 5, weight: 185, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] }],
}];

/** The live timer's text — "0:07" style, ticking from started_at. */
const timerText = (page: Page) => page.locator('span.tabular-nums').first().innerText();

/** An in-browser clip (canvas.captureStream + MediaRecorder), the recipe from capture-attach.spec. */
async function recordClip(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer } | null> {
  const canRecord = await page.evaluate(() => 'MediaRecorder' in window);
  if (!canRecord) return null;
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise<Blob>(resolve => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); });
    rec.start();
    const t0 = performance.now();
    await new Promise<void>(resolve => {
      const draw = () => {
        const t = performance.now() - t0;
        ctx.fillStyle = `hsl(${(t / 10) % 360}, 80%, 50%)`;
        ctx.fillRect(0, 0, 160, 120);
        if (t < 1500) requestAnimationFrame(draw);
        else { rec.stop(); resolve(); }
      };
      draw();
    });
    const blob = await stopped;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { data: btoa(s), mime };
  });
  return { name: base64.mime === 'video/mp4' ? 'clip.mp4' : 'clip.webm', mimeType: base64.mime, buffer: Buffer.from(base64.data, 'base64') };
}

test('a set clip is a tile at once, survives a reload mid-upload, a failed upload stays in the workout, Finish carries the clips @mobile', async ({ page }) => {
  test.setTimeout(240_000);
  const api = await apiAs('state.json');
  const admin = adminClient();
  let workoutId: string | null = null;
  const storagePaths: string[] = [];
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.status(), await readErrorBody(started)).toBe(201);
    workoutId = (await started.json()).session.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, { data: { savedAt: Date.now(), exercises: exerciseOf() } });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    await page.goto(`/app/workout/${workoutId}`);
    const cameraButton = page.getByRole('button', { name: 'Attach photo or video to this set' });
    await expect(cameraButton).toBeVisible({ timeout: 20_000 });
    const t0 = await timerText(page);

    // 1. Hold the upload's last step so the clip stays PENDING while we look.
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    let holding = true;
    await page.route('**/api/upload/post-media/complete', async route => {
      if (holding) await held;
      await route.continue();
    });

    // 2. A camera photo → a tile within 5 s, NO editor, uploading in the background.
    await page.locator(CAPTURE_PHOTO).setInputFiles(FIXTURE);
    const tiles = page.locator('[data-set-media-tile]');
    await expect(tiles).toHaveCount(1, { timeout: 5_000 });
    await expect(tiles.first()).toHaveAttribute('data-set-media-state', 'pending');
    await expect(page.getByRole('heading', { name: 'Edit media' })).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Uploading' })).toBeVisible();
    // The set carries the pending entry in the draft the reload reads.
    const draft = await page.evaluate(id => localStorage.getItem(`ea:workout-draft:v1:${id}`), workoutId);
    expect(draft).toContain('"pending:');
    // The timer kept running across the capture.
    await expect.poll(() => timerText(page), { timeout: 5_000 }).not.toBe(t0);

    // 3. The page is thrown away mid-upload (what iOS does with the camera up)
    //    → the tile is back from the stash and the upload lands by itself.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Attach photo or video to this set' })).toBeVisible({ timeout: 20_000 });
    await expect(tiles).toHaveCount(1, { timeout: 10_000 });
    await expect(tiles.first()).toHaveAttribute('data-set-media-state', 'pending');
    holding = false;
    release();
    await expect(tiles.first()).toHaveAttribute('data-set-media-state', 'stored', { timeout: 30_000 });
    await expect.poll(async () => {
      const read = await api.get(`/api/workouts/${workoutId}`);
      const session = (await read.json()).session;
      const url = session.exercises?.[0]?.sets?.[0]?.media?.[0]?.url as string | undefined;
      return url?.startsWith('/api/media/') ? 'stored' : (url ?? 'none');
    }, { timeout: 20_000 }).toBe('stored');
    await expect(page).toHaveURL(new RegExp(`/app/workout/${workoutId}`));

    // 4. A failed upload: the clip stays as a Retry tile, the screen stays put.
    await page.unroute('**/api/upload/post-media/complete');
    await page.route('**/api/upload/post-media/intent', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA: upload refused"}' }));
    await page.locator(CAPTURE_PHOTO).setInputFiles(FIXTURE);
    await expect(tiles).toHaveCount(2, { timeout: 5_000 });
    const failed = page.locator('[data-set-media-tile][data-set-media-state="failed"]');
    await expect(failed).toHaveCount(1, { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`/app/workout/${workoutId}`));
    await expect(page.getByRole('heading', { name: 'Edit media' })).toHaveCount(0);
    await page.unroute('**/api/upload/post-media/intent');
    await failed.getByRole('button', { name: 'Retry upload' }).click();
    await expect(page.locator('[data-set-media-tile][data-set-media-state="stored"]')).toHaveCount(2, { timeout: 30_000 });

    // 5. A camera video attaches the same way (skipped where the browser cannot record one).
    const clip = await recordClip(page);
    if (clip) {
      await page.locator(CAPTURE_VIDEO).setInputFiles(clip);
      await expect(tiles).toHaveCount(3, { timeout: 5_000 });
      await expect(page.getByRole('heading', { name: 'Edit media' })).toHaveCount(0);
      await expect(page.locator('[data-set-media-tile][data-set-media-state="stored"]')).toHaveCount(3, { timeout: 60_000 });
    }
    const expected = clip ? 3 : 2;

    // 6. Finish waits for the queue and carries every clip into the review step.
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Nice workout!' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Bench Press set 1 media/ })).toHaveCount(expected);

    // What landed in storage, for the teardown.
    const { data: rows } = await admin.from('workout_sets').select('media, workout_exercises!inner(session_id)').eq('workout_exercises.session_id', workoutId);
    for (const row of rows ?? []) {
      for (const m of (Array.isArray(row.media) ? row.media : []) as Array<{ url: string }>) {
        const p = m.url.split('/public/uploads/')[1];
        if (p) storagePaths.push(p);
      }
    }
    expect(storagePaths).toHaveLength(expected);
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`).catch(() => undefined);
    if (storagePaths.length > 0) await admin.storage.from('uploads').remove(storagePaths).catch(() => undefined);
    await api.dispose();
  }
});
