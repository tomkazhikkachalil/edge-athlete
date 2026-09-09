import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchOrgEvents } from '@/lib/calendar/org-events-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import { fetchPublicCourseStats } from '@/lib/org-sites/course-stats';
import { fetchPublicMemberStats } from '@/lib/org-sites/member-stats';
import { leadersFromMemberStats } from '@/lib/org-sites/member-leaders';
import {
  fetchPublicAffiliations,
  fetchPublicClubGolfBoards,
  fetchPublicCourses,
  fetchPublicDivisions,
  fetchPublicGolfRounds,
  fetchPublicNewsList,
  fetchPublicOpenWindows,
  fetchPublicStaff,
  fetchPublicStatLeaders,
  fetchPublicTeams,
  fetchPublicVenues,
} from '@/lib/org-sites/public-data';
import {
  SCHEDULE_CACHE_LIMIT,
  getCachedAffiliations,
  getCachedClubCourseStrip,
  getCachedClubGolfBoards,
  getCachedCourses,
  getCachedDivisions,
  getCachedGolfRounds,
  getCachedLeaders,
  getCachedMemberStats,
  getCachedNewsList,
  getCachedOpenWindows,
  getCachedSchedule,
  getCachedStaff,
  getCachedStandings,
  getCachedTeams,
  getCachedVenues,
} from '@/lib/org-sites/cached';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import type { SiteHomeDataKey, WidgetKey } from '@/lib/site-builder/catalog';
import { needsData, type SiteLayout } from '@/lib/site-builder/layout';

/**
 * The one data resolver — Site Builder P3-A (Sep 9 2026).
 *
 * A widget holds a QUERY, never data. This module is where the queries live:
 * given a site, a layout and a reader set, `resolveHomeData` runs exactly
 * the readers the layout's widgets consume (the catalog's `data` fields,
 * gated by `needsData`) and returns the bag the renderer takes. Two reader
 * sets share the gating: `cachedSiteReaders` (the ISR home — `unstable_cache`
 * per slug, tagged `org-site:{slug}`) and `rawSiteReaders` (the draft
 * preview — every hit re-reads). Before this the home and the preview each
 * carried their own `Promise.all` of the same fifteen reads, gated by hand,
 * and had drifted (the preview never fetched memberStats and lacked the
 * cached leaders' golf fallback). Phase 3's editor canvas is the third
 * caller: `GET …/site/canvas` resolves the DRAFT layout with the raw set.
 *
 * `dataKey(key, config)` names the part of a widget's config that changes
 * its DATA (a competition id, a limit) — the cache key of a per-instance
 * read. No widget has such config yet, so it is '' for every key; the
 * per-instance readers arrive with the grid (phase 3) and must put it in
 * their `unstable_cache` keyParts (the cached.ts closure trap).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

type Side = PublicSite['side'];

/** One reader per SiteHomeData field. A field's reader runs only when a
 *  widget on the layout consumes it; club-only readers are skipped on a
 *  league regardless (the fields stay at their empty defaults). */
export interface SiteReaders {
  standings: () => Promise<SiteHomeData['standings']>;
  events: () => Promise<SiteHomeData['events']>;
  teams: () => Promise<SiteHomeData['teams']>;
  staff: () => Promise<SiteHomeData['staff']>;
  venues: () => Promise<SiteHomeData['venues']>;
  affiliations: () => Promise<SiteHomeData['affiliations']>;
  openWindows: () => Promise<SiteHomeData['openWindows']>;
  courses: () => Promise<SiteHomeData['courses']>;
  divisions: () => Promise<SiteHomeData['divisions']>;
  leaders: () => Promise<SiteHomeData['leaders']>;
  /** Club-only. */
  clubGolfBoards: () => Promise<NonNullable<SiteHomeData['clubGolfBoards']>>;
  /** Club-only; the cached set derives the course ids itself, the raw set
   *  is handed the courses already read (one read, not two). */
  courseStrip: (courses: SiteHomeData['courses']) => Promise<SiteHomeData['courseStrip']>;
  golfRounds: () => Promise<NonNullable<SiteHomeData['golfRounds']>>;
  news: () => Promise<NonNullable<SiteHomeData['news']>>;
  memberStats: () => Promise<SiteHomeData['memberStats']>;
}

const EMPTY: SiteHomeData = {
  standings: null,
  events: null,
  teams: [],
  staff: [],
  venues: [],
  affiliations: [],
  openWindows: [],
  courses: [],
  divisions: [],
  leaders: [],
  clubGolfBoards: [],
  courseStrip: null,
  golfRounds: [],
  news: [],
  memberStats: null,
};

/** The published home's readers: the per-slug ISR cache. */
export function cachedSiteReaders(slug: string, site: PublicSite): SiteReaders {
  const { side, orgId } = site;
  return {
    standings: () => getCachedStandings(slug, side, orgId),
    events: () => getCachedSchedule(slug, side, orgId),
    teams: () => getCachedTeams(slug, side, orgId),
    staff: () => getCachedStaff(slug, side, orgId),
    venues: () => getCachedVenues(slug, side, orgId),
    affiliations: () => getCachedAffiliations(slug, side, orgId),
    openWindows: () => getCachedOpenWindows(slug, side, orgId),
    courses: () => getCachedCourses(slug, side, orgId),
    divisions: () => getCachedDivisions(slug, side, orgId),
    leaders: () => getCachedLeaders(slug, side, orgId, site.sportKey),
    clubGolfBoards: () => getCachedClubGolfBoards(slug, orgId),
    courseStrip: () => getCachedClubCourseStrip(slug, side, orgId),
    golfRounds: () => getCachedGolfRounds(slug, side, orgId),
    news: () => getCachedNewsList(slug, site.id, site.visibility === 'private'),
    memberStats: () => getCachedMemberStats(slug, side, orgId),
  };
}

/** The preview's readers: raw, every hit. Same semantics as the cached set
 *  — including the leaders' golf fallback (a golf org with no competition
 *  still has leaders from its members' rounds) and the members table. */
export function rawSiteReaders(admin: Admin, site: PublicSite): SiteReaders {
  const { side, orgId } = site;
  return {
    standings: () => fetchPublicStandings(admin, side, orgId),
    events: () => fetchOrgEvents(admin, side, orgId, { limit: SCHEDULE_CACHE_LIMIT }),
    teams: () => fetchPublicTeams(admin, side, orgId),
    staff: () => fetchPublicStaff(admin, side, orgId),
    venues: () => fetchPublicVenues(admin, side, orgId),
    affiliations: () => fetchPublicAffiliations(admin, side, orgId),
    openWindows: () => fetchPublicOpenWindows(admin, side, orgId),
    courses: () => fetchPublicCourses(admin, side, orgId),
    divisions: () => fetchPublicDivisions(admin, side, orgId),
    leaders: async () => {
      const boards = await fetchPublicStatLeaders(admin, side, orgId);
      if (boards.length > 0 || site.sportKey !== 'golf') return boards;
      return leadersFromMemberStats(await fetchPublicMemberStats(admin, side, orgId));
    },
    clubGolfBoards: () => fetchPublicClubGolfBoards(admin, orgId),
    courseStrip: courses =>
      fetchPublicCourseStats(admin, side, orgId, [...new Set(courses.map(c => c.course.id))]),
    golfRounds: () => fetchPublicGolfRounds(admin, side, orgId),
    news: () => fetchPublicNewsList(admin, site.id, { publicOnly: site.visibility === 'private' }),
    memberStats: () => fetchPublicMemberStats(admin, side, orgId),
  };
}

/** Which readers a layout needs: the catalog's `data` fields of the widgets
 *  on it, club-only fields dropped on a league. Exposed for tests and for
 *  the editor's picker (a widget's cost is its readers). */
export function neededFields(layout: SiteLayout, side: Side): SiteHomeDataKey[] {
  const all: SiteHomeDataKey[] = [
    'standings', 'events', 'teams', 'staff', 'venues', 'affiliations', 'openWindows', 'courses',
    'divisions', 'leaders', 'clubGolfBoards', 'courseStrip', 'golfRounds', 'news', 'memberStats',
  ];
  const clubOnly = new Set<SiteHomeDataKey>(['clubGolfBoards', 'courseStrip']);
  return all.filter(f => needsData(layout, f) && (side === 'club' || !clubOnly.has(f)));
}

/** Run exactly the readers the layout needs, in one round, and return the
 *  home's data bag. Fields no widget consumes keep their empty defaults. */
export async function resolveHomeData(readers: SiteReaders, site: PublicSite, layout: SiteLayout): Promise<SiteHomeData> {
  const need = new Set(neededFields(layout, site.side));
  const run = <K extends keyof SiteHomeData>(field: K & SiteHomeDataKey, read: () => Promise<SiteHomeData[K]>) =>
    need.has(field) ? read() : Promise.resolve(EMPTY[field]);

  const [standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders, clubGolfBoards, golfRounds, news, memberStats] =
    await Promise.all([
      run('standings', readers.standings),
      run('events', readers.events),
      run('teams', readers.teams),
      run('staff', readers.staff),
      run('venues', readers.venues),
      run('affiliations', readers.affiliations),
      run('openWindows', readers.openWindows),
      run('courses', readers.courses),
      run('divisions', readers.divisions),
      run('leaders', readers.leaders),
      run('clubGolfBoards', readers.clubGolfBoards),
      run('golfRounds', readers.golfRounds),
      run('news', readers.news),
      run('memberStats', readers.memberStats),
    ]);
  // S3: the club strip needs the course ids from the read above.
  const courseStrip = need.has('courseStrip') ? await readers.courseStrip(courses) : EMPTY.courseStrip;

  return { standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders, clubGolfBoards, courseStrip, golfRounds, news, memberStats };
}

/** The data-affecting part of a widget's config, as a cache-key fragment.
 *  Empty today (no widget has data-affecting config yet); a per-instance
 *  cached read MUST include it in its keyParts. */
export function dataKey(key: WidgetKey, config: unknown): string {
  void key;
  void config;
  return '';
}
