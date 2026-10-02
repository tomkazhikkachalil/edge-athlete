/**
 * The calendar's event categories — zero imports, so a page that only needs
 * the list (the feed's calendar widget) does not pull the event validator,
 * and with it zod, into its bundle (speed round, Oct 2026).
 * `src/lib/calendar/events.ts` re-exports both names.
 */
export const EVENT_CATEGORIES = [
  'general', 'practice', 'game', 'tournament', 'training', 'social', 'other', 'workout',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
