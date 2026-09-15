/**
 * The event page's tabs (Events program, the event page) — pure. Every tab
 * is a `?tab=` deep link (the notifications land on players / leaderboard);
 * which tabs exist depends on the viewer: Groups is the organizers'; Scorecard
 * is the players' and organizers' once the round is minted.
 */
export const EVENT_TABS = ['overview', 'schedule', 'players', 'groups', 'leaderboard', 'scorecard'] as const;
export type EventTab = (typeof EVENT_TABS)[number];

export const EVENT_TAB_LABEL: Readonly<Record<EventTab, string>> = {
  overview: 'Overview',
  schedule: 'Schedule',
  players: 'Players',
  groups: 'Groups',
  leaderboard: 'Leaderboard',
  scorecard: 'Scorecard',
};

export interface TabViewer {
  canManage: boolean;
  /** An accepted, playing participant. */
  isPlayer?: boolean;
  /** The event is live or completed — the round exists. */
  roundMinted?: boolean;
}

export function tabsFor(viewer: TabViewer): EventTab[] {
  return EVENT_TABS.filter(t => {
    if (t === 'groups') return viewer.canManage;
    if (t === 'scorecard') return !!viewer.roundMinted && (viewer.canManage || !!viewer.isPlayer);
    return true;
  });
}

/** An unknown, missing or not-yours value is the overview. */
export function parseEventTab(value: string | null | undefined, viewer: TabViewer = { canManage: true }): EventTab {
  const tab = (EVENT_TABS as readonly string[]).includes(value ?? '') ? (value as EventTab) : 'overview';
  return tabsFor(viewer).includes(tab) ? tab : 'overview';
}
