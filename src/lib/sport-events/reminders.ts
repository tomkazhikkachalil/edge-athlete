/**
 * The day-before reminder — the pure half (Events program, phase 2b, B2;
 * migration 210 `sport_event_reminder`). Who gets the bell for a round
 * scheduled tomorrow and what it says. `reminders-server.ts` reads and
 * inserts; `/api/cron/daily` runs it once a day.
 */
import type { SportEventParticipantStatus } from './types';
import { eventPath } from './notify';
import { formatDateOnly } from './format';

export interface ReminderCopy {
  type: 'sport_event_reminder';
  title: string;
  message: string;
  action_url: string;
}

/** "Tomorrow: Spring Open · Round 2 of 3" / "Sat, Jun 1 · QA Links" → the schedule. */
export function reminderCopy(event: { id: string; name: string }, round: { sequence: number; scheduled_on: string; course_name: string; name?: string | null }, roundCount: number): ReminderCopy {
  const roundPart = roundCount > 1 ? ` · Round ${round.sequence} of ${roundCount}` : '';
  const label = round.name ? ` · ${round.name}` : '';
  return {
    type: 'sport_event_reminder',
    title: `Tomorrow: ${event.name}${roundPart}`,
    message: `${formatDateOnly(round.scheduled_on, { weekday: true })}${label} · ${round.course_name}`,
    action_url: `${eventPath(event.id)}?tab=schedule`,
  };
}

/**
 * The recipients: every ACCEPTED participant (players and followers), minus
 * anyone already belled for this round. A declined / invited / waitlisted
 * row gets nothing — the round is not theirs yet.
 */
export function planRoundReminders(participants: ReadonlyArray<{ profile_id: string; status: SportEventParticipantStatus }>, alreadyNotified: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of participants) {
    if (p.status !== 'accepted' || seen.has(p.profile_id) || alreadyNotified.has(p.profile_id)) continue;
    seen.add(p.profile_id);
    out.push(p.profile_id);
  }
  return out;
}
