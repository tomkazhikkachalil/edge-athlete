import { notFound } from 'next/navigation';
import { getCachedNewsBanner, getCachedNotices, getCachedPages, getCachedSite, getCachedSitemapSites, getCachedTeams } from '@/lib/org-sites/cached';
import { utcToday } from '@/lib/competitions/golf-weeks';
import { navTeamsVisible } from '@/lib/org-sites/private';
import { siteHead } from '@/lib/org-sites/metadata';
import type { Metadata } from 'next';
import SiteShell from './_components/SiteShell';

// ── /org/[slug] — the published site's layout (phase 3 R1, nav in R2) ───────
// Published sites only (draft = 404, the publish gate). The fetch is
// unstable_cache'd per slug with the `org-site:{slug}` tag — the console's
// publish writes revalidateTag it — plus the 300s baseline, so these
// documents are ISR: rendered once, CDN-served, refreshed on demand.
// Viewer-independent by construction (the standings contract). The markup
// lives in SiteShell (Site Builder P2-B) so the draft preview — its own
// route group, outside this published-only gate — renders the same shell
// around the draft.

export const revalidate = 300;

/** How many published sites the build renders ahead of time; the rest render
 *  on their first visit as before (`dynamicParams` stays on). */
export const PREBUILT_SITES_MAX = 20;

// Performance program (Nov 2026): the PUBLISHED sites are built WITH the
// deploy, so their first visitor after a deploy gets the CDN's copy instead
// of a cold function render — every deploy used to start every org page from
// nothing (the pages' own generateStaticParams return [] and keep doing so;
// a child's empty list adds no params and the layout's slugs flow down). A
// build that cannot reach the database (CI's placeholder keys, a local build
// without .env.local) renders nothing ahead, exactly as before.
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const sites = await getCachedSitemapSites();
    return sites
      .filter((site) => !site.customDomain)
      .slice(0, PREBUILT_SITES_MAX)
      .map((site) => ({ slug: site.subdomain }));
  } catch {
    return [];
  }
}

/** Phase 6b B1: the per-site favicon — the uploaded logo when there is
 *  one (the tokenless streamer), else the generated /favicon.svg. Pages
 *  merge their own title/canonical over this; none of them sets icons. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return {};
  // Program 2, C: the chosen icon token, else the logo, else the generated favicon (ONE rule, metadata.ts).
  const icon = siteHead(site).icon;
  // Onboarding v2 R1 (179): an unlisted or pending site serves by link but
  // is never indexed — the layout's robots applies to every subpage.
  return { icons: { icon }, ...(site.listed ? {} : { robots: { index: false, follow: false } }) };
}

export default async function OrgSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();
  // R3: public custom pages join the nav after the module links. P0-2: the
  // announcements sent "on the site until …" feed the notice band.
  // L1: the header's Teams dropdown — only when the teams page is public.
  // A1: a live news post can lead the notice band ("show as a site banner").
  const [pages, notices, navTeams, newsBanner] = await Promise.all([
    getCachedPages(slug, site.id),
    getCachedNotices(slug, site.side, site.orgId, site.orgName),
    navTeamsVisible(site) ? getCachedTeams(slug, site.side, site.orgId) : Promise.resolve([]),
    getCachedNewsBanner(slug, site.id, utcToday(), site.visibility === 'private'),
  ]);
  return (
    <SiteShell site={site} pages={pages} notices={notices} navTeams={navTeams} newsBanner={newsBanner}>
      {children}
    </SiteShell>
  );
}
