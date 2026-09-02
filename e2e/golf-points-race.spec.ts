import { test, expect } from '@playwright/test';
import { adminClient, apiAs, createQaChild, deleteQaUser, guardianFlagOn, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 8 P1 — the points race. A golf_points league's season, week by
// week: each completed round's points, the running total, rank after every
// week and the movement into the latest one — derived from contest_results
// (nothing stored). Points are awarded over the FULL field and supervised
// rows are omitted after, so the race, the public week and the standings
// table never disagree. Rendered on the public site's standings page and
// the /club/[id]/standings twin; 375px scroll containment.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('points race: weekly points → totals → ranks → movement; supervised entrant counted then omitted; site + twin at 375px', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-competitions', owner.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Race Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  let childId: string | null = null;
  if (guardianFlagOn()) {
    childId = await createQaChild(alpha.id, { firstName: 'Casey', lastName: 'Minor', handle: `qa-race-minor-${stamp}` });
  }
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
    ...(childId ? [{ club_id: clubId, profile_id: childId, role: 'member', kind: 'roster' }] : []),
  ]);
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select('id').single();
  const { data: venue } = await admin.from('venues').insert({ club_id: clubId, name: `QA Race Links ${stamp}` }).select('id').single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Race League ${stamp}`,
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

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const base = `/api/clubs/${clubId}/competitions`;
  try {
    const weeks = [
      ['Week 1', '2026-09-01', '2026-09-07'],
      ['Week 2', '2026-09-08', '2026-09-14'],
      ['Week 3', '2026-09-15', '2026-09-21'],
    ] as const;
    const contestIds: string[] = [];
    for (const [round, from, to] of weeks) {
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
    const post = async (contestId: string, scores: Array<[string, number]>) => {
      const parts = await participantOf(contestId);
      const res = await ownerApi.post(`${base}/${competitionId}/results`, {
        data: {
          contestId,
          results: scores.map(([profileId, gross]) => ({
            participantId: parts.get(entryOf.get(profileId)!),
            score: gross,
            payload: { gross, holes: 18 },
          })),
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    };
    // A round completes only when EVERY participant has a result (the
    // results route's rule), so the child — when present — posts every
    // week. Week 1: owner 78, alpha 82 (child 90) → 100 / 75 (/ 60).
    // Week 2: owner and alpha tie at 80 → 87.5 each (child 85 → 60).
    // Week 3: alpha 74 wins; with the child (78) second the owner (85) is
    // third → 100 / 75 / 60; without the child → 100 / 75.
    const withChild = (rows: Array<[string, number]>, childGross: number): Array<[string, number]> =>
      childId ? [...rows, [childId, childGross]] : rows;
    await post(contestIds[0], withChild([[owner.id, 78], [alpha.id, 82]], 90));
    await post(contestIds[1], withChild([[owner.id, 80], [alpha.id, 80]], 85));
    await post(contestIds[2], withChild([[owner.id, 85], [alpha.id, 74]], 78));

    const pub = await anon.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`);
    expect(pub.status()).toBe(200);
    const payload = (await pub.json()) as {
      competitions: {
        id: string;
        rows: { entrant_name: string; points: number | null; stats: Record<string, number> }[];
        golf?: { weeks: { round: string | null; results: { entrant_name: string; points?: number }[] }[] };
        race?: {
          weeks: { round: string | null }[];
          rows: { entrant_name: string; weekly: (number | null)[]; cumulative: number[]; rank: (number | null)[]; total: number; movement: number | null }[];
        };
      }[];
    };
    const board = payload.competitions.find(c => c.id === competitionId)!;
    expect(board.race?.weeks.map(w => w.round)).toEqual(['Week 1', 'Week 2', 'Week 3']);
    const ownerW3 = childId ? 60 : 75;
    const alphaW3 = 100;
    const ownerRow = board.race!.rows.find(r => r.weekly[0] === 100)!;
    const alphaRow = board.race!.rows.find(r => r.weekly[0] === 75)!;
    expect(ownerRow.weekly).toEqual([100, 87.5, ownerW3]);
    expect(alphaRow.weekly).toEqual([75, 87.5, alphaW3]);
    expect(ownerRow.cumulative).toEqual([100, 187.5, 187.5 + ownerW3]);
    expect(alphaRow.cumulative).toEqual([75, 162.5, 262.5]);
    // With the child: alpha 262.5 leads the owner's 247.5 (a lead change);
    // without: a dead heat at 262.5 (both rank 1).
    expect(ownerRow.rank).toEqual([1, 1, childId ? 2 : 1]);
    expect(alphaRow.rank).toEqual([2, 2, 1]);
    expect(ownerRow.movement).toBe(childId ? -1 : 0);
    expect(alphaRow.movement).toBe(1);
    // The child is COUNTED (the owner's week-3 points reflect it) and OMITTED (no row).
    expect(board.race!.rows).toHaveLength(2);
    expect(board.race!.rows[0].entrant_name).toBe(alphaRow.entrant_name);
    // The race agrees with the table and the public week.
    const tablePoints = board.rows.map(r => r.points as number).sort((a, b) => b - a);
    expect(tablePoints).toEqual([alphaRow.total, ownerRow.total].sort((a, b) => b - a));
    const week3 = board.golf!.weeks.find(w => w.round === 'Week 3')!;
    expect(week3.results.map(r => r.points)).toEqual([alphaW3, ownerW3]);

    // The public site's standings page draws the race; 375px scroll containment.
    let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const anonPage = await anon.newPage();
    await anonPage.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(async () => (await anon.request.get(`/org/${subdomain}/standings`)).status(), { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(200);
    await anonPage.goto(`/org/${subdomain}/standings`);
    await expect(anonPage.getByRole('heading', { name: 'Points race', level: 3 })).toBeVisible({ timeout: 20_000 });
    await expect(anonPage.getByRole('columnheader', { name: 'W3' })).toBeVisible();
    await expect(anonPage.getByRole('columnheader', { name: 'Move' })).toBeVisible();
    expect(await anonPage.evaluate(() => document.documentElement.scrollWidth), 'site standings: no horizontal overflow at 375px').toBeLessThanOrEqual(375);

    // The in-app twin.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/club/${clubId}/standings`);
    await expect(page.getByRole('heading', { name: 'Points race', level: 3 })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'twin: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('clubs').delete().eq('id', clubId);
    if (childId) await deleteQaUser(childId);
  }
});
