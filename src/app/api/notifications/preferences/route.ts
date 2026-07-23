import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
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
        // 23505: two concurrent first-calls raced on the unique(user_id)
        // constraint — the row exists now, so fetch and return it.
        if (createError.code === '23505') {
          const { data: existing } = await supabaseAdmin
            .from('notification_preferences')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          if (existing) return NextResponse.json({ preferences: existing });
        }
        console.error('[NOTIFICATIONS API] Error creating preferences:', createError);
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }

      return NextResponse.json({ preferences: newPreferences });
    }

    return NextResponse.json({ preferences });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch preferences' },
      { status: 500 }
    );
  }
}

// Only the real boolean preference columns may be updated. Never pass the
// raw body to update() — this route runs on the admin client (bypasses RLS),
// so an unfiltered body could overwrite user_id/id (mass assignment).
const ALLOWED_PREFERENCE_KEYS = new Set([
  'follow_requests_enabled',
  'follow_accepted_enabled',
  'new_followers_enabled',
  'likes_enabled',
  'comments_enabled',
  'mentions_enabled',
  'tags_enabled',
  'achievements_enabled',
  'system_announcements_enabled',
  'club_updates_enabled',
  'push_enabled',
  'email_enabled',
]);

export async function PATCH(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);
    const body = await request.json();

    const updates: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      if (!ALLOWED_PREFERENCE_KEYS.has(key)) {
        return NextResponse.json({ error: `Unknown preference: ${key}` }, { status: 400 });
      }
      if (typeof value !== 'boolean') {
        return NextResponse.json({ error: `Preference ${key} must be a boolean` }, { status: 400 });
      }
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid preference fields provided' }, { status: 400 });
    }

    const { data: preferences, error } = await supabaseAdmin
      .from('notification_preferences')
      .update(updates)
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
    if (error instanceof Response) return error;
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update preferences' },
      { status: 500 }
    );
  }
}
