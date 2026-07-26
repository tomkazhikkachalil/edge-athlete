import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { validateAchievementInput } from '@/lib/achievements';

/**
 * PATCH /api/achievements/[id]
 * Edit an achievement (owner only). All fields optional:
 * { title?, achievedOn?, description?, sportKey?, organization?, placement? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    // Verify ownership
    const { data: achievement, error: fetchError } = await supabase
      .from('athlete_achievements')
      .select('profile_id')
      .eq('id', id)
      .single();

    if (fetchError || !achievement) {
      return NextResponse.json({ error: 'Achievement not found' }, { status: 404 });
    }
    if (achievement.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const validated = validateAchievementInput(body, { partial: true });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    if (Object.keys(validated.fields).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('athlete_achievements')
      .update(validated.fields)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating achievement:', updateError);
      return NextResponse.json({ error: 'Failed to update achievement' }, { status: 500 });
    }

    return NextResponse.json({ achievement: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PATCH /api/achievements/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update achievement' }, { status: 500 });
  }
}

/**
 * DELETE /api/achievements/[id]
 * Remove an achievement (owner only).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;

    // Verify ownership
    const { data: achievement, error: fetchError } = await supabase
      .from('athlete_achievements')
      .select('profile_id')
      .eq('id', id)
      .single();

    if (fetchError || !achievement) {
      return NextResponse.json({ error: 'Achievement not found' }, { status: 404 });
    }
    if (achievement.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from('athlete_achievements')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting achievement:', deleteError);
      return NextResponse.json({ error: 'Failed to delete achievement' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('DELETE /api/achievements/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete achievement' }, { status: 500 });
  }
}
