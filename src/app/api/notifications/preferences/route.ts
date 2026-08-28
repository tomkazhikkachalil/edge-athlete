import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';

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
      return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
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
        return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
      }

      return NextResponse.json({ preferences: newPreferences, lockedFields: await lockedFieldsFor(user.id) });
    }

    return NextResponse.json({ preferences, lockedFields: await lockedFieldsFor(user.id) });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch preferences' },
      { status: 500 }
    );
  }
}

// Supervised minors cannot switch off the email channel: their digest is
// rerouted to their guardians (digest-server) and is the guardian's ambient
// window into the account — a child toggle that silences it would defeat a
// safety control. Strip, don't 403 (the profile-PUT precedent); the Settings
// UI renders the toggle locked via `lockedFields`.
async function lockedFieldsFor(userId: string): Promise<string[]> {
  const { data } = await getSupabaseAdmin()
    .from('profiles')
    .select('supervision_state')
    .eq('id', userId)
    .maybeSingle();
  return data?.supervision_state === 'supervised' ? ['email_enabled'] : [];
}

// Only the real boolean preference columns may be updated (each optional).
// Never pass the raw body to update() — this route runs on the admin client
// (bypasses RLS), so an unfiltered body could overwrite user_id/id (mass
// assignment). `.strict()` rejects any key not listed here.
const PreferencesSchema = z
  .object({
    follow_requests_enabled: z.boolean(),
    follow_accepted_enabled: z.boolean(),
    new_followers_enabled: z.boolean(),
    likes_enabled: z.boolean(),
    comments_enabled: z.boolean(),
    mentions_enabled: z.boolean(),
    tags_enabled: z.boolean(),
    achievements_enabled: z.boolean(),
    system_announcements_enabled: z.boolean(),
    club_updates_enabled: z.boolean(),
    push_enabled: z.boolean(),
    email_enabled: z.boolean(),
    // Urgent safety emails (135) — safety_alert/consent_result within ~10
    // minutes. ON by default; never locked (children are never urgent
    // recipients — their synthetic address is structurally unmailed).
    urgent_email_enabled: z.boolean(),
  })
  .partial()
  .strict();

export async function PATCH(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const user = await requireAuth(request);

    const parsed = await parseBody(request, PreferencesSchema);
    if (!parsed.success) return parsed.response;
    const updates = parsed.data;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid preference fields provided' }, { status: 400 });
    }

    if (updates.email_enabled !== undefined) {
      const locked = await lockedFieldsFor(user.id);
      if (locked.includes('email_enabled')) {
        delete updates.email_enabled;
        if (Object.keys(updates).length === 0) {
          // Nothing left to write — return the current row unchanged.
          const { data: current } = await supabaseAdmin
            .from('notification_preferences')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          return NextResponse.json({ success: true, preferences: current, lockedFields: locked });
        }
      }
    }

    const { data: preferences, error } = await supabaseAdmin
      .from('notification_preferences')
      .update(updates)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('[NOTIFICATIONS API] Error updating preferences:', error);
      return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      preferences
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[NOTIFICATIONS API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update preferences' },
      { status: 500 }
    );
  }
}
