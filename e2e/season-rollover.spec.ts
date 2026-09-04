import { test, expect } from '@playwright/test';
import {
  adminClient,
  apiAs,
  loadQaUser,
  readErrorBody,
  registrationFlagOnTarget,
} from './helpers/qa-user';

// Season rollover (phase 5.5, mig 165): one button clones the structure
// forward — new season, cloned divisions + programs, the SAME teams
// re-entered — and closes out the old one (archived + windows shut).
// Rosters start empty by construction; the old season's history is
// untouched. The console carries the button and the Archived chip.
test('season rollover: clone forward, archive the old, console controls; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('seasons').select('archived_at').limit(1);
  test.skip(!!probe.error, `archived_at missing — run migration 165 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Rollover League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);
    const { data: oldSeason } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27', starts_on: '2026-09-01' })
      .select()
      .single();
    const { data: divisions } = await admin
      .from('divisions')
      .insert([
        {
          league_id: leagueId,
          season_id: oldSeason!.id,
          sport_key: 'ice_hockey',
          name: `U11 A ${stamp}`,
          age_band: 'U11',
        },
        {
          league_id: leagueId,
          season_id: oldSeason!.id,
          sport_key: 'ice_hockey',
          name: `U13 A ${stamp}`,
          age_band: 'U13',
        },
      ])
      .select();
    const { data: teams } = await admin
      .from('teams')
      .insert([
        { league_id: leagueId, name: `Blazers ${stamp}` },
        { league_id: leagueId, name: `Comets ${stamp}` },
      ])
      .select();
    const d1 = divisions!.find(d => d.name === `U11 A ${stamp}`)!;
    const d2 = divisions!.find(d => d.name === `U13 A ${stamp}`)!;
    await admin.from('team_entries').insert([
      { team_id: teams![0].id, division_id: d1.id },
      { team_id: teams![1].id, division_id: d2.id },
    ]);
    await admin.from('programs').insert({
      season_id: oldSeason!.id,
      sport_key: 'ice_hockey',
      type: 'camp',
      name: `Summer Camp ${stamp}`,
    });

    const ownerApi = await apiAs('state-b.json');
    const athleteApi = await apiAs('state.json');
    try {
      // An open window on the old season — rollover must close it.
      let res = await ownerApi.post(`/api/leagues/${leagueId}/registration-windows`, {
        data: { seasonId: oldSeason!.id, opensAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // Org staff program (178): a staff grant pinned to the OLD season
      // expires at rollover (masterplan §5) — seeded here, asserted below.
      // Self-tolerant pre-178 (the insert fails → staffExpired reads 0).
      const staffSeed = await admin.from('memberships').insert({
        league_id: leagueId, profile_id: loadQaUser('user.json').id, kind: 'staff', role: 'staff',
        scope_type: 'org', season_id: oldSeason!.id, sections: ['teams'],
      }).select('id').single();
      const staffSeeded = !staffSeed.error;

      // The one button.
      res = await ownerApi.post(`/api/leagues/${leagueId}/structure/rollover`, {
        data: { seasonId: oldSeason!.id, label: '2027-28', startsOn: '2027-09-01' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const body = await res.json();
      expect(body.archivedOld).toBe(true);
      if (staffSeeded) {
        expect(body.staffExpired).toBe(1);
        const { data: expiredRow } = await admin.from('memberships').select('expires_at').eq('id', staffSeed.data!.id).single();
        expect(expiredRow!.expires_at).not.toBeNull();
        const { data: trail } = await admin.from('org_staff_audit').select('action').eq('league_id', leagueId).eq('season_id', oldSeason!.id);
        expect((trail ?? []).map(t => t.action)).toEqual(['expired']);
      }
      expect(body.cloned).toMatchObject({ divisions: 2, programs: 1, teamEntries: 2 });
      const newSeasonId = body.season.id as string;

      // Duplicate label → 409, nothing half-created.
      res = await ownerApi.post(`/api/leagues/${leagueId}/structure/rollover`, {
        data: { seasonId: oldSeason!.id, label: '2027-28' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(409);

      // DB truth: cloned divisions carry the SAME teams; the old season is
      // archived with its window shut; the new season has no roster rows.
      const { data: newDivisions } = await admin
        .from('divisions')
        .select('id, name')
        .eq('season_id', newSeasonId);
      expect(newDivisions).toHaveLength(2);
      const { data: newEntries } = await admin
        .from('team_entries')
        .select('team_id, division_id')
        .in('division_id', newDivisions!.map(d => d.id));
      expect(new Set(newEntries!.map(e => e.team_id))).toEqual(
        new Set(teams!.map(t => t.id))
      );
      const { data: archivedRow } = await admin
        .from('seasons')
        .select('archived_at')
        .eq('id', oldSeason!.id)
        .single();
      expect(archivedRow!.archived_at).not.toBeNull();
      const { data: oldWindows } = await admin
        .from('registration_windows')
        .select('closes_at')
        .eq('season_id', oldSeason!.id);
      expect(oldWindows!.every(w => w.closes_at !== null)).toBe(true);
      const { count: newRosterRows } = await admin
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('kind', 'roster')
        .eq('season_id', newSeasonId);
      expect(newRosterRows).toBe(0);

      // The archived season refuses a new window…
      res = await ownerApi.post(`/api/leagues/${leagueId}/registration-windows`, {
        data: { seasonId: oldSeason!.id, opensAt: new Date().toISOString() },
      });
      expect(res.status(), await readErrorBody(res)).toBe(400);

      // …and (flag permitting) leaves the offerings + blocks registration.
      if (await registrationFlagOnTarget(athleteApi)) {
        res = await athleteApi.get(`/api/leagues/${leagueId}/offerings`);
        expect(res.status(), await readErrorBody(res)).toBe(200);
        const offered = (await res.json()).seasons as { id: string }[];
        expect(offered.some(s => s.id === oldSeason!.id)).toBe(false);
        expect(offered.some(s => s.id === newSeasonId)).toBe(true);
        res = await athleteApi.post(`/api/leagues/${leagueId}/registrations`, {
          data: { seasonId: oldSeason!.id, divisionId: d1.id, answers: {} },
        });
        expect(res.status(), await readErrorBody(res)).toBe(409); // window closed
      }
    } finally {
      await ownerApi.dispose();
      await athleteApi.dispose();
    }

    // Console: the Archived chip on the old season, Roll forward on the
    // new one; 375px holds.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Archived', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Roll forward' })).toBeVisible();

      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText('Archived', { exact: true })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.from('org_staff_audit').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
