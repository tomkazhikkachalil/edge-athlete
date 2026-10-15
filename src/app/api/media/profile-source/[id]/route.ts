import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parsePublicUrl } from '@/lib/media/proxy-url';
import { reportRouteError } from '@/lib/observability/report';
import { fetchWithHeaderTimeout, isAbortError, STORAGE_ANSWER_TIMEOUT_MS } from '@/lib/net/fetch-timeout';
import { PROFILE_SOURCE_BUCKET, PROFILE_SOURCE_PREFIX } from '@/lib/profiles/photo-paths';

/**
 * GET /api/media/profile-source/[id]?slot=avatar|cover — the kept ORIGINAL
 * behind a profile photo (PR 5, Oct 14 2026, migration 264), for "Adjust the
 * current photo". OWNER-ONLY (or a consented guardian — the photo routes'
 * acting gate): the original was never shown to anyone, and this is the one
 * door to it. It resolves the profile's OWN `{slot}_source_url` and streams
 * only that object, only from `uploads/profile-sources/` — never an
 * arbitrary bucket or key. Anonymous → 401; a stranger → 404 (not 403 — the
 * existence of an original is the owner's). `private, no-store`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'media', { userId: user.id });
    if (limited) return limited;

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    const slot = request.nextUrl.searchParams.get('slot');
    if (slot !== 'avatar' && slot !== 'cover') return NextResponse.json({ error: 'slot must be avatar or cover' }, { status: 400 });

    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(user.id, id === user.id ? null : id, 'Not found');
    if (!gate.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin.from('profiles').select(`${slot}_source_url`).eq('id', gate.actorId).maybeSingle();
    const sourceUrl = ((profile as Record<string, unknown> | null)?.[`${slot}_source_url`] as string | null) ?? null;
    if (!sourceUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const parsed = parsePublicUrl(sourceUrl);
    if (!parsed || parsed.bucket !== PROFILE_SOURCE_BUCKET || !parsed.key.startsWith(PROFILE_SOURCE_PREFIX)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { data: signed, error: signErr } = await admin.storage.from(parsed.bucket).createSignedUrl(parsed.key, 60);
    if (signErr || !signed?.signedUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const upstream = await fetchWithHeaderTimeout(signed.signedUrl, { cache: 'no-store' }, STORAGE_ANSWER_TIMEOUT_MS);
    if (!upstream.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const headers = new Headers();
    for (const h of ['content-type', 'content-length', 'etag', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (isAbortError(error)) return NextResponse.json({ error: 'Storage timed out' }, { status: 504 });
    reportRouteError('Profile source proxy error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
