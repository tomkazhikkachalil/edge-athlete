// ── The day-before reminder for an unfinished session — the I/O half ────────
// (resume pill program PR 3, Oct 12 2026.) `runSessionReminders(admin)`:
// the rounds the round sweep would see (pending | active, not an event's;
// the clock = the newest score for an active round, the creation for a
// pending one — abandonedRoundAction's rule) and the active workouts (the
// clock = last_activity_at), each whose clock is between 6 and 7 days old,
// minus the ones already belled (query-before-insert on the bell's
// metadata — the sport_event_reminder precedent) → one bell to the round's
// CREATOR / the workout's owner. Bounded; never throws. 23514-tolerant:
// before migration 259 the CHECK refuses the type — the sender logs "run
// migration 259", reports `skipped`, and the cron's day is otherwise untouched.

import type { SupabaseClient } from '@supabase/supabase-js';
import { insertBells } from '@/lib/sport-events/notify';
import { roundTitle } from '@/lib/drafts/list';
import { planSessionReminders, reminderDue, reminderMetadata, sessionReminderCopy, type DueSession } from './abandon-reminder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const SESSION_REMINDER_LIMIT = 200;

export interface SessionReminderRun {
  /** Sessions whose clock is in the day-before window. */
  due: number;
  sent: number;
  failed: number;
  skipped: string | null;
}

interface RoundRow {
  id: string;
  status: string | null;
  created_at: string | null;
  creator_id: string;
  title: string | null;
  sport_event_round_id: string | null;
  golf_data?: { course_name: string | null } | Array<{ course_name: string | null }> | null;
  participants?: Array<{ scores: { updated_at: string | null } | Array<{ updated_at: string | null }> | null }> | null;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function lastScoreOf(row: RoundRow): string | null {
  let last: string | null = null;
  for (const p of row.participants ?? []) {
    const s = one(p.scores);
    if (s?.updated_at && (!last || s.updated_at > last)) last = s.updated_at;
  }
  return last;
}

export async function runSessionReminders(admin: Admin, now: number = Date.now()): Promise<SessionReminderRun> {
  const out: SessionReminderRun = { due: 0, sent: 0, failed: 0, skipped: null };
  const due: DueSession[] = [];

  const { data: rounds, error: roundsError } = await admin
    .from('group_posts')
    .select('id, status, created_at, creator_id, title, sport_event_round_id, golf_data:golf_scorecard_data ( course_name ), participants:group_post_participants ( scores:golf_participant_scores ( updated_at ) )')
    .eq('type', 'golf_round')
    .in('status', ['pending', 'active'])
    .is('sport_event_round_id', null)
    .order('created_at', { ascending: true })
    .limit(SESSION_REMINDER_LIMIT);
  if (roundsError) console.error('[SESSION REMINDERS] rounds read failed:', roundsError);
  for (const r of (rounds ?? []) as RoundRow[]) {
    if (r.sport_event_round_id) continue;
    const clock = r.status === 'active' ? lastScoreOf(r) : r.status === 'pending' ? r.created_at : null;
    if (!reminderDue(clock, now)) continue;
    due.push({ kind: 'round', id: r.id, recipient: r.creator_id, title: roundTitle({ course_name: one(r.golf_data)?.course_name ?? null, title: r.title }), outcome: r.status === 'active' ? 'finish' : 'discard' });
  }

  const { data: workouts, error: workoutsError } = await admin
    .from('workout_sessions')
    .select('id, title, profile_id, last_activity_at')
    .eq('status', 'active')
    .order('last_activity_at', { ascending: true })
    .limit(SESSION_REMINDER_LIMIT);
  if (workoutsError) console.error('[SESSION REMINDERS] workouts read failed:', workoutsError);
  for (const w of (workouts ?? []) as Array<{ id: string; title: string | null; profile_id: string; last_activity_at: string | null }>) {
    if (!reminderDue(w.last_activity_at, now)) continue;
    due.push({ kind: 'workout', id: w.id, recipient: w.profile_id, title: w.title, outcome: 'finish' });
  }
  out.due = due.length;
  if (due.length === 0) return out;

  // Already belled: one read per kind, keyed kind:id.
  const already = new Set<string>();
  const roundIds = due.filter(d => d.kind === 'round').map(d => d.id);
  const workoutIds = due.filter(d => d.kind === 'workout').map(d => d.id);
  const [sentRounds, sentWorkouts] = await Promise.all([
    roundIds.length ? admin.from('notifications').select('metadata').eq('type', 'session_reminder').in('metadata->>group_post_id', roundIds).limit(1000) : Promise.resolve({ data: [] as Array<{ metadata: Record<string, unknown> | null }> }),
    workoutIds.length ? admin.from('notifications').select('metadata').eq('type', 'session_reminder').in('metadata->>workout_session_id', workoutIds).limit(1000) : Promise.resolve({ data: [] as Array<{ metadata: Record<string, unknown> | null }> }),
  ]);
  for (const n of (sentRounds.data ?? []) as Array<{ metadata: Record<string, unknown> | null }>) if (typeof n.metadata?.group_post_id === 'string') already.add(`round:${n.metadata.group_post_id}`);
  for (const n of (sentWorkouts.data ?? []) as Array<{ metadata: Record<string, unknown> | null }>) if (typeof n.metadata?.workout_session_id === 'string') already.add(`workout:${n.metadata.workout_session_id}`);

  for (const d of planSessionReminders(due, already)) {
    const result = await insertBells(admin, [d.recipient], null, sessionReminderCopy(d), reminderMetadata(d));
    if (result.error?.code === '23514') {
      console.warn('[SESSION REMINDERS] the notifications type CHECK refuses session_reminder — run migration 259');
      out.skipped = 'pre-259';
      return out;
    }
    if (result.error) out.failed += 1;
    else out.sent += 1;
  }
  return out;
}
