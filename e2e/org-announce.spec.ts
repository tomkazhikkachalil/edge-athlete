import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import {
  adminClient,
  apiAs,
  createQaChild,
  deleteQaUser,
  guardianFlagOn,
  loadQaUser,
  readErrorBody,
  resetRateBucket,
} from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite } from './helpers/org-site';

// Golf sites, part 6 (phase 6e S6): announce to members. A manager's
// notice bells every member (the org's own league_update / club_update
// type — a sender at last), a supervised member's guardians hear too,
// the title can mirror to the site's notice band until a day, the
// sender is not self-belled, a member is refused, and the bucket caps
// it at a few a day. No table: the rows are the record.
//
// Sports-team website program, P0 (Sep 27 2026): the band is derived from
// the rows at render — publishing a draft made BEFORE the announcement no
// longer wipes it (announce used to copy the title into the live
// hero_config, which the publish then overwrote); and a website-only staff
// grant can announce (the form lives in the Website section).


test('announce: members belled (not the sender), guardian copy, site notice, member 403, daily cap; the console points to the newsroom at 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json'); // the manager
  const alpha = loadQaUser('user.json'); // a member; ALSO the guardian of the child below
  const admin = adminClient();
  await resetRateBucket(admin, 'org-announce', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);

  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Announce League ${stamp}`, sport_key: 'golf', owner_profile_id: owner.id });
  const leagueId = league.id;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(alpha.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-announce-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { org_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { org_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ...(childId ? [{ org_id: leagueId, profile_id: childId, role: 'member', kind: 'roster' }] : []),
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const anonCtx = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
  const announcementIds: string[] = [];
  try {
    // A published site so the notice can mirror.
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const site = (await res.json()).site as { id: string; subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const canonicalProbe = await anonCtx.request.get(`/org/${site.subdomain}`, { maxRedirects: 0 });
    const sitePath = canonicalProbe.status() === 301 ? `/${site.subdomain}` : `/org/${site.subdomain}`;

    // A member is refused; a bad body is 400.
    res = await alphaApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: 'x', message: 'y' } });
    expect(res.status()).toBe(403);
    res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: '', message: 'y' } });
    expect(res.status()).toBe(400);

    // P0-2: a draft edit made BEFORE the announcement (the wipe scenario).
    const drafted = `Drafted before ${stamp}`;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_hero', headline: drafted } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const nextYear = `${new Date().getUTCFullYear() + 1}-06-30`;
    const title = `Rain-out ${stamp}`;
    res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, {
      data: { title, message: 'Week 3 runs through Sunday.', siteNoticeUntil: nextYear },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const out = (await res.json()) as { announcementId: string; sent: number; guardians: number; siteNotice: boolean };
    announcementIds.push(out.announcementId);
    expect(out.sent).toBe(childId ? 2 : 1); // alpha (+ the child) — never the sender
    expect(out.guardians).toBe(childId ? 1 : 0);
    expect(out.siteNotice).toBe(true);

    const { data: rows } = await admin
      .from('notifications')
      .select('user_id, type, title, message, action_url, metadata')
      .contains('metadata', { announcement_id: out.announcementId });
    const memberRows = rows!.filter(r => !(r.metadata as { profile_id?: string }).profile_id);
    expect(memberRows.map(r => r.user_id).sort()).toEqual([alpha.id, ...(childId ? [childId] : [])].sort());
    expect(memberRows.every(r => r.type === 'league_update')).toBe(true);
    expect(memberRows[0].title).toBe(`QA Announce League ${stamp}: ${title}`);
    expect(memberRows[0].action_url).toBe(`/league/${leagueId}`);
    expect(rows!.some(r => r.user_id === owner.id && !(r.metadata as { profile_id?: string }).profile_id)).toBe(false);
    if (childId) {
      // The guardian copy lands on alpha (the child's guardian), stamped with the child.
      const copy = rows!.find(r => r.user_id === alpha.id && (r.metadata as { profile_id?: string }).profile_id === childId);
      expect(copy, 'guardian copy').toBeTruthy();
      expect(copy!.title).toContain('announced for Casey');
    }

    // The site carries the notice.
    const home = await settleBody(anonCtx.request, sitePath, title, true, 12);
    expect(home).toContain(title);
    expect(home).toContain('role="status"');

    // P0-2: publishing the OLDER draft keeps the band (it used to wipe it).
    await publishSite(ownerApi, 'league', leagueId, 'After the announcement');
    const published = await settleBody(anonCtx.request, sitePath, drafted, true, 12);
    expect(published, 'the band survives the publish').toContain(title);
    expect(published).toContain('role="status"');

    // A2 (Sep 28 2026): the console no longer carries the form — announcing is
    // a news post with "Notify members"; the console points there (375px).
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.locator('[data-console-announce-news]')).toHaveAttribute('href', `/app/org/league/${leagueId}/site/edit?news=new`, { timeout: 20_000 });
      await expect(page.getByLabel('Announcement title')).toHaveCount(0);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }

    // Five a day through the API (a siteless org and scripts still announce
    // there) — the limiter runs BEFORE validation, so the earlier 400 took a
    // slot too: 400, the first send, three more pass; the sixth request is 429.
    for (let i = 0; i < 3; i++) {
      res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: `Cap ${i}`, message: 'x' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      announcementIds.push((await res.json()).announcementId);
    }
    res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: 'Cap 6', message: 'x' } });
    expect(res.status()).toBe(429);

    // P0-3: a website-only staff grant can announce (was a 403 — the route
    // asked for manage_membership while the form sits in the Website section).
    await resetRateBucket(admin, 'org-announce', alpha.id);
    const { error: grantError } = await admin.from('memberships').insert({
      org_id: leagueId, profile_id: alpha.id, kind: 'staff', role: 'staff', status: 'active',
      scope_type: 'org', sections: ['website'], granted_by: owner.id, granted_at: new Date().toISOString(),
    });
    expect(grantError).toBeNull();
    res = await alphaApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: `From the website staff ${stamp}`, message: 'x' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    announcementIds.push((await res.json()).announcementId);
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await anonCtx.close();
    for (const id of announcementIds) {
      await admin.from('notifications').delete().contains('metadata', { announcement_id: id });
    }
    await resetRateBucket(admin, 'org-announce', owner.id);
    await resetRateBucket(admin, 'org-announce', alpha.id);
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
    if (childId) await deleteQaUser(childId);
  }
});
