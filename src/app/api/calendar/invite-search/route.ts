import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { searchPeople } from '@/lib/search/people-server';
import { reportRouteError } from '@/lib/observability/report';

// ── GET /api/calendar/invite-search?q= ────────────────────────────────────────
// Guest-picker search: public profiles PLUS anyone with an accepted follow
// relationship with the caller in either direction. /api/search filters to
// public-only, which would make private friends uninvitable — this route
// exists to close that gap without changing shared search semantics.
//
// BIDIRECTIONAL on purpose, and deliberately wider than /api/mentions/search:
// you can invite someone who follows you to an event, but you cannot @mention
// them into a comment thread. Do not "unify" the two.

const LIMIT = 8;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    // A GET runs no bucket through requireAuth; this one is a database query
    // per keystroke, so it names its own (hole 8, Nov 7 2026).
    const limited = await enforceRateLimit(request, 'people-search', { userId: user.id });
    if (limited) return limited;
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (!q) return NextResponse.json({ profiles: [] });

    // Either direction, computed in SQL (303) — the list never crosses the wire.
    const profiles = await searchPeople({
      query: q,
      viewer: { id: user.id, direction: 'either' },
      includePublic: true,
      limit: LIMIT,
      excludeId: user.id,
    });

    return NextResponse.json({ profiles });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[CALENDAR] invite-search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
