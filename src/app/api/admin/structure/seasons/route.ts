import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { SeasonCreateSchema } from '@/lib/structure/validate';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure/seasons — per-org seasons (0.5, admin-only v1) ─────

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, SeasonCreateSchema);
    if (!parsed.success) return parsed.response;
    const { side, orgId, label, startsOn, endsOn, sportKey } = parsed.data;

    if (sportKey && !isSportEnabled(sportKey as SportKey)) {
      return NextResponse.json({ error: `Unknown or disabled sport: ${sportKey}` }, { status: 400 });
    }
    const { data: org } = await supabase
      .from(side === 'league' ? 'leagues' : 'clubs')
      .select('id')
      .eq('id', orgId)
      .maybeSingle();
    if (!org) {
      return NextResponse.json(
        { error: side === 'league' ? 'League not found' : 'Club not found' },
        { status: 404 }
      );
    }

    const { data: season, error } = await supabase
      .from('seasons')
      .insert({
        [side === 'league' ? 'league_id' : 'club_id']: orgId,
        label,
        starts_on: startsOn ?? null,
        ends_on: endsOn ?? null,
        sport_key: sportKey ?? null,
      })
      .select()
      .single();
    if (error || !season) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'A season with that label already exists' }, { status: 409 });
      }
      console.error('[ADMIN STRUCTURE] season insert error:', error);
      return NextResponse.json({ error: 'Failed to create season' }, { status: 500 });
    }
    return NextResponse.json({ season });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] seasons POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — divisions and their entries CASCADE; teams persist. */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data: deleted, error } = await supabase.from('seasons').delete().eq('id', id).select('id');
    if (error) {
      console.error('[ADMIN STRUCTURE] season delete error:', error);
      return NextResponse.json({ error: 'Failed to delete season' }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }
    return NextResponse.json({ action: 'deleted' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] seasons DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
