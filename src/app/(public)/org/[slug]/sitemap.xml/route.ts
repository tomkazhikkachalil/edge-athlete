import { getCachedSite, getCachedSiteSitemap } from '@/lib/org-sites/cached';
import { siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/sitemap.xml — the per-site sitemap (phase 6b C2) ──────────
// Reached as https://<custom domain>/sitemap.xml through the middleware
// rewrite. URLs are absolute on the site's own address (siteAbsoluteUrl),
// so a domain-hosted site advertises domain URLs and never apex ones.
// Draft ⇔ missing. Hand-built XML (no metadata-route convention under a
// dynamic segment).

// force-dynamic is LOAD-BEARING (Sep 27 2026, the leftovers prod probe):
// Next reads a folder named sitemap.xml as a METADATA route, and without
// it the build prerenders ONE static file for a placeholder slug
// (/-/sitemap.xml) and records no dynamic route — on Vercel every real
// slug then fell through to [pageSlug] and answered 404 (it had since
// 6b; `next start` still resolves it, so local e2e never saw it). The
// s-maxage below is what the CDN caches. The vanity twin declares it too
// (segment config is read from each file, never through a re-export).
export const dynamic = 'force-dynamic';

const escapeXml = (v: string) => v.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [site, entry] = await Promise.all([getCachedSite(slug), getCachedSiteSitemap(slug)]);
  if (!site) return new Response('Not Found', { status: 404 });
  // R1 (179): an unlisted or pending site enumerates nothing.
  const listed = site.listed;
  const base = siteAbsoluteUrl(site);
  const urls = [
    base,
    ...(entry?.moduleKeys ?? []).map(key => `${base}/${key}`),
    ...(entry?.pageSlugs ?? []).map(p => `${base}/${p}`),
    ...(entry?.teamIds ?? []).map(id => `${base}/teams/${id}`),
    ...(entry?.divisionIds ?? []).map(id => `${base}/divisions/${id}`),
    ...(entry?.courseIds ?? []).map(id => `${base}/courses/${id}`),
    ...(entry?.playerHandles ?? []).map(h => `${base}/players/${encodeURIComponent(h)}`),
    ...(entry?.newsSlugs ?? []).map(ns => `${base}/news/${ns}`),
    ...(entry?.contestIds ?? []).map(id => `${base}/schedule/${id}`),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (listed ? urls.map(u => `  <url><loc>${escapeXml(u)}</loc></url>`).join('\n') : '') +
    `\n</urlset>\n`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
