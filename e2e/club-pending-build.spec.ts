import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';
import { GOLF_MODULE_ORDER } from '../src/lib/org-sites/validate';

// Onboarding v2 R1 (179): LIVE BY LINK. A club request provisions the club
// (listing_status 'pending', approved_at NULL), its owner row and a DRAFT
// site — and the club WORKS from that moment: outsiders read it (API +
// page), the join door joins, standings keep their shape, publish is 200.
// What "pending" withholds is DISCOVERABILITY only: the /clubs directory,
// the sitemap, search, the robots index (noindex meta, a disallowing
// per-site robots.txt, an empty per-site sitemap). Approval (flipped
// through the service role — no spec drives /api/admin/*) LISTS the club:
// indexed, in the directory, in search. Was (phase 7 C4): outsiders 404,
// publish 409, a pending org hidden everywhere.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('live by link: provisioned pending → readable, joinable, publishable, NOT listed/indexed → approval lists it; 375px console', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const joiner = loadQaUser('user.json');

  const probe = await admin.from('clubs').select('listing_status').limit(1);
  test.skip(!!probe.error, `clubs.listing_status missing — run migration 179 (${probe.error?.message})`);

  // Leftovers from earlier runs (one pending request per user).
  const { data: stale } = await admin.from('club_requests').select('created_club_id').eq('requester_profile_id', owner.id);
  const staleIds = (stale ?? []).map(r => r.created_club_id as string | null).filter((id): id is string => !!id);
  if (staleIds.length) await admin.from('clubs').delete().in('id', staleIds);
  await admin.from('club_requests').delete().eq('requester_profile_id', owner.id);
  await resetRateBucket(admin, 'club-request', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'club-join', joiner.id);

  const clubName = `QA Link Golf Club ${stamp}`;
  const ownerApi = await apiAs('state-b.json');
  const joinerApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
  let clubId: string | null = null;
  try {
    // The request → the provisioned, PENDING-listing club.
    const requested = await ownerApi.post('/api/clubs/requests', {
      data: { name: clubName, capabilities: { operatesCompetitions: true, operatesTeams: false }, siteDraft: { sports: ['golf'] } },
    });
    expect(requested.status(), await readErrorBody(requested)).toBe(200);
    const body = (await requested.json()) as { orgId: string | null; request: { id: string; created_club_id: string | null } };
    expect(body.orgId, 'the club was provisioned').toBeTruthy();
    clubId = body.orgId!;

    const { data: club } = await admin.from('clubs').select('listing_status, approved_at, owner_profile_id').eq('id', clubId).single();
    expect(club).toMatchObject({ listing_status: 'pending', approved_at: null, owner_profile_id: owner.id });
    const { data: site } = await admin.from('org_sites').select('id, subdomain, published_at').eq('club_id', clubId).single();
    expect(site!.published_at).toBeNull();
    const { data: mods } = await admin.from('org_site_modules').select('module_key').eq('site_id', site!.id).order('sort_order');
    expect(mods!.slice(0, 3).map(m => m.module_key)).toEqual(GOLF_MODULE_ORDER.club.slice(0, 3));

    // LIVE BY LINK: outsiders read the API + page; the GET says pending.
    const anonApi = await anon.request.get(`/api/clubs/${clubId}`);
    expect(anonApi.status(), await readErrorBody(anonApi)).toBe(200);
    expect((await anonApi.json()) as { pending: boolean; listing: string }).toMatchObject({ pending: true, listing: 'pending' });
    const anonPage = await anon.newPage();
    await anonPage.goto(`/club/${clubId}`);
    await expect(anonPage.getByRole('heading', { name: clubName })).toBeVisible({ timeout: 20_000 });

    // The join door joins (open policy) — a member row exists.
    const joined = await joinerApi.post(`/api/clubs/${clubId}/members`, { data: {} });
    expect([200, 201]).toContain(joined.status());
    const { data: joinRow } = await admin.from('memberships').select('kind, role').eq('club_id', clubId).eq('profile_id', joiner.id);
    expect(joinRow?.some(r => r.kind === 'follow' && r.role === 'member')).toBe(true);

    // NOT DISCOVERABLE: search, the directory, the sitemap.
    const search = await ownerApi.get(`/api/search?q=${encodeURIComponent(clubName)}`);
    expect(search.status()).toBe(200);
    const searchBody = (await search.json()) as { results?: { clubs?: { id: string }[] }; clubs?: { id: string }[] };
    expect((searchBody.results?.clubs ?? searchBody.clubs ?? []).map(c => c.id)).not.toContain(clubId);

    // The console: chip + "Take site live" ENABLED, no overflow at 375.
    const pageB = await ownerCtx.newPage();
    await pageB.goto(`/app/org/club/${clubId}`);
    await expect(pageB.getByText('Listing under review', { exact: true })).toBeVisible({ timeout: 20_000 });
    const publishBtn = pageB.getByRole('button', { name: 'Take site live', exact: true });
    await expect(publishBtn).toBeVisible({ timeout: 20_000 });
    await expect(publishBtn).toBeEnabled();
    const scrollWidth = await pageB.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);

    // Publish is 200 while pending; the site serves by link — NOINDEX.
    const publish = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(publish.status(), await readErrorBody(publish)).toBe(200);
    let html = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${site!.subdomain}`); html = r.ok() ? await r.text() : ''; return r.status(); },
        { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(200);
    expect(html).toMatch(/<meta name="robots" content="noindex/);
    const robots = await anon.request.get(`/org/${site!.subdomain}/robots.txt`);
    expect(await robots.text()).toContain('Disallow: /');
    const siteMap = await anon.request.get(`/org/${site!.subdomain}/sitemap.xml`);
    expect(await siteMap.text()).not.toContain(`/org/${site!.subdomain}</loc>`);
    const directory = await anon.request.get('/clubs');
    expect(await directory.text()).not.toContain(clubName);

    // Approval through the service role (the admin route's stamp) LISTS it.
    await admin.from('clubs').update({ listing_status: 'listed', approved_at: new Date().toISOString() }).eq('id', clubId);
    await admin.from('club_requests').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', body.request.id);
    // The org GET is uncached; the site page is ISR — the admin route purges
    // its tag, the service-role flip here cannot, so assert the GET + search
    // (uncached) and accept either state for the cached page.
    const ownerGet = await ownerApi.get(`/api/clubs/${clubId}`);
    expect((await ownerGet.json()) as { pending: boolean; listing: string }).toMatchObject({ pending: false, listing: 'listed' });
    await expect
      .poll(async () => {
        const s = await ownerApi.get(`/api/search?q=${encodeURIComponent(clubName)}`);
        const b = (await s.json()) as { results?: { clubs?: { id: string }[] }; clubs?: { id: string }[] };
        return (b.results?.clubs ?? b.clubs ?? []).map(c => c.id);
      }, { timeout: 20_000 })
      .toContain(clubId);
  } finally {
    await anon.close();
    await ownerCtx.close();
    await ownerApi.dispose();
    await joinerApi.dispose();
    await admin.from('club_requests').delete().eq('requester_profile_id', owner.id);
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
  }
});
