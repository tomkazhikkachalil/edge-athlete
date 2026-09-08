import { getCachedSite } from '@/lib/org-sites/cached';
import { siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/robots.txt — the per-site robots file (phase 6b C2) ───────
// Reached as https://<custom domain>/robots.txt through the middleware
// rewrite. A LISTED site is crawlable and points at its own sitemap; an
// unlisted/pending site (179) disallows everything. Draft ⇔ missing.

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return new Response('Not Found', { status: 404 });
  // R1 (179): a listed site is crawlable and points at its sitemap; an
  // unlisted or pending one is reachable by link only.
  const body = site.listed
    ? `User-agent: *\nAllow: /\nSitemap: ${siteAbsoluteUrl(site)}/sitemap.xml\n`
    : `User-agent: *\nDisallow: /\n`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
