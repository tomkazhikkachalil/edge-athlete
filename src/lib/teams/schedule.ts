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
  /** G2: a fixture's two sides as data (home first) — the game-day cards
   *  draw a scoreboard from it; absent when a side is unknown. */
  pair?: GamePair;
  /** G3: the teams (ids) playing it — the org games' team filter. */
  teamIds?: string[];
}

export interface GamePair {
  home: string;
  away: string;
  /** null until scored. */
  homeScore: number | null;
  awayScore: number | null;
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
  /** G4: the team's own name on its side — with the opponent's, the sides as data. */
  myName?: string | null;
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
      ...withPair(pairing(c.outcome).pair),
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
      ...withPair(
        ev.myName && ev.opponentName
          ? eventPair(ev.mySide === 1 ? ev.myName : ev.opponentName, ev.mySide === 1 ? ev.opponentName : ev.myName, ev.side1Score, ev.side2Score)
          : undefined
      ),
    });
  }

  const at = (i: TeamScheduleItem) => (i.when ? Date.parse(i.when.length === 10 ? `${i.when}T12:00:00Z` : i.when) : Number.POSITIVE_INFINITY);
  const upcoming = items.filter(i => i.state !== 'final').sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key));
  const results = items.filter(i => i.state === 'final').sort((a, b) => at(b) - at(a) || a.key.localeCompare(b.key));
  return { upcoming, results };
}

// ── A DIVISION's schedule (PR 9) — the same items, no single side ───────────
// A division page lists its games as "Comets 2–3 Blazers" (home first, the
// house scoreline) — there is no one team to read a W/L from. The same
// folding: a calendar row mirroring a contest folds into it; cancelled
// items leave.

export interface DivisionContestInput {
  id: string;
  competitionName: string;
  round: string | null;
  scheduledAt: string | null;
  playFrom: string | null;
  status: string;
  eventId: string | null;
  /** G4: the event round a linked contest mirrors — its event folds into it. */
  sportEventRoundId?: string | null;
  outcome: ContestOutcome;
  href: string | null;
}

/** G4: a sport-event game at the division / org level — both sides named
 *  (side 1 = home, the game shape's Home / Away), no single side to read a
 *  W/L from. */
export interface DivisionEventInput {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  date: string | null;
  side1Name: string | null;
  side2Name: string | null;
  side1Score: number | null;
  side2Score: number | null;
  roundIds: string[];
  timezone: string | null;
  href: string | null;
  /** The teams (ids) playing a side. */
  teamIds: string[];
}

function withPair(pair: GamePair | undefined): { pair?: GamePair } {
  return pair ? { pair } : {};
}

function eventPair(home: string, away: string, homeScore: number | null, awayScore: number | null): GamePair {
  const scored = homeScore !== null && awayScore !== null;
  return { home, away, homeScore: scored ? homeScore : null, awayScore: scored ? awayScore : null };
}

function pairing(outcome: ContestOutcome): { title: string | null; score: string | null; pair?: GamePair } {
  if (outcome.kind !== 'fixture' && outcome.kind !== 'bracket') return { title: null, score: null };
  const home = outcome.home?.name ?? null;
  const away = outcome.away?.name ?? null;
  if (!home || !away) return { title: home ?? away, score: null };
  const scored = outcome.home?.score !== null && outcome.home?.score !== undefined && outcome.away?.score !== null && outcome.away?.score !== undefined;
  const pair: GamePair = { home, away, homeScore: scored ? outcome.home!.score! : null, awayScore: scored ? outcome.away!.score! : null };
  return { title: `${home} vs ${away}`, score: scored ? `${home} ${outcome.home!.score}–${outcome.away!.score} ${away}` : null, pair };
}

export function divisionSchedule(input: {
  calendar: readonly CalendarInput[];
  contests: readonly DivisionContestInput[];
  events?: readonly DivisionEventInput[];
}): { upcoming: TeamScheduleItem[]; results: TeamScheduleItem[] } {
  const mirrored = new Set(input.contests.map(c => c.eventId).filter((v): v is string => !!v));
  const linkedRoundIds = new Set(input.contests.map(c => c.sportEventRoundId).filter((v): v is string => !!v));
  const zoneOfCalendar = new Map(input.calendar.map(e => [e.id, e.timezone]));
  const items: TeamScheduleItem[] = [];
  for (const c of input.contests) {
    const state = contestState(c.status);
    if (!state) continue;
    const pair = pairing(c.outcome);
    const label = c.round ? `${c.competitionName} · ${c.round}` : c.competitionName;
    items.push({
      kind: 'contest',
      key: `contest:${c.id}`,
      when: c.scheduledAt ?? c.playFrom,
      allDay: !c.scheduledAt && !!c.playFrom,
      timezone: (c.eventId ? zoneOfCalendar.get(c.eventId) : null) ?? null,
      title: state === 'final' && pair.score ? pair.score : (pair.title ?? label),
      opponent: null,
      location: pair.title ? label : null,
      href: c.href,
      state,
      result: null,
      ...(pair.pair ? { pair: pair.pair } : {}),
    });
  }
  for (const e of input.calendar) {
    if (e.status !== 'active' || mirrored.has(e.id)) continue;
    items.push({ kind: 'calendar', key: `calendar:${e.id}`, when: e.starts_at, allDay: e.all_day, timezone: e.timezone, title: e.title, opponent: null, location: e.location, href: e.href, state: 'upcoming', result: null });
  }
  // G4: the sport-event games (a game between two sides no competition
  // owns); one a linked contest mirrors folds into the contest.
  for (const ev of input.events ?? []) {
    const state = eventState(ev.status);
    if (!state || ev.roundIds.some(id => linkedRoundIds.has(id))) continue;
    const pair = ev.side1Name && ev.side2Name ? eventPair(ev.side1Name, ev.side2Name, ev.side1Score, ev.side2Score) : undefined;
    const scoreLine = pair && pair.homeScore !== null ? `${pair.home} ${pair.homeScore}–${pair.awayScore} ${pair.away}` : null;
    items.push({
      kind: 'event',
      key: `event:${ev.id}`,
      when: ev.startsAt ?? ev.date,
      allDay: !ev.startsAt && !!ev.date,
      timezone: ev.timezone,
      title: state === 'final' && scoreLine ? scoreLine : pair ? `${pair.home} vs ${pair.away}` : ev.name,
      opponent: null,
      location: pair ? ev.name : null,
      href: ev.href,
      state,
      result: null,
      ...withPair(pair),
      ...(ev.teamIds.length ? { teamIds: ev.teamIds } : {}),
    });
  }
  const at = (i: TeamScheduleItem) => (i.when ? Date.parse(i.when.length === 10 ? `${i.when}T12:00:00Z` : i.when) : Number.POSITIVE_INFINITY);
  return {
    upcoming: items.filter(i => i.state !== 'final').sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key)),
    results: items.filter(i => i.state === 'final').sort((a, b) => at(b) - at(a) || a.key.localeCompare(b.key)),
  };
}

/** G4: the game a page leads with — the soonest upcoming or live GAME (a
 *  contest or a sport event; a calendar row is a practice or a meeting). */
export function nextGameOf(schedule: { upcoming: readonly TeamScheduleItem[] }): TeamScheduleItem | null {
  return schedule.upcoming.find(i => i.kind !== 'calendar') ?? null;
}

// ── An org's games window (sports-team website program, G1) ────────────────
export const GAME_WINDOW_DAYS = 60;

/** Inside the window: scheduled (or opening) within ±days of now; an
 *  unscheduled or unparseable time counts (it is still to come). */
export function inGameWindow(when: string | null, nowMs: number, days: number = GAME_WINDOW_DAYS): boolean {
  if (!when) return true;
  const at = Date.parse(when.length === 10 ? `${when}T12:00:00Z` : when);
  if (!Number.isFinite(at)) return true;
  return Math.abs(at - nowMs) <= days * 86_400_000;
}
