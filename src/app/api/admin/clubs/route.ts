import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ClubCreateSchema, placeToClubColumns, isMissingTableError } from '@/lib/clubs/validate';
import { createClubWithOwner } from '@/lib/clubs/create';
import { memberCountsByOrg } from '@/lib/orgs/members';

// ── /api/admin/clubs — direct admin club creation + console list ─────────────
// Mirror of /api/admin/leagues (117): clubs are born from this route or from
// approved /api/admin/club-requests — both share createClubWithOwner. The
// 001 demo rows list with a null owner (reassignment UI is out of scope,
// league parity).

/** POST — create a club and its owner membership row. Admin-only. */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, ClubCreateSchema);
    if (!parsed.success) return parsed.response;
    const { name, description, ownerProfileId, place } = parsed.data;

    const { data: owner } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', ownerProfileId)
      .maybeSingle();
    if (!owner) {
      return NextResponse.json({ error: 'Owner profile not found' }, { status: 404 });
    }

    const result = await createClubWithOwner(supabase, {
      name,
      description: description ?? null,
      ownerProfileId,
      placeColumns: placeToClubColumns(place),
    });
    if ('error' in result) {
      return NextResponse.json({ error: 'Failed to create club' }, { status: 500 });
    }

    return NextResponse.json({ club: result.club });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN CLUBS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET — list clubs for the dashboard (member counts + owner names). */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const { data: clubs, error } = await supabase
      .from('clubs')
      .select('id, name, description, owner_profile_id, city, region, country, created_at, operates_teams, operates_competitions')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ clubs: [] });
      console.error('[ADMIN CLUBS] list error:', error);
      return NextResponse.json({ error: 'Failed to list clubs' }, { status: 500 });
    }

    const list = clubs ?? [];
    const clubIds = list.map(c => c.id);
    const ownerIds = [...new Set(list.map(c => c.owner_profile_id).filter((id): id is string => !!id))];

    const [counts, ownersRes] = await Promise.all([
      memberCountsByOrg(supabase, 'club', clubIds),
      ownerIds.length
        ? supabase.from('profiles').select('id, first_name, last_name, full_name').in('id', ownerIds)
        : Promise.resolve({ data: [] as Array<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null }> }),
    ]);
    const owners = new Map((ownersRes.data ?? []).map(o => [o.id, o]));

    return NextResponse.json({
      clubs: list.map(c => ({
        ...c,
        memberCount: counts.get(c.id) ?? 0,
        owner: c.owner_profile_id ? owners.get(c.owner_profile_id) ?? null : null,
      })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN CLUBS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
