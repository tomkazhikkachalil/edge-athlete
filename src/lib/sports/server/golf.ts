import { formatHandicapIndex, type HandicapSeriesResult } from '@/lib/golf/handicap';
import { fetchHandicapComputation } from '@/lib/golf/handicap-server';
import type { ServerSportModule, SkillCardContribution, SportStatsCard } from './types';

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

// Mirrors handicapIndex()'s null-below-3 gate (handicap.ts) so the card can
// show progress toward the unlock instead of nothing.
const HANDICAP_UNLOCK_DIFFS = 3;

/**
 * Pure skill-card math: computed handicap as the tracked headline, or an
 * n-of-3 progress state; stats tiles ride along as tracked.
 */
export function buildGolfSkillContribution(
  handicap: HandicapSeriesResult,
  stats: SportStatsCard | null
): SkillCardContribution {
  const { current, diffs } = handicap;
  return {
    headline: current
      ? {
          value: formatHandicapIndex(current.index),
          label: 'Handicap est.',
          provenance: 'tracked',
          detail: `· ${current.roundsCounted} rds`,
        }
      : null,
    progress: current
      ? null
      : {
          count: diffs.length,
          needed: HANDICAP_UNLOCK_DIFFS,
          label: 'rated rounds',
          // Mirrors the trends page's unlock explainer.
          hint:
            'Log rounds with a course rating and slope to unlock your estimate. ' +
            '18-hole rounds count first; 9-hole rounds join once your estimate exists.',
        },
    tiles: (stats?.tiles ?? []).map(t => ({ ...t, provenance: 'tracked' as const })),
    detailHref: '/app/sport/golf/trends',
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

  async buildSkillCard(profileId, supabase) {
    const [handicap, stats] = await Promise.all([
      fetchHandicapComputation(profileId, supabase),
      golfServerModule.buildStatsCard(profileId, supabase),
    ]);
    return buildGolfSkillContribution(handicap, stats);
  },
};
