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
