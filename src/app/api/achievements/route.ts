import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { validateAchievementInput } from '@/lib/achievements';

/**
 * GET /api/achievements?profileId=xxx
 * All achievements for a profile, newest first. Public profiles are visible
 * without auth; private profiles require owner or accepted-follower auth
 * (same access model as /api/vitals).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (profileId && !isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }

    if (!profileId) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    // Optional auth — needed for private profile access
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
      // Allow approved followers to view private profile achievements
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

    const { data: achievements, error } = await supabase
      .from('athlete_achievements')
      .select('*')
      .eq('profile_id', profileId)
      .order('achieved_on', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching achievements:', error);
      return NextResponse.json({ error: 'Failed to fetch achievements' }, { status: 500 });
    }

    return NextResponse.json({ achievements: achievements || [] });
  } catch (error) {
    console.error('GET /api/achievements error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/achievements
 * Add an achievement for the authenticated user.
 * Body: { title, achievedOn, description?, sportKey?, organization?, placement? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    const body = await request.json();
    const validated = validateAchievementInput(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('athlete_achievements')
      .insert({ profile_id: user.id, ...validated.fields })
      .select()
      .single();

    if (error) {
      console.error('Error inserting achievement:', error);
      return NextResponse.json({ error: 'Failed to save achievement' }, { status: 500 });
    }

    return NextResponse.json({ achievement: data }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/achievements error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
