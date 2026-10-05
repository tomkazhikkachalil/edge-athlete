import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaUser, deleteQaUser, loadQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';

// Recruiting skeleton R3 — the shortlist. A scout adds an OPEN athlete (the
// POST re-checks isRecruitable), writes a private note, and sees the row on
// /app/scout; the athlete sees a COUNT only; a non-scout cannot use the
// routes; a closed athlete cannot be added; removal clears it. The button
// lives in Scout search (the profile has no recruiting surface since Oct 4
// 2026); the athlete reads the count in Settings → Recruiting. Self-skips
// pre-183 (and pre-182: the scout account needs the CHECK). @mobile.

test('scout shortlist: add an open athlete, note, count on the athlete side, gates, remove @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const probe = await admin.from('scout_shortlists').select('athlete_id').limit(1);
  test.skip(!!probe.error, `scout_shortlists missing — run migration 183 (${probe.error?.message})`);

  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  const priorVisibility = prior!.visibility as string;
  let scoutId: string | null = null;
  try {
    // A scout account and an open, public athlete (alpha). The scout is
    // MINTED through the admin API and stamped `user_type 'scout'` — the
    // signup route's scout branch has its own spec (scout-signup), and
    // Supabase Auth refuses `@example.com` sign-ups since Oct 2026
    // ("Example and test domains are currently not supported"), which the
    // admin create-user path does not.
    const scout = await createQaUser({ firstName: 'Sam', lastName: 'Scout', displayName: 'Sam Scout' });
    scoutId = scout.id;
    const stamped = await admin.from('profiles').update({ user_type: 'scout' }).eq('id', scout.id);
    expect(stamped.error, stamped.error?.message).toBeNull();
    const scoutApi = await (await browser.newContext({ storageState: await mintStorageState(scout) })).request;
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    let res = await alphaApi.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'open', school: 'QA High' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Gates: a non-scout cannot use the routes; a scout cannot add a CLOSED athlete (bravo, private).
    expect((await alphaApi.get('/api/scout/shortlist')).status()).toBe(403);
    expect((await alphaApi.post('/api/scout/shortlist', { data: { athleteId: bravo.id } })).status()).toBe(403);
    res = await scoutApi.post('/api/scout/shortlist', { data: { athleteId: bravo.id } });
    expect(res.status()).toBe(403);
    expect(await res.text()).toContain('not open');
    expect((await scoutApi.post('/api/scout/shortlist', { data: { athleteId: 'nope' } })).status()).toBe(400);

    // Add alpha, note it, list it; alpha sees the count only.
    res = await scoutApi.post('/api/scout/shortlist', { data: { athleteId: alpha.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await scoutApi.patch(`/api/scout/shortlist/${alpha.id}`, { data: { note: '  Strong left side  ' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).note).toBe('Strong left side');
    res = await scoutApi.get('/api/scout/shortlist');
    const list = (await res.json()) as { supported: boolean; items: { athleteId: string; note: string | null; school: string | null }[] };
    expect(list.supported).toBe(true);
    expect(list.items.map(i => i.athleteId)).toEqual([alpha.id]);
    expect(list.items[0]).toMatchObject({ note: 'Strong left side', school: 'QA High' });
    res = await alphaApi.get(`/api/profile/${alpha.id}/recruiting`);
    expect((await res.json()).shortlistedBy).toBe(1);
    expect(JSON.stringify(await (await alphaApi.get(`/api/profile/${alpha.id}/recruiting`)).json())).not.toContain(scoutId);

    // The scout's surfaces (Oct 4 2026: no card on the profile — the button
    // lives in Scout search): the row's button reads "Shortlisted"; /app/scout
    // lists the row (phone width on the mobile projects).
    const scoutCtx = await browser.newContext({ storageState: await mintStorageState(scout) });
    try {
      const page = await scoutCtx.newPage();
      await page.goto('/app/scout/search');
      await page.locator('#scout-q').fill('Edge');
      const row = page.locator('[data-scout-results] li').filter({ has: page.getByRole('link', { name: /Edge/ }) }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      const button = row.locator('[data-shortlist-button]');
      await expect(button).toBeVisible({ timeout: 20_000 });
      await expect(button).toHaveText(/Shortlisted/);
      await button.click();
      await expect(button).toHaveText(/^\s*Shortlist\s*$/, { timeout: 10_000 });
      await button.click();
      await expect(button).toHaveText(/Shortlisted/, { timeout: 10_000 });
      await page.goto('/app/scout');
      await expect(page.locator('[data-scout-home]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('link', { name: /Edge Alpha|Edge/ }).first()).toBeVisible();
      const width = page.viewportSize()?.width ?? 1280;
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(width);
    } finally {
      await scoutCtx.close();
    }

    // Alpha reads the count in Settings → Recruiting (the profile shows
    // nothing); the athlete never sees a Shortlist button.
    const alphaCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await alphaCtx.newPage();
      await page.goto('/settings?tab=recruiting');
      await expect(page.locator('[data-shortlisted-by="1"]')).toBeVisible({ timeout: 20_000 });
      expect(await page.locator('[data-shortlist-button]').count()).toBe(0);
      await page.goto('/athlete');
      await expect(page.locator('[aria-label="Profile sections"]').first()).toBeVisible({ timeout: 20_000 });
      expect(await page.locator('[data-recruiting-card]').count()).toBe(0);
    } finally {
      await alphaCtx.close();
    }

    // Remove; the count drops.
    res = await scoutApi.delete(`/api/scout/shortlist/${alpha.id}`);
    expect(res.status()).toBe(200);
    expect(((await (await scoutApi.get('/api/scout/shortlist')).json()).items as unknown[]).length).toBe(0);
    expect((await (await alphaApi.get(`/api/profile/${alpha.id}/recruiting`)).json()).shortlistedBy).toBe(0);
  } finally {
    await alphaApi.patch(`/api/profile/${alpha.id}/recruiting`, { data: { status: 'closed', school: '' } }).catch(() => {});
    await admin.from('profiles').update({ visibility: priorVisibility }).eq('id', alpha.id);
    if (scoutId) await deleteQaUser(scoutId).catch(() => {});
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});
