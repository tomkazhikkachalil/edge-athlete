import { test, expect, type Page } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Workout screen PR 3 (Oct 12 2026): a superset of two and a three-round
// circuit — every round logged per exercise and saved with its group; the
// rounds stepper; Turn into separate exercises keeps the sets; Save as
// routine → start it → the circuit is back.

async function pickTwo(page: Page, names: string[]): Promise<void> {
  for (const name of names) {
    await page.getByPlaceholder('Search exercises…').fill(name);
    await page.getByRole('button', { name, exact: true }).first().click();
  }
  await page.locator('[data-group-create]').click();
}

async function logRound(page: Page, group: ReturnType<Page['locator']>, round: number, reps: string): Promise<void> {
  const rows = group.locator(`[data-exercise-card]`);
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const card = group.locator('[data-exercise-card]').nth(i).locator('..');
    const repsInput = card.getByLabel('reps').nth(round - 1);
    await repsInput.fill(reps);
    await card.getByRole('button', { name: 'Mark set complete' }).first().click();
  }
}

test('a superset and a three-round circuit: every round saves with its group; ungroup keeps the sets; a routine brings the circuit back @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(240_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  let routineId = '';
  let secondId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    // Oct 13 2026: rounds are a swipe by default (workout-rounds-swipe.spec.ts
    // covers it); this spec logs rounds by their row index, so it asks for
    // LIST view — the Oct 12 rendering, every round vertically — on this device.
    await page.addInitScript(() => { try { localStorage.setItem('ea:workout:group-view:v1', 'list'); } catch { /* fail-open */ } });
    await page.goto(`/app/workout/${workoutId}`);
    await expect(page.locator('[data-workout-add-group="superset"]')).toBeVisible({ timeout: 20_000 });

    // A superset: bench + row, default 3 rounds → set to 2.
    await page.locator('[data-workout-add-group="superset"]').click();
    await pickTwo(page, ['Bench Press', 'Barbell Row']);
    const superset = page.locator('[data-exercise-group][data-group-kind="superset"]');
    await expect(superset).toBeVisible();
    await expect(superset).toHaveAttribute('data-group-rounds', '3');
    await superset.locator('[data-group-rounds-minus]').click();
    await expect(superset).toHaveAttribute('data-group-rounds', '2');
    await expect(superset.locator('[data-exercise-card]')).toHaveCount(2);
    // Each member shows R1 · R2.
    await expect(superset.getByText('R1').first()).toBeVisible();
    await logRound(page, superset, 1, '8');
    await expect(superset.locator('[data-group-round]')).toHaveAttribute('data-group-round', '2');

    // A circuit of three, three rounds; Add round makes four.
    await page.locator('[data-workout-add-group="circuit"]').click();
    await pickTwo(page, ['Squat', 'Push-Ups', 'Lunges']);
    const circuit = page.locator('[data-exercise-group][data-group-kind="circuit"]');
    await expect(circuit).toBeVisible();
    await expect(circuit.locator('[data-exercise-card]')).toHaveCount(3);
    await circuit.locator('[data-group-add-round]').click();
    await expect(circuit).toHaveAttribute('data-group-rounds', '4');

    // Saved with the groups: every member carries the kind and the rounds; the sets are the rounds.
    await expect.poll(async () => {
      const s = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
      return s.exercises.length;
    }, { timeout: 15_000 }).toBe(5);
    const saved = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
    const bench = saved.exercises.find((e: { name: string }) => e.name === 'Bench Press');
    const squat = saved.exercises.find((e: { name: string }) => e.name === 'Squat');
    expect(bench).toMatchObject({ group_kind: 'superset', group_rounds: 2 });
    expect(bench.sets).toHaveLength(2);
    expect(bench.sets[0].reps).toBe(8);
    expect(squat).toMatchObject({ group_kind: 'circuit', group_rounds: 4 });
    expect(squat.sets).toHaveLength(4);
    const circuitIds = new Set(saved.exercises.filter((e: { group_kind: string }) => e.group_kind === 'circuit').map((e: { group_id: string }) => e.group_id));
    expect(circuitIds.size).toBe(1);

    // Turn the superset into separate exercises: the sets stay.
    await superset.locator('[data-group-menu]').click();
    await page.locator('[data-menu-item="ungroup"]').click();
    await expect(page.locator('[data-exercise-group][data-group-kind="superset"]')).toHaveCount(0);
    await expect.poll(async () => {
      const s = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
      const b = s.exercises.find((e: { name: string }) => e.name === 'Bench Press');
      return b ? `${b.group_id}:${b.sets.length}:${b.sets[0]?.reps}` : '';
    }, { timeout: 15_000 }).toBe('null:2:8');

    // Save the circuit as a routine and start it: the circuit comes back.
    const current = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
    const routineBody = {
      name: `QA circuit ${Date.now()}`,
      exercises: current.exercises
        .filter((e: { group_kind: string | null }) => e.group_kind === 'circuit')
        .map((e: { name: string; exercise_key: string | null; category: string; notes: string | null; group_id: string; group_kind: string; group_rounds: number }) => ({ name: e.name, exerciseKey: e.exercise_key, category: e.category, notes: e.notes, targetSets: e.group_rounds, groupId: e.group_id, groupKind: e.group_kind, groupRounds: e.group_rounds })),
    };
    const routine = await api.post('/api/workout-routines', { data: routineBody });
    expect(routine.ok(), await readErrorBody(routine)).toBe(true);
    const routineRead = (await routine.json()).routine;
    routineId = routineRead.id as string;
    expect(routineRead.exercises[0]).toMatchObject({ groupKind: 'circuit', groupRounds: 4, targetSets: 4 });
    // Finish this workout first (one live session at a time), then start from the routine.
    const fin = await api.patch(`/api/workouts/${workoutId}`, { data: { finish: { endedAt: new Date().toISOString() } } });
    expect(fin.ok(), await readErrorBody(fin)).toBe(true);
    const second = await api.post('/api/workouts', { data: { mode: 'live', routineId } });
    expect(second.ok(), await readErrorBody(second)).toBe(true);
    secondId = (await second.json()).session.id as string;
    const started2 = (await (await api.get(`/api/workouts/${secondId}`)).json()).session;
    const circuitAgain = started2.exercises.filter((e: { group_kind: string | null }) => e.group_kind === 'circuit');
    expect(circuitAgain).toHaveLength(3);
    expect(new Set(circuitAgain.map((e: { group_id: string }) => e.group_id)).size).toBe(1);
    expect(circuitAgain[0].group_rounds).toBe(4);
    expect(circuitAgain[0].sets).toHaveLength(4);
    await page.goto(`/app/workout/${secondId}`);
    await expect(page.locator('[data-exercise-group][data-group-kind="circuit"]')).toBeVisible({ timeout: 20_000 });
  } finally {
    if (secondId) await api.delete(`/api/workouts/${secondId}`);
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    if (routineId) await api.delete(`/api/workout-routines/${routineId}`);
    await api.dispose();
  }
});
