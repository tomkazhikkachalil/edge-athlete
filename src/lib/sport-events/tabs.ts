/**
 * The event page's tabs (Events program, the event page) — pure. Every tab
 * is a `?tab=` deep link (the notifications land on players / leaderboard);
 * which tabs exist depends on the viewer: Groups is the organizers'; Scorecard
 * is the players' and organizers' once the round is minted.
 */
import { activeRounds, currentRound } from './rounds';
import type { SportEventRoundStatus } from './types';

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
  /** At least one round has been minted (phase 2: any round, not "the" round). */
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

// ── The round a tab shows (phase 2) ────────────────────────────────────────

/** 'overall' (the tournament board) or a round id. */
export type RoundSelection = 'overall' | string;

export interface RoundForTabs {
  id: string;
  sequence: number;
  status: SportEventRoundStatus;
  group_post_id: string | null;
}

/** Whether the tab offers the overall board: a tournament (more than one non-cancelled round) on the leaderboard. */
export function offersOverall(tab: EventTab, rounds: ReadonlyArray<RoundForTabs>): boolean {
  return tab === 'leaderboard' && activeRounds(rounds).length > 1;
}

/** The rounds a tab can show: the scorecard only minted rounds; every other tab the non-cancelled ones. */
export function roundsForTab(tab: EventTab, rounds: ReadonlyArray<RoundForTabs>): RoundForTabs[] {
  const active = activeRounds(rounds);
  return tab === 'scorecard' ? active.filter(r => r.group_post_id !== null) : active;
}

/** The tab's default: the overall board on a tournament's leaderboard, else the current round (live → next scheduled → last completed). */
export function defaultRoundFor(tab: EventTab, rounds: ReadonlyArray<RoundForTabs>): RoundSelection | null {
  if (offersOverall(tab, rounds)) return 'overall';
  return currentRound(roundsForTab(tab, rounds))?.id ?? null;
}

/** `?round=`: 'overall' where offered, a round id the tab can show, else the tab's default — never a blank panel. */
export function parseRoundParam(value: string | null | undefined, rounds: ReadonlyArray<RoundForTabs>, tab: EventTab): RoundSelection | null {
  if (value === 'overall' && offersOverall(tab, rounds)) return 'overall';
  if (value && roundsForTab(tab, rounds).some(r => r.id === value)) return value;
  return defaultRoundFor(tab, rounds);
}
