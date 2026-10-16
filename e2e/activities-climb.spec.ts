import { test, expect, type Page } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// Climbing with grades and sends (activities details A8, Oct 16 2026): the
// climbs are logged while recording — grade, Sent or Attempt, tries — and
// kept in the recording at once; the Finish carries them with the session's
// answers; the page reads Climbs, Sends and the hardest send.

const PHONE = { width: 375, height: 812 };

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, effort, details').limit(1);
  test.skip(!!probe.error, `migration 265 not applied on this target (${probe.error?.code})`);
});

async function logClimb(page: Page, grade: string, sent: boolean, tries = 1) {
  await page.locator('[data-record-climbs] [data-climb-add]').click();
  const sheet = page.locator('[data-climb-sheet]');
  await sheet.locator(`[data-climb-grade="${grade}"]`).click();
  await sheet.locator(`[data-climb-sent="${sent}"]`).click();
  for (let i = 1; i < tries; i++) await sheet.getByRole('button', { name: 'One more try' }).click();
  await sheet.locator('[data-climb-save]').click();
  await expect(sheet).toHaveCount(0);
}

test('a bouldering session logs V3 sent, V5 attempt, V4 sent in 2 → Climbs 3, Sends 2, Hardest V4; the next one pre-fills the scale, not the climbs @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: PHONE });
  try {
    const page = await ctx.newPage();
    await page.goto('/activities/record');
    await page.locator('[data-record-type="climb"]').click({ timeout: 20_000 });
    await page.locator('[data-record-start]').click();
    const log = page.locator('[data-record-climbs]');
    await expect(log.locator('[data-climb-add]')).toBeDisabled();
    await log.locator('[data-climb-scale="v"]').click();
    await logClimb(page, 'V3', true);
    await logClimb(page, 'V5', false);
    await logClimb(page, 'V4', true, 2);
    await expect(log.locator('[data-climb-summary]')).toHaveText('3 · 2 sent · hardest V4');
    // Kept in the recording: a reload brings the climbs back.
    await page.reload();
    await expect(page.locator('[data-record-climbs] [data-climb]')).toHaveCount(3, { timeout: 20_000 });

    await page.locator('[data-record-finish]').click();
    const form = page.locator('[data-finish-details="climb"]');
    await expect(form.locator('[data-climb]')).toHaveCount(3);
    await form.locator('[data-detail-field="setting"] [data-detail-option="indoor"]').click();
    await form.locator('[data-detail-field="style"] [data-detail-option="bouldering"]').click();
    await form.locator('[data-effort="7"]').click();
    await page.locator('[data-choice="only_me"]').click();
    await page.locator('[data-record-save]').click();
    await page.waitForURL(/\/activities\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().split('/').pop()!;

    const { data: row } = await admin.from('activities').select('effort, details').eq('id', id).single();
    expect(row!.effort).toBe(7);
    expect(row!.details).toMatchObject({ setting: 'indoor', style: 'bouldering', scale: 'v' });
    expect((row!.details as { climbs: { grade: string; sent: boolean; attempts?: number }[] }).climbs.map(c => [c.grade, c.sent, c.attempts ?? 1])).toEqual([
      ['V3', true, 1],
      ['V5', false, 1],
      ['V4', true, 2],
    ]);
    await expect(page.locator('[data-activity-tile="climbs"]')).toContainText('3');
    await expect(page.locator('[data-activity-tile="sends"]')).toContainText('2');
    await expect(page.locator('[data-activity-tile="hardest"]')).toContainText('V4');
    await expect(page.locator('[data-activity-climb="2"]')).toHaveText(/V4 · Sent · 2 tries/);
    await expect(page.locator('[data-activity-details]')).toHaveText('Indoor · Bouldering · V-scale');

    // The next climbing session: the style and the scale pre-fill; no climbs carry over.
    await page.goto('/activities/record');
    await page.locator('[data-record-type="climb"]').click({ timeout: 20_000 });
    await page.locator('[data-record-start]').click();
    await page.waitForTimeout(2_000);
    await page.locator('[data-record-finish]').click();
    const next = page.locator('[data-finish-details="climb"]');
    await expect(next.locator('[data-detail-field="style"] [data-detail-option="bouldering"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(next.locator('[data-climb-scale="v"]')).toHaveAttribute('aria-checked', 'true');
    await expect(next.locator('[data-climb]')).toHaveCount(0);
    await page.locator('[data-record-discard]').click();
    await page.getByRole('button', { name: 'Discard' }).last().click();
  } finally {
    await ctx.close();
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  }
});

test('the server refuses a 51st climb; colours without an order name no hardest send', async ({ page }) => {
  test.setTimeout(90_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  const ids: string[] = [];
  try {
    const wire = () => ({ ...liveWire({ type: 'climb', n: 120, stepM: 0, stepS: 10 }), lat: undefined, lng: undefined });
    const many = Array.from({ length: 51 }, () => ({ grade: 'V1', sent: true }));
    const over = await api.post('/api/activities', { data: { activity: wire(), finish: { details: { scale: 'v', climbs: many } } } });
    expect(over.status()).toBe(400);
    expect(await over.text()).toContain('50');
    const ok = await api.post('/api/activities', { data: { activity: wire(), finish: { details: { style: 'bouldering', scale: 'colour', climbs: [{ grade: 'blue', sent: true }, { grade: 'red', sent: false }] } } } });
    expect(ok.status(), await ok.text()).toBe(201);
    ids.push((await ok.json()).id);
    await page.goto(`/activities/${ids[0]}`);
    await expect(page.locator('[data-activity-tile="climbs"]')).toContainText('2', { timeout: 20_000 });
    await expect(page.locator('[data-activity-tile="sends"]')).toContainText('1');
    await expect(page.locator('[data-activity-tile="hardest"]')).toHaveCount(0);
    await expect(page.locator('[data-activity-climb="0"]')).toHaveText(/Blue · Sent/);
  } finally {
    for (const id of ids) await api.delete(`/api/activities/${id}`).catch(() => undefined);
    await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
    await api.dispose();
  }
});
