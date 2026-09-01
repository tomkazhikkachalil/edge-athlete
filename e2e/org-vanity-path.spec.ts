import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The vanity root tree (phase 6 R1): edgeathlete/{slug} serves the same
// org site as /org/{slug} through the delegating [slug] layout. The flag
// (NEXT_PUBLIC_VANITY_ORG_PATHS, build-injected) gates the tree; on a
// flag-off target the vanity URL 404s while /org works — that skew is the
// target-aware probe (the registration-flag precedent).

test('vanity path: /{slug} serves the site; unknown slug gets the linked 404; reserved roots untouched', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('org_sites').select('id').limit(1);
  test.skip(!!probe.error, `org_sites missing — run migration 155 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Vanity League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id, city: 'Kanata' })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);
    const ownerApi = await apiAs('state-b.json');
    let subdomain = '';
    try {
      // The slug engine: suggestions must be identity-composed and the
      // policy must refuse a bare generic word.
      let res = await ownerApi.get(`/api/leagues/${leagueId}/site/slug-options?candidate=hockey`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const options = await res.json();
      expect(Array.isArray(options.suggestions)).toBe(true);
      expect(options.candidate?.verdict).toBe('refused');

      // Create with a chosen policy-ok slug, then publish.
      const chosen = `kanata-vanity-${stamp}`.slice(0, 63);
      res = await ownerApi.post(`/api/leagues/${leagueId}/site`, {
        data: { subdomain: chosen },
      });
      // The chosen slug carries only 'kanata' from the identity → the
      // policy flags it but allows it; 'vanity-<stamp>' keeps it unique.
      expect(res.status(), await readErrorBody(res)).toBe(200);
      subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
      expect(subdomain).toBe(chosen);

      // A refused slug never creates (fresh org would be needed for a
      // real second create — assert on the 409-or-400 shape instead):
      res = await ownerApi.post(`/api/leagues/${leagueId}/site`, {
        data: { subdomain: 'hockey' },
      });
      expect([400, 409]).toContain(res.status()); // existing site → 409 wins

      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'publish' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // /org twin serves (control), then the target-aware vanity probe.
      const orgRes = await request.get(`/org/${subdomain}`);
      expect(orgRes.status()).toBe(200);
      const vanityRes = await request.get(`/${subdomain}`);
      test.skip(
        vanityRes.status() === 404,
        'NEXT_PUBLIC_VANITY_ORG_PATHS off on this target — vanity tree inert'
      );
      expect(vanityRes.status()).toBe(200);
      expect(await vanityRes.text()).toContain(name);

      // Subpage twin rides the same tree.
      const schedRes = await request.get(`/${subdomain}/schedule`);
      expect([200, 404]).toContain(schedRes.status()); // 404 only if module disabled
      // The OG card twin streams bytes.
      const cardRes = await request.get(`/${subdomain}/card.png`);
      expect(cardRes.status()).toBe(200);
      expect(cardRes.headers()['content-type']).toContain('image');

      // Reserved root: /feed still renders the APP (never the org 404).
      const feedRes = await request.get('/feed');
      expect(feedRes.status()).toBe(200);
      expect(await feedRes.text()).not.toContain('There’s nothing at this address');
    } finally {
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

test('vanity 404: unknown root path renders the linked (public) not-found @mobile', async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const junk = `zz-no-such-org-${Date.now()}`;
  const res = await request.get(`/${junk}`);
  expect(res.status()).toBe(404);

  const anonCtx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await anonCtx.newPage();
    await page.goto(`/${junk}`);
    // Whether the (public) or (app) not-found catches it (flag on/off),
    // the page must never be a dead end — the navigation charter.
    await expect(page.getByRole('link').first()).toBeVisible({ timeout: 15_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewport = page.viewportSize();
    if (viewport) {
      expect(scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(viewport.width);
    }
  } finally {
    await anonCtx.close();
  }
});
