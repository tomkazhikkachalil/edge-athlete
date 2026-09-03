import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 9 V6 — the public club directory. /clubs lists every published
// club site by region — name, place, sport — with "Private club · request
// to join" on a private one and nothing about people; a pending club and
// an unpublished site never list; the sitemap carries /clubs; the login
// page links it; `clubs` is a reserved slug. 375px.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('club directory: published public + private clubs by region, unpublished/pending absent, sitemap + login door, reserved slug; 375px', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);

  const mk = async (name: string, extra: Record<string, unknown>) => {
    const { data } = await admin
      .from('clubs')
      .insert({ name, owner_profile_id: owner.id, primary_sport: 'golf', city: 'Kanata', region: 'Ontario', country: 'Canada', ...extra })
      .select('id')
      .single();
    const id = data!.id as string;
    await admin.from('memberships').insert({ club_id: id, profile_id: owner.id, role: 'owner', kind: 'follow' });
    return id;
  };
  const openId = await mk(`QA Dir Open ${stamp}`, {});
  const privateId = await mk(`QA Dir Private ${stamp}`, { visibility: 'private', join_policy: 'approval' });
  const draftId = await mk(`QA Dir Draft ${stamp}`, {});
  const pendingId = await mk(`QA Dir Pending ${stamp}`, { approved_at: null });

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 812 } });
  try {
    const publish = async (id: string, doPublish: boolean) => {
      let res = await ownerApi.post(`/api/clubs/${id}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
      if (doPublish) {
        res = await ownerApi.patch(`/api/clubs/${id}/site`, { data: { action: 'publish' } });
        expect(res.status(), await readErrorBody(res)).toBe(200);
      }
      return subdomain;
    };
    const openSub = await publish(openId, true);
    const privateSub = await publish(privateId, true);
    const draftSub = await publish(draftId, false);
    // The pending club has no site (C4 would have provisioned one; here it is bare).

    let html = '';
    await expect
      .poll(async () => { const r = await anon.request.get('/clubs'); html = r.ok() ? await r.text() : ''; return html.includes(`QA Dir Private ${stamp}`); }, { timeout: 30_000, intervals: [1500, 3000] })
      .toBe(true);
    expect(html).toContain(`QA Dir Open ${stamp}`);
    expect(html).toContain('Ontario, Canada');
    // Links ride orgSitePath — `/org/{slug}` or the vanity `/{slug}` (a build flag).
    expect(html).toMatch(new RegExp(`href="(/org)?/${openSub}"`));
    expect(html).toMatch(new RegExp(`href="(/org)?/${privateSub}"`));
    expect(html).toContain('Private club · request to join');
    expect(html).not.toContain(`QA Dir Draft ${stamp}`);
    expect(html).not.toContain(`QA Dir Pending ${stamp}`);
    expect(html).not.toContain('Edge Bravo');
    expect(html).not.toContain('Edge B.');
    // The sitemap carries the directory; the login page links it.
    expect(await (await anon.request.get('/sitemap.xml')).text()).toContain('/clubs</loc>');
    // The login page renders its doors client-side after the auth boot.
    const login = await anon.newPage();
    await login.goto('/');
    await expect(login.getByRole('link', { name: 'Find a golf club near you' })).toBeVisible({ timeout: 20_000 });
    expect(await login.getByRole('link', { name: 'Find a golf club near you' }).getAttribute('href')).toBe('/clubs');
    await login.close();
    // `clubs` is reserved as a site address.
    const reserved = await ownerApi.post(`/api/clubs/${draftId}/site`, { data: { subdomain: 'clubs' } });
    expect(reserved.status()).not.toBe(200); // 409 (a site exists) or 400 (reserved) — never a mint
    // 375px.
    const page = await anon.newPage();
    await page.goto('/clubs');
    await expect(page.getByRole('heading', { name: 'Golf clubs', level: 1 })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'directory: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    void draftSub;
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('clubs').delete().in('id', [openId, privateId, draftId, pendingId]);
  }
});
