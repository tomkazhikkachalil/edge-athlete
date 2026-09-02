// ── Golf league weeks — the week-to-week view of a golf leaderboard ────────
// Phase 6d W1. A golf league's page fills itself (Tom's principle 2), and
// this is where the filling becomes VISIBLE: which round is open, its
// window, holes and course, who has posted, and what they shot — per
// round, not just the cumulative board. Everything here is pure and
// date-only: `contests.play_from/play_to` and `golf_rounds.date` are
// DATEs, so a "week" is a pair of YYYY-MM-DD strings and the arithmetic
// never touches a timezone. "Today" is the UTC date slice, the same
// convention the daily cron uses (golf-league-server.ts), so the page and
// the sync agree on which window is open.
//
// The shapes below ride the public standings payload (viewer-independent
// by contract — nothing here may depend on a session). Names arrive
// already masked; supervised athletes are OMITTED from `results` and only
// counted in `posted` (a count reveals nothing).

import { awardRoundPoints, type PointsPreset } from './golf-points';

export type GolfWeekState = 'open' | 'upcoming' | 'closed';

export interface PublicGolfWeekResult {
  entrant_name: string;
  gross: number | null;
  net: number | null;
  holes: number | null;
  tee: string | null;
  /** 'posted' = self-reported from the member's round, awaiting the
   *  organizer; 'final' = confirmed (or entered by the organizer). */
  status: 'posted' | 'final';
  disputed: boolean;
  /** C6: season points awarded for this round (points leagues only). */
  points?: number;
}

export interface PublicGolfWeek {
  id: string;
  round: string | null;
  holes: number;
  playFrom: string;
  playTo: string;
  courseName: string | null;
  status: string;
  state: GolfWeekState;
  /** Entrants in the round (every approved entry at creation time). */
  participants: number;
  /** Results on file, INCLUDING omitted (supervised) athletes. */
  posted: number;
  results: PublicGolfWeekResult[];
}

export interface PublicGolfBlock {
  pick: 'first' | 'best';
  today: string;
  currentWeekId: string | null;
  weeks: PublicGolfWeek[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string): { y: number; m: number; d: number } | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date-only day arithmetic: 'YYYY-MM-DD' ± days, DST-free (UTC math on
 *  a calendar date, formatted back from the UTC fields). An unparseable
 *  input is returned unchanged rather than thrown — the callers are
 *  never-throw readers. */
export function addDaysIso(iso: string, days: number): string {
  const p = parts(iso);
  if (!p) return iso;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** The cron's "today": the UTC date slice. A window ending Sunday reads
 *  closed from Sunday evening in the Americas — consistent with the sync,
 *  which is what matters (the page never says "open" for a round the sync
 *  would no longer fill). */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO date strings compare lexically, so the window test is two string
 *  comparisons — both ends inclusive, like the sync's gte/lte. */
export function weekState(week: { playFrom: string; playTo: string }, today: string): GolfWeekState {
  if (today < week.playFrom) return 'upcoming';
  if (today > week.playTo) return 'closed';
  return 'open';
}

/** The round the page leads with: the one whose window contains today;
 *  else the next to open; else the most recently closed; else none. */
export function selectCurrentWeek<T extends { id: string; playFrom: string; playTo: string }>(
  weeks: T[],
  today: string
): string | null {
  const open = weeks.find(w => weekState(w, today) === 'open');
  if (open) return open.id;
  const upcoming = weeks
    .filter(w => weekState(w, today) === 'upcoming')
    .sort((a, b) => (a.playFrom < b.playFrom ? -1 : a.playFrom > b.playFrom ? 1 : 0));
  if (upcoming.length > 0) return upcoming[0].id;
  const closed = weeks
    .filter(w => weekState(w, today) === 'closed')
    .sort((a, b) => (a.playTo > b.playTo ? -1 : a.playTo < b.playTo ? 1 : 0));
  return closed.length > 0 ? closed[0].id : null;
}

/** Chronological: play_from, then label, then id (stable). */
export function sortWeeks<T extends { id: string; playFrom: string; round: string | null }>(weeks: T[]): T[] {
  return [...weeks].sort((a, b) => {
    if (a.playFrom !== b.playFrom) return a.playFrom < b.playFrom ? -1 : 1;
    const ar = a.round ?? '';
    const br = b.round ?? '';
    if (ar !== br) return ar < br ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** "Sep 7" — string-parsed, no Intl (the (public) segment renders this
 *  at build/ISR time and must not depend on the server locale). */
export function formatIsoDate(iso: string, withYear = false): string {
  const p = parts(iso);
  if (!p) return iso;
  const base = `${MONTHS[p.m - 1] ?? '?'} ${p.d}`;
  return withYear ? `${base}, ${p.y}` : base;
}

/** "Sep 1 – 7" · "Sep 28 – Oct 4" · "Dec 29, 2026 – Jan 4, 2027" · "Sep 1". */
export function formatDateRange(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from} – ${to}`;
  if (from === to) return formatIsoDate(from);
  if (a.y !== b.y) return `${formatIsoDate(from, true)} – ${formatIsoDate(to, true)}`;
  if (a.m !== b.m) return `${formatIsoDate(from)} – ${formatIsoDate(to)}`;
  return `${MONTHS[a.m - 1]} ${a.d} – ${b.d}`;
}

// ── Assembling the block from raw rows (pure; the reader does the I/O) ──

export interface GolfContestRaw {
  id: string;
  round: string | null;
  status: string;
  venue_id: string | null;
  holes: number;
  play_from: string;
  play_to: string;
}

export interface GolfParticipantRaw {
  id: string;
  contest_id: string;
  entry_id: string;
}

export interface GolfResultRaw {
  contest_id: string;
  participant_id: string;
  score: number | null;
  payload: Record<string, unknown> | null;
  provenance: string;
  dispute_status: string | null;
}

export interface BuildGolfBlockInput {
  contests: GolfContestRaw[];
  participants: GolfParticipantRaw[];
  results: GolfResultRaw[];
  /** Masked display name per entry id (missing ⇒ 'Athlete'). */
  entryName: Map<string, string>;
  /** Entries whose rows are omitted from public surfaces (supervised). */
  omittedEntries: Set<string>;
  /** Course (or venue) name per venue id. */
  courseNameByVenue: Map<string, string>;
  pick: 'first' | 'best';
  /** The ROUND rule (golf_net / golf_gross / stroke_total — never
   *  golf_points; the caller resolves it with roundRuleFor). */
  scoringRule: string | null;
  /** C6: set on a points league — each week's results carry `points`. */
  pointsPreset?: PointsPreset | null;
  today: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One result row for the public table. A synced result carries the
 *  full golf payload; an organizer-typed score carries `{}` and only
 *  `score`, which is the rule's key (net on a net league, gross
 *  otherwise) — shown in that column, never invented for the other. */
export function publicResultFromRow(
  row: GolfResultRaw,
  entrantName: string,
  scoringRule: string | null
): PublicGolfWeekResult {
  const payload = row.payload ?? {};
  const gross = num(payload.gross);
  const net = num(payload.net);
  const isNetRule = scoringRule === 'golf_net';
  return {
    entrant_name: entrantName,
    gross: gross ?? (isNetRule ? null : num(row.score)),
    net: net ?? (isNetRule ? num(row.score) : null),
    holes: num(payload.holes),
    tee: typeof payload.tee === 'string' ? payload.tee : null,
    status: row.provenance === 'self_reported' ? 'posted' : 'final',
    disputed: row.dispute_status === 'disputed',
  };
}

export function buildGolfBlock(input: BuildGolfBlockInput): PublicGolfBlock | null {
  const windowed = input.contests.filter(
    c => typeof c.holes === 'number' && !!c.play_from && !!c.play_to && c.status !== 'canceled'
  );
  if (windowed.length === 0) return null;

  const participantEntry = new Map(input.participants.map(p => [p.id, p.entry_id]));
  const participantsByContest = new Map<string, number>();
  for (const p of input.participants) {
    participantsByContest.set(p.contest_id, (participantsByContest.get(p.contest_id) ?? 0) + 1);
  }
  const resultsByContest = new Map<string, GolfResultRaw[]>();
  for (const r of input.results) {
    if (!resultsByContest.has(r.contest_id)) resultsByContest.set(r.contest_id, []);
    resultsByContest.get(r.contest_id)!.push(r);
  }

  const weeks: PublicGolfWeek[] = windowed.map(c => {
    const rows = resultsByContest.get(c.id) ?? [];
    // Every row of the field first (supervised rows included) — points are
    // awarded over the FULL field, exactly as the standings recompute, and
    // only THEN are supervised rows omitted (P1: the race and the table
    // must never disagree on a point total).
    const field: { entryId: string; result: PublicGolfWeekResult }[] = [];
    for (const r of rows) {
      const entryId = participantEntry.get(r.participant_id);
      if (!entryId) continue;
      field.push({ entryId, result: publicResultFromRow(r, input.entryName.get(entryId) ?? 'Athlete', input.scoringRule) });
    }
    // Fewer strokes first (both golf rules ascend); a null key sorts last;
    // ties by name so the order is stable across renders.
    const key = (r: PublicGolfWeekResult) => (input.scoringRule === 'golf_net' ? r.net : r.gross);
    field.sort((a, b) => {
      const ka = key(a.result);
      const kb = key(b.result);
      if (ka === null && kb === null) return a.result.entrant_name.localeCompare(b.result.entrant_name);
      if (ka === null) return 1;
      if (kb === null) return -1;
      if (ka !== kb) return ka - kb;
      return a.result.entrant_name.localeCompare(b.result.entrant_name);
    });
    if (input.pointsPreset) {
      // C6: the week's points by finishing position (ties share).
      const awards = new Map(
        awardRoundPoints(
          field.map((f, i) => ({ entry_id: String(i), score: key(f.result) })),
          input.pointsPreset
        ).map(a => [a.entry_id, a.points])
      );
      field.forEach((f, i) => {
        const pts = awards.get(String(i));
        if (pts !== undefined) f.result.points = pts;
      });
    }
    const results = field.filter(f => !input.omittedEntries.has(f.entryId)).map(f => f.result);
    return {
      id: c.id,
      round: c.round,
      holes: c.holes,
      playFrom: c.play_from,
      playTo: c.play_to,
      courseName: (c.venue_id && input.courseNameByVenue.get(c.venue_id)) || null,
      status: c.status,
      state: weekState({ playFrom: c.play_from, playTo: c.play_to }, input.today),
      participants: participantsByContest.get(c.id) ?? 0,
      posted: rows.length,
      results,
    };
  });

  const sorted = sortWeeks(weeks);
  return {
    pick: input.pick,
    today: input.today,
    currentWeekId: selectCurrentWeek(sorted, input.today),
    weeks: sorted,
  };
}
