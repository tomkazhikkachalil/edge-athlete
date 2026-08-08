/**
 * Utility functions for formatting stats summaries in profile media tiles
 */

import { getStatSchema, isStatLineData, formatResult } from '@/lib/sports/stat-schemas';
import { formatDuration, formatVolume } from '@/lib/workouts/summary';

interface GolfRoundData {
  course?: string | null;
  gross_score?: number | null;  // Changed from total_score
  par?: number | null;
  holes?: number | null;
  gir_percentage?: number | null;  // Greens in regulation percentage
  fir_percentage?: number | null;  // Fairways in regulation percentage
  total_putts?: number | null;
}

interface StatsSummary {
  primaryLine: string;
  secondaryLine: string | null;
}

/**
 * Calculate score relative to par (e.g., "+2", "-1", "E")
 */
function getScoreToPar(totalScore: number, par: number): string {
  const diff = totalScore - par;
  if (diff === 0) return 'E';
  if (diff > 0) return `+${diff}`;
  return `${diff}`;
}

/**
 * Format holes count (e.g., "18H", "9H")
 */
function formatHoles(holes: number): string {
  return `${holes}H`;
}

/**
 * Get the best available quick stat from golf round data
 * Priority: GIR > Fairways > Putts
 */
function getQuickStat(round: GolfRoundData): string | null {
  // Try GIR first (percentage)
  if (round.gir_percentage !== null && round.gir_percentage !== undefined) {
    return `GIR ${round.gir_percentage.toFixed(0)}%`;
  }

  // Try Fairways (percentage)
  if (round.fir_percentage !== null && round.fir_percentage !== undefined) {
    return `FWY ${round.fir_percentage.toFixed(0)}%`;
  }

  // Try Putts (total number)
  if (round.total_putts !== null && round.total_putts !== undefined) {
    return `${round.total_putts} putts`;
  }

  return null;
}

/**
 * Generate stats summary for golf rounds
 */
export function formatGolfStatsSummary(golfRound: GolfRoundData | null): StatsSummary | null {
  if (!golfRound) return null;

  const { course, gross_score, par, holes } = golfRound;

  // Need at least a score to show anything meaningful
  if (gross_score === null || gross_score === undefined) {
    return null;
  }

  // Primary line: Course • Score (relative to par if available)
  const courseName = course || 'Round';
  let scoreDisplay = `${gross_score}`;

  if (par !== null && par !== undefined) {
    const scoreToPar = getScoreToPar(gross_score, par);
    scoreDisplay = `${gross_score} (${scoreToPar})`;
  }

  const primaryLine = `${courseName} • ${scoreDisplay}`;

  // Secondary line: Holes • Quick stat (if available)
  const parts: string[] = [];

  if (holes !== null && holes !== undefined) {
    parts.push(formatHoles(holes));
  }

  const quickStat = getQuickStat(golfRound);
  if (quickStat) {
    parts.push(quickStat);
  }

  const secondaryLine = parts.length > 0 ? parts.join(' • ') : null;

  return {
    primaryLine,
    secondaryLine
  };
}

/**
 * Generate generic stats summary from stats_data object
 * This is a fallback for non-golf stats
 */
export function formatGenericStatsSummary(statsData: Record<string, unknown> | null): StatsSummary | null {
  if (!statsData || Object.keys(statsData).length === 0) {
    return null;
  }

  // Stat-line sports (ice hockey, volleyball, …) — schema-driven summary
  if (isStatLineData(statsData)) {
    const schema = getStatSchema(statsData.sport_key);
    if (schema) {
      const headline = schema.headline(statsData.stats);
      const result = formatResult(statsData);
      const context = [result, statsData.opponent ? `vs ${statsData.opponent}` : null]
        .filter(Boolean)
        .join(' ');
      if (headline || context) {
        return {
          primaryLine: headline ?? context,
          secondaryLine: headline ? (context || null) : null,
        };
      }
    }
    return null;
  }

  // Workout sessions ship a pre-formatted headline ("Deadlift 300 lbs × 6")
  // plus real aggregates. Without this branch the generic path below took the
  // first two OBJECT KEYS and rendered "Type: workout_session • Title: Workout"
  // — the payload's plumbing instead of the workout.
  if (statsData.type === 'workout_session') {
    const topLine = typeof statsData.top_line === 'string' ? statsData.top_line.trim() : '';
    const title = typeof statsData.title === 'string' ? statsData.title.trim() : '';
    const exercises = num(statsData.exercise_count);
    const sets = num(statsData.total_sets);
    const seconds = num(statsData.duration_seconds);
    const volume = num(statsData.total_volume_lbs);

    const detail = [
      exercises ? `${exercises} exercise${exercises === 1 ? '' : 's'}` : null,
      sets ? `${sets} set${sets === 1 ? '' : 's'}` : null,
      seconds ? formatDuration(seconds) : null,
      volume ? formatVolume(volume) : null,
    ].filter(Boolean);

    const primaryLine = topLine || title || (detail.length ? (detail.shift() as string) : '');
    if (!primaryLine) return null;
    return {
      primaryLine,
      // Three is what fits a tile; volume is the first to go.
      secondaryLine: detail.length ? detail.slice(0, 3).join(' · ') : null,
    };
  }

  // Generic fallback. Skips the payload's own plumbing — a discriminator and
  // foreign keys are never what the athlete did.
  const IGNORED = new Set(['type', 'sport_key', 'date']);
  const entries = Object.entries(statsData).filter(
    ([key, value]) =>
      !IGNORED.has(key) &&
      !key.endsWith('_id') &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      typeof value !== 'object'
  );

  if (entries.length === 0) return null;

  // Take first few key stats
  const primaryStats = entries.slice(0, 2).map(([key, value]) => {
    // snake_case / camelCase -> Title Case, capitalising EVERY word:
    // uppercasing only the first left "Metric label" on the tile.
    const formattedKey = key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
    return `${formattedKey}: ${value}`;
  });

  return {
    primaryLine: primaryStats.join(' • '),
    secondaryLine: null
  };
}

/** Positive finite numbers only — 0 and junk read as "not recorded". */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
