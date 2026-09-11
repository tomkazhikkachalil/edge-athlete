import { notFound } from 'next/navigation';
import { getCachedPages, getCachedSite } from '@/lib/org-sites/cached';
import { siteHead } from '@/lib/org-sites/metadata';
import type { Metadata } from 'next';
import SiteShell from './_components/SiteShell';

// ── /org/[slug] — the published site's layout (phase 3 R1, nav in R2) ───────
// Published sites only (draft = 404, the publish gate). The fetch is
// unstable_cache'd per slug with the `org-site:{slug}` tag — the console's
// publish writes revalidateTag it — plus the 300s baseline, so these
// documents are ISR: rendered once, CDN-served, refreshed on demand.
// Viewer-independent by construction (the standings contract). The markup
// lives in SiteShell (Site Builder P2-B) so the draft preview — its own
// route group, outside this published-only gate — renders the same shell
// around the draft.

export const revalidate = 300;

/** Phase 6b B1: the per-site favicon — the uploaded logo when there is
 *  one (the tokenless streamer), else the generated /favicon.svg. Pages
 *  merge their own title/canonical over this; none of them sets icons. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return {};
  // Program 2, C: the chosen icon token, else the logo, else the generated favicon (ONE rule, metadata.ts).
  const icon = siteHead(site).icon;
  // Onboarding v2 R1 (179): an unlisted or pending site serves by link but
  // is never indexed — the layout's robots applies to every subpage.
  return { icons: { icon }, ...(site.listed ? {} : { robots: { index: false, follow: false } }) };
}

export default async function OrgSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();
  // R3: public custom pages join the nav after the module links.
  const pages = await getCachedPages(slug, site.id);
  return (
    <SiteShell site={site} pages={pages}>
      {children}
    </SiteShell>
  );
}
