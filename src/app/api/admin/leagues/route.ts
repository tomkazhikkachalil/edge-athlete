import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { LeagueCreateSchema, placeToLeagueColumns, isMissingTableError } from '@/lib/leagues/validate';
import { createLeagueWithOwner } from '@/lib/leagues/create';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';

// ── /api/admin/leagues — direct admin league creation ───────────────────────
// The dashboard picks a name, sport, place and an owner profile. Since 116
// leagues are ALSO born from approved self-service requests
// (/api/admin/league-requests) — both paths share createLeagueWithOwner,
// the one place a league and its owner row are created.

/** POST — create a league and its owner membership row. Admin-only. */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, LeagueCreateSchema);
    if (!parsed.success) return parsed.response;
    const { name, sportKey, description, ownerProfileId, place } = parsed.data;

    // sport_key is app-validated (no DB enum — the registry is app-side).
    if (!isSportEnabled(sportKey as SportKey)) {
      return NextResponse.json({ error: `Unknown or disabled sport: ${sportKey}` }, { status: 400 });
    }

    const { data: owner } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', ownerProfileId)
      .maybeSingle();
    if (!owner) {
      return NextResponse.json({ error: 'Owner profile not found' }, { status: 404 });
    }

    const result = await createLeagueWithOwner(supabase, {
      name,
      description: description ?? null,
      sportKey,
      ownerProfileId,
      placeColumns: placeToLeagueColumns(place),
    });
    if ('error' in result) {
      return NextResponse.json({ error: 'Failed to create league' }, { status: 500 });
    }

    return NextResponse.json({ league: result.league });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN LEAGUES] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET — list leagues for the dashboard (member counts + owner names). */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const { data: leagues, error } = await supabase
      .from('leagues')
      .select('id, name, description, sport_key, owner_profile_id, city, region, country, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      // Pre-113 database: an empty console, not a broken one.
      if (isMissingTableError(error.code)) return NextResponse.json({ leagues: [] });
      console.error('[ADMIN LEAGUES] list error:', error);
      return NextResponse.json({ error: 'Failed to list leagues' }, { status: 500 });
    }

    const list = leagues ?? [];
    const leagueIds = list.map(l => l.id);
    const ownerIds = [...new Set(list.map(l => l.owner_profile_id).filter((id): id is string => !!id))];

    const [membersRes, ownersRes] = await Promise.all([
      leagueIds.length
        ? supabase.from('league_members').select('league_id').in('league_id', leagueIds)
        : Promise.resolve({ data: [] as Array<{ league_id: string }> }),
      ownerIds.length
        ? supabase.from('profiles').select('id, first_name, last_name, full_name').in('id', ownerIds)
        : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null }> }),
    ]);

    const counts = new Map<string, number>();
    for (const row of membersRes.data ?? []) {
      counts.set(row.league_id, (counts.get(row.league_id) ?? 0) + 1);
    }
    const owners = new Map((ownersRes.data ?? []).map(o => [o.id, o]));

    return NextResponse.json({
      leagues: list.map(l => ({
        ...l,
        memberCount: counts.get(l.id) ?? 0,
        owner: l.owner_profile_id ? owners.get(l.owner_profile_id) ?? null : null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN LEAGUES] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
