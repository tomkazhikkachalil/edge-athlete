import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { getAllSports } from '@/lib/sports/SportRegistry';
import { MAX_FAVOURITE_SPORTS, sanitizeFavouriteSports } from '@/lib/sports/favourite-sports';
import { writeFavouriteSports } from '@/lib/sports/favourites-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * PATCH /api/settings/favourite-sports — save the caller's OWN favourite
 * sports for the post composer's picker (profiles.favourite_sports, 285).
 *   { sports: string[] } → { sports: string[] } — the WHOLE list, sanitized:
 *   unknown keys and duplicates are dropped, the stored array is sorted.
 *
 * Always `.eq('id', user.id)` — the favourites belong to the ACCOUNT, never
 * to a guardian-managed activeProfile, so no targetProfileId is accepted.
 * The client reads them back off useAuth().profile; no GET here.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const Body = z.object({ sports: z.array(z.string().max(32)).max(MAX_FAVOURITE_SPORTS) });

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'favourite-sports', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const known = getAllSports().map(s => s.sport_key);
    const sports = sanitizeFavouriteSports(parsed.data.sports, known);
    const out = await writeFavouriteSports(getSupabaseAdmin(), user.id, sports);
    if (!out.ok) return NextResponse.json({ error: 'Could not save your favourites' }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ sports }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[PATCH /api/settings/favourite-sports]', error);
    return NextResponse.json({ error: 'Could not save your favourites' }, { status: 500, headers: NO_STORE });
  }
}
