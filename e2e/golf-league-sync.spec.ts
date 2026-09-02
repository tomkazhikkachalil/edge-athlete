import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Golf leagues, part 2 (phase 6c G2): the page fills itself. Members'
// posted rounds (seeded DIRECTLY into golf_rounds/golf_holes — the frozen
// composer is never driven) become a league round's results when they
// are complete, in the window, at the course, and their CARD counts the
// declared holes. Net comes from the tee's rating pair + the member's
// index; an unrated tee is gross-only with the reason. A manager confirms
// (self_reported → league_verified); a re-sync never overwrites that.
// Self-skips pre-172.

test('golf league sync: card-counted 9s qualify, 18s and out-of-window rounds do not; net vs gross-only; confirm; idempotent; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json'); // "Edge Bravo"
  const alpha = loadQaUser('user.json'); // "Edge Alpha"
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);

  const probe = await admin.from('contests').select('holes').limit(1);
  test.skip(!!probe.error, `contests.holes missing — run migration 172 (${probe.error?.message})`);

  const stamp = Date.now();
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Sync Club ${stamp}`, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'roster' },
  ]);
  const { data: season } = await admin
    .from('seasons')
    .insert({ club_id: clubId, label: `2026 ${stamp}` })
    .select()
    .single();
  // A 9-hole course; the white tee is rated, the gold tee is not.
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-sync-${stamp}`,
      name: `QA Sync Nine ${stamp}`,
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
    .insert({ club_id: clubId, name: `QA Sync Venue ${stamp}`, golf_course_id: courseId })
    .select('id')
    .single();
  const venueId = venue!.id as string;

  // A net league, best-of-week, one windowed 9-hole round.
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Sync League ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_net',
      config: { golf: { pick: 'best' } },
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
  const { data: contest } = await admin
    .from('contests')
    .insert({
      competition_id: competitionId,
      round: 'Week 1',
      venue_id: venueId,
      holes: 9,
      play_from: '2026-09-01',
      play_to: '2026-09-07',
      status: 'scheduled',
    })
    .select('id')
    .single();
  const contestId = contest!.id as string;
  const { data: participants } = await admin
    .from('contest_participants')
    .insert([
      { contest_id: contestId, entry_id: entryOf.get(owner.id), side: null },
      { contest_id: contestId, entry_id: entryOf.get(alpha.id), side: null },
    ])
    .select('id, entry_id');
  const participantOf = new Map(
    participants!.map(p => [[...entryOf.entries()].find(([, e]) => e === p.entry_id)![0], p.id as string])
  );

  // Members' rounds, straight into golf_rounds (+ golf_holes for the card).
  const insertRound = async (profileId: string, over: Record<string, unknown>, holeStrokes: number[] | null) => {
    const { data: r } = await admin
      .from('golf_rounds')
      .insert({
        profile_id: profileId,
        date: '2026-09-03',
        course: `QA Sync Nine ${stamp}`,
        course_id: courseId,
        tee: 'white',
        holes: 9,
        par: 36,
        gross_score: holeStrokes ? holeStrokes.reduce((a, b) => a + b, 0) : 40,
        is_complete: true,
        round_type: 'outdoor',
        ...over,
      })
      .select('id')
      .single();
    if (holeStrokes) {
      await admin.from('golf_holes').insert(
        holeStrokes.map((strokes, i) => ({ round_id: r!.id, hole_number: i + 1, par: 4, strokes }))
      );
    }
    return r!.id as string;
  };
  const roundIds: string[] = [];
  // The owner's handicap history: one rated 18 well before the window, so
  // a (provisional) index exists and net can compute. A member with no
  // history is gross-only with the "no handicap index yet" reason.
  roundIds.push(
    await insertRound(
      owner.id,
      { date: '2026-08-10', holes: 18, gross_score: 88, par: 72, course_rating: 70.1, slope_rating: 125 },
      Array(18).fill(5).map((v, i) => (i < 16 ? 5 : 4))
    )
  );
  // Owner: a 9-hole 41 (qualifies), a better 9-hole 38 later (best wins),
  // an 18-hole card in the window (rejected by the card), a 9 outside.
  roundIds.push(await insertRound(owner.id, { course_rating: 35.2, slope_rating: 118 }, [5, 4, 5, 4, 5, 4, 5, 4, 5]));
  roundIds.push(await insertRound(owner.id, { course_rating: 35.2, slope_rating: 118, date: '2026-09-05' }, [4, 4, 5, 4, 4, 4, 5, 4, 4]));
  roundIds.push(await insertRound(owner.id, { holes: 18, gross_score: 80 }, Array(18).fill(4)));
  roundIds.push(await insertRound(owner.id, { date: '2026-09-09' }, [4, 4, 4, 4, 4, 4, 4, 4, 4]));
  // Alpha: a 9 on the UNRATED gold tee, no rating pair → gross-only.
  roundIds.push(await insertRound(alpha.id, { tee: 'gold', course_rating: null, slope_rating: null }, [5, 5, 5, 5, 5, 5, 5, 5, 5]));

  const ownerApi = await apiAs('state-b.json');
  try {
    const base = `/api/clubs/${clubId}/competitions/${competitionId}`;
    let res = await ownerApi.post(`${base}/golf-sync`, { data: { contestId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const report = (await res.json()).reports[0] as { synced: number; kept: number; skipped: unknown[]; blocked?: string };
    expect(report.blocked).toBeUndefined();
    expect(report.synced).toBe(2);

    const { data: results } = await admin
      .from('contest_results')
      .select('participant_id, score, provenance, payload, entered_by')
      .eq('contest_id', contestId);
    const ownerRow = results!.find(r => r.participant_id === participantOf.get(owner.id))!;
    const alphaRow = results!.find(r => r.participant_id === participantOf.get(alpha.id))!;
    // Best of the two qualifying nines: gross 38; net = 38 − CH; holes from the card.
    const op = ownerRow.payload as Record<string, unknown>;
    expect(op.gross).toBe(38);
    expect(op.holes).toBe(9);
    expect(op.holesSource).toBe('card');
    expect(typeof op.courseHandicap).toBe('number');
    expect(op.net).toBe(38 - (op.courseHandicap as number));
    expect(ownerRow.score).toBe(op.net);
    expect(ownerRow.provenance).toBe('self_reported');
    expect(ownerRow.entered_by).toBe(owner.id);
    expect((op.roundRef as { roundId: string }).roundId).toBe(roundIds[2]);
    // Alpha: gross-only with the reason.
    const ap = alphaRow.payload as Record<string, unknown>;
    expect(ap.gross).toBe(45);
    expect(ap.noRating).toBe(true);
    expect('net' in ap).toBe(false);
    expect(alphaRow.score).toBe(45);

    // Console: the synced rows with chips; Confirm → verified + completed.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/club/${clubId}/competitions/${competitionId}`);
      await expect(page.getByRole('heading', { name: `Sync League ${stamp}` })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('no rating for this tee — gross only')).toBeVisible();
      await expect(page.getByText('posted').first()).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      await page.getByRole('button', { name: 'Confirm rounds' }).click();
      await expect(page.getByText('Round confirmed')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('verified').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
    const { data: after } = await admin
      .from('contest_results')
      .select('participant_id, provenance, confirmed_by')
      .eq('contest_id', contestId);
    expect(after!.every(r => r.provenance === 'league_verified' && r.confirmed_by === owner.id)).toBe(true);
    const { data: contestAfter } = await admin.from('contests').select('status').eq('id', contestId).single();
    expect(contestAfter!.status).toBe('completed');
    // Standings ascend on net; the gross-only row sorts by its gross.
    const { data: standings } = await admin
      .from('competition_standings')
      .select('entry_id, rank, points, stats')
      .eq('competition_id', competitionId)
      .order('rank');
    expect(standings![0].entry_id).toBe(entryOf.get(owner.id));
    expect(standings![0].points).toBe(ownerRow.score);
    expect((standings![0].stats as { gross: number }).gross).toBe(38);
    expect(standings![1].points).toBe(45);

    // Public payload: asc, athlete, both named (no minors here).
    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const apiRes = await anonCtx.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`);
      const board = (await apiRes.json()).competitions.find((c: { id: string }) => c.id === competitionId);
      expect(board.direction).toBe('asc');
      expect(board.entrant_type).toBe('athlete');
      expect(board.rows[0].points).toBe(ownerRow.score);
    } finally {
      await anonCtx.close();
    }

    // Idempotent + no downgrade: a re-sync keeps every confirmed row.
    res = await ownerApi.post(`${base}/golf-sync`, { data: { contestId } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const again = (await res.json()).reports[0] as { synced: number; kept: number };
    expect(again.synced).toBe(0);
    expect(again.kept).toBe(2);
    const { data: still } = await admin.from('contest_results').select('provenance').eq('contest_id', contestId);
    expect(still!.every(r => r.provenance === 'league_verified')).toBe(true);
  } finally {
    await ownerApi.dispose();
    await admin.from('golf_holes').delete().in('round_id', roundIds);
    await admin.from('golf_rounds').delete().in('id', roundIds);
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
  }
});
