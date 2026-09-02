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

// Golf leagues, part 1 (phase 6c G1): the rules + the shape a league round
// declares. A golf leaderboard picks Net/Gross scoring and a counting
// round; a round declares its course (a golf-linked venue), holes (nine
// is normal) and play window (172). Standings ascend and carry their
// direction + entrant type to every renderer; a null total renders "—",
// never 0; the public board heads the column "Player" and OMITS supervised
// athletes (the 6b people rule widened to standings). Manual score entry
// stays the fallback. Self-skips pre-172.

test('golf league rules: net league → windowed 9-hole round → manual scores → ascending board with direction/Player/omitted minor; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const athleteA = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);
  await resetRateBucket(admin, 'org-structure', owner.id);

  const probe = await admin.from('contests').select('holes').limit(1);
  test.skip(!!probe.error, `contests.holes missing — run migration 172 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Golf League Club ${stamp}`;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name, owner_profile_id: owner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { club_id: clubId, profile_id: athleteA.id, role: 'member', kind: 'follow' },
    { club_id: clubId, profile_id: athleteA.id, role: 'member', kind: 'roster' },
  ]);
  // A supervised child on the roster (only when the guardian flag is on):
  // present in the console, absent from every public board.
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(owner.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-minor-${stamp}` });
    await admin.from('memberships').insert([
      { club_id: clubId, profile_id: childId, role: 'member', kind: 'follow' },
      { club_id: clubId, profile_id: childId, role: 'member', kind: 'roster' },
    ]);
  }
  const { data: season } = await admin
    .from('seasons')
    .insert({ club_id: clubId, label: `2026 ${stamp}` })
    .select()
    .single();
  // The licensed row: a 9-hole course with a rated white tee.
  const { data: course } = await admin
    .from('golf_courses')
    .insert({
      external_source: 'seed',
      external_id: `qa-league-${stamp}`,
      name: `QA Nine ${stamp}`,
      city: 'Kanata',
      region: 'Ontario',
      country: 'Canada',
      total_par: 36,
      holes_count: 9,
      hole_data: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 350 }, handicap: i + 1 })),
      course_rating: { white: 35.2 },
      slope_rating: { white: 118 },
    })
    .select('id')
    .single();
  const courseId = course!.id as string;
  const { data: venue } = await admin
    .from('venues')
    .insert({ club_id: clubId, name: `QA Links ${stamp}`, golf_course_id: courseId })
    .select('id')
    .single();
  const venueId = venue!.id as string;

  const ownerApi = await apiAs('state-b.json');
  try {
    // Create the Net league from the console (the pickers exist only for
    // golf leaderboards).
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    let competitionId = '';
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/club/${clubId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await page.getByLabel('Competition name').fill('Tuesday Nine');
      await page.getByLabel('Competition season').selectOption(season!.id);
      await page.getByLabel('Competition sport').selectOption('golf');
      await page.getByLabel('Competition format').selectOption('leaderboard');
      await page.getByLabel('Scoring rule').selectOption('golf_net');
      await page.getByLabel('Counting round').selectOption('first');
      await page.getByLabel('Public competition').check();
      await page.getByRole('button', { name: 'Add competition' }).click();
      await expect(page.getByText('Tuesday Nine', { exact: true })).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
    const { data: comp } = await admin
      .from('competitions')
      .select('id, format, entrant_type, scoring_rule, config, status')
      .eq('club_id', clubId)
      .single();
    competitionId = comp!.id as string;
    expect(comp).toMatchObject({ format: 'leaderboard', entrant_type: 'athlete', scoring_rule: 'golf_net' });
    expect(comp!.config).toEqual({ golf: { pick: 'first' } });

    // Enter the athletes + activate through the API (the leaderboard spec
    // covers the picker UI).
    const base = `/api/clubs/${clubId}/competitions`;
    for (const profileId of [owner.id, athleteA.id, ...(childId ? [childId] : [])]) {
      const res = await ownerApi.post(`${base}/entries`, { data: { competitionId, profileId } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }
    let res = await ownerApi.patch(base, { data: { id: competitionId, status: 'active' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // A windowed 9-hole round at the linked course; a window that ends
    // before it starts is refused.
    res = await ownerApi.post(`${base}/${competitionId}/contests`, {
      data: { competitionId, round: 'Week 1', venueId, holes: 9, playFrom: '2026-09-08', playTo: '2026-09-01' },
    });
    expect(res.status()).toBe(400);
    res = await ownerApi.post(`${base}/${competitionId}/contests`, {
      data: { competitionId, round: 'Week 1', venueId, holes: 9, playFrom: '2026-09-01', playTo: '2026-09-07' },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const contestId = ((await res.json()).contest as { id: string }).id;
    const { data: contestRow } = await admin
      .from('contests')
      .select('holes, play_from, play_to, venue_id')
      .eq('id', contestId)
      .single();
    expect(contestRow).toMatchObject({ holes: 9, play_from: '2026-09-01', play_to: '2026-09-07', venue_id: venueId });

    // Manual entry is still the fallback: the owner nets 34 (gross 41),
    // Alpha nets 36 (gross 39); the child, if present, nets 30 — and must
    // still never reach a public board.
    const { data: participants } = await admin
      .from('contest_participants')
      .select('id, entry_id, competition_entries!inner(profile_id)')
      .eq('contest_id', contestId);
    const participantOf = new Map(
      (participants ?? []).map(p => {
        const entry = p.competition_entries as { profile_id: string } | { profile_id: string }[];
        const profileId = (Array.isArray(entry) ? entry[0] : entry).profile_id;
        return [profileId, p.id as string];
      })
    );
    res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: {
        contestId,
        results: [
          { participantId: participantOf.get(owner.id), score: 34, payload: { gross: 41, net: 34, holes: 9 } },
          { participantId: participantOf.get(athleteA.id), score: 36, payload: { gross: 39, net: 36, holes: 9 } },
          ...(childId ? [{ participantId: participantOf.get(childId), score: 30, payload: { gross: 33, net: 30, holes: 9 } }] : []),
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The public payload: ascending, Player header, RDS/NET/GRS, gross in
    // stats, the supervised child OMITTED (rank gap kept).
    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      let board: {
        direction: string;
        entrant_type: string;
        columns: { shortLabel: string }[];
        rows: { rank: number; entrant_name: string; points: number | null; stats: Record<string, number> }[];
      } | undefined;
      for (let i = 0; i < 8 && !board?.rows.length; i++) {
        const apiRes = await anonCtx.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}-${i}`);
        const payload = await apiRes.json();
        board = payload.competitions.find((c: { id: string }) => c.id === competitionId);
        if (!board?.rows.length) await new Promise(r => setTimeout(r, 2500));
      }
      expect(board, 'board present').toBeTruthy();
      expect(board!.direction).toBe('asc');
      expect(board!.entrant_type).toBe('athlete');
      expect(board!.columns.map(c => c.shortLabel)).toEqual(['RDS', 'NET', 'GRS']);
      const names = board!.rows.map(r => r.entrant_name);
      expect(names.some(n => n.startsWith('Edge'))).toBe(true);
      expect(names.some(n => n.startsWith('Casey'))).toBe(false);
      const ownerRow = board!.rows.find(r => r.points === 34)!;
      expect(ownerRow.stats.gross).toBe(41);
      // With the child omitted, the visible ranks still say who leads.
      const ranks = board!.rows.map(r => r.rank);
      expect(ranks[0]).toBeLessThan(ranks[1]);
      if (childId) expect(ranks[0]).toBe(2); // the omitted minor held rank 1

      // The public standings page: "Player", no "Team" header, no 0 for
      // a null total (nobody has one here, so assert the header only).
      const html = await (await anonCtx.request.get(`/club/${clubId}/standings`)).text();
      expect(html).toContain('>Player<');
      expect(html).not.toContain('>Casey');
    } finally {
      await anonCtx.close();
    }

    // Console: the child IS listed (managers see their roster), the round
    // carries its chips, and the page stays inside 375px.
    const ctx2 = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx2.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/club/${clubId}/competitions/${competitionId}`);
      await expect(page.getByRole('heading', { name: 'Tuesday Nine' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('9 holes · 2026-09-01 → 2026-09-07')).toBeVisible();
      if (childId) await expect(page.getByText('Casey Minor').first()).toBeVisible();
      await expect(page.getByLabel('Holes')).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx2.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('venues').delete().eq('club_id', clubId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('golf_courses').delete().eq('id', courseId);
    if (childId) await deleteQaUser(childId);
  }
});
