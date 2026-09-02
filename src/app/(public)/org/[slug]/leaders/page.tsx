import type { Metadata } from 'next';
import { getCachedLeaders, getCachedSite } from '@/lib/org-sites/cached';
import LeadersTable from '../_components/LeadersTable';
import { requireSiteModule } from '../_components/require-module';
import { siteBasePath, siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/leaders — the Stat leaders subpage (phase 6b B3) ──
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
  const title = `${site.orgName} Stat leaders`;
  const description = `Stat leaders at ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/leaders`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteLeadersTablePage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'leaders');
  const items = await getCachedLeaders(slug, site.side, site.orgId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Stat leaders</h1>
      {items.length === 0 ? (
        <p className="text-sm text-tertiary">No stats recorded yet.</p>
      ) : (
        <LeadersTable boards={items} basePath={siteBasePath(site)} detailed />
      )}
    </div>
  );
}
