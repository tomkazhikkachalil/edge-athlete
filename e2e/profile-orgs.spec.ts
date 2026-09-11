import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The profile org strip (org connections round; the Sep 11 2026 rule). The
// shape that broke: a profile with memberships on BOTH sides — the other
// side's NULL org id used to ride into `.in('id', …)`, a PostgREST 400, and
// the whole side vanished silently. Now: user A belongs to a club AND a
// league; both chips render on A's own page and the feed card; an unlisted
// + private club STILL shows to A (own memberships always) and to B while B
// is a member of it, never to a stranger; the CDN /u/ payload carries the
// stranger view.

test('profile orgs: both sides on own page + feed; own memberships always; a private org only to its members', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('club_id').limit(1);
  test.skip(!!probe.error, `memberships missing — run migration 140 (${probe.error?.message})`);

  const stamp = Date.now();
  const clubName = `QA Strip Club ${stamp}`;
  const leagueName = `QA Strip League ${stamp}`;
  const { data: club, error } = await admin.from('clubs').insert({ name: clubName, owner_profile_id: userB.id }).select().single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'ice_hockey', owner_profile_id: userB.id })
    .select()
    .single();
  expect(leagueErr, leagueErr?.message).toBeNull();
  const leagueId = league!.id as string;
  const { error: memberError } = await admin.from('memberships').insert([
    { club_id: clubId, profile_id: userB.id, role: 'owner' },
    { club_id: clubId, profile_id: userA.id, role: 'member' },
    { league_id: leagueId, profile_id: userB.id, role: 'owner' },
    { league_id: leagueId, profile_id: userA.id, role: 'member' },
  ]);
  expect(memberError, memberError?.message).toBeNull();
  const { data: priorA } = await admin.from('profiles').select('visibility, handle').eq('id', userA.id).single();
  const handle = `qastrip${stamp.toString(36)}`;

  const aApi = await apiAs('state.json');
  const bApi = await apiAs('state-b.json');
  try {
    // Own profile page: BOTH chips (the shape that used to empty the strip).
    await page.goto('/athlete');
    await expect(page.getByRole('link', { name: new RegExp(clubName) }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: new RegExp(leagueName) }).first()).toBeVisible();

    // Feed sidebar: the Your Clubs & Leagues card lists both.
    await page.goto('/feed');
    await expect(page.getByRole('heading', { name: 'Your Clubs & Leagues' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: new RegExp(clubName) }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(leagueName) }).first()).toBeVisible();

    // Own memberships ALWAYS: unlisted + private, still on A's own read.
    const { error: flipErr } = await admin.from('clubs').update({ listing_status: 'unlisted', visibility: 'private' }).eq('id', clubId);
    const visibilitySupported = !flipErr;
    let res = await aApi.get(`/api/profile/${userA.id}/organizations`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const own = (await res.json()).organizations as { id: string; kind: string }[];
    expect(own.map(o => o.id)).toEqual(expect.arrayContaining([clubId, leagueId]));

    // A viewer (B) sees A's private club only while B belongs to it; the
    // league (public) always. A is public for the viewer reads.
    await admin.from('profiles').update({ visibility: 'public', handle }).eq('id', userA.id);
    if (visibilitySupported) {
      res = await bApi.get(`/api/profile/${userA.id}/organizations`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      let seen = ((await res.json()).organizations as { id: string }[]).map(o => o.id);
      expect(seen).toEqual(expect.arrayContaining([clubId, leagueId]));
      await admin.from('memberships').delete().eq('club_id', clubId).eq('profile_id', userB.id);
      res = await bApi.get(`/api/profile/${userA.id}/organizations`);
      seen = ((await res.json()).organizations as { id: string }[]).map(o => o.id);
      expect(seen).toContain(leagueId);
      expect(seen).not.toContain(clubId);
      // The stranger's CDN payload (/u/) carries the league, never the private club.
      const pub = await bApi.get(`/api/public/profile?handle=${handle}`);
      expect(pub.status(), await readErrorBody(pub)).toBe(200);
      const pubOrgs = ((await pub.json()).organizations ?? []) as { id: string }[];
      expect(pubOrgs.map(o => o.id)).toContain(leagueId);
      expect(pubOrgs.map(o => o.id)).not.toContain(clubId);
      // And A's own read still has it (the rule's first half, again).
      res = await aApi.get(`/api/profile/${userA.id}/organizations`);
      expect(((await res.json()).organizations as { id: string }[]).map(o => o.id)).toContain(clubId);
    }

    // B's browser view of A's page shows the public league chip.
    const bCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const p = await bCtx.newPage();
      await p.goto(`/athlete/${userA.id}`);
      await expect(p.getByRole('link', { name: new RegExp(leagueName) }).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await bCtx.close();
    }
  } finally {
    await aApi.dispose();
    await bApi.dispose();
    await admin.from('profiles').update({ visibility: priorA!.visibility as string, handle: (priorA!.handle as string | null) ?? null }).eq('id', userA.id);
    await admin.from('clubs').delete().eq('id', clubId); // members cascade
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
