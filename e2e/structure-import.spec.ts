import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Structure import (phase 6 R5, zero DDL): CSV paste → dry-run plan →
// commit → idempotent re-run. Divisions/teams/entries land by
// constraint, one bad row never aborts the batch.

test('structure import: dry-run, commit, idempotent re-run, per-row errors', async () => {
  test.setTimeout(120_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Import League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
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
    const seasonId = season!.id as string;

    const csv = [
      'division,team_name,age_band',
      `U13 A,Blazers ${stamp},U13`,
      `U13 A,Comets ${stamp},U13`,
      `U15 B,Rockets ${stamp},U15`,
      `,Missing Division ${stamp},`, // blank division → row error, batch continues
    ].join('\n');

    const ownerApi = await apiAs('state-b.json');
    try {
      const url = `/api/leagues/${leagueId}/structure-import`;

      // Header typos fail loudly with the expected list.
      let res = await ownerApi.post(url, {
        data: { seasonId, csv: 'division,teamname\nU13 A,X' },
      });
      expect(res.status()).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('team_name');

      // Dry-run (the DEFAULT) writes nothing.
      res = await ownerApi.post(url, { data: { seasonId, csv } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const dry = await res.json();
      expect(dry.dryRun).toBe(true);
      expect(dry.summary).toMatchObject({ rows: 4, errors: 1, divisionsCreated: 2, teamsCreated: 3, entriesCreated: 3 });
      const { count: preCount } = await admin
        .from('divisions')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', seasonId);
      expect(preCount ?? 0).toBe(0);

      // Commit.
      res = await ownerApi.post(url, { data: { seasonId, csv, dryRun: false } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const committed = await res.json();
      expect(committed.dryRun).toBe(false);
      expect(committed.summary).toMatchObject({ divisionsCreated: 2, teamsCreated: 3, entriesCreated: 3, errors: 1 });
      const { data: divisions } = await admin
        .from('divisions')
        .select('name, age_band')
        .eq('season_id', seasonId)
        .order('name');
      expect(divisions).toHaveLength(2);
      expect(divisions![0]).toMatchObject({ name: 'U13 A', age_band: 'U13' });
      const { count: entryCount } = await admin
        .from('team_entries')
        .select('id', { count: 'exact', head: true })
        .in('division_id', (await admin.from('divisions').select('id').eq('season_id', seasonId)).data!.map(d => d.id));
      expect(entryCount).toBe(3);

      // Idempotent re-run: everything reuses, nothing new.
      res = await ownerApi.post(url, { data: { seasonId, csv, dryRun: false } });
      const rerun = await res.json();
      expect(rerun.summary).toMatchObject({ divisionsCreated: 0, teamsCreated: 0, entriesCreated: 0 });
      expect(
        (rerun.report as { divisionAction: string }[]).filter(r => r.divisionAction === 'reuse')
      ).toHaveLength(3);
    } finally {
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
