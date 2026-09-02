import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Builder depth, part 1 (phase 6b B1): the brand token set beyond the
// accent (strong accent, surface tint, typeface stack, wordmark), the
// generated per-site favicon, and nav_config coming alive (labels +
// display order mirrored into sort_order). All zero-DDL; everything is
// asserted on the raw ISR document.

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

test('org site brand: tokens → document attrs + wordmark; favicon.svg; nav labels + order; reset; 375px console', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);

  const stamp = Date.now();
  const name = `QA Brand League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert({ league_id: leagueId, profile_id: owner.id, role: 'owner' });

  const ownerApi = await apiAs('state-b.json');
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    const subdomain = site.subdomain;

    // The full token set; a too-light strong accent is refused like the accent.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
      data: { action: 'set_theme', accent: '#0f766e', accentStrong: '#ffffff' },
    });
    expect(res.status()).toBe(400);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
      data: {
        action: 'set_theme',
        accent: '#0f766e',
        accentStrong: '#0b3d91',
        surface: 'tinted',
        typeface: 'serif',
        wordmark: `Brand ${stamp}`,
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Labels + order: schedule first, standings renamed "Tables".
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
      data: {
        action: 'set_nav',
        items: [{ key: 'schedule', label: 'Games' }, { key: 'standings', label: 'Tables' }, { key: 'teams' }],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: rows } = await admin
      .from('org_site_modules')
      .select('module_key, sort_order')
      .eq('site_id', site.id)
      .in('module_key', ['schedule', 'standings', 'teams']);
    const order = new Map((rows ?? []).map(r => [r.module_key as string, r.sort_order as number]));
    expect(order.get('schedule')).toBe(1);
    expect(order.get('standings')).toBe(2);
    expect(order.get('teams')).toBe(3);

    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const canonicalProbe = await anonCtx.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const sitePath = canonicalProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

      const html = await settleBody(anonCtx.request, sitePath, `Brand ${stamp}`, true, 12);
      // Tokens reach the document as re-validated attributes/vars.
      expect(html).toContain('data-typeface="serif"');
      expect(html).toContain('data-surface="tinted"');
      expect(html).toContain('--org-accent-strong:#0b3d91');
      // The wordmark replaces the org name in the shell, never in <title>.
      expect(html).toContain(`Brand ${stamp}`);
      expect(html).toMatch(new RegExp(`<title>${name}[^<]*</title>`));
      // Labels on nav + section headings; order = schedule before standings.
      expect(html).toContain('>Games<');
      expect(html).toContain('>Tables<');
      expect(html.indexOf('aria-label="Games"')).toBeLessThan(html.indexOf('aria-label="Tables"'));
      // The generated favicon is advertised (no logo uploaded) and serves.
      expect(html).toContain(`${sitePath}/favicon.svg`);
      const icon = await anonCtx.request.get(`${sitePath}/favicon.svg`);
      expect(icon.status()).toBe(200);
      expect(icon.headers()['content-type']).toContain('image/svg+xml');
      const svg = await icon.text();
      expect(svg).toContain('#0f766e');
      expect(svg).toContain('>B<');

      // Reset clears every token; the document returns to the defaults.
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_theme', accent: null },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const plain = await settleBody(anonCtx.request, sitePath, 'data-typeface="sans"', true, 12);
      expect(plain).toContain('data-surface="plain"');
      expect(plain).not.toContain(`Brand ${stamp}`);
    } finally {
      await anonCtx.close();
    }

    // Console: the brand form + the reorderable Sections list at 375px.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('button', { name: 'Save brand' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel('Wordmark')).toBeVisible();
      await expect(page.getByLabel('Standings section label')).toHaveValue('Tables');
      await expect(page.getByRole('button', { name: 'Save layout' })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('memberships').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
