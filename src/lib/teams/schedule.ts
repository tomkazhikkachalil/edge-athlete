// ── A team's schedule & results — the PURE half (teams & divisions, PR 7) ───
// One list from three sources a team plays in:
//   • calendar events scoped to the team (events.team_id);
//   • CONTESTS its entries are in (a club or a league competition — the
//     fixture's score read from the TEAM's side: "W 3–2");
//   • SPORT EVENTS it plays a side of (sport_event_teams — a live game).
// The same game is never listed twice: a calendar row that mirrors a contest
// (contests.event_id) and an event round linked to a contest
// (contests.sport_event_round_id) fold INTO the contest. Cancelled items
// leave the list. Upcoming reads soonest-first; results newest-first. The
// items carry names and hrefs only — never a profile id or an email (a test
// serialises them). Node-tested; the reads are schedule-server.ts.

import type { ContestOutcome } from '@/lib/competitions/contest-outcome';

export type TeamItemState = 'upcoming' | 'live' | 'final';
export interface TeamResult {
  outcome: 'W' | 'L' | 'T';
  /** The team's score first: "3–2" (en dash, the house scoreline). */
  score: string;
}

export interface TeamScheduleItem {
  kind: 'calendar' | 'contest' | 'event';
  key: string;
  /** ISO instant, or a YYYY-MM-DD date for day-only items; null = unscheduled. */
  when: string | null;
  allDay: boolean;
  /** The zone the time reads in (a public page is one render for everyone). */
  timezone: string | null;
  title: string;
  /** "vs Comets" — null when the other side is unknown. */
  opponent: string | null;
  location: string | null;
  href: string | null;
  state: TeamItemState;
  result: TeamResult | null;
}

export interface CalendarInput {
  id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  timezone: string | null;
  location: string | null;
  status: string;
  href: string | null;
}

export interface ContestInput {
  id: string;
  competitionName: string;
  round: string | null;
  scheduledAt: string | null;
  playFrom: string | null;
  status: string;
  eventId: string | null;
  sportEventRoundId: string | null;
  myEntryId: string;
  outcome: ContestOutcome;
  href: string | null;
}

export interface EventInput {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  date: string | null;
  mySide: 1 | 2;
  opponentName: string | null;
  side1Score: number | null;
  side2Score: number | null;
  roundIds: string[];
  timezone: string | null;
  href: string | null;
}

/** A fixture / bracket result from THIS entry's side, or null (unscored). */
export function teamResultLine(outcome: ContestOutcome, myEntryId: string): TeamResult | null {
  if (outcome.kind !== 'fixture' && outcome.kind !== 'bracket') return null;
  const { home, away } = outcome;
  if (!home || !away || home.score === null || away.score === null) return null;
  const mine = home.entryId === myEntryId ? home : away.entryId === myEntryId ? away : null;
  if (!mine) return null;
  const theirs = mine === home ? away : home;
  const myScore = mine.score as number;
  const theirScore = theirs.score as number;
  const result: TeamResult['outcome'] = outcome.winnerEntryId === myEntryId ? 'W' : outcome.winnerEntryId ? 'L' : outcome.tie ? 'T' : myScore > theirScore ? 'W' : 'L';
  return { outcome: result, score: `${myScore}–${theirScore}` };
}

/** A game event's result from the team's side, or null (no score yet). */
export function gameResultLine(mySide: 1 | 2, side1: number | null, side2: number | null): TeamResult | null {
  if (side1 === null || side2 === null) return null;
  const mine = mySide === 1 ? side1 : side2;
  const theirs = mySide === 1 ? side2 : side1;
  return { outcome: mine > theirs ? 'W' : mine < theirs ? 'L' : 'T', score: `${mine}–${theirs}` };
}

function contestOpponent(outcome: ContestOutcome, myEntryId: string): string | null {
  if (outcome.kind !== 'fixture' && outcome.kind !== 'bracket') return null;
  if (outcome.home?.entryId === myEntryId) return outcome.away?.name ?? null;
  if (outcome.away?.entryId === myEntryId) return outcome.home?.name ?? null;
  return null;
}

function contestState(status: string): TeamItemState | null {
  if (status === 'canceled' || status === 'cancelled') return null;
  if (status === 'completed') return 'final';
  if (status === 'in_progress') return 'live';
  return 'upcoming';
}

function eventState(status: string): TeamItemState | null {
  if (status === 'cancelled' || status === 'draft') return null;
  if (status === 'completed') return 'final';
  if (status === 'live') return 'live';
  return 'upcoming';
}

export function mergeTeamSchedule(input: {
  calendar: readonly CalendarInput[];
  contests: readonly ContestInput[];
  events: readonly EventInput[];
}): { upcoming: TeamScheduleItem[]; results: TeamScheduleItem[] } {
  const mirroredEventIds = new Set(input.contests.map(c => c.eventId).filter((v): v is string => !!v));
  // A contest reads in its calendar mirror's zone when the team can see it.
  const zoneOfCalendar = new Map(input.calendar.map(e => [e.id, e.timezone]));
  const linkedRoundIds = new Set(input.contests.map(c => c.sportEventRoundId).filter((v): v is string => !!v));
  const items: TeamScheduleItem[] = [];

  for (const c of input.contests) {
    const state = contestState(c.status);
    if (!state) continue;
    items.push({
      kind: 'contest',
      key: `contest:${c.id}`,
      when: c.scheduledAt ?? c.playFrom,
      allDay: !c.scheduledAt && !!c.playFrom,
      timezone: (c.eventId ? zoneOfCalendar.get(c.eventId) : null) ?? null,
      title: c.round ? `${c.competitionName} · ${c.round}` : c.competitionName,
      opponent: contestOpponent(c.outcome, c.myEntryId),
      location: null,
      href: c.href,
      state,
      result: state === 'final' ? teamResultLine(c.outcome, c.myEntryId) : null,
    });
  }
  for (const e of input.calendar) {
    if (e.status !== 'active' || mirroredEventIds.has(e.id)) continue;
    items.push({ kind: 'calendar', key: `calendar:${e.id}`, when: e.starts_at, allDay: e.all_day, timezone: e.timezone, title: e.title, opponent: null, location: e.location, href: e.href, state: 'upcoming', result: null });
  }
  for (const ev of input.events) {
    const state = eventState(ev.status);
    if (!state || ev.roundIds.some(id => linkedRoundIds.has(id))) continue;
    items.push({
      kind: 'event',
      key: `event:${ev.id}`,
      when: ev.startsAt ?? ev.date,
      allDay: !ev.startsAt && !!ev.date,
      timezone: ev.timezone,
      title: ev.name,
      opponent: ev.opponentName,
      location: null,
      href: ev.href,
      state,
      result: state === 'final' ? gameResultLine(ev.mySide, ev.side1Score, ev.side2Score) : null,
    });
  }

  const at = (i: TeamScheduleItem) => (i.when ? Date.parse(i.when.length === 10 ? `${i.when}T12:00:00Z` : i.when) : Number.POSITIVE_INFINITY);
  const upcoming = items.filter(i => i.state !== 'final').sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key));
  const results = items.filter(i => i.state === 'final').sort((a, b) => at(b) - at(a) || a.key.localeCompare(b.key));
  return { upcoming, results };
}
