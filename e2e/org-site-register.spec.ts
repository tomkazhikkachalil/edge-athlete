import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The public Register card (phase 5 R5, mig 164): a card, not a subpage —
// open windows + a static link into the app wizard, viewer-independent.
// Window open/close purges the site tag, so the anonymous ISR document
// follows the registrar's controls.
test('org-site register card: open window renders the CTA; closed hides it', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('registration_windows').select('id').limit(1);
  test.skip(!!probe.error, `registration_windows missing — run migration 162 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA RegCard League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27', starts_on: '2026-09-01' })
      .select()
      .single();

    const ownerApi = await apiAs('state-b.json');
    let subdomain = '';
    try {
      let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const site = (await res.json()).site as { id: string; subdomain: string };
      subdomain = site.subdomain;

      // Skip cleanly pre-164: the register module row won't exist.
      const { data: registerRow } = await admin
        .from('org_site_modules')
        .select('id, enabled')
        .eq('site_id', site.id)
        .eq('module_key', 'register')
        .maybeSingle();
      test.skip(!registerRow, 'register module row missing — run migration 164');

      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_module', moduleKey: 'register', enabled: true },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'publish' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // Closed by default: the section says so, no CTA link.
      const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const page = await anonCtx.newPage();
        await page.goto(`/org/${subdomain}`);
        const section = page.getByRole('region', { name: 'Register' });
        await expect(section.getByText('Registration is currently closed.')).toBeVisible({
          timeout: 20_000,
        });

        // Open a window → the purge lands → the CTA renders.
        const win = await ownerApi.post(`/api/leagues/${leagueId}/registration-windows`, {
          data: { seasonId: season!.id, opensAt: new Date(Date.now() - 60_000).toISOString() },
        });
        expect(win.status(), await readErrorBody(win)).toBe(200);
        const windowId = ((await win.json()).window as { id: string }).id;

        await page.goto(`/org/${subdomain}`);
        await expect(section.getByText('2026-27')).toBeVisible({ timeout: 20_000 });
        const cta = section.getByRole('link', { name: 'Register' });
        await expect(cta).toBeVisible();
        expect(await cta.getAttribute('href')).toContain(`/register/league/${leagueId}`);

        // 375px parity.
        await page.setViewportSize({ width: 375, height: 812 });
        await expect(cta).toBeVisible();
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

        // Close → purge → closed again.
        const closed = await ownerApi.delete(
          `/api/leagues/${leagueId}/registration-windows?windowId=${windowId}`
        );
        expect(closed.status(), await readErrorBody(closed)).toBe(200);
        await page.goto(`/org/${subdomain}`);
        await expect(section.getByText('Registration is currently closed.')).toBeVisible({
          timeout: 20_000,
        });
      } finally {
        await anonCtx.close();
      }
    } finally {
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
