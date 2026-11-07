import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { searchPeople } from '@/lib/search/people-server';
import { reportRouteError } from '@/lib/observability/report';

// ── GET /api/mentions/search?q= ───────────────────────────────────────────────
// The @mention typeahead source for COMMENTS: public profiles PLUS the
// caller's accepted follows — ONE-DIRECTIONAL (follower_id = me), matching
// canViewProfile's "you know them" rule, NOT invite-search's bidirectional
// set: someone following ME must not make their private profile taggable
// BY me. Runs on the admin client, so the visibility filter here IS the
// privacy boundary (the RPC-visibility lesson: never trust the DB layer to
// do it) — which is exactly why searchPeople takes the allowed-id set as an
// ARGUMENT and this route still computes it. Chat @mentions never call this;
// members are filtered client-side.

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

    // ONE-directional: people I follow. See the header — 'either' here would
    // silently make anyone who follows me taggable by me. Computed in SQL
    // (303) — the list never crosses the wire.
    const profiles = await searchPeople({
      query: q,
      viewer: { id: user.id, direction: 'following' },
      includePublic: true,
      limit: LIMIT,
      requireHandle: true,
      excludeId: user.id,
    });

    return NextResponse.json({ profiles });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[MENTIONS] search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
