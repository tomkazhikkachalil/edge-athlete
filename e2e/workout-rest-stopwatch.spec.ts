import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Workout screen PR 4 (Oct 12 2026): the bottom bar — Rest records each rest
// on the set completed next (a held rest waits for it); the stopwatch saves
// to the current set in one tap; the bar clears the content; the tab bar is
// gone from the screen (it owns its bottom edge).

const set = (n: number, reps: number | null) => ({ setNumber: n, reps, weight: reps === null ? null : 100, weightUnit: reps === null ? null : 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

test('rest attaches to the completed set, a held rest to the next; the stopwatch saves to the plank; the bar clears the content @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: Date.now(), exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 5), set(2, 5), set(3, 5)] },
        { name: 'Plank', exerciseKey: 'plank', category: 'strength', notes: null, sets: [set(1, null)] },
      ] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    await page.goto(`/app/workout/${workoutId}`);
    const bar = page.locator('[data-workout-controls]');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-tab-bar]')).toHaveCount(0);

    // Rest → complete set 1: the set carries the rest.
    await page.locator('[data-workout-rest]').click();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'running');
    await page.waitForTimeout(2_500);
    const bench = page.locator('[data-exercise-card]').first().locator('..');
    await bench.getByRole('button', { name: 'Mark set complete' }).first().click();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'idle');
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises.find((e: { name: string }) => e.name === 'Bench Press').sets[0].rest_seconds, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    // Rest → stop by hand (held) → complete set 2: the held rest attaches there.
    await page.locator('[data-workout-rest]').click();
    await page.waitForTimeout(1_500);
    await page.locator('[data-workout-rest]').click();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'held');
    await bench.getByRole('button', { name: 'Mark set complete' }).first().click();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'idle');
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises.find((e: { name: string }) => e.name === 'Bench Press').sets[1].rest_seconds, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

    // The stopwatch: run ~3 s → Save to set → the plank's set 1 (the duration exercise) gets the time and is complete.
    await page.locator('[data-workout-stopwatch]').click();
    await expect(page.locator('[data-workout-stopwatch-target]')).toContainText('Plank · set 1');
    await page.locator('[data-workout-stopwatch-toggle]').click();
    await page.waitForTimeout(3_200);
    await page.locator('[data-workout-stopwatch-toggle]').click();
    await page.locator('[data-workout-stopwatch-save]').click();
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises.find((e: { name: string }) => e.name === 'Plank').sets[0], { timeout: 15_000 }).toMatchObject({ completed_at: expect.any(String) });
    const plank = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises.find((e: { name: string }) => e.name === 'Plank').sets[0];
    expect(plank.duration_seconds).toBeGreaterThanOrEqual(3);
    expect(plank.duration_seconds).toBeLessThan(6);

    // The bar clears the content: the last card's bottom is above the bar's top when scrolled to the end.
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(300);
    const [addBox, barBox] = await Promise.all([page.locator('[data-workout-add-group="circuit"]').boundingBox(), bar.boundingBox()]);
    expect(addBox && barBox && addBox.y + addBox.height <= barBox.y + 1, 'the content clears the bar').toBe(true);

    // Reload: a running rest survives on the device.
    await page.locator('[data-workout-rest]').click();
    await page.reload();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'running', { timeout: 20_000 });
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});
