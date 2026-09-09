import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCachedSite } from '@/lib/org-sites/cached';
import { buildOrgJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import { deriveLegacyLayout } from '@/lib/site-builder/layout';
import { cachedSiteReaders, resolveHomeData } from '@/lib/org-sites/widget-data';
import SiteHomeBody from './_components/SiteHomeBody';
import { siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── The site home (phase 3 R2; body shared with the draft preview) ─────────
// The section list itself IS the product surface: enabled modules render
// (empty ones say so quietly), disabled ones don't exist. All data
// arrives through the per-module cached readers — one Promise.all, no
// per-component fetching. The markup lives in SiteHomeBody so the
// token-gated preview renders the exact same page from raw reads.
//
// Site Builder P1-C (Sep 9 2026): the page renders from a LAYOUT — today
// derived from the module rows by deriveLegacyLayout (a linear, full-width
// projection, byte-identical output), later stored per revision. P3-A: the
// reads live in ONE resolver (widget-data.ts) — this page hands it the
// cached reader set, the preview the raw one, the editor canvas next.

export const revalidate = 300;

// The App Router ISR rule: a dynamic segment is only ISR-ELIGIBLE when
// generateStaticParams exists — an empty list prerenders nothing at
// build (no build-time DB/service-key needed) while making every
// runtime-rendered slug cacheable under `revalidate`. Without this the
// route is plain on-demand SSR and x-vercel-cache never leaves MISS
// (measured on prod, Sep 1).
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
  const title = site.orgName;
  const description = `${site.orgName} on Edge Athlete — schedule, standings, and teams.`;
  // Relative canonical — the (public) layout's metadataBase resolves it,
  // so the canonical domain is an env decision, never a code one.
  const canonical = `${siteAbsoluteUrl(site)}`;
  return {
    title,
    description,
    alternates: { canonical },
    // The card is an EXPLICIT route (/org/{slug}/card.png), not the
    // opengraph-image convention file — the convention hash-suffixes its
    // URL under a route group; explicit images are deterministic and
    // probe-able.
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteHome({ params }: PageParams) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();

  const layout = deriveLegacyLayout(site);
  const data = await resolveHomeData(cachedSiteReaders(slug, site), site, layout);

  return (
    <>
      {/* R4: SportsOrganization structured data — safeJsonLd escapes `<`
          (org names are user text), and NO people ever appear here. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(buildOrgJsonLd(site)) }}
      />
      <SiteHomeBody site={site} layout={layout} data={data} />
    </>
  );
}
