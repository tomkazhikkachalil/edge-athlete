/**
 * When the feed's "Turn on notifications" card shows (Tom, Oct 2 2026 —
 * "option 1"): it stays until the person chooses. "Turn on" ends it (the
 * device is on); "Not now" puts it away for a week, then it asks again. A
 * device whose notifications are blocked is never asked — only the phone's
 * settings can undo that. Pure, so the week is unit-tested.
 */

export const PUSH_CARD_SNOOZE_KEY = 'ea:push-card:snoozed-until:v1';
export const PUSH_CARD_SNOOZE_DAYS = 7;

/** The stored "Not now" — an ISO instant, or null when never snoozed (or
 *  the value is unreadable, which asks again rather than never). */
export function parseSnooze(raw: string | null): number | null {
  if (!raw) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

export function isSnoozed(snoozedUntil: number | null, now: number): boolean {
  return snoozedUntil !== null && now < snoozedUntil;
}

export function snoozeUntil(now: number): string {
  return new Date(now + PUSH_CARD_SNOOZE_DAYS * 86_400_000).toISOString();
}
