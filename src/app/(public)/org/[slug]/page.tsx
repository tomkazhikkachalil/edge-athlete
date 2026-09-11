import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCachedSite } from '@/lib/org-sites/cached';
import { buildOrgJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import { seedLayout } from '@/lib/site-builder/seeds';
import { cachedSiteReaders, resolveHomeData } from '@/lib/org-sites/widget-data';
import GridRenderer from './_components/GridRenderer';
import { siteHead } from '@/lib/org-sites/metadata';

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
  // Program 2, C: the manager's SEO config with the platform defaults as
  // fallbacks — ONE builder (metadata.ts). The card is an EXPLICIT route
  // (/org/{slug}/card.png), not the opengraph-image convention file — the
  // convention hash-suffixes its URL under a route group; explicit images
  // are deterministic and probe-able. The layout's metadataBase resolves a
  // relative image (an uploaded social image through the streamer).
  const head = siteHead(site);
  return {
    title: head.title,
    description: head.description,
    alternates: { canonical: head.canonical },
    openGraph: { title: head.title, description: head.description, url: head.canonical, siteName: 'Edge Athlete', type: 'website', images: [head.image] },
  };
}

export default async function OrgSiteHome({ params }: PageParams) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();

  // P3-C: the published revision's grid, else the template-aware projection
  // of the module rows (a site nobody has arranged looks as it did).
  const layout = site.layout ?? seedLayout(site);
  const data = await resolveHomeData(cachedSiteReaders(slug, site), site, layout);

  return (
    <>
      {/* R4: SportsOrganization structured data — safeJsonLd escapes `<`
          (org names are user text), and NO people ever appear here. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(buildOrgJsonLd(site)) }}
      />
      <GridRenderer site={site} layout={layout} data={data} />
    </>
  );
}
