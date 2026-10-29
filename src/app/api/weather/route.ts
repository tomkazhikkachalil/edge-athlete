import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError, reportRouteWarning } from '@/lib/observability/report';
import { parseCoords, roundCoord, WEATHER_ATTRIBUTION } from '@/lib/weather/weather';
import { fetchWeather, weatherConfig, WEATHER_BUDGET_KEY, WEATHER_DAILY_BUDGET } from '@/lib/weather/weather-server';
import { hitDailyBudget } from '@/lib/provider-budget-server';

// GET /api/weather?lat=&lng= — the current conditions at a 2-decimal cell
// (Oct 29 2026). Public and viewer-independent BY CONSTRUCTION: no auth, no
// cookie read, no Vary — the same cell answers the same for everyone, so the
// CDN holds it for 10 minutes (the golf course's coordinates are public
// catalog data; a live round at a busy course costs one provider call). An
// IP bucket and a provider day budget stand in front of the free host; every
// failure is `no-store` and a short message — on screen weather is never an
// error, the button just says nothing came. Nothing about the caller or the
// cell is logged or stored.

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(request: NextRequest) {
  try {
    const cfg = weatherConfig();
    if (!cfg) return fail(503, 'Weather is not available');

    const coords = parseCoords(request.nextUrl.searchParams.get('lat'), request.nextUrl.searchParams.get('lng'));
    if (!coords) return fail(400, 'lat and lng are required');

    const limited = await enforceRateLimit(request, 'weather');
    if (limited) return limited;

    const cell = roundCoord(coords.lat, coords.lng);
    const allowed = await hitDailyBudget(getSupabaseAdmin(), WEATHER_BUDGET_KEY, WEATHER_DAILY_BUDGET);
    if (!allowed) {
      reportRouteWarning('[weather] budget refused', { key: WEATHER_BUDGET_KEY });
      return fail(503, 'Weather is busy right now');
    }

    const result = await fetchWeather(cell.lat, cell.lng, { cfg });
    if (!result.ok) {
      reportRouteWarning('[weather] provider', { reason: result.reason, mock: cfg.mock });
      if (result.reason === 'timeout') return fail(504, 'Weather is slow right now');
      return fail(502, 'Weather is not available right now');
    }

    return NextResponse.json(
      { weather: result.weather, attribution: WEATHER_ATTRIBUTION },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' } }
    );
  } catch (error) {
    reportRouteError('[weather] GET:', error);
    return fail(500, 'Internal server error');
  }
}
