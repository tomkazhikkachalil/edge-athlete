import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { pollUntil } from './helpers/isr';

/**
 * Events + formats leftovers, PR 1 — pools at phone width on Chromium and
 * WebKit. The owner (A — the mobile session's user, who must OWN the
 * league) pools four teams A, A, B, B from the org page's entry pills;
 * PR 2: the round-robin per pool from the console (Preview → Generate),
 * the scores through the API; the console's standings and the org's public
 * standings render one table per pool with the rank within it; the pools'
 * tables seed a bracket (A1, B1).
 */
type Detail = { pools: Array<{ pool: string; entryIds: string[] }>; standings: Array<{ entry_id: string; rank: number; points: number | null; stats: Record<string, number> }>; contests: Array<{ id: string; participants: Array<{ id: string; entry_id: string; side: string | null }> }> };

test('pools: the letter on the pills → two pooled games → one table per pool on the console and the public page @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  const stamp = Date.now();
  const { data: league, error } = await admin.from('leagues').insert({ name: `QA Pools League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id, visibility: 'public' }).select().single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  try {
    await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const { data: teams } = await admin.from('teams').insert(['Ash', 'Birch', 'Cedar', 'Dell'].map(n => ({ league_id: leagueId, name: `${n} ${stamp}` }))).select('id, name');
    const teamId = (prefix: string) => teams!.find(t => (t.name as string).startsWith(prefix))!.id as string;
    const { data: comp } = await admin.from('competitions').insert({ league_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', name: 'Pool Play', format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select().single();
    const competitionId = comp!.id as string;
    const { data: entries } = await admin.from('competition_entries').insert(['Ash', 'Birch', 'Cedar', 'Dell'].map(p => ({ competition_id: competitionId, team_id: teamId(p), status: 'approved' }))).select('id, team_id');
    const entryOf = (prefix: string) => entries!.find(e => e.team_id === teamId(prefix))!.id as string;
    const base = `/api/leagues/${leagueId}/competitions`;

    // The org page: the pool select on each pill.
    await page.goto(`/app/org/league/${leagueId}`);
    await expect(page.getByText('Pool Play', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Entries (4)' }).click();
    for (const [prefix, pool] of [['Ash', 'A'], ['Birch', 'A'], ['Cedar', 'B'], ['Dell', 'B']] as const) {
      await page.locator(`[data-entry-pool="${entryOf(prefix)}"]`).selectOption(pool);
      // The toast's text is the same for every save — the ROW is the proof.
      await expect.poll(async () => (await admin.from('competition_entries').select('pool').eq('id', entryOf(prefix)).single()).data?.pool, { timeout: 15_000 }).toBe(pool);
    }
    // A pool on a non-fixture is refused by name; an unknown letter by the schema.
    expect((await api.patch(`${base}/entries`, { data: { entryId: entryOf('Ash'), pool: 'Z' } })).status()).toBe(400);

    // PR 2: the round-robin per pool from the console — Preview reads two games, Generate mints them; the scores through the API.
    await page.goto(`/app/org/league/${leagueId}/competitions/${competitionId}`);
    await expect(page.getByRole('heading', { name: 'Pool Play' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-pools-panel]')).toBeVisible();
    await page.locator('[data-pools-preview]').click();
    await expect(page.locator('[data-pools-report]')).toContainText('Preview: 2 games', { timeout: 15_000 });
    await page.locator('[data-pools-generate]').click();
    await expect(page.getByText('2 games added')).toBeVisible({ timeout: 15_000 });
    let d = (await (await api.get(`${base}/${competitionId}`)).json()) as Detail;
    expect(d.contests).toHaveLength(2);
    const again = await api.post(`${base}/${competitionId}/pools/generate`, { data: { competitionId, dryRun: true } });
    expect(((await again.json()) as { report: { games: number; skipped: number } }).report).toMatchObject({ games: 0, skipped: 2 });
    const score = async (home: string, hs: number, as: number) => {
      const contest = d.contests.find(c => c.participants.some(p => p.side === 'home' && p.entry_id === entryOf(home)))!;
      const r = await api.post(`${base}/${competitionId}/results`, { data: { contestId: contest.id, results: [{ participantId: contest.participants.find(p => p.side === 'home')!.id, score: hs }, { participantId: contest.participants.find(p => p.side === 'away')!.id, score: as }] } });
      expect(r.ok(), await readErrorBody(r)).toBe(true);
    };
    const homeOf = (prefixes: string[]) => prefixes.find(p => d.contests.some(c => c.participants.some(x => x.side === 'home' && x.entry_id === entryOf(p))))!;
    const homeA = homeOf(['Ash', 'Birch']);
    const homeB = homeOf(['Cedar', 'Dell']);
    await score(homeA, 3, 1);
    await score(homeB, 2, 0);
    d = (await (await api.get(`${base}/${competitionId}`)).json()) as Detail;
    expect(d.pools).toEqual([{ pool: 'A', entryIds: expect.arrayContaining([entryOf('Ash'), entryOf('Birch')]) }, { pool: 'B', entryIds: expect.arrayContaining([entryOf('Cedar'), entryOf('Dell')]) }]);
    const row = (prefix: string) => d.standings.find(r => r.entry_id === entryOf(prefix))!;
    expect([row(homeA).rank, row(homeA).stats.pool]).toEqual([1, 1]);
    expect([row(homeB).rank, row(homeB).stats.pool]).toEqual([1, 2]);

    // The console's standings group by pool; no horizontal overflow at 390.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Pool Play' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-standings-pool="A"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-standings-pool="B"]')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at phone width').toBeLessThanOrEqual(page.viewportSize()!.width);

    // The public standings: one table per pool (ISR — poll until the revalidation lands).
    await pollUntil(
      async () => (await page.request.get(`/league/${leagueId}/standings`)).text(),
      html => html.includes('data-standings-pool="A"') && html.includes('data-standings-pool="B"'),
      { label: 'the public standings show both pools' }
    );
    await page.goto(`/league/${leagueId}/standings`);
    await expect(page.locator('[data-standings-pool="A"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-standings-pool="A"]')).toContainText(`Ash ${stamp}`);
    await expect(page.locator('[data-standings-pool="B"]')).toContainText(`Cedar ${stamp}`);

    // PR 2: seed a bracket from the pools' tables — A1, B1 onto the target; a second pass re-writes the same seeds.
    const { data: bracket } = await admin.from('competitions').insert({ league_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', name: 'Playoffs', format: 'bracket', entrant_type: 'team', status: 'active', visibility: 'public' }).select().single();
    const bracketId = bracket!.id as string;
    await page.goto(`/app/org/league/${leagueId}/competitions/${competitionId}`);
    await expect(page.locator('[data-pools-target]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-pools-target]').focus();
    await expect(page.locator('[data-pools-target] option', { hasText: 'Playoffs' })).toHaveCount(1, { timeout: 15_000 });
    await page.locator('[data-pools-target]').selectOption(bracketId);
    await page.locator('[data-pools-per-pool]').fill('1');
    await page.locator('[data-pools-seed]').click();
    await expect(page.getByText('Seeds written')).toBeVisible({ timeout: 15_000 });
    const { data: seeded } = await admin.from('competition_entries').select('team_id, seed').eq('competition_id', bracketId).order('seed');
    expect((seeded ?? []).map(e => [e.team_id, e.seed])).toEqual([[teamId(homeA), 1], [teamId(homeB), 2]]);
    const wrongTarget = await api.post(`${base}/${competitionId}/pools/seed`, { data: { competitionId, targetCompetitionId: competitionId, perPool: 1 } });
    expect(((await wrongTarget.json()) as { reason?: string }).reason).toBe('target_not_bracket');
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    await api.dispose();
  }
});
