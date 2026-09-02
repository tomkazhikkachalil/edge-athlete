import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Custom domains, part 2 (phase 6b C2): serving on the org's own host.
// The domain state is seeded straight into org_sites (the C1 flow is its
// own spec; real DNS can't be faked here), then:
//   verified-but-inactive host → the middleware REWRITES into the site
//   (URL bar keeps the domain), /.well-known/edge-athlete answers the
//   slug, crawler files come from the per-site routes; the apex does NOT
//   301 yet. Active → the apex /{slug} and /org/{slug} 301 single-hop to
//   the domain, links go host-relative, canonical/OG absolute on it, and
//   the main sitemap drops the site.
// Needs the TARGET to run with CUSTOM_DOMAINS=1 (build-injected) — the
// first request probes that and skips otherwise. Self-skips pre-171.

test('org site domain serving: rewrite on the custom host, well-known, per-host crawler files; active → apex 301 + host-relative links + main sitemap drop', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);

  const probe = await admin.from('org_sites').select('domain_active_at').limit(1);
  test.skip(!!probe.error, `org_sites domain columns missing — run migration 171 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Serving League ${stamp}`;
  const host = `qa-${stamp}.example.test`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert({ league_id: leagueId, profile_id: owner.id, role: 'owner' });
  await admin.from('teams').insert({ league_id: leagueId, name: `Comets ${stamp}` });

  const ownerApi = await apiAs('state-b.json');
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    const slug = site.subdomain;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Seed: claimed + verified, NOT active.
    await admin
      .from('org_sites')
      .update({
        custom_domain: host,
        domain_verification_token: 'seeded',
        domain_requested_at: new Date().toISOString(),
        domain_verified_at: new Date().toISOString(),
      })
      .eq('id', site.id);

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      // Does the target honour a custom Host at all (flag on + our header reaches it)?
      const wellKnown = await anon.request.get('/.well-known/edge-athlete', { headers: { host } });
      test.skip(
        wellKnown.status() !== 200 || (await wellKnown.text()).trim() !== slug,
        `target does not serve custom hosts (CUSTOM_DOMAINS off or Host header not honoured): ${wellKnown.status()}`
      );

      // Verified-but-inactive: the custom host already serves the site
      // (a rewrite — 200, no redirect), links still carry the slug path.
      const home = await anon.request.get('/', { headers: { host } });
      expect(home.status()).toBe(200);
      const homeHtml = await home.text();
      expect(homeHtml).toContain(name);
      expect(homeHtml).toContain(`/${slug}/teams`);
      const teams = await anon.request.get('/teams', { headers: { host } });
      expect(teams.status()).toBe(200);
      expect(await teams.text()).toContain(`Comets ${stamp}`);
      // Crawler files on the custom host come from the per-site routes.
      const robots = await anon.request.get('/robots.txt', { headers: { host } });
      expect(robots.status()).toBe(200);
      expect(await robots.text()).toContain('Sitemap: ');
      const sm = await anon.request.get('/sitemap.xml', { headers: { host } });
      expect(sm.status()).toBe(200);
      expect(sm.headers()['content-type']).toContain('xml');
      expect(await sm.text()).toContain('<urlset');
      // The apex does NOT redirect while inactive.
      const apexInactive = await anon.request.get(`/${slug}`, { maxRedirects: 0 });
      expect([200, 404]).toContain(apexInactive.status());
      expect(apexInactive.status()).not.toBe(301);

      // Activate (what C1's reachability probe does) → everything flips.
      await admin
        .from('org_sites')
        .update({ domain_vercel_state: 'attached', domain_active_at: new Date().toISOString() })
        .eq('id', site.id);
      // The middleware caches host/slug answers for 60s; the render cache
      // purges on tag. Poll the apex until it 301s.
      let apex = await anon.request.get(`/${slug}/teams?x=1`, { maxRedirects: 0 });
      for (let i = 0; i < 20 && apex.status() !== 301; i++) {
        await new Promise(r => setTimeout(r, 4000));
        apex = await anon.request.get(`/${slug}/teams?x=1`, { maxRedirects: 0 });
      }
      expect(apex.status()).toBe(301);
      expect(apex.headers()['location']).toBe(`https://${host}/teams?x=1`);
      const orgForm = await anon.request.get(`/org/${slug}`, { maxRedirects: 0 });
      expect(orgForm.status()).toBe(301);
      expect(orgForm.headers()['location']).toBe(`https://${host}`);
      // Carve-outs stay on the apex.
      const card = await anon.request.get(`/${slug}/card.png`, { maxRedirects: 0 });
      expect(card.status()).toBe(200);

      // On the domain: host-relative links, absolute canonical + og on it.
      let activeHtml = '';
      for (let i = 0; i < 12; i++) {
        activeHtml = await (await anon.request.get('/', { headers: { host } })).text();
        if (activeHtml.includes(`href="https://${host}"`) || activeHtml.includes(`href="https://${host}/`)) break;
        await new Promise(r => setTimeout(r, 2500));
      }
      expect(activeHtml).toContain(`href="/teams"`);
      expect(activeHtml).not.toContain(`/${slug}/teams`);
      expect(activeHtml).toContain(`rel="canonical" href="https://${host}"`);
      expect(activeHtml).toContain(`content="https://${host}/card.png"`);
      expect(activeHtml).toContain(`"url":"https://${host}"`);
      const activeSm = await (await anon.request.get('/sitemap.xml', { headers: { host } })).text();
      expect(activeSm).toContain(`<loc>https://${host}/teams</loc>`);

      // The main sitemap drops the site (its URLs live on the domain now).
      let mainSm = '';
      for (let i = 0; i < 12; i++) {
        mainSm = await (await anon.request.get('/sitemap.xml')).text();
        if (!mainSm.includes(`/${slug}<`) && !mainSm.includes(`/${slug}/`)) break;
        await new Promise(r => setTimeout(r, 2500));
      }
      expect(mainSm).not.toContain(`/${slug}/teams`);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('teams').delete().eq('league_id', leagueId);
    await admin.from('memberships').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
