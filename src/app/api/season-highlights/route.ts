import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { SeasonHighlight } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.highlightData || !body.userId) {
      return NextResponse.json({ error: 'Season highlight data and user ID are required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const highlightData = {
      ...body.highlightData,
      profile_id: body.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as SeasonHighlight;

    // Insert or update season highlight
    const { data, error } = await supabaseAdmin
      .from('season_highlights')
      .upsert(highlightData, {
        onConflict: 'profile_id,sport_key,season'
      })
      .select()
      .single();

    if (error) {
      console.error('Season highlight save error:', error);
      return NextResponse.json({ error: 'Failed to save season highlight' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      highlight: data,
      message: 'Season highlight saved successfully'
    });

  } catch (error) {
    console.error('Season highlight save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}