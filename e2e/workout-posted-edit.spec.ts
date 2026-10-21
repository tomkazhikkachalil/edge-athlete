import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { savedAfter } from './helpers/workouts';

// Training fixes PR 5 (Oct 21 2026): a posted workout's menu offers "Edit
// workout" (the editor, in review), and the post's summary follows the
// session — an entries write or a title change after posting rebuilds the
// post's stats_data on the server, the confirmed records kept.

const set = (n: number, reps: number) => ({ setNumber: n, reps, weight: 100, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

test('a posted workout: Edit workout from the post menu opens the editor; an edit after posting updates the post\'s summary', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  let postId: string | null = null;
  const title = `QA Posted Edit ${Date.now()}`;
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const s = (await started.json()).session;
    workoutId = s.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, { data: { savedAt: savedAfter(s), exercises: [
      { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 8), set(2, 8)] },
    ] } });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);
    const fin = await api.patch(`/api/workouts/${workoutId}`, { data: { title, finish: { endedAt: new Date().toISOString() } } });
    expect(fin.ok(), await readErrorBody(fin)).toBe(true);
    // Post it through the preview step.
    await page.goto(`/app/workout/${workoutId}?share=1`);
    await page.locator('[data-share-done="post"]').click({ timeout: 20_000 });
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id ?? null, { timeout: 20_000 }).toBeTruthy();
    postId = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id as string;
    await page.waitForURL('**/athlete', { timeout: 20_000 });
    const before = (await (await api.get(`/api/posts?postId=${postId}`)).json()).post?.stats_data ?? (await (await api.get(`/api/posts?postId=${postId}`)).json()).stats_data;
    expect(before).toMatchObject({ exercise_count: 1, total_sets: 2, total_volume_lbs: 1600, title });

    // The post's menu: Edit workout → the editor in review (Done, no Finish).
    await page.goto('/feed');
    const card = page.locator('[data-testid="post-card"]').filter({ hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Post options' }).click();
    await page.locator('[data-menu-item="edit-workout"]').click();
    await page.waitForURL(`**/app/workout/${workoutId}`, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 20_000 });

    // An edit after posting (the entries PUT the editor makes): a third set; the post follows.
    const edited = await api.put(`/api/workouts/${workoutId}/entries`, { data: { savedAt: Date.now(), exercises: [
      { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 8), set(2, 8), set(3, 10)] },
    ] } });
    expect(edited.ok(), await readErrorBody(edited)).toBe(true);
    await expect.poll(async () => {
      const body = await (await api.get(`/api/posts?postId=${postId}`)).json();
      return (body.post?.stats_data ?? body.stats_data)?.total_sets ?? null;
    }, { timeout: 20_000 }).toBe(3);
    const renamed = await api.patch(`/api/workouts/${workoutId}`, { data: { title: `${title} renamed` } });
    expect(renamed.ok(), await readErrorBody(renamed)).toBe(true);
    await expect.poll(async () => {
      const body = await (await api.get(`/api/posts?postId=${postId}`)).json();
      return (body.post?.stats_data ?? body.stats_data)?.title ?? null;
    }, { timeout: 20_000 }).toBe(`${title} renamed`);
    // The feed card reads the new numbers.
    await page.goto('/feed');
    const after = page.locator('[data-testid="post-card"]').filter({ hasText: `${title} renamed` }).first();
    await expect(after).toBeVisible({ timeout: 30_000 });
    await expect(after).toContainText('1 · 3');
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => undefined);
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`).catch(() => undefined);
    await api.dispose();
  }
});
