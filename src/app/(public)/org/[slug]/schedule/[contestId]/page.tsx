import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../../_components/MembersOnlyPage';
import { getCachedContest, getCachedSite } from '@/lib/org-sites/cached';
import { buildContestJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { requireSiteModule } from '../../_components/require-module';
import { appBaseUrl, siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';
import { playerHref } from '@/lib/org-sites/player-links';
import { contestTitle } from '@/lib/competitions/contest-format';
import ContestPage from '@/components/contests/ContestPage';

// ── /org/[slug]/schedule/[contestId] — the contest's org-site twin (E4) ───
// The same props-only body the in-app /event/[contestId] renders, under
// the site's chrome and rules: server component, ISR (revalidate +
// generateStaticParams), viewer-independent (getCachedContest calls the
// E1 reader with NO viewer, so only a PUBLIC competition of this org ever
// answers), names already masked by the reader, media consent-gated,
// JSON-LD with the org and the place only. Nested under the schedule
// module — it is the schedule's detail, not a new module key — so the
// module toggle and the members-only panel gate it like the schedule.
// A foreign contest id under this slug 404s indistinguishably.

export const revalidate = 300;

export function generateStaticParams(): { slug: string; contestId: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string; contestId: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug, contestId } = await params;
  const site = await getCachedSite(slug);
  if (!site || !UUID_RE.test(contestId)) return { title: 'Not found' };
  const view = await getCachedContest(slug, site.side, site.orgId, contestId);
  if (!view) return { title: 'Not found' };
  const title = `${contestTitle(view)} — ${site.orgName}`;
  const description = `${view.competition.name} at ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/schedule/${contestId}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteContestPage({ params }: PageParams) {
  const { slug, contestId } = await params;
  const site = await requireSiteModule(slug, 'schedule');
  if (isMembersOnly(site, 'schedule')) return <MembersOnlyPage site={site} title={'Event'} what={'An event’s page'} />;
  if (!UUID_RE.test(contestId)) notFound();
  const view = await getCachedContest(slug, site.side, site.orgId, contestId);
  if (!view) notFound();

  const base = siteBasePath(site);
  const jsonLd = buildContestJsonLd(site, view);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      )}
      <ContestPage
        view={view}
        access="public"
        links={{
          org: base || '/',
          standings: `${base}/standings`,
          player: handle => playerHref(handle, base),
          // The live round lives in the app (its scorer needs a session).
          live: groupPostId => `${appBaseUrl()}/live/${groupPostId}`,
        }}
      />
    </div>
  );
}
