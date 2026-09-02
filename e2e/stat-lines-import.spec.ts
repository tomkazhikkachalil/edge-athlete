import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  createQaUser,
  deleteQaUser,
  loadQaUser,
  readErrorBody,
  resetRateBucket,
} from './helpers/qa-user';

// Per-athlete stat-line CSV import (phase 6c I2, zero DDL): rows resolve
// to a game (date + matchup in the manager's zone), a side, and a roster
// athlete by exact normalized name — unique or a row error, never a
// guess. Writes go through the same attribution gate as the per-game
// panel, stamped 'imported'. Owner authority only.

test('stat-line import: dry-run, ambiguous + off-roster + unknown-game rows error, commit lands imported lines; console at 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);

  const probe = await admin.from('contest_stat_lines').select('id').limit(1);
  test.skip(!!probe.error, `contest_stat_lines missing — run migration 157 (${probe.error?.message})`);

  // Two rostered players whose names normalize to the same thing.
  const jose1 = await createQaUser({ firstName: 'José', lastName: 'Núñez', displayName: 'José Núñez' });
  const jose2 = await createQaUser({ firstName: 'Jose', lastName: 'Nunez', displayName: 'Jose Nunez' });

  const stamp = Date.now();
  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Stats Import League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  try {
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const { data: homeTeam } = await admin.from('teams').insert({ league_id: leagueId, name: `Stats Blazers ${stamp}` }).select().single();
    const { data: awayTeam } = await admin.from('teams').insert({ league_id: leagueId, name: `Stats Comets ${stamp}` }).select().single();
    const homeId = homeTeam!.id as string;
    const awayId = awayTeam!.id as string;
    // Owner + roster edges (ONE homogeneous key set): alpha + both Josés on
    // the home team; the owner on the away team.
    const mem = await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active', scope_type: 'org', scope_id: null },
      { league_id: leagueId, profile_id: owner.id, role: 'member', kind: 'roster', status: 'active', scope_type: 'team', scope_id: awayId },
      { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'roster', status: 'active', scope_type: 'team', scope_id: homeId },
      { league_id: leagueId, profile_id: jose1.id, role: 'member', kind: 'roster', status: 'active', scope_type: 'team', scope_id: homeId },
      { league_id: leagueId, profile_id: jose2.id, role: 'member', kind: 'roster', status: 'active', scope_type: 'team', scope_id: homeId },
    ]);
    expect(mem.error, mem.error?.message).toBeNull();
    // The names the importer will see (full_name, else first + last).
    const { data: names } = await admin.from('profiles').select('id, full_name, first_name, last_name').in('id', [owner.id, alpha.id]);
    const nameOf = (id: string) => {
      const p = names!.find(n => n.id === id)!;
      return (p.full_name as string | null) || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    };
    const ALPHA = nameOf(alpha.id);
    const BRAVO = nameOf(owner.id);
    const { data: comp } = await admin
      .from('competitions')
      .insert({
        league_id: leagueId,
        season_id: season!.id,
        sport_key: 'ice_hockey',
        name: `Stats Cup ${stamp}`,
        format: 'fixture',
        entrant_type: 'team',
        status: 'active',
        visibility: 'public',
      })
      .select()
      .single();
    const compId = comp!.id as string;
    const { data: entries } = await admin
      .from('competition_entries')
      .insert([
        { competition_id: compId, team_id: homeId, status: 'approved' },
        { competition_id: compId, team_id: awayId, status: 'approved' },
      ])
      .select('id, team_id');
    const entryOf = new Map(entries!.map(e => [e.team_id as string, e.id as string]));
    // One game: Oct 3 2026, 19:00 Toronto (= 23:00Z).
    const { data: contest } = await admin
      .from('contests')
      .insert({ competition_id: compId, scheduled_at: '2026-10-03T23:00:00Z', status: 'completed' })
      .select('id')
      .single();
    await admin.from('contest_participants').insert([
      { contest_id: contest!.id, entry_id: entryOf.get(homeId), side: 'home' },
      { contest_id: contest!.id, entry_id: entryOf.get(awayId), side: 'away' },
    ]);

    const H = `Stats Blazers ${stamp}`;
    const A = `Stats Comets ${stamp}`;
    const csv = [
      'date,home,away,team,player,goals,assists',
      `2026-10-03,${H},${A},${H},${ALPHA},2,1`, // clean
      `2026-10-03,${H},${A},${A},${BRAVO},0,2`, // clean, away side
      `2026-10-03,${H},${A},${H},Jose Nunez,1,0`, // ambiguous
      `2026-10-03,${H},${A},${H},${BRAVO},1,0`, // wrong team (the owner is on the away roster)
      `2026-10-04,${H},${A},${H},${ALPHA},1,0`, // no game that day
      `2026-10-03,${H},${A},${H},${ALPHA},99,0`, // out of range (goals max 20)
    ].join('\n');

    const ownerApi = await apiAs('state-b.json');
    const memberApi = await apiAs('state.json');
    try {
      const base = `/api/leagues/${leagueId}/competitions/${compId}/stat-lines-import`;
      // A rostered member (not a manager) is refused by the manager gate.
      let res = await memberApi.post(base, { data: { csv, timezone: 'America/Toronto' } });
      expect([401, 403]).toContain(res.status());
      // Bad header → 400 with the expected list.
      res = await ownerApi.post(base, { data: { csv: 'date,home,away,team,player,touchdowns\n', timezone: 'America/Toronto' } });
      expect(res.status()).toBe(400);
      // Dry-run: 2 import, 4 errors, nothing written.
      res = await ownerApi.post(base, { data: { csv, timezone: 'America/Toronto' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const dry = await res.json();
      expect(dry.dryRun).toBe(true);
      expect(dry.summary, JSON.stringify(dry.report)).toMatchObject({ rows: 6, imported: 2, errors: 4, games: 1 });
      const errs = dry.report.filter((r: { error?: string }) => r.error).map((r: { row: number; error: string }) => `${r.row}:${r.error}`);
      expect(errs.find((e: string) => e.startsWith('3:'))).toContain('more than one player');
      expect(errs.find((e: string) => e.startsWith('4:'))).toContain('roster');
      expect(errs.find((e: string) => e.startsWith('5:'))).toContain('no game between those teams');
      expect(errs.find((e: string) => e.startsWith('6:'))).toContain('out of range');
      const { count: before } = await admin.from('contest_stat_lines').select('id', { count: 'exact', head: true }).eq('contest_id', contest!.id);
      expect(before).toBe(0);

      // Commit: the two clean rows land as imported lines on the right teams.
      res = await ownerApi.post(base, { data: { csv, timezone: 'America/Toronto', dryRun: false } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).summary).toMatchObject({ imported: 2, errors: 4 });
      const { data: lines } = await admin
        .from('contest_stat_lines')
        .select('profile_id, team_id, provenance, stats, entered_by')
        .eq('contest_id', contest!.id);
      expect(lines).toHaveLength(2);
      const alphaLine = lines!.find(l => l.profile_id === alpha.id)!;
      expect(alphaLine).toMatchObject({ team_id: homeId, provenance: 'imported', entered_by: owner.id, stats: { goals: 2, assists: 1 } });
      const ownerLine = lines!.find(l => l.profile_id === owner.id)!;
      expect(ownerLine).toMatchObject({ team_id: awayId, provenance: 'imported', stats: { goals: 0, assists: 2 } });
      // The per-game panel's aggregate labels them imported.
      const agg = await ownerApi.get(`/api/leagues/${leagueId}/competitions/${compId}/stat-lines`);
      expect(agg.status()).toBe(200);
      const aggBody = (await agg.json()) as { lines: { profile_id: string; provenance: string }[] };
      expect(aggBody.lines.find(l => l.profile_id === alpha.id)?.provenance).toBe('imported');
    } finally {
      await ownerApi.dispose();
      await memberApi.dispose();
    }

    // Console: the expander + report at 375px.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/league/${leagueId}/competitions/${compId}`);
      await page.getByRole('button', { name: 'Import player stats CSV' }).click();
      await expect(page.getByLabel('Player stats CSV')).toBeVisible();
      await page.getByLabel('Player stats CSV').fill(csv);
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByText(/Preview: 2 stat lines/)).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    await deleteQaUser(jose1.id);
    await deleteQaUser(jose2.id);
  }
});
