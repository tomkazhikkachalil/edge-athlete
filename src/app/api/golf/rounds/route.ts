import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

// Sanitize input for a PostgREST .or()/.ilike() filter: STRIP the structural
// delimiters (comma, parens, double-quote) so a value can't break out and
// inject or-terms, then escape LIKE wildcards. Backslash-escaping delimiters
// is not PostgREST's documented mechanism. Same as course-catalog `likeSafe`.
function sanitizeForFilter(input: string): string {
  return input.replace(/[,()"]/g, ' ').replace(/[%_\\]/g, m => `\\${m}`).trim();
}

// ── GET /api/golf/rounds ──────────────────────────────────────────────────────
// Round summaries (no hole detail — the detail endpoint carries that) for the
// rounds list page. Own rounds by default; someone else's via ?profileId=
// behind the standard profile-visibility gate.
//
// Filters: ?holes=9|18  ?course=<search>  ?year=YYYY  ?sort=newest|oldest
// Paging:  ?limit= (default 20, max 50)  ?offset=
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);

    const profileId = searchParams.get('profileId') || user.id;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profileId' }, { status: 400 });
    }

    if (profileId !== user.id) {
      const { canView } = await canViewProfile(profileId, user.id);
      if (!canView) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }

    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);
    const holesFilter = searchParams.get('holes');
    const courseSearch = searchParams.get('course')?.trim();
    const yearFilter = parseInt(searchParams.get('year') || '', 10);
    const sort = searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';

    let query = supabase
      .from('golf_rounds')
      .select(
        `id, date, course, course_location, tee, holes, round_type, par,
         gross_score, total_putts, fir_percentage, gir_percentage,
         is_complete, created_at`,
        { count: 'exact' }
      )
      .eq('profile_id', profileId);

    if (holesFilter === '9' || holesFilter === '18') {
      query = query.eq('holes', parseInt(holesFilter, 10));
    }
    if (courseSearch) {
      query = query.ilike('course', `%${sanitizeForFilter(courseSearch)}%`);
    }
    if (Number.isInteger(yearFilter) && yearFilter > 1900 && yearFilter < 2200) {
      query = query
        .gte('date', `${yearFilter}-01-01`)
        .lte('date', `${yearFilter}-12-31`);
    }

    const { data: rounds, count, error } = await query
      .order('date', { ascending: sort === 'oldest' })
      .order('created_at', { ascending: sort === 'oldest' })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('GET /api/golf/rounds error:', error);
      return NextResponse.json({ error: 'Failed to load rounds' }, { status: 500 });
    }

    return NextResponse.json({
      rounds: rounds || [],
      total: count ?? 0,
      hasMore: offset + (rounds?.length || 0) < (count ?? 0),
      nextOffset: offset + (rounds?.length || 0),
      isOwner: profileId === user.id,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/golf/rounds error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
