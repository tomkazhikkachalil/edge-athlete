import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { savedAfter } from './helpers/workouts';

// Workout screen PR 4 (Oct 12 2026): the bottom bar — Rest records each rest
// on the set completed next (a held rest waits for it); the stopwatch saves
// to the current set in one tap; the bar clears the content; the tab bar is
// gone from the screen (it owns its bottom edge).
// Rest timer round (Oct 22 2026): the rest is coloured by its phase against
// the target (purple → yellow 5 s before → red at → flashing 5 s after, reset
// by the tap that ends it); the workout's TOTAL rest sits beside the clock and
// climbs with each ended rest; the clock's old "seconds since the last
// completed set" counter is gone.

const set = (n: number, reps: number | null) => ({ setNumber: n, reps, weight: reps === null ? null : 100, weightUnit: reps === null ? null : 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] });

test('rest attaches to the completed set, a held rest to the next; the stopwatch saves to the plank; the bar clears the content @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const startedSession = (await started.json()).session;
    workoutId = startedSession.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, {
      data: { savedAt: savedAfter(startedSession), exercises: [
        { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 5), set(2, 5), set(3, 5)] },
        { name: 'Plank', exerciseKey: 'plank', category: 'strength', notes: null, sets: [set(1, null)] },
      ] },
    });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);

    // A 7 s target on this device, so every colour phase passes in seconds.
    await page.addInitScript(() => { try { localStorage.setItem('ea:workout:rest-target:v1', '7'); } catch { /* storage unavailable */ } });
    await page.goto(`/app/workout/${workoutId}`);
    const bar = page.locator('[data-workout-controls]');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-tab-bar]')).toHaveCount(0);
    await expect(page.locator('[data-workout-rest-target]')).toHaveAttribute('data-workout-rest-target', '7');
    const restBtn = page.locator('[data-workout-rest]');
    const clockRow = page.locator('[data-workout-timer]');
    await expect(page.locator('[data-workout-rest-total]')).toHaveCount(0);

    // The colour (Oct 22 2026): purple from the start — never red — then yellow
    // five seconds before the 7 s target, red at it, flashing red five after.
    await restBtn.click();
    await expect(restBtn).toHaveAttribute('data-workout-rest', 'running');
    await expect(restBtn).toHaveAttribute('data-workout-rest-phase', 'running');
    await expect(restBtn).toHaveClass(/bg-brand/);
    await expect(restBtn).not.toHaveClass(/bg-red-600|bg-amber-400/);
    await expect(restBtn).toHaveAttribute('data-workout-rest-phase', 'warning', { timeout: 4_000 });
    await expect(restBtn).toHaveClass(/bg-amber-400/);
    await expect(restBtn).toHaveAttribute('data-workout-rest-phase', 'reached', { timeout: 7_000 });
    await expect(restBtn).toHaveClass(/bg-red-600/);
    await expect(restBtn).not.toHaveClass(/animate-pulse/);
    await expect(restBtn).toHaveAttribute('data-workout-rest-phase', 'overdue', { timeout: 7_000 });
    await expect(restBtn).toHaveClass(/animate-pulse/);
    // The tap that ends the rest resets it all; the total appears beside the clock with that rest.
    await restBtn.click();
    await expect(restBtn).toHaveAttribute('data-workout-rest-phase', 'idle');
    await expect(restBtn).toHaveAttribute('data-workout-rest', 'held');
    await expect(restBtn).not.toHaveClass(/bg-red-600|bg-amber-400|bg-brand|animate-pulse/);
    const total = page.locator('[data-workout-rest-total]');
    await expect(total).toBeVisible();
    const firstTotal = Number(await total.getAttribute('data-workout-rest-total'));
    expect(firstTotal).toBeGreaterThanOrEqual(12);
    await expect(total).toContainText(`Rest 0:${String(firstTotal).padStart(2, '0')}`);

    // Completing set 1 takes the held rest; the total does not change for it.
    const bench = page.locator('[data-exercise-card]').first().locator('..');
    await bench.getByRole('button', { name: 'Mark set complete' }).first().click();
    await expect(restBtn).toHaveAttribute('data-workout-rest', 'idle');
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises.find((e: { name: string }) => e.name === 'Bench Press').sets[0].rest_seconds, { timeout: 15_000 }).toBe(firstTotal);
    await expect(total).toHaveAttribute('data-workout-rest-total', String(firstTotal));
    // The clock's row shows ONE rest — the total — and no counter of its own now that a set is complete.
    await expect(clockRow.locator('[data-workout-rest-total]')).toHaveCount(1);
    expect(((await clockRow.textContent()) ?? '').match(/Rest/g)?.length ?? 0).toBe(1);
    // Off keeps timing and counting: with no target the rest is purple throughout.
    await page.evaluate(() => localStorage.removeItem('ea:workout:rest-target:v1'));
    await page.reload();
    await expect(restBtn).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-workout-rest-target]')).toHaveAttribute('data-workout-rest-target', 'off');
    await restBtn.click();
    await expect(restBtn).toHaveAttribute('data-workout-rest-phase', 'running');
    await page.waitForTimeout(2_200);
    await expect(restBtn).toHaveAttribute('data-workout-rest-phase', 'running');
    await expect(restBtn).toHaveClass(/bg-brand/);
    await bench.getByRole('button', { name: 'Mark set complete' }).first().click();
    await expect(restBtn).toHaveAttribute('data-workout-rest', 'idle');
    // Each later rest is added to the total.
    await expect.poll(async () => Number(await total.getAttribute('data-workout-rest-total')), { timeout: 10_000 }).toBeGreaterThanOrEqual(firstTotal + 2);

    // Rest → stop by hand (held) → complete set 3: the held rest attaches there.
    await page.locator('[data-workout-rest]').click();
    await page.waitForTimeout(1_500);
    await page.locator('[data-workout-rest]').click();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'held');
    await bench.getByRole('button', { name: 'Mark set complete' }).first().click();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'idle');
    await expect.poll(async () => (await (await api.get(`/api/workouts/${workoutId}`)).json()).session.exercises.find((e: { name: string }) => e.name === 'Bench Press').sets[2].rest_seconds, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

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

    // The bar clears the content — with the stopwatch OPEN and a rest running
    // (Tom, Oct 13: the open stopwatch covered the Add buttons): the bar's
    // measured height is `--ea-workout-bar-h` and the editor's clearance follows it.
    const barH = async () => parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ea-workout-bar-h')));
    const clears = async (label: string) => {
      // Let the clearance transition (200 ms) finish, then scroll to the very end and measure.
      await page.waitForTimeout(450);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      const [addBox, barBox] = await Promise.all([page.locator('[data-workout-add-group="circuit"]').boundingBox(), bar.boundingBox()]);
      expect(addBox && barBox && addBox.y + addBox.height <= barBox.y + 1, `the content clears the bar (${label})`).toBe(true);
    };
    // The panel is still open from the save above: close it first, so the closed height is the baseline.
    if ((await page.locator('[data-workout-stopwatch-open]').getAttribute('data-workout-stopwatch-open')) === 'true') {
      await page.locator('[data-workout-stopwatch]').click();
      await expect(page.locator('[data-workout-stopwatch-open]')).toHaveAttribute('data-workout-stopwatch-open', 'false');
      await page.waitForTimeout(400);
    }
    const closedH = await barH();
    await page.locator('[data-workout-stopwatch]').click(); // open the panel
    await expect(page.locator('[data-workout-stopwatch-open]')).toHaveAttribute('data-workout-stopwatch-open', 'true');
    await expect.poll(barH, { timeout: 5_000 }).toBeGreaterThan(closedH + 40);
    await clears('stopwatch open');
    await page.locator('[data-workout-rest]').click(); // and a rest running
    await clears('stopwatch open + rest running');
    await page.locator('[data-workout-rest]').click(); // held
    await page.locator('[data-workout-stopwatch]').click(); // close the panel
    await expect.poll(barH, { timeout: 5_000 }).toBeLessThan(closedH + 8);
    await clears('stopwatch closed');
    const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ea-bar-clearance') as Element).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual((await barH()) + 15);

    // Reload: a running rest survives on the device.
    await page.locator('[data-workout-rest]').click();
    await page.reload();
    await expect(page.locator('[data-workout-rest]')).toHaveAttribute('data-workout-rest', 'running', { timeout: 20_000 });
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});

// Desktop twin (Oct 13 2026): the bar's clearance holds at 1280 too — the stopwatch open, a rest running.
test('the open stopwatch never covers the Add buttons on a large screen', async ({ page }) => {
  test.setTimeout(120_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const startedSession = (await started.json()).session;
    workoutId = startedSession.id as string;
    const seeded = await api.put(`/api/workouts/${workoutId}/entries`, { data: { savedAt: savedAfter(startedSession), exercises: [{ name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [set(1, 5), set(2, 5), set(3, 5), set(4, 5)] }] } });
    expect(seeded.ok(), await readErrorBody(seeded)).toBe(true);
    await page.goto(`/app/workout/${workoutId}`);
    const bar = page.locator('[data-workout-controls]');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-workout-stopwatch]').click();
    await expect(page.locator('[data-workout-stopwatch-open]')).toHaveAttribute('data-workout-stopwatch-open', 'true');
    await page.locator('[data-workout-rest]').click();
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(400);
    const [addBox, barBox] = await Promise.all([page.locator('[data-workout-add-group="circuit"]').boundingBox(), bar.boundingBox()]);
    expect(addBox && barBox && addBox.y + addBox.height <= barBox.y + 1, 'the content clears the bar on desktop').toBe(true);
    await expect(page.locator('[data-workout-add-group="circuit"]')).toBeVisible();
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});

// Training fixes PR 3 (Oct 21 2026): a custom rest time from two wheels,
// saved as a preset beside the built-in five, remembered on the device.
test('a custom rest target from the wheels, saved as a preset, survives a reload and can be removed @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  const api = await apiAs('state.json');
  let workoutId = '';
  try {
    const started = await api.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    workoutId = (await started.json()).session.id as string;
    await page.goto(`/app/workout/${workoutId}`);
    await expect(page.locator('[data-workout-rest]')).toBeVisible({ timeout: 20_000 });

    // The target chip opens the sheet: the built-in five, Off, Custom.
    await page.locator('[data-workout-rest-target]').click();
    const sheet = page.locator('[data-workout-rest-target-sheet]');
    await expect(sheet).toHaveAttribute('data-workout-rest-target-sheet', 'presets');
    await expect(sheet.locator('[data-workout-rest-preset]')).toHaveCount(6);
    await sheet.locator('[data-workout-rest-custom]').click();
    await expect(sheet).toHaveAttribute('data-workout-rest-target-sheet', 'custom');
    // The wheels rest on 1:30 (no target yet); the seconds wheel goes by five.
    await expect(sheet.locator('[data-workout-rest-custom-value]')).toHaveAttribute('data-workout-rest-custom-value', '90');
    const seconds = sheet.getByRole('spinbutton', { name: 'Seconds' });
    await seconds.focus();
    await page.keyboard.press('ArrowDown');
    await expect(sheet.locator('[data-workout-rest-custom-value]')).toHaveAttribute('data-workout-rest-custom-value', '95');
    await expect(sheet.locator('[data-workout-rest-custom-value]')).toContainText('1:35');
    // Save as preset: the target is 1:35 and the chip is saved on the device.
    await sheet.locator('[data-workout-rest-custom-save]').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('[data-workout-rest-target]')).toHaveAttribute('data-workout-rest-target', '95');
    await expect(page.locator('[data-workout-rest-target]')).toHaveText('1:35');

    await page.reload();
    await expect(page.locator('[data-workout-rest-target]')).toHaveAttribute('data-workout-rest-target', '95', { timeout: 20_000 });
    await page.locator('[data-workout-rest-target]').click();
    const chip = page.locator('[data-workout-rest-preset="95"]');
    await expect(chip).toHaveAttribute('data-workout-rest-preset-saved', 'true');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // The built-in 1:30 carries no remove; the saved one does, and goes.
    await expect(page.locator('[data-workout-rest-preset-remove="90"]')).toHaveCount(0);
    await page.locator('[data-workout-rest-preset-remove="95"]').click();
    await expect(page.locator('[data-workout-rest-preset="95"]')).toHaveCount(0);
    await expect(page.locator('[data-workout-rest-preset]')).toHaveCount(6);
    // Use without saving: a plain custom target, no new chip.
    await page.locator('[data-workout-rest-custom]').click();
    await page.locator('[data-workout-rest-custom-use]').click();
    await expect(page.locator('[data-workout-rest-target]')).toHaveAttribute('data-workout-rest-target', '95');
    await page.locator('[data-workout-rest-target]').click();
    await expect(page.locator('[data-workout-rest-preset]')).toHaveCount(6);
    await page.locator('[data-workout-rest-preset="off"]').click();
    await expect(page.locator('[data-workout-rest-target]')).toHaveAttribute('data-workout-rest-target', 'off');
  } finally {
    if (workoutId) await api.delete(`/api/workouts/${workoutId}`);
    await api.dispose();
  }
});
