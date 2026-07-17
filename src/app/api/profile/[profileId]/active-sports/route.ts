import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';

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
    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const [{ data: profile }, { data: posts }] = await Promise.all([
      supabase.from('profiles').select('sport').eq('id', profileId).single(),
      supabase
        .from('posts')
        .select('sport_key')
        .eq('profile_id', profileId)
        .not('sport_key', 'is', null),
    ]);

    const resolveKey = (label: string | null): SportKey | null => {
      if (!label) return null;
      const lower = label.toLowerCase();
      if (lower in SPORT_REGISTRY) return lower as SportKey;
      const match = Object.values(SPORT_REGISTRY).find(
        d => d.display_name.toLowerCase() === lower
      );
      return match ? match.sport_key : null;
    };

    const active = new Set<SportKey>();

    // Declared sport first (so it leads)
    const declared = resolveKey(profile?.sport ?? null);
    if (declared && SPORT_REGISTRY[declared]?.enabled) active.add(declared);

    // Sports they've posted in (enabled, non-cross-cutting)
    for (const p of posts || []) {
      const raw = p.sport_key as string | null;
      if (!raw || raw === 'general' || raw === 'training') continue;
      const key = raw as SportKey;
      if (SPORT_REGISTRY[key]?.enabled) {
        active.add(key);
      }
    }

    // Order: declared first, then registry order for the rest
    const ordered: SportKey[] = [];
    if (declared && active.has(declared)) ordered.push(declared);
    for (const key of Object.keys(SPORT_REGISTRY) as SportKey[]) {
      if (active.has(key) && !ordered.includes(key)) ordered.push(key);
    }

    return NextResponse.json({ sportKeys: ordered });
  } catch (e) {
    console.error('[active-sports] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
