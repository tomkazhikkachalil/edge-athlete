import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Workout screen program PR 1 (Oct 12 2026, migration 260): an exercise has
// a STABLE id and can be renamed in place — the sets, notes and media stay;
// and a workout written with the OLD payload (no new keys) still opens, saves
// and reads back the same.

const set = (n: number, reps: number) => ({ setNumber: n, reps, weight: 135, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

test('rename an exercise after logging sets: the sets stay, the id stays; an old-shape workout still round-trips @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    // The OLD payload shape: no clientId, no group fields, no rest.
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: Date.now(), exercises: [{ name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: 'pause reps', sets: [set(1, 5), set(2, 5)] }] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);
    const before = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
    const beforeEx = before.exercises[0];
    expect(beforeEx.client_id, 'the column default minted a stable id for the old payload').toMatch(/^[0-9a-f-]{36}$/);
    expect(beforeEx.group_id).toBeNull();
    expect(beforeEx.sets).toHaveLength(2);

    await page.goto(`/app/workout/${workoutId}`);
    await expect(page.locator('[data-exercise-name]')).toHaveText('Bench Press', { timeout: 20_000 });
    // Rename through the card's menu: an input in place; Enter commits.
    await page.locator('[data-exercise-menu]').click();
    await page.locator('[data-menu-item="rename"]').click();
    const input = page.locator('[data-exercise-rename-input]');
    await expect(input).toBeVisible();
    await input.fill('Incline Bench');
    await input.press('Enter');
    await expect(page.locator('[data-exercise-name]')).toHaveText('Incline Bench');
    // Both sets are still on the card.
    await expect(page.getByRole('button', { name: /Mark set complete/ })).toHaveCount(2);

    // The save carried the SAME stable id, the new name, both sets and the notes.
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises[0].name, { timeout: 15_000 }).toBe('Incline Bench');
    const after = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises[0];
    expect(after.client_id).toBe(beforeEx.client_id);
    expect(after.notes).toBe('pause reps');
    expect(after.sets.map((s: { reps: number }) => s.reps)).toEqual([5, 5]);
    expect(after.exercise_key).toBe('bench_press');
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});
