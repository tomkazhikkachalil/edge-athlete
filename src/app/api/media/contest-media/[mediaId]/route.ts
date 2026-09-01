import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { evaluatePublicContestMedia } from '@/lib/orgs/gallery-gate';

/**
 * GET /api/media/contest-media/[mediaId] — the PUBLIC gallery streamer
 * (phase 4 R5). Anonymous by design (the org site is an anonymous ISR
 * surface), but NOTHING is public by default: every request re-runs the
 * full gallery gate — org-published item, public active/completed
 * competition, and EVERY actively tagged athlete cleared by
 * photo_consent — so a consent revoke stops the bytes even while a
 * stale ISR document still links here. Authenticated org/tagged access
 * to unpublished media goes through the signed proxy ('contest_media'
 * entity), never this route. Shared cache stays SHORT for the same
 * reason (a revoke must propagate on the ISR clock, not a CDN year).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'media');
    if (limited) return limited;

    const { mediaId } = await params;
    if (!isUuid(mediaId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const [eligible] = await evaluatePublicContestMedia(admin, [mediaId]);
    if (!eligible) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from('uploads')
      .createSignedUrl(eligible.storagePath, 60);
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
    // SHORT shared cache on purpose — consent is revocable and this gate
    // must win within the ISR window, unlike the immutable org-media
    // assets (which keep their day-long s-maxage).
    headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60');

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[contest-media-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
