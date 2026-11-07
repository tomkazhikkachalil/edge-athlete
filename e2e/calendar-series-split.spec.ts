import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { wallClockInZone, zonedWallClockToUtc } from '../src/lib/calendar/recurrence';

/**
 * Change a repeating event's schedule from one event on (Nov 6 2026,
 * migration 302 calendar_series_split). The rule or the zone of a series
 * event used to be locked ("cancel the series and create a new one"). Now
 * PATCH with scope 'following' and a new `recurrence` and/or `timezone`
 * SPLITS the series: the old one ends before that occurrence (its remaining
 * occurrences cancelled, never deleted), a new one starts there with the
 * anchor's wall clock kept, the template and the guests carried over — one
 * transaction. Any other scope refuses; guests change in their own save.
 */
const DENVER = 'America/Denver';
const TORONTO = 'America/Toronto';
const stamp = Date.now().toString(36);

test('a new rule from the 3rd of six: 1–2 keep the old series, 3–6 are cancelled, the new series starts there with the guest @mobile', async () => {
  test.setTimeout(120_000);
  const api = await apiAs('state.json');
  const admin = adminClient();
  const userB = loadQaUser('user-b.json');
  let firstId = '';
  let oldSeriesId = '';
  let newSeriesId = '';
  try {
    // Weekly, 7 pm Denver, six times, B invited.
    const w = wallClockInZone(Date.now() + 2 * 86_400_000, DENVER);
    const startMs = zonedWallClockToUtc(w.y, w.m, w.d, 19, 0, DENVER);
    const created = await api.post('/api/calendar/events', {
      data: {
        title: `QA split ${stamp}`,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(startMs + 3_600_000).toISOString(),
        timezone: DENVER,
        recurrence: { freq: 'weekly', interval: 1, ends: { kind: 'count', count: 6 } },
        guests: { profile_ids: [userB.id], emails: [] },
      },
    });
    test.skip(created.status() === 404, 'calendar flag off');
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const first = (await created.json()).event as { id: string; series_id: string };
    firstId = first.id;
    oldSeriesId = first.series_id;
    const { data: rows } = await admin.from('events').select('id, starts_at, status').eq('series_id', oldSeriesId).order('starts_at');
    expect(rows?.length).toBe(6);
    const third = rows![2];

    // Any scope but 'following' refuses a schedule change.
    const refused = await api.patch(`/api/calendar/events/${third.id}`, {
      data: { scope: 'series', recurrence: { freq: 'weekly', interval: 2, ends: { kind: 'count', count: 4 } } },
    });
    expect(refused.status()).toBe(400);
    expect(await readErrorBody(refused)).toContain('from one event on');
    // Guests and the schedule change in separate saves.
    const twoThings = await api.patch(`/api/calendar/events/${third.id}`, {
      data: { scope: 'following', recurrence: { freq: 'weekly', interval: 2, ends: { kind: 'count', count: 4 } }, remove_guest_ids: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(twoThings.status()).toBe(400);
    // A time change and the schedule change in one save are refused too (the
    // hardening pass): the split re-anchors the stored wall clock, so the new
    // time would have been dropped silently.
    const timeToo = await api.patch(`/api/calendar/events/${third.id}`, {
      data: {
        scope: 'following',
        recurrence: { freq: 'weekly', interval: 2, ends: { kind: 'count', count: 4 } },
        starts_at: new Date(Date.parse(third.starts_at) - 3_600_000).toISOString(),
        ends_at: third.starts_at,
      },
    });
    expect(timeToo.status()).toBe(400);
    expect(await readErrorBody(timeToo)).toContain('time and the schedule');

    // Every two weeks from the 3rd on, a new title too — the template rides along.
    const split = await api.patch(`/api/calendar/events/${third.id}`, {
      data: {
        scope: 'following',
        title: `QA split ${stamp} biweekly`,
        recurrence: { freq: 'weekly', interval: 2, ends: { kind: 'count', count: 4 } },
      },
    });
    expect(split.ok(), await readErrorBody(split)).toBe(true);
    const answer = (await split.json()) as { event: { id: string; series_id: string; starts_at: string; title: string }; split: { new_series_id: string; cancelled: number; created: number } };
    expect(answer.split.cancelled).toBe(4);
    expect(answer.split.created).toBe(4);
    newSeriesId = answer.split.new_series_id;
    expect(answer.event.series_id).toBe(newSeriesId);
    expect(answer.event.starts_at).toBe(third.starts_at); // the anchor keeps its instant
    expect(answer.event.title).toBe(`QA split ${stamp} biweekly`);

    // The old series: 1–2 active, 3–6 cancelled (never deleted), ends at the 3rd.
    const { data: oldRows } = await admin.from('events').select('id, status, starts_at').eq('series_id', oldSeriesId).order('starts_at');
    expect(oldRows!.map(r => r.status)).toEqual(['active', 'active', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);
    const { data: oldSeries } = await admin.from('event_series').select('ends, until_at').eq('id', oldSeriesId).single();
    expect(oldSeries!.ends).toBe('until');
    expect(Date.parse(oldSeries!.until_at as string)).toBe(Date.parse(third.starts_at));

    // The new series: four rows two weeks apart, each with the guest's row.
    const { data: newRows } = await admin.from('events').select('id, starts_at, status, timezone, series_id').eq('series_id', newSeriesId).order('starts_at');
    expect(newRows!.length).toBe(4);
    expect(newRows!.every(r => r.status === 'active' && r.timezone === DENVER)).toBe(true);
    for (let i = 1; i < 4; i++) {
      expect(Date.parse(newRows![i].starts_at) - Date.parse(newRows![i - 1].starts_at)).toBe(14 * 86_400_000);
    }
    const { data: guestRows } = await admin.from('event_guests').select('event_id, profile_id, role').in('event_id', newRows!.map(r => r.id));
    expect(guestRows!.filter(g => g.profile_id === userB.id).length).toBe(4);
    expect(guestRows!.filter(g => g.role === 'organizer').length).toBe(4);

    // A zone-only change from the new series' 2nd occurrence: the wall clock stays 7 pm, now in Toronto.
    // Sent the way the form sends it — the times on every save, built from
    // the same wall clock in the NEW zone — the guard compares wall clocks and
    // lets it through.
    const second = newRows![1];
    const w2 = wallClockInZone(Date.parse(second.starts_at), DENVER);
    const torontoMs = zonedWallClockToUtc(w2.y, w2.m, w2.d, 19, 0, TORONTO);
    const moved = await api.patch(`/api/calendar/events/${second.id}`, {
      data: { scope: 'following', timezone: TORONTO, starts_at: new Date(torontoMs).toISOString(), ends_at: new Date(torontoMs + 3_600_000).toISOString() },
    });
    expect(moved.ok(), await readErrorBody(moved)).toBe(true);
    const movedAnswer = (await moved.json()) as { event: { id: string; starts_at: string; timezone: string }; split: { new_series_id: string; cancelled: number; created: number } };
    expect(movedAnswer.split.cancelled).toBe(3);
    expect(movedAnswer.split.created).toBe(3); // the count that was still to come
    expect(movedAnswer.event.timezone).toBe(TORONTO);
    expect(wallClockInZone(Date.parse(movedAnswer.event.starts_at), TORONTO).hh).toBe(19);
    expect(Date.parse(movedAnswer.event.starts_at)).not.toBe(Date.parse(second.starts_at));
    newSeriesId = movedAnswer.split.new_series_id;
  } finally {
    // Cancel what is left (rows are never deleted); the QA user's teardown cascades the rest.
    if (firstId) await api.delete(`/api/calendar/events/${firstId}?scope=series`).catch(() => undefined);
    if (newSeriesId) {
      const { data: left } = await admin.from('events').select('id').eq('series_id', newSeriesId).order('starts_at').limit(1);
      if (left?.[0]) await api.delete(`/api/calendar/events/${left[0].id}?scope=series`).catch(() => undefined);
    }
    await api.dispose();
  }
});
