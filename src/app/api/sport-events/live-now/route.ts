import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readLiveEvents } from '@/lib/sport-events/live-now-server';

/**
 * GET /api/sport-events/live-now[?count=1] — the live EVENTS (any sport) a
 * viewer may open: public ones for anyone — signed out included (Events
 * phase 4: a public event is a place anyone can watch) — plus the viewer's
 * own. `?count=1` answers `{count}` only (the header's Live dot merges it
 * with the golf rounds' count). Anonymous answers may sit at the CDN for
 * 10 s; a signed-in answer is private.
 */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'sport-event-view');
  if (limited) return limited;
  try {
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const events = await readLiveEvents(getSupabaseAdmin(), viewerId);
    const cache = viewerId ? 'private, max-age=10' : 'public, max-age=10, s-maxage=10';
    const countOnly = new URL(request.url).searchParams.get('count') === '1';
    return NextResponse.json(countOnly ? { count: events.length } : { events }, { headers: { 'Cache-Control': cache } });
  } catch (error) {
    console.error('[api/sport-events/live-now] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
