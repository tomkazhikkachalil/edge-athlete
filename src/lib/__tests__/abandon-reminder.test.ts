import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { planSessionReminders, reminderDue, reminderMetadata, REMINDER_LEAD_MS, sessionReminderCopy } from '../sessions/abandon-reminder';
import { runSessionReminders } from '../sessions/abandon-reminder-server';
import { ABANDON_AFTER_MS } from '../workouts/status';

// Resume pill program PR 3 (Oct 12 2026, mig 259): the day-before bell for an
// unfinished session — a round or a workout the 7-day sweep will settle
// tomorrow. Once per session, to its creator / owner, saying which will
// happen (finished as played, or discarded when nothing was recorded).

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.UTC(2026, 9, 12, 14, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('reminderDue — the day before the sweep', () => {
  it('is due when the clock is between 6 and 7 days old, never before, never once the sweep itself is due', () => {
    expect(REMINDER_LEAD_MS).toBe(DAY);
    expect(reminderDue(iso(NOW - 5 * DAY - 23 * 3600_000), NOW)).toBe(false);
    expect(reminderDue(iso(NOW - 6 * DAY), NOW)).toBe(true);
    expect(reminderDue(iso(NOW - 6 * DAY - 12 * 3600_000), NOW)).toBe(true);
    expect(reminderDue(iso(NOW - ABANDON_AFTER_MS), NOW)).toBe(true);
    expect(reminderDue(iso(NOW - ABANDON_AFTER_MS - 1), NOW)).toBe(false);
    expect(reminderDue(null, NOW)).toBe(false);
    expect(reminderDue('garbage', NOW)).toBe(false);
  });
});

describe('sessionReminderCopy — what will happen tomorrow, in plain words', () => {
  it('a scored round: finished as played; a scoreless one: discarded; a workout: finished as it stands', () => {
    const scored = sessionReminderCopy({ kind: 'round', id: 'gp1', title: 'Pine Hills', outcome: 'finish' });
    expect(scored).toMatchObject({ type: 'session_reminder', title: 'Your round at Pine Hills is still open', action_url: '/live/gp1' });
    expect(scored.message).toMatch(/finished as played/);
    expect(scored.message).toMatch(/nothing is posted/);
    const empty = sessionReminderCopy({ kind: 'round', id: 'gp2', title: null, outcome: 'discard' });
    expect(empty.title).toBe('Your round is still open');
    expect(empty.message).toMatch(/discarded/);
    const w = sessionReminderCopy({ kind: 'workout', id: 'w1', title: 'Legs', outcome: 'finish' });
    expect(w).toMatchObject({ title: 'Your workout “Legs” is still in progress', action_url: '/app/workout/w1' });
    expect(w.message).toMatch(/finished as it stands/);
    expect(sessionReminderCopy({ kind: 'workout', id: 'w1', title: 'Workout', outcome: 'finish' }).title).toBe('Your workout is still in progress');
  });
  it('the dedupe key is the session id under its kind\'s column name', () => {
    expect(reminderMetadata({ kind: 'round', id: 'gp1', outcome: 'finish' })).toEqual({ group_post_id: 'gp1', outcome: 'finish' });
    expect(reminderMetadata({ kind: 'workout', id: 'w1', outcome: 'finish' })).toEqual({ workout_session_id: 'w1', outcome: 'finish' });
  });
});

describe('planSessionReminders — once per session', () => {
  it('skips the already-belled, duplicates and a missing recipient', () => {
    const out = planSessionReminders(
      [
        { kind: 'round', id: 'a', recipient: 'u1', title: null, outcome: 'finish' },
        { kind: 'round', id: 'b', recipient: 'u1', title: null, outcome: 'discard' },
        { kind: 'round', id: 'a', recipient: 'u1', title: null, outcome: 'finish' },
        { kind: 'workout', id: 'a', recipient: 'u2', title: null, outcome: 'finish' },
        { kind: 'workout', id: 'c', recipient: '', title: null, outcome: 'finish' },
      ],
      new Set(['round:b']),
    );
    expect(out.map(d => `${d.kind}:${d.id}`)).toEqual(['round:a', 'workout:a']);
  });
});

/** A fake admin: rows per table, `in()` on the notifications metadata, and every insert recorded. */
function fakeAdmin(tables: Record<string, unknown[]>, opts: { insertError?: { code: string } } = {}) {
  const inserts: Array<{ table: string; rows: unknown[] }> = [];
  const from = (table: string) => {
    let rows = tables[table] ?? [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) builder[m] = () => builder;
    builder.in = (col: string, values: string[]) => {
      if (table === 'notifications') {
        const key = col.replace('metadata->>', '');
        rows = rows.filter(r => values.includes(String((r as { metadata: Record<string, unknown> }).metadata?.[key])));
      }
      return builder;
    };
    builder.insert = (payload: unknown[]) => {
      inserts.push({ table, rows: payload });
      return Promise.resolve({ error: opts.insertError ?? null });
    };
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return builder;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from } as any, inserts };
}

const sixDays = iso(NOW - 6 * DAY - 3600_000);
const round = (id: string, status: string, clock: string, over: Record<string, unknown> = {}) => ({
  id, status, created_at: clock, creator_id: `creator-${id}`, title: null, sport_event_round_id: null,
  golf_data: [{ course_name: 'Pine Hills' }],
  participants: status === 'active' ? [{ scores: [{ updated_at: clock }] }] : [],
  ...over,
});

describe('runSessionReminders — the daily step', () => {
  it('bells the creator of a 6-day-old scored round (finish) and scoreless round (discard) and the owner of a 6-day-old workout; leaves the fresh, the belled and an event\'s round', async () => {
    const { admin, inserts } = fakeAdmin({
      group_posts: [
        round('scored', 'active', sixDays),
        round('empty', 'pending', sixDays),
        round('fresh', 'active', iso(NOW - DAY)),
        round('belled', 'active', sixDays),
        round('event', 'active', sixDays, { sport_event_round_id: 'ser1' }),
      ],
      workout_sessions: [
        { id: 'w-old', title: 'Legs', profile_id: 'owner', last_activity_at: sixDays },
        { id: 'w-new', title: null, profile_id: 'owner', last_activity_at: iso(NOW - 2 * DAY) },
      ],
      notifications: [{ metadata: { group_post_id: 'belled', outcome: 'finish' } }],
    });
    const out = await runSessionReminders(admin, NOW);
    expect(out).toEqual({ due: 4, sent: 3, failed: 0, skipped: null });
    const sent = inserts.flatMap(i => i.rows as Array<{ user_id: string; type: string; title: string; action_url: string; metadata: Record<string, unknown> }>);
    expect(sent.map(r => [r.user_id, r.type, r.action_url])).toEqual([
      ['creator-scored', 'session_reminder', '/live/scored'],
      ['creator-empty', 'session_reminder', '/live/empty'],
      ['owner', 'session_reminder', '/app/workout/w-old'],
    ]);
    expect(sent[0].title).toBe('Your round at Pine Hills is still open');
    expect(sent[0].metadata).toEqual({ group_post_id: 'scored', outcome: 'finish' });
    expect(sent[1].metadata).toEqual({ group_post_id: 'empty', outcome: 'discard' });
    expect(sent[2].metadata).toEqual({ workout_session_id: 'w-old', outcome: 'finish' });
  });
  it('a second run the same day sends nothing (the bells are the memory)', async () => {
    const { admin, inserts } = fakeAdmin({
      group_posts: [round('scored', 'active', sixDays)],
      workout_sessions: [{ id: 'w-old', title: null, profile_id: 'owner', last_activity_at: sixDays }],
      notifications: [{ metadata: { group_post_id: 'scored' } }, { metadata: { workout_session_id: 'w-old' } }],
    });
    expect(await runSessionReminders(admin, NOW)).toEqual({ due: 2, sent: 0, failed: 0, skipped: null });
    expect(inserts).toEqual([]);
  });
  it('before migration 259 the CHECK refuses the type: the step reports skipped and the day goes on', async () => {
    const { admin } = fakeAdmin({ group_posts: [round('scored', 'active', sixDays)], workout_sessions: [], notifications: [] }, { insertError: { code: '23514' } });
    expect(await runSessionReminders(admin, NOW)).toMatchObject({ due: 1, sent: 0, skipped: 'pre-259' });
  });
  it('runs in the daily cron BEFORE the two sweeps; the type is registered and allowed by 259', () => {
    const daily = read('src/app/api/cron/daily/route.ts');
    expect(daily).toMatch(/summary\.sessionReminders = await runSessionReminders\(admin\)/);
    expect(daily.indexOf('runSessionReminders(admin)')).toBeLessThan(daily.indexOf('runRoundSweep(admin)'));
    expect(read('src/lib/notification-registry.ts')).toMatch(/session_reminder: \{ tab: null, icon: 'fa-hourglass-half' \}/);
    expect(read('database/migrations/259_session_reminder.sql')).toMatch(/'session_reminder'\n  \)\);/);
  });
});
