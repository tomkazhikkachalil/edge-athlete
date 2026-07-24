// ── Game-format scoring strategies ────────────────────────────────────────────
// Formats layer on the scoring primitives (scoring.ts): the same stored hole
// scores, interpreted differently. Nothing here touches storage — a round's
// game_format (golf_scorecard_data, migration 032) only changes how the
// leaderboard is computed and displayed.
//
//   stroke      — lowest total strokes (the default everywhere pre-formats)
//   stableford  — points per hole, highest total wins
//   match       — head-to-head holes won, for 2-player rounds
//
// All functions are pure and null-tolerant: partial rounds, missing holes, and
// mismatched entry states must degrade to sensible output, never throw.

import { holePar, type HoleParSource, type HoleScoreLike } from './scoring';

export type GameFormat = 'stroke' | 'stableford' | 'match';

export const GAME_FORMAT_LABELS: Record<GameFormat, string> = {
  stroke: 'Stroke Play',
  stableford: 'Stableford',
  match: 'Match Play',
};

/** Safe parse for a value that should be a game format (e.g. from the API). */
export function asGameFormat(value: unknown): GameFormat {
  return value === 'stableford' || value === 'match' ? value : 'stroke';
}

// ── Stableford ────────────────────────────────────────────────────────────────

/**
 * Standard (gross) Stableford allocation:
 * albatross+ 5, eagle 4, birdie 3, par 2, bogey 1, double bogey or worse 0.
 */
export function stablefordPoints(strokes: number | null | undefined, par: number): number {
  if (!strokes || strokes <= 0) return 0;
  const diff = strokes - par;
  if (diff >= 2) return 0;
  if (diff === 1) return 1;
  if (diff === 0) return 2;
  if (diff === -1) return 3;
  if (diff === -2) return 4;
  return 5;
}

export interface StablefordTotal {
  points: number;
  holesScored: number;
}

/** Total Stableford points over a player's scored holes. */
export function calcStablefordTotal(
  holeScores: HoleScoreLike[],
  holeData?: HoleParSource[] | null,
  fallbackPar = 4
): StablefordTotal {
  let points = 0;
  let holesScored = 0;
  for (const hole of holeScores) {
    if (!hole.strokes || hole.strokes <= 0) continue;
    holesScored++;
    points += stablefordPoints(hole.strokes, holePar(hole.hole_number, holeData, fallbackPar));
  }
  return { points, holesScored };
}

// ── Match play ────────────────────────────────────────────────────────────────

export interface MatchStatus {
  /** Holes player A is up (negative = player B up, 0 = all square). */
  diff: number;
  /** Holes where BOTH players have a score (the holes actually contested). */
  thru: number;
  /** Contestable holes left in the round. */
  remaining: number;
  /** True once the lead exceeds the holes remaining (match is over early). */
  closedOut: boolean;
  /** True when the match has a final result (closed out or all holes played). */
  final: boolean;
  /** 0 = player A leads, 1 = player B leads, null = all square. */
  leaderIndex: 0 | 1 | null;
  /** "3&2", "2 UP", "All Square", "2 UP thru 14" — prepend the leader's name. */
  summary: string;
}

/**
 * Head-to-head match play between two players' hole scores. A hole counts only
 * when both players scored it (lower strokes wins the hole, ties halve it).
 * Standard result forms: "3&2" (closed out with holes to spare), "N UP" (won
 * on the last hole), "All Square", or "N UP thru M" while in progress.
 */
export function calcMatchStatus(
  playerAScores: HoleScoreLike[],
  playerBScores: HoleScoreLike[],
  holesPlayed: number
): MatchStatus {
  const byHole = (scores: HoleScoreLike[]) => {
    const map = new Map<number, number>();
    for (const h of scores) {
      if (h.strokes && h.strokes > 0) map.set(h.hole_number, h.strokes);
    }
    return map;
  };
  const a = byHole(playerAScores);
  const b = byHole(playerBScores);

  let diff = 0;
  let thru = 0;
  for (let hole = 1; hole <= holesPlayed; hole++) {
    const sa = a.get(hole);
    const sb = b.get(hole);
    if (sa === undefined || sb === undefined) continue;
    thru++;
    if (sa < sb) diff++;
    else if (sb < sa) diff--;
  }

  const remaining = Math.max(0, holesPlayed - thru);
  const lead = Math.abs(diff);
  const closedOut = lead > remaining && remaining > 0;
  const final = closedOut || (remaining === 0 && thru > 0);
  const leaderIndex: 0 | 1 | null = diff > 0 ? 0 : diff < 0 ? 1 : null;

  let summary: string;
  if (thru === 0) {
    summary = 'Not started';
  } else if (closedOut) {
    summary = `${lead}&${remaining}`;
  } else if (final) {
    summary = lead === 0 ? 'All Square' : `${lead} UP`;
  } else {
    summary = lead === 0 ? `All Square thru ${thru}` : `${lead} UP thru ${thru}`;
  }

  return { diff, thru, remaining, closedOut, final, leaderIndex, summary };
}
