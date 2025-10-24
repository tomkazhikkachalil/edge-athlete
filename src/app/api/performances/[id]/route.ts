import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const performanceId = params.id;

    if (!performanceId) {
      return NextResponse.json({ error: 'Performance ID is required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Delete the performance
    const { error } = await supabaseAdmin
      .from('performances')
      .delete()
      .eq('id', performanceId);

    if (error) {
      console.error('Performance delete error:', error);
      return NextResponse.json({ error: 'Failed to delete performance' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Performance deleted successfully'
    });

  } catch (error) {
    console.error('Performance delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}