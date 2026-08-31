import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { isMissingTableError } from '@/lib/venues/validate';

// ── /api/admin/venues/golf-clubs?q= — the console's link typeahead over the
// golf reference catalog (125). Admin-gated: it's a curation surface, and
// the public course search already exists elsewhere for users. ──────────────

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ golfClubs: [] });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('golf_clubs')
      .select('id, name, city, region')
      .ilike('name', `%${q.replace(/[%_]/g, '')}%`)
      .limit(6);
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ golfClubs: [] });
      console.error('[ADMIN VENUES] golf club search error:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
    return NextResponse.json({ golfClubs: data ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN VENUES] golf-clubs GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
