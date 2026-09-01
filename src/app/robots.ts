import type { MetadataRoute } from 'next';
import { appBaseUrl } from '@/lib/org-sites/urls';

// ── /robots.txt (phase 3 R4) — the app's first robots file ─────────────────
// MUST live at the app root: Next's robots metadata-route regex is
// root-anchored, so a route-group placement is silently dead code.
// Everything public stays crawlable; /api/ (machine surface) and /app/
// (the signed-in console tree) are noise for crawlers. Static — no DB,
// and appBaseUrl reads a build-inlined NEXT_PUBLIC var.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/app/'] }],
    sitemap: `${appBaseUrl()}/sitemap.xml`,
  };
}
