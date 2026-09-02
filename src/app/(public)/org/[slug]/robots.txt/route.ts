import { getCachedSite } from '@/lib/org-sites/cached';
import { siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/robots.txt — the per-site robots file (phase 6b C2) ───────
// Reached as https://<custom domain>/robots.txt through the middleware
// rewrite. Everything on the site is crawlable; it points at the site's
// own sitemap. Draft ⇔ missing.

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return new Response('Not Found', { status: 404 });
  const body = `User-agent: *\nAllow: /\nSitemap: ${siteAbsoluteUrl(site)}/sitemap.xml\n`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
