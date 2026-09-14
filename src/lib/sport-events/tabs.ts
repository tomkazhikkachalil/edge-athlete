/**
 * The event page's tabs (Events program, the event page) — pure. Every tab
 * is a `?tab=` deep link (the notifications land on players / leaderboard);
 * which tabs exist depends on the viewer and the event's state.
 */
export const EVENT_TABS = ['overview', 'schedule', 'players', 'leaderboard'] as const;
export type EventTab = (typeof EVENT_TABS)[number];

export const EVENT_TAB_LABEL: Readonly<Record<EventTab, string>> = {
  overview: 'Overview',
  schedule: 'Schedule',
  players: 'Players',
  leaderboard: 'Leaderboard',
};

export function tabsFor(): EventTab[] {
  return [...EVENT_TABS];
}

/** An unknown or missing value is the overview. */
export function parseEventTab(value: string | null | undefined): EventTab {
  return (EVENT_TABS as readonly string[]).includes(value ?? '') ? (value as EventTab) : 'overview';
}
