import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Custom domains, part 1 (phase 6b C1): the claim/verify/remove lifecycle
// on a published site. Real DNS is the verification oracle, so the
// stable negative (no TXT record for a made-up host) is what's asserted;
// the positive path is the prod probe with a Tom-controlled hostname.
// Self-skips pre-171.

test('org site domain: publish gate → claim (normalized, token, DNS table) → reserved 400 → duplicate 409 → verify 409 (DNS) → remove; 375px console', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-domain', owner.id);

  const probe = await admin.from('org_sites').select('domain_active_at').limit(1);
  test.skip(!!probe.error, `org_sites domain columns missing — run migration 171 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Domain League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert({ league_id: leagueId, profile_id: owner.id, role: 'owner' });
  // A second org + site for the duplicate-claim check.
  const { data: other } = await admin
    .from('leagues')
    .insert({ name: `QA Domain Other ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const otherId = other!.id as string;
  await admin.from('memberships').insert({ league_id: otherId, profile_id: owner.id, role: 'owner' });

  const ownerApi = await apiAs('state-b.json');
  const host = `qa-${stamp}.example.test`;
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string };

    // Drafts can't claim a domain.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/domain`, { data: { domain: host } });
    expect(res.status()).toBe(409);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Empty state.
    res = await ownerApi.get(`/api/leagues/${leagueId}/site/domain`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).domain.state).toBe('none');

    // Reserved hosts are refused; junk is refused.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/domain`, { data: { domain: 'anything.vercel.app' } });
    expect(res.status()).toBe(400);
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/domain`, { data: { domain: 'not a host' } });
    expect(res.status()).toBe(400);

    // Claim: pasted with scheme/case/path, stored normalized, token minted,
    // the DNS table prescribes TXT + CNAME (a subdomain, not an apex).
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/domain`, {
      data: { domain: `HTTPS://${host.toUpperCase()}/standings` },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const claimed = (await res.json()).domain as {
      state: string;
      domain: string;
      instructions: { type: string; name: string; value: string }[];
    };
    expect(claimed.state).toBe('pending');
    expect(claimed.domain).toBe(host);
    expect(claimed.instructions.map(i => i.type)).toEqual(['TXT', 'CNAME']);
    expect(claimed.instructions[0].name).toBe(`_edgeathlete.${host}`);
    expect(claimed.instructions[0].value).toMatch(/^[a-f0-9]{64}$/);
    expect(claimed.instructions[1].value).toBe('cname.vercel-dns.com');
    const { data: row } = await admin
      .from('org_sites')
      .select('custom_domain, domain_verification_token, domain_requested_at, domain_verified_at')
      .eq('id', site.id)
      .single();
    expect(row!.custom_domain).toBe(host);
    expect(row!.domain_verification_token).toBe(claimed.instructions[0].value);
    expect(row!.domain_requested_at).toBeTruthy();
    expect(row!.domain_verified_at).toBeNull();

    // The same host on another site → 409 (the partial unique index).
    res = await ownerApi.post(`/api/leagues/${otherId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${otherId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.post(`/api/leagues/${otherId}/site/domain`, { data: { domain: host } });
    expect(res.status(), await readErrorBody(res)).toBe(409);

    // Verify against real DNS: the record can't exist → the human 409,
    // state unchanged, nothing written.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/domain/verify`);
    expect(res.status(), await readErrorBody(res)).toBe(409);
    expect((await res.json()).domain.state).toBe('pending');
    // Check requires verification first.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/domain/check`);
    expect(res.status()).toBe(409);

    // Console: the block shows the domain + the DNS table at 375px.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByText(host, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(`_edgeathlete.${host}`)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Verify DNS' })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ownerCtx.close();
    }

    // Remove → back to none, columns cleared.
    res = await ownerApi.delete(`/api/leagues/${leagueId}/site/domain`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).domain.state).toBe('none');
    const { data: cleared } = await admin
      .from('org_sites')
      .select('custom_domain, domain_verification_token')
      .eq('id', site.id)
      .single();
    expect(cleared!.custom_domain).toBeNull();
    expect(cleared!.domain_verification_token).toBeNull();
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().in('league_id', [leagueId, otherId]);
    await admin.from('memberships').delete().in('league_id', [leagueId, otherId]);
    await admin.from('leagues').delete().in('id', [leagueId, otherId]);
  }
});
