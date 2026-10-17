import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// Strength training = the Workout, finished (activities details A10, Oct 16
// 2026): every exercise keeps its records — derived from the sets, never
// stored — and a finished workout shows its new ones; effort is asked on the
// summary; Training lists the records; the recorder's picker opens a workout.

const set = (n: number, reps: number | null, weight: number | null) => ({ setNumber: n, reps, weight, weightUnit: weight === null ? null : 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: new Date().toISOString(), media: [] });

test('a workout beating last week shows its new PRs (and none for a first-ever lift), saves its effort; Training lists the records; the picker opens a workout @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const u = await createQaUser({ displayName: 'Lifter Lou', firstName: 'Lifter', lastName: 'Lou' });
  const storageState = await mintStorageState(u);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState, extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    // Last week: bench 185 × 5, pull-ups 10.
    const past = await api.post('/api/workouts', {
      data: { mode: 'manual', startedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(), durationSeconds: 2400, title: 'Last week', exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 5, 185)] },
        { name: 'Pull-Ups', exerciseKey: 'pull_ups', category: 'strength', notes: null, sets: [set(1, 10, null)] },
      ] },
    });
    expect(past.ok(), await readErrorBody(past)).toBe(true);
    // Today: bench 195 × 5 (heaviest + e1RM + volume), pull-ups 12, a first-ever deadlift.
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const session = (await started.json()).session as { id: string; updated_at: string; last_activity_at: string };
    const id = session.id;
    // Stamped from the SERVER's clock (the entries guard refuses a save older than
    // the session's own stamp — a test machine's clock may run behind the host's).
    const savedAt = Math.max(Date.now(), Date.parse(session.updated_at), Date.parse(session.last_activity_at)) + 1000;
    const seeded = await api.put(`/api/workouts/${id}/entries`, {
      data: { savedAt, exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 5, 195)] },
        { name: 'Pull-Ups', exerciseKey: 'pull_ups', category: 'strength', notes: null, sets: [set(1, 12, null)] },
        { name: 'Deadlift', exerciseKey: 'deadlift', category: 'strength', notes: null, sets: [set(1, 5, 315)] },
      ] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);
    expect((await seeded.json()).stale ?? false).toBe(false);

    const page = await ctx.newPage();
    await page.goto(`/app/workout/${id}`);
    await expect(page.locator('[data-exercise-name]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Finish' }).click();
    const prs = page.locator('[data-workout-prs]');
    await expect(prs).toBeVisible({ timeout: 30_000 });
    for (const key of ['bench_press:heaviest', 'bench_press:e1rm', 'bench_press:volume', 'pull_ups:reps']) await expect(prs.locator(`[data-workout-pr="${key}"]`)).toBeVisible();
    await expect(prs.locator('[data-workout-pr^="deadlift"]')).toHaveCount(0);
    await expect(prs.locator('[data-workout-pr="bench_press:heaviest"]')).toContainText('195 lbs');

    await page.locator('[data-workout-effort] [data-effort="8"]').click();
    await expect.poll(async () => (await (await api.get(`/api/workouts/${id}`)).json()).session.effort, { timeout: 15_000 }).toBe(8);

    // Training lists every exercise's records.
    await page.goto('/athlete?tab=training');
    const records = page.locator('[data-exercise-records]');
    await expect(records).toBeVisible({ timeout: 30_000 });
    await expect(records.locator('[data-exercise-record="bench_press"]')).toContainText('195');
    await expect(records.locator('[data-exercise-record="deadlift"]')).toContainText('315');
    await expect(records).toContainText('Heaviest (lbs)');

    // The recorder's picker: Strength training opens a workout.
    await page.goto('/activities/record');
    await page.locator('[data-record-strength]').click({ timeout: 20_000 });
    await page.waitForURL(/\/app\/workout\/[0-9a-f-]{36}/, { timeout: 30_000 });
  } finally {
    await ctx.close();
    await api.dispose();
    await deleteQaUser(u.id);
  }
});
