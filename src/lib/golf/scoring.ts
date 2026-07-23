// ── Golf scoring domain logic ─────────────────────────────────────────────────
// Single source of truth for par resolution, score classification, to-par
// formatting/coloring, and player totals. Before this existed, the same math
// lived (slightly differently) in MultiPlayerScorecardGrid, SharedRoundFullCard,
// ScoreEntryModal, and CreatePostModal's preview — each hardcoding par 4.
//
// This is also the foundation for future game formats (match play,
// stableford): formats become scoring strategies layered on these primitives.

export type ScoreClass = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | null;

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
  if (toPar === null || toPar === undefined) return 'text-gray-400';
  if (toPar < 0) return 'text-green-600';
  if (toPar > 0) return 'text-red-600';
  return 'text-gray-600';
}

/** Filled-chip cell styling (used by editable grids). */
export const SCORE_CELL_FILL: Record<Exclude<ScoreClass, null>, string> = {
  eagle: 'bg-blue-100 text-blue-800 font-bold border-2 border-blue-400 rounded-full',
  birdie: 'bg-blue-50 text-blue-700 font-semibold border-2 border-blue-300 rounded-full',
  par: 'text-gray-900',
  bogey: 'bg-red-50 text-red-700 font-semibold border-2 border-red-300',
  double: 'bg-red-100 text-red-800 font-bold border-2 border-red-400',
};

/** Ring-style cell styling (used by read-only scorecard tables). */
export const SCORE_CELL_RING: Record<Exclude<ScoreClass, null>, { ring: string; text: string }> = {
  eagle: { ring: 'ring-2 ring-blue-500 ring-inset', text: 'text-blue-600 font-black' },
  birdie: { ring: 'ring-1 ring-blue-400 ring-inset', text: 'text-blue-600 font-bold' },
  par: { ring: '', text: 'text-gray-900 font-semibold' },
  bogey: { ring: 'border border-red-400', text: 'text-red-600 font-semibold' },
  double: { ring: 'ring-2 ring-red-500 ring-inset', text: 'text-red-600 font-bold' },
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
