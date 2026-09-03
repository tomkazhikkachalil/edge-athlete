import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { evaluateMemberPhotos } from '@/lib/org-sites/member-photo-gate';

/**
 * GET /api/media/org-gallery/[siteId]/[mediaId] — the PUBLIC streamer for
 * a member's round photo on a club site (M2, program 10). Anonymous by
 * design (the org site is an anonymous ISR surface), but NOTHING is
 * public by default: every request re-runs the member-photo gate — the
 * site published and public, the manager's pick, the post still public
 * and published, the author still a public unsupervised profile, the
 * member's round-photo consent still true — so a revoke, a post made
 * private, or a club gone private stops the bytes even while a stale
 * ISR document still links here. Shared cache stays SHORT for the same
 * reason (the contest-media precedent).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string; mediaId: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'media');
    if (limited) return limited;

    const { siteId, mediaId } = await params;
    if (!isUuid(siteId) || !isUuid(mediaId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const [eligible] = await evaluateMemberPhotos(admin, siteId, [mediaId]);
    if (!eligible) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from('uploads')
      .createSignedUrl(eligible.storageKey, 60);
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
    headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=60');

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[org-gallery-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
