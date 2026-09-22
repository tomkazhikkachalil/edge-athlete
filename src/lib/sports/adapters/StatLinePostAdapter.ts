/**
 * StatLinePostAdapter — generic adapter for sports whose data model is a
 * per-game/per-match stat line stored in posts.stats_data (type='stat_line').
 *
 * One class serves every stat-line sport (ice hockey, volleyball, …) —
 * parameterized by sportKey. Data comes from /api/sports/stat-lines, the
 * sport-agnostic sibling of /api/golf/stats. When a sport's data outgrows a
 * stat line, it graduates to dedicated tables + its own adapter (like golf).
 */

import { BaseSportAdapter, type HighlightTile, type ActivityRow, type ActivityResult } from '../SportAdapter';
import type { SportKey } from '../SportRegistry';
import { getStatSchema } from '../stat-schemas';

interface StatLinesResponse {
  entryCount: number;
  totals: Record<string, number>;
  highlights: Array<{ label: string; value: string | null }>;
  recentActivity: Array<{
    id: string;
    date: string;
    opponent: string;
    result: string;
    keyStat: string;
  }>;
  years?: number[];
}

/** 'game' → 'games', 'match' → 'matches', 'race' → 'races'. */
export const pluralNoun = (noun: string): string => (/(s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`);

export class StatLinePostAdapter extends BaseSportAdapter {
  constructor(sportKey: SportKey) {
    super(sportKey);
  }

  /**
   * Round 4 (Sep 2026): every stat-line sport gets the golfer's two doors —
   * the log (every game, official lines apart) and the trends (the rollups
   * over athlete_performances). Golf keeps its own routes.
   */
  getNavLinks(): { href: string; label: string }[] {
    const noun = getStatSchema(this.sportKey)?.activityNoun.toLowerCase() ?? 'game';
    return [
      { href: `/app/sport/${this.sportKey}/log`, label: `View all ${pluralNoun(noun)} →` },
      { href: `/app/sport/${this.sportKey}/trends`, label: 'Trends →' },
    ];
  }

  async getHighlights(profileId: string, season?: string): Promise<HighlightTile[]> {
    try {
      // season = calendar year filter
      const yearParam = season ? `&year=${encodeURIComponent(season)}` : '';
      const response = await fetch(
        `/api/sports/stat-lines?profileId=${encodeURIComponent(profileId)}&sport=${this.sportKey}${yearParam}`,
        { credentials: 'include' }
      );
      if (!response.ok) return super.getHighlights(profileId);

      const data: StatLinesResponse = await response.json();
      return data.highlights.map(h => ({ label: h.label, value: h.value }));
    } catch {
      return super.getHighlights(profileId);
    }
  }

  async getHighlightYears(profileId: string): Promise<number[]> {
    try {
      const response = await fetch(
        `/api/sports/stat-lines?profileId=${encodeURIComponent(profileId)}&sport=${this.sportKey}`,
        { credentials: 'include' }
      );
      if (!response.ok) return [];
      const data: StatLinesResponse = await response.json();
      return data.years ?? [];
    } catch {
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRecentActivity(profileId: string, limit = 10, _cursor?: string): Promise<ActivityResult> {
    try {
      const response = await fetch(
        `/api/sports/stat-lines?profileId=${encodeURIComponent(profileId)}&sport=${this.sportKey}`,
        { credentials: 'include' }
      );
      if (!response.ok) return { rows: [], hasMore: false };

      const data: StatLinesResponse = await response.json();
      const rows: ActivityRow[] = data.recentActivity.slice(0, limit).map(a => ({
        id: a.id,
        col1: a.date,
        col2: a.opponent,
        col3: a.result,
        col4: a.keyStat,
        canEdit: false,   // stat lines are edited via their post (EditPostModal)
        canDelete: false, // deleting the post removes the stat line
      }));

      return { rows, hasMore: data.recentActivity.length > limit };
    } catch {
      return { rows: [], hasMore: false };
    }
  }
}
