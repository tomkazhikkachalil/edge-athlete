/**
 * Golf Sport Adapter - V1 Implementation
 *
 * Provides full functionality for golf:
 * - Highlights from golf aggregates/rounds
 * - Recent rounds activity
 * - Round editing dialogs
 * - Golf-specific post composition
 */

import { BaseSportAdapter, type HighlightTile, type ActivityRow, type ActivityResult, type PostContext } from '../SportAdapter';

interface GolfStatsResponse {
  highlights: Array<{
    label: string;
    value: string | null;
    trend?: string | null;
  }>;
  recentRounds: Array<{
    id: string;
    date: string;
    course: string;
    courseLocation?: string;
    score?: number;
    par?: number;
    gir?: number;
    holes?: number;
    roundType?: string;
    isComplete?: boolean;
  }>;
  totalRounds: number;
  completedRounds: number;
  years?: number[];
}

// One profile view calls getHighlights + getHighlightYears + getRecentActivity
// in quick succession — three identical GETs of the same endpoint. A short-TTL
// module promise-cache collapses them to one request (two when a season is
// selected). Delete-on-reject so a transient failure never sticks.
const STATS_CACHE_TTL_MS = 15_000;
const statsCache = new Map<string, { at: number; promise: Promise<GolfStatsResponse | null> }>();

function fetchGolfStats(profileId: string, season?: string): Promise<GolfStatsResponse | null> {
  const key = `${profileId}|${season ?? ''}`;
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < STATS_CACHE_TTL_MS) return hit.promise;
  const yearParam = season ? `&year=${encodeURIComponent(season)}` : '';
  const promise = fetch(`/api/golf/stats?profileId=${profileId}${yearParam}`, { credentials: 'include' })
    .then(res => (res.ok ? (res.json() as Promise<GolfStatsResponse>) : null))
    .catch(() => {
      statsCache.delete(key);
      return null;
    });
  statsCache.set(key, { at: Date.now(), promise });
  return promise;
}

export class GolfAdapter extends BaseSportAdapter {
  constructor() {
    super('golf');
  }

  async getHighlights(profileId: string, season?: string): Promise<HighlightTile[]> {
    try {
      // Season = calendar year filter; deduped via the shared stats fetch.
      const data = await fetchGolfStats(profileId, season);
      if (!data) {
        // Fall back to empty tiles on error
        return this.getEmptyHighlights();
      }

      // Map API response to HighlightTile format
      return data.highlights.map(h => ({
        label: h.label,
        value: h.value ?? '—',
        trend: h.trend as 'up' | 'down' | 'neutral' | undefined
      }));

    } catch {
      // Return empty tiles on error
      return this.getEmptyHighlights();
    }
  }

  async getHighlightYears(profileId: string): Promise<number[]> {
    try {
      const data = await fetchGolfStats(profileId);
      return data?.years ?? [];
    } catch {
      return [];
    }
  }

  private getEmptyHighlights(): HighlightTile[] {
    return [
      { label: 'Last 5 Avg', value: '—' },
      { label: 'Best 18', value: '—' },
      { label: 'FIR%', value: '—' },
      { label: 'GIR%', value: '—' },
      { label: 'Putts/Round', value: '—' },
      { label: 'Rounds', value: '—' }
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRecentActivity(profileId: string, limit = 10, _cursor?: string): Promise<ActivityResult> {
    try {
      // Deduped via the shared stats fetch.
      const data = await fetchGolfStats(profileId);
      if (!data) {
        return { rows: [], hasMore: false };
      }

      // Format rounds for activity display
      const rows: ActivityRow[] = data.recentRounds.slice(0, limit).map(round => {
        // Format date
        const dateStr = new Date(round.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

        // Format score with par comparison
        let scoreDisplay = round.score?.toString() || '—';
        if (round.score && round.par) {
          const diff = round.score - round.par;
          if (diff === 0) scoreDisplay = `${round.score} (E)`;
          else if (diff > 0) scoreDisplay = `${round.score} (+${diff})`;
          else scoreDisplay = `${round.score} (${diff})`;
        }

        // Format GIR
        const girDisplay = round.gir !== undefined && round.gir !== null
          ? `${Math.round(round.gir)}%`
          : '—';

        return {
          id: round.id,
          col1: dateStr,
          col2: round.course || 'Unknown Course',
          col3: scoreDisplay,
          col4: girDisplay,
          col5: round.roundType === 'indoor' ? 'Indoor' : '',
          canEdit: true,
          canDelete: true
        };
      });

      return {
        rows,
        hasMore: data.recentRounds.length > limit,
        nextCursor: data.recentRounds.length > limit ? 'cursor-next' : undefined
      };

    } catch {
      return {
        rows: [],
        hasMore: false
      };
    }
  }

  async openEditDialog(entityId?: string): Promise<void> {
    try {
      if (entityId) {
        // Opening golf round editor for existing round
        // Navigation/modal handled by component that calls this
      } else {
        // Opening new golf round dialog
        // Navigation/modal handled by component that calls this
      }

      // Simulate successful dialog interaction
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (err) {
      throw err;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async composePost(_context: PostContext): Promise<void> {
    try {
      // Golf post composer is handled by CreatePostModal component
      // This method exists for interface compliance
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      throw err;
    }
  }

  isEnabled(): boolean {
    return super.isEnabled();
  }

  // Golf owns its dedicated pages — the adapter is where they're declared,
  // so shared components never hardcode a sport's routes.
  getNavLinks(): { href: string; label: string }[] {
    return [
      { href: '/app/sport/golf/rounds', label: 'View all rounds →' },
      { href: '/app/sport/golf/trends', label: 'Trends →' },
    ];
  }

  getActivityHref(activityId: string): string | null {
    return `/app/sport/golf/rounds/${activityId}`;
  }

  /**
   * Format golf score for display
   * Handles par display (+2, E, -1) and stroke totals
   */
  formatGolfScore(strokes: number, par: number = 72): string {
    const scoreToPar = strokes - par;

    if (scoreToPar === 0) return `${strokes} (E)`;
    if (scoreToPar > 0) return `${strokes} (+${scoreToPar})`;
    return `${strokes} (${scoreToPar})`;
  }
}
