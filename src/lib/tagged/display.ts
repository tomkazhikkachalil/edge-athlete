/**
 * Pure display helpers for the Tagged tab. The summary shape comes from
 * /api/profile/[id]/tagged-summary (all-time, viewer-scoped) — these turn
 * it into the tab's real-data filter options.
 */

import { SPORT_NAMES } from '@/lib/config/sports-config';

export interface TaggedSummary {
  timesTagged: number;
  taggerCount: number;
  sportKeys: string[];
  years: number[];
}

export const EMPTY_TAGGED_SUMMARY: TaggedSummary = {
  timesTagged: 0,
  taggerCount: 0,
  sportKeys: [],
  years: [],
};

/** Sport filter options from the sports the athlete is ACTUALLY tagged in,
 *  labeled and name-sorted. */
export function taggedSportOptions(sportKeys: string[]): Array<{ value: string; label: string }> {
  return [...new Set(sportKeys)]
    .map(key => ({ value: key, label: SPORT_NAMES[key] ?? key }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Year filter options, newest first. */
export function taggedYearOptions(years: number[]): number[] {
  return [...new Set(years)].sort((a, b) => b - a);
}
