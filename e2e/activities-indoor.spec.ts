import { test, expect } from './helpers/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Program F6 (Oct 2026): the indoor family — treadmill, indoor ride,
// elliptical, stair climber. A timer with the distance typed at the Finish
// (optional on the three that have no honest distance), the type's own
// question before Start where it is a choice (the platform, how the climb
// is counted), the numbers (incline, resistance, watts) at the Finish.

const PHONE = { width: 375, height: 812 };

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, effort, details').limit(1);
  test.skip(!!probe.error, `migration 265 not applied on this target (${probe.error?.code})`);
});

test('indoor ride: the platform before Start, no map, the distance optional at the Finish; the stair climber asks how it is counted @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="indoor_ride"]').click({ timeout: 20_000 });
    const card = page.locator('[data-record-ready]');
    await card.locator('[data-detail-field="platform"] [data-detail-option="zwift"]').click();
    // The numbers (watts, cadence) are Finish questions.
    await expect(card.locator('[data-detail-field="watts"]')).toHaveCount(0);
    await expect(card.locator('[data-record-records-item="distance"]')).toBeVisible();
    await expect(card.locator('[data-record-records-item="map"]')).toHaveCount(0);
    await expect(page.locator('[data-record-setup-line]')).toHaveText('Zwift');
    await page.locator('[data-record-start]').click();
    await expect(page.locator('[data-record-screen="recording"]')).toBeVisible();
    await expect(page.locator('[data-record-timer]')).toBeVisible();
    await expect(page.locator('[data-record-map]')).toHaveCount(0);
    await expect(page.locator('[data-record-details-open]')).toBeVisible();
    await page.waitForTimeout(6_000);
    await page.locator('[data-record-finish]').click();
    await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
    await expect(page.getByText('Distance (optional)')).toBeVisible();
    await expect(page.locator('[data-finish-details="indoor_ride"] [data-detail-field="platform"] [data-detail-option="zwift"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-feed-toggle="on"]').click();
    await expect(page.locator('[data-record-save]')).toBeEnabled();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    const { data: row } = await admin.from('activities').select('activity_type, distance_m, details').eq('id', id).single();
    expect(row).toMatchObject({ activity_type: 'indoor_ride', distance_m: null, details: { platform: 'zwift' } });

    // The stair climber asks how the climb is counted before Start; the count itself at the Finish.
    await page.goto('/activities/record');
    await page.locator('[data-record-type="stair_climber"]').click({ timeout: 20_000 });
    const stairs = page.locator('[data-record-ready]');
    await expect(stairs.locator('[data-detail-field="climbed_unit"]')).toBeVisible();
    await expect(stairs.locator('[data-detail-field="climbed"]')).toHaveCount(0);
    await page.locator('[data-record-choose-another]').click();
    await expect(page.locator('[data-record-type="treadmill"]')).toBeVisible({ timeout: 15_000 });
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});
