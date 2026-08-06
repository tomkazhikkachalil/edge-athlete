// ── Golf scoring domain logic ─────────────────────────────────────────────────
// Single source of truth for par resolution, score classification, to-par
// formatting/coloring, and player totals. Before this existed, the same math
// lived (slightly differently) in MultiPlayerScorecardGrid, SharedRoundFullCard,
// ScoreEntryModal, and CreatePostModal's preview — each hardcoding par 4.
//
// This is also the foundation for future game formats (match play,
// stableford): formats become scoring strategies layered on these primitives.

import type { HoleData } from '@/types/golf';

export type ScoreClass = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | null;

/** Standard par distribution for a default 18-hole layout (sums to 72). */
export const STANDARD_PARS_18 = [4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5];

/**
 * Build the default editable hole grid for the scorecard form (the
 * `@/types/golf` `hole`/`par`/`score` shape — NOT the DB `hole_number`/
 * `strokes` shape ScoreEntryModal reads).
 *
 * Extracted from GolfScorecardForm so it can seed `useState` lazily on mount:
 * the form previously built the grid only when the hole COUNT changed, so a
 * manually-typed course at the default 18 holes rendered zero score cells and
 * quick-entry silently discarded every score (its merge mapped over an empty
 * array). Yardages are deliberately deterministic (150/380/520 by par) — the
 * old Math.random() jitter was removed on purpose; tests pin exact values.
 */
export function buildDefaultHoles(
  holeCount: number,
  startingHole: 'front' | 'back'
): HoleData[] {
  const startHole = holeCount === 9 && startingHole === 'back' ? 10 : 1;
  const holes: HoleData[] = [];
  for (let i = 0; i < holeCount; i++) {
    const holeNumber = startHole + i;
    const par =
      holeNumber <= 18
        ? STANDARD_PARS_18[holeNumber - 1] || 4
        : STANDARD_PARS_18[i % 18] || 4;
    const baseYardage = par === 3 ? 150 : par === 4 ? 380 : 520;
    holes.push({
      hole: holeNumber,
      par,
      yardage: baseYardage,
      fairway: par === 3 ? 'na' : undefined,
    });
  }
  return holes;
}

export interface HoleParSource {
  hole: number;
  par: number;
}

export interface HoleScoreLike {
  hole_number: number;
  strokes?: number | null;
  putts?: number | null;
}

/** Par for a hole: from course hole data when available, else the fallback. */
export function holePar(
  holeNumber: number,
  holeData?: HoleParSource[] | null,
  fallback = 4
): number {
  if (holeData && holeData.length > 0) {
    const hole = holeData.find(h => h.hole === holeNumber);
    if (hole?.par) return hole.par;
  }
  return fallback;
}

/** Classify a hole score relative to par. Null when no score. */
export function classifyScore(
  strokes: number | null | undefined,
  par: number
): ScoreClass {
  if (!strokes || strokes <= 0) return null;
  const diff = strokes - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  return 'double';
}

/** "E", "+3", "-2" */
export function toParLabel(toPar: number | null | undefined): string {
  if (toPar === null || toPar === undefined) return '—';
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

/** App-wide convention: under par = green, over = red, even = gray. */
export function toParColorClass(toPar: number | null | undefined): string {
  if (toPar === null || toPar === undefined) return 'text-faint';
  if (toPar < 0) return 'text-green-600 dark:text-green-400';
  if (toPar > 0) return 'text-red-600 dark:text-red-400';
  return 'text-tertiary';
}

/** Filled-chip cell styling (used by editable grids). */
export const SCORE_CELL_FILL: Record<Exclude<ScoreClass, null>, string> = {
  eagle: 'bg-blue-100 text-blue-800 font-bold border-2 border-blue-400 rounded-full dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-600',
  birdie: 'bg-blue-50 text-blue-700 font-semibold border-2 border-blue-300 rounded-full dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800',
  par: 'text-primary',
  bogey: 'bg-red-50 text-red-700 font-semibold border-2 border-red-300 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800',
  double: 'bg-red-100 text-red-800 font-bold border-2 border-red-400 dark:bg-red-950/50 dark:text-red-300 dark:border-red-600',
};

/** Ring-style cell styling (used by read-only scorecard tables). */
export const SCORE_CELL_RING: Record<Exclude<ScoreClass, null>, { ring: string; text: string }> = {
  eagle: { ring: 'ring-2 ring-blue-500 ring-inset dark:ring-blue-400', text: 'text-blue-600 font-black dark:text-blue-400' },
  birdie: { ring: 'ring-1 ring-blue-400 ring-inset dark:ring-blue-400', text: 'text-blue-600 font-bold dark:text-blue-400' },
  par: { ring: '', text: 'text-primary font-semibold' },
  bogey: { ring: 'border border-red-400 dark:border-red-500', text: 'text-red-600 font-semibold dark:text-red-400' },
  double: { ring: 'ring-2 ring-red-500 ring-inset dark:ring-red-400', text: 'text-red-600 font-bold dark:text-red-400' },
};

export interface PlayerTotals {
  front9: number;
  back9: number;
  total: number;
  played: number;      // holes with a score
  actualPar: number;   // sum of par over PLAYED holes only
  toPar: number;
  eagles: number;
  birdies: number;
  pars: number;
  bogeys: number;
  doublePlus: number;
}

const EMPTY_TOTALS: PlayerTotals = {
  front9: 0, back9: 0, total: 0, played: 0, actualPar: 0, toPar: 0,
  eagles: 0, birdies: 0, pars: 0, bogeys: 0, doublePlus: 0,
};

/**
 * Totals for one player's hole scores. to-par is computed against the par of
 * PLAYED holes only (partial rounds stay meaningful).
 */
export function calcPlayerTotals(
  holeScores: HoleScoreLike[],
  holeData?: HoleParSource[] | null,
  fallbackPar = 4
): PlayerTotals {
  const scored = holeScores.filter(h => h.strokes !== undefined && h.strokes !== null && h.strokes > 0);
  if (scored.length === 0) return { ...EMPTY_TOTALS };

  let front9 = 0, back9 = 0, actualPar = 0;
  let eagles = 0, birdies = 0, pars = 0, bogeys = 0, doublePlus = 0;

  for (const hole of scored) {
    const strokes = hole.strokes as number;
    if (hole.hole_number <= 9) front9 += strokes;
    else back9 += strokes;

    const par = holePar(hole.hole_number, holeData, fallbackPar);
    actualPar += par;

    switch (classifyScore(strokes, par)) {
      case 'eagle': eagles++; break;
      case 'birdie': birdies++; break;
      case 'par': pars++; break;
      case 'bogey': bogeys++; break;
      case 'double': doublePlus++; break;
    }
  }

  const total = front9 + back9;
  return {
    front9, back9, total,
    played: scored.length,
    actualPar,
    toPar: total - actualPar,
    eagles, birdies, pars, bogeys, doublePlus,
  };
}

/**
 * The hole worth leading with: the best score relative to par. Golf-specific
 * by nature, which is exactly why it lives here rather than in the hero picker
 * — that picker takes a plain segment NUMBER, so it stays sport-agnostic and a
 * baseball equivalent can feed it the same way.
 *
 * Returns null when nothing was scored, or when nothing beat par: an ordinary
 * round has no standout hole, and picking the "least bad" one would dress up a
 * bogey as a highlight.
 */
export function bestHoleFor(
  holeScores: Array<{ hole_number: number; strokes?: number | null }> | null | undefined,
  holeData: Parameters<typeof holePar>[1]
): number | null {
  if (!holeScores?.length) return null;

  let best: { hole: number; diff: number } | null = null;
  for (const h of holeScores) {
    if (typeof h.strokes !== 'number' || h.strokes <= 0) continue;
    const diff = h.strokes - holePar(h.hole_number, holeData);
    // Strictly better, so ties keep the EARLIER hole and the answer is stable.
    if (best === null || diff < best.diff) best = { hole: h.hole_number, diff };
  }

  return best && best.diff < 0 ? best.hole : null;
}
