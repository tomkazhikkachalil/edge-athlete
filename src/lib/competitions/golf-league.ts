/**
 * Golf leagues — the PURE engine (phase 6c G2). Zero I/O, node-tested; the
 * server half (golf-league-server.ts) reads golf_rounds/golf_holes/
 * golf_courses/venues and writes contest_results.
 *
 * Tom's principles, in code:
 *   (2) the page fills itself — a member's posted round IS the result;
 *   (3) rating and slope per TEE SET is the dependency — net exists only
 *       when the tee's rating pair exists for the hole count played;
 *   (4) nine holes is normal — holes are COUNTED FROM THE CARD ROWS
 *       (playedHoleCount), never read off the course.
 *
 * The frozen golf write path is never touched: every input here is a row
 * already written by the round mirror.
 */

import { playedHoleCount } from '@/lib/golf/round-display';
import { courseHandicap } from '@/lib/golf/adjusted-gross';
import {
  MAX_PLAUSIBLE_9_HOLE_RATING,
  MIN_PLAUSIBLE_9_HOLE_RATING,
} from '@/lib/golf/handicap';

export type GolfPick = 'first' | 'best';
export type GolfRule = 'golf_gross' | 'golf_net' | 'stroke_total';

/** The ROUND rule behind a competition's scoring_rule — what the sync
 *  writes as `score`. Phase 7 C6: a `golf_points` league ranks rounds on
 *  gross or net strokes per its config (points are derived at standings
 *  time, never written); anything unknown is plain strokes. */
export function roundRuleFor(scoringRule: string | null, config: unknown): GolfRule {
  if (scoringRule === 'golf_net' || scoringRule === 'golf_gross') return scoringRule;
  if (scoringRule === 'golf_points') {
    const score = (config as { golf?: { score?: unknown } } | null | undefined)?.golf?.score;
    return score === 'gross' ? 'golf_gross' : 'golf_net';
  }
  return 'stroke_total';
}

export interface GolfContestSpec {
  holes: 9 | 18;
  /** YYYY-MM-DD, inclusive. */
  playFrom: string;
  playTo: string;
}

export interface RoundRow {
  id: string;
  profile_id: string;
  date: string; // YYYY-MM-DD
  course_id: string | null;
  tee: string | null;
  holes: number | null;
  gross_score: number | null;
  course_rating: number | null;
  slope_rating: number | null;
  par: number | null;
  round_type: string | null;
  is_complete: boolean | null;
  created_at: string;
  group_post_id: string | null;
}

export interface HoleRow {
  hole_number?: number | null;
  strokes?: number | null;
}

export interface CourseRatingRow {
  id: string;
  club_id?: string | null;
  section_kind?: string | null;
  total_par: number | null;
  holes_count: number | null;
  course_rating: Record<string, number> | null;
  slope_rating: Record<string, number> | null;
}

/** The catalog course ids a venue's golf link recognizes: a linked CLUB
 *  contributes every section/nine of the facility; a linked COURSE only
 *  itself (mig 169's pair). */
export function matchCourseIds(
  link: { golfClubId: string | null; golfCourseId: string | null },
  rows: { id: string; club_id?: string | null }[]
): Set<string> {
  const out = new Set<string>();
  if (link.golfClubId) {
    for (const r of rows) if (r.club_id === link.golfClubId) out.add(r.id);
  }
  if (link.golfCourseId) out.add(link.golfCourseId);
  return out;
}

export type Qualification =
  | { ok: true; holes: number; holesSource: 'card' | 'declared' }
  | { ok: false; reason: string };

/** Does a posted round count for this contest? Complete, outdoor, dated
 *  inside the window, played at one of the contest's courses, and the
 *  hole count — from the card rows — equals the declared count. A
 *  quick-entry round with no hole rows falls back to its OWN declared
 *  holes (still never the course's). */
export function qualifyRound(
  round: RoundRow,
  holeRows: ReadonlyArray<HoleRow>,
  spec: GolfContestSpec,
  courseIds: ReadonlySet<string>
): Qualification {
  if (!round.is_complete) return { ok: false, reason: 'round not complete' };
  if (round.round_type === 'indoor') return { ok: false, reason: 'indoor round' };
  if (typeof round.gross_score !== 'number' || round.gross_score <= 0) {
    return { ok: false, reason: 'no gross score' };
  }
  if (round.date < spec.playFrom || round.date > spec.playTo) {
    return { ok: false, reason: 'outside the play window' };
  }
  if (!round.course_id || !courseIds.has(round.course_id)) {
    return { ok: false, reason: 'not at the league course' };
  }
  const fromCard = playedHoleCount(holeRows);
  if (fromCard > 0) {
    if (fromCard !== spec.holes) {
      return { ok: false, reason: `played ${fromCard}, round is ${spec.holes}` };
    }
    return { ok: true, holes: fromCard, holesSource: 'card' };
  }
  if (round.holes !== spec.holes) {
    return { ok: false, reason: `played ${round.holes ?? '?'}, round is ${spec.holes}` };
  }
  return { ok: true, holes: spec.holes, holesSource: 'declared' };
}

/** Which of several qualifying rounds counts: the FIRST posted (Tom's
 *  default — the honest weekly-league rule) or the BEST score. */
export function pickRound<T extends { created_at: string; score: number }>(
  candidates: T[],
  pick: GolfPick
): T | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) =>
    pick === 'best'
      ? a.score - b.score || a.created_at.localeCompare(b.created_at)
      : a.created_at.localeCompare(b.created_at)
  );
  return sorted[0];
}

export interface RatingPair {
  rating: number;
  slope: number;
  source: 'round' | 'course';
}

const slopePlausible = (s: number) => s >= 55 && s <= 155;
const ratingPlausible = (r: number, holes: number) =>
  holes === 9
    ? r >= MIN_PLAUSIBLE_9_HOLE_RATING && r <= MAX_PLAUSIBLE_9_HOLE_RATING
    : r >= 55 && r <= 85;

/** The tee's rating pair for the hole count played: the round's own pair
 *  when it is plausible for that count, else the course row's pair for
 *  the round's tee when that row IS a course of that length (an 18-hole
 *  rating is never halved into a nine — no 9-hole rating means no net).
 *  Null ⇒ net unavailable; the row shows gross with the reason. */
export function ratingForRound(
  round: RoundRow,
  courseRow: CourseRatingRow | null,
  holes: number
): RatingPair | null {
  if (
    typeof round.course_rating === 'number' &&
    typeof round.slope_rating === 'number' &&
    ratingPlausible(round.course_rating, holes) &&
    slopePlausible(round.slope_rating)
  ) {
    return { rating: round.course_rating, slope: round.slope_rating, source: 'round' };
  }
  if (!courseRow || !round.tee) return null;
  const rowHoles =
    courseRow.section_kind === 'nine'
      ? 9
      : courseRow.section_kind === 'course_18'
        ? 18
        : (courseRow.holes_count ?? null);
  if (rowHoles !== holes) return null;
  const tee = round.tee.toLowerCase();
  const rating = courseRow.course_rating?.[tee];
  const slope = courseRow.slope_rating?.[tee];
  if (typeof rating !== 'number' || typeof slope !== 'number') return null;
  if (!ratingPlausible(rating, holes) || !slopePlausible(slope)) return null;
  return { rating, slope, source: 'course' };
}

/** Net strokes (Rule 6.1a): course handicap from the tee's pair and the
 *  member's index — halved for nine holes (WHS 2024 9-hole course
 *  handicap) — subtracted from gross. */
export function netScore(
  gross: number,
  index: number,
  pair: RatingPair,
  par: number,
  holes: number
): { courseHandicap: number; net: number } {
  const ch = courseHandicap(holes === 9 ? index / 2 : index, pair.slope, pair.rating, par);
  return { courseHandicap: ch, net: gross - ch };
}

export interface GolfResultPayload {
  gross: number;
  net?: number;
  holes: number;
  holesSource: 'card' | 'declared';
  tee: string | null;
  courseHandicap?: number;
  index?: number;
  rating?: number;
  slope?: number;
  ratingSource?: 'round' | 'course';
  /** True when net could not be computed because the tee has no rating
   *  pair for the hole count played. The board shows gross with the reason. */
  noRating?: true;
  /** True when the tee is rated but the member has no handicap index yet
   *  (or the round carries no par). Gross-only, with that reason. */
  noIndex?: true;
  roundRef: { roundId: string; groupPostId: string | null };
  [key: string]: unknown;
}

export function buildResultPayload(input: {
  round: RoundRow;
  holes: number;
  holesSource: 'card' | 'declared';
  pair: RatingPair | null;
  index: number | null;
  par: number | null;
}): GolfResultPayload {
  const gross = input.round.gross_score as number;
  const base: GolfResultPayload = {
    gross,
    holes: input.holes,
    holesSource: input.holesSource,
    tee: input.round.tee,
    roundRef: { roundId: input.round.id, groupPostId: input.round.group_post_id },
  };
  if (input.pair && typeof input.index === 'number' && typeof input.par === 'number') {
    const { courseHandicap: ch, net } = netScore(gross, input.index, input.pair, input.par, input.holes);
    return {
      ...base,
      net,
      courseHandicap: ch,
      index: input.index,
      rating: input.pair.rating,
      slope: input.pair.slope,
      ratingSource: input.pair.source,
    };
  }
  if (!input.pair) return { ...base, noRating: true };
  return { ...base, noIndex: true };
}

/** The sort key a rule wants from a payload; a net board without a net
 *  falls back to gross (visibly flagged by `noRating`). */
export function scoreForRule(rule: GolfRule, payload: GolfResultPayload): number {
  if (rule === 'golf_net' && typeof payload.net === 'number') return payload.net;
  return payload.gross;
}
