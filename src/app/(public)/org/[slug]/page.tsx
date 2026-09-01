import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getCachedAffiliations,
  getCachedSchedule,
  getCachedSite,
  getCachedStaff,
  getCachedStandings,
  getCachedTeams,
  getCachedVenues,
} from '@/lib/org-sites/cached';
import { buildOrgJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import SiteHomeBody from './_components/SiteHomeBody';

// ── The site home (phase 3 R2; body shared with the draft preview) ─────────
// The section list itself IS the product surface: enabled modules render
// (empty ones say so quietly), disabled ones don't exist. All data
// arrives through the per-module cached readers — one Promise.all, no
// per-component fetching. The markup lives in SiteHomeBody so the
// token-gated preview renders the exact same page from raw reads.

export const revalidate = 300;

// The App Router ISR rule: a dynamic segment is only ISR-ELIGIBLE when
// generateStaticParams exists — an empty list prerenders nothing at
// build (no build-time DB/service-key needed) while making every
// runtime-rendered slug cacheable under `revalidate`. Without this the
// route is plain on-demand SSR and x-vercel-cache never leaves MISS
// (measured on prod, Sep 1).
export function generateStaticParams(): { slug: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return { title: 'Not found' };
  const title = site.orgName;
  const description = `${site.orgName} on Edge Athlete — schedule, standings, and teams.`;
  // Relative canonical — the (public) layout's metadataBase resolves it,
  // so the canonical domain is an env decision, never a code one.
  const canonical = `/org/${site.subdomain}`;
  return {
    title,
    description,
    alternates: { canonical },
    // The card is an EXPLICIT route (/org/{slug}/card.png), not the
    // opengraph-image convention file — the convention hash-suffixes its
    // URL under a route group; explicit images are deterministic and
    // probe-able.
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`/org/${site.subdomain}/card.png`] },
  };
}

export default async function OrgSiteHome({ params }: PageParams) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();

  const has = (key: string) => site.modules.some(m => m.module_key === key && m.enabled);
  const { side, orgId } = site;

  const [standings, events, teams, staff, venues, affiliations] = await Promise.all([
    has('standings') ? getCachedStandings(slug, side, orgId) : Promise.resolve(null),
    has('schedule') ? getCachedSchedule(slug, side, orgId) : Promise.resolve(null),
    has('teams') ? getCachedTeams(slug, side, orgId) : Promise.resolve([]),
    has('staff') ? getCachedStaff(slug, side, orgId) : Promise.resolve([]),
    has('venues') ? getCachedVenues(slug, side, orgId) : Promise.resolve([]),
    has('affiliations') ? getCachedAffiliations(slug, side, orgId) : Promise.resolve([]),
  ]);

  return (
    <>
      {/* R4: SportsOrganization structured data — safeJsonLd escapes `<`
          (org names are user text), and NO people ever appear here. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(buildOrgJsonLd(site)) }}
      />
      <SiteHomeBody
        site={site}
        data={{ standings, events, teams, staff, venues, affiliations }}
      />
    </>
  );
}
