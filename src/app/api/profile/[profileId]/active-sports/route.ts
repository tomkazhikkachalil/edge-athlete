import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { computeActiveSports } from '@/lib/sports/active-sports';

/**
 * GET /api/profile/[profileId]/active-sports
 *
 * Returns the sports a profile actually participates in — used to decide
 * which sport cards/tabs to show on their profile (instead of every enabled
 * sport, which would render mostly-empty cards once many sports are on).
 *
 * Active = the profile's declared `sport` (resolved to a key) UNION any
 * enabled sport they have posts in. Excludes cross-cutting types
 * ('general', 'training'). Falls back to the declared sport, then to a small
 * teaser set, so the profile is never blank.
 *
 * Only reads which sport_keys exist (not post contents), so it's safe to
 * expose without per-post privacy checks — but we still exclude private-post
 * sports for non-owners is unnecessary here since a sport_key is not
 * sensitive. Requires no auth beyond what the profile page already enforces.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!profileId || !isUuid(profileId)) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Declared label ∪ posted sports ∪ intake-declared sport_settings rows.
    // Sport keys are not sensitive, so the admin read is fine (see header).
    const [{ data: profile }, { data: posts }, { data: settings }] = await Promise.all([
      supabase.from('profiles').select('sport').eq('id', profileId).single(),
      supabase
        .from('posts')
        .select('sport_key')
        .eq('profile_id', profileId)
        .not('sport_key', 'is', null),
      supabase.from('sport_settings').select('sport_key').eq('profile_id', profileId),
    ]);

    const ordered = computeActiveSports({
      declaredSport: profile?.sport ?? null,
      postSportKeys: (posts || []).map(p => p.sport_key as string | null),
      settingsSportKeys: (settings || []).map(s => s.sport_key as string),
    });

    return NextResponse.json({ sportKeys: ordered });
  } catch (e) {
    console.error('[active-sports] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
