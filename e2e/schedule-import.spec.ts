import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Schedule + historical results import (phase 6 R6, zero DDL): a pasted
// season lands as contests (calendar-mirror-eligible), scores mint
// provenance-'imported' results that feed standings, re-paste is a
// no-op, unknown teams error per-row.

test('schedule import: dry-run, commit with results, standings, idempotent re-run', async () => {
  test.setTimeout(120_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Sched League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27' })
      .select()
      .single();
    const { data: homeTeam } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Sched Blazers ${stamp}` })
      .select()
      .single();
    const { data: awayTeam } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Sched Comets ${stamp}` })
      .select()
      .single();
    const { data: comp } = await admin
      .from('competitions')
      .insert({
        league_id: leagueId,
        season_id: season!.id,
        sport_key: 'ice_hockey',
        name: `Sched Cup ${stamp}`,
        format: 'fixture',
        entrant_type: 'team',
        status: 'active',
        visibility: 'public',
      })
      .select()
      .single();
    const compId = comp!.id as string;
    await admin.from('competition_entries').insert([
      { competition_id: compId, team_id: homeTeam!.id, status: 'approved' },
      { competition_id: compId, team_id: awayTeam!.id, status: 'approved' },
    ]);

    const csv = [
      'date,time,home,away,home_score,away_score',
      `2026-10-03,19:00,Sched Blazers ${stamp},Sched Comets ${stamp},3,2`,
      `2026-10-10,19:00,Sched Comets ${stamp},Sched Blazers ${stamp},,`,
      `2026-10-17,19:00,Nobody FC,Sched Blazers ${stamp},,`, // unknown team → row error
    ].join('\n');

    const ownerApi = await apiAs('state-b.json');
    try {
      const url = `/api/leagues/${leagueId}/competitions/${compId}/schedule-import`;

      // Dry-run writes nothing.
      let res = await ownerApi.post(url, {
        data: { csv, timezone: 'America/Toronto' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const dry = await res.json();
      expect(dry.dryRun).toBe(true);
      expect(dry.summary).toMatchObject({ rows: 3, created: 2, errors: 1, withResults: 1 });
      const { count: preCount } = await admin
        .from('contests')
        .select('id', { count: 'exact', head: true })
        .eq('competition_id', compId);
      expect(preCount ?? 0).toBe(0);

      // Commit: 2 contests, one completed with imported results.
      res = await ownerApi.post(url, {
        data: { csv, timezone: 'America/Toronto', dryRun: false },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const committed = await res.json();
      expect(committed.summary).toMatchObject({ created: 2, errors: 1, withResults: 1 });

      const { data: contests } = await admin
        .from('contests')
        .select('id, status, scheduled_at')
        .eq('competition_id', compId)
        .order('scheduled_at');
      expect(contests).toHaveLength(2);
      expect(contests![0].status).toBe('completed');
      expect(contests![1].status).toBe('scheduled');
      // 19:00 Toronto (EDT, UTC-4) = 23:00Z.
      expect(new Date(contests![0].scheduled_at as string).toISOString()).toBe(
        '2026-10-03T23:00:00.000Z'
      );

      const { data: results } = await admin
        .from('contest_results')
        .select('score, provenance')
        .eq('contest_id', contests![0].id);
      expect(results).toHaveLength(2);
      for (const r of results!) expect(r.provenance).toBe('imported');
      expect(results!.map(r => r.score).sort()).toEqual([2, 3]);

      // Standings recomputed from the imported result.
      res = await ownerApi.get(`/api/leagues/${leagueId}/standings`);
      const standings = (await res.json()).competitions as {
        name: string;
        rows: { entrant_name: string; played: number }[];
      }[];
      const cup = standings.find(c => c.name === `Sched Cup ${stamp}`);
      expect(cup, 'standings row exists').toBeTruthy();
      expect(cup!.rows.some(r => r.played >= 1), 'imported result counted').toBe(true);

      // Re-paste: both known rows reuse, nothing new.
      res = await ownerApi.post(url, {
        data: { csv, timezone: 'America/Toronto', dryRun: false },
      });
      const rerun = await res.json();
      expect(rerun.summary).toMatchObject({ created: 0, reused: 2, errors: 1 });
      const { count: afterCount } = await admin
        .from('contests')
        .select('id', { count: 'exact', head: true })
        .eq('competition_id', compId);
      expect(afterCount).toBe(2);
    } finally {
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
