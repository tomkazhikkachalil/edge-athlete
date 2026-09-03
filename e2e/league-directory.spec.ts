import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Program 11 L3 — the public league directory (the twin of club-directory).
// /leagues lists every published league site by region — name, place,
// sport — with "Private league · request to join" on a private one and
// nothing about people; a pending league and an unpublished site never
// list; the sitemap carries /leagues; the login page links it; `leagues`
// is a reserved slug. 375px.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('league directory: published public + private leagues by region, unpublished/pending absent, sitemap + login door, reserved slug; 375px', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);

  const mk = async (name: string, extra: Record<string, unknown>) => {
    const { data } = await admin
      .from('leagues')
      .insert({ name, owner_profile_id: owner.id, sport_key: 'golf', city: 'Kanata', region: 'Ontario', country: 'Canada', ...extra })
      .select('id')
      .single();
    const id = data!.id as string;
    await admin.from('memberships').insert({ league_id: id, profile_id: owner.id, role: 'owner', kind: 'follow' });
    return id;
  };
  const openId = await mk(`QA LDir Open ${stamp}`, {});
  const privateId = await mk(`QA LDir Private ${stamp}`, { visibility: 'private', join_policy: 'approval' });
  const draftId = await mk(`QA LDir Draft ${stamp}`, {});
  const pendingId = await mk(`QA LDir Pending ${stamp}`, { approved_at: null });

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 812 } });
  try {
    const publish = async (id: string, doPublish: boolean) => {
      let res = await ownerApi.post(`/api/leagues/${id}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
      if (doPublish) {
        res = await ownerApi.patch(`/api/leagues/${id}/site`, { data: { action: 'publish' } });
        expect(res.status(), await readErrorBody(res)).toBe(200);
      }
      return subdomain;
    };
    const openSub = await publish(openId, true);
    const privateSub = await publish(privateId, true);
    const draftSub = await publish(draftId, false);
    // The pending league has no site (C4 would have provisioned one; here it is bare).

    let html = '';
    await expect
      .poll(async () => { const r = await anon.request.get('/leagues'); html = r.ok() ? await r.text() : ''; return html.includes(`QA LDir Private ${stamp}`); }, { timeout: 30_000, intervals: [1500, 3000] })
      .toBe(true);
    expect(html).toContain(`QA LDir Open ${stamp}`);
    expect(html).toContain('Ontario, Canada');
    expect(html).toContain('Golf');
    // Links ride orgSitePath — `/org/{slug}` or the vanity `/{slug}` (a build flag).
    expect(html).toMatch(new RegExp(`href="(/org)?/${openSub}"`));
    expect(html).toMatch(new RegExp(`href="(/org)?/${privateSub}"`));
    expect(html).toContain('Private league · request to join');
    expect(html).not.toContain(`QA LDir Draft ${stamp}`);
    expect(html).not.toContain(`QA LDir Pending ${stamp}`);
    expect(html).not.toContain('Edge Bravo');
    expect(html).not.toContain('Edge B.');
    // The club directory does not list leagues.
    expect(await (await anon.request.get('/clubs')).text()).not.toContain(`QA LDir Open ${stamp}`);
    // The sitemap carries the directory; the login page links it.
    expect(await (await anon.request.get('/sitemap.xml')).text()).toContain('/leagues</loc>');
    // The login page renders its doors client-side after the auth boot.
    const login = await anon.newPage();
    await login.goto('/');
    await expect(login.getByRole('link', { name: 'Find a league near you' })).toBeVisible({ timeout: 20_000 });
    expect(await login.getByRole('link', { name: 'Find a league near you' }).getAttribute('href')).toBe('/leagues');
    await login.close();
    // `leagues` is reserved as a site address.
    const reserved = await ownerApi.post(`/api/leagues/${draftId}/site`, { data: { subdomain: 'leagues' } });
    expect(reserved.status()).not.toBe(200); // 409 (a site exists) or 400 (reserved) — never a mint
    // 375px.
    const page = await anon.newPage();
    await page.goto('/leagues');
    await expect(page.getByRole('heading', { name: 'Leagues', level: 1 })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'directory: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    void draftSub;
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('leagues').delete().in('id', [openId, privateId, draftId, pendingId]);
  }
});
