/**
 * Per-sport stat-line schemas — single source of truth for:
 *  - the composer form fields (StatLineForm)
 *  - feed rendering (StatLineCard)
 *  - profile aggregates (/api/sports/stat-lines) via profileTiles
 *  - media-tile summaries (sports/stats-summary.ts)
 *
 * Data model ("build for today, architect for tomorrow"):
 * Stat-line sports store one structured object in posts.stats_data:
 *   {
 *     type: 'stat_line',
 *     sport_key: 'ice_hockey',
 *     date: '2026-07-17',
 *     opponent: 'Rivals HC',
 *     result: 'W',
 *     result_score: '4-2',
 *     stats: { goals: 2, assists: 1, ... }
 *   }
 * This requires zero DDL (posts.stats_data already exists and is indexed).
 * When a sport's data grows past a stat line (per-period detail, shifts,
 * rotations), it graduates to its own tables like golf did (golf_rounds /
 * golf_holes) — see docs/MULTI_SPORT_ROADMAP.md.
 *
 * ADDING A STAT-LINE SPORT = 2 edits:
 *   1. add a schema entry here (fields + profileTiles + headline)
 *   2. `enabled: true` in SportRegistry + register a StatLinePostAdapter
 * No component or API changes.
 */

import type { SportKey } from './SportRegistry';

export interface StatFieldDef {
  key: string;
  label: string;        // "Goals"
  shortLabel: string;   // "G" — used in compact chips/summaries
  min?: number;
  max?: number;
}

/**
 * How one profile-summary tile is computed from a season of stat lines.
 * Keeps aggregation correct per stat type — you can't sum a per-game average.
 */
export type ProfileTileComputation =
  | { kind: 'count' }                          // number of entries (Games/Matches)
  | { kind: 'sum'; keys: string[] }            // total across entries (Goals, Points)
  | { kind: 'avg'; keys: string[]; decimals?: number }  // per-entry average (PPG, AVG)
  | { kind: 'min'; keys: string[]; decimals?: number }; // best-is-lowest (race PBs)

export interface ProfileTileDef {
  label: string;                 // matches the registry metric label
  compute: ProfileTileComputation;
}

export interface SportStatSchema {
  sport_key: SportKey;
  /** Noun for one entry: "Game", "Match" */
  activityNoun: string;
  /** Label for the opposition input: "Opponent", vs etc. */
  opponentLabel: string;
  /** Stat fields shown in the composer and rendered in cards, in order. */
  fields: StatFieldDef[];
  /** Up to 4 profile highlight tiles, computed correctly per stat type. */
  profileTiles: ProfileTileDef[];
  /**
   * Derived headline for a single stat line, e.g. "2 G • 1 A" — used in
   * feed cards and media tiles. Returns null when no stats were entered.
   */
  headline: (stats: Record<string, number>) => string | null;
  /**
   * The ONE number worth showing big on a feed card that has no media, and
   * the stats that support it.
   *
   * Structured on purpose: `headline` above answers the same question but
   * pre-joins its answer into a string ("2 G • 1 A"), which cannot be laid
   * out as a hero number over supporting tiles. Both stay — headline still
   * feeds post-headline.ts and the profile activity rows.
   *
   * `hero` may be COMPUTED (hockey points = goals + assists) rather than a
   * plain field read, which is why it is a function and not a key.
   */
  heroStat: { label: string; compute: (stats: Record<string, number>) => number | null };
  /** Ordered; the card renders the first 3 of these that were recorded. */
  supportKeys: string[];
}

export interface StatLineData {
  type: 'stat_line';
  sport_key: SportKey;
  date?: string;
  opponent?: string;
  result?: 'W' | 'L' | 'T';
  result_score?: string;
  stats: Record<string, number>;
}

const compactLine = (
  stats: Record<string, number>,
  fields: StatFieldDef[],
  max = 3
): string | null => {
  const parts = fields
    .filter(f => typeof stats[f.key] === 'number' && stats[f.key] > 0)
    .slice(0, max)
    .map(f => `${stats[f.key]} ${f.shortLabel}`);
  return parts.length > 0 ? parts.join(' • ') : null;
};

/** Points = goals + assists. Hockey/soccer record the parts, not the total,
 *  so the headline number has to be derived. Returns null (not 0) when the
 *  athlete recorded neither, so the card can fall back rather than shout "0". */
const pointsFromGoalsAssists = (stats: Record<string, number>): number | null => {
  const g = stats.goals ?? 0;
  const a = stats.assists ?? 0;
  return g > 0 || a > 0 ? g + a : null;
};

/** Reads one key, treating absent/zero as "nothing to headline". */
const heroFromKey = (key: string) => (stats: Record<string, number>): number | null => {
  const v = stats[key];
  return typeof v === 'number' && v > 0 ? v : null;
};

/** Convention helper: "G + A" style headline for point-scoring sports. */
const goalsAssistsHeadline = (schema: () => SportStatSchema) =>
  (stats: Record<string, number>): string | null => {
    const g = stats.goals ?? 0;
    const a = stats.assists ?? 0;
    if (g > 0 || a > 0) return `${g} G • ${a} A`;
    return compactLine(stats, schema().fields);
  };

/**
 * Track events, shortest first — the order decides which PB headlines a
 * card. One list shared by the stat schema, the settings PB fields, and the
 * track server module, so an event can never exist in one and not another.
 */
export const TRACK_EVENTS = [
  { key: 'time_100m', label: '100m', meters: 100 },
  { key: 'time_200m', label: '200m', meters: 200 },
  { key: 'time_400m', label: '400m', meters: 400 },
  { key: 'time_800m', label: '800m', meters: 800 },
  { key: 'time_1500m', label: '1500m', meters: 1500 },
] as const;

/** 11.85 → "11.85s"; 245.3 → "4:05.30" (≥60s races read as m:ss.xx). */
export const formatRaceTime = (seconds: number): string => {
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

/** Shortest-distance event with a recorded time, or null. */
const firstTrackEvent = (stats: Record<string, number>) =>
  TRACK_EVENTS.find(e => typeof stats[e.key] === 'number' && stats[e.key] > 0) ?? null;

export const STAT_SCHEMAS: Partial<Record<SportKey, SportStatSchema>> = {
  ice_hockey: {
    sport_key: 'ice_hockey',
    activityNoun: 'Game',
    opponentLabel: 'Opponent',
    fields: [
      { key: 'goals', label: 'Goals', shortLabel: 'G', min: 0, max: 20 },
      { key: 'assists', label: 'Assists', shortLabel: 'A', min: 0, max: 20 },
      { key: 'shots', label: 'Shots', shortLabel: 'S', min: 0, max: 60 },
      { key: 'hits', label: 'Hits', shortLabel: 'H', min: 0, max: 30 },
      { key: 'blocks', label: 'Blocked Shots', shortLabel: 'BLK', min: 0, max: 20 },
      { key: 'pim', label: 'Penalty Minutes', shortLabel: 'PIM', min: 0, max: 60 },
    ],
    profileTiles: [
      { label: 'Goals', compute: { kind: 'sum', keys: ['goals'] } },
      { label: 'Assists', compute: { kind: 'sum', keys: ['assists'] } },
      { label: 'Points', compute: { kind: 'sum', keys: ['goals', 'assists'] } },
      { label: 'Games', compute: { kind: 'count' } },
    ],
    headline: goalsAssistsHeadline(() => STAT_SCHEMAS.ice_hockey!),
    heroStat: { label: 'Points', compute: pointsFromGoalsAssists },
    supportKeys: ['goals', 'assists', 'shots'],
  },
  volleyball: {
    sport_key: 'volleyball',
    activityNoun: 'Match',
    opponentLabel: 'Opponent',
    fields: [
      { key: 'kills', label: 'Kills', shortLabel: 'K', min: 0, max: 50 },
      { key: 'assists', label: 'Assists', shortLabel: 'A', min: 0, max: 80 },
      { key: 'digs', label: 'Digs', shortLabel: 'D', min: 0, max: 50 },
      { key: 'aces', label: 'Aces', shortLabel: 'ACE', min: 0, max: 20 },
      { key: 'blocks', label: 'Blocks', shortLabel: 'BLK', min: 0, max: 25 },
      { key: 'service_errors', label: 'Service Errors', shortLabel: 'SE', min: 0, max: 20 },
    ],
    profileTiles: [
      { label: 'Kills', compute: { kind: 'sum', keys: ['kills'] } },
      { label: 'Digs', compute: { kind: 'sum', keys: ['digs'] } },
      { label: 'Aces', compute: { kind: 'sum', keys: ['aces'] } },
      { label: 'Matches', compute: { kind: 'count' } },
    ],
    headline: stats => compactLine(stats, STAT_SCHEMAS.volleyball!.fields),
    // Kills/Digs/Aces, matching profileTiles above. `headline` here is the
    // generic first-3-non-zero, which would surface setter ASSISTS over aces
    // and contradict this sport's own profile tiles — hence the explicit set.
    heroStat: { label: 'Kills', compute: heroFromKey('kills') },
    supportKeys: ['digs', 'aces', 'blocks'],
  },
  basketball: {
    sport_key: 'basketball',
    activityNoun: 'Game',
    opponentLabel: 'Opponent',
    fields: [
      { key: 'points', label: 'Points', shortLabel: 'PTS', min: 0, max: 100 },
      { key: 'rebounds', label: 'Rebounds', shortLabel: 'REB', min: 0, max: 40 },
      { key: 'assists', label: 'Assists', shortLabel: 'AST', min: 0, max: 30 },
      { key: 'steals', label: 'Steals', shortLabel: 'STL', min: 0, max: 15 },
      { key: 'blocks', label: 'Blocks', shortLabel: 'BLK', min: 0, max: 15 },
      { key: 'threes', label: '3-Pointers', shortLabel: '3PM', min: 0, max: 20 },
    ],
    profileTiles: [
      { label: 'PPG', compute: { kind: 'avg', keys: ['points'], decimals: 1 } },
      { label: 'RPG', compute: { kind: 'avg', keys: ['rebounds'], decimals: 1 } },
      { label: 'APG', compute: { kind: 'avg', keys: ['assists'], decimals: 1 } },
      { label: 'Games', compute: { kind: 'count' } },
    ],
    headline: stats => {
      const parts: string[] = [];
      if ((stats.points ?? 0) > 0) parts.push(`${stats.points} PTS`);
      if ((stats.rebounds ?? 0) > 0) parts.push(`${stats.rebounds} REB`);
      if ((stats.assists ?? 0) > 0) parts.push(`${stats.assists} AST`);
      return parts.length > 0 ? parts.join(' • ') : null;
    },
    heroStat: { label: 'Points', compute: heroFromKey('points') },
    supportKeys: ['rebounds', 'assists', 'threes'],
  },
  soccer: {
    sport_key: 'soccer',
    activityNoun: 'Match',
    opponentLabel: 'Opponent',
    fields: [
      { key: 'goals', label: 'Goals', shortLabel: 'G', min: 0, max: 15 },
      { key: 'assists', label: 'Assists', shortLabel: 'A', min: 0, max: 15 },
      { key: 'shots', label: 'Shots', shortLabel: 'SH', min: 0, max: 30 },
      { key: 'saves', label: 'Saves', shortLabel: 'SV', min: 0, max: 30 },
      { key: 'tackles', label: 'Tackles', shortLabel: 'TKL', min: 0, max: 30 },
      { key: 'yellow_cards', label: 'Yellow Cards', shortLabel: 'YC', min: 0, max: 5 },
    ],
    profileTiles: [
      { label: 'Goals', compute: { kind: 'sum', keys: ['goals'] } },
      { label: 'Assists', compute: { kind: 'sum', keys: ['assists'] } },
      { label: 'Saves', compute: { kind: 'sum', keys: ['saves'] } },
      { label: 'Matches', compute: { kind: 'count' } },
    ],
    headline: goalsAssistsHeadline(() => STAT_SCHEMAS.soccer!),
    // Goals, not points: a soccer scoreline is about goals, and a keeper's
    // line is carried by saves in the support row.
    heroStat: { label: 'Goals', compute: heroFromKey('goals') },
    supportKeys: ['assists', 'shots', 'saves'],
  },
  baseball: {
    sport_key: 'baseball',
    activityNoun: 'Game',
    opponentLabel: 'Opponent',
    fields: [
      { key: 'hits', label: 'Hits', shortLabel: 'H', min: 0, max: 10 },
      { key: 'at_bats', label: 'At Bats', shortLabel: 'AB', min: 0, max: 12 },
      { key: 'runs', label: 'Runs', shortLabel: 'R', min: 0, max: 10 },
      { key: 'rbis', label: 'RBIs', shortLabel: 'RBI', min: 0, max: 12 },
      { key: 'home_runs', label: 'Home Runs', shortLabel: 'HR', min: 0, max: 5 },
      { key: 'stolen_bases', label: 'Stolen Bases', shortLabel: 'SB', min: 0, max: 6 },
    ],
    profileTiles: [
      // Batting average = total hits / total at-bats (a ratio of two sums,
      // not an avg-per-game — handled as its own tile below via 'avg' on a
      // derived ratio is not expressible, so we sum both and the API divides).
      { label: 'Hits', compute: { kind: 'sum', keys: ['hits'] } },
      { label: 'HR', compute: { kind: 'sum', keys: ['home_runs'] } },
      { label: 'RBI', compute: { kind: 'sum', keys: ['rbis'] } },
      { label: 'Games', compute: { kind: 'count' } },
    ],
    headline: stats => {
      const parts: string[] = [];
      if ((stats.hits ?? 0) > 0) parts.push(`${stats.hits} H`);
      if ((stats.home_runs ?? 0) > 0) parts.push(`${stats.home_runs} HR`);
      if ((stats.rbis ?? 0) > 0) parts.push(`${stats.rbis} RBI`);
      return parts.length > 0 ? parts.join(' • ') : null;
    },
    heroStat: { label: 'Hits', compute: heroFromKey('hits') },
    supportKeys: ['home_runs', 'rbis', 'runs'],
  },

  track_field: {
    sport_key: 'track_field',
    activityNoun: 'Race',
    opponentLabel: 'Meet',
    // Times in SECONDS (11.85, or 245.30 for a 4:05.30 1500m). One race post
    // usually fills exactly one event.
    fields: TRACK_EVENTS.map(e => ({
      key: e.key,
      label: `${e.label} time (s)`,
      shortLabel: e.label,
      min: 0,
      max: 3600,
    })),
    profileTiles: [
      { label: '100m PB', compute: { kind: 'min', keys: ['time_100m'] } },
      { label: '200m PB', compute: { kind: 'min', keys: ['time_200m'] } },
      { label: 'Races', compute: { kind: 'count' } },
    ],
    headline: stats => {
      const event = firstTrackEvent(stats);
      return event ? `${event.label} — ${formatRaceTime(stats[event.key])}` : null;
    },
    // Best-is-lowest, so the hero is the shortest-distance recorded time —
    // the number itself, with the event named by the headline above.
    heroStat: {
      label: 'Time',
      compute: stats => {
        const event = firstTrackEvent(stats);
        return event ? stats[event.key] : null;
      },
    },
    supportKeys: TRACK_EVENTS.map(e => e.key),
  },
};

export const getStatSchema = (sportKey: string): SportStatSchema | null =>
  STAT_SCHEMAS[sportKey as SportKey] ?? null;

/** Type guard for posts.stats_data payloads. */
export const isStatLineData = (data: unknown): data is StatLineData => {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.type === 'stat_line' && typeof d.sport_key === 'string' && typeof d.stats === 'object' && d.stats !== null;
};

/** Format a result like "W 4-2" from a stat line's context fields. */
export const formatResult = (line: StatLineData): string | null => {
  if (!line.result) return null;
  return line.result_score ? `${line.result} ${line.result_score}` : line.result;
};

/**
 * Compute a profile tile's display value from a season of stat lines.
 * Correct per stat type: count, sum, or per-entry average.
 */
export const computeProfileTile = (
  tile: ProfileTileDef,
  lines: StatLineData[]
): string => {
  const c = tile.compute;
  if (c.kind === 'count') return String(lines.length);

  if (c.kind === 'sum') {
    let total = 0;
    for (const line of lines) {
      for (const key of c.keys) {
        const v = line.stats[key];
        if (typeof v === 'number' && Number.isFinite(v)) total += v;
      }
    }
    return String(total);
  }

  if (c.kind === 'min') {
    // Best-is-lowest (race times). Zero/absent = not recorded, never a PB.
    let best: number | null = null;
    for (const line of lines) {
      for (const key of c.keys) {
        const v = line.stats[key];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0 && (best === null || v < best)) {
          best = v;
        }
      }
    }
    return best === null ? '-' : best.toFixed(c.decimals ?? 2);
  }

  // avg: mean per entry across the summed keys
  if (lines.length === 0) return '0';
  let total = 0;
  for (const line of lines) {
    for (const key of c.keys) {
      const v = line.stats[key];
      if (typeof v === 'number' && Number.isFinite(v)) total += v;
    }
  }
  const avg = total / lines.length;
  return avg.toFixed(c.decimals ?? 1);
};
