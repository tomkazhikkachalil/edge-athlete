import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin, platformRoleFor } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { verifyMediaToken } from '@/lib/media/token';
import { authorizeMedia } from '@/lib/media/authorize';
import { mediaCacheHeaders } from '@/lib/media/cache-headers';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/media/[token] — the authenticated media proxy.
 *
 * Bytes for protected buckets are served ONLY through here: the token is an
 * unforgeable pointer to {bucket,key,entity}; the proxy re-authorizes the
 * LIVE viewer against the entity's CURRENT visibility, then streams the object
 * same-origin (never a cross-origin redirect — that would re-taint the media
 * editor's canvas and leak a URL). No public URL for private media exists.
 *
 * 404 (not 403) for a bad/forged/expired token or an unauthorized private
 * object, so the endpoint never confirms whether a key exists.
 *
 * Speed round 2 (Oct 4 2026) — this route used to cost 5–8 sequential
 * round trips per image, each 134–334 ms on the production database:
 *   1. The token is verified FIRST (pure, no I/O). Only a MISS is rate-limited
 *      (`media-miss`) — a valid token never writes a rate row; the limiter
 *      used to be a DB write on every image view, before anything else.
 *   2. The session check runs IN PARALLEL with the entity read: authorizeMedia
 *      takes the viewer as a thunk and awaits it only when the answer depends
 *      on who is asking (public media never does).
 *   3. The moderator override (`platformRoleFor`, a DB read) runs only when
 *      the ordinary rule denied — the exception path, not the hot path.
 *   4. ONE storage request: an authenticated GET with the service key
 *      (`/object/authenticated/…`, the path supabase-js `download()` uses)
 *      instead of minting a signed URL and then fetching it. Range and
 *      If-None-Match are forwarded; a 304 passes through with no body.
 *   5. Cache-Control from cache-headers.ts: public media has no `Vary`
 *      (one CDN copy for everyone); private media is `private, max-age` for
 *      the token's remaining life — the device caches, a shared cache never.
 */
const UPSTREAM_TIMEOUT_MS = 15_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const payload = verifyMediaToken(token);
    if (!payload) {
      const limited = await enforceRateLimit(request, 'media-miss');
      if (limited) return limited;
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const admin = getSupabaseAdmin();
    // Optional auth — anonymous is allowed (public content is anon-viewable).
    // Started now, awaited by the authorizer only when the answer needs it.
    const viewerPromise = getServerAuth(request).then(({ user }) => user ?? null);
    const viewer = () => viewerPromise.then(user => user?.id ?? null);

    let auth = await authorizeMedia(admin, payload, viewer);
    if (!auth.allow) {
      // Moderator override: admins view reported content (admin/reports). A
      // legitimate, narrow access class; private cache so it's never shared.
      // Since Spec 1 a moderator is a platform ROLE (owner by the allowlist,
      // or a platform_admins row).
      const user = await viewerPromise;
      if (user && (await platformRoleFor(user)) !== null) auth = { allow: true, isPublic: false };
    }
    if (!auth.allow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // One authenticated read with the service key; the key never reaches the
    // client — the response is same-origin.
    const objectUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/${payload.b}/${encodeKey(payload.k)}`;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const forward = new Headers({ apikey: serviceKey, authorization: `Bearer ${serviceKey}` });
    for (const h of ['range', 'if-none-match', 'if-modified-since']) {
      const v = request.headers.get(h);
      if (v) forward.set(h, v);
    }
    const upstream = await fetch(objectUrl, {
      headers: forward,
      // Bytes only; nothing cached in the function.
      cache: 'no-store',
      // A hung storage host used to hold the function (and the viewer) for
      // the full function timeout. Server-side, so the browser floor is not
      // in play; feature-detected anyway (Round 1 PR 4).
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined,
    });
    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      // A storage 5xx was a silent 404 — every broken image looked like a
      // missing one. Still a 404 to the viewer (nothing to retry from the
      // client), but recorded, so an outage is visible.
      if (upstream.status >= 500) {
        reportRouteError('[media-proxy] storage answered', upstream.status, { bucket: payload.b, entity: payload.t });
      }
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const headers = new Headers();
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (upstream.status !== 304 && !headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    headers.set('content-disposition', 'inline');
    for (const [k, v] of Object.entries(mediaCacheHeaders({ isPublic: auth.isPublic, tokenExp: payload.exp }))) {
      headers.set(k, v);
    }

    if (upstream.status === 304) return new NextResponse(null, { status: 304, headers });
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[media-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** A storage key, segment by segment, as a URL path. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
