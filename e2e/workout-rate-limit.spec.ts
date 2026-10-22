import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { savedAfter } from './helpers/workouts';

// Decisions round PR 4 (Oct 22 2026), Tom: "make sure the app handles [a 429]
// without losing data: an unposted workout … stays saved as a draft and
// retries, and the user sees a friendly 'Slow down, try again in a moment'".
// The server's bucket is still SHADOW here, so the 429 is played by the
// browser (one refusal of the entries PUT, with a Retry-After) and the
// editor's answer is what is asserted: the set stays on screen, the toast
// says so, the re-send lands two seconds later, a reload shows the set.

const set = (n: number, reps: number | null) => ({ setNumber: n, reps, weight: reps === null ? null : 100, weightUnit: reps === null ? null : 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

test('a 429 on the entries save keeps the set, says Slow down, and re-sends after Retry-After @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const startedSession = (await started.json()).session;
    workoutId = startedSession.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: savedAfter(startedSession), exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 5), set(2, 5)] },
      ] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    // The first entries PUT from the page is refused like the real bucket
    // would refuse it; everything after goes through.
    let refused = 0;
    let passed = 0;
    await page.route(`**/api/workouts/${workoutId}/entries`, async route => {
      if (route.request().method() !== 'PUT') return route.fallback();
      if (refused === 0) {
        refused += 1;
        return route.fulfill({ status: 429, headers: { 'Retry-After': '2', 'Content-Type': 'application/json' }, json: { error: 'Slow down — try again in a moment.' } });
      }
      passed += 1;
      return route.fallback();
    });

    await page.goto(`/app/workout/${workoutId}`);
    const bench = page.locator('[data-exercise-card]').first().locator('..');
    await expect(bench).toBeVisible({ timeout: 20_000 });
    await bench.getByRole('button', { name: 'Mark set complete' }).first().click();

    // The refusal: said once, the set still on screen, nothing lost.
    await expect(page.getByText('Slow down — try again in a moment.')).toBeVisible({ timeout: 15_000 });
    expect(refused).toBe(1);
    await expect(bench.getByRole('button', { name: 'Mark set complete' })).toHaveCount(1); // one of two is done
    // The re-send, two seconds on, lands the completion on the server.
    await expect.poll(() => passed, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises[0].sets[0].completed_at, { timeout: 15_000 }).not.toBeNull();

    // A reload shows the same.
    await page.unroute(`**/api/workouts/${workoutId}/entries`);
    await page.reload();
    await expect(page.locator('[data-exercise-card]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-exercise-card]').first().locator('..').getByRole('button', { name: 'Mark set complete' })).toHaveCount(1);
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`).catch(() => undefined);
    await api.dispose();
  }
});
