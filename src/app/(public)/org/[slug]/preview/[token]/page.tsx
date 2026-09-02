import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchOrgEvents } from '@/lib/calendar/org-events-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import {
  fetchPublicOpenWindows,
  fetchPublicAffiliations,
  fetchPublicCourses,
  fetchPublicStaff,
  fetchPublicTeams,
  fetchPublicVenues,
} from '@/lib/org-sites/public-data';
import { getSiteBySlugAnyStatus } from '@/lib/org-sites/server';
import { verifyPreviewToken } from '@/lib/org-sites/preview-token';
import SiteHomeBody from '../../_components/SiteHomeBody';

// ── /org/[slug]/preview/[token] — the draft preview (cleanup round) ────────
// The one deliberately UNCACHED page in the segment: no
// generateStaticParams, force-dynamic, noindex — every hit re-renders
// from RAW readers so a manager sees draft edits instantly. The signed
// short-lived token IS the authorization (minted by the manager-gated
// console API); no session branching happens here, so the segment's
// viewer-independence contract holds. A bad, expired, or cross-site
// token is indistinguishable from a missing page.

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Draft preview', robots: { index: false, follow: false } };
}

export default async function OrgSitePreview({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const admin = getSupabaseAdmin();
  const site = await getSiteBySlugAnyStatus(admin, slug);
  if (!site) notFound();
  const tokenSiteId = verifyPreviewToken(token);
  if (!tokenSiteId || tokenSiteId !== site.id) notFound();

  const has = (key: string) => site.modules.some(m => m.module_key === key && m.enabled);
  const { side, orgId } = site;
  const [standings, events, teams, staff, venues, affiliations, openWindows, courses] = await Promise.all([
    has('standings') ? fetchPublicStandings(admin, side, orgId) : Promise.resolve(null),
    has('schedule') ? fetchOrgEvents(admin, side, orgId, { limit: 25 }) : Promise.resolve(null),
    has('teams') ? fetchPublicTeams(admin, side, orgId) : Promise.resolve([]),
    has('staff') ? fetchPublicStaff(admin, side, orgId) : Promise.resolve([]),
    has('venues') ? fetchPublicVenues(admin, side, orgId) : Promise.resolve([]),
    has('affiliations') ? fetchPublicAffiliations(admin, side, orgId) : Promise.resolve([]),
    has('register') ? fetchPublicOpenWindows(admin, side, orgId) : Promise.resolve([]),
    has('courses') ? fetchPublicCourses(admin, side, orgId) : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="bg-amber-100 border-b border-amber-300">
        <p className="max-w-4xl mx-auto px-4 py-2 text-sm font-medium text-amber-900">
          Draft preview — not public. This link expires; publish from the console
          to go live.
        </p>
      </div>
      <SiteHomeBody
        site={site}
        data={{ standings, events, teams, staff, venues, affiliations, openWindows, courses }}
      />
    </>
  );
}
