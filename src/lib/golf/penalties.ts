/**
 * Golf penalty vocabulary — the single source of truth (migration 078).
 *
 * Storage model: a hole's penalties are a TEXT[] with ONE element per
 * occurrence — ['out_of_bounds', 'drop', 'drop'] is OB ×1 + Drop ×2. Total
 * = array length; per-type breakdown = aggregatePenalties(). The DB column
 * carries no CHECK (078 header); this module is the vocabulary.
 */

export const PENALTY_TYPES = [
  'out_of_bounds',
  'water',
  'drop',
  'lost_ball',
  'unplayable',
  're_tee',
] as const;

export type PenaltyType = (typeof PENALTY_TYPES)[number];

export const PENALTY_LABELS: Record<PenaltyType, string> = {
  out_of_bounds: 'Out of bounds',
  water: 'Water',
  drop: 'Drop',
  lost_ball: 'Lost ball',
  unplayable: 'Unplayable',
  re_tee: 'Re-tee',
};

/** Short forms for tight display (scorecard badges, legends). */
export const PENALTY_SHORT_LABELS: Record<PenaltyType, string> = {
  out_of_bounds: 'OB',
  water: 'Water',
  drop: 'Drop',
  lost_ball: 'Lost',
  unplayable: 'Unpl.',
  re_tee: 'Re-tee',
};

export function isPenaltyType(value: unknown): value is PenaltyType {
  return typeof value === 'string' && (PENALTY_TYPES as readonly string[]).includes(value);
}

/**
 * STRICT: null/undefined → null (no penalties); an array of known types →
 * a cleaned copy; anything else (non-array, unknown type, absurd length)
 * → an error string. For the scores API's 400 path.
 */
export function validatePenalties(value: unknown): string[] | null | { error: string } {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return { error: 'penalties must be an array' };
  if (value.length === 0) return null;
  if (value.length > 20) return { error: 'Too many penalties for one hole' };
  for (const entry of value) {
    if (!isPenaltyType(entry)) return { error: `Unknown penalty type: ${String(entry)}` };
  }
  return [...value];
}

/** LENIENT: keep only known types; empty/absent → null. For bulk paths
 *  and builders where a bad entry should be dropped, not fatal. */
export function sanitizePenalties(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value.filter(isPenaltyType);
  return cleaned.length > 0 ? cleaned : null;
}

/** ['out_of_bounds','drop','drop'] → [{type:'out_of_bounds',count:1},{type:'drop',count:2}]
 *  (order of first occurrence). */
export function aggregatePenalties(
  penalties: string[] | null | undefined
): Array<{ type: PenaltyType; count: number }> {
  if (!penalties || penalties.length === 0) return [];
  const counts = new Map<PenaltyType, number>();
  for (const entry of penalties) {
    if (isPenaltyType(entry)) {
      counts.set(entry, (counts.get(entry) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

export function totalPenalties(penalties: string[] | null | undefined): number {
  return penalties?.filter(isPenaltyType).length ?? 0;
}

/** "OB ×1 · Drop ×2" — the compact human summary for legends/tooltips. */
export function formatPenaltySummary(penalties: string[] | null | undefined): string {
  return aggregatePenalties(penalties)
    .map(({ type, count }) => (count > 1 ? `${PENALTY_SHORT_LABELS[type]} ×${count}` : PENALTY_SHORT_LABELS[type]))
    .join(' · ');
}

// ── Stroke values (migration 320, Nov 25 2026) ───────────────────────────────
// Each penalty keeps its own stroke value in a second array aligned by index
// with the types: penalty_strokes[i] belongs to penalties[i]. NULL / absent =
// one stroke each (every row written before 320, every writer that names only
// the types). DESCRIPTIVE, like the types: the golfer enters TOTAL strokes,
// so a penalty's strokes are never added to the score.

export const PENALTY_STROKES_MIN = 1;
export const PENALTY_STROKES_MAX = 9;
export const PENALTY_STROKES_DEFAULT = 1;

/**
 * STRICT, for the scores API: the stroke values that go with `count`
 * penalties. null / undefined → null (one stroke each). An array must hold
 * exactly `count` whole numbers 1..9; anything else is an error string.
 */
export function validatePenaltyStrokes(value: unknown, count: number): number[] | null | { error: string } {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return { error: 'penalty_strokes must be an array' };
  if (count === 0) return value.length === 0 ? null : { error: 'penalty_strokes without penalties' };
  if (value.length !== count) return { error: `penalty_strokes must name ${count} value${count === 1 ? '' : 's'}, one per penalty` };
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < PENALTY_STROKES_MIN || entry > PENALTY_STROKES_MAX) {
      return { error: `Invalid penalty strokes: ${String(entry)}. Must be between ${PENALTY_STROKES_MIN} and ${PENALTY_STROKES_MAX}.` };
    }
  }
  return value.every(v => v === PENALTY_STROKES_DEFAULT) ? null : [...value];
}

export interface PenaltyEntry {
  type: PenaltyType;
  strokes: number;
}

/** The hole's penalties as rows, in the order they were added. A stroke
 *  array that is absent, shorter, or holds a bad value reads as one stroke
 *  for that penalty — a mismatch never hides a penalty. Unknown types drop
 *  (and keep the pairing of the ones that stay). */
export function penaltyEntries(penalties: readonly string[] | null | undefined, strokes: readonly number[] | null | undefined): PenaltyEntry[] {
  if (!penalties) return [];
  const aligned = Array.isArray(strokes) && strokes.length === penalties.length ? strokes : null;
  const out: PenaltyEntry[] = [];
  penalties.forEach((type, i) => {
    if (!isPenaltyType(type)) return;
    const s = aligned?.[i];
    out.push({ type, strokes: typeof s === 'number' && Number.isInteger(s) && s >= PENALTY_STROKES_MIN && s <= PENALTY_STROKES_MAX ? s : PENALTY_STROKES_DEFAULT });
  });
  return out;
}

/** The two stored arrays for a list of rows: types, and strokes (null when
 *  every penalty is one stroke — the column's "one each" spelling). */
export function penaltyColumns(entries: readonly PenaltyEntry[]): { penalties: string[]; penalty_strokes: number[] | null } {
  const strokes = entries.map(e => e.strokes);
  return {
    penalties: entries.map(e => e.type),
    penalty_strokes: strokes.every(s => s === PENALTY_STROKES_DEFAULT) ? null : strokes,
  };
}

/** The hole's penalty strokes, summed — the Penalty button's badge. */
export function totalPenaltyStrokes(penalties: readonly string[] | null | undefined, strokes: readonly number[] | null | undefined): number {
  return penaltyEntries(penalties, strokes).reduce((sum, e) => sum + e.strokes, 0);
}
