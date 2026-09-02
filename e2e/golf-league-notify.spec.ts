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

// Golf league depth, part 2 (phase 6d W2): the member feedback loop. A
// sync that counts a member's round bells the member (and their guardians
// when supervised); an idempotent re-sync bells nobody; the organizer's
// confirm bells "final" with the rank, once; the member's own "Your week"
// (the one viewer-dependent golf read) shows their result or the door to
// post one, on the org page at 375px. The bell assertions run only once
// migration 173 widened the CHECK (probed, not assumed); everything else
// runs regardless. Rounds are seeded straight into golf_rounds/golf_holes.

const utcToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

test('golf league bells: counted (once), confirmed (once, with rank), guardian copy; "Your week" on the org page; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json'); // "Edge Bravo" — the manager AND a member
  const alpha = loadQaUser('user.json'); // "Edge Alpha" — a member with no round
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);

  const probe = await admin.from('contests').select('holes').limit(1);
  test.skip(!!probe.error, `contests.holes missing — run migration 172 (${probe.error?.message})`);

  // Is the CHECK widened yet? A probe row answers; it is deleted at once.
  const bellProbe = await admin
    .from('notifications')
    .insert({ user_id: owner.id, type: 'golf_league_round_counted', title: 'probe', is_read: true, metadata: { probe: true } })
    .select('id')
    .single();
  const bellsLive = !bellProbe.error;
  if (bellProbe.data) await admin.from('notifications').delete().eq('id', bellProbe.data.id);
  if (!bellsLive) console.log(`[e2e] migration 173 not applied yet (${bellProbe.error?.code}) — bell assertions skipped`);

  const stamp = Date.now();
  const today = utcToday();
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Bells Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'roster' },
  ]);
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(owner.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-bells-minor-${stamp}` });
    await admin.from('memberships').insert([
      { club_id: clubId, profile_id: childId, role: 'member', kind: 'follow' },
      { club_id: clubId, profile_id: childId, role: 'member', kind: 'roster' },
    ]);
  }
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select().single();
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-bells-${stamp}`,
      name: `QA Bells Nine ${stamp}`,
      total_par: 36,
      holes_count: 9,
      section_kind: 'nine',
      hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350 }, handicap: i + 1 })),
      course_rating: { white: 35.2 },
      slope_rating: { white: 118 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  const { data: venue } = await admin
    .from('venues')
    .insert({ club_id: clubId, name: `QA Bells Venue ${stamp}`, golf_course_id: courseId })
    .select('id')
    .single();
  const venueId = venue!.id as string;
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Bells League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_gross',
      config: { golf: { pick: 'first' } },
      status: 'active',
      visibility: 'private', // "Your week" is entry-gated, not visibility-gated
    })
    .select('id')
    .single();
  const competitionId = comp!.id as string;
  const { data: entries } = await admin
    .from('competition_entries')
    .insert([
      { competition_id: competitionId, profile_id: owner.id, status: 'approved' },
      { competition_id: competitionId, profile_id: alpha.id, status: 'approved' },
      ...(childId ? [{ competition_id: competitionId, profile_id: childId, status: 'approved' }] : []),
    ])
    .select('id, profile_id');
  const entryIds = entries!.map(e => e.id as string);
  const { data: contest } = await admin
    .from('contests')
    .insert({
      competition_id: competitionId,
      round: 'Week 2',
      venue_id: venueId,
      holes: 9,
      play_from: addDays(today, -3),
      play_to: addDays(today, 3),
      status: 'scheduled',
    })
    .select('id')
    .single();
  const contestId = contest!.id as string;
  await admin.from('contest_participants').insert(entryIds.map(entryId => ({ contest_id: contestId, entry_id: entryId, side: null })));

  const insertRound = async (profileId: string, holeStrokes: number[]) => {
    const { data: r } = await admin
      .from('golf_rounds')
      .insert({
        profile_id: profileId,
        date: today,
        course: `QA Bells Nine ${stamp}`,
        course_id: courseId,
        tee: 'white',
        holes: 9,
        par: 36,
        gross_score: holeStrokes.reduce((a, b) => a + b, 0),
        is_complete: true,
        round_type: 'outdoor',
        course_rating: 35.2,
        slope_rating: 118,
      })
      .select('id')
      .single();
    await admin.from('golf_holes').insert(holeStrokes.map((strokes, i) => ({ round_id: r!.id, hole_number: i + 1, par: 4, strokes })));
    return r!.id as string;
  };
  const roundIds: string[] = [];
  roundIds.push(await insertRound(owner.id, [5, 4, 5, 4, 5, 4, 5, 4, 5])); // 41
  if (childId) roundIds.push(await insertRound(childId, [4, 4, 4, 4, 4, 4, 4, 4, 3])); // 35

  const bells = async (type: string) =>
    (
      await admin
        .from('notifications')
        .select('user_id, title, action_url, metadata')
        .eq('type', type)
        .contains('metadata', { contest_id: contestId })
    ).data ?? [];

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  try {
    const base = `/api/clubs/${clubId}/competitions/${competitionId}`;
    let res = await ownerApi.post(`${base}/golf-sync`, { data: { contestId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).reports[0].synced).toBe(childId ? 2 : 1);

    if (bellsLive) {
      // One "counted" bell per member with a round; the child's is copied
      // to the guardian (= the owner, who also has their own).
      const counted = await bells('golf_league_round_counted');
      const ownerOwn = counted.filter(n => n.user_id === owner.id && !(n.metadata as { profile_id?: string }).profile_id);
      expect(ownerOwn.length).toBe(1);
      expect(ownerOwn[0].title).toContain('Your 9-hole 41 counts for Week 2 in');
      expect(ownerOwn[0].action_url).toBe(`/club/${clubId}`);
      expect(counted.some(n => n.user_id === alpha.id)).toBe(false);
      if (childId) {
        expect(counted.filter(n => n.user_id === childId).length).toBe(1);
        const guardianCopy = counted.filter(n => n.user_id === owner.id && (n.metadata as { profile_id?: string }).profile_id === childId);
        expect(guardianCopy.length).toBe(1);
        expect(guardianCopy[0].title).toContain('35');
      }
      // Idempotent re-sync: nothing new.
      res = await ownerApi.post(`${base}/golf-sync`, { data: { contestId } });
      expect(res.status()).toBe(200);
      expect((await bells('golf_league_round_counted')).length).toBe(counted.length);
    }

    // "Your week": anon 401; the owner sees their 41 posted; alpha sees the open window and no result.
    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      expect((await anonCtx.request.get(`/api/clubs/${clubId}/golf/mine`)).status()).toBe(401);
    } finally {
      await anonCtx.close();
    }
    res = await ownerApi.get(`/api/clubs/${clubId}/golf/mine`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let mine = (await res.json()).entries as { competitionId: string; week: { contestId: string; state: string; round: string } | null; result: { gross: number; provenance: string } | null }[];
    expect(mine.length).toBe(1);
    expect(mine[0].week?.contestId).toBe(contestId);
    expect(mine[0].week?.state).toBe('open');
    expect(mine[0].result).toMatchObject({ gross: 41, provenance: 'self_reported' });
    res = await alphaApi.get(`/api/clubs/${clubId}/golf/mine`);
    expect(res.status()).toBe(200);
    mine = (await res.json()).entries;
    expect(mine[0].week?.round).toBe('Week 2');
    expect(mine[0].result).toBeNull();

    // The org page at 375px: the owner's strip shows the score; alpha's shows the door.
    for (const [state, expectText] of [
      ['e2e/.auth/state-b.json', 'Gross 41'],
      ['e2e/.auth/state.json', 'Post a round'],
    ] as const) {
      const ctx = await browser.newContext({ storageState: state });
      try {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(`/club/${clubId}`);
        await expect(page.getByRole('heading', { name: 'Your week' })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(expectText).first()).toBeVisible();
        if (expectText === 'Post a round') {
          await expect(page.getByRole('link', { name: 'Post a round →' })).toHaveAttribute('href', '/app/sport/golf/rounds');
        }
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      } finally {
        await ctx.close();
      }
    }

    // Confirm → "final" bells with the rank, once; a second confirm bells nobody.
    res = await ownerApi.post(`${base}/golf-sync/confirm`, { data: { contestId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    if (bellsLive) {
      const confirmed = await bells('golf_league_round_confirmed');
      const ownerOwn = confirmed.filter(n => n.user_id === owner.id && !(n.metadata as { profile_id?: string }).profile_id);
      expect(ownerOwn.length).toBe(1);
      expect(ownerOwn[0].title).toContain('Week 2 in');
      expect(ownerOwn[0].title).toContain('is final');
      expect(ownerOwn[0].title).toMatch(/you're \d+(st|nd|rd|th) of \d+/);
      if (childId) expect(confirmed.filter(n => n.user_id === childId).length).toBe(1);
      res = await ownerApi.post(`${base}/golf-sync/confirm`, { data: { contestId } });
      expect(res.status()).toBe(200);
      expect((await bells('golf_league_round_confirmed')).length).toBe(confirmed.length);
    }
    res = await ownerApi.get(`/api/clubs/${clubId}/golf/mine`);
    mine = (await res.json()).entries;
    expect(mine[0].result?.provenance).toBe('league_verified');
  } finally {
    await ownerApi.dispose();
    await alphaApi.dispose();
    await admin.from('notifications').delete().contains('metadata', { contest_id: contestId });
    await admin.from('golf_holes').delete().in('round_id', roundIds);
    await admin.from('golf_rounds').delete().in('id', roundIds);
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
    if (childId) await deleteQaUser(childId);
  }
});
