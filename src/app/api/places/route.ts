import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { formatPlace } from '@/lib/geo/regions';

// ── GET /api/places?q=ott&country=CA ────────────────────────────────────────
// Place autocomplete over the GeoNames-seeded `places` table (migration 104)
// for every location picker: profile location, search filters, event
// locations. Public reference data, anonymous-safe, rate-limited in the same
// IP bucket as course search. A missing RPC (migration not run) is an empty
// list, never a 500 — pickers degrade to free text.
export interface PlaceSuggestion {
  id: string;
  name: string;
  region: string | null;
  regionCode: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  /** "Ottawa, Ontario · Canada" — the display string pickers store as text. */
  label: string;
}

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'course-search');
  if (limited) return limited;
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  const country = (searchParams.get('country') ?? '').trim().toUpperCase() || null;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '8', 10) || 8, 1), 20);
  if (q.length < 2) return NextResponse.json({ places: [] });
  try {
    const { data, error } = await getSupabaseAdmin().rpc('search_places', {
      q,
      max_results: limit,
      p_country_code: country,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code !== '42883' && code !== 'PGRST202') console.error('[places] search_places failed:', error.message);
      return NextResponse.json({ places: [] });
    }
    const places: PlaceSuggestion[] = ((data ?? []) as {
      id: string; name: string; region: string | null; region_code: string | null;
      country: string; country_code: string; lat: number; lng: number;
    }[]).map(p => ({
      id: p.id,
      name: p.name,
      region: p.region,
      regionCode: p.region_code,
      country: p.country,
      countryCode: p.country_code,
      lat: p.lat,
      lng: p.lng,
      label: formatPlace({ city: p.name, region: p.region, country: p.country }),
    }));
    return NextResponse.json({ places });
  } catch (error) {
    console.error('[places] error:', error);
    return NextResponse.json({ places: [] });
  }
}
