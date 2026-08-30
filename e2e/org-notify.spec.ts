import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// team_update senders (fan-out round PR 3): scheduling an org event bells
// every member except the organizer; cancelling bells members who never
// held a guest row (guests got event_cancelled). Titles are self-contained
// (they land verbatim in the digest email).
test('org notify: member belled on schedule and cancel, organizer never', async () => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('events').select('league_id').limit(1);
  test.skip(!!probe.error, `events.league_id missing — run migration 119 (${probe.error?.message})`);

  const stamp = Date.now();
  const leagueName = `QA Notify League ${stamp}`;
  const eventTitle = `QA Notify Night ${stamp}`;

  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: userB.id, role: 'owner' },
    { league_id: leagueId, profile_id: userA.id, role: 'member' },
  ]);

  const starts = new Date(Date.now() + 3 * 86_400_000);
  let eventId: string | null = null;
  try {
    const apiB = await apiAs('state-b.json');
    try {
      const res = await apiB.post('/api/calendar/events', {
        data: {
          title: eventTitle,
          starts_at: starts.toISOString(),
          ends_at: new Date(starts.getTime() + 3_600_000).toISOString(),
          all_day: false,
          timezone: 'America/Toronto',
          category: 'social',
          league_id: leagueId,
          guests: { profile_ids: [], emails: [] },
        },
      });
      test.skip(res.status() === 404, 'calendar flag off on this target');
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      eventId = (await res.json()).event?.id ?? null;
      expect(eventId).toBeTruthy();

      // Member A: one scheduled team_update, self-contained title, event link.
      const { data: scheduled } = await admin
        .from('notifications')
        .select('user_id, title, action_url, actor_id')
        .eq('type', 'team_update')
        .contains('metadata', { team_event: 'scheduled', event_id: eventId! });
      expect(scheduled).toHaveLength(1);
      expect(scheduled![0].user_id).toBe(userA.id);
      expect(scheduled![0].actor_id).toBe(userB.id);
      expect(scheduled![0].title).toBe(`${leagueName} scheduled: ${eventTitle}`);
      expect(scheduled![0].action_url).toBe(`/calendar?event=${eventId}`);

      // Cancel → one cancelled team_update for A (B is organizer+guest —
      // excluded both ways).
      const del = await apiB.delete(`/api/calendar/events/${eventId}`);
      expect(del.ok(), await readErrorBody(del)).toBe(true);
      const { data: cancelledRows } = await admin
        .from('notifications')
        .select('user_id, title')
        .eq('type', 'team_update')
        .contains('metadata', { team_event: 'cancelled', event_id: eventId! });
      expect(cancelledRows).toHaveLength(1);
      expect(cancelledRows![0].user_id).toBe(userA.id);
      expect(cancelledRows![0].title).toBe(`${leagueName} cancelled: ${eventTitle}`);
    } finally {
      await apiB.dispose();
    }
  } finally {
    if (eventId) {
      await admin
        .from('notifications')
        .delete()
        .eq('type', 'team_update')
        .contains('metadata', { event_id: eventId });
      await admin.from('event_guests').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('id', eventId);
    }
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
