import { test, expect } from '@playwright/test';
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

// Golf sites, part 6 (phase 6e S6): announce to members. A manager's
// notice bells every member (the org's own league_update / club_update
// type — a sender at last), a supervised member's guardians hear too,
// the title can mirror to the site's notice band until a day, the
// sender is not self-belled, a member is refused, and the bucket caps
// it at a few a day. No table: the rows are the record.

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

test('announce: members belled (not the sender), guardian copy, site notice, member 403, daily cap; console at 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json'); // the manager
  const alpha = loadQaUser('user.json'); // a member; ALSO the guardian of the child below
  const admin = adminClient();
  await resetRateBucket(admin, 'org-announce', owner.id);
  await resetRateBucket(admin, 'org-site', owner.id);

  const stamp = Date.now();
  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Announce League ${stamp}`, sport_key: 'golf', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(alpha.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-announce-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ...(childId ? [{ league_id: leagueId, profile_id: childId, role: 'member', kind: 'roster' }] : []),
  ]);

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
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

    // The console form at 375px sends one more, then the daily cap bites.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByLabel('Announcement title')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Send announcement' })).toBeDisabled();
      await page.getByLabel('Announcement title').fill(`Console note ${stamp}`);
      await page.getByLabel('Announcement message').fill('Sent from the console.');
      await page.getByRole('button', { name: 'Send announcement' }).click();
      await expect(page.getByText(/Sent to \d+ member/)).toBeVisible({ timeout: 15_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }
    const { data: second } = await admin
      .from('notifications')
      .select('metadata')
      .eq('user_id', alpha.id)
      .eq('type', 'league_update')
      .contains('metadata', { org: `league:${leagueId}`, announcement: true });
    for (const r of second ?? []) {
      const id = (r.metadata as { announcement_id?: string }).announcement_id;
      if (id && !announcementIds.includes(id)) announcementIds.push(id);
    }
    expect(announcementIds.length).toBe(2);

    // Five a day — the limiter runs BEFORE validation, so the earlier 400
    // took a slot too: 400, the API send, the console send, two more pass;
    // the sixth request is 429.
    for (let i = 0; i < 2; i++) {
      res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: `Cap ${i}`, message: 'x' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      announcementIds.push((await res.json()).announcementId);
    }
    res = await ownerApi.post(`/api/leagues/${leagueId}/announce`, { data: { title: 'Cap 6', message: 'x' } });
    expect(res.status()).toBe(429);
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await anonCtx.close();
    for (const id of announcementIds) {
      await admin.from('notifications').delete().contains('metadata', { announcement_id: id });
    }
    await resetRateBucket(admin, 'org-announce', owner.id);
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
    if (childId) await deleteQaUser(childId);
  }
});
