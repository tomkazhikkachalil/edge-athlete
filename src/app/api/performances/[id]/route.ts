import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-server';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const params = await context.params;
    const performanceId = params.id;

    if (!performanceId) {
      return NextResponse.json({ error: 'Performance ID is required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Only the owner may delete. Scope the delete to the caller's profile_id
    // so a non-owner's request affects zero rows even if the row exists.
    const { data: existing } = await supabaseAdmin
      .from('performances')
      .select('profile_id')
      .eq('id', performanceId)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (existing.profile_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete the performance (scoped to owner)
    const { error } = await supabaseAdmin
      .from('performances')
      .delete()
      .eq('id', performanceId)
      .eq('profile_id', user.id);

    if (error) {
      console.error('Performance delete error:', error);
      return NextResponse.json({ error: 'Failed to delete performance' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Performance deleted successfully'
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Performance delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}