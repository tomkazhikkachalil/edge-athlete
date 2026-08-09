import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

// ── GET /api/mentions/search?q= ───────────────────────────────────────────────
// The @mention typeahead source for COMMENTS: public profiles PLUS the
// caller's accepted follows — ONE-DIRECTIONAL (follower_id = me), matching
// canViewProfile's "you know them" rule, NOT invite-search's bidirectional
// set: someone following ME must not make their private profile taggable
// BY me. Runs on the admin client, so the visibility filter here IS the
// privacy boundary (the RPC-visibility lesson: never trust the DB layer to
// do it). Chat @mentions never call this — members are filtered client-side.

const PROFILE_FIELDS = 'id, first_name, middle_name, last_name, full_name, avatar_url, handle';
const LIMIT = 8;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().replace(/^@/, '');
    if (q.length < 1) return NextResponse.json({ profiles: [] });
    // Escape PostgREST ilike wildcards in user input.
    const escaped = q.replace(/[%_]/g, ch => `\\${ch}`);

    const admin = getSupabaseAdmin();
    const { data: follows } = await admin
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id)
      .eq('status', 'accepted');
    const followed = (follows ?? []).map(f => f.following_id).filter(id => id !== user.id);

    const nameFilter = `full_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,handle.ilike.%${escaped}%`;
    let query = admin
      .from('profiles')
      .select(PROFILE_FIELDS)
      .neq('id', user.id)
      .not('handle', 'is', null)
      .or(nameFilter)
      .limit(LIMIT);
    if (followed.length > 0) {
      query = query.or(`visibility.eq.public,id.in.(${followed.join(',')})`);
    } else {
      query = query.eq('visibility', 'public');
    }
    const { data: profiles, error } = await query;
    if (error) throw error;

    return NextResponse.json({ profiles: profiles ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[MENTIONS] search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
