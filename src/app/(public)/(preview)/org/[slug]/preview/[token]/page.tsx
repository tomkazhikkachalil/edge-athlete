import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchOrgEvents } from '@/lib/calendar/org-events-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import {
  fetchPublicOpenWindows,
  fetchPublicAffiliations,
  fetchPublicClubGolfBoards,
  fetchPublicCourses,
  fetchPublicDivisions,
  fetchPublicGolfRounds,
  fetchPublicNewsList,
  fetchPublicPages,
  fetchPublicStaff,
  fetchPublicStatLeaders,
  fetchPublicTeams,
  fetchPublicVenues,
} from '@/lib/org-sites/public-data';
import { fetchPublicCourseStats } from '@/lib/org-sites/course-stats';
import { getDraftSiteBySlug } from '@/lib/org-sites/server';
import { verifyPreviewToken } from '@/lib/org-sites/preview-token';
import { deriveLegacyLayout, needsData } from '@/lib/site-builder/layout';
import SiteHomeBody from '@/app/(public)/org/[slug]/_components/SiteHomeBody';
import SiteShell from '@/app/(public)/org/[slug]/_components/SiteShell';

// ── /org/[slug]/preview/[token] — the draft preview ─────────────────────────
// Site Builder P2-B: the preview lives in its OWN route group so it escapes
// the published-only layout — a manager previews the DRAFT (theme, template,
// nav, notice, body) of a site that may not be live at all, inside the same
// SiteShell the published pages use. The one deliberately UNCACHED page in
// the segment: no generateStaticParams, force-dynamic, noindex — every hit
// re-renders from RAW readers so draft edits show instantly. The signed
// short-lived token IS the authorization (minted by the manager-gated
// console API); no session branching happens here, so the segment's
// viewer-independence contract holds. A bad, expired, or cross-site token
// is indistinguishable from a missing page.

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
  // The draft overlaid on the site row (falls back to the rows pre-180 or
  // without a draft); any status — publish is not the gate here, the token is.
  const site = await getDraftSiteBySlug(admin, slug);
  if (!site) notFound();
  const tokenSiteId = verifyPreviewToken(token);
  if (!tokenSiteId || tokenSiteId !== site.id) notFound();

  // P1-C: the same derived layout the live home renders from (the preview
  // has never fetched memberStats — a pre-existing gap, left as is).
  const layout = deriveLegacyLayout(site);
  const need = (field: Parameters<typeof needsData>[1]) => needsData(layout, field);
  const { side, orgId } = site;
  const [standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders, clubGolfBoards, golfRounds, news, pages] =
    await Promise.all([
    need('standings') ? fetchPublicStandings(admin, side, orgId) : Promise.resolve(null),
    need('events') ? fetchOrgEvents(admin, side, orgId, { limit: 25 }) : Promise.resolve(null),
    need('teams') ? fetchPublicTeams(admin, side, orgId) : Promise.resolve([]),
    need('staff') ? fetchPublicStaff(admin, side, orgId) : Promise.resolve([]),
    need('venues') ? fetchPublicVenues(admin, side, orgId) : Promise.resolve([]),
    need('affiliations') ? fetchPublicAffiliations(admin, side, orgId) : Promise.resolve([]),
    need('openWindows') ? fetchPublicOpenWindows(admin, side, orgId) : Promise.resolve([]),
    need('courses') ? fetchPublicCourses(admin, side, orgId) : Promise.resolve([]),
    need('divisions') ? fetchPublicDivisions(admin, side, orgId) : Promise.resolve([]),
    need('leaders') ? fetchPublicStatLeaders(admin, side, orgId) : Promise.resolve([]),
    need('clubGolfBoards') && side === 'club' ? fetchPublicClubGolfBoards(admin, orgId) : Promise.resolve([]),
    need('golfRounds') ? fetchPublicGolfRounds(admin, side, orgId) : Promise.resolve([]),
    need('news') ? fetchPublicNewsList(admin, site.id, { publicOnly: site.visibility === 'private' }) : Promise.resolve([]),
    fetchPublicPages(admin, site.id),
  ]);
  // S3: the club strip (needs the course ids from the read above).
  const courseStrip =
    need('courseStrip') && side === 'club'
      ? await fetchPublicCourseStats(admin, side, orgId, [...new Set(courses.map(c => c.course.id))])
      : null;

  return (
    <SiteShell site={site} pages={pages}>
      <div className="bg-amber-100 border-b border-amber-300">
        <p className="max-w-4xl mx-auto px-4 py-2 text-sm font-medium text-amber-900">
          Draft preview — not public. This link expires; publish from the console
          to go live.
        </p>
      </div>
      <SiteHomeBody
        site={site}
        layout={layout}
        data={{ standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders, clubGolfBoards, courseStrip, golfRounds, news }}
      />
    </SiteShell>
  );
}
