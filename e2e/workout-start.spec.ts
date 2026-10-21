import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Program E2 (Oct 2026): the Workout's set-up step. Create → Start a workout
// lands on /app/workout/start with NO active row; Start makes the row and
// starts its clock; untimed is decided there; a reload of the start screen
// leaves nothing; with an open session the banner offers Resume.

test('Create → Start a workout is a start screen; nothing exists until Start; untimed is chosen there; a reload leaves nothing @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  const api = await apiAs('state.json');
  const ids: string[] = [];
  const openSessions = async () => ((await (await api.get('/api/workouts?status=active&limit=5')).json()).sessions ?? []) as Array<{ id: string }>;
  try {
    for (const s of await openSessions()) await api.delete(`/api/workouts/${s.id}`);
    await page.goto('/feed');
    await page.getByRole('button', { name: 'Create' }).first().click();
    await page.locator('[data-create-record-activity]').click();
    await page.locator('[data-create-workout]').click();
    await page.waitForURL('**/app/workout/start', { timeout: 20_000 });
    await expect(page.locator('[data-workout-start-screen]')).toBeVisible();
    await expect(page.locator('[data-workout-start-routine="empty"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-workout-start-timed]')).toHaveAttribute('data-workout-start-timed', 'on');
    await expect(page.locator('[data-workout-start]')).toBeInViewport({ ratio: 1 });
    // Nothing exists yet.
    expect(await openSessions()).toEqual([]);
    // A reload of the start screen leaves nothing behind either.
    await page.locator('[data-workout-start-title]').fill('Leg day');
    await page.reload();
    await expect(page.locator('[data-workout-start-screen]')).toBeVisible({ timeout: 20_000 });
    expect(await openSessions()).toEqual([]);

    // Untimed, titled → Start: the row, no clock.
    await page.locator('[data-workout-start-title]').fill('Leg day');
    await page.locator('[data-workout-start-timed]').click();
    await expect(page.locator('[data-workout-start-timed]')).toHaveAttribute('data-workout-start-timed', 'off');
    await page.locator('[data-workout-start]').click();
    await page.waitForURL(/\/app\/workout\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    ids.push(id);
    await expect(page.locator('[data-workout-untimed]')).toBeVisible({ timeout: 20_000 });
    const row = (await (await api.get(`/api/workouts/${id}`)).json()).session;
    expect(row).toMatchObject({ status: 'active', timed: false, title: 'Leg day' });
    // Training fixes PR 4: Start REPLACES the start screen in history — Back from the
    // editor goes where the start screen was opened from, never "start another".
    await page.goBack();
    await expect(page).toHaveURL(/\/feed/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/app\/workout\/start/);
    await page.waitForLoadState('networkidle').catch(() => undefined); // WebKit: let the restored feed settle before the next goto

    // With an open session the start screen says so and Resume goes to it; the choice was remembered.
    await page.goto('/app/workout/start');
    await expect(page.locator(`[data-workout-start-in-progress="${id}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-workout-start-timed]')).toHaveAttribute('data-workout-start-timed', 'off');
    await page.locator('[data-workout-start-resume]').click();
    await page.waitForURL(`**/app/workout/${id}`, { timeout: 20_000 });
    await page.evaluate(() => { try { localStorage.removeItem('ea:workout:timed-default:v1'); } catch { /* */ } });
  } finally {
    for (const id of ids) await api.delete(`/api/workouts/${id}`);
    await api.dispose();
  }
});

test('timed: the start screen\'s choice reaches the row; the clock runs from Start (API)', async () => {
  const api = await apiAs('state.json');
  const ids: string[] = [];
  try {
    for (const s of (((await (await api.get('/api/workouts?status=active&limit=5')).json()).sessions ?? []) as Array<{ id: string }>)) await api.delete(`/api/workouts/${s.id}`);
    const bad = await api.post('/api/workouts', { data: { mode: 'live', timed: 'no' } });
    expect(bad.status()).toBe(400);
    const made = await api.post('/api/workouts', { data: { mode: 'live', timed: true, title: 'Push' } });
    expect(made.status(), await readErrorBody(made)).toBe(201);
    const s = (await made.json()).session;
    ids.push(s.id);
    expect(s).toMatchObject({ timed: true, title: 'Push', status: 'active' });
    expect(Math.abs(Date.now() - Date.parse(s.started_at))).toBeLessThan(60_000);
  } finally {
    for (const id of ids) await api.delete(`/api/workouts/${id}`);
    await api.dispose();
  }
});
