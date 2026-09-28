import type { Metadata } from 'next';
import Link from 'next/link';
import { getCachedOrgGames, getCachedSite } from '@/lib/org-sites/cached';
import { isMembersOnly } from '@/lib/org-sites/private';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';
import TeamScheduleList from '@/components/teams/TeamScheduleList';
import MembersOnlyPage from '../../_components/MembersOnlyPage';
import { requireSiteModule } from '../../_components/require-module';

// ── /org/[slug]/schedule/results — the org's results (sports-team website
// program, G1, Sep 28 2026). Every final game of the org's PUBLIC fixture and
// bracket competitions, newest first, home-first "Comets 2–3 Blazers", each
// linking to its contest page. A static segment beside [contestId] (a static
// segment wins; contest ids are uuids). ISR like every (public) page; a
// private club's results name its teams, so it renders the members-only
// panel (the /teams gate).

export const revalidate = 300;

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
  const title = `${site.orgName} Results`;
  const description = `Scores and results from ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/schedule/results`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteResultsPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'schedule');
  if (isMembersOnly(site, 'teams')) return <MembersOnlyPage site={site} title="Results" what="The results" />;
  const base = siteBasePath(site);
  const games = await getCachedOrgGames(slug, site.side, site.orgId, base);
  const label = moduleLabel('schedule', parseNavConfig(site.nav_config), site.side, site.sportKey);
  return (
    <div className="site-container px-4 py-8 space-y-6" data-site-results="">
      <h1 className="text-2xl font-bold text-primary">Results</h1>
      <nav aria-label={`${label} views`} className="flex gap-4 text-sm font-medium">
        <Link href={`${base}/schedule`} className="text-secondary hover:text-brand-fg">
          Upcoming
        </Link>
        <span aria-current="page" className="text-brand-fg underline underline-offset-4">
          Results
        </span>
      </nav>
      <section aria-label="Results" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
        <TeamScheduleList items={games.results} empty="No results yet." />
      </section>
    </div>
  );
}
