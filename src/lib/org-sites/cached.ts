import { unstable_cache } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/auth-server';
import type { OrgSide } from '@/lib/orgs/authz';
import { fetchPublicStandings, type PublicStandingsPayload } from '@/lib/competitions/public-standings';
import { fetchOrgEvents, type OrgEvent } from '@/lib/calendar/org-events-server';
import { fetchContestView, type ContestView } from '@/lib/competitions/contest-view';
import { getPublicSiteBySlug, type PublicSite } from './server';
import { fetchPublicCourseStats } from './course-stats';
import { buildSiteFeed } from './schedule-feed';
import type { CourseStats } from '@/lib/golf/course-stats';
import {
  fetchPublicAffiliations,
  fetchPublicClubGolfBoards,
  fetchPublicCourses,
  fetchPublicCoursePage,
  fetchPublicDivisions,
  fetchPublicGallery,
  fetchPublicGolfRounds,
  fetchPublicStatLeaders,
  fetchPublicNewsList,
  fetchPublicOpenWindows,
  fetchPublicNewsPost,
  fetchPublicNotices,
  fetchPublicPage,
  fetchPublicPages,
  fetchPublicStaff,
  fetchPublicTeamPage,
  fetchPublicTeams,
  fetchPublicVenues,
  fetchPublishedSitesForSitemap,
  type PublicAffiliation,
  type PublicClubGolfBoard,
  type PublicCourse,
  type PublicCoursePage,
  type PublicDivision,
  type PublicGalleryItem,
  type PublicGolfRound,
  type PublicLeaderBoard,
  type PublicNewsItem,
  type PublicOpenWindow,
  type PublicNewsPost,
  type PublicNotice,
  type PublicPageLink,
  type PublicPageRow,
  type PublicStaffRow,
  type PublicTeam,
  type PublicTeamPage,
  type PublicVenue,
  type SitemapSiteEntry,
  fetchPublicPlayerPage,
  type PublicPlayerPage,
  fetchPublicWeekHub,
  type PublicWeekHub,
  fetchPublicOrgDirectory,
  type DirectoryRegion,
} from './public-data';
import { fetchPublicMemberStats } from '@/lib/org-sites/member-stats';
import { leadersFromMemberStats } from '@/lib/org-sites/member-leaders';
import type { MemberStats } from '@/lib/golf/member-stats';

// The (public) segment's per-slug cached reads: unstable_cache with the
// `org-site:{slug}` tag (console writes revalidateTag it — publish,
// unpublish, and module toggles all purge EVERYTHING for the slug at
// once) + the 300s baseline.
//
// Key discipline (measured trap): unstable_cache does NOT key on
// closed-over variables — every reader gets a distinct first keyPart, and
// any argument that varies for the same slug (teamId) MUST appear in the
// keyParts. side/orgId are 1:1 with slug, so they are safe in closures.
const perSlug = <T>(keyParts: string[], slug: string, fn: () => Promise<T>): Promise<T> =>
  unstable_cache(fn, keyParts, { tags: [`org-site:${slug}`], revalidate: 300 })();

export const getCachedSite = (slug: string): Promise<PublicSite | null> =>
  perSlug(['org-site', slug], slug, () => getPublicSiteBySlug(getSupabaseAdmin(), slug));

export const getCachedStandings = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicStandingsPayload | null> =>
  perSlug(['org-site-standings', slug], slug, () =>
    fetchPublicStandings(getSupabaseAdmin(), side, orgId)
  );

/** One canonical cached schedule entry per slug (limit 25, no range):
 *  home slices the first few, /schedule renders the full list — one
 *  entry, no per-params key variance. */
export const SCHEDULE_CACHE_LIMIT = 25;
export const getCachedSchedule = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<OrgEvent[] | null> =>
  perSlug(['org-site-schedule', slug], slug, () =>
    fetchOrgEvents(getSupabaseAdmin(), side, orgId, { limit: SCHEDULE_CACHE_LIMIT })
  );

/** Contest Place E4: ONE contest's public view for the org-site twin —
 *  the E1 reader with no viewer (viewer-independent by construction), only
 *  when it answers 'public', and only when the contest belongs to THIS
 *  site's org (a foreign id under this slug 404s indistinguishably, the
 *  team-page rule). Tagged org-site:{slug}, so every result / dispute /
 *  publish write already purges it (revalidateOrgSiteForCompetition). */
export const getCachedContest = (
  slug: string,
  side: OrgSide,
  orgId: string,
  contestId: string
): Promise<ContestView | null> =>
  perSlug(['org-site-contest', slug, contestId], slug, async () => {
    const result = await fetchContestView(getSupabaseAdmin(), contestId, { viewerId: null });
    if (!result || result.access !== 'public') return null;
    if (result.view.org.side !== side || result.view.org.id !== orgId) return null;
    return result.view;
  });

export const getCachedTeams = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicTeam[]> =>
  perSlug(['org-site-teams', slug], slug, () =>
    fetchPublicTeams(getSupabaseAdmin(), side, orgId)
  );

export const getCachedStaff = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicStaffRow[]> =>
  perSlug(['org-site-staff', slug], slug, () =>
    fetchPublicStaff(getSupabaseAdmin(), side, orgId)
  );

export const getCachedVenues = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicVenue[]> =>
  perSlug(['org-site-venues', slug], slug, () =>
    fetchPublicVenues(getSupabaseAdmin(), side, orgId)
  );

export const getCachedAffiliations = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicAffiliation[]> =>
  perSlug(['org-site-affiliations', slug], slug, () =>
    fetchPublicAffiliations(getSupabaseAdmin(), side, orgId)
  );

export const getCachedTeamPage = (
  slug: string,
  side: OrgSide,
  orgId: string,
  teamId: string
): Promise<PublicTeamPage | null> =>
  perSlug(['org-site-team', slug, teamId], slug, () =>
    fetchPublicTeamPage(getSupabaseAdmin(), side, orgId, teamId)
  );

/** The sitemap's enumerator — its own tag ('org-sitemap', purged by
 *  publish/unpublish) and a longer window: module/page churn reaching
 *  the sitemap within an hour is accepted (locked scope). */
/** P2: the player page — the handle rides the key (the closure trap). */
export const getCachedPlayerPage = (
  slug: string,
  side: OrgSide,
  orgId: string,
  handle: string
): Promise<PublicPlayerPage | null> =>
  perSlug(['org-site-player', slug, handle], slug, () =>
    fetchPublicPlayerPage(getSupabaseAdmin(), side, orgId, handle)
  );

/** P4: the week hub — one entry per site. */
export const getCachedWeekHub = (slug: string, side: OrgSide, orgId: string): Promise<PublicWeekHub> =>
  perSlug(['org-site-week', slug], slug, () => fetchPublicWeekHub(getSupabaseAdmin(), side, orgId));

/** V6: the club directory — one entry, the sitemap's tag (publish purges). */
export const getCachedClubDirectory = (): Promise<DirectoryRegion[]> =>
  unstable_cache(() => fetchPublicOrgDirectory(getSupabaseAdmin(), 'club'), ['org-club-directory'], {
    tags: ['org-sitemap'],
    revalidate: 3600,
  })();

/** Program 11 L3: the league directory — the same shape and tag. */
export const getCachedLeagueDirectory = (): Promise<DirectoryRegion[]> =>
  unstable_cache(() => fetchPublicOrgDirectory(getSupabaseAdmin(), 'league'), ['org-league-directory'], {
    tags: ['org-sitemap'],
    revalidate: 3600,
  })();

export const getCachedSitemapSites = (): Promise<SitemapSiteEntry[]> =>
  unstable_cache(
    () => fetchPublishedSitesForSitemap(getSupabaseAdmin()),
    ['org-sitemap'],
    { tags: ['org-sitemap'], revalidate: 3600 }
  )();

// Phase 5 R5: the open registration windows for the Register card.
export const getCachedOpenWindows = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicOpenWindow[]> =>
  perSlug(['org-site-open-windows', slug], slug, () =>
    fetchPublicOpenWindows(getSupabaseAdmin(), side, orgId)
  );

// Phase 4 R5: the consent-gated gallery. side/orgId are 1:1 with slug —
// safe in the closure (the keyParts rule).
export const getCachedGallery = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicGalleryItem[]> =>
  perSlug(['org-site-gallery', slug], slug, () =>
    fetchPublicGallery(getSupabaseAdmin(), side, orgId)
  );

// V5: `publicOnly` is the site's visibility — 1:1 with the slug, so safe to
// close over (a flip revalidates the tag).
export const getCachedNewsList = (slug: string, siteId: string, publicOnly = false): Promise<PublicNewsItem[]> =>
  perSlug(['org-site-news', slug], slug, () =>
    fetchPublicNewsList(getSupabaseAdmin(), siteId, { publicOnly })
  );

// newsSlug varies per slug → it MUST be in the keyParts (the closure trap).
export const getCachedNewsPost = (
  slug: string,
  siteId: string,
  newsSlug: string,
  publicOnly = false
): Promise<PublicNewsPost | null> =>
  perSlug(['org-site-news-post', slug, newsSlug], slug, () =>
    fetchPublicNewsPost(getSupabaseAdmin(), siteId, newsSlug, { publicOnly })
  );

// N3: the site's Notices (announcements mirrored to the band); side/orgId/
// orgName are 1:1 with the slug — safe in the closure.
export const getCachedNotices = (slug: string, side: OrgSide, orgId: string, orgName: string): Promise<PublicNotice[]> =>
  perSlug(['org-site-notices', slug], slug, () =>
    fetchPublicNotices(getSupabaseAdmin(), side, orgId, orgName)
  );

export const getCachedPages = (slug: string, siteId: string): Promise<PublicPageLink[]> =>
  perSlug(['org-site-pages', slug], slug, () =>
    fetchPublicPages(getSupabaseAdmin(), siteId)
  );

// pageSlug varies per slug → it MUST be in the keyParts (the closure trap
// above); siteId is 1:1 with slug, safe closed-over.
export const getCachedPage = (
  slug: string,
  siteId: string,
  pageSlug: string
): Promise<PublicPageRow | null> =>
  perSlug(['org-site-page', slug, pageSlug], slug, () =>
    fetchPublicPage(getSupabaseAdmin(), siteId, pageSlug)
  );

// Phase 6b A2: the golf club's linked catalog courses (pure reference
// data; side/orgId are 1:1 with slug — safe in the closure).
export const getCachedCourses = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicCourse[]> =>
  perSlug(['org-site-courses', slug], slug, () =>
    fetchPublicCourses(getSupabaseAdmin(), side, orgId)
  );

// Phase 6e S2: one course page (org-gated; null → 404). keyParts carry
// the course id — the getCachedTeamPage rule.
export const getCachedCoursePage = (
  slug: string,
  side: OrgSide,
  orgId: string,
  courseId: string
): Promise<PublicCoursePage | null> =>
  perSlug(['org-site-course', slug, courseId], slug, () =>
    fetchPublicCoursePage(getSupabaseAdmin(), side, orgId, courseId)
  );

// Phase 6e S3: the course fills itself — stats from members' public
// rounds. courseId varies per slug → in the keyParts; parByHole is
// derived from the course's own catalog rows (1:1 with courseId).
export const getCachedCourseStats = (
  slug: string,
  side: OrgSide,
  orgId: string,
  courseId: string,
  parByHole?: Map<number, number>
): Promise<CourseStats> =>
  perSlug(['org-site-course-stats', slug, courseId], slug, () =>
    fetchPublicCourseStats(getSupabaseAdmin(), side, orgId, [courseId], { parByHole })
  );

/** The club home strip: one read over EVERY linked course (a club's
 *  nines and eighteens together — the record is per (holes, tee) inside). */
export const getCachedClubCourseStrip = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<CourseStats> =>
  perSlug(['org-site-course-strip', slug], slug, async () => {
    const admin = getSupabaseAdmin();
    const courses = await fetchPublicCourses(admin, side, orgId);
    return fetchPublicCourseStats(admin, side, orgId, [...new Set(courses.map(c => c.course.id))]);
  });

// Phase 6e S4: a golf league's play windows on the public schedule, and
// the site's ICS feed (events over a year + the rounds no mirror covers).
export const getCachedGolfRounds = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicGolfRound[]> =>
  perSlug(['org-site-golf-rounds', slug], slug, () =>
    fetchPublicGolfRounds(getSupabaseAdmin(), side, orgId)
  );

export const getCachedScheduleFeed = (
  slug: string,
  side: OrgSide,
  orgId: string,
  name: string
): Promise<string> =>
  perSlug(['org-site-schedule-feed', slug], slug, async () => {
    const admin = getSupabaseAdmin();
    const [events, rounds] = await Promise.all([
      fetchOrgEvents(admin, side, orgId, { limit: 50, rangeDays: 365 }),
      fetchPublicGolfRounds(admin, side, orgId),
    ]);
    return buildSiteFeed({ name, events: events ?? [], rounds, dtstampMs: Date.now() });
  });

// Phase 6b B3: divisions + stat leaders (both viewer-independent reads).
export const getCachedDivisions = (
  slug: string,
  side: OrgSide,
  orgId: string
): Promise<PublicDivision[]> =>
  perSlug(['org-site-divisions', slug], slug, () =>
    fetchPublicDivisions(getSupabaseAdmin(), side, orgId)
  );

export const getCachedLeaders = (
  slug: string,
  side: OrgSide,
  orgId: string,
  sportKey: string | null = null
): Promise<PublicLeaderBoard[]> =>
  perSlug(['org-site-leaders', slug], slug, async () => {
    const admin = getSupabaseAdmin();
    const boards = await fetchPublicStatLeaders(admin, side, orgId);
    // R5: a golf org with no competition yet still has leaders — from its
    // members' posted rounds (the zero-admin page).
    if (boards.length > 0 || sportKey !== 'golf') return boards;
    return leadersFromMemberStats(await fetchPublicMemberStats(admin, side, orgId));
  });

/** R5: the members table — every member, their posted rounds this year. */
export const getCachedMemberStats = (slug: string, side: OrgSide, orgId: string): Promise<MemberStats> =>
  perSlug(['org-site-member-stats', slug], slug, () => fetchPublicMemberStats(getSupabaseAdmin(), side, orgId));

/** C2: one site's sitemap entry, from the same hourly enumeration —
 *  the per-host /sitemap.xml route on a custom domain reads this. */
export const getCachedSiteSitemap = async (slug: string): Promise<SitemapSiteEntry | null> =>
  (await getCachedSitemapSites()).find(s => s.subdomain === slug) ?? null;

// Phase 6c G3: the club's golf boards (its own + affiliated leagues').
export const getCachedClubGolfBoards = (slug: string, clubId: string): Promise<PublicClubGolfBoard[]> =>
  perSlug(['org-site-club-golf', slug], slug, () =>
    fetchPublicClubGolfBoards(getSupabaseAdmin(), clubId)
  );
