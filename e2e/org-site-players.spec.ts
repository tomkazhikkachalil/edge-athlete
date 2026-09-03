import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaChild, deleteQaUser, guardianFlagOn, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 8 P2 — player pages. A club/league site gets a page per PUBLIC
// player (public + claimed + unsupervised — Tom's decision), keyed by the
// profile handle; their names on standings, the weeks, the race and the
// leaders become links. Everyone else stays masked, unlinked, page-less:
// a private member's handle 404s, a foreign handle 404s, a supervised
// child is omitted. The sitemap lists the public players. 375px.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('player pages: public member linked + paged; private member unlinked + 404; child omitted; foreign org 404; sitemap; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json'); // made PUBLIC below
  const alpha = loadQaUser('user.json'); // stays PRIVATE
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-competitions', owner.id);

  // QA users are minted WITHOUT a handle and private; the public member
  // gets both, the private member a handle only (so its 404 is a real one).
  const { data: ownerProfile } = await admin.from('profiles').select('handle, first_name, last_name, visibility').eq('id', owner.id).single();
  const { data: alphaProfile } = await admin.from('profiles').select('handle').eq('id', alpha.id).single();
  const ownerHandle = `qa-player-${stamp}`;
  const alphaHandle = `qa-private-${stamp}`;
  const ownerFullName = `${ownerProfile!.first_name} ${ownerProfile!.last_name}`;
  const priorVisibility = ownerProfile!.visibility as string;
  const priorHandles = { owner: (ownerProfile!.handle as string | null) ?? null, alpha: (alphaProfile!.handle as string | null) ?? null };
  await admin.from('profiles').update({ visibility: 'public', handle: ownerHandle }).eq('id', owner.id);
  await admin.from('profiles').update({ handle: alphaHandle }).eq('id', alpha.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Players Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  const { data: otherClub } = await admin
    .from('clubs')
    .insert({ name: `QA Other Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const otherClubId = otherClub!.id as string;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(alpha.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-players-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ...(childId ? [{ club_id: clubId, profile_id: childId, role: 'member', kind: 'roster' }] : []),
    { club_id: otherClubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
  ]);
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select('id').single();
  const { data: venue } = await admin.from('venues').insert({ club_id: clubId, name: `QA Players Links ${stamp}` }).select('id').single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Players League ${stamp}`,
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
      ...(childId ? [{ competition_id: competitionId, profile_id: childId, status: 'approved' }] : []),
    ])
    .select('id, profile_id');
  const entryOf = new Map(entries!.map(e => [e.profile_id as string, e.id as string]));

  // P3: the owner's OWN rounds — one shared publicly (a public post), one
  // private (a private post) — both rated so the handicap can compute.
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-players-${stamp}`,
      name: `QA Players Course ${stamp}`,
      total_par: 72,
      holes_count: 18,
      hole_data: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 380 }, handicap: i + 1 })),
      course_rating: { white: 71.2 },
      slope_rating: { white: 128 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  const roundIds: string[] = [];
  const postIds: string[] = [];
  const seedRound = async (date: string, gross: number, post: 'public' | 'private') => {
    const { data: r } = await admin
      .from('golf_rounds')
      .insert({
        profile_id: owner.id,
        date,
        course: `QA Players Course ${stamp}`,
        course_id: courseId,
        tee: 'white',
        holes: 18,
        par: 72,
        gross_score: gross,
        course_rating: 71.2,
        slope_rating: 128,
        is_complete: true,
        round_type: 'outdoor',
      })
      .select('id')
      .single();
    roundIds.push(r!.id as string);
    const { data: p } = await admin
      .from('posts')
      .insert({ profile_id: owner.id, caption: `QA ${stamp}`, visibility: post, status: 'published', sport_key: 'golf', round_id: r!.id })
      .select('id')
      .single();
    postIds.push(p!.id as string);
  };
  await seedRound('2026-08-20', 77, 'public');
  await seedRound('2026-08-27', 99, 'private');

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const base = `/api/clubs/${clubId}/competitions`;
  try {
    // One completed week (everyone posts) + one open week (only the owner so far).
    const contestIds: string[] = [];
    for (const [round, from, to] of [['Week 1', '2026-09-01', '2026-09-07'], ['Week 2', '2026-09-08', '2026-09-14']] as const) {
      const res = await ownerApi.post(`${base}/${competitionId}/contests`, {
        data: { competitionId, round, venueId: venue!.id, holes: 18, playFrom: from, playTo: to },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      contestIds.push(((await res.json()).contest as { id: string }).id);
    }
    const participantOf = async (contestId: string) => {
      const { data } = await admin.from('contest_participants').select('id, entry_id').eq('contest_id', contestId);
      return new Map((data ?? []).map(p => [p.entry_id as string, p.id as string]));
    };
    let parts = await participantOf(contestIds[0]);
    let res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: {
        contestId: contestIds[0],
        results: [
          { participantId: parts.get(entryOf.get(owner.id)!), score: 78, payload: { gross: 78, holes: 18 } },
          { participantId: parts.get(entryOf.get(alpha.id)!), score: 82, payload: { gross: 82, holes: 18 } },
          ...(childId ? [{ participantId: parts.get(entryOf.get(childId)!), score: 90, payload: { gross: 90, holes: 18 } }] : []),
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    parts = await participantOf(contestIds[1]);
    res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: { contestId: contestIds[1], results: [{ participantId: parts.get(entryOf.get(owner.id)!), score: 80, payload: { gross: 80, holes: 18 } }] },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The payload: the public member carries a handle, the private one does not, the child is absent.
    const pub = await anon.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`);
    const payload = (await pub.json()) as {
      competitions: {
        id: string;
        rows: { entrant_name: string; playerHandle?: string }[];
        golf?: { weeks: { round: string | null; results: { entrant_name: string; playerHandle?: string }[] }[] };
        race?: { rows: { entrant_name: string; playerHandle?: string }[] };
      }[];
    };
    const board = payload.competitions.find(c => c.id === competitionId)!;
    expect(board.rows).toHaveLength(2);
    expect(board.rows.find(r => r.playerHandle === ownerHandle)?.entrant_name).toBe(ownerFullName);
    expect(board.rows.filter(r => r.playerHandle).map(r => r.playerHandle)).toEqual([ownerHandle]);
    expect(board.race!.rows.filter(r => r.playerHandle).map(r => r.playerHandle)).toEqual([ownerHandle]);
    const week1 = board.golf!.weeks.find(w => w.round === 'Week 1')!;
    expect(week1.results.filter(r => r.playerHandle).map(r => r.playerHandle)).toEqual([ownerHandle]);
    expect(week1.results).toHaveLength(2);

    // The sites: the club with the league, and the other club (no entry → 404).
    const publishSite = async (id: string) => {
      let r = await ownerApi.post(`/api/clubs/${id}/site`);
      expect(r.status(), await readErrorBody(r)).toBe(200);
      const subdomain = ((await r.json()).site as { subdomain: string }).subdomain;
      r = await ownerApi.patch(`/api/clubs/${id}/site`, { data: { action: 'publish' } });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      return subdomain;
    };
    const subdomain = await publishSite(clubId);
    const otherSubdomain = await publishSite(otherClubId);
    let standingsHtml = '';
    await expect
      .poll(
        async () => {
          const r = await anon.request.get(`/org/${subdomain}/standings`);
          standingsHtml = r.ok() ? await r.text() : '';
          return r.status();
        },
        { timeout: 30_000, intervals: [1000, 2000, 3000] }
      )
      .toBe(200);
    expect(standingsHtml).toContain(`/players/${ownerHandle}"`);
    expect(standingsHtml).not.toContain(`/players/${alphaHandle}`);
    expect(standingsHtml).not.toContain('Casey M.');

    // The player page (and its twin): the public member; the private member 404s; a stranger 404s; the other org 404s.
    const playerRes = await anon.request.get(`/org/${subdomain}/players/${ownerHandle}`);
    expect(playerRes.status()).toBe(200);
    const playerHtml = await playerRes.text();
    expect(playerHtml).toContain(ownerFullName);
    expect(playerHtml).toContain(`Member of QA Players Club ${stamp}`);
    expect(playerHtml).toContain('1st of 2');
    expect(playerHtml).toContain('Week 1');
    expect(playerHtml).toContain('Week 2');
    expect(playerHtml).toContain('Full standings');
    expect(playerHtml).not.toContain('"@type":"Person"');
    // P3: the season strip, the handicap (both rated rounds count — the index
    // is the profile's public data), and ONLY the publicly shared round.
    expect(playerHtml).toContain('League rounds');
    expect(playerHtml).toContain('Handicap');
    expect(playerHtml).toContain('provisional');
    expect(playerHtml).toMatch(/data-points="2"/);
    expect(playerHtml).toContain('Recent rounds');
    expect(playerHtml).toContain('>77<');
    expect(playerHtml).not.toContain('>99<');
    expect(playerHtml).toContain('2026-08-20');
    expect(playerHtml).not.toContain('2026-08-27');
    expect((await anon.request.get(`/org/${subdomain}/players/${alphaHandle}`)).status()).toBe(404);
    expect((await anon.request.get(`/org/${subdomain}/players/nobody-${stamp}`)).status()).toBe(404);
    expect((await anon.request.get(`/org/${otherSubdomain}/players/${ownerHandle}`)).status()).toBe(404);

    // The leaders page links the public member ("Most points").
    const leaders = await anon.request.get(`/org/${subdomain}/leaders`);
    expect(leaders.status()).toBe(200);
    const leadersHtml = await leaders.text();
    expect(leadersHtml).toContain('Most points');
    expect(leadersHtml).toContain(`/players/${ownerHandle}"`);

    // The MAIN sitemap lists the public player only (publish purges its
    // tag). The per-site /org/{slug}/sitemap.xml twin is the custom-domain
    // route (rewritten from <domain>/sitemap.xml) and 404s on the apex in
    // production — not asserted here.
    const sm = await anon.request.get('/sitemap.xml');
    expect(sm.status()).toBe(200);
    const smText = await sm.text();
    expect(smText).toContain(`${subdomain}/players/${ownerHandle}`);
    expect(smText).not.toContain(`/players/${alphaHandle}`);

    // 375px.
    const page = await anon.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/org/${subdomain}/players/${ownerHandle}`);
    await expect(page.getByRole('heading', { name: ownerFullName, level: 1 })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'player page: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('profiles').update({ visibility: priorVisibility, handle: priorHandles.owner }).eq('id', owner.id);
    await admin.from('profiles').update({ handle: priorHandles.alpha }).eq('id', alpha.id);
    await admin.from('clubs').delete().in('id', [clubId, otherClubId]);
    if (postIds.length) await admin.from('posts').delete().in('id', postIds);
    if (roundIds.length) await admin.from('golf_rounds').delete().in('id', roundIds);
    await admin.from('golf_courses').delete().eq('id', courseId);
    if (childId) await deleteQaUser(childId);
  }
});
