// ── Competition scoring — the PURE rules (phase 2 R3) ───────────────────────
// The golf formats.ts charter: "nothing here touches storage" — a
// competition's scoring_rule only changes how standings are computed and
// displayed. Node-only vitest; no framework or Supabase imports.
//
// Declarative in the ProfileTileComputation style: a rule names its
// points mapping, sort direction, tiebreaker chain, and the columns the
// renderers draw BLINDLY (the SportStatsCard precedent — fixture shows
// W/L/T/GF/GA/PTS, leaderboard shows Rounds/Total in R5). The registry
// is app-side; the DB stays shape-blind (the 113 convention). Unknown
// scoring_rule keys fall back to the sport default — a hand-edited row
// can never crash a recompute.

export interface StandingRow {
  entry_id: string;
  rank: number;
  points: number | null;
  played: number;
  stats: Record<string, number>;
}

export interface StandingsColumn {
  key: string;
  label: string;
  shortLabel: string;
}

export interface FixtureScoringRule {
  key: string;
  kind: 'fixture';
  /** Points for a win / tie / loss. */
  win: number;
  tie: number;
  loss: number;
  /** stats keys compared after points, in order. */
  tiebreakers: string[];
  columns: StandingsColumn[];
}

const FIXTURE_COLUMNS: StandingsColumn[] = [
  { key: 'played', label: 'Played', shortLabel: 'GP' },
  { key: 'w', label: 'Wins', shortLabel: 'W' },
  { key: 'l', label: 'Losses', shortLabel: 'L' },
  { key: 't', label: 'Ties', shortLabel: 'T' },
  { key: 'gf', label: 'For', shortLabel: 'GF' },
  { key: 'ga', label: 'Against', shortLabel: 'GA' },
  { key: 'diff', label: 'Differential', shortLabel: '+/-' },
  { key: 'points', label: 'Points', shortLabel: 'PTS' },
];

export const FIXTURE_RULES: Record<string, FixtureScoringRule> = {
  // Hockey convention: 2 for the win, 1 for the tie.
  points_2_1_0: {
    key: 'points_2_1_0',
    kind: 'fixture',
    win: 2,
    tie: 1,
    loss: 0,
    tiebreakers: ['w', 'diff', 'gf'],
    columns: FIXTURE_COLUMNS,
  },
  // Soccer convention: 3 for the win.
  points_3_1_0: {
    key: 'points_3_1_0',
    kind: 'fixture',
    win: 3,
    tie: 1,
    loss: 0,
    tiebreakers: ['w', 'diff', 'gf'],
    columns: FIXTURE_COLUMNS,
  },
};

/** Per-sport default rule when competitions.scoring_rule is NULL. Sports
 *  without an entry take the hockey table — a points table is never a
 *  crash. */
const SPORT_DEFAULT_FIXTURE_RULE: Record<string, string> = {
  ice_hockey: 'points_2_1_0',
  soccer: 'points_3_1_0',
  basketball: 'points_2_1_0',
  volleyball: 'points_3_1_0',
  baseball: 'points_2_1_0',
};

export function resolveFixtureRule(
  sportKey: string,
  scoringRule: string | null
): FixtureScoringRule {
  if (scoringRule && FIXTURE_RULES[scoringRule]) return FIXTURE_RULES[scoringRule];
  return FIXTURE_RULES[SPORT_DEFAULT_FIXTURE_RULE[sportKey] ?? 'points_2_1_0'];
}

export interface FixtureContestInput {
  status: string;
  /** Exactly the two sides, each with its entry and numeric score (null
   *  until entered). */
  sides: { entry_id: string; score: number | null }[];
}

/** Compute fixture standings rows from completed contests. Pure; input
 *  order never matters. Ranks are SHARED on full sort-key ties. */
export function computeFixtureStandings(
  entryIds: string[],
  contests: FixtureContestInput[],
  rule: FixtureScoringRule
): StandingRow[] {
  const table = new Map<string, { points: number; played: number; stats: Record<string, number> }>();
  for (const id of entryIds) {
    table.set(id, { points: 0, played: 0, stats: { w: 0, l: 0, t: 0, gf: 0, ga: 0, diff: 0 } });
  }

  for (const contest of contests) {
    if (contest.status !== 'completed') continue;
    const [a, b] = contest.sides;
    if (!a || !b || a.score == null || b.score == null) continue;
    const rowA = table.get(a.entry_id);
    const rowB = table.get(b.entry_id);
    // A withdrawn entry's games stop counting — its row is gone.
    if (!rowA || !rowB) continue;
    for (const [self, opp, row] of [
      [a, b, rowA],
      [b, a, rowB],
    ] as const) {
      row.played += 1;
      row.stats.gf += self.score!;
      row.stats.ga += opp.score!;
      row.stats.diff = row.stats.gf - row.stats.ga;
      if (self.score! > opp.score!) {
        row.stats.w += 1;
        row.points += rule.win;
      } else if (self.score! < opp.score!) {
        row.stats.l += 1;
        row.points += rule.loss;
      } else {
        row.stats.t += 1;
        row.points += rule.tie;
      }
    }
  }

  const sortKey = (id: string): number[] => {
    const row = table.get(id)!;
    return [row.points, ...rule.tiebreakers.map(k => row.stats[k] ?? 0)];
  };
  const sorted = [...entryIds].sort((x, y) => {
    const kx = sortKey(x);
    const ky = sortKey(y);
    for (let i = 0; i < kx.length; i++) {
      if (kx[i] !== ky[i]) return ky[i] - kx[i];
    }
    // Stable, deterministic final tiebreak.
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const rows: StandingRow[] = [];
  let lastKey: string | null = null;
  let lastRank = 0;
  sorted.forEach((id, i) => {
    const keyStr = JSON.stringify(sortKey(id));
    const rank = keyStr === lastKey ? lastRank : i + 1;
    lastKey = keyStr;
    lastRank = rank;
    const row = table.get(id)!;
    rows.push({ entry_id: id, rank, points: row.points, played: row.played, stats: row.stats });
  });
  return rows;
}

// ── Leaderboard rules (R5) — individual entrants, summed totals ─────────────

export interface LeaderboardScoringRule {
  key: string;
  kind: 'leaderboard';
  /** 'asc' = lowest total wins (strokes); 'desc' = highest wins (points). */
  direction: 'asc' | 'desc';
  columns: StandingsColumn[];
}

const LEADERBOARD_COLUMNS: StandingsColumn[] = [
  { key: 'played', label: 'Rounds', shortLabel: 'RDS' },
  { key: 'points', label: 'Total', shortLabel: 'TOT' },
];

export const LEADERBOARD_RULES: Record<string, LeaderboardScoringRule> = {
  stroke_total: {
    key: 'stroke_total',
    kind: 'leaderboard',
    direction: 'asc',
    columns: LEADERBOARD_COLUMNS,
  },
  points_total: {
    key: 'points_total',
    kind: 'leaderboard',
    direction: 'desc',
    columns: LEADERBOARD_COLUMNS,
  },
};

const SPORT_DEFAULT_LEADERBOARD_RULE: Record<string, string> = {
  golf: 'stroke_total',
};

export function resolveLeaderboardRule(
  sportKey: string,
  scoringRule: string | null
): LeaderboardScoringRule {
  if (scoringRule && LEADERBOARD_RULES[scoringRule]) return LEADERBOARD_RULES[scoringRule];
  return LEADERBOARD_RULES[SPORT_DEFAULT_LEADERBOARD_RULE[sportKey] ?? 'points_total'];
}

export interface LeaderboardContestInput {
  status: string;
  /** Every participant with a score entered so far (entry_id keyed). */
  scores: { entry_id: string; score: number | null }[];
}

/** Standings for a leaderboard: total = summed scores across completed
 *  contests; played = contests actually scored. Entrants with no scored
 *  round sit below every scored entrant (a zero-stroke total must never
 *  "win" an ascending board). Ties share rank. */
export function computeLeaderboardStandings(
  entryIds: string[],
  contests: LeaderboardContestInput[],
  rule: LeaderboardScoringRule
): StandingRow[] {
  const table = new Map<string, { total: number; played: number }>();
  for (const id of entryIds) table.set(id, { total: 0, played: 0 });
  for (const contest of contests) {
    if (contest.status !== 'completed') continue;
    for (const s of contest.scores) {
      const row = table.get(s.entry_id);
      if (!row || s.score == null) continue;
      row.total += s.score;
      row.played += 1;
    }
  }

  const sortKey = (id: string): number => {
    const row = table.get(id)!;
    if (row.played === 0) return Number.POSITIVE_INFINITY; // always last
    return rule.direction === 'asc' ? row.total : -row.total;
  };
  const sorted = [...entryIds].sort((x, y) => {
    const kx = sortKey(x);
    const ky = sortKey(y);
    if (kx !== ky) return kx - ky;
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const rows: StandingRow[] = [];
  let lastKey: number | null = null;
  let lastRank = 0;
  sorted.forEach((id, i) => {
    const key = sortKey(id);
    const rank = key === lastKey ? lastRank : i + 1;
    lastKey = key;
    lastRank = rank;
    const row = table.get(id)!;
    rows.push({
      entry_id: id,
      rank,
      points: row.played === 0 ? null : row.total,
      played: row.played,
      stats: {},
    });
  });
  return rows;
}
