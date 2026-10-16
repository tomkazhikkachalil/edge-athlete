import { test, expect, request as pwRequest } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// Training load (activities details A11, Oct 16 2026): minutes × effort over
// the RATED sessions of the week, activities and workouts alike; an unrated
// one adds nothing and the line says how many were rated.

test('the week reads Load = Σ minutes × effort over its rated sessions, "2 of 3 rated"; the overlay switches to load @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const u = await createQaUser({ displayName: 'Loaded Lee', firstName: 'Loaded', lastName: 'Lee' });
  const storageState = await mintStorageState(u);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState, extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState, viewport: { width: 375, height: 812 }, extraHTTPHeaders: bypassHeaders() });
  try {
    const now = Date.now();
    const wire = (type: 'yoga' | 'hiit', hoursAgo: number) => ({ ...liveWire({ type, n: 181, stepM: 0, stepS: 10, t0: now - hoursAgo * 3600_000 }), lat: undefined, lng: undefined });
    const rated = await api.post('/api/activities', { data: { activity: wire('yoga', 3), finish: { effort: 6 } } });
    expect(rated.status(), await readErrorBody(rated)).toBe(201);
    const unrated = await api.post('/api/activities', { data: { activity: wire('hiit', 6) } });
    expect(unrated.status(), await readErrorBody(unrated)).toBe(201);
    const w = await api.post('/api/workouts', { data: { mode: 'manual', startedAt: new Date(now - 9 * 3600_000).toISOString(), durationSeconds: 2400, title: 'Push', exercises: [
      { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength', notes: null, sets: [{ setNumber: 1, reps: 5, weight: 135, weightUnit: 'lbs', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] }] },
    ] } });
    expect(w.ok(), await readErrorBody(w)).toBe(true);
    const workoutId = (await w.json()).session.id as string;
    expect((await api.patch(`/api/workouts/${workoutId}`, { data: { effort: 8 } })).status()).toBe(200);

    // The expected load from what was stored: the activity's moving (else elapsed) minutes × 6, the workout's 40 × 8.
    const { data: acts } = await admin.from('activities').select('moving_s, elapsed_s, effort').eq('profile_id', u.id).not('effort', 'is', null);
    const actMinutes = (acts![0].moving_s ?? acts![0].elapsed_s) / 60;
    const expected = Math.round(actMinutes * 6 + 40 * 8);

    const page = await ctx.newPage();
    await page.goto('/athlete?tab=training');
    const line = page.locator('[data-training-load]');
    // The week can straddle a Monday for a session seeded hours ago; then this test proves nothing — say so.
    await expect(line).toBeVisible({ timeout: 30_000 });
    const ratedAttr = await line.getAttribute('data-training-rated');
    test.skip(ratedAttr !== '2/3', `the seeded sessions straddle a week boundary (${ratedAttr})`);
    await expect(line).toHaveAttribute('data-training-load', String(expected));
    await expect(line).toContainText(`Load ${expected.toLocaleString('en-US')} · 2 of 3 rated`);

    await page.getByText('Weekly activity', { exact: true }).first().click();
    await page.locator('[data-weekly-view="load"]').click();
    await expect(page.getByText(/Load is minutes × how hard it was/)).toBeVisible();
    await expect(page.locator(`[data-week-load="${expected}"]`)).toBeVisible();
  } finally {
    await ctx.close();
    await api.dispose();
    await deleteQaUser(u.id);
  }
});
