import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { TeamCreateSchema, TeamPatchSchema } from '@/lib/structure/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure/teams — persistent teams (0.5) ─────────────────────
// Teams PERSIST: the console's remove is PATCH status='archived'; DELETE
// stays for admin mistake-cleanup only (entries cascade).

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, TeamCreateSchema);
    if (!parsed.success) return parsed.response;
    const { side, orgId, name, displayName } = parsed.data;

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

    const { data: team, error } = await supabase
      .from('teams')
      .insert({
        [side === 'league' ? 'league_id' : 'club_id']: orgId,
        name,
        display_name: displayName ?? null,
      })
      .select()
      .single();
    if (error || !team) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'A team with that name already exists' }, { status: 409 });
      }
      console.error('[ADMIN STRUCTURE] team insert error:', error);
      return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
    }
    return NextResponse.json({ team });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] teams POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { id, status } — archive/unarchive. */
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, TeamPatchSchema);
    if (!parsed.success) return parsed.response;

    const { data: updated, error } = await supabase
      .from('teams')
      .update({ status: parsed.data.status })
      .eq('id', parsed.data.id)
      .select('id');
    if (error) {
      console.error('[ADMIN STRUCTURE] team patch error:', error);
      return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    return NextResponse.json({ action: parsed.data.status === 'archived' ? 'archived' : 'restored' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] teams PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — admin mistake-cleanup only; entries cascade. */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data: deleted, error } = await supabase.from('teams').delete().eq('id', id).select('id');
    if (error) {
      console.error('[ADMIN STRUCTURE] team delete error:', error);
      return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    return NextResponse.json({ action: 'deleted' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] teams DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
