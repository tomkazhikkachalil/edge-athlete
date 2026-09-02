import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Builder depth, part 2 (phase 6b B2): the second template. 'bold' = a
// strong-accent band header with the nav inside, a full-bleed hero, a
// two-column section grid, tile teams. The DB only admits the id (170);
// pre-170 the switch answers a friendly 409 and this spec self-skips.

async function settleBody(
  request: { get: (u: string) => Promise<{ text: () => Promise<string> }> },
  url: string,
  needle: string,
  shouldContain = true,
  attempts = 8
): Promise<string> {
  let body = '';
  for (let i = 0; i < attempts; i++) {
    body = await (await request.get(url)).text();
    if (body.includes(needle) === shouldContain) return body;
    await new Promise(r => setTimeout(r, 2500));
  }
  return body;
}

test('org site template: bold → band header + grid + tiles; classic restores; both at 375px; console picker', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);

  const stamp = Date.now();
  const name = `QA Template League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert({ league_id: leagueId, profile_id: owner.id, role: 'owner' });
  // A team so the tile grid has something to render.
  await admin.from('teams').insert({ league_id: leagueId, name: `QA Tigers ${stamp}` });

  const ownerApi = await apiAs('state-b.json');
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;

    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
      data: { action: 'set_template', templateId: 'bold' },
    });
    test.skip(res.status() === 409, 'template CHECK not widened — run migration 170');
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(
      (await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_template', templateId: 'brutalist' },
      })).status()
    ).toBe(400);

    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const canonicalProbe = await anonCtx.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const sitePath = canonicalProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

      const bold = await settleBody(anonCtx.request, sitePath, 'data-template="bold"', true, 12);
      expect(bold).toContain('data-template="bold"');
      // Band header: strong accent background on the header, white nav.
      expect(bold).toContain('background-color:var(--org-accent-strong)');
      expect(bold).toContain('text-white/90');
      // Grid sections + full-bleed hero + tile teams.
      expect(bold).toContain('sm:grid-cols-2');
      expect(bold).toContain('sm:col-span-2');
      expect(bold).toContain('sm:text-5xl');
      expect(bold).toContain(`QA Tigers ${stamp}`);
      expect(bold).toContain('grid-cols-2 sm:grid-cols-3');
      // Subpages still render under the band.
      const teams = await anonCtx.request.get(`${sitePath}/teams`);
      expect(teams.status()).toBe(200);

      const page = await anonCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(sitePath);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 15_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        'bold: no horizontal overflow at 375px'
      ).toBeLessThanOrEqual(375);

      // Back to classic: the shipped markup returns.
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_template', templateId: 'classic' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const classic = await settleBody(anonCtx.request, sitePath, 'data-template="classic"', true, 12);
      expect(classic).not.toContain('sm:grid-cols-2');
      expect(classic).toContain('rounded-xl px-6 py-10 text-white');
      await page.goto(sitePath);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 15_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        'classic: no horizontal overflow at 375px'
      ).toBeLessThanOrEqual(375);
    } finally {
      await anonCtx.close();
    }

    // Console: the picker shows both templates, classic selected.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByLabel('Bold template')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel('Classic template')).toBeChecked();
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('teams').delete().eq('league_id', leagueId);
    await admin.from('memberships').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
