import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody, adminClient } from './helpers/qa-user';

// The Vitals dashboard round-trip: seed metric history (higher- and
// lower-is-better) + a manual workout via APIs, then assert the hero tiles,
// PB spotlight, progress chart, metric history, month-grouped log, and the
// visitor's read-only view.
test('vitals: seed → hero → PBs → chart → log → visitor', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const stamp = Date.now();

  const api = await apiAs('state.json');
  try {
    const vitalSeed = [
      { metric_key: 'bench_press', metric_category: 'strength', metric_label: 'Bench Press', unit: 'lbs', value: 185, recorded_at: '2025-09-01' },
      { metric_key: 'bench_press', metric_category: 'strength', metric_label: 'Bench Press', unit: 'lbs', value: 225, recorded_at: '2026-08-01' },
      { metric_key: 'mile_run', metric_category: 'conditioning', metric_label: 'Mile Run', unit: 'min', value: 372, value_display: '6:12', recorded_at: '2025-11-01' },
      { metric_key: 'mile_run', metric_category: 'conditioning', metric_label: 'Mile Run', unit: 'min', value: 348, value_display: '5:48', recorded_at: '2026-07-15' },
    ];
    for (const v of vitalSeed) {
      const res = await api.post('/api/vitals', { data: v });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
    }

    // One completed manual workout THIS week: 5×185 + 3×205 bench.
    const res = await api.post('/api/workouts', {
      data: {
        mode: 'manual',
        startedAt: new Date().toISOString(),
        durationSeconds: 3600,
        title: `QA Push ${stamp}`,
        exercises: [{
          name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null,
          sets: [
            { setNumber: 1, reps: 5, weight: 185, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] },
            { setNumber: 2, reps: 3, weight: 205, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] },
          ],
        }],
      },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
  } finally {
    await api.dispose();
  }

  await page.goto('/athlete');
  await page.getByRole('button', { name: /vitals/i }).first().click();

  // Hero: 1 workout this week, exact volume math, streak >= 1, PB spotlight.
  await expect(page.getByText('Workouts this week', { exact: false })).toBeVisible({ timeout: 15_000 });
  const volume = 5 * 185 + 3 * 205; // 1540
  await expect(page.getByText(`${volume.toLocaleString('en-US')} lbs`).first()).toBeVisible();
  await expect(page.getByText('Latest personal best')).toBeVisible();
  await expect(page.getByText('Bench Press · 225 lbs')).toBeVisible();

  // PB showcase: mm:ss formatting for the timed metric (never raw seconds).
  await expect(page.getByText('5:48').first()).toBeVisible();
  // exact: a random QA-title timestamp can contain "348" as a substring
  await expect(page.getByText('348', { exact: true })).toHaveCount(0);

  // Progress chart renders with the chip picker; switching to the mile
  // swaps the charted series (aria-label carries the metric name).
  const picker = page.getByLabel('Tracking');
  await expect(picker).toBeVisible();
  await expect(page.locator('svg[aria-label*="Bench Press"], svg[aria-label*="latest"]').first())
    .toBeVisible();
  await picker.getByRole('button', { name: '1-Mile Run' }).click();
  await expect(page.locator('svg[aria-label*="1-Mile Run"]')).toBeVisible();

  // Metric history lives behind the metric's larger window (tap the trophy
  // or library bubble — both carry the metric name and open the overlay).
  await page.getByRole('button', { name: /Bench Press/ }).first().click();
  const metricDialog = page.getByRole('dialog', { name: 'Bench Press' });
  await expect(metricDialog.getByText('185 lbs').first()).toBeVisible();
  await metricDialog.getByRole('button', { name: 'Close' }).click();

  // The month-grouped diary opens from the Recent Workouts bubble; expanding
  // a session still shows its set line.
  await page.getByRole('button', { name: /Recent workouts/i }).click();
  const workoutsDialog = page.getByRole('dialog', { name: 'Workouts' });
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  await expect(workoutsDialog.getByRole('heading', { name: month })).toBeVisible();
  await workoutsDialog.getByText(`QA Push ${stamp}`).first().click();
  await expect(workoutsDialog.getByText('5 reps × 185 lbs').first()).toBeVisible();
  await workoutsDialog.getByRole('button', { name: 'Close' }).click();

  // Visitor (user B): read-only dashboard — hero visible, no owner actions.
  await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto(`/athlete/${userA.id}`);
    await pageB.getByRole('button', { name: /vitals/i }).first().click();
    await expect(pageB.getByText('Latest personal best')).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText('Bench Press · 225 lbs')).toBeVisible();
    await expect(pageB.getByRole('button', { name: 'Start Workout' })).toHaveCount(0);
    await expect(pageB.getByRole('button', { name: 'Add Metric' })).toHaveCount(0);

    // Vitals privacy: the owner hides the section via the real settings API;
    // the visitor gets a lock card and zero data, while the owner still sees
    // everything. STRICT once migration 122 exists; before it, the reads
    // fail open by design, so the scenario skips with a warning instead of
    // failing the suite (the CI-secrets precedent).
    const { error: columnMissing } = await adminClient()
      .from('profiles').select('vitals_privacy').limit(1);
    if (columnMissing) {
      console.warn('[e2e] profiles.vitals_privacy missing — run migration 122; privacy scenario skipped');
    } else {
      const apiOwner = await apiAs('state.json');
      try {
        const res = await apiOwner.patch('/api/settings/vitals-privacy', { data: { hidden: true } });
        expect(res.ok(), await readErrorBody(res)).toBe(true);
      } finally {
        await apiOwner.dispose();
      }
      await pageB.reload();
      await pageB.getByRole('button', { name: /vitals/i }).first().click();
      await expect(pageB.getByText('These vitals are private')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText('Bench Press · 225 lbs')).toHaveCount(0);

      await page.reload();
      await page.getByRole('button', { name: /vitals/i }).first().click();
      await expect(page.getByText('Bench Press · 225 lbs')).toBeVisible({ timeout: 15_000 });
    }
  } finally {
    await ctxB.close();

    // Restore the shared QA user's default state — later specs (the media-
    // proxy privacy pins, the @mobile suite) assert against it. Leaked state
    // here was the root of the Aug 2026 order-dependent flakes.
    await adminClient().from('profiles')
      .update({ visibility: 'private', vitals_privacy: null })
      .eq('id', userA.id);
  }
});
