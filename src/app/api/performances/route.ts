import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.performanceData || !body.userId) {
      return NextResponse.json({ error: 'Performance data and user ID are required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const performanceData = {
      ...body.performanceData,
      profile_id: body.userId,
      updated_at: new Date().toISOString()
    };

    // Set created_at only for new records
    if (!body.performanceData.id) {
      performanceData.created_at = new Date().toISOString();
    }

    // Insert or update performance based on whether ID exists
    let data, error;
    if (body.performanceData.id) {
      // Update existing performance
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('performances')
        .update(performanceData)
        .eq('id', body.performanceData.id)
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
    console.error('Performance save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}