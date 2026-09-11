import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { getCachedSite } from '@/lib/org-sites/cached';
import { siteBasePath } from '@/lib/org-sites/urls';
import { PIXEL_GIF, isBotUA, optedOut, pathKey, refererPath } from '@/lib/org-sites/analytics';
import { recordSiteHit } from '@/lib/org-sites/analytics-server';

// ── /org/[slug]/hit.gif — the first-party page-view pixel (program 2, E) ────
// Served no-store so every page load fetches it; the middleware matcher
// skips *.gif, so it never pays the auth round trip. Counts a view — and a
// visitor once per day — for a PUBLISHED site's page, read from the
// same-origin Referer. Never for a bot, an opted-out browser (Sec-GPC / DNT),
// a preview, or when no ANALYTICS_SALT is configured. The GIF answers the
// same in every case: the pixel is never a signal to the visitor.

export const dynamic = 'force-dynamic';

const GIF_HEADERS = {
  'content-type': 'image/gif',
  'cache-control': 'no-store, private, max-age=0',
  'x-robots-tag': 'noindex',
};

function pixel(): Response {
  return new Response(new Uint8Array(PIXEL_GIF), { status: 200, headers: GIF_HEADERS });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const ua = request.headers.get('user-agent');
    if (isBotUA(ua) || optedOut(request.headers)) return pixel();
    const site = await getCachedSite(slug);
    if (!site) return pixel();
    const pathname = refererPath(request.headers.get('referer'), new URL(request.url).origin);
    if (!pathname) return pixel();
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = (forwarded ? forwarded.split(',')[0] : '').trim() || 'unknown';
    await recordSiteHit(getSupabaseAdmin(), { siteId: site.id, path: pathKey(pathname, siteBasePath(site) || '/'), ip, ua: ua ?? '' });
  } catch {
    /* the pixel is never loud */
  }
  return pixel();
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: GIF_HEADERS });
}
