/**
 * The meet (Competition formats, track 2, PR 7) — pure. A meet is ONE
 * competition; each EVENT is a contest (`round` = the event's label,
 * `stage` = the session, `slot` = the order — 218's pair, kept). A mark
 * is the contest result: `score` = the sort key in the event's direction
 * (seconds ascend, metres descend), `payload = {mark, unit, event_key,
 * wind?, dq?}`. The event vocabulary is the sport profile's `meetEvents`
 * (built from `TRACK_EVENTS` — one vocabulary with the stat schema and the
 * PB tiles). Team score: per completed event, place by direction (a DQ is
 * unranked), award `points[place − 1]` (the default 10-8-6-5-4-3-2-1, or
 * `competitions.config.meet.points`), sum per AFFILIATION (an athlete
 * entry's `affiliation_team_id`, snapshotted at entry) — the roll-up rows
 * are TEAM ENTRIES on the same competition (`ensureTeamEntry` in the
 * server half), so `competition_standings.entry_id` keeps its FK.
 */
import { formatRaceTime } from '@/lib/sports/stat-schemas';
import { resolveCompetitionProfile, type MeetEventDef } from '@/lib/sports/competition-profiles';
import type { MeetEventRule } from './contest-outcome';
import { assignSharedRanks, type StandingRow, type StandingsColumn } from './scoring';

export const MEET_POINTS_DEFAULT: readonly number[] = [10, 8, 6, 5, 4, 3, 2, 1];
export const MEET_POINTS_MAX_PLACES = 16;

export interface MeetRule {
  /** Points per place, 1st first; non-increasing; at most 16 places. */
  points: readonly number[];
}

/** `competitions.config.meet.points` → the rule; anything malformed → the default (never a throw). */
export function parseMeetConfig(config: unknown): MeetRule {
  const meet = (config as { meet?: { points?: unknown } } | null | undefined)?.meet;
  const raw = meet?.points;
  if (Array.isArray(raw) && raw.length >= 1 && raw.length <= MEET_POINTS_MAX_PLACES && raw.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
    const pts = raw as number[];
    if (pts.every((v, i) => i === 0 || v <= pts[i - 1])) return { points: [...pts] };
  }
  return { points: [...MEET_POINTS_DEFAULT] };
}

/** "11.85" → 11.85; "4:05.30" → 245.3; "6.42m" → 6.42; null on nonsense. */
export function parseMark(text: string): number | null {
  const t = text.trim().replace(/[sm]$/i, '').trim();
  if (!t) return null;
  const m = /^(\d{1,2}):([0-5]?\d(?:\.\d{1,3})?)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+(?:\.\d{1,3})?$/.test(t)) return Number(t);
  return null;
}

/** A time reads as a race time ("4:05.30"); a distance as metres ("6.42m"). */
export function formatMark(value: number, unit: 's' | 'm'): string {
  return unit === 's' ? formatRaceTime(value) : `${value.toFixed(2)}m`;
}

/** The event def a contest was minted for — by its `round` label, or the results' `event_key`. */
export function meetEventFor(events: ReadonlyArray<MeetEventDef>, contest: { round: string | null; eventKey?: string | null }): MeetEventDef | null {
  if (contest.eventKey) {
    const byKey = events.find(e => e.key === contest.eventKey);
    if (byKey) return byKey;
  }
  return events.find(e => e.label === contest.round) ?? null;
}

export interface MeetResultInput {
  entryId: string;
  mark: number | null;
  dq?: boolean;
}

export interface MeetPlace {
  entryId: string;
  /** null = unranked (no mark, or a DQ). */
  place: number | null;
  mark: number | null;
  dq: boolean;
}

/** Places within one event by its direction; ties share (the one ranking rule); a DQ or a missing mark is unranked, listed last. */
export function placeEvent(results: ReadonlyArray<MeetResultInput>, direction: 'asc' | 'desc'): MeetPlace[] {
  const ranked = results.filter(r => r.mark != null && !r.dq);
  const rest = results.filter(r => r.mark == null || r.dq);
  const key = (r: MeetResultInput) => (direction === 'asc' ? (r.mark as number) : -(r.mark as number));
  const sorted = [...ranked].sort((a, b) => key(a) - key(b) || a.entryId.localeCompare(b.entryId));
  const ranks = assignSharedRanks(sorted.length, i => key(sorted[i]));
  return [
    ...sorted.map((r, i) => ({ entryId: r.entryId, place: ranks[i], mark: r.mark, dq: false })),
    ...rest.map(r => ({ entryId: r.entryId, place: null, mark: r.mark, dq: !!r.dq })),
  ];
}

export interface MeetContestInput {
  id: string;
  status: string;
  direction: 'asc' | 'desc';
  results: MeetResultInput[];
  /** The readers' extras (PR 8): the event's label, its unit and its place in the programme. */
  round?: string | null;
  unit?: 's' | 'm';
  stage?: number | null;
  slot?: number | null;
}

export interface MeetAthleteEntry {
  id: string;
  affiliationTeamId: string | null;
}

export interface MeetTeamEntry {
  id: string;
  teamId: string;
}

export const MEET_COLUMNS: StandingsColumn[] = [
  { key: 'points', label: 'Points', shortLabel: 'PTS' },
  { key: 'golds', label: 'First places', shortLabel: '1st' },
  { key: 'silvers', label: 'Second places', shortLabel: '2nd' },
  { key: 'bronzes', label: 'Third places', shortLabel: '3rd' },
];

/** Team standings: per completed event, the places' points summed per affiliation; medals and athletes counted. Rows are the TEAM entries. */
export function computeMeetStandings(teamEntries: ReadonlyArray<MeetTeamEntry>, athleteEntries: ReadonlyArray<MeetAthleteEntry>, contests: ReadonlyArray<MeetContestInput>, rule: MeetRule): StandingRow[] {
  const teamByAffiliation = new Map(teamEntries.map(t => [t.teamId, t.id]));
  const affiliationOf = new Map(athleteEntries.map(a => [a.id, a.affiliationTeamId]));
  const table = new Map<string, { points: number; golds: number; silvers: number; bronzes: number; athletes: Set<string>; events: number }>();
  for (const t of teamEntries) table.set(t.id, { points: 0, golds: 0, silvers: 0, bronzes: 0, athletes: new Set(), events: 0 });
  for (const c of contests) {
    if (c.status !== 'completed') continue;
    const places = placeEvent(c.results, c.direction);
    const touched = new Set<string>();
    for (const p of places) {
      const teamId = affiliationOf.get(p.entryId) ?? null;
      const entryId = teamId ? teamByAffiliation.get(teamId) : undefined;
      if (!entryId) continue;
      const row = table.get(entryId)!;
      row.athletes.add(p.entryId);
      touched.add(entryId);
      if (p.place == null) continue;
      row.points += rule.points[p.place - 1] ?? 0;
      if (p.place === 1) row.golds += 1;
      else if (p.place === 2) row.silvers += 1;
      else if (p.place === 3) row.bronzes += 1;
    }
    for (const id of touched) table.get(id)!.events += 1;
  }
  const rows = [...table.entries()].map(([entry_id, r]) => ({ entry_id, points: r.points, played: r.events, stats: { golds: r.golds, silvers: r.silvers, bronzes: r.bronzes, athletes: r.athletes.size, events: r.events } }));
  rows.sort((a, b) => b.points - a.points || b.stats.golds - a.stats.golds || b.stats.silvers - a.stats.silvers || b.stats.bronzes - a.stats.bronzes || a.entry_id.localeCompare(b.entry_id));
  const ranks = assignSharedRanks(rows.length, i => `${rows[i].points}:${rows[i].stats.golds}:${rows[i].stats.silvers}:${rows[i].stats.bronzes}`);
  return rows.map((r, i) => ({ entry_id: r.entry_id, rank: ranks[i], points: r.points, played: r.played, stats: r.stats }));
}

/** The individual leaders of one event (the console's marks list and the public block): places with formatted marks. */
export function meetIndividualLeaders(contest: MeetContestInput, unit: 's' | 'm', nameOf: (entryId: string) => string): Array<{ entryId: string; name: string; place: number | null; mark: string | null; dq: boolean }> {
  return placeEvent(contest.results, contest.direction).map(p => ({ entryId: p.entryId, name: nameOf(p.entryId), place: p.place, mark: p.mark == null ? null : formatMark(p.mark, unit), dq: p.dq }));
}

/** The outcome's per-event rule for a meet contest (matched by its round label through the sport profile's vocabulary); null = unscored. */
export function meetEventRuleFor(sportKey: string, round: string | null): MeetEventRule | null {
  const ev = meetEventFor(resolveCompetitionProfile(sportKey).meetEvents ?? [], { round });
  return ev ? { label: ev.label, unit: ev.unit, direction: ev.direction } : null;
}
