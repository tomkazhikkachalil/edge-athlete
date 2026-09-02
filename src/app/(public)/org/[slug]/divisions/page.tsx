import type { Metadata } from 'next';
import { getCachedDivisions, getCachedSite } from '@/lib/org-sites/cached';
import DivisionsList from '../_components/DivisionsList';
import { requireSiteModule } from '../_components/require-module';
import { orgSitePath } from '@/lib/org-sites/urls';

// ── /org/[slug]/divisions — the Divisions subpage (phase 6b B3) ──
// Module disabled → notFound (disabled modules don't exist).

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
  const title = `${site.orgName} Divisions`;
  const description = `Divisions and teams at ${site.orgName} on Edge Athlete.`;
  const canonical = `${orgSitePath(site.subdomain)}/divisions`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${orgSitePath(site.subdomain)}/card.png`] },
  };
}

export default async function OrgSiteDivisionsListPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'divisions');
  const items = await getCachedDivisions(slug, site.side, site.orgId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Divisions</h1>
      {items.length === 0 ? (
        <p className="text-sm text-tertiary">No divisions this season.</p>
      ) : (
        <DivisionsList divisions={items} basePath={orgSitePath(site.subdomain)} detailed />
      )}
    </div>
  );
}
