import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The round timer and the recorder tweaks (activities details A3, Oct 16
// 2026): a short Intervals timer rings through its rounds and leaves them as
// segments on the saved activity; the picker shows the last-used type first;
// an elliptical saves without a distance.

const PHONE = { width: 375, height: 812 };

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, segments').limit(1);
  test.skip(!!probe.error, `migration 251 not applied on this target (${probe.error?.code})`);
});

test('a HIIT intervals timer marks its rounds; Recent shows HIIT first @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="hiit"]').click({ timeout: 20_000 });
    await page.locator('[data-record-start]').click();

    await page.locator('[data-record-timer-open]').click();
    await page.locator('[data-timer-format="intervals"]').click();
    await expect(page.locator('[data-record-timer-setup="intervals"]')).toBeVisible();
    await page.locator('[data-timer-rounds]').fill('2');
    for (const [field, s] of [['work', '6'], ['rest', '5'], ['warmup', '0'], ['cooldown', '0']] as const) {
      const f = page.locator(`[data-timer-field="${field}"]`);
      await f.getByLabel(/minutes/).fill('0');
      await f.getByLabel(/seconds/).fill(s);
    }
    await page.locator('[data-timer-start]').click();
    await expect(page.locator('[data-record-timer="work"]')).toBeVisible();
    await expect(page.locator('[data-record-timer-line]')).toHaveText('Intervals · Round 1 of 2');
    await expect(page.locator('[data-record-timer="rest"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-record-timer-line]')).toHaveText('Intervals · Round 2 of 2', { timeout: 10_000 });
    await expect(page.locator('[data-record-timer="done"]')).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-record-finish]').click();
    await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
    await page.locator('[data-choice="only_me"]').click();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    const { data: row } = await admin.from('activities').select('activity_type, segments').eq('id', id).single();
    const segs = row!.segments as Array<{ kind: string; label?: string }>;
    expect(segs.filter(s => s.kind === 'round').map(s => s.label)).toEqual(['Round 1', 'Round 2']);
    expect(segs.filter(s => s.kind === 'recovery')).toHaveLength(1);

    // The picker now offers HIIT first.
    await page.goto('/activities/record');
    await expect(page.locator('[data-record-recent] [data-record-recent-type]').first()).toHaveAttribute('data-record-recent-type', 'hiit', { timeout: 20_000 });
    await expect(page.locator('[data-record-type="hiit"]')).toHaveCount(1);
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('an elliptical saves without a distance @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="elliptical"]').click({ timeout: 20_000 });
    await page.locator('[data-record-start]').click();
    await page.waitForTimeout(6_000);
    await page.locator('[data-record-finish]').click();
    await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
    await expect(page.getByText('Distance (optional)')).toBeVisible();
    await page.locator('[data-choice="only_me"]').click();
    await expect(page.locator('[data-record-save]')).toBeEnabled();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;
    const { data: row } = await admin.from('activities').select('activity_type, distance_m').eq('id', id).single();
    expect(row!.activity_type).toBe('elliptical');
    expect(Number(row!.distance_m ?? 0)).toBe(0);
    // The page reads its time, never a 0 km distance.
    await expect(page.locator('[data-activity-tile="distance"]')).toHaveCount(0);
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});
