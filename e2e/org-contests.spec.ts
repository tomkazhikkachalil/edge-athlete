import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Contests + results + the calendar mirror (phase 2, round 2): the owner
// schedules a game from the competition console, publishes it to the
// calendar, and enters "3 – 2"; DB truth pins the mirror event's scope,
// the server-stamped provenance, and the auto-complete; canceling the
// game cancels its event (one-way sync).
test('competition console: schedule → publish → score; mirror syncs; member locked out; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('contests').select('id').limit(1);
  test.skip(!!probe.error, `contests missing — run migration 152 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Contest League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    { league_id: leagueId, profile_id: member.id, role: 'member' },
  ]);
  const { data: season } = await admin
    .from('seasons')
    .insert({ league_id: leagueId, label: '2026-27' })
    .select()
    .single();
  const { data: teams } = await admin
    .from('teams')
    .insert([
      { league_id: leagueId, name: `Blazers ${stamp}` },
      { league_id: leagueId, name: `Comets ${stamp}` },
    ])
    .select();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'ice_hockey',
      name: 'House League',
      format: 'fixture',
      entrant_type: 'team',
      status: 'active',
      visibility: 'public',
    })
    .select()
    .single();
  const competitionId = comp!.id as string;
  await admin.from('competition_entries').insert(
    teams!.map(t => ({ competition_id: competitionId, team_id: t.id }))
  );

  try {
    const ctxOwner = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctxOwner.newPage();
      await page.goto(`/app/org/league/${leagueId}/competitions/${competitionId}`);
      await expect(page.getByRole('heading', { name: 'House League' })).toBeVisible({
        timeout: 20_000,
      });

      // Schedule a game.
      await page.getByLabel('Home side').selectOption({ label: `Blazers ${stamp}` });
      await page.getByLabel('Away side').selectOption({ label: `Comets ${stamp}` });
      await page.getByLabel('Game time').fill('2026-09-05T18:00');
      await page.getByLabel('Round label').fill('Week 1');
      await page.getByRole('button', { name: 'Add game' }).click();
      await expect(page.getByText(`Blazers ${stamp} vs Comets ${stamp}`)).toBeVisible({
        timeout: 15_000,
      });

      // Publish to the calendar.
      await page.getByRole('button', { name: 'Publish to calendar' }).click();
      await expect(page.getByText('on calendar', { exact: false })).toBeVisible({
        timeout: 15_000,
      });

      // Enter the score — one save for both sides.
      await page.getByRole('button', { name: 'Enter score' }).click();
      await page.getByLabel(`Score for Blazers ${stamp}`).fill('3');
      await page.getByLabel(`Score for Comets ${stamp}`).fill('2');
      await page.getByRole('button', { name: 'Save result' }).click();
      await expect(page.getByText(`Blazers ${stamp} 3 – 2 Comets ${stamp}`)).toBeVisible({
        timeout: 15_000,
      });

      // 375px: the schedule stays usable, no horizontal overflow.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText(`Blazers ${stamp} 3 – 2 Comets ${stamp}`)).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctxOwner.close();
    }

    // DB truth: contest completed; results carry the SERVER-stamped
    // provenance; the mirror event is org-scoped 'game' and linked.
    const { data: contest } = await admin
      .from('contests')
      .select('id, status, event_id, scheduled_at')
      .eq('competition_id', competitionId)
      .single();
    expect(contest!.status).toBe('completed');
    expect(contest!.event_id).not.toBeNull();
    const { data: results } = await admin
      .from('contest_results')
      .select('score, provenance, entered_by, dispute_status')
      .eq('contest_id', contest!.id)
      .order('score', { ascending: false });
    expect(results).toHaveLength(2);
    expect(results![0]).toMatchObject({ score: 3, provenance: 'league_verified', entered_by: owner.id });
    expect(results![1].score).toBe(2);
    const { data: event } = await admin
      .from('events')
      .select('title, category, league_id, club_id, division_id, status, starts_at')
      .eq('id', contest!.event_id!)
      .single();
    expect(event).toMatchObject({
      category: 'game',
      league_id: leagueId,
      club_id: null,
      division_id: null,
      status: 'active',
    });
    expect(event!.title).toBe(`Blazers ${stamp} vs Comets ${stamp} — House League`);

    // One-way mirror: canceling the contest cancels its event.
    const ownerApi = await apiAs('state-b.json');
    try {
      const cancelRes = await ownerApi.patch(
        `/api/leagues/${leagueId}/competitions/${competitionId}/contests`,
        { data: { id: contest!.id, status: 'canceled' } }
      );
      expect(cancelRes.status(), await readErrorBody(cancelRes)).toBe(200);
    } finally {
      await ownerApi.dispose();
    }
    const { data: cancelledEvent } = await admin
      .from('events')
      .select('status, cancelled_at')
      .eq('id', contest!.event_id!)
      .single();
    expect(cancelledEvent!.status).toBe('cancelled');
    expect(cancelledEvent!.cancelled_at).not.toBeNull();

    // Member: the detail route 403s.
    const memberApi = await apiAs('state.json');
    try {
      const res = await memberApi.get(
        `/api/leagues/${leagueId}/competitions/${competitionId}`
      );
      expect(res.status(), await readErrorBody(res)).toBe(403);
    } finally {
      await memberApi.dispose();
    }
  } finally {
    // League delete cascades competitions → contests → participants →
    // results; the mirror event's organizer is the QA owner whose
    // deletion cascades it, but delete explicitly for immediate hygiene.
    const { data: leftoverContests } = await admin
      .from('contests')
      .select('event_id')
      .eq('competition_id', competitionId);
    await admin.from('leagues').delete().eq('id', leagueId);
    for (const c of leftoverContests ?? []) {
      if (c.event_id) await admin.from('events').delete().eq('id', c.event_id);
    }
  }
});
