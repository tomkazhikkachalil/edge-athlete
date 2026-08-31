import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { FacilityCreateSchema } from '@/lib/venues/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/venues/[id]/facilities — the "forgot a court" routes ─────────

/** POST { name, kind? } — add a facility to an existing venue. */
export async function POST(
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

    const { data: venue } = await supabase.from('venues').select('id').eq('id', id).maybeSingle();
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const parsed = await parseBody(request, FacilityCreateSchema);
    if (!parsed.success) return parsed.response;

    const { data: facility, error } = await supabase
      .from('facilities')
      .insert({ venue_id: id, name: parsed.data.name, kind: parsed.data.kind ?? null })
      .select()
      .single();
    if (error || !facility) {
      console.error('[ADMIN VENUES] facility insert error:', error);
      return NextResponse.json({ error: 'Failed to add facility' }, { status: 500 });
    }
    return NextResponse.json({ facility });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN VENUES] facilities POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?facilityId= — remove one facility (events referencing it SET NULL). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const facilityId = searchParams.get('facilityId');
    if (!UUID_RE.test(id) || !facilityId || !UUID_RE.test(facilityId)) {
      return NextResponse.json({ error: 'facilityId is required' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();

    const { data: deleted, error } = await supabase
      .from('facilities')
      .delete()
      .eq('id', facilityId)
      .eq('venue_id', id)
      .select('id');
    if (error) {
      console.error('[ADMIN VENUES] facility delete error:', error);
      return NextResponse.json({ error: 'Failed to remove facility' }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Facility not found' }, { status: 404 });
    }
    return NextResponse.json({ action: 'deleted' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN VENUES] facilities DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
