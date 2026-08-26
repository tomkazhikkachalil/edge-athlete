import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { getSportSettingsDisplay, type SettingsDisplayItem } from '@/lib/sports/settings-schemas';
import type { SportKey } from '@/lib/sports';

/**
 * GET /api/profile/[profileId]/sport-settings
 *
 * An athlete's declared per-sport details (position, jersey number,
 * handedness, golf handicap/home course) for display on their profile.
 * Public profiles are readable by anyone including logged-out visitors;
 * private profiles by the owner and accepted followers only.
 *
 * WHY THIS ROUTE EXISTS, rather than a param on an existing one:
 * - `/api/sport-settings` hard-scopes every handler to `user.id`. Adding an
 *   anonymous-readable branch to a route whose PUT/DELETE assume "everything
 *   here is mine" is the wrong place for it.
 * - `/api/profile/[profileId]/active-sports` reads this same table ungated,
 *   which its header justifies precisely because it exposes only `sport_key`
 *   and never `settings`. Returning settings there would silently invalidate
 *   that reasoning.
 *
 * RLS on `sport_settings` is owner-only SELECT, so the admin client is
 * required — which means THIS ROUTE owns the privacy gate. It is modelled on
 * `/api/vitals`, deliberately using optional auth rather than `canViewProfile`
 * (which returns false for a null viewer even on a public profile, and would
 * therefore break logged-out viewing of `/u/[username]`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }
    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Optional auth — a logged-out visitor may still read a public profile.
    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      currentUserId = null;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, visibility')
      .eq('id', profileId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const isOwner = currentUserId === profileId;
    const isPublic = profile.visibility === 'public';

    if (!isOwner && !isPublic) {
      if (!currentUserId) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
      const { data: followRecord } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', currentUserId)
        .eq('following_id', profileId)
        .eq('status', 'accepted')
        .maybeSingle();
      if (!followRecord) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }

    const { data: rows, error } = await supabase
      .from('sport_settings')
      .select('sport_key, settings')
      .eq('profile_id', profileId);

    if (error) {
      console.error('Error fetching sport settings:', error);
      return NextResponse.json({ error: 'Failed to fetch sport settings' }, { status: 500 });
    }

    // Shape for display HERE, not in the view. Two guarantees then belong to
    // the API surface rather than to one component a future consumer might
    // forget to imitate:
    //   1. keys no schema declares (legacy `driver_brand` from the retired
    //      golf-equipment tab) never cross the wire;
    //   2. the empty `{}` rows onboarding writes for every declared sport are
    //      omitted entirely, so a sport with nothing to show is simply absent.
    const sportSettings: Record<string, SettingsDisplayItem[]> = {};
    for (const row of rows || []) {
      const items = getSportSettingsDisplay(row.sport_key as SportKey, row.settings);
      if (items.length > 0) sportSettings[row.sport_key] = items;
    }

    return NextResponse.json({ sportSettings });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Sport settings GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
