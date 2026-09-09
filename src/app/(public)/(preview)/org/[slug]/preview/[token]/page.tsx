import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchPublicPages } from '@/lib/org-sites/public-data';
import { getDraftSiteBySlug } from '@/lib/org-sites/server';
import { verifyPreviewToken } from '@/lib/org-sites/preview-token';
import { layoutFromModules } from '@/lib/site-builder/layout';
import { rawSiteReaders, resolveHomeData } from '@/lib/org-sites/widget-data';
import GridRenderer from '@/app/(public)/org/[slug]/_components/GridRenderer';
import SiteShell from '@/app/(public)/org/[slug]/_components/SiteShell';

// ── /org/[slug]/preview/[token] — the draft preview ─────────────────────────
// Site Builder P2-B: the preview lives in its OWN route group so it escapes
// the published-only layout — a manager previews the DRAFT (theme, template,
// nav, notice, body) of a site that may not be live at all, inside the same
// SiteShell the published pages use. The one deliberately UNCACHED page in
// the segment: no generateStaticParams, force-dynamic, noindex — every hit
// re-renders from RAW readers so draft edits show instantly. The signed
// short-lived token IS the authorization (minted by the manager-gated
// console API); no session branching happens here, so the segment's
// viewer-independence contract holds. A bad, expired, or cross-site token
// is indistinguishable from a missing page.

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Draft preview', robots: { index: false, follow: false } };
}

export default async function OrgSitePreview({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const admin = getSupabaseAdmin();
  // The draft overlaid on the site row (falls back to the rows pre-180 or
  // without a draft); any status — publish is not the gate here, the token is.
  const site = await getDraftSiteBySlug(admin, slug);
  if (!site) notFound();
  const tokenSiteId = verifyPreviewToken(token);
  if (!tokenSiteId || tokenSiteId !== site.id) notFound();

  // P1-C: the same derived layout the live home renders from; P3-A: the
  // same resolver too, with the RAW reader set (every hit re-reads) — so the
  // preview now carries everything the home does (members table, the
  // leaders' golf fallback), which it had drifted from.
  // P3-C: the DRAFT's stored grid (getDraftSiteBySlug), else the projection.
  const layout = site.layout ?? layoutFromModules(site);
  const [data, pages] = await Promise.all([
    resolveHomeData(rawSiteReaders(admin, site), site, layout),
    fetchPublicPages(admin, site.id),
  ]);

  return (
    <SiteShell site={site} pages={pages}>
      <div className="bg-amber-100 border-b border-amber-300">
        <p className="max-w-4xl mx-auto px-4 py-2 text-sm font-medium text-amber-900">
          Draft preview — not public. This link expires; publish from the console
          to go live.
        </p>
      </div>
      <GridRenderer site={site} layout={layout} data={data} />
    </SiteShell>
  );
}
