import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, resetRateBucket } from './helpers/qa-user';

// Phase 7 C6 — FedEx-style season points. A `golf_points` league ranks each
// round on strokes (gross here) and awards points by finishing position
// (the PGA table; ties share); the standings table sums the points
// (highest wins) with rounds, wins and gross alongside. Points are derived
// at recompute — the stored score stays strokes. The public week shows PTS,
// the site's leaders page shows "Most points", the console offers the rule
// with a preview. 375px on the console.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('season points: 78/82 → 100/75; a tie → 87.5 each; PTS on the public week; Most points on the site; console option; 375px', async ({
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
    .insert({ name: `QA Points Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);
  const { data: season } = await admin.from('seasons').insert({ club_id: clubId, label: `2026 ${stamp}` }).select('id').single();
  const { data: venue } = await admin.from('venues').insert({ club_id: clubId, name: `QA Points Links ${stamp}` }).select('id').single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      club_id: clubId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Points League ${stamp}`,
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

  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const base = `/api/clubs/${clubId}/competitions`;
  try {
    // Two windowed rounds through the API (participants minted from the entries).
    const contestIds: string[] = [];
    for (const [round, from, to] of [['Week 1', '2026-09-01', '2026-09-07'], ['Week 2', '2026-09-08', '2026-09-14']]) {
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

    // Week 1: 78 beats 82 → 100 / 75.
    let parts = await participantOf(contestIds[0]);
    let res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: {
        contestId: contestIds[0],
        results: [
          { participantId: parts.get(entryOf.get(owner.id)!), score: 78, payload: { gross: 78, holes: 18 } },
          { participantId: parts.get(entryOf.get(alpha.id)!), score: 82, payload: { gross: 82, holes: 18 } },
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const standingsRows = async () => {
      const { data } = await admin
        .from('competition_standings')
        .select('entry_id, rank, points, played, stats')
        .eq('competition_id', competitionId)
        .order('rank');
      return data ?? [];
    };
    let rows = await standingsRows();
    expect(rows.map(r => [r.entry_id, r.points, r.played, (r.stats as { win: number; gross: number }).win, (r.stats as { gross: number }).gross])).toEqual([
      [entryOf.get(owner.id), 100, 1, 1, 78],
      [entryOf.get(alpha.id), 75, 1, 0, 82],
    ]);
    // The stored score stays strokes — points are never written.
    const { data: stored } = await admin.from('contest_results').select('score, payload').eq('contest_id', contestIds[0]);
    expect(stored!.map(r => r.score).sort()).toEqual([78, 82]);
    expect(stored!.every(r => !('points' in (r.payload as object)))).toBe(true);

    // Week 2: a tie at 80 → (100 + 75) / 2 = 87.5 each; totals 187.5 / 162.5, wins 2 / 1.
    parts = await participantOf(contestIds[1]);
    res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: {
        contestId: contestIds[1],
        results: [
          { participantId: parts.get(entryOf.get(owner.id)!), score: 80, payload: { gross: 80, holes: 18 } },
          { participantId: parts.get(entryOf.get(alpha.id)!), score: 80, payload: { gross: 80, holes: 18 } },
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    rows = await standingsRows();
    expect(rows.map(r => [r.entry_id, r.rank, r.points, (r.stats as { win: number }).win])).toEqual([
      [entryOf.get(owner.id), 1, 187.5, 2],
      [entryOf.get(alpha.id), 2, 162.5, 1],
    ]);

    // The public standings payload: PTS columns, descending, the week's points.
    const pub = await anon.request.get(`/api/clubs/${clubId}/standings?_cb=${Date.now()}`);
    expect(pub.status()).toBe(200);
    const payload = (await pub.json()) as {
      competitions: {
        id: string;
        direction?: string;
        columns: { shortLabel: string }[];
        rows: { rank: number; points: number | null; stats: Record<string, number> }[];
        golf?: { weeks: { round: string | null; results: { gross: number | null; points?: number }[] }[] };
      }[];
    };
    const board = payload.competitions.find(c => c.id === competitionId)!;
    expect(board.columns.map(c => c.shortLabel)).toEqual(['RDS', 'PTS', 'W', 'GRS']);
    expect(board.rows[0].points).toBe(187.5);
    const week2 = board.golf!.weeks.find(w => w.round === 'Week 2')!;
    expect(week2.results.map(r => r.points)).toEqual([87.5, 87.5]);
    const week1 = board.golf!.weeks.find(w => w.round === 'Week 1')!;
    expect(week1.results.map(r => [r.gross, r.points])).toEqual([[78, 100], [82, 75]]);

    // The site's leaders page: "Most points".
    res = await ownerApi.post(`/api/clubs/${clubId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let leadersHtml = '';
    await expect
      .poll(
        async () => {
          const r = await anon.request.get(`/org/${subdomain}/leaders`);
          leadersHtml = r.ok() ? await r.text() : '';
          return r.status();
        },
        { timeout: 30_000, intervals: [1000, 2000, 3000] }
      )
      .toBe(200);
    expect(leadersHtml).toContain('Most points');
    expect(leadersHtml).toContain('187.5');

    // The console at 375px: the rule is offered, with its preview.
    await page.setViewportSize({ width: 375, height: 812 });
    // The default storageState is user A (a member) — the console needs the owner.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 375, height: 812 } });
    try {
      const p = await ownerCtx.newPage();
      await p.goto(`/app/org/club/${clubId}`);
      const rule = p.getByLabel('Scoring rule');
      await expect(rule).toBeVisible({ timeout: 20_000 });
      await rule.selectOption('golf_points');
      await expect(p.getByLabel('Points table')).toHaveValue('pga');
      await expect(p.getByLabel('Points base score')).toHaveValue('net');
      await expect(p.getByLabel('Points preview')).toContainText('1st 100 · 2nd 75 · 3rd 60');
      await p.getByLabel('Points table').selectOption('linear');
      await expect(p.getByLabel('Points preview')).toContainText('1st 20 · 2nd 19');
      const scrollWidth = await p.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'console: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
