import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { savedAfter } from './helpers/workouts';

// Workout screen PR 5 (Oct 12 2026): the finish summary shows total / active /
// rest time, volume per exercise, the groups' rounds and the average rest, and
// the shared post carries them — while a workout written the OLD way reads
// exactly as before.

const G = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const set = (n: number, reps: number | null, weight: number | null, rest: number | null = null) => ({ setNumber: n, reps, weight, weightUnit: weight === null ? null : 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: new Date().toISOString(), media: [], restSeconds: rest });

test('the summary and the post carry rests, active time, volume per exercise and rounds; an old-shape workout reads as before @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  let oldId = '';
  let postId: string | null = null;
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const startedSession = (await started.json()).session;
    workoutId = startedSession.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: savedAfter(startedSession), exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 5, 100, 90), set(2, 5, 100, 60)] },
        { name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, groupId: G, groupKind: 'circuit', groupRounds: 2, sets: [set(1, 10, 50), set(2, null, null)] },
        { name: 'Push-Ups', exerciseKey: 'push_ups', category: 'strength', notes: null, groupId: G, groupKind: 'circuit', groupRounds: 2, sets: [set(1, 15, null, 30), set(2, 12, null)] },
      ] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    await page.goto(`/app/workout/${workoutId}`);
    await expect(page.locator('[data-exercise-group]')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.locator('[data-summary-rest]')).toHaveAttribute('data-summary-rest', '180', { timeout: 20_000 });
    await expect(page.getByText('Avg rest')).toBeVisible();
    await expect(page.locator('[data-summary-volume-list]')).toContainText('Bench Press');
    await expect(page.locator('[data-summary-volume-list]')).toContainText('Squat');
    await expect(page.locator('[data-summary-group-rounds]')).toHaveAttribute('data-summary-group-rounds', '1/2');
    await expect(page.locator('[data-summary-duration]')).not.toHaveAttribute('data-summary-duration', 'untimed');

    // Share: the post carries the rests, the active time and the group.
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('[data-share-done="post"]').click();
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id, { timeout: 20_000 }).toBeTruthy();
    postId = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.post_id as string;
    const post = await api.get(`/api/posts?postId=${postId}`);
    expect(post.ok(), await readErrorBody(post)).toBe(true);
    const body = await post.json();
    const stats = (body.post ?? body.posts?.[0] ?? body).stats_data ?? body.post?.stats_data;
    expect(stats).toMatchObject({ type: 'workout_session', rest_seconds: 180, avg_rest_seconds: 60 });
    // Active = duration − rest, ONLY when the duration exceeds the rest: this
    // workout lasted seconds and its rests sum to 3 min, so the key is absent.
    expect('active_seconds' in stats).toBe(false);
    expect(stats.groups).toEqual([{ kind: 'circuit', rounds: 2, completed: 1, names: ['Squat', 'Push-Ups'] }]);

    // The legacy pin: a workout written the OLD way (manual POST, no new keys) reads exactly as before.
    const old = await api.post('/api/workouts', {
      data: { mode: 'manual', startedAt: new Date(Date.now() - 86_400_000).toISOString(), durationSeconds: 1800, title: `QA legacy ${Date.now()}`, exercises: [
        { name: 'Deadlift', exerciseKey: 'deadlift', category: 'strength', notes: null, sets: [{ setNumber: 1, reps: 5, weight: 200, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] }] },
      ] },
    });
    expect(old.ok(), await readErrorBody(old)).toBe(true);
    oldId = (await old.json()).session.id as string;
    const oldRead = (await (await api.get(`/api/workouts/${oldId}`)).json()).session;
    expect(oldRead).toMatchObject({ duration_seconds: 1800, timed: true, paused_seconds: 0, paused_at: null });
    expect(oldRead.exercises[0]).toMatchObject({ group_id: null, group_kind: null, group_rounds: null });
    expect(oldRead.exercises[0].client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(oldRead.exercises[0].sets[0].rest_seconds).toBeNull();
    await page.goto(`/app/workout/${oldId}`);
    await expect(page.locator('[data-exercise-name]')).toHaveText('Deadlift', { timeout: 20_000 });
    await expect(page.locator('[data-exercise-group]')).toHaveCount(0);
  } finally {
    if (postId) await api.delete(`/api/posts?postId=${postId}`).catch(() => undefined);
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    if (oldId) await api.delete(`/api/workouts/${oldId}`);
    await api.dispose();
  }
});
