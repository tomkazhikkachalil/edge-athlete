import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaUser, deleteQaUser, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 8 P4 — the week hub. /org/{slug}/week shows every active golf
// league's current window (days left, who has posted, points so far) and
// how many ENTRANTS are on the course right now — a count only (visitors
// never see live-round names; members reach them through /live). A quiet
// round and a non-entrant's round are not counted. "This week" rides the
// nav and the home teaser for a golf org. 375px.

const stamp = Math.random().toString(36).slice(2, 8);
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('week hub: open window, posted count + points, on-course count (live entrant yes; quiet round + stranger no), nav + teaser; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const stranger = await createQaUser({ firstName: 'Sky', lastName: 'Strangertest' });
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-competitions', owner.id);

  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-week-${stamp}`,
      name: `QA Week Course ${stamp}`,
      total_par: 72,
      holes_count: 18,
      hole_data: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 380 }, handicap: i + 1 })),
      course_rating: { white: 71.2 },
      slope_rating: { white: 128 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Week Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select('id').single();
  const { data: venue } = await admin
    .from('venues')
    .insert({ club_id: clubId, name: `QA Week Links ${stamp}`, golf_course_id: courseId })
    .select('id')
    .single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Week League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_points',
      config: { golf: { pick: 'first', points: 'pga', score: 'gross' } },
      status: 'active',
      visibility: 'public',
    })
    .select('id')
    .single();
  const competitionId = comp!.id as string;
  const { data: entries } = await admin
    .from('competition_entries')
    .insert([
      { competition_id: competitionId, profile_id: owner.id, status: 'approved' },
      { competition_id: competitionId, profile_id: alpha.id, status: 'approved' },
    ])
    .select('id, profile_id');
  const entryOf = new Map(entries!.map(e => [e.profile_id as string, e.id as string]));

  // Live rounds at the course, dated today: the owner's (live), alpha's
  // (quiet for 8h → effectively over), a stranger's (live, not an entrant).
  const groupPostIds: string[] = [];
  const seedLiveRound = async (profileId: string, quietHours: number) => {
    const { data: gp } = await admin
      .from('group_posts')
      .insert({ creator_id: profileId, type: 'golf_round', title: `QA live ${stamp}`, date: isoDay(0), visibility: 'public', status: 'active' })
      .select('id')
      .single();
    const gpId = gp!.id as string;
    groupPostIds.push(gpId);
    await admin.from('golf_scorecard_data').insert({ group_post_id: gpId, course_name: `QA Week Course ${stamp}`, course_id: courseId, round_type: 'outdoor', holes_played: 18 });
    const { data: part } = await admin
      .from('group_post_participants')
      .insert({ group_post_id: gpId, profile_id: profileId, status: 'confirmed', role: 'participant' })
      .select('id')
      .single();
    await admin.from('golf_participant_scores').insert({
      participant_id: part!.id,
      entered_by: profileId,
      holes_completed: 3,
      updated_at: new Date(Date.now() - quietHours * 3_600_000).toISOString(),
    });
  };
  await seedLiveRound(owner.id, 0);
  await seedLiveRound(alpha.id, 8);
  await seedLiveRound(stranger.id, 0);

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const base = `/api/clubs/${clubId}/competitions`;
  try {
    // An OPEN window around today; the owner has posted (a manual result).
    let res = await ownerApi.post(`${base}/${competitionId}/contests`, {
      data: { competitionId, round: 'Week 4', venueId: venue!.id, holes: 18, playFrom: isoDay(-3), playTo: isoDay(3) },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const contestId = ((await res.json()).contest as { id: string }).id;
    const { data: parts } = await admin.from('contest_participants').select('id, entry_id').eq('contest_id', contestId);
    const participantOf = new Map((parts ?? []).map(p => [p.entry_id as string, p.id as string]));
    res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: { contestId, results: [{ participantId: participantOf.get(entryOf.get(owner.id)!), score: 79, payload: { gross: 79, holes: 18 } }] },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    let html = '';
    await expect
      .poll(
        async () => {
          const r = await anon.request.get(`/org/${subdomain}/week`);
          html = r.ok() ? await r.text() : '';
          return r.status();
        },
        { timeout: 30_000, intervals: [1000, 2000, 3000] }
      )
      .toBe(200);
    expect(html).toContain(`Week League ${stamp}`);
    expect(html).toContain('Week 4');
    expect(html).toContain('1 of 2 posted');
    expect(html).toMatch(/days left|Closes today/);
    expect(html).toContain(`QA Week Course ${stamp}`);
    expect(html).toContain('data-on-course="1"');
    expect(html).toContain('1 member on the course now');
    expect(html).toContain('See who');
    expect(html).toContain('>79<');
    expect(html).toContain('>100<'); // the week's points so far
    expect(html).toContain('as of');
    expect(html).not.toContain('Strangertest');

    // The nav and the home teaser carry "This week".
    const home = await (await anon.request.get(`/org/${subdomain}`)).text();
    expect(home).toContain('This week');
    expect(home).toContain(`/week"`);

    // 375px.
    const page = await anon.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/org/${subdomain}/week`);
    await expect(page.getByRole('heading', { name: 'This week', level: 1 })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'week hub: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('clubs').delete().eq('id', clubId);
    if (groupPostIds.length) await admin.from('group_posts').delete().in('id', groupPostIds);
    await admin.from('golf_courses').delete().eq('id', courseId);
    await deleteQaUser(stranger.id);
  }
});
