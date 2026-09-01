import type { MetadataRoute } from 'next';
import { getCachedSitemapSites } from '@/lib/org-sites/cached';
import { appBaseUrl } from '@/lib/org-sites/urls';

// ── /sitemap.xml (phase 3 R4) — every published org site ──────────────────
// force-dynamic is LOAD-BEARING: without it the build statically
// prerenders this handler and calls getSupabaseAdmin() at build time
// (the no-build-time-service-key rule). Next's metadata loader serves
// the XML with max-age=0, so the unstable_cache hour (purged by
// publish/unpublish) is what absorbs DB load. The route-group placement
// is fine for sitemaps (unlike robots — root-anchored, see
// src/app/robots.ts). Degrades to an empty list, never throws.

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const base = appBaseUrl();
    const sites = await getCachedSitemapSites();
    return sites.flatMap(site => [
      {
        url: `${base}/org/${site.subdomain}`,
        ...(site.lastModified ? { lastModified: site.lastModified } : {}),
      },
      ...site.moduleKeys.map(key => ({ url: `${base}/org/${site.subdomain}/${key}` })),
      ...site.pageSlugs.map(slug => ({ url: `${base}/org/${site.subdomain}/${slug}` })),
    ]);
  } catch {
    return [];
  }
}
