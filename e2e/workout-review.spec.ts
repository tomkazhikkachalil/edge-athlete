import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminClient, apiAs, readErrorBody } from './helpers/qa-user';

// Workout capture round PR 2 (Oct 8 2026): the end-of-workout review step
// lets the athlete EDIT a clip (the same editor the set rows use — Done
// re-uploads and replaces the clip in its set), set the carousel ORDER
// (Move up / down), REMOVE a clip from the workout (asks first), and then
// post. Pinned here on a finished workout opened at ?share=1 (the Drafts
// area's door): the order swaps, an edit stores a NEW storage URL in
// `workout_sets.media`, a removal leaves the set, and the post carries the
// chosen clips in the chosen order with the edited URL.

const STORED_URL = /\/storage\/v1\/object\/public\/uploads\/posts\//;

async function tinyJpeg(hex: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 64, height: 64, channels: 3, background: hex } }).jpeg().toBuffer();
}

async function uploadPhoto(api: APIRequestContext, hex: string): Promise<string> {
  const bytes = await tinyJpeg(hex);
  const intent = await api.post('/api/upload/post-media/intent', { data: { type: 'image/jpeg', size: bytes.length } });
  expect(intent.ok(), await intent.text()).toBe(true);
  const { path, signedUrl } = await intent.json();
  const put = await api.put(signedUrl, { data: bytes, headers: { 'Content-Type': 'image/jpeg' } });
  expect(put.ok(), await put.text()).toBe(true);
  const complete = await api.post('/api/upload/post-media/complete', { data: { path, type: 'image/jpeg' } });
  expect(complete.ok(), await complete.text()).toBe(true);
  const url = (await complete.json()).url as string;
  expect(url).toMatch(STORED_URL);
  return url;
}

const storagePathOf = (url: string) => url.split('/public/uploads/')[1];

test('the review step edits a clip in place, orders the carousel, removes a clip after a confirm, and the post carries the result @mobile', async ({ page }) => {
  test.setTimeout(240_000);
  const api = await apiAs('state.json');
  const admin = adminClient();
  let workoutId: string | null = null;
  let postId: string | null = null;
  const storagePaths = new Set<string>();
  try {
    const [first, second, third] = await Promise.all([uploadPhoto(api, '#7c3aed'), uploadPhoto(api, '#059669'), uploadPhoto(api, '#dc2626')]);
    [first, second, third].forEach(u => storagePaths.add(storagePathOf(u)));
    const set = (setNumber: number, urls: string[]) => ({
      setNumber, reps: 5, weight: 185, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null,
      media: urls.map(url => ({ url, type: 'image' })),
    });
    const created = await api.post('/api/workouts', {
      data: {
        mode: 'manual', startedAt: new Date().toISOString(), durationSeconds: 1800, title: `QA review ${Date.now()}`,
        exercises: [{ name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, [first, second]), set(2, [third])] }],
      },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    workoutId = (await created.json()).session.id as string;

    await page.goto(`/app/workout/${workoutId}?share=1`);
    await expect(page.getByRole('heading', { name: 'Nice workout!' })).toBeVisible({ timeout: 20_000 });
    const rows = page.locator('[data-share-clip]');
    await expect(rows).toHaveCount(3);
    const positions = () => rows.evaluateAll(els => els.map(el => el.getAttribute('data-share-position')));
    expect(await positions()).toEqual(['1', '2', '3']);
    const urlAt = (i: number) => rows.nth(i).getAttribute('data-share-clip');
    const originalFirst = await urlAt(0);

    // Order: the first clip moves down → it is second, the carousel order follows.
    await rows.nth(0).getByRole('button', { name: /^Move .* clip down$/ }).click();
    await expect.poll(() => urlAt(1)).toBe(originalFirst);
    expect(await positions()).toEqual(['1', '2', '3']);
    await expect(rows.nth(0).getByRole('button', { name: /^Move .* clip up$/ })).toBeDisabled();

    // Exclude the last clip: it drops out of the carousel (no position), the count says so.
    await rows.nth(2).getByRole('button', { name: /^Exclude .* media$/ }).click();
    await expect(rows.nth(2)).toHaveAttribute('data-share-selected', 'false');
    await expect(page.getByText('2/3 in the post')).toBeVisible();

    // Edit the (now) first clip: the editor opens, Done re-uploads and the
    // set holds a NEW storage URL in the same place.
    const editTarget = await urlAt(0);
    await rows.nth(0).getByRole('button', { name: /^Edit .* clip$/ }).click();
    await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => urlAt(0), { timeout: 30_000 }).not.toBe(editTarget);
    expect(await positions()).toEqual(['1', '2', '']);
    // The set now holds three storage URLs and `second` (the edited one) is gone from it.
    const setUrlsNow = async () => {
      const { data } = await admin.from('workout_sets').select('media, workout_exercises!inner(session_id)').eq('workout_exercises.session_id', workoutId);
      return (data ?? []).flatMap(r => (Array.isArray(r.media) ? r.media : [])).map((m: { url: string }) => m.url);
    };
    await expect.poll(async () => (await setUrlsNow()).includes(second), { timeout: 20_000 }).toBe(false);
    const afterEdit = await setUrlsNow();
    expect(afterEdit).toHaveLength(3);
    for (const u of afterEdit) expect(u).toMatch(STORED_URL);

    // Remove the excluded clip: the confirm names what goes; Remove deletes it from the set.
    await rows.nth(2).getByRole('button', { name: /^Remove .* clip$/ }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Remove this clip?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/deleted from Bench Press set 2/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect.poll(async () => (await setUrlsNow()).length, { timeout: 20_000 }).toBe(2);

    // Share: the post carries the two clips in the chosen order, the edited one first.
    // Post it is preselected (the one choice — src/lib/posts/audience.ts); Post.
    await expect(page.locator('[data-post-choice] [data-choice="post"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-share-done="post"]').click();
    // The FACT first (the session carries its post), the navigation after —
    // under load the profile page can take longer than the share did.
    await expect.poll(async () => {
      const read = await api.get(`/api/workouts/${workoutId}`);
      postId = read.ok() ? ((await read.json()).session.post_id as string | null) : null;
      return postId;
    }, { timeout: 45_000 }).toBeTruthy();
    await page.waitForURL('**/athlete', { timeout: 45_000 });
    const { data: postMedia } = await admin.from('post_media').select('media_url, display_order').eq('post_id', postId!).order('display_order');
    expect(postMedia).toHaveLength(2);
    const setUrls = await setUrlsNow();
    for (const u of setUrls) storagePaths.add(storagePathOf(u));
    // display_order 0 is the edited clip (a URL that is neither original), 1 is `first` (moved down).
    expect(postMedia![1].media_url).toBe(first);
    expect([first, second, third]).not.toContain(postMedia![0].media_url);
    expect(setUrls).toContain(postMedia![0].media_url);
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => undefined);
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`).catch(() => undefined);
    if (storagePaths.size > 0) await admin.storage.from('uploads').remove([...storagePaths]).catch(() => undefined);
    await api.dispose();
  }
});
