import { test, expect } from '@playwright/test';
import { adminClient, apiAs, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Recruiting skeleton R4 — "Find athletes". Scout-only by construction: an
// athlete's session gets 403 from the route and the not-for-you screen on
// the page (both work on any database). Post-182 a scout finds an OPEN,
// public athlete by name / sport / grad year, a closed one never appears,
// and the row carries the Shortlist toggle. @mobile: the chip scroller.

test('scout search: athletes are refused; a scout finds open athletes by name and grad year, never closed ones @mobile', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const alphaApi = await apiAs('state.json');

  // Fail-closed on every database: an athlete's session is refused.
  try {
    expect((await alphaApi.get('/api/scout/search?q=x')).status()).toBe(403);
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctx.newPage();
      await page.goto('/app/scout/search');
      await expect(page.locator('[data-scout-gate="not-scout"]')).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx.close();
    }
  } finally {
    await alphaApi.dispose();
  }

  const probe = await admin.from('profiles').select('scout_affiliation').limit(1);
  test.skip(!!probe.error, `profiles.scout_affiliation missing — run migration 182 (${probe.error?.message})`);

  const api = await apiAs('state.json');
  const { data: prior } = await admin.from('profiles').select('visibility, class_year').eq('id', alpha.id).single();
  const rand = Math.random().toString(36).slice(2, 10);
  const scoutEmail = `edgeqa-scout-${rand}@example.com`;
  const scoutPassword = `Qa!${Math.random().toString(36).slice(2, 12)}9`;
  let scoutId: string | null = null;
  try {
    let res = await request.post('/api/signup', { data: { email: scoutEmail, password: scoutPassword, actorRole: 'scout', profileData: { first_name: 'Sam', last_name: 'Scout' } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await resetRateBucket(admin, 'signup', '');
    scoutId = ((await admin.from('profiles').select('id').eq('email', scoutEmail).single()).data!.id as string);
    const scoutState = await mintStorageState({ id: scoutId, email: scoutEmail, password: scoutPassword });
    const scoutCtx = await browser.newContext({ storageState: scoutState });
    try {
      // Alpha: open + public + grad 2027. Bravo: closed (never appears).
      await admin.from('profiles').update({ visibility: 'public', class_year: 2027 }).eq('id', alpha.id);
      res = await api.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'open', school: 'QA High' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      const hit = (await (await scoutCtx.request.get('/api/scout/search?q=Edge&gradFrom=2027&gradTo=2027')).json()) as { supported: boolean; athletes: { id: string }[] };
      expect(hit.supported).toBe(true);
      expect(hit.athletes.map(a => a.id)).toContain(alpha.id);
      expect(hit.athletes.map(a => a.id)).not.toContain(bravo.id);
      const miss = (await (await scoutCtx.request.get('/api/scout/search?gradFrom=2030')).json()) as { athletes: { id: string }[] };
      expect(miss.athletes.map(a => a.id)).not.toContain(alpha.id);

      const page = await scoutCtx.newPage();
      await page.goto('/app/scout/search');
      await expect(page.locator('[data-scout-search]')).toBeVisible({ timeout: 20_000 });
      await page.locator('#scout-q').fill('Edge');
      await expect(page.locator(`a[href="/athlete/${alpha.id}"]`)).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-shortlist-button]').first()).toBeVisible();
      const width = page.viewportSize()?.width ?? 1280;
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(width);
    } finally {
      await scoutCtx.close();
    }
  } finally {
    await api.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'closed', school: '' } }).catch(() => {});
    await admin.from('profiles').update({ visibility: prior!.visibility as string, class_year: (prior!.class_year as number | null) ?? null }).eq('id', alpha.id);
    if (scoutId) await deleteQaUser(scoutId).catch(() => {});
    await api.dispose();
  }
});
