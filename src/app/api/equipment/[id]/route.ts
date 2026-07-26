import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isValidDateString, isNotFutureDate } from '@/lib/date-validation';

// PATCH - Update equipment (status and/or user-editable dates)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    // Verify ownership (status/dates fetched for date validation below)
    const { data: equipment, error: fetchError } = await supabase
      .from('athlete_equipment')
      .select('profile_id, status, acquired_on, retired_on')
      .eq('id', id)
      .single();

    if (fetchError || !equipment) {
      return NextResponse.json({ error: 'Equipment not found' }, { status: 404 });
    }

    if (equipment.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Update equipment
    const updates: Record<string, unknown> = {};
    if (body.status) {
      updates.status = body.status;
      if (body.status === 'retired') {
        updates.retired_at = new Date().toISOString();
        // User-facing retirement date defaults to today unless supplied below
        updates.retired_on = new Date().toISOString().slice(0, 10);
      } else if (body.status === 'active') {
        updates.retired_at = null; // Clear retired timestamps if reactivated
        updates.retired_on = null;
      }
    }

    // User-editable dates (additive — {status}-only callers unaffected)
    if (body.acquiredOn !== undefined) {
      if (!isValidDateString(body.acquiredOn) || !isNotFutureDate(body.acquiredOn)) {
        return NextResponse.json(
          { error: 'Active-since date must be a valid past date (YYYY-MM-DD)' },
          { status: 400 }
        );
      }
      updates.acquired_on = body.acquiredOn;
    }
    if (body.retiredOn !== undefined && body.retiredOn !== null && body.retiredOn !== '') {
      const willBeRetired = (body.status ?? equipment.status) === 'retired';
      if (!willBeRetired) {
        return NextResponse.json(
          { error: 'Retired date requires retired status' },
          { status: 400 }
        );
      }
      const acquired = (updates.acquired_on as string | undefined) ?? equipment.acquired_on;
      if (
        !isValidDateString(body.retiredOn) ||
        !isNotFutureDate(body.retiredOn) ||
        (acquired && body.retiredOn < acquired)
      ) {
        return NextResponse.json(
          { error: 'Retired date must be a valid date on or after the active-since date' },
          { status: 400 }
        );
      }
      updates.retired_on = body.retiredOn;
    }

    // Editing acquired_on later than an existing retired_on would violate the
    // DB constraint — surface a clear 400 instead of a 500.
    const finalAcquired = (updates.acquired_on as string | undefined) ?? equipment.acquired_on;
    const finalRetired =
      updates.retired_on !== undefined
        ? (updates.retired_on as string | null)
        : equipment.retired_on;
    if (finalAcquired && finalRetired && finalRetired < finalAcquired) {
      return NextResponse.json(
        { error: 'Active-since date must be on or before the retired date' },
        { status: 400 }
      );
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('athlete_equipment')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating equipment:', updateError);
      return NextResponse.json({ error: 'Failed to update equipment' }, { status: 500 });
    }

    return NextResponse.json({ equipment: updated });
  } catch (error) {
    console.error('Equipment PATCH error:', error);

    if (error instanceof Response) {
      return error;
    }

    return NextResponse.json({ error: 'Failed to update equipment' }, { status: 500 });
  }
}

// DELETE - Delete equipment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;

    // Verify ownership
    const { data: equipment, error: fetchError } = await supabase
      .from('athlete_equipment')
      .select('profile_id')
      .eq('id', id)
      .single();

    if (fetchError || !equipment) {
      return NextResponse.json({ error: 'Equipment not found' }, { status: 404 });
    }

    if (equipment.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Delete equipment
    const { error: deleteError } = await supabase
      .from('athlete_equipment')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting equipment:', deleteError);
      return NextResponse.json({ error: 'Failed to delete equipment' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Equipment DELETE error:', error);

    if (error instanceof Response) {
      return error;
    }

    return NextResponse.json({ error: 'Failed to delete equipment' }, { status: 500 });
  }
}
