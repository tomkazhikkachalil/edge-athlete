/**
 * The event page's tabs (Events program, the event page) — pure. Every tab
 * is a `?tab=` deep link (the notifications land on players / leaderboard);
 * which tabs exist depends on the viewer: Groups is the organizers'; Scorecard
 * is the players' and organizers' once the round is minted.
 */
import { activeRounds, currentRound } from './rounds';
import type { SportEventRoundStatus } from './types';

export const EVENT_TABS = ['overview', 'schedule', 'players', 'groups', 'leaderboard', 'matches', 'scorecard'] as const;
export type EventTab = (typeof EVENT_TABS)[number];

export const EVENT_TAB_LABEL: Readonly<Record<EventTab, string>> = {
  overview: 'Overview',
  schedule: 'Schedule',
  players: 'Players',
  groups: 'Groups',
  leaderboard: 'Leaderboard',
  matches: 'Matches',
  scorecard: 'Scorecard',
};

export interface TabViewer {
  canManage: boolean;
  /** An accepted, playing participant. */
  isPlayer?: boolean;
  /** At least one round has been minted (phase 2: any round, not "the" round). */
  roundMinted?: boolean;
  /** Phase 3: a match-play event shows Matches instead of Leaderboard (an old bell's deep link never renders a gross board). */
  matchPlay?: boolean;
}

export function tabsFor(viewer: TabViewer): EventTab[] {
  return EVENT_TABS.filter(t => {
    if (t === 'groups') return viewer.canManage;
    if (t === 'scorecard') return !!viewer.roundMinted && (viewer.canManage || !!viewer.isPlayer);
    if (t === 'leaderboard') return !viewer.matchPlay;
    if (t === 'matches') return !!viewer.matchPlay;
    return true;
  });
}

/** An unknown, missing or not-yours value is the overview. */
export function parseEventTab(value: string | null | undefined, viewer: TabViewer = { canManage: true }): EventTab {
  const tab = (EVENT_TABS as readonly string[]).includes(value ?? '') ? (value as EventTab) : 'overview';
  return tabsFor(viewer).includes(tab) ? tab : 'overview';
}

// ── The round a tab shows (phase 2) ────────────────────────────────────────

/** 'overall' (the tournament board), 'bracket' (phase 3: the whole bracket on the Matches tab) or a round id. */
export type RoundSelection = 'overall' | 'bracket' | string;

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

/** Phase 3: the Matches tab offers the whole bracket on a bracket event with more than one round. */
export function offersBracket(tab: EventTab, rounds: ReadonlyArray<RoundForTabs>, bracket: boolean): boolean {
  return tab === 'matches' && bracket && activeRounds(rounds).length > 1;
}

/** The rounds a tab can show: the scorecard only minted rounds; every other tab the non-cancelled ones. */
export function roundsForTab(tab: EventTab, rounds: ReadonlyArray<RoundForTabs>): RoundForTabs[] {
  const active = activeRounds(rounds);
  return tab === 'scorecard' ? active.filter(r => r.group_post_id !== null) : active;
}

export interface RoundParamOptions {
  /** Phase 3: the event is a bracket (the Matches tab then offers `bracket`). */
  bracket?: boolean;
}

/** The tab's default: the overall board on a tournament's leaderboard, the bracket on a bracket event's Matches tab, else the current round (live → next scheduled → last completed). */
export function defaultRoundFor(tab: EventTab, rounds: ReadonlyArray<RoundForTabs>, opts: RoundParamOptions = {}): RoundSelection | null {
  if (offersOverall(tab, rounds)) return 'overall';
  if (offersBracket(tab, rounds, !!opts.bracket)) return 'bracket';
  return currentRound(roundsForTab(tab, rounds))?.id ?? null;
}

/** `?round=`: 'overall' / 'bracket' where offered, a round id the tab can show, else the tab's default — never a blank panel. */
export function parseRoundParam(value: string | null | undefined, rounds: ReadonlyArray<RoundForTabs>, tab: EventTab, opts: RoundParamOptions = {}): RoundSelection | null {
  if (value === 'overall' && offersOverall(tab, rounds)) return 'overall';
  if (value === 'bracket' && offersBracket(tab, rounds, !!opts.bracket)) return 'bracket';
  if (value && roundsForTab(tab, rounds).some(r => r.id === value)) return value;
  return defaultRoundFor(tab, rounds, opts);
}
