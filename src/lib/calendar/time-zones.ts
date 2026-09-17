/**
 * IANA time zones — the one validator (Events + formats leftovers, PR 8; moved
 * out of `calendar/events.ts` so the sport-events parser shares it). A zone is
 * valid when Intl can build a formatter for it; the length cap matches 221's
 * CHECK on `sport_event_rounds.timezone`.
 */
export const TIME_ZONE_MAX = 64;

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > TIME_ZONE_MAX) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
