import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// ICS schedule import (phase 6c I1, zero DDL): a pasted calendar export
// lands as contests through the same importer as the CSV path. TZID and Z
// starts convert to the caller's zone; RRULE and all-day events report per
// row; the venue lookup is scoped to THIS org (a same-named venue under
// another org must not resolve — the bug this round fixed).

test('ICS schedule import: dry-run 2+2 → commit instants, org venue resolved, decoy venue not; console toggle at 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-competitions', owner.id);

  const stamp = Date.now();
  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA ICS League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  const { data: other } = await admin
    .from('leagues')
    .insert({ name: `QA ICS Decoy League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const otherId = other!.id as string;
  try {
    await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const { data: homeTeam } = await admin.from('teams').insert({ league_id: leagueId, name: `ICS Blazers ${stamp}` }).select().single();
    const { data: awayTeam } = await admin.from('teams').insert({ league_id: leagueId, name: `ICS Comets ${stamp}` }).select().single();
    const { data: comp } = await admin
      .from('competitions')
      .insert({
        league_id: leagueId,
        season_id: season!.id,
        sport_key: 'ice_hockey',
        name: `ICS Cup ${stamp}`,
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
    // The org's own venue, and a same-named DECOY under the other org.
    const venueName = `ICS Arena ${stamp}`;
    const { data: ownVenue } = await admin.from('venues').insert({ league_id: leagueId, name: venueName }).select('id').single();
    await admin.from('venues').insert({ league_id: otherId, name: `Decoy Rink ${stamp}` });

    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:1@qa',
      `DTSTART;TZID=America/Toronto:20261003T190000`,
      `SUMMARY:ICS Blazers ${stamp} vs ICS Comets ${stamp}`,
      `LOCATION:${venueName}`,
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:2@qa',
      'DTSTART:20261010T230000Z',
      `SUMMARY:ICS Blazers ${stamp} @ ICS Comets ${stamp}`,
      `LOCATION:Decoy Rink ${stamp}`,
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:3@qa',
      'DTSTART;TZID=America/Toronto:20261017T190000',
      'RRULE:FREQ=WEEKLY;COUNT=4',
      `SUMMARY:ICS Blazers ${stamp} vs ICS Comets ${stamp}`,
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:4@qa',
      'DTSTART;VALUE=DATE:20261024',
      'SUMMARY:Season party',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const ownerApi = await apiAs('state-b.json');
    try {
      const base = `/api/leagues/${leagueId}/competitions/${compId}/schedule-import`;
      // Both or neither → 400.
      let res = await ownerApi.post(base, { data: { ics, csv: 'date,time,home,away' } });
      expect(res.status()).toBe(400);
      // Dry-run (the default): 2 dry-create + 2 row errors, nothing written.
      res = await ownerApi.post(base, { data: { ics, timezone: 'America/Toronto' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const dry = await res.json();
      expect(dry.dryRun).toBe(true);
      expect(dry.summary).toMatchObject({ rows: 4, created: 2, errors: 2, warnings: 1 });
      const errors = dry.report.filter((r: { error?: string }) => r.error).map((r: { error: string }) => r.error);
      expect(errors.some((e: string) => e.includes('recurring'))).toBe(true);
      expect(errors.some((e: string) => e.includes('all-day'))).toBe(true);
      const { count: before } = await admin.from('contests').select('id', { count: 'exact', head: true }).eq('competition_id', compId);
      expect(before).toBe(0);

      // Commit.
      res = await ownerApi.post(base, { data: { ics, timezone: 'America/Toronto', dryRun: false } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const done = await res.json();
      expect(done.summary).toMatchObject({ created: 2, errors: 2 });
      const { data: contests } = await admin
        .from('contests')
        .select('id, scheduled_at, venue_id')
        .eq('competition_id', compId)
        .order('scheduled_at');
      expect(contests).toHaveLength(2);
      // Toronto 19:00 on Oct 3 = 23:00Z; the Z instant verbatim.
      expect(contests![0].scheduled_at).toBe('2026-10-03T23:00:00+00:00');
      expect(contests![1].scheduled_at).toBe('2026-10-10T23:00:00+00:00');
      // The org's venue resolved; the decoy under another org did NOT.
      expect(contests![0].venue_id).toBe(ownVenue!.id);
      expect(contests![1].venue_id).toBeNull();
      // "@" swapped the sides: game 2's home is the Comets.
      const { data: parts } = await admin
        .from('contest_participants')
        .select('contest_id, side, competition_entries!inner(team_id)')
        .eq('contest_id', contests![1].id);
      const home = parts!.find(p => p.side === 'home')!;
      const homeTeamId = (Array.isArray(home.competition_entries) ? home.competition_entries[0] : home.competition_entries).team_id;
      expect(homeTeamId).toBe(awayTeam!.id);
      // Re-paste is a no-op.
      res = await ownerApi.post(base, { data: { ics, timezone: 'America/Toronto', dryRun: false } });
      expect((await res.json()).summary).toMatchObject({ created: 0, reused: 2 });

      // The CSV path still works through the same core.
      res = await ownerApi.post(base, {
        data: { csv: `date,time,home,away\n2026-11-01,19:00,ICS Blazers ${stamp},ICS Comets ${stamp}`, timezone: 'America/Toronto', dryRun: false },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).summary).toMatchObject({ created: 1 });
    } finally {
      await ownerApi.dispose();
    }

    // Console: the ICS toggle flips the expander at 375px.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/app/org/league/${leagueId}/competitions/${compId}`);
      await page.getByRole('button', { name: 'Import schedule CSV' }).click();
      await page.getByRole('button', { name: 'Paste ICS instead' }).click();
      await expect(page.getByLabel('Schedule ICS')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.from('venues').delete().in('league_id', [leagueId, otherId]);
    await admin.from('leagues').delete().in('id', [leagueId, otherId]);
  }
});
