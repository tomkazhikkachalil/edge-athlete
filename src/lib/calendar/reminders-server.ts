// Reminder sweep — invoked by pg_cron every 10 minutes via
// /api/cron/reminders, and (as an idempotent safety net) once daily by
// /api/cron/daily. Because reminder leads are PRESETS, the sweep is one
// exact PostgREST query per nonzero lead: no per-row interval SQL, no RPC.
// MARK-THEN-INSERT: reminded_at is set before the notification insert — a
// rare missed reminder (insert failure after mark) beats 10-minute repeat
// spam. Recipients: any registered, non-declined guest row (organizer
// included; email invitees are in-app-less and excluded).

import type { SupabaseClient } from '@supabase/supabase-js';
import { REMINDER_OPTIONS, isDue, reminderTitle } from './reminders';
import { formatEventWhen } from './format-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const BUCKET_LIMIT = 200;

interface DueRow {
  id: string;
  profile_id: string;
  reminder_minutes: number;
  events: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    timezone: string;
  };
}

export async function runReminderSweep(
  admin: Admin,
  now: Date = new Date()
): Promise<{ due: number; marked: number; inserted: number }> {
  const summary = { due: 0, marked: 0, inserted: 0 };
  const nowMs = now.getTime();

  for (const lead of REMINDER_OPTIONS) {
    if (lead === 0) continue;
    const { data, error } = await admin
      .from('event_guests')
      .select('id, profile_id, reminder_minutes, events!inner(id, title, starts_at, ends_at, all_day, timezone)')
      .eq('reminder_minutes', lead)
      .is('reminded_at', null)
      .not('profile_id', 'is', null)
      .neq('status', 'declined')
      .eq('events.status', 'active')
      .gt('events.starts_at', now.toISOString())
      .lte('events.starts_at', new Date(nowMs + lead * 60_000).toISOString())
      .limit(BUCKET_LIMIT);
    if (error) {
      console.error(`[REMINDERS] bucket ${lead} query failed:`, error);
      continue;
    }
    const rows = (data ?? []) as unknown as DueRow[];
    // Re-guard in JS (free) — protects against clock skew edge cases.
    const due = rows.filter(r => isDue(Date.parse(r.events.starts_at), r.reminder_minutes, nowMs));
    if (due.length === 0) continue;
    summary.due += due.length;

    // 1. Mark first (dedup even if the insert below fails).
    const { error: markError } = await admin
      .from('event_guests')
      .update({ reminded_at: now.toISOString() })
      .in('id', due.map(r => r.id));
    if (markError) {
      console.error(`[REMINDERS] bucket ${lead} mark failed:`, markError);
      continue;
    }
    summary.marked += due.length;

    // 2. Insert the notifications (direct insert — the RPC drops new types).
    const notifications = due.map(r => ({
      user_id: r.profile_id,
      type: 'event_reminder',
      actor_id: null,
      title: reminderTitle(r.events.title, Date.parse(r.events.starts_at), nowMs),
      message: formatEventWhen(r.events.starts_at, r.events.ends_at, r.events.all_day, r.events.timezone),
      action_url: `/calendar?event=${r.events.id}`,
      is_read: false,
      metadata: { event_id: r.events.id, reminder_minutes: r.reminder_minutes },
    }));
    const { error: insertError } = await admin.from('notifications').insert(notifications);
    if (insertError) {
      console.error(`[REMINDERS] bucket ${lead} insert failed:`, insertError);
      continue;
    }
    summary.inserted += notifications.length;
  }
  return summary;
}
