import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { hasLocationFilter, readLocationParams } from '@/lib/geo/params';
import { searchAllFacets } from '@/lib/search/all-server';
import { groupFacetRows, typesForRequest, type GroupedFacets } from '@/lib/search/all';

// ── GET /api/search/facets — counts for the ⌘K filter panel ─────────────────
// search_all_facets (112) over the same matched set /api/search would return:
// same type gating (typesForRequest), same privacy params, same location
// codes — so the counts always describe exactly what the search shows.
// Facets are decoration: every degrade path (missing RPC, empty type set)
// returns empty groups, never an error the panel would have to render.

const EMPTY: GroupedFacets = { types: [], sports: [], countries: [], regions: [] };

export async function GET(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, 'search');
    if (limited) return limited;

    // Optional auth — private athletes must not count for strangers.
    let viewerId: string | null = null;
    try {
      const user = await requireAuth(request);
      viewerId = user.id;
    } catch {
      viewerId = null;
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() ?? '';
    const type = searchParams.get('type') || 'all';
    const location = readLocationParams(searchParams);
    const locationBrowse =
      hasLocationFilter(location) &&
      (type === 'athletes' || type === 'clubs' || type === 'courses' || type === 'leagues');

    const docTypes = typesForRequest(type, query.length, locationBrowse);
    if (docTypes.length === 0) {
      return NextResponse.json({ facets: EMPTY });
    }

    const rows = await searchAllFacets({
      query,
      types: docTypes,
      visibleIds: viewerId ? [viewerId] : [],
      includePublic: true,
      countryCode: location.countryCode,
      regionCode: location.regionCode,
    });
    if (rows === null) {
      return NextResponse.json({ facets: EMPTY });
    }

    return NextResponse.json({ facets: groupFacetRows(rows) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SEARCH FACETS] error:', error);
    return NextResponse.json({ error: 'Facets failed' }, { status: 500 });
  }
}
