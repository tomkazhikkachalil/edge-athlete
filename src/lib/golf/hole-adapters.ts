/**
 * Pure HoleData ↔ player-hole-score adapters — the UI boundary between the
 * solo scorecard form's `HoleData` shape (`hole`/`par`/`score`/`fairway`
 * enum/`gir`) and the shared grid + quick-entry stepper's DB-ish shape
 * (`hole_number`/`strokes`/`fairway_hit` boolean/`green_in_regulation`).
 *
 * Extracted from GolfScorecardForm's inline mappings (scorecard convergence)
 * so the solo form can mount MultiPlayerScorecardGrid. The /api/posts request
 * body keeps the `HoleData` shape untouched — these convert at the UI
 * boundary ONLY.
 *
 * Fairway semantics (the one lossy edge, unchanged from the old inline maps):
 * the enum ('hit'/'left'/'right'/'na') maps forward to a boolean
 * ('hit' → true, miss directions → false, 'na'/unset → undefined), and a
 * boolean miss coming back keeps an existing direction, else defaults to
 * 'left'. Direction was never persisted (golf_holes.fairway_hit is a
 * boolean), so nothing stored is lost.
 */

import type { HoleData } from '@/types/golf';

/** Structural match for MultiPlayerScorecardGrid's PlayerHoleScore (kept
 *  local so this lib module doesn't import from a component). */
export interface AdaptedHoleScore {
  hole_number: number;
  strokes?: number;
  putts?: number;
  fairway_hit?: boolean;
  green_in_regulation?: boolean;
  penalties?: string[] | null;
}

/** A per-hole change coming back from the grid (checkbox/input edits) or the
 *  quick-entry stepper (one patch per saved hole). A KEY PRESENT with an
 *  undefined value means "cleared" for strokes/putts, and "not entered —
 *  keep what the form has" for fairway_hit/green_in_regulation (matching the
 *  old quick-entry write-back). */
export interface HoleScorePatch {
  strokes?: number;
  putts?: number;
  fairway_hit?: boolean;
  green_in_regulation?: boolean;
  penalties?: string[] | null;
}

/**
 * Forward map: the form's `holesData` → one player's grid rows.
 * Every hole with a number is emitted (unscored holes too — the grid renders
 * putts/F/G cells per hole regardless of strokes).
 */
export function holeDataToPlayerScores(
  holesData: HoleData[],
  participantId: string
): { participant_id: string; hole_scores: AdaptedHoleScore[] } {
  return {
    participant_id: participantId,
    hole_scores: holesData
      .filter(h => typeof h.hole === 'number')
      .map(h => ({
        hole_number: h.hole as number,
        strokes: h.score,
        putts: h.putts ?? undefined,
        fairway_hit:
          h.fairway === 'hit'
            ? true
            : h.fairway === 'left' || h.fairway === 'right'
              ? false
              : undefined, // 'na' (par 3) and unset both mean "no fairway stat"
        green_in_regulation: h.gir ?? undefined,
        penalties: h.penalties ?? null,
      })),
  };
}

/**
 * Backward map: apply one hole's patch to the form's `holesData`, returning a
 * NEW array (untouched holes keep their identity). Unknown hole numbers are a
 * no-op.
 *
 * Auto-GIR parity with the old solo table: a strokes/putts change (with both
 * present afterwards) recomputes GIR — reaching the green in par minus two —
 * unless the patch mentions green_in_regulation (see inline note).
 */
export function applyPlayerScoreChange(
  holesData: HoleData[],
  holeNumber: number,
  patch: HoleScorePatch
): HoleData[] {
  const index = holesData.findIndex(h => h.hole === holeNumber);
  if (index === -1) return holesData;

  const prev = holesData[index];
  const next: HoleData = { ...prev };

  if ('strokes' in patch) next.score = patch.strokes;
  if ('putts' in patch) next.putts = patch.putts;

  if ('fairway_hit' in patch && patch.fairway_hit !== undefined) {
    next.fairway =
      prev.par === 3
        ? 'na'
        : patch.fairway_hit
          ? 'hit'
          // A boolean miss loses direction — keep an existing left/right,
          // else default to 'left' (same rule the old inline map used).
          : prev.fairway === 'left' || prev.fairway === 'right'
            ? prev.fairway
            : 'left';
  }

  if ('green_in_regulation' in patch && patch.green_in_regulation !== undefined) {
    next.gir = patch.green_in_regulation;
  }

  if ('penalties' in patch) next.penalties = patch.penalties ?? null;

  // Auto-GIR runs only when the patch doesn't mention GIR at all (a direct
  // strokes/putts edit in the grid). Quick-entry batch patches always carry
  // the key — possibly undefined — and must keep the form's value untouched,
  // exactly like the old inline write-back did.
  if (
    !('green_in_regulation' in patch) &&
    ('strokes' in patch || 'putts' in patch) &&
    next.score &&
    next.putts
  ) {
    next.gir = next.score - next.putts <= next.par - 2;
  }

  const out = [...holesData];
  out[index] = next;
  return out;
}
