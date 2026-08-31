import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/venues/[id] — delete only v1 (edits = delete + recreate at
// admin scale; a PATCH arrives with phase 1's org dashboard if needed). ─────

/** DELETE — remove a venue. Facilities CASCADE; events SET NULL. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }
    const supabase = getSupabaseAdmin();

    const { data: deleted, error } = await supabase
      .from('venues')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      console.error('[ADMIN VENUES] delete error:', error);
      return NextResponse.json({ error: 'Failed to delete venue' }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }
    return NextResponse.json({ action: 'deleted' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN VENUES] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
