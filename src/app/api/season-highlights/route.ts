import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { SeasonHighlight } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    // Auth required — the owner is the session user, never the body's userId.
    const user = await requireAuth(request);

    const body = await request.json();

    if (!body.highlightData) {
      return NextResponse.json({ error: 'Season highlight data is required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const highlightData = {
      ...body.highlightData,
      profile_id: user.id, // force ownership to the session user
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
    if (error instanceof Response) return error;
    console.error('Season highlight save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}