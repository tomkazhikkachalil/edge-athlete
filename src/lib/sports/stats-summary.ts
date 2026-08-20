/**
 * Two-line stats summary for profile media tiles and featured cards.
 *
 * Pure and sport-dispatched here — NOT on SportAdapter — for the same reason
 * as post-headline.ts: adapters are async and network-backed, while this
 * takes already-fetched row data and must run inline in a render. Callers
 * hand over whatever they have (a golf round row, a stats_data payload) and
 * the dispatch lives in one place instead of an if/else at every tile.
 *
 * Moved from src/lib/stats-summary.ts (August 2026) so the sport dispatch
 * sits with the rest of the sport seams.
 */

import { getStatSchema, isStatLineData, formatResult } from '@/lib/sports/stat-schemas';
import { formatDuration, formatVolume } from '@/lib/workouts/summary';

/** The subset of a golf round row the summary needs. TaggedTile's rows carry
 *  only the first four fields — the quick-stat line degrades gracefully. */
export interface GolfRoundSummaryInput {
  course?: string | null;
  gross_score?: number | null;
  par?: number | null;
  holes?: number | null;
  gir_percentage?: number | null;
  fir_percentage?: number | null;
  total_putts?: number | null;
}

export interface StatsSummary {
  primaryLine: string;
  secondaryLine: string | null;
}

/**
 * The one public entry point: golf rounds win over stats_data when both are
 * present (a golf post's stats_data is plumbing, not the round).
 */
export function buildStatsSummary(input: {
  golfRound?: GolfRoundSummaryInput | null;
  statsData?: Record<string, unknown> | null;
}): StatsSummary | null {
  if (input.golfRound) {
    const golf = golfStatsSummary(input.golfRound);
    if (golf) return golf;
  }
  return genericStatsSummary(input.statsData ?? null);
}

/** Score relative to par (e.g., "+2", "-1", "E"). */
function getScoreToPar(totalScore: number, par: number): string {
  const diff = totalScore - par;
  if (diff === 0) return 'E';
  if (diff > 0) return `+${diff}`;
  return `${diff}`;
}

/** Best available quick stat: GIR > Fairways > Putts. */
function getQuickStat(round: GolfRoundSummaryInput): string | null {
  if (round.gir_percentage !== null && round.gir_percentage !== undefined) {
    return `GIR ${round.gir_percentage.toFixed(0)}%`;
  }
  if (round.fir_percentage !== null && round.fir_percentage !== undefined) {
    return `FWY ${round.fir_percentage.toFixed(0)}%`;
  }
  if (round.total_putts !== null && round.total_putts !== undefined) {
    return `${round.total_putts} putts`;
  }
  return null;
}

function golfStatsSummary(golfRound: GolfRoundSummaryInput): StatsSummary | null {
  const { course, gross_score, par, holes } = golfRound;

  // Need at least a score to show anything meaningful
  if (gross_score === null || gross_score === undefined) {
    return null;
  }

  const courseName = course || 'Round';
  let scoreDisplay = `${gross_score}`;
  if (par !== null && par !== undefined) {
    scoreDisplay = `${gross_score} (${getScoreToPar(gross_score, par)})`;
  }
  const primaryLine = `${courseName} • ${scoreDisplay}`;

  const parts: string[] = [];
  if (holes !== null && holes !== undefined) {
    parts.push(`${holes}H`);
  }
  const quickStat = getQuickStat(golfRound);
  if (quickStat) {
    parts.push(quickStat);
  }

  return {
    primaryLine,
    secondaryLine: parts.length > 0 ? parts.join(' • ') : null,
  };
}

function genericStatsSummary(statsData: Record<string, unknown> | null): StatsSummary | null {
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
    secondaryLine: null,
  };
}

/** Positive finite numbers only — 0 and junk read as "not recorded". */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
