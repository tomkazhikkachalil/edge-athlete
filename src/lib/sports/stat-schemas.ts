/**
 * Per-sport stat-line schemas — single source of truth for:
 *  - the composer form fields (StatLineForm)
 *  - feed rendering (StatLineCard)
 *  - profile aggregates (/api/sports/stat-lines)
 *  - media-tile summaries (stats-summary.ts)
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
 */

import type { SportKey } from './SportRegistry';

export interface StatFieldDef {
  key: string;
  label: string;        // "Goals"
  shortLabel: string;   // "G" — used in compact chips/summaries
  min?: number;
  max?: number;
}

export interface SportStatSchema {
  sport_key: SportKey;
  /** Noun for one entry: "Game", "Match" */
  activityNoun: string;
  /** Label for the opposition input: "Opponent", vs etc. */
  opponentLabel: string;
  /** Stat fields shown in the composer and rendered in cards, in order. */
  fields: StatFieldDef[];
  /**
   * Derived headline for a single stat line, e.g. "2 G • 1 A" — used in
   * feed cards and media tiles. Returns null when no stats were entered.
   */
  headline: (stats: Record<string, number>) => string | null;
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
    headline: stats => {
      // Hockey convention: always show G + A when either present
      const g = stats.goals ?? 0;
      const a = stats.assists ?? 0;
      if (g > 0 || a > 0) return `${g} G • ${a} A`;
      return compactLine(stats, STAT_SCHEMAS.ice_hockey!.fields);
    },
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
    headline: stats => compactLine(stats, STAT_SCHEMAS.volleyball!.fields),
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
