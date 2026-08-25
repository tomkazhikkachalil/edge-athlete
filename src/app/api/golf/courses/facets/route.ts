import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { courseLocationFacets } from '@/lib/golf/course-catalog';

// ── GET /api/golf/courses/facets?country=CA ─────────────────────────────────
// The Explore page's Country → Region dropdowns, with counts. No `country`
// → countries; with one → that country's regions. Anonymous-safe (public
// reference data), rate-limited like search — same IP bucket, same scrape
// exposure. Empty lists until migration 104 + 105 have run: the RPC's
// absence is reported as an empty result, never a 500 (the page must not
// break on a missing migration).
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'course-search');
  if (limited) return limited;
  const country = new URL(request.url).searchParams.get('country');
  try {
    const facets = await courseLocationFacets(getSupabaseAdmin(), country || null);
    // Pure public reference data (country/region counts) — no viewer input
    // beyond ?country=. Longest CDN cache of the public reads.
    return NextResponse.json({ facets }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Course facets error:', error);
    return NextResponse.json({ error: 'Failed to load facets' }, { status: 500 });
  }
}
