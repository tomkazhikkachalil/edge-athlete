import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Org events (connections PR C, migration 119): the league owner schedules
// an event attached to their league via the API; the league page's public
// "Upcoming events" section lists it; a non-manager's attach attempt is
// refused 403.
test('org events: owner schedules, org page lists, non-manager 403', async ({ page }) => {
  test.setTimeout(120_000);
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('events').select('league_id').limit(1);
  test.skip(!!probe.error, `events.league_id missing — run migration 119 (${probe.error?.message})`);

  const stamp = Date.now();
  const leagueName = `QA Event League ${stamp}`;
  const eventTitle = `QA League Night ${stamp}`;

  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert({ league_id: leagueId, profile_id: userB.id, role: 'owner' });

  const starts = new Date(Date.now() + 3 * 86_400_000);
  const ends = new Date(starts.getTime() + 3_600_000);
  const eventBody = {
    title: eventTitle,
    description: 'e2e org event probe',
    location: 'Clubhouse',
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    all_day: false,
    timezone: 'America/Toronto',
    category: 'social',
    league_id: leagueId,
    guests: { profile_ids: [], emails: [] },
  };

  let eventId: string | null = null;
  try {
    // Owner attaches — allowed.
    const apiB = await apiAs('state-b.json');
    try {
      const res = await apiB.post('/api/calendar/events', { data: eventBody });
      test.skip(res.status() === 404, 'calendar flag off on this target');
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      const body = await res.json();
      eventId = body.event?.id ?? null;
      expect(eventId).toBeTruthy();
    } finally {
      await apiB.dispose();
    }

    // Non-manager (user A) attach — 403.
    const apiA = await apiAs('state.json');
    try {
      const res = await apiA.post('/api/calendar/events', {
        data: { ...eventBody, title: `${eventTitle} intruder` },
      });
      expect(res.status(), await readErrorBody(res)).toBe(403);
    } finally {
      await apiA.dispose();
    }

    // The league page's public schedule lists it (anonymous-equivalent read).
    await page.goto(`/league/${leagueId}`);
    await expect(page.getByRole('heading', { name: 'Upcoming events' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(eventTitle)).toBeVisible();
  } finally {
    if (eventId) {
      await admin.from('event_guests').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('id', eventId);
    }
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
