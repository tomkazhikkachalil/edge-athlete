import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ORG_LOGO_PREFIX } from '@/lib/org-sites/logo-server';

/**
 * GET /api/media/org-logo/[siteId] — public org-site logo streamer.
 *
 * The cover-streamer recipe (api/media/cover/[id]): tokenless and
 * anonymous because the org site itself is an anonymous ISR surface —
 * its logo must be fetchable with no cookie. The endpoint resolves the
 * site's OWN logo_path and streams only that object; it never accepts an
 * arbitrary bucket/key, and it hard-asserts the org-logos/ prefix, so it
 * can only ever serve an org logo (org-authored public artwork — served
 * for draft sites too, the covers precedent). The static `org-logo`
 * segment beats the sibling [token] proxy route (the cover precedent).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'media');
    if (limited) return limited;

    const { siteId } = await params;
    if (!isUuid(siteId)) {
      return NextResponse.json({ error: 'Invalid site ID' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();

    const { data: site } = await admin
      .from('org_sites')
      .select('logo_path')
      .eq('id', siteId)
      .maybeSingle();

    const logoPath: string | null = site?.logo_path ?? null;
    // The prefix assert is the security line — anything else stored in the
    // column (there is no legacy format, so this is pure defense) is not
    // ours to stream.
    if (!logoPath || !logoPath.startsWith(ORG_LOGO_PREFIX)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from('uploads')
      .createSignedUrl(logoPath, 60);
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
    // Public content — CDN-cacheable; the caller's `?v` (logo filename)
    // busts this when a new logo is uploaded. Deliberately NO vary.
    headers.set('cache-control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[org-logo-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
