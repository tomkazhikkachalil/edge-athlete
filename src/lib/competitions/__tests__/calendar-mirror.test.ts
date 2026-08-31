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
