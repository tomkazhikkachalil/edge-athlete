import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parsePublicUrl } from '@/lib/media/proxy-url';

/**
 * GET /api/media/cover/[id] — public cover-photo streamer.
 *
 * Cover photos are PUBLIC by decision but live in the now-private `uploads`
 * bucket, so their raw `/object/public/uploads/…` URLs 404. Unlike post/message
 * media (served by the token proxy at /api/media/[token]), the own-profile page
 * loads its profile client-side and can't mint a signed token — so covers use
 * this tokenless endpoint keyed by profile id instead.
 *
 * It resolves the profile's OWN `cover_url` and streams only that object. It
 * never accepts an arbitrary bucket/key, so it can't be used to reach private
 * post/message media — it can only ever serve a cover, which is public anyway.
 * Anonymous access is allowed (covers show on public profiles).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'media');
    if (limited) return limited;

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid cover ID' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();

    const { data: profile } = await admin
      .from('profiles')
      .select('cover_url')
      .eq('id', id)
      .maybeSingle();

    const coverUrl: string | null = profile?.cover_url ?? null;
    if (!coverUrl) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const parsed = parsePublicUrl(coverUrl);
    // Covers are always stored in `uploads`. Anything else (a legacy external
    // URL) isn't ours to stream — 404 rather than proxy an arbitrary host.
    if (!parsed || parsed.bucket !== 'uploads') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.key, 60);
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
    // Public content — CDN-cacheable. The caller's `?v` (cover filename) busts
    // this when a new cover is uploaded, so a long shared cache is safe.
    headers.set('cache-control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[cover-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
