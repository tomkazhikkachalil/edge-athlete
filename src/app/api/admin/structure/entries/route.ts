import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { EntryCreateSchema } from '@/lib/structure/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure/entries — team ↔ division placement (0.5) ──────────
// The PAIR shape (Tom's amendment): season derives through the division.
// The app-layer team.org == division.org rule lives HERE, once.

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const parsed = await parseBody(request, EntryCreateSchema);
    if (!parsed.success) return parsed.response;
    const { teamId, divisionId } = parsed.data;

    const [teamRes, divisionRes] = await Promise.all([
      supabase.from('teams').select('id, league_id, club_id, status').eq('id', teamId).maybeSingle(),
      supabase.from('divisions').select('id, league_id, club_id').eq('id', divisionId).maybeSingle(),
    ]);
    if (!teamRes.data) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    if (!divisionRes.data) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    if (
      teamRes.data.league_id !== divisionRes.data.league_id ||
      teamRes.data.club_id !== divisionRes.data.club_id
    ) {
      return NextResponse.json(
        { error: "The team and division belong to different organizations" },
        { status: 400 }
      );
    }
    if (teamRes.data.status === 'archived') {
      return NextResponse.json({ error: 'Archived teams can’t be entered — restore first' }, { status: 400 });
    }

    const { data: entry, error } = await supabase
      .from('team_entries')
      .insert({ team_id: teamId, division_id: divisionId })
      .select()
      .single();
    if (error || !entry) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'Already entered in this division' }, { status: 409 });
      }
      console.error('[ADMIN STRUCTURE] entry insert error:', error);
      return NextResponse.json({ error: 'Failed to enter the team' }, { status: 500 });
    }
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] entries POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — withdraw an entry. */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data: deleted, error } = await supabase.from('team_entries').delete().eq('id', id).select('id');
    if (error) {
      console.error('[ADMIN STRUCTURE] entry delete error:', error);
      return NextResponse.json({ error: 'Failed to remove the entry' }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    return NextResponse.json({ action: 'deleted' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] entries DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
