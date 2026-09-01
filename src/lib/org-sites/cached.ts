import { unstable_cache } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/auth-server';
import type { OrgSide } from '@/lib/orgs/authz';
import { fetchPublicStandings, type PublicStandingsPayload } from '@/lib/competitions/public-standings';
import { fetchOrgEvents, type OrgEvent } from '@/lib/calendar/org-events-server';
import { getPublicSiteBySlug, type PublicSite } from './server';
import {
  fetchPublicAffiliations,
  fetchPublicGallery,
  fetchPublicNewsList,
  fetchPublicNewsPost,
  fetchPublicPage,
  fetchPublicPages,
  fetchPublicStaff,
  fetchPublicTeamPage,
  fetchPublicTeams,
  fetchPublicVenues,
  fetchPublishedSitesForSitemap,
  type PublicAffiliation,
  type PublicGalleryItem,
  type PublicNewsItem,
  type PublicNewsPost,
  type PublicPageLink,
  type PublicPageRow,
  type PublicStaffRow,
  type PublicTeam,
  type PublicTeamPage,
  type PublicVenue,
  type SitemapSiteEntry,
} from './public-data';

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
export const getCachedSitemapSites = (): Promise<SitemapSiteEntry[]> =>
  unstable_cache(
    () => fetchPublishedSitesForSitemap(getSupabaseAdmin()),
    ['org-sitemap'],
    { tags: ['org-sitemap'], revalidate: 3600 }
  )();

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

export const getCachedNewsList = (slug: string, siteId: string): Promise<PublicNewsItem[]> =>
  perSlug(['org-site-news', slug], slug, () =>
    fetchPublicNewsList(getSupabaseAdmin(), siteId)
  );

// newsSlug varies per slug → it MUST be in the keyParts (the closure trap).
export const getCachedNewsPost = (
  slug: string,
  siteId: string,
  newsSlug: string
): Promise<PublicNewsPost | null> =>
  perSlug(['org-site-news-post', slug, newsSlug], slug, () =>
    fetchPublicNewsPost(getSupabaseAdmin(), siteId, newsSlug)
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
