import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireScout } from '@/lib/recruiting/scout-access';
import { parseRecruitingSearchParams } from '@/lib/recruiting/search';
import { searchRecruitableAthletes } from '@/lib/recruiting/search-server';

// ── GET /api/scout/search (Recruiting skeleton R4) ────────────────────────
// Scout-only (requireScout): the recruitable athletes narrowed by ?q=
// (name), ?sport=, ?gradFrom= / ?gradTo=. Fail-closed by construction —
// there is no anonymous or athlete-facing version of this read. Shares
// the anonymous search budget ('search', per IP).

export async function GET(request: NextRequest) {
  try {
    let scout: { id: string };
    try {
      scout = await requireScout(request);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
    const limited = await enforceRateLimit(request, 'search', { userId: scout.id });
    if (limited) return limited;
    const params = parseRecruitingSearchParams(k => request.nextUrl.searchParams.get(k));
    const result = await searchRecruitableAthletes(getSupabaseAdmin(), params);
    return NextResponse.json({ ...result, params }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[scout/search] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
