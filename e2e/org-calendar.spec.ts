import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Calendar read-time org merge (fan-out round): an org MEMBER who was never
// invited sees the org's events on their calendar (my_status null), can open
// the detail (viewer_access org_member), and their first RSVP creates a real
// guest row — after which the row is authoritative (a decline hides the
// event from the list again).
test('org calendar: member sees org event, RSVP creates guest row, decline hides it', async () => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('events').select('league_id').limit(1);
  test.skip(!!probe.error, `events.league_id missing — run migration 119 (${probe.error?.message})`);

  const stamp = Date.now();
  const leagueName = `QA Merge League ${stamp}`;
  const eventTitle = `QA Merge Night ${stamp}`;

  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('league_members').insert([
    { league_id: leagueId, profile_id: userB.id, role: 'owner' },
    { league_id: leagueId, profile_id: userA.id, role: 'member' },
  ]);

  const starts = new Date(Date.now() + 3 * 86_400_000);
  const ends = new Date(starts.getTime() + 3_600_000);
  const listRange = `from=${new Date(Date.now()).toISOString()}&to=${new Date(Date.now() + 7 * 86_400_000).toISOString()}`;

  let eventId: string | null = null;
  try {
    // Owner schedules the org event — user A is NOT invited.
    const apiB = await apiAs('state-b.json');
    try {
      const res = await apiB.post('/api/calendar/events', {
        data: {
          title: eventTitle,
          description: 'e2e org merge probe',
          location: 'Clubhouse',
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
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
    } finally {
      await apiB.dispose();
    }

    const apiA = await apiAs('state.json');
    try {
      // 1. The merge: A's calendar lists the org event with no guest row.
      const list1 = await apiA.get(`/api/calendar/events?${listRange}`);
      expect(list1.ok(), await readErrorBody(list1)).toBe(true);
      const merged = (await list1.json()).events.find((e: { id: string }) => e.id === eventId);
      expect(merged, 'org event should appear on the member calendar').toBeTruthy();
      expect(merged.my_status).toBeNull();
      expect(merged.is_org_event).toBe(true);
      expect(merged.org_name).toBe(leagueName);

      // 2. The detail gate admits the member.
      const detail = await apiA.get(`/api/calendar/events/${eventId}`);
      expect(detail.ok(), await readErrorBody(detail)).toBe(true);
      expect((await detail.json()).viewer_access).toBe('org_member');

      // 3. First RSVP creates the guest row.
      const yes = await apiA.post(`/api/calendar/events/${eventId}/respond`, {
        data: { status: 'accepted' },
      });
      expect(yes.ok(), await readErrorBody(yes)).toBe(true);
      const { data: row } = await admin
        .from('event_guests')
        .select('role, status')
        .eq('event_id', eventId!)
        .eq('profile_id', userA.id)
        .maybeSingle();
      expect(row?.role).toBe('guest');
      expect(row?.status).toBe('accepted');

      // The event now arrives via the guest-row query, not the merge.
      const list2 = await apiA.get(`/api/calendar/events?${listRange}`);
      const asGuest = (await list2.json()).events.find((e: { id: string }) => e.id === eventId);
      expect(asGuest?.my_status).toBe('accepted');
      expect(asGuest?.is_org_event).toBeUndefined();

      // 4. Decline (normal guest path now) hides it from the list —
      //    the merge must NOT resurrect it.
      const no = await apiA.post(`/api/calendar/events/${eventId}/respond`, {
        data: { status: 'declined' },
      });
      expect(no.ok(), await readErrorBody(no)).toBe(true);
      const list3 = await apiA.get(`/api/calendar/events?${listRange}`);
      const hidden = (await list3.json()).events.find((e: { id: string }) => e.id === eventId);
      expect(hidden, 'declined org event must stay hidden').toBeUndefined();
    } finally {
      await apiA.dispose();
    }
  } finally {
    if (eventId) {
      await admin.from('event_guests').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('id', eventId);
    }
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
