import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { pollUntil } from './helpers/isr';

/**
 * Events + formats leftovers, PR 1 — pools at phone width on Chromium and
 * WebKit. The owner (A — the mobile session's user, who must OWN the
 * league) pools four teams A, A, B, B from the org page's entry pills;
 * two games are scored through the API; the console's standings and the
 * org's public standings render one table per pool with the rank within
 * it. PR 2 grows this file with the round-robin generator and the seeding.
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

    // Two games, one per pool, scored through the API.
    const play = async (home: string, away: string, hs: number, as: number) => {
      const c = await api.post(`${base}/${competitionId}/contests`, { data: { competitionId, homeEntryId: entryOf(home), awayEntryId: entryOf(away), scheduledAt: '2030-06-01T19:00:00.000Z' } });
      expect(c.ok(), await readErrorBody(c)).toBe(true);
      const contest = ((await c.json()) as { contest: { id: string } }).contest;
      const d = (await (await api.get(`${base}/${competitionId}`)).json()) as Detail;
      const parts = d.contests.find(x => x.id === contest.id)!.participants;
      const r = await api.post(`${base}/${competitionId}/results`, { data: { contestId: contest.id, results: [{ participantId: parts.find(p => p.side === 'home')!.id, score: hs }, { participantId: parts.find(p => p.side === 'away')!.id, score: as }] } });
      expect(r.ok(), await readErrorBody(r)).toBe(true);
    };
    await play('Ash', 'Birch', 3, 1);
    await play('Dell', 'Cedar', 2, 2);
    const d = (await (await api.get(`${base}/${competitionId}`)).json()) as Detail;
    expect(d.pools).toEqual([{ pool: 'A', entryIds: expect.arrayContaining([entryOf('Ash'), entryOf('Birch')]) }, { pool: 'B', entryIds: expect.arrayContaining([entryOf('Cedar'), entryOf('Dell')]) }]);
    const row = (prefix: string) => d.standings.find(r => r.entry_id === entryOf(prefix))!;
    expect([row('Ash').rank, row('Ash').stats.pool, row('Birch').rank]).toEqual([1, 1, 2]);
    expect([row('Cedar').rank, row('Cedar').stats.pool, row('Dell').rank]).toEqual([1, 2, 1]);

    // The console's standings group by pool; no horizontal overflow at 390.
    await page.goto(`/app/org/league/${leagueId}/competitions/${competitionId}`);
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
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    await api.dispose();
  }
});
