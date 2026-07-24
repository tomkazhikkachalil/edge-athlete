// ── Golf highlight-tile aggregation ───────────────────────────────────────────
// Pure math behind GET /api/golf/stats, extracted so the rules are
// unit-testable and so SOLO rounds (golf_rounds) and SHARED rounds
// (golf_participant_scores — which never write golf_rounds) can feed the
// same tiles. Only completed 18-hole rounds count, matching the tile
// definitions ("Best 18", "Last 5 Avg" of full rounds).

export interface CompletedRoundLike {
  grossScore: number;
  /** ISO date of the round — ordering input for the Last-5 window. */
  date: string;
  source: 'solo' | 'shared';
  /** Per-round stats; shared rounds don't carry these yet (per-hole
   *  aggregation is a follow-up) — null/undefined simply excludes the round
   *  from that tile's average. */
  fir?: number | null;
  gir?: number | null;
  putts?: number | null;
}

export interface GolfHighlightTile {
  label: string;
  value: string | null;
  trend?: null;
}

const avg = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The six profile highlight tiles. Input order does not matter — rounds are
 * sorted by date (newest first) internally so the Last-5 window is honest
 * when solo and shared rounds interleave.
 */
export function aggregateGolfHighlights(rounds: CompletedRoundLike[]): GolfHighlightTile[] {
  const byDateDesc = [...rounds].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  const scores = byDateDesc.map(r => r.grossScore);
  const last5 = scores.slice(0, 5);
  const last5Avg = last5.length > 0 ? round1(avg(last5)!) : null;
  const best18 = scores.length > 0 ? Math.min(...scores) : null;

  // Averages over the rounds that actually track the stat
  const firAvg = avg(byDateDesc.map(r => r.fir).filter((v): v is number => v !== null && v !== undefined));
  const girAvg = avg(byDateDesc.map(r => r.gir).filter((v): v is number => v !== null && v !== undefined));
  const puttsAvg = avg(byDateDesc.map(r => r.putts).filter((v): v is number => v !== null && v !== undefined));

  return [
    { label: 'Last 5 Avg', value: last5Avg !== null ? last5Avg.toString() : null, trend: null },
    { label: 'Best 18', value: best18 !== null ? best18.toString() : null },
    { label: 'FIR%', value: firAvg !== null ? `${Math.round(firAvg)}%` : null },
    { label: 'GIR%', value: girAvg !== null ? `${Math.round(girAvg)}%` : null },
    { label: 'Putts/Round', value: puttsAvg !== null ? round1(puttsAvg).toString() : null },
    { label: 'Rounds', value: rounds.length > 0 ? rounds.length.toString() : null },
  ];
}
