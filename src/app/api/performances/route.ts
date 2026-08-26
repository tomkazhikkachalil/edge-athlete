import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    // Auth required — the acting profile is the session user, never the body.
    const user = await requireAuth(request);

    const body = await request.json();

    if (!body.performanceData) {
      return NextResponse.json({ error: 'Performance data is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const performanceData = {
      ...body.performanceData,
      profile_id: user.id, // force ownership to the session user
      updated_at: new Date().toISOString()
    };

    // Set created_at only for new records
    if (!body.performanceData.id) {
      performanceData.created_at = new Date().toISOString();
    }

    // Insert or update performance based on whether ID exists
    let data, error;
    if (body.performanceData.id) {
      // Update existing performance — only if the caller owns the row
      const { data: existing } = await supabaseAdmin
        .from('performances')
        .select('profile_id')
        .eq('id', body.performanceData.id)
        .single();
      if (!existing || existing.profile_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('performances')
        .update(performanceData)
        .eq('id', body.performanceData.id)
        .eq('profile_id', user.id)
        .select()
        .single();
      data = updateData;
      error = updateError;
    } else {
      // Insert new performance
      const { data: insertData, error: insertError } = await supabaseAdmin
        .from('performances')
        .insert(performanceData)
        .select()
        .single();
      data = insertData;
      error = insertError;
    }

    if (error) {
      console.error('Performance save error:', error);
      return NextResponse.json({ error: 'Failed to save performance' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      performance: data,
      message: 'Performance saved successfully'
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Performance save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}