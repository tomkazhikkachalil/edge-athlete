import type { Metadata } from 'next';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../_components/MembersOnlyPage';
import { getCachedDivisions, getCachedSite } from '@/lib/org-sites/cached';
import DivisionsList from '../_components/DivisionsList';
import { requireSiteModule } from '../_components/require-module';
import { siteBasePath, siteAbsoluteUrl } from '@/lib/org-sites/urls';

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
  const canonical = `${siteAbsoluteUrl(site)}/divisions`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteDivisionsListPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'divisions');
  // Phase 9 V4: a private club renders the members-only panel here.
  if (isMembersOnly(site, 'divisions')) return <MembersOnlyPage site={site} title={moduleLabel('divisions', parseNavConfig(site.nav_config), site.side, site.sportKey)} what={'The divisions'} />;
  const items = await getCachedDivisions(slug, site.side, site.orgId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Divisions</h1>
      {items.length === 0 ? (
        <p className="text-sm text-tertiary">No divisions this season.</p>
      ) : (
        <DivisionsList divisions={items} basePath={siteBasePath(site)} detailed />
      )}
    </div>
  );
}
