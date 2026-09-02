// ── FedEx-style season points (phase 7 C6) — the PURE engine ────────────────
// Tom's brief: the golf club and league pages should read like the PGA
// Tour site — FedEx Cup points. A `golf_points` league scores each round
// in STROKES (gross or net, per config) and awards points by finishing
// position; the season table sums the points (highest wins).
//
// Points are DERIVED at recompute, never stored: one late round re-ranks
// the whole week, and a stored `payload.points` would be auto-summed into
// stats by the recompute's numericKeys. The base score stays the round's
// strokes on contest_results.score, exactly as golf_gross/golf_net write
// it; this module turns a week's scores into points at standings time.
//
// Ties SHARE the mean of the tied positions (a two-way tie for 1st gets
// (100 + 75) / 2 = 87.5 each — competition_standings.points is numeric,
// mig 153). Unscored entrants get nothing. Node-tested.

export type PointsPreset = 'pga' | 'linear';
export type PointsScore = 'gross' | 'net';

/** The PGA Tour regular-event table (1st → 30th); every place after 30th
 *  scores 1 so finishing counts for something. */
export const PGA_POINTS = [
  100, 75, 60, 50, 45, 40, 36, 33, 30, 28, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5,
  4, 3, 2,
] as const;

export interface GolfPointsConfig {
  preset: PointsPreset;
  /** The strokes the round is ranked on (net = handicap-adjusted). */
  score: PointsScore;
}

/** competitions.config → the points setup; defaults = PGA table on net. */
export function parseGolfPointsConfig(config: unknown): GolfPointsConfig {
  const golf = (config as { golf?: Record<string, unknown> } | null | undefined)?.golf;
  const preset = golf?.points === 'linear' ? 'linear' : 'pga';
  const score = golf?.score === 'gross' ? 'gross' : 'net';
  return { preset, score };
}

/** Points for a 1-based finishing position among `finishers` scored entrants. */
export function pointsForPosition(preset: PointsPreset, position: number, finishers: number): number {
  if (position < 1) return 0;
  if (preset === 'linear') return Math.max(1, finishers - position + 1);
  return PGA_POINTS[position - 1] ?? 1;
}

export interface RoundScore {
  entry_id: string;
  /** The round's strokes (gross or net per config); null = not scored. */
  score: number | null;
}

export interface RoundAward {
  entry_id: string;
  position: number;
  points: number;
}

/** One round's points: rank ascending by strokes; ties share the mean of
 *  the positions they occupy; unscored entrants are absent. */
export function awardRoundPoints(scores: RoundScore[], preset: PointsPreset): RoundAward[] {
  const scored = scores
    .filter((s): s is { entry_id: string; score: number } => typeof s.score === 'number' && Number.isFinite(s.score))
    .sort((a, b) => a.score - b.score || (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0));
  const finishers = scored.length;
  const out: RoundAward[] = [];
  let i = 0;
  while (i < scored.length) {
    let j = i;
    while (j + 1 < scored.length && scored[j + 1].score === scored[i].score) j++;
    // Positions i+1 … j+1 are tied: share their mean points.
    let sum = 0;
    for (let p = i + 1; p <= j + 1; p++) sum += pointsForPosition(preset, p, finishers);
    const share = Math.round((sum / (j - i + 1)) * 100) / 100;
    for (let k = i; k <= j; k++) out.push({ entry_id: scored[k].entry_id, position: i + 1, points: share });
    i = j + 1;
  }
  return out;
}

/** The first N rows of a preset, for the console's preview. Linear needs
 *  a field size; the preview assumes `finishers`. */
export function previewPoints(preset: PointsPreset, rows = 10, finishers = 20): { position: number; points: number }[] {
  return Array.from({ length: rows }, (_, i) => ({ position: i + 1, points: pointsForPosition(preset, i + 1, finishers) }));
}
