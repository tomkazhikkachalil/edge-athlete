import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';
import { GOLF_MODULE_ORDER } from '../src/lib/org-sites/validate';
import { courseDisplayName } from '../src/lib/golf/tees';

// Club sign-up, part 4 (phase 7 C4): BUILD WHILE WAITING. A club request
// provisions the club (approved_at NULL — 174), its owner row, the optional
// home course as a venue, and a DRAFT site with the draft's contact. While
// pending: outsiders 404 (API + page + search), managers see a banner and
// the console with Publish locked (server 409). Approval (flipped through
// the service role — no spec drives /api/admin/*, admin = ADMIN_EMAILS)
// unlocks publish and the site goes live with the home course on it.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('pending club: provisioned at request → hidden from outsiders → console builds, publish 409 → approval → live; 375px console', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');

  const probe = await admin.from('clubs').select('approved_at').limit(1);
  test.skip(!!probe.error, `clubs.approved_at missing — run migration 174 (${probe.error?.message})`);

  // Leftovers from earlier runs (one pending request per user).
  const { data: stale } = await admin.from('club_requests').select('created_club_id').eq('requester_profile_id', owner.id);
  const staleIds = (stale ?? []).map(r => r.created_club_id as string | null).filter((id): id is string => !!id);
  if (staleIds.length) await admin.from('clubs').delete().in('id', staleIds);
  await admin.from('club_requests').delete().eq('requester_profile_id', owner.id);
  await resetRateBucket(admin, 'club-request', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);

  const token = `qapend${stamp}`;
  const courseClub = `QA Pending Home Club ${stamp}`;
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-pending-${stamp}`,
      name: `${token} Course`,
      club_name: courseClub,
      city: 'Kanata',
      region: 'Ontario',
      country: 'Canada',
      country_code: 'CA',
      region_code: 'ON',
      website: `https://${token}.example`,
      phone: '613-555-0100',
      total_par: 72,
      holes_count: 18,
      hole_data: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 380 }, handicap: i + 1 })),
      course_rating: { white: 71.2 },
      slope_rating: { white: 128 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  const clubName = `QA Pending Golf Club ${stamp}`;

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
  let clubId: string | null = null;
  try {
    // The request → the provisioned club.
    const requested = await ownerApi.post('/api/clubs/requests', {
      data: {
        name: clubName,
        capabilities: { operatesCompetitions: true, operatesTeams: false },
        siteDraft: { sports: ['golf'], homeCourseId: courseId, contact: { website: `https://${token}.example`, phone: '613-555-0100' } },
      },
    });
    expect(requested.status(), await readErrorBody(requested)).toBe(200);
    const body = (await requested.json()) as { orgId: string | null; request: { id: string; created_club_id: string | null } };
    expect(body.orgId, 'the club was provisioned').toBeTruthy();
    clubId = body.orgId!;
    expect(body.request.created_club_id).toBe(clubId);

    const { data: club } = await admin.from('clubs').select('approved_at, primary_sport, owner_profile_id, name').eq('id', clubId).single();
    expect(club).toMatchObject({ approved_at: null, primary_sport: 'golf', owner_profile_id: owner.id, name: clubName });
    const { data: membership } = await admin.from('memberships').select('role').eq('club_id', clubId).eq('profile_id', owner.id);
    expect(membership?.map(m => m.role)).toEqual(['owner']);
    const { data: venues } = await admin.from('venues').select('name, golf_course_id').eq('club_id', clubId);
    expect(venues).toEqual([{ name: courseDisplayName(courseClub, `${token} Course`), golf_course_id: courseId }]);
    const { data: site } = await admin.from('org_sites').select('id, subdomain, published_at, contact_config').eq('club_id', clubId).single();
    expect(site!.published_at).toBeNull();
    expect(site!.contact_config).toEqual({ website: `https://${token}.example`, phone: '613-555-0100' });
    const { data: mods } = await admin.from('org_site_modules').select('module_key').eq('site_id', site!.id).order('sort_order');
    expect(mods!.slice(0, 3).map(m => m.module_key)).toEqual(GOLF_MODULE_ORDER.club.slice(0, 3));
    const { data: req } = await admin.from('club_requests').select('created_club_id, status').eq('id', body.request.id).single();
    expect(req).toEqual({ created_club_id: clubId, status: 'pending' });

    // Outsiders: the API 404s, the page says not found, search is silent.
    const anonApi = await anon.request.get(`/api/clubs/${clubId}`);
    expect(anonApi.status()).toBe(404);
    const anonPage = await anon.newPage();
    await anonPage.goto(`/club/${clubId}`);
    await expect(anonPage.getByRole('heading', { name: 'Club Not Found' })).toBeVisible({ timeout: 20_000 });
    const search = await ownerApi.get(`/api/search?q=${encodeURIComponent(clubName)}`);
    expect(search.status()).toBe(200);
    const searchBody = (await search.json()) as { results?: { clubs?: { id: string }[] }; clubs?: { id: string }[] };
    const foundClubs = searchBody.results?.clubs ?? searchBody.clubs ?? [];
    expect(foundClubs.map(c => c.id)).not.toContain(clubId);

    // The owner: pending truth, the banners, the console, publish locked.
    const ownerGet = await ownerApi.get(`/api/clubs/${clubId}`);
    expect(ownerGet.status()).toBe(200);
    expect(((await ownerGet.json()) as { pending: boolean }).pending).toBe(true);
    const pageB = await ownerCtx.newPage();
    await pageB.goto('/club/start');
    await expect(pageB.getByRole('link', { name: /Open your console/ })).toBeVisible({ timeout: 20_000 });
    await pageB.goto(`/club/${clubId}`);
    await expect(pageB.getByText('Awaiting approval', { exact: true })).toBeVisible({ timeout: 20_000 });
    await pageB.goto(`/app/org/club/${clubId}`);
    await expect(pageB.getByText('Pending approval', { exact: true })).toBeVisible({ timeout: 20_000 });
    const publishBtn = pageB.getByRole('button', { name: 'Publish', exact: true });
    await expect(publishBtn).toBeVisible({ timeout: 20_000 });
    await expect(publishBtn).toBeDisabled();
    const scrollWidth = await pageB.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    const publish = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(publish.status()).toBe(409);
    expect(await readErrorBody(publish)).toContain('Awaiting approval');
    const standings = await anon.request.get(`/club/${clubId}/standings`);
    expect(await standings.text()).toContain('No published standings yet');

    // Approval through the service role (the admin route's stamp + claim).
    await admin.from('clubs').update({ approved_at: new Date().toISOString() }).eq('id', clubId);
    await admin.from('club_requests').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', body.request.id);
    const publishOk = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(publishOk.status(), await readErrorBody(publishOk)).toBe(200);
    expect((await anon.request.get(`/api/clubs/${clubId}`)).status()).toBe(200);
    let html = '';
    await expect
      .poll(
        async () => {
          const res = await anon.request.get(`/org/${site!.subdomain}`);
          html = res.ok() ? await res.text() : '';
          return res.status();
        },
        { timeout: 30_000, intervals: [1000, 2000, 3000] }
      )
      .toBe(200);
    expect(html).toContain(courseClub); // the home course, on the site
    expect(html).toContain(`https://${token}.example`); // the seeded contact
  } finally {
    await anon.close();
    await ownerCtx.close();
    await ownerApi.dispose();
    await admin.from('club_requests').delete().eq('requester_profile_id', owner.id);
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
  }
});
