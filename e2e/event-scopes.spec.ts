import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Event scope polymorphism (0.9, mig 146): a TEAM-scoped event reaches only
// the profiles holding a membership row at that scope — an org-only member
// never merges it (strict audience), a team-scope member merges it with the
// owning org's name, RSVP materializes a guest row, and the org's public
// page lists it (page visibility ≠ calendar placement).
test('event scopes: team event merges for team members only; org page lists it', async () => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json'); // org member; gains the team-scope row mid-test
  const userB = loadQaUser('user-b.json'); // owner/organizer
  const admin = adminClient();

  const probe = await admin.from('events').select('division_id').limit(1);
  test.skip(!!probe.error, `events.division_id missing — run migration 146 (${probe.error?.message})`);

  const stamp = Date.now();
  const leagueName = `QA Scope League ${stamp}`;
  const eventTitle = `QA Team Skate ${stamp}`;

  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'ice_hockey', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  let eventId: string | null = null;
  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: userB.id, role: 'owner' },
      { league_id: leagueId, profile_id: userA.id, role: 'member' },
    ]);

    // Structure: season → division → team → entry (service role; every step
    // asserted — the vacuous-pass rule).
    const season = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27' })
      .select()
      .single();
    expect(season.error, season.error?.message).toBeNull();
    const division = await admin
      .from('divisions')
      .insert({
        league_id: leagueId,
        season_id: season.data!.id,
        sport_key: 'ice_hockey',
        name: 'U13 A',
      })
      .select()
      .single();
    expect(division.error, division.error?.message).toBeNull();
    const team = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
      .select()
      .single();
    expect(team.error, team.error?.message).toBeNull();
    const teamId = team.data!.id as string;
    const entry = await admin
      .from('team_entries')
      .insert({ team_id: teamId, division_id: division.data!.id });
    expect(entry.error, entry.error?.message).toBeNull();

    const starts = new Date(Date.now() + 3 * 86_400_000);
    const ends = new Date(starts.getTime() + 3_600_000);
    const listRange = `from=${new Date().toISOString()}&to=${new Date(Date.now() + 7 * 86_400_000).toISOString()}`;
    const eventBody = {
      title: eventTitle,
      description: 'e2e scoped event probe',
      location: 'Rink 2',
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      all_day: false,
      timezone: 'America/Toronto',
      category: 'practice',
      team_id: teamId,
      guests: { profile_ids: [], emails: [] },
    };

    // A (plain member, not a manager) may NOT schedule for the team.
    const apiA = await apiAs('state.json');
    const apiB = await apiAs('state-b.json');
    try {
      const forbidden = await apiA.post('/api/calendar/events', { data: eventBody });
      test.skip(forbidden.status() === 404, 'calendar flag off on this target');
      expect(forbidden.status(), await readErrorBody(forbidden)).toBe(403);

      // Two scopes at once → 400 (146's CHECK, mirrored in validation).
      const twoScopes = await apiB.post('/api/calendar/events', {
        data: { ...eventBody, league_id: leagueId },
      });
      expect(twoScopes.status(), await readErrorBody(twoScopes)).toBe(400);

      // The owner schedules the team event.
      const created = await apiB.post('/api/calendar/events', { data: eventBody });
      expect(created.ok(), await readErrorBody(created)).toBe(true);
      eventId = (await created.json()).event?.id ?? null;
      expect(eventId).toBeTruthy();

      // STRICT AUDIENCE: A holds only an ORG-scope row — the team event
      // must NOT merge onto their calendar.
      const orgOnly = await apiA.get(`/api/calendar/events?${listRange}`);
      expect(orgOnly.ok(), await readErrorBody(orgOnly)).toBe(true);
      const invisible = (await orgOnly.json()).events.find((e: { id: string }) => e.id === eventId);
      expect(invisible, 'org-only member must not see the team event').toBeUndefined();

      // Give A a team-scope row → the event merges with the org's name.
      const scopedRow = await admin
        .from('memberships')
        .insert({
          league_id: leagueId,
          profile_id: userA.id,
          kind: 'roster',
          scope_type: 'team',
          scope_id: teamId,
        });
      expect(scopedRow.error, scopedRow.error?.message).toBeNull();

      const scoped = await apiA.get(`/api/calendar/events?${listRange}`);
      const merged = (await scoped.json()).events.find((e: { id: string }) => e.id === eventId);
      expect(merged, 'team member must see the team event').toBeTruthy();
      expect(merged.my_status).toBeNull();
      expect(merged.is_org_event).toBe(true);
      expect(merged.org_name).toBe(leagueName);

      // Detail admits the scoped member; RSVP materializes a guest row.
      const detail = await apiA.get(`/api/calendar/events/${eventId}`);
      expect(detail.ok(), await readErrorBody(detail)).toBe(true);
      expect((await detail.json()).viewer_access).toBe('org_member');
      const yes = await apiA.post(`/api/calendar/events/${eventId}/respond`, {
        data: { status: 'accepted' },
      });
      expect(yes.ok(), await readErrorBody(yes)).toBe(true);
      const { data: guestRow } = await admin
        .from('event_guests')
        .select('role, status')
        .eq('event_id', eventId!)
        .eq('profile_id', userA.id)
        .maybeSingle();
      expect(guestRow?.status).toBe('accepted');

      // The org page's public schedule includes the team event (Tom's
      // decision: page visibility ≠ calendar placement).
      const orgPage = await apiA.get(`/api/leagues/${leagueId}/events`);
      expect(orgPage.ok(), await readErrorBody(orgPage)).toBe(true);
      const listed = (await orgPage.json()).events.find((e: { id: string }) => e.id === eventId);
      expect(listed, 'org page schedule must list the team event').toBeTruthy();
    } finally {
      await apiA.dispose();
      await apiB.dispose();
    }
  } finally {
    if (eventId) {
      await admin.from('event_guests').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('id', eventId);
    }
    // League delete cascades memberships + structure (seasons/divisions/
    // teams/entries all CASCADE from the org).
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
