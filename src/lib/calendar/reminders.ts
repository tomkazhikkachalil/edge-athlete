// Reminder logic — pure parts (unit-tested). The sweep itself lives in
// reminders-server.ts; these helpers define the preset contract and the
// due/title math it uses.

export const REMINDER_OPTIONS = [0, 10, 30, 60, 1440] as const;
export type ReminderMinutes = (typeof REMINDER_OPTIONS)[number];

export const REMINDER_LABELS: Record<number, string> = {
  0: 'Off',
  10: '10 minutes before',
  30: '30 minutes before',
  60: '1 hour before',
  1440: '1 day before',
};

export function isValidReminderMinutes(value: unknown): value is ReminderMinutes {
  return typeof value === 'number' && (REMINDER_OPTIONS as readonly number[]).includes(value);
}

/** Due: inside the lead window and the event hasn't started yet. */
export function isDue(startsAtMs: number, reminderMinutes: number, nowMs: number): boolean {
  if (reminderMinutes <= 0) return false;
  if (startsAtMs <= nowMs) return false;
  return startsAtMs - reminderMinutes * 60_000 <= nowMs;
}

/** "Reminder: Team Practice starts in 30 minutes" — humanized actual delta. */
export function reminderTitle(eventTitle: string, startsAtMs: number, nowMs: number): string {
  const minutes = Math.max(Math.round((startsAtMs - nowMs) / 60_000), 1);
  let when: string;
  if (minutes < 60) {
    when = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  } else if (minutes < 48 * 60) {
    const hours = Math.round(minutes / 60);
    when = `${hours} hour${hours === 1 ? '' : 's'}`;
  } else {
    const days = Math.round(minutes / 1440);
    when = `${days} day${days === 1 ? '' : 's'}`;
  }
  return `Reminder: ${eventTitle} starts in ${when}`;
}
