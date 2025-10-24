/**
 * Utility functions for formatting stats summaries in profile media tiles
 */

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

  // Try to extract meaningful info from generic stats
  // This is a simple implementation that can be expanded per sport
  const entries = Object.entries(statsData);

  if (entries.length === 0) return null;

  // Take first few key stats
  const primaryStats = entries.slice(0, 2).map(([key, value]) => {
    // Format key to be more readable (camelCase -> Title Case)
    const formattedKey = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
    return `${formattedKey}: ${value}`;
  });

  return {
    primaryLine: primaryStats.join(' • '),
    secondaryLine: null
  };
}
