import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { TEAM_LOGO_PREFIX } from '@/lib/teams/logo-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/media/team-logo/[teamId] — public team logo streamer
 * (teams & divisions, PR 6). The org-logo streamer's recipe: tokenless and
 * anonymous (a team page on the public site is an anonymous ISR surface).
 * It resolves the team's OWN logo_path and streams only that object; it
 * hard-asserts the team-logos/{teamId}/ prefix, so it can only ever serve a
 * team logo (org-authored public artwork). The static `team-logo` segment
 * beats the sibling [token] proxy route (the cover precedent).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'media');
    if (limited) return limited;

    const { teamId } = await params;
    if (!isUuid(teamId)) {
      return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();

    const { data: team } = await admin
      .from('teams')
      .select('logo_path')
      .eq('id', teamId)
      .maybeSingle();

    const logoPath: string | null = team?.logo_path ?? null;
    // The prefix assert is the security line — anything else stored in the
    // column (there is no legacy format, so this is pure defense) is not
    // ours to stream.
    if (!logoPath || !logoPath.startsWith(`${TEAM_LOGO_PREFIX}${teamId}/`)) {
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
    reportRouteError('[team-logo-proxy] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
