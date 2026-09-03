import type { MetadataRoute } from 'next';
import { getCachedSitemapSites } from '@/lib/org-sites/cached';
import { appBaseUrl, orgSitePath } from '@/lib/org-sites/urls';

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
    // C2: sites live on their own domain get their own sitemap (served
    // through the middleware rewrite); cross-host URLs don't belong here.
    const sites = (await getCachedSitemapSites()).filter(site => !site.customDomain);
    return [{ url: `${base}/clubs` }, { url: `${base}/leagues` }, ...sites.flatMap(site => [
      {
        url: `${base}${orgSitePath(site.subdomain)}`,
        ...(site.lastModified ? { lastModified: site.lastModified } : {}),
      },
      ...site.moduleKeys.map(key => ({ url: `${base}${orgSitePath(site.subdomain)}/${key}` })),
      ...site.pageSlugs.map(slug => ({ url: `${base}${orgSitePath(site.subdomain)}/${slug}` })),
      ...site.teamIds.map(id => ({ url: `${base}${orgSitePath(site.subdomain)}/teams/${id}` })),
      ...site.courseIds.map(id => ({ url: `${base}${orgSitePath(site.subdomain)}/courses/${id}` })),
      ...site.playerHandles.map(h => ({ url: `${base}${orgSitePath(site.subdomain)}/players/${encodeURIComponent(h)}` })),
      ...site.newsSlugs.map(ns => ({ url: `${base}${orgSitePath(site.subdomain)}/news/${ns}` })),
    ])];
  } catch {
    return [];
  }
}
