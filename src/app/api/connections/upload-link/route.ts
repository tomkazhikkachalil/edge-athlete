import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { isValidTimeZone } from '@/lib/calendar/time-zones';
import { SUPERVISED_CONNECTIONS_MESSAGE } from '@/lib/activities/connections';
import { isSupervisedProfile, mintUploadLink } from '@/lib/activities/connections-server';

/**
 * POST /api/connections/upload-link — create (or replace) the caller's
 * personal upload link (fix round part 3, PR 3 — the Apple Watch path).
 *
 * The link is a CAPABILITY: whoever holds it can add workouts to this
 * athlete's Vitals. So the raw token is returned ONCE, only its sha256 is
 * stored, and calling this again replaces it — the old link stops at once
 * (`rotated: true`). Behind the moderation write gate (the link is a way to
 * create content) and refused for a supervised account (a standing delivery
 * nobody in the guardian console could see — the calendar feed link's rule;
 * the inbound route refuses a supervised profile too).
 *
 * Body (optional): { tz } — the athlete's IANA zone, carried on the link as
 * `?tz=` so a file with no offset of its own lands on the right local day.
 * 200 { url, rotated }.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'connection-write', { userId: user.id });
    if (limited) return limited;

    const admin = getSupabaseAdmin();
    if (await isSupervisedProfile(admin, user.id)) {
      return NextResponse.json({ error: SUPERVISED_CONNECTIONS_MESSAGE }, { status: 403 });
    }

    let tz: string | null = null;
    try {
      const body = (await request.json()) as { tz?: unknown } | null;
      if (typeof body?.tz === 'string' && body.tz.length <= 64 && isValidTimeZone(body.tz)) tz = body.tz;
    } catch {
      // No body is fine: the link works without a zone.
    }

    const minted = await mintUploadLink(admin, user.id);
    if (!minted.ok) return NextResponse.json({ error: minted.error }, { status: minted.status });

    // The host the athlete is ON, never a configured one: the token exists
    // only in this environment's database, so the link must come back here
    // (a preview's link pointing at production would be a dead link).
    const url = `${new URL(request.url).origin}/api/activities/inbound/${minted.token}${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`;
    return NextResponse.json({ url, rotated: minted.rotated }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[connections] upload link error:', error);
    return NextResponse.json({ error: 'Could not create your link. Try again.' }, { status: 500 });
  }
}
