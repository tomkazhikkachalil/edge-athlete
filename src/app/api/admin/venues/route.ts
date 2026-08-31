import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { VenueCreateSchema, placeToVenueColumns, isMissingTableError } from '@/lib/venues/validate';

// ── /api/admin/venues — venue + facility curation (0.4, admin-only v1) ──────
// Orphan venues are the v1 create shape (Tom, Aug 30): the owning-org pair
// exists in the schema but gains a writer with phase 1's org dashboard.

/** POST — create a venue, optionally with inline facilities. */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, VenueCreateSchema);
    if (!parsed.success) return parsed.response;
    const { name, place, golfClubId, facilities } = parsed.data;

    if (golfClubId) {
      const { data: golfClub } = await supabase
        .from('golf_clubs')
        .select('id')
        .eq('id', golfClubId)
        .maybeSingle();
      if (!golfClub) {
        return NextResponse.json({ error: 'Golf club not found' }, { status: 404 });
      }
    }

    const { data: venue, error } = await supabase
      .from('venues')
      .insert({
        name,
        golf_club_id: golfClubId ?? null,
        ...placeToVenueColumns(place),
      })
      .select()
      .single();
    if (error || !venue) {
      console.error('[ADMIN VENUES] insert error:', error);
      return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 });
    }

    let facilityRows: unknown[] = [];
    if (facilities && facilities.length > 0) {
      const { data: created, error: facilityError } = await supabase
        .from('facilities')
        .insert(facilities.map(f => ({ venue_id: venue.id, name: f.name, kind: f.kind ?? null })))
        .select();
      if (facilityError) {
        // No PostgREST transaction: keep the venue, report the partial state.
        console.error('[ADMIN VENUES] facilities insert error:', facilityError);
        return NextResponse.json(
          { error: 'Venue created but facilities failed — add them individually' },
          { status: 500 }
        );
      }
      facilityRows = created ?? [];
    }

    return NextResponse.json({ venue: { ...venue, facilities: facilityRows } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN VENUES] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET — list venues with facilities and linked names for the console. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const { data: venues, error } = await supabase
      .from('venues')
      .select('id, name, league_id, club_id, golf_club_id, city, region, country, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      // Pre-141 database: an empty console, not a broken one.
      if (isMissingTableError(error.code)) return NextResponse.json({ venues: [] });
      console.error('[ADMIN VENUES] list error:', error);
      return NextResponse.json({ error: 'Failed to list venues' }, { status: 500 });
    }

    const list = venues ?? [];
    const venueIds = list.map(v => v.id);
    const golfClubIds = [...new Set(list.map(v => v.golf_club_id).filter((id): id is string => !!id))];

    const [facilitiesRes, golfRes] = await Promise.all([
      venueIds.length
        ? supabase.from('facilities').select('id, venue_id, name, kind').in('venue_id', venueIds)
        : Promise.resolve({ data: [] as Array<{ id: string; venue_id: string; name: string; kind: string | null }> }),
      golfClubIds.length
        ? supabase.from('golf_clubs').select('id, name').in('id', golfClubIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ]);

    const facilitiesByVenue = new Map<string, Array<{ id: string; name: string; kind: string | null }>>();
    for (const f of facilitiesRes.data ?? []) {
      if (!facilitiesByVenue.has(f.venue_id)) facilitiesByVenue.set(f.venue_id, []);
      facilitiesByVenue.get(f.venue_id)!.push({ id: f.id, name: f.name, kind: f.kind });
    }
    const golfNames = new Map((golfRes.data ?? []).map(g => [g.id, g.name]));

    return NextResponse.json({
      venues: list.map(v => ({
        ...v,
        facilities: facilitiesByVenue.get(v.id) ?? [],
        golfClubName: v.golf_club_id ? golfNames.get(v.golf_club_id) ?? null : null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN VENUES] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
