import { test, expect, request as pwRequest } from './helpers/test';
import { adminSignIn } from './helpers/admin';
import { cleanup } from './helpers/cleanup';
import {
  adminClient, adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL,
} from './helpers/qa-user';

// The scorecard fill's door (Nov 17 2026; migration 314). Everything here is
// a READ or a DRY RUN, so the spec is safe on production as it is: the gate
// (anonymous 401, a signed-in athlete 401 too since the console has its own
// sign-in, a bad phase 400), the progress
// answer, a dry link and a dry batch that write nothing (the link's record
// and the fill's daily count are read before and after), and the dashboard
// panel with its four numbers and a dry run through the button.
// Skips without E2E_ADMIN_EMAIL; skips pre-314.
const adminEmail = adminEmailForE2E();

test('admin: the scorecard fill answers its progress, dry-runs both steps without writing, and the panel renders', async ({ browser }) => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(180_000);
  const admin = adminClient();
  const probe = await admin.from('golf_courses').select('opengolf_id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42703' || probe.error.code === 'PGRST204'), 'migration 314 not applied on this target');

  const qa = await apiAs('state.json');
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });

  // What a dry run must leave exactly as it found it.
  const written = async () => {
    const [meta, linked] = await Promise.all([
      admin.from('golf_map_sweep_meta').select('key, updated_at').in('key', ['card_link', 'card_link_try']),
      admin.from('golf_courses').select('id', { count: 'exact', head: true }).not('opengolf_id', 'is', null),
    ]);
    return { meta: (meta.data ?? []).map(m => `${m.key}@${m.updated_at}`).sort(), linked: linked.count };
  };
  try {
    // Inside the try: a sign-in that fails still removes the QA admin.
    await adminSignIn(adminApi, adminUser);
    await adminSignIn(ctx, adminUser);

    // The gate.
    expect((await anon.get('/api/admin/golf-card-fill')).status()).toBe(401);
    // The app session never grants admin (B3, Oct 19 2026): a signed-in athlete has no console cookie.
    expect((await qa.get('/api/admin/golf-card-fill')).status()).toBe(401);
    expect((await qa.post('/api/admin/golf-card-fill', { data: { phase: 'link', dryRun: false } })).status()).toBe(401);
    expect((await adminApi.post('/api/admin/golf-card-fill', { data: { phase: 'everything' } })).status()).toBe(400);

    // Progress: the numbers the panel shows, never cached.
    const progress = await adminApi.get('/api/admin/golf-card-fill');
    expect(progress.ok(), await readErrorBody(progress)).toBe(true);
    expect(progress.headers()['cache-control']).toContain('no-store');
    const p = await progress.json();
    for (const k of ['courses', 'withCard', 'linked', 'filled', 'waiting', 'refused']) expect(typeof p[k], k).toBe('number');
    expect(p.withCard).toBeLessThanOrEqual(p.courses);
    expect(p.filled).toBeLessThanOrEqual(p.withCard);

    // A step with no dryRun field is a dry run; neither step writes.
    const before = await written();
    const link = await adminApi.post('/api/admin/golf-card-fill', { data: { phase: 'link' }, timeout: 90_000 });
    expect(link.ok(), await readErrorBody(link)).toBe(true);
    const linkBody = await link.json();
    expect(linkBody).toMatchObject({ phase: 'link', dryRun: true, linked: 0 });
    expect(linkBody.dataset, 'the published file was read').toBeGreaterThan(1000);
    expect(linkBody.matched).toBeLessThanOrEqual(linkBody.ours);

    const cards = await adminApi.post('/api/admin/golf-card-fill', { data: { phase: 'cards', rows: 3 } });
    expect(cards.ok(), await readErrorBody(cards)).toBe(true);
    const cardsBody = await cards.json();
    expect(cardsBody).toMatchObject({ phase: 'cards', dryRun: true, outcomes: {} });
    expect(cardsBody.due).toBeLessThanOrEqual(3);
    // On a target where the cron tick runs (production) the link's own record
    // never moves within a day and the linked count never moves in a dry run.
    expect(await written()).toEqual(before);

    // The panel.
    const page = await ctx.newPage();
    await page.goto('/admin');
    const panel = page.locator('[data-admin-golf-card-fill]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-card-fill-with-card]')).toContainText(' of ', { timeout: 20_000 });
    await expect(panel.locator('[data-card-fill-linked]')).toBeVisible();
    await expect(panel.locator('[data-card-fill-filled]')).toContainText('waiting');
    await expect(panel.locator('[data-card-fill-refused]')).toContainText('refused');
    await panel.locator('[data-card-fill-cards-dry]').click();
    await expect(panel.locator('[data-card-fill-outcome]')).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('[data-card-fill-outcome]')).not.toContainText('Failed');
    // Phone width: the panel and its four buttons stay inside the screen.
    await page.setViewportSize({ width: 375, height: 812 });
    await panel.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    for (const b of ['link-dry', 'link', 'cards-dry', 'cards']) {
      const bb = await panel.locator(`[data-card-fill-${b}]`).boundingBox();
      expect(bb!.x + bb!.width, `${b} button inside the screen`).toBeLessThanOrEqual(375);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 375 px').toBe(true);
  } finally {
    await cleanup('admin-golf-card-fill', [
      () => deleteQaUser(adminUser.id),
      () => ctx.close(),
      () => adminApi.dispose(),
      () => anon.dispose(),
      () => qa.dispose(),
    ]);
  }
});
