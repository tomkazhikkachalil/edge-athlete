import type { Metadata } from 'next';
import { getCachedSite, getCachedStandings } from '@/lib/org-sites/cached';
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
import { requireSiteModule } from '../_components/require-module';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';

// ── /org/[slug]/standings — the full standings subpage (phase 3 R2) ────────
// Every competition with rows, full column engine. Module disabled →
// notFound (disabled modules don't exist).

export const revalidate = 300;

// The ISR-eligibility rule (see the home page): every page under the
// dynamic segment needs its own generateStaticParams or it silently
// becomes plain SSR.
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
  const title = `${site.orgName} Standings`;
  const description = `Live standings for ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/standings`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteStandingsPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'standings');
  const payload = await getCachedStandings(slug, site.side, site.orgId);
  // W1: a golf league with an open window (no completed round yet) has a
  // week to show before it has rows.
  const withRows = payload?.competitions.filter(c => c.rows.length > 0 || c.golf) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">
        {moduleLabel('standings', parseNavConfig(site.nav_config), site.side, site.sportKey)}
      </h1>
      {withRows.length === 0 ? (
        <p className="text-sm text-tertiary">No published standings yet.</p>
      ) : (
        withRows.map(comp => <PublicStandingsTable key={comp.id} competition={comp} basePath={siteBasePath(site)} />)
      )}
    </div>
  );
}
