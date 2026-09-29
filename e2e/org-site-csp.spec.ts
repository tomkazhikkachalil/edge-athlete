import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Sports-team website program, V3 (Sep 28 2026): the public site's static
// CSP no longer allows scripts from any https origin — only the site's own.
// Every public page a visitor walks (home, schedule, results, teams, a team,
// news) renders with ZERO securitypolicyviolation events, and the header
// says so.

test('static CSP: script-src self + inline only; the public pages raise no violation @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA CSP League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    await admin.from('org_site_modules').update({ enabled: true }).eq('site_id', siteId).in('module_key', ['teams', 'schedule', 'news']);
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { data: team } = await admin.from('teams').insert({ org_id: league.id, name: `Owls ${stamp}` }).select('id').single();

    const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    await settleBody(anon.request, base, `QA CSP League ${stamp}`, true, 12);
    const head = await anon.request.get(base);
    const policy = head.headers()['content-security-policy'] ?? head.headers()['content-security-policy-report-only'] ?? '';
    const script = policy.split(';').map(d => d.trim()).find(d => d.startsWith('script-src')) ?? '';
    expect(script.startsWith("script-src 'self' 'unsafe-inline'"), script).toBe(true);
    expect(script).not.toContain('https:');

    const page = await anon.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener('securitypolicyviolation', e => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    for (const path of ['', '/schedule', '/schedule/results', '/teams', `/teams/${team!.id}`, '/news']) {
      const r = await page.goto(`${base}${path}`);
      expect(r?.status(), path || '/').toBeLessThan(400);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), `CSP violations on ${path || '/'}`).toEqual([]);
    }
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
