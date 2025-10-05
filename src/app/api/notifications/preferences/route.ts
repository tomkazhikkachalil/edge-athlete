import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth-server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const { data: preferences, error } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[NOTIFICATIONS API] Error fetching preferences:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If no preferences exist, create default ones
    if (!preferences) {
      const { data: newPreferences, error: createError } = await supabaseAdmin
        .from('notification_preferences')
        .insert({ user_id: user.id })
        .select()
        .single();

      if (createError) {
        console.error('[NOTIFICATIONS API] Error creating preferences:', createError);
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }

      return NextResponse.json({ preferences: newPreferences });
    }

    return NextResponse.json({ preferences });

  } catch (error) {
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch preferences' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();

    console.log('[NOTIFICATIONS API] Updating preferences for user:', user.id);

    const { data: preferences, error } = await supabaseAdmin
      .from('notification_preferences')
      .update(body)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[NOTIFICATIONS API] Error updating preferences:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      preferences
    });

  } catch (error) {
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update preferences' },
      { status: 500 }
    );
  }
}
