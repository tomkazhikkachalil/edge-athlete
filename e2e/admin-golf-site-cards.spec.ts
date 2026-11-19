import { test, expect, request as pwRequest } from './helpers/test';
import { adminSignIn } from './helpers/admin';
import { cleanup } from './helpers/cleanup';
import {
  adminClient, adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL,
} from './helpers/qa-user';

// The website scorecard reader's door (Nov 18 2026; migration 315). Everything
// here is a READ or a DRY RUN, so the spec is safe on production as it is: the
// gates (the cron route without its secret, the admin route anonymous and as a
// signed-in athlete, a bad course id), the progress answer, a dry run that
// stamps nothing, and the panel at desktop and phone width.
// Skips without E2E_ADMIN_EMAIL; skips pre-315.
const adminEmail = adminEmailForE2E();

test('admin: the website scorecard reader answers its progress, dry-runs without writing, and the panel renders', async ({ browser }) => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(240_000);
  const admin = adminClient();
  const probe = await admin.from('golf_courses').select('site_card_at').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42703' || probe.error.code === 'PGRST204'), 'migration 315 not applied on this target');

  const qa = await apiAs('state.json');
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });
  try {
    await adminSignIn(adminApi, adminUser);
    await adminSignIn(ctx, adminUser);

    // The gates.
    expect((await anon.post('/api/cron/golf-site-cards')).status()).toBe(401);
    expect((await anon.get('/api/admin/golf-site-cards')).status()).toBe(401);
    expect((await qa.get('/api/admin/golf-site-cards')).status()).toBe(401);
    expect((await qa.post('/api/admin/golf-site-cards', { data: { dryRun: false } })).status()).toBe(401);
    expect((await adminApi.post('/api/admin/golf-site-cards', { data: { courseId: 'not-an-id' } })).status()).toBe(400);

    // Progress: never cached, numbers and a list.
    const progress = await adminApi.get('/api/admin/golf-site-cards');
    expect(progress.ok(), await readErrorBody(progress)).toBe(true);
    expect(progress.headers()['cache-control']).toContain('no-store');
    const p = await progress.json();
    for (const k of ['waiting', 'visited']) expect(typeof p[k], k).toBe('number');
    expect(Array.isArray(p.saved)).toBe(true);

    // A step with no dryRun field is a dry run: reads websites, stamps nothing
    // it visited (on production the schedule moves the total; the dry run's own
    // courses stay unvisited).
    const step = await adminApi.post('/api/admin/golf-site-cards', { data: { rows: 2 }, timeout: 115_000 });
    expect(step.ok(), await readErrorBody(step)).toBe(true);
    const body = await step.json();
    expect(body).toMatchObject({ phase: 'site-cards', dryRun: true });
    expect(body.due).toBeLessThanOrEqual(2);
    expect(body.budgetExhausted).toBe(false);

    // The panel.
    const page = await ctx.newPage();
    await page.goto('/admin');
    const panel = page.locator('[data-admin-golf-site-cards]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-site-cards-saved]')).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-site-cards-visited]')).toBeVisible();
    await expect(panel.locator('[data-site-cards-waiting]')).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await panel.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    const bb = await panel.locator('[data-site-cards-dry]').boundingBox();
    expect(bb!.x + bb!.width, 'the button inside the screen').toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 375 px').toBe(true);
  } finally {
    await cleanup('admin-golf-site-cards', [
      () => deleteQaUser(adminUser.id),
      () => ctx.close(),
      () => adminApi.dispose(),
      () => anon.dispose(),
      () => qa.dispose(),
    ]);
  }
});
