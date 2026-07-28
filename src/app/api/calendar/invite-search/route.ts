import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';

// ── GET /api/calendar/invite-search?q= ────────────────────────────────────────
// Guest-picker search: public profiles PLUS anyone with an accepted follow
// relationship with the caller in either direction. /api/search filters to
// public-only, which would make private friends uninvitable — this route
// exists to close that gap without changing shared search semantics.

const PROFILE_FIELDS = 'id, first_name, middle_name, last_name, full_name, avatar_url, handle';
const LIMIT = 8;

export async function GET(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ profiles: [] });
    // Escape PostgREST ilike wildcards in user input.
    const escaped = q.replace(/[%_]/g, ch => `\\${ch}`);

    const admin = getSupabaseAdmin();
    const { data: follows } = await admin
      .from('follows')
      .select('follower_id, following_id')
      .eq('status', 'accepted')
      .or(`follower_id.eq.${user.id},following_id.eq.${user.id}`);
    const related = new Set<string>();
    for (const f of follows ?? []) {
      related.add(f.follower_id === user.id ? f.following_id : f.follower_id);
    }
    related.delete(user.id);

    const nameFilter = `full_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,handle.ilike.%${escaped}%`;
    let query = admin
      .from('profiles')
      .select(PROFILE_FIELDS)
      .neq('id', user.id)
      .or(nameFilter)
      .limit(LIMIT);
    if (related.size > 0) {
      query = query.or(`visibility.eq.public,id.in.(${[...related].join(',')})`);
    } else {
      query = query.eq('visibility', 'public');
    }
    const { data: profiles, error } = await query;
    if (error) throw error;

    return NextResponse.json({ profiles: profiles ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] invite-search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
