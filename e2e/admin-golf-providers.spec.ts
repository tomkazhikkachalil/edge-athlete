import { test, expect, request as pwRequest } from './helpers/test';
import { adminSignIn } from './helpers/admin';
import { cleanup } from './helpers/cleanup';
import { adminEmailForE2E, apiAs, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, E2E_BASE_URL } from './helpers/qa-user';

// The golf providers readout (Nov 20 2026): each provider's calls in its
// current 24-hour window against the daily limit, and the hosts the answering
// server instance is skipping. Read-only, so the spec is safe on production:
// the gate (anonymous 401, a signed-in athlete 401 since the console has its
// own sign-in), the answer's shape, and the dashboard panel at desktop and
// phone width. Skips without E2E_ADMIN_EMAIL.
const adminEmail = adminEmailForE2E();

test('admin: the golf providers readout answers each limit and the panel renders', async ({ browser }) => {
  test.skip(!adminEmail, 'E2E_ADMIN_EMAIL unset — set it to an address in the target build\'s ADMIN_EMAILS');
  test.setTimeout(120_000);
  const qa = await apiAs('state.json');
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const adminUser = await createQaUser({ email: adminEmail!, displayName: 'Edge QA Admin', firstName: 'Edge', lastName: 'Admin' });
  const adminApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(adminUser), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: await mintStorageState(adminUser) });
  try {
    await adminSignIn(adminApi, adminUser);
    await adminSignIn(ctx, adminUser);

    // The gate.
    expect((await anon.get('/api/admin/golf-providers')).status()).toBe(401);
    expect((await qa.get('/api/admin/golf-providers')).status()).toBe(401);

    // The answer: never cached, one row per provider, numbers that agree with themselves.
    const res = await adminApi.get('/api/admin/golf-providers');
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect(res.headers()['cache-control']).toContain('no-store');
    const body = await res.json() as { providers: Array<{ source: string; limit: number; used: number; refused: number; resetsAt: string | null; state: string }>; skipped: Array<{ host: string; until: string }> };
    const sources = body.providers.map(p => p.source);
    for (const s of ['golfcourseapi', 'opengolfapi', 'card-fill', 'site-card']) expect(sources, s).toContain(s);
    for (const p of body.providers) {
      expect(p.limit, p.source).toBeGreaterThan(0);
      expect(p.used, p.source).toBeGreaterThanOrEqual(0);
      expect(p.used, p.source).toBeLessThanOrEqual(p.limit);
      expect(['idle', 'open', 'reached'], p.source).toContain(p.state);
      expect(p.state === 'idle' ? p.resetsAt === null : typeof p.resetsAt === 'string', `${p.source} window`).toBe(true);
    }
    expect(Array.isArray(body.skipped)).toBe(true);

    // The panel.
    const page = await ctx.newPage();
    await page.goto('/admin');
    const panel = page.locator('[data-admin-golf-providers]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const row = panel.locator('[data-provider-row="golfcourseapi"]');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('[data-provider-used]')).toContainText(' of ');
    await expect(panel.locator('[data-provider-skipped]')).toBeVisible();
    expect(await panel.locator('[data-provider-row]').count()).toBe(body.providers.length);
    // Phone width: the panel and every row stay inside the screen.
    await page.setViewportSize({ width: 375, height: 812 });
    await panel.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    for (const r of await panel.locator('[data-provider-row]').all()) {
      const rb = await r.boundingBox();
      expect(rb!.x + rb!.width, `${await r.getAttribute('data-provider-row')} row inside the screen`).toBeLessThanOrEqual(375);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 375 px').toBe(true);
  } finally {
    await cleanup('admin-golf-providers', [
      () => deleteQaUser(adminUser.id),
      () => ctx.close(),
      () => adminApi.dispose(),
      () => anon.dispose(),
      () => qa.dispose(),
    ]);
  }
});
