import { test, expect, type Page } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

// Workout screen PR 2 (Oct 12 2026, 260): Start/Pause beside the clock — a
// pause stops the clock, never the workout, and survives a reload; the menu's
// Hide timer (remembered on the device) and Don't time this workout (no
// duration saved; Training counts no minutes); the "Saved" label is gone.

const clockText = (page: Page) => page.locator('[data-live-clock]').innerText();
const toSeconds = (t: string) => t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);

async function dismissPrompt(page: Page): Promise<void> {
  const later = page.locator('[data-reopen-later]');
  await later.waitFor({ state: 'visible', timeout: 6_000 }).catch(() => undefined);
  if (await later.isVisible()) {
    await later.click();
    await expect(later).toBeHidden();
  }
}

test('pause excludes the paused time and survives a reload; the pill stands; hide is remembered; untimed saves no duration; no "Saved" label @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    await page.goto(`/app/workout/${workoutId}`);
    await expect(page.locator('[data-live-clock]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-workout-timer]')).toHaveAttribute('data-workout-timer', 'running');

    // Pause: the clock stands (two reads 3 s apart agree); the server holds the pause.
    await page.locator('[data-workout-pause]').click();
    await expect(page.locator('[data-workout-pause]')).toHaveAttribute('data-workout-pause', 'paused', { timeout: 10_000 });
    const t1 = toSeconds(await clockText(page));
    await page.waitForTimeout(3_000);
    const t2 = toSeconds(await clockText(page));
    expect(t2).toBe(t1);
    const paused = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
    expect(paused.paused_at, 'the pause is a server fact').toBeTruthy();

    // A reload while paused: still paused, the same time.
    await page.reload();
    await expect(page.locator('[data-workout-pause]')).toHaveAttribute('data-workout-pause', 'paused', { timeout: 20_000 });
    expect(Math.abs(toSeconds(await clockText(page)) - t1)).toBeLessThanOrEqual(1);

    // The pill on the feed stands too.
    await page.goto('/feed');
    await dismissPrompt(page);
    const pill = page.locator(`[data-resume-pill="workout:${workoutId}"]`);
    await expect(pill).toBeVisible({ timeout: 20_000 });
    const p1 = await pill.locator('[data-resume-pill-elapsed]').innerText();
    await page.waitForTimeout(2_500);
    expect(await pill.locator('[data-resume-pill-elapsed]').innerText()).toBe(p1);

    // Resume: the clock runs again and the paused seconds are excluded (the
    // clock is close to what it was at the pause, not the wall clock since start).
    await pill.click();
    await page.waitForURL(`**/app/workout/${workoutId}`, { timeout: 20_000 });
    await page.locator('[data-workout-pause]').click();
    await expect(page.locator('[data-workout-pause]')).toHaveAttribute('data-workout-pause', 'running', { timeout: 10_000 });
    const t3 = toSeconds(await clockText(page));
    expect(t3).toBeLessThan(t1 + 15);
    const resumed = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
    expect(resumed.paused_at).toBeNull();
    expect(resumed.paused_seconds).toBeGreaterThan(5);
    const wall = (Date.now() - Date.parse(resumed.started_at)) / 1000;
    expect(t3).toBeLessThan(wall - 5);

    // No "Saved" label, ever.
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);

    // Hide timer: hidden, remembered across a reload; Show timer brings it back.
    await page.locator('[data-workout-menu]').click();
    await page.locator('[data-menu-item="hide-timer"]').click();
    await expect(page.locator('[data-workout-timer]')).toHaveAttribute('data-workout-timer', 'hidden');
    await expect(page.locator('[data-live-clock]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-workout-timer]')).toHaveAttribute('data-workout-timer', 'hidden', { timeout: 20_000 });
    await page.locator('[data-workout-menu]').click();
    await page.locator('[data-menu-item="hide-timer"]').click();
    await expect(page.locator('[data-live-clock]')).toBeVisible();

    // Don't time this workout: the clock goes, the finish saves no duration.
    await page.locator('[data-workout-menu]').click();
    await page.locator('[data-menu-item="timed"]').click();
    await expect(page.locator('[data-workout-timer]')).toHaveAttribute('data-workout-timer', 'off', { timeout: 10_000 });
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.timed, { timeout: 10_000 }).toBe(false);
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('heading', { name: /Workout Complete|./ }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-summary-duration]')).toHaveAttribute('data-summary-duration', 'untimed', { timeout: 20_000 });
    const done = (await (await api.get(`/api/workouts/${workoutId}`)).json()).session;
    expect(done.status).toBe('completed');
    expect(done.duration_seconds).toBeNull();
    expect(done.paused_at).toBeNull();
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});
