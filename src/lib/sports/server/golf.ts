import type { ServerSportModule, SportStatsCard } from './types';

interface GolfRoundSlice {
  gross_score: number | null;
  par: number | null;
}

/**
 * Pure tile math for the public profile's golf stats card — moved verbatim
 * from api/public/profile (last 10 rounds; avg to one decimal; best = min;
 * falsy gross_scores filtered, matching the original `.filter(Boolean)`).
 */
export function buildGolfStatsTiles(rounds: GolfRoundSlice[]): SportStatsCard | null {
  if (rounds.length === 0) return null;
  const scores = rounds.map(r => r.gross_score).filter(Boolean) as number[];
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10
    : null;
  const bestScore = scores.length > 0 ? Math.min(...scores) : null;

  return {
    label: 'Golf Stats',
    tiles: [
      { label: 'Rounds', value: String(rounds.length) },
      { label: 'Avg Score', value: avgScore !== null ? String(avgScore) : '-' },
      { label: 'Best Score', value: bestScore !== null ? String(bestScore) : '-' },
    ],
  };
}

export const golfServerModule: ServerSportModule = {
  async buildStatsCard(profileId, supabase) {
    const { data: rounds } = await supabase
      .from('golf_rounds')
      .select('gross_score, par')
      .eq('profile_id', profileId)
      .order('date', { ascending: false })
      .limit(10);

    return buildGolfStatsTiles(rounds || []);
  },
};
