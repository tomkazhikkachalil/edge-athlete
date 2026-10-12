// ── The day-before reminder for an unfinished session — the pure half ───────
// (resume pill program PR 3, Oct 12 2026; migration 259 `session_reminder`.)
// Tom's spec: "After 7 days with no activity … send a reminder a day before
// … so the user can save it first." The 7-day rule is the Drafts round's
// (golf/round-status.ts abandonedRoundAction, workouts/status.ts
// isAbandonedSession): a scored round or an active workout is FINISHED as
// played, a scoreless round DISCARDED — Tom, Oct 6 and Oct 12: nothing
// recorded is ever deleted. This decides WHEN the bell is due (the clock
// between 6 and 7 days old) and WHAT it says (which of the two will happen);
// abandon-reminder-server.ts reads and inserts, once per session.

import { ABANDON_AFTER_MS } from '@/lib/workouts/status';

/** The bell goes out this long before the sweep acts. */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

export type SessionReminderKind = 'round' | 'workout';
/** What the sweep will do tomorrow: finish as played (anything recorded) or discard (nothing was). */
export type AbandonOutcome = 'finish' | 'discard';

/** Due when the session's clock is at least (abandon − lead) old and not yet abandoned — the sweep's own window, one day early. */
export function reminderDue(clockIso: string | null | undefined, now: number, abandonAfterMs: number = ABANDON_AFTER_MS): boolean {
  if (!clockIso) return false;
  const t = Date.parse(clockIso);
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= abandonAfterMs - REMINDER_LEAD_MS && age <= abandonAfterMs;
}

export interface SessionReminderCopy {
  type: 'session_reminder';
  title: string;
  message: string;
  action_url: string;
}

export function sessionReminderCopy(input: { kind: SessionReminderKind; id: string; title: string | null; outcome: AbandonOutcome }): SessionReminderCopy {
  if (input.kind === 'round') {
    const where = input.title?.trim() ? ` at ${input.title.trim()}` : '';
    return {
      type: 'session_reminder',
      title: `Your round${where} is still open`,
      message:
        input.outcome === 'finish'
          ? 'No score has been entered for 6 days. Finish or discard it by tomorrow — otherwise it is finished as played (the record is kept; nothing is posted).'
          : 'No scores were entered in 6 days. Resume or discard it by tomorrow — otherwise it is discarded.',
      action_url: `/live/${input.id}`,
    };
  }
  const named = input.title?.trim() && input.title.trim() !== 'Workout' ? ` “${input.title.trim()}”` : '';
  return {
    type: 'session_reminder',
    title: `Your workout${named} is still in progress`,
    message: 'Nothing has been logged for 6 days. Finish or discard it by tomorrow — otherwise it is finished as it stands (a draft, never posted).',
    action_url: `/app/workout/${input.id}`,
  };
}

export interface DueSession {
  kind: SessionReminderKind;
  id: string;
  recipient: string;
  title: string | null;
  outcome: AbandonOutcome;
}

/** The bells to send: every due session minus the ones already belled (by kind:id), each once. */
export function planSessionReminders(due: ReadonlyArray<DueSession>, alreadyNotified: ReadonlySet<string>): DueSession[] {
  const out: DueSession[] = [];
  const seen = new Set<string>();
  for (const d of due) {
    const key = `${d.kind}:${d.id}`;
    if (seen.has(key) || alreadyNotified.has(key) || !d.recipient) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/** The metadata key the dedupe reads, by kind. */
export function reminderMetadata(d: Pick<DueSession, 'kind' | 'id' | 'outcome'>): Record<string, unknown> {
  return d.kind === 'round' ? { group_post_id: d.id, outcome: d.outcome } : { workout_session_id: d.id, outcome: d.outcome };
}
