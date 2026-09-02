import { describe, expect, it } from 'vitest';
import {
  contestEventTitle,
  mirrorContestChange,
  publishContestToCalendar,
} from '../calendar-mirror';

type Admin = Parameters<typeof publishContestToCalendar>[0];

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: Record<string, unknown>;
}

function mockAdmin(results: Partial<Record<string, unknown>>) {
  const calls: RecordedCall[] = [];
  const consumed: Record<string, number> = {};
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, op: 'select', filters: {} };
      calls.push(call);
      const entry = results[table];
      const result = Array.isArray(entry)
        ? { data: null, error: null, ...((entry[consumed[table] = (consumed[table] ?? 0)] as object) ?? {}) }
        : { data: null, error: null, ...((entry as object) ?? {}) };
      if (Array.isArray(entry)) consumed[table]++;
      const chain = {
        eq(col: string, val: unknown) {
          call.filters[col] = val;
          return chain;
        },
        is(col: string, val: unknown) {
          call.filters[`is:${col}`] = val;
          return chain;
        },
        in: () => chain,
        select: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return {
        select: () => chain,
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return chain;
        },
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return chain;
        },
        delete() {
          call.op = 'delete';
          return chain;
        },
      };
    },
  };
  return { admin: admin as unknown as Admin, calls };
}

const CONTEST = {
  id: 'g1',
  event_id: null,
  scheduled_at: '2026-09-05T18:00:00Z',
  venue_id: null,
  facility_id: null,
  round: 'Week 1',
};
const COMPETITION = {
  id: 'c1',
  name: 'House League',
  league_id: 'org-1',
  club_id: null,
  division_id: null,
};

describe('contestEventTitle', () => {
  it('fixture reads "Home vs Away — Competition"; bare falls back', () => {
    expect(contestEventTitle('House League', { home: 'Blazers', away: 'Comets' })).toBe(
      'Blazers vs Comets — House League'
    );
    expect(contestEventTitle('Club Championship', {})).toBe('Club Championship');
  });
});

describe('publishContestToCalendar', () => {
  it('is idempotent: an already-linked contest returns its event', async () => {
    const { admin, calls } = mockAdmin({});
    const res = await publishContestToCalendar(
      admin,
      { ...CONTEST, event_id: 'ev-existing' },
      COMPETITION,
      'mgr',
      'UTC'
    );
    expect(res).toEqual({ eventId: 'ev-existing' });
    expect(calls).toHaveLength(0);
  });

  it('refuses an unscheduled contest', async () => {
    const { admin } = mockAdmin({});
    const res = await publishContestToCalendar(
      admin,
      { ...CONTEST, scheduled_at: null },
      COMPETITION,
      'mgr',
      'UTC'
    );
    expect('error' in res).toBe(true);
  });

  it('division pin decides the event scope; org otherwise', async () => {
    const org = mockAdmin({
      contest_participants: { data: [] },
      events: { data: { id: 'ev1' } },
      contests: { data: null },
    });
    await publishContestToCalendar(org.admin, CONTEST, COMPETITION, 'mgr', 'America/Toronto');
    const orgInsert = org.calls.find(c => c.table === 'events');
    expect(orgInsert?.payload).toMatchObject({
      league_id: 'org-1',
      club_id: null,
      division_id: null,
      category: 'game',
      timezone: 'America/Toronto',
    });

    const div = mockAdmin({
      contest_participants: { data: [] },
      events: { data: { id: 'ev1' } },
      contests: { data: null },
    });
    await publishContestToCalendar(
      div.admin,
      CONTEST,
      { ...COMPETITION, division_id: 'd1' },
      'mgr',
      'UTC'
    );
    const divInsert = div.calls.find(c => c.table === 'events');
    expect(divInsert?.payload).toMatchObject({ division_id: 'd1', league_id: null, club_id: null });
  });

  it('compensates: a failed link deletes the freshly-minted event', async () => {
    const { admin, calls } = mockAdmin({
      contest_participants: { data: [] },
      events: [{ data: { id: 'ev1' } }, { data: null }],
      contests: { data: null, error: { code: '57014' } },
    });
    const res = await publishContestToCalendar(admin, CONTEST, COMPETITION, 'mgr', 'UTC');
    expect('error' in res).toBe(true);
    const eventCalls = calls.filter(c => c.table === 'events');
    expect(eventCalls[1].op).toBe('delete');
  });

  it('the link update is guarded (event_id IS NULL — the lost-race rule)', async () => {
    const { admin, calls } = mockAdmin({
      contest_participants: { data: [] },
      events: { data: { id: 'ev1' } },
      contests: { data: null },
    });
    await publishContestToCalendar(admin, CONTEST, COMPETITION, 'mgr', 'UTC');
    const link = calls.find(c => c.table === 'contests');
    expect(link?.filters).toMatchObject({ id: 'g1', 'is:event_id': null });
  });
});

describe('mirrorContestChange', () => {
  it('cancel/postpone cancels the event; reschedule moves + reactivates it', async () => {
    const cancel = mockAdmin({ events: { data: null } });
    await mirrorContestChange(cancel.admin, {
      event_id: 'ev1',
      status: 'canceled',
      scheduled_at: null,
    });
    expect((cancel.calls[0].payload as { status: string }).status).toBe('cancelled');

    const move = mockAdmin({ events: { data: null } });
    await mirrorContestChange(move.admin, {
      event_id: 'ev1',
      status: 'scheduled',
      scheduled_at: '2026-09-06T18:00:00Z',
    });
    const payload = move.calls[0].payload as Record<string, unknown>;
    expect(payload.status).toBe('active');
    expect(payload.starts_at).toBe('2026-09-06T18:00:00.000Z');
  });

  it('no event link = no-op', async () => {
    const { admin, calls } = mockAdmin({});
    await mirrorContestChange(admin, { event_id: null, status: 'canceled', scheduled_at: null });
    expect(calls).toHaveLength(0);
  });
});

describe('phase 6e S4 — a play-window round publishes as an all-day, multi-day event', () => {
  it('windowEventBounds: local midnights in the zone, end EXCLUSIVE, across a DST change', async () => {
    const { windowEventBounds, contestWindowDescription, contestWindowTitle } = await import('../calendar-mirror');
    // Toronto: Sep 15–21 (EDT, −4) → starts 04:00Z on the 15th, ends 04:00Z on the 22nd.
    const b = windowEventBounds('2026-09-15', '2026-09-21', 'America/Toronto');
    expect(b.startsAt).toBe('2026-09-15T04:00:00.000Z');
    expect(b.endsAt).toBe('2026-09-22T04:00:00.000Z');
    // A window spanning the November fall-back keeps its dates: Oct 30 (−4) → Nov 6 (−5).
    const dst = windowEventBounds('2026-10-30', '2026-11-05', 'America/Toronto');
    expect(dst.startsAt).toBe('2026-10-30T04:00:00.000Z');
    expect(dst.endsAt).toBe('2026-11-06T05:00:00.000Z');
    // A one-day window is still a full day.
    const one = windowEventBounds('2026-09-15', '2026-09-15', 'UTC');
    expect(one.startsAt).toBe('2026-09-15T00:00:00.000Z');
    expect(one.endsAt).toBe('2026-09-16T00:00:00.000Z');
    expect(contestWindowTitle('Thursday Nine', 'Week 3')).toBe('Week 3 — Thursday Nine');
    expect(contestWindowTitle('Thursday Nine', null)).toBe('Round — Thursday Nine');
    expect(contestWindowDescription('2026-09-15', '2026-09-21', 9, 'QA Nine')).toBe('Play any day Sep 15 – 21 · 9 holes at QA Nine');
    expect(contestWindowDescription('2026-09-15', '2026-09-21', null, null)).toBe('Play any day Sep 15 – 21');
  });

  it('publishes a windowed round all-day with the window title; refuses a round with neither', async () => {
    const { admin, calls } = mockAdmin({
      contest_participants: { data: [] },
      venues: { data: { name: 'QA Venue', golf_course_id: 'course-1' } },
      golf_courses: { data: { name: 'QA Nine' } },
      events: { data: { id: 'evt-w' } },
      contests: { data: null },
    });
    const out = await publishContestToCalendar(
      admin as unknown as Admin,
      { id: 'c1', event_id: null, scheduled_at: null, venue_id: 'v1', facility_id: null, round: 'Week 3', play_from: '2026-09-15', play_to: '2026-09-21', holes: 9 },
      { id: 'comp', name: 'Thursday Nine', league_id: 'lg', club_id: null, division_id: null },
      'organizer',
      'America/Toronto'
    );
    expect(out).toEqual({ eventId: 'evt-w' });
    const insert = calls.find(c => c.table === 'events' && c.op === 'insert')!.payload as Record<string, unknown>;
    expect(insert.all_day).toBe(true);
    expect(insert.title).toBe('Week 3 — Thursday Nine');
    expect(insert.description).toBe('Play any day Sep 15 – 21 · 9 holes at QA Nine');
    expect(insert.starts_at).toBe('2026-09-15T04:00:00.000Z');
    expect(insert.ends_at).toBe('2026-09-22T04:00:00.000Z');
    expect(insert.location).toBe('QA Venue');
    expect(insert.category).toBe('game');

    const refused = await publishContestToCalendar(
      admin as unknown as Admin,
      { id: 'c2', event_id: null, scheduled_at: null, venue_id: null, facility_id: null, round: 'Week 4' },
      { id: 'comp', name: 'Thursday Nine', league_id: 'lg', club_id: null, division_id: null },
      'organizer',
      'UTC'
    );
    expect(refused).toEqual({ error: 'Schedule the game before publishing it' });
  });

  it('a window move re-derives the all-day bounds in the event’s own zone', async () => {
    const { admin, calls } = mockAdmin({ events: { data: { timezone: 'America/Toronto' } } });
    await mirrorContestChange(admin as unknown as Admin, {
      event_id: 'evt-w',
      status: 'scheduled',
      scheduled_at: null,
      play_from: '2026-09-22',
      play_to: '2026-09-28',
    });
    const update = calls.find(c => c.table === 'events' && c.op === 'update')!.payload as Record<string, unknown>;
    expect(update.all_day).toBe(true);
    expect(update.starts_at).toBe('2026-09-22T04:00:00.000Z');
    expect(update.ends_at).toBe('2026-09-29T04:00:00.000Z');
    expect(update.status).toBe('active');
  });
});
