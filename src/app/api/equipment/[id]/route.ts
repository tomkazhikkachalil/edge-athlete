import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// PATCH - Update equipment (e.g., toggle status)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

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

    // Update equipment
    const updates: Record<string, unknown> = {};
    if (body.status) {
      updates.status = body.status;
      if (body.status === 'retired') {
        updates.retired_at = new Date().toISOString();
      } else if (body.status === 'active') {
        updates.retired_at = null; // Clear retired timestamp if reactivated
      }
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
