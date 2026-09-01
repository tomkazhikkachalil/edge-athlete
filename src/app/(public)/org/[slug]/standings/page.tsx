import type { Metadata } from 'next';
import { getCachedSite, getCachedStandings } from '@/lib/org-sites/cached';
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
import { requireSiteModule } from '../_components/require-module';

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
  return {
    title: `${site.orgName} Standings`,
    description: `Live standings for ${site.orgName} on Edge Athlete.`,
  };
}

export default async function OrgSiteStandingsPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'standings');
  const payload = await getCachedStandings(slug, site.side, site.orgId);
  const withRows = payload?.competitions.filter(c => c.rows.length > 0) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Standings</h1>
      {withRows.length === 0 ? (
        <p className="text-sm text-tertiary">No published standings yet.</p>
      ) : (
        withRows.map(comp => <PublicStandingsTable key={comp.id} competition={comp} />)
      )}
    </div>
  );
}
