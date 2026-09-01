import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ORG_MEDIA_FILE_RE } from '@/lib/org-sites/validate';
import { ORG_MEDIA_PREFIX } from '@/lib/org-sites/pages-server';

/**
 * GET /api/media/org-media/[siteId]/[file] — public page-image streamer.
 *
 * The org-logo streamer's sibling for page-body images. The key is built
 * SERVER-SIDE from two strictly validated segments (uuid + a single
 * [a-z0-9-].ext filename) appended to the fixed org-media/ prefix — the
 * route never accepts an arbitrary bucket/key, so it can only ever reach
 * the org-media/{siteId}/ namespace, which is org-authored public-site
 * content by construction (uploaded by verified org managers through
 * /site/assets). No DB read needed: a nonexistent object simply fails to
 * sign → 404. Anonymous by design — the org site is an anonymous ISR
 * surface.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string; file: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'media');
    if (limited) return limited;

    const { siteId, file } = await params;
    if (!isUuid(siteId) || !ORG_MEDIA_FILE_RE.test(file)) {
      return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();

    const key = `${ORG_MEDIA_PREFIX}${siteId}/${file}`;
    const { data: signed, error: signErr } = await admin.storage
      .from('uploads')
      .createSignedUrl(key, 60);
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const range = request.headers.get('range');
    const upstream = await fetch(signed.signedUrl, {
      headers: range ? { Range: range } : {},
      cache: 'no-store',
    });
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const headers = new Headers();
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    headers.set('content-disposition', 'inline');
    // Public content, uuid-named and immutable per filename — long shared
    // cache is safe. Deliberately NO vary.
    headers.set('cache-control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[org-media-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
