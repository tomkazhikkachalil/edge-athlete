import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { searchPeople, accessibleProfileIds } from '@/lib/search/people-server';

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
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (!q) return NextResponse.json({ profiles: [] });

    // ONE-directional: people I follow. See the header — 'either' here would
    // silently make anyone who follows me taggable by me.
    const followed = await accessibleProfileIds(user.id, 'following');

    const profiles = await searchPeople({
      query: q,
      visibleIds: followed,
      includePublic: true,
      limit: LIMIT,
      requireHandle: true,
      excludeId: user.id,
    });

    return NextResponse.json({ profiles });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[MENTIONS] search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
