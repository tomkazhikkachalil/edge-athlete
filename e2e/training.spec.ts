import { test, expect } from './helpers/test';
import { apiAs, loadQaUser, readErrorBody, adminClient } from './helpers/qa-user';

// The Training dashboard round-trip: seed metric history (higher- and
// lower-is-better) + a manual workout via APIs, then assert the hero tiles,
// PB spotlight, progress chart, metric history, month-grouped log, and the
// visitor's read-only view.
test('training: seed → hero → PBs → chart → log → visitor', { tag: '@smoke' }, async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const stamp = Date.now();

  // A retry re-seeds into the SAME user: the hero's "this week" volume then
  // reads two workouts (3,080 lbs, seen on the Oct 8 prod probe), so a retry
  // could never pass. Start from no sessions (the metric rows are plain inserts
  // and a duplicate changes no PB).
  await adminClient().from('workout_sessions').delete().eq('profile_id', userA.id);

  const api = await apiAs('state.json');
  try {
    const bodyMetricSeed = [
      { metric_key: 'bench_press', metric_category: 'strength', metric_label: 'Bench Press', unit: 'lbs', value: 185, recorded_at: '2025-09-01' },
      { metric_key: 'bench_press', metric_category: 'strength', metric_label: 'Bench Press', unit: 'lbs', value: 225, recorded_at: '2026-08-01' },
      { metric_key: 'mile_run', metric_category: 'conditioning', metric_label: 'Mile Run', unit: 'min', value: 372, value_display: '6:12', recorded_at: '2025-11-01' },
      { metric_key: 'mile_run', metric_category: 'conditioning', metric_label: 'Mile Run', unit: 'min', value: 348, value_display: '5:48', recorded_at: '2026-07-15' },
    ];
    for (const v of bodyMetricSeed) {
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
    // Training fixes PR 4: a finished workout is UNPOSTED until Post or Done — a seed decides (Done), or the
    // reopen prompt ("A finished workout is waiting") covers every page of this and every later spec.
    const seededId = (await res.json()).session.id as string;
    const decided = await api.patch(`/api/workouts/${seededId}`, { data: { decided: true } });
    expect(decided.ok(), await readErrorBody(decided)).toBe(true);
  } finally {
    await api.dispose();
  }

  await page.goto('/athlete');
  await page.getByRole('button', { name: /training/i }).first().click();

  // Hero: 1 workout this week, exact volume math, streak >= 1, PB spotlight.
  await expect(page.getByText('Sessions this week', { exact: false })).toBeVisible({ timeout: 15_000 });
  const volume = 5 * 185 + 3 * 205; // 1540
  await expect(page.getByText(`${volume.toLocaleString('en-US')} lbs`).first()).toBeVisible();
  await expect(page.getByText('Latest personal best')).toBeVisible();
  await expect(page.getByText('Bench Press · 225 lbs')).toBeVisible();

  // Four views (Training redesign PR 3, Nov 11 2026): the Overview is the landing one,
  // and what belongs to another view is not on it.
  const views = page.getByRole('tablist', { name: 'Training views' });
  await expect(views.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Tracking')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Metric' })).toHaveCount(0);

  // History — the Recent sessions card is its door: the month-grouped diary is the
  // view's own list (no window over the page); expanding a session shows its set line.
  await page.getByRole('button', { name: /Recent sessions/i }).click();
  await expect(views.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\?tab=training&view=history$/);
  const diary = page.locator('[data-training-history]');
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  await expect(diary.getByRole('heading', { name: month })).toBeVisible();
  await diary.getByText(`QA Push ${stamp}`).first().click();
  await expect(diary.getByText('5 reps × 185 lbs').first()).toBeVisible();
  await expect(page.getByText('Sessions this week')).toHaveCount(0);

  // Body & tests — the bests typed in: mm:ss formatting for the timed metric (never raw seconds).
  await views.getByRole('tab', { name: 'Body & tests' }).click();
  await expect(page).toHaveURL(/\?tab=training&view=body$/);
  await expect(page.getByText('5:48').first()).toBeVisible();
  // exact: a random QA-title timestamp can contain "348" as a substring
  await expect(page.getByText('348', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Metric' })).toBeVisible();

  // Metric history lives behind the metric's larger window (tap the trophy
  // or library bubble — both carry the metric name and open the overlay).
  await page.getByRole('button', { name: /Bench Press/ }).first().click();
  const metricDialog = page.getByRole('dialog', { name: 'Bench Press' });
  await expect(metricDialog.getByText('185 lbs').first()).toBeVisible();
  await metricDialog.getByRole('button', { name: 'Close' }).click();

  // Exercises — the progress chart renders with the chip picker; switching to the
  // mile swaps the charted series (aria-label carries the metric name).
  await views.getByRole('tab', { name: 'Exercises' }).click();
  await expect(page).toHaveURL(/\?tab=training&view=exercises$/);
  const picker = page.getByLabel('Tracking');
  await expect(picker).toBeVisible();
  await expect(page.locator('svg[aria-label*="Bench Press"], svg[aria-label*="latest"]').first())
    .toBeVisible();
  await picker.getByRole('button', { name: '1-Mile Run' }).click();
  await expect(page.locator('svg[aria-label*="1-Mile Run"]')).toBeVisible();

  // A refresh lands on the same view (the view is in the URL), and the bare tab is the Overview again.
  await page.reload();
  await expect(page.getByLabel('Tracking')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tablist', { name: 'Training views' }).getByRole('tab', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\?tab=training$/);
  await expect(page.getByText('Sessions this week', { exact: false })).toBeVisible();

  // Visitor (user B): read-only dashboard — hero visible, no owner actions.
  await adminClient().from('profiles').update({ visibility: 'public' }).eq('id', userA.id);
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto(`/athlete/${userA.id}`);
    await pageB.getByRole('button', { name: /training/i }).first().click();
    await expect(pageB.getByText('Latest personal best')).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText('Bench Press · 225 lbs')).toBeVisible();
    await expect(pageB.locator('[data-training-start]')).toHaveCount(0);
    await expect(pageB.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
    // …on every view: the visitor has the same four, and no owner action on any.
    for (const name of ['History', 'Exercises', 'Body & tests']) {
      await pageB.getByRole('tablist', { name: 'Training views' }).getByRole('tab', { name }).click();
      await expect(pageB.locator('[data-training-start]')).toHaveCount(0);
      await expect(pageB.getByRole('button', { name: 'Add Metric' })).toHaveCount(0);
      await expect(pageB.getByRole('button', { name: 'Log Training' })).toHaveCount(0);
      await expect(pageB.locator('[data-exercise-records]')).toHaveCount(0);
    }

    // Training privacy: the owner hides the section via the real settings API;
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
      await pageB.getByRole('button', { name: /training/i }).first().click();
      await expect(pageB.getByText('Your training is private')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText('Bench Press · 225 lbs')).toHaveCount(0);

      await page.reload();
      await page.getByRole('button', { name: /training/i }).first().click();
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
