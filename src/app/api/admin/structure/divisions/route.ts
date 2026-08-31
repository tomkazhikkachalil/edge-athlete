import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { DivisionCreateSchema } from '@/lib/structure/validate';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure/divisions — per-season divisions (0.5) ─────────────
// The division inherits its org from the season (the app-layer
// division.org == season.org rule lives HERE, once — no cross-row CHECKs).

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, DivisionCreateSchema);
    if (!parsed.success) return parsed.response;
    const { seasonId, sportKey, name, ageBand, genderStream, tier, capacityEstimate } = parsed.data;

    if (!isSportEnabled(sportKey as SportKey)) {
      return NextResponse.json({ error: `Unknown or disabled sport: ${sportKey}` }, { status: 400 });
    }
    const { data: season } = await supabase
      .from('seasons')
      .select('id, league_id, club_id')
      .eq('id', seasonId)
      .maybeSingle();
    if (!season) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    const { data: division, error } = await supabase
      .from('divisions')
      .insert({
        // Org inherited from the season — the one place the rule is enforced.
        league_id: season.league_id,
        club_id: season.club_id,
        season_id: seasonId,
        sport_key: sportKey,
        name,
        age_band: ageBand ?? null,
        gender_stream: genderStream ?? null,
        tier: tier ?? null,
        capacity_estimate: capacityEstimate ?? null,
      })
      .select()
      .single();
    if (error || !division) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'A division with that name already exists in this season' }, { status: 409 });
      }
      console.error('[ADMIN STRUCTURE] division insert error:', error);
      return NextResponse.json({ error: 'Failed to create division' }, { status: 500 });
    }
    return NextResponse.json({ division });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] divisions POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — entries CASCADE; teams persist. */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data: deleted, error } = await supabase.from('divisions').delete().eq('id', id).select('id');
    if (error) {
      console.error('[ADMIN STRUCTURE] division delete error:', error);
      return NextResponse.json({ error: 'Failed to delete division' }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    }
    return NextResponse.json({ action: 'deleted' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] divisions DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
