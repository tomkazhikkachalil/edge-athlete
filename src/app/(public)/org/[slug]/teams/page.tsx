import type { Metadata } from 'next';
import { getCachedSite, getCachedTeams } from '@/lib/org-sites/cached';
import TeamsList from '../_components/TeamsList';
import { requireSiteModule } from '../_components/require-module';
import { orgSitePath } from '@/lib/org-sites/urls';

// ── /org/[slug]/teams — all active teams (phase 3 R2) ──────────────────────
// Names + division/season labels, each linking to the team's own page.
// Module disabled → notFound (which also covers /teams/[teamId]).

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
  const title = `${site.orgName} Teams`;
  const description = `Teams of ${site.orgName} on Edge Athlete.`;
  const canonical = `${orgSitePath(site.subdomain)}/teams`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${orgSitePath(site.subdomain)}/card.png`] },
  };
}

export default async function OrgSiteTeamsPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'teams');
  const teams = await getCachedTeams(slug, site.side, site.orgId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Teams</h1>
      <section
        aria-label="All teams"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        {teams.length > 0 ? (
          <TeamsList teams={teams} slug={site.subdomain} detailed />
        ) : (
          <p className="text-sm text-tertiary">No teams yet.</p>
        )}
      </section>
    </div>
  );
}
