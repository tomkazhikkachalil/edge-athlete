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
}

export class StatLinePostAdapter extends BaseSportAdapter {
  constructor(sportKey: SportKey) {
    super(sportKey);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getHighlights(profileId: string, _season?: string): Promise<HighlightTile[]> {
    try {
      const response = await fetch(
        `/api/sports/stat-lines?profileId=${encodeURIComponent(profileId)}&sport=${this.sportKey}`,
        { credentials: 'include' }
      );
      if (!response.ok) return super.getHighlights(profileId);

      const data: StatLinesResponse = await response.json();
      return data.highlights.map(h => ({ label: h.label, value: h.value }));
    } catch {
      return super.getHighlights(profileId);
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
