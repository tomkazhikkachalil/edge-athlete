import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { buildSportSkillCards } from '@/lib/sports/server';

/**
 * GET /api/profile/[profileId]/skill-cards
 *
 * The profile's per-sport skill cards (computed tracked metrics + self-
 * reported credentials, provenance-tagged) — the /athlete routes' data
 * source; /u/[username] gets the same cards embedded in /api/public/profile.
 *
 * Gate modelled verbatim on the sport-settings sibling route: public
 * profiles readable by anyone including logged-out visitors; private
 * profiles by the owner and accepted followers only. RLS on the underlying
 * tables is owner-only, so the admin client is required — which means THIS
 * ROUTE owns the privacy gate.
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

    // Guardian parity (Family Console Wave 1): a guardian reads their managed
    // athlete's data exactly as the owner does. This check used to be
    // owner-only, which sent guardians down the follower/privacy path —
    // "guardian-blind". Lazy: the role lookup only runs for non-owners.
    const isOwner = currentUserId === profileId ||
      (!!currentUserId && (await getProfileRole(currentUserId, profileId)) === 'guardian');
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

    const skillCards = await buildSportSkillCards(profileId, supabase);

    // Short private cache: the golf card recomputes the handicap from up to
    // 60 rounds per call, and a profile view often triggers a handful of
    // near-simultaneous requests.
    return NextResponse.json(
      { skillCards },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Skill cards GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
