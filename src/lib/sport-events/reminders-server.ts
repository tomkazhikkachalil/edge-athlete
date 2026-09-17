/**
 * The day-before reminder — the I/O half (Events program, phase 2b, B2).
 * `sendRoundReminders(admin, tomorrowKey)`: every round `scheduled` on that
 * DATE on an event `open | live` → its accepted participants → minus the
 * ones already belled for this round (query-before-insert on the bell's
 * metadata, the golf_league_window_closing precedent) → one insert per
 * round. Bounded; never throws. 23514-tolerant: before migration 210 the
 * CHECK refuses the type — the sender logs "run migration 210" and reports
 * `skipped`, and the cron's day is otherwise untouched.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysIso, utcToday } from '@/lib/competitions/golf-weeks';
import { insertBells } from './notify';
import { planRoundReminders, reminderCopy } from './reminders';
import type { SportEventParticipantStatus } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface ReminderRun {
  day: string;
  rounds: number;
  sent: number;
  skipped: string | null;
}

export async function sendRoundReminders(admin: Admin, tomorrowKey: string): Promise<ReminderRun> {
  const out: ReminderRun = { day: tomorrowKey, rounds: 0, sent: 0, skipped: null };
  const { data: roundRows, error } = await admin
    .from('sport_event_rounds')
    .select('id, sequence, scheduled_on, course_name, name, starts_at, timezone, sport_event_id, event:sport_event_id!inner (id, name, status)')
    .eq('scheduled_on', tomorrowKey)
    .eq('status', 'scheduled')
    .in('event.status', ['open', 'live'])
    .limit(100);
  if (error) {
    console.error('[sport-events reminders] rounds read failed:', error);
    return out;
  }
  const rounds = (roundRows ?? []) as Array<{ id: string; sequence: number; scheduled_on: string; course_name: string; name: string | null; sport_event_id: string; event: { id: string; name: string; status: string } | Array<{ id: string; name: string; status: string }> }>;
  if (rounds.length === 0) return out;

  const eventIds = [...new Set(rounds.map(r => r.sport_event_id))];
  const { data: countRows } = await admin.from('sport_event_rounds').select('sport_event_id').in('sport_event_id', eventIds).neq('status', 'cancelled');
  const roundCount = new Map<string, number>();
  for (const r of (countRows ?? []) as Array<{ sport_event_id: string }>) roundCount.set(r.sport_event_id, (roundCount.get(r.sport_event_id) ?? 0) + 1);

  for (const round of rounds) {
    const event = Array.isArray(round.event) ? round.event[0] : round.event;
    if (!event) continue;
    out.rounds += 1;
    const [{ data: parts }, { data: sent }] = await Promise.all([
      admin.from('sport_event_participants').select('profile_id, status').eq('sport_event_id', event.id).eq('status', 'accepted').limit(1000),
      admin.from('notifications').select('user_id').eq('type', 'sport_event_reminder').contains('metadata', { sport_event_round_id: round.id }).limit(1000),
    ]);
    const recipients = planRoundReminders(
      (parts ?? []) as Array<{ profile_id: string; status: SportEventParticipantStatus }>,
      new Set(((sent ?? []) as Array<{ user_id: string }>).map(n => n.user_id)),
    );
    if (recipients.length === 0) continue;
    const copy = reminderCopy(event, round, roundCount.get(event.id) ?? 1);
    const result = await insertBells(admin, recipients, null, copy, { sport_event_id: event.id, sport_event_round_id: round.id, sport_event_name: event.name });
    if (result.error?.code === '23514') {
      console.warn('[sport-events reminders] the notifications type CHECK refuses sport_event_reminder — run migration 210');
      out.skipped = 'pre-210';
      return out;
    }
    if (!result.error) out.sent += recipients.length;
  }
  return out;
}

/** The daily step: tomorrow, the UTC day. */
export async function runSportEventReminders(admin: Admin): Promise<ReminderRun> {
  return sendRoundReminders(admin, addDaysIso(utcToday(), 1));
}
