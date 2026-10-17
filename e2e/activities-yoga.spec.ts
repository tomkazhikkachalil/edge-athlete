import { test, expect, type Page } from './helpers/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The user's complaint (activities details A7, Oct 16 2026): a yoga session
// recorded nothing a yoga session is. Now the Finish asks its style, whether
// it was heated (and how hot), class or self-guided — the page reads them
// back with the effort — and the next yoga pre-fills the CHOICES, never the
// temperature.

const PHONE = { width: 375, height: 812 };

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, effort, details').limit(1);
  test.skip(!!probe.error, `migration 265 not applied on this target (${probe.error?.code})`);
});

async function yogaToFinish(page: Page) {
  await page.goto('/activities/record');
  await page.locator('[data-record-type="yoga"]').click({ timeout: 20_000 });
  await page.locator('[data-record-start]').click();
  await page.waitForTimeout(6_000);
  await page.locator('[data-record-finish]').click();
  await expect(page.locator('[data-record-finish-sheet]')).toBeVisible();
}

test('a yoga session keeps its style, heat, class and effort; the next one pre-fills the choices only @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await yogaToFinish(page);
    const form = page.locator('[data-finish-details="yoga"]');
    await form.locator('[data-detail-field="style"] [data-detail-option="vinyasa"]').click();
    // The room's temperature appears only once it was heated.
    await expect(form.locator('[data-detail-field="room_temp_c"]')).toHaveCount(0);
    await form.locator('[data-detail-field="heated"] [data-detail-option="true"]').click();
    await form.locator('[data-detail-field="room_temp_c"] input').fill('40');
    await form.locator('[data-detail-field="guided"] [data-detail-option="class"]').click();
    await form.locator('[data-effort="6"]').click();
    // Focus and poses wait behind "More details".
    await expect(form.locator('[data-detail-field="focus"]')).toHaveCount(0);
    await form.locator('[data-finish-more]').click();
    await form.locator('[data-detail-field="focus"] [data-detail-option="hips"]').click();
    await page.locator('[data-choice="only_me"]').click();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;

    const { data: row } = await admin.from('activities').select('effort, details').eq('id', id).single();
    expect(row).toEqual({ effort: 6, details: { style: 'vinyasa', heated: true, room_temp_c: 40, guided: 'class', focus: ['hips'] } });
    await expect(page.locator('[data-activity-details]')).toHaveText('Vinyasa · Heated · 40 °C · Class · Hips');
    const tiles = page.locator('[data-activity-stats] [data-activity-tile]');
    await expect(tiles).toHaveCount(2);
    await expect(page.locator('[data-activity-tile="time"]')).toBeVisible();
    await expect(page.locator('[data-activity-tile="effort"]')).toContainText('6 / 10');

    await yogaToFinish(page);
    const next = page.locator('[data-finish-details="yoga"]');
    await expect(next.locator('[data-detail-field="style"] [data-detail-option="vinyasa"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(next.locator('[data-detail-field="heated"] [data-detail-option="true"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(next.locator('[data-detail-field="room_temp_c"] input')).toHaveValue('');
    await expect(next.locator('[data-effort][aria-checked="true"]')).toHaveCount(0);
    await page.locator('[data-record-discard]').click();
    await page.getByRole('button', { name: 'Discard' }).last().click();
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});
