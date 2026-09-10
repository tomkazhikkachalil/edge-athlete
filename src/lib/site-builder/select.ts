/**
 * The per-instance selector — Site Builder phase 9 (Sep 9 2026).
 *
 * "A widget holds a QUERY, never data." Every module read is org-wide and
 * id-bearing (competitions carry ids, events their venue, boards and golf
 * rounds their competition), so an instance's query is a render-side PICK
 * on the bag the home already resolved — N standings tiles still cost one
 * read, and nothing here touches the cache. `selectForInstance` returns a
 * narrowed copy of the bag; the renderer (WidgetBody) and the empty rule
 * (isWidgetEmpty) both call it FIRST, so a second table bound to a
 * competition with no rows disappears publicly like any empty widget.
 *
 * A layout without queries selects exactly what the page showed before:
 * the first competition with results, five events, three posts, twelve
 * teams, eight members (pinned by select.test.ts). Client-safe, no zod.
 *
 * Deferred, on purpose: a per-instance READ (a schedule for one TEAM needs
 * `team_id` on the events read; leaders by season; news by tag) — when a
 * query cannot be satisfied from the org-wide bag, `dataKey` in
 * widget-data.ts serialises `config.query` into the cache key and the
 * resolver grows a per-instance slice; callers of this function stay as
 * they are.
 */

import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { instanceQuery } from './config';
import type { WidgetInstance } from './layout';

/** Mirrors SCHEDULE_CACHE_LIMIT (cached.ts) — the most events the org-wide
 *  read ever holds, so a larger limit could never show more. */
/** B5: renamed from SCHEDULE_LIMIT_MAX — validate.ts owns a different constant of that name (the API's schedule page size, 50). */
export const SCHEDULE_QUERY_LIMIT_MAX = 25;

export const QUERY_DEFAULTS = {
  scheduleLimit: 5,
  newsLimit: 3,
  teamsLimit: 12,
  membersLimit: 8,
} as const;

export const QUERY_LIMITS: Record<'schedule' | 'news' | 'teams' | 'members', { min: number; max: number; default: number }> = {
  schedule: { min: 1, max: SCHEDULE_QUERY_LIMIT_MAX, default: QUERY_DEFAULTS.scheduleLimit },
  news: { min: 1, max: 12, default: QUERY_DEFAULTS.newsLimit },
  teams: { min: 1, max: 50, default: QUERY_DEFAULTS.teamsLimit },
  members: { min: 1, max: 50, default: QUERY_DEFAULTS.membersLimit },
};

function clampLimit(value: number | undefined, key: keyof typeof QUERY_LIMITS): number {
  const { min, max, default: dflt } = QUERY_LIMITS[key];
  if (value === undefined) return dflt;
  return Math.min(max, Math.max(min, value));
}

/** The bag narrowed to what THIS instance shows. */
export function selectForInstance(w: WidgetInstance, data: SiteHomeData): SiteHomeData {
  const q = instanceQuery(w);
  switch (w.key) {
    case 'standings': {
      if (!data.standings) return data;
      const comps = data.standings.competitions;
      // Bound to one competition: that one (gone → nothing). Automatic: the
      // first with results — today's StandingsPreview rule, made explicit.
      const chosen = q.competitionId
        ? comps.filter(c => c.id === q.competitionId)
        : comps.filter(c => c.rows.length > 0 || c.golf).slice(0, 1);
      return { ...data, standings: { ...data.standings, competitions: chosen } };
    }
    case 'schedule': {
      const limit = clampLimit(q.limit, 'schedule');
      const events = data.events
        ? data.events.filter(e => !q.venueId || e.venue_id === q.venueId).slice(0, limit)
        : data.events;
      // A venue narrows EVENTS only — golf rounds carry a course name, not a
      // venue id; a competition narrows the rounds.
      const golfRounds = data.golfRounds
        ? data.golfRounds.filter(r => !q.competitionId || r.competitionId === q.competitionId)
        : data.golfRounds;
      return { ...data, events, golfRounds };
    }
    case 'leaders':
      return q.competitionId ? { ...data, leaders: data.leaders.filter(b => b.competitionId === q.competitionId) } : data;
    case 'news':
      return { ...data, news: data.news ? data.news.slice(0, clampLimit(q.limit, 'news')) : data.news };
    case 'teams':
      return { ...data, teams: data.teams.slice(0, clampLimit(q.limit, 'teams')) };
    default:
      return data;
  }
}

/** The members table shows this many rows (the table slices itself so the
 *  member COUNT line stays honest). */
export function memberLimit(w: WidgetInstance): number {
  return clampLimit(instanceQuery(w).limit, 'members');
}
