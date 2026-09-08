import type { Metadata } from 'next';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../_components/MembersOnlyPage';
import { getCachedMemberStats, getCachedSite } from '@/lib/org-sites/cached';
import MembersTable from '../_components/MembersTable';
import { requireSiteModule } from '../_components/require-module';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { siteBasePath, siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/members (Onboarding v2 R5) ──────────────────────────────────
// The members table: every member and the rounds they posted this year —
// the zero-admin page. Same contract as the other subpages: ISR + empty
// generateStaticParams, viewer-independent readers, masked names.

export const revalidate = 300;

type PageParams = { params: Promise<{ slug: string }> };

export function generateStaticParams(): { slug: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return { title: 'Not found' };
  const label = moduleLabel('members', parseNavConfig(site.nav_config), site.side, site.sportKey);
  return {
    title: `${label} — ${site.orgName}`,
    alternates: { canonical: `${siteAbsoluteUrl(site)}/members` },
  };
}

export default async function OrgSiteMembersPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'members');
  const label = moduleLabel('members', parseNavConfig(site.nav_config), site.side, site.sportKey);
  if (isMembersOnly(site, 'members')) return <MembersOnlyPage site={site} title={label} what={'The members'} />;
  const stats = await getCachedMemberStats(slug, site.side, site.orgId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">{label}</h1>
      <MembersTable stats={stats} basePath={siteBasePath(site)} detailed />
    </div>
  );
}
