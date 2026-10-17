import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// Per-type tiles (Oct 16 2026, activities details A1): a yoga session reads
// its time — never "0 km" or a "—" pace — and a hike reads its climb (gain,
// high point, climb rate). A tile shows only when it has a value.

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, segments').limit(1);
  test.skip(!!probe.error, `migration 251 not applied on this target (${probe.error?.code})`);
});

test('a yoga shows its time and no distance; a hike shows its climb @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const ids: string[] = [];
  try {
    for (const w of [
      liveWire({ type: 'yoga', name: 'Morning flow', n: 300, stepM: 0, stepS: 6 }),
      liveWire({ type: 'hike', name: 'Ridge hike', n: 600, stepM: 1.2, stepS: 2, climbPerStep: 0.3 }),
    ]) {
      const res = await api.post('/api/activities', { data: { activity: w } });
      expect(res.status(), await res.text()).toBe(201);
      ids.push((await res.json()).id as string);
    }

    await page.goto(`/activities/${ids[0]}`);
    await expect(page.locator('[data-activity-name]')).toHaveText('Morning flow', { timeout: 20_000 });
    const yoga = page.locator('[data-activity-stats]');
    await expect(yoga.locator('[data-activity-tile="time"]')).toBeVisible();
    for (const k of ['distance', 'pace', 'gain', 'hr']) await expect(yoga.locator(`[data-activity-tile="${k}"]`)).toHaveCount(0);

    await page.goto(`/activities/${ids[1]}`);
    await expect(page.locator('[data-activity-name]')).toHaveText('Ridge hike', { timeout: 20_000 });
    const hike = page.locator('[data-activity-stats]');
    for (const k of ['distance', 'gain', 'high', 'climbRate']) await expect(hike.locator(`[data-activity-tile="${k}"]`)).toBeVisible();
    // A time always shows: moving time, or — when the filter saw no movement on this synthetic line — the total.
    await expect(hike.locator('[data-activity-tile="moving"], [data-activity-tile="total"]').first()).toBeVisible();
    await expect(hike.locator('[data-activity-tile="moving"]', { hasText: /^Moving time0:00$/ })).toHaveCount(0);
  } finally {
    for (const id of ids) await api.delete(`/api/activities/${id}`).catch(() => undefined);
    await adminClient().from('activities').delete().eq('profile_id', user.id).in('name', ['Morning flow', 'Ridge hike']);
    await api.dispose();
  }
});
