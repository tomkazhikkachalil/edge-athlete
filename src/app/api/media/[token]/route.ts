import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin, isAdminEmail } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { verifyMediaToken } from '@/lib/media/token';
import { authorizeMedia } from '@/lib/media/authorize';

/**
 * GET /api/media/[token] — the authenticated media proxy.
 *
 * Bytes for protected buckets are served ONLY through here: the token is an
 * unforgeable pointer to {bucket,key,entity}; the proxy re-authorizes the
 * LIVE viewer against the entity's CURRENT visibility, then streams the object
 * same-origin (never a cross-origin redirect — that would re-taint the media
 * editor's canvas and leak a URL). No public URL for private media exists.
 *
 * 404 (not 403) for a bad/forged token or an unauthorized private object, so
 * the endpoint never confirms whether a key exists.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'media');
    if (limited) return limited;

    const { token } = await params;
    const payload = verifyMediaToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Optional auth — anonymous is allowed (public content is anon-viewable).
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;

    const admin = getSupabaseAdmin();
    // Moderator override: admins view reported content (admin/reports). A
    // legitimate, narrow access class; private cache so it's never shared.
    const isModerator = isAdminEmail(user?.email, process.env.ADMIN_EMAILS);
    const auth = isModerator
      ? { allow: true, isPublic: false }
      : await authorizeMedia(admin, payload, viewerId);
    if (!auth.allow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Mint a short-lived internal signed URL and fetch the bytes server-side,
    // forwarding Range so video seeking works. The signed URL never reaches
    // the client — the response is same-origin.
    const { data: signed, error: signErr } = await admin.storage
      .from(payload.b)
      .createSignedUrl(payload.k, 60);
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const range = request.headers.get('range');
    const upstream = await fetch(signed.signedUrl, {
      headers: range ? { Range: range } : {},
      // Bytes only; no cookies to the storage host.
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
    // Public content is CDN-cacheable (the CDN then absorbs re-auth for anon
    // reads); private content must never touch a shared cache.
    headers.set(
      'cache-control',
      auth.isPublic
        ? 'public, max-age=60, s-maxage=86400, stale-while-revalidate=86400'
        : 'private, no-store'
    );
    headers.set('vary', 'Cookie');

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[media-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
