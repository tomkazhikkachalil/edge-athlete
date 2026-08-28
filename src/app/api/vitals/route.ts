import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { filterVitalsRows, aspectHidden } from '@/lib/vitals-privacy';
import { fetchVitalsPrivacy } from '@/lib/vitals-privacy-server';
import { toProxyUrl } from '@/lib/media/proxy-url';

/**
 * GET /api/vitals?profileId=xxx
 * Returns all vitals entries + training posts + athlete birthday for a profile.
 * Public profiles are visible without auth; private profiles require owner auth.
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

    // Check profile visibility (+ current-state vitals for the summary strip)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, visibility, birthday, dob, height_cm, weight_kg, weight_display, weight_unit, first_name, avatar_url')
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
      // Allow approved followers to view private profile vitals
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

    // Vitals privacy (migration 122): the profile itself is viewable, so a
    // master-hidden section answers 200 with a hidden flag and empty
    // payloads — the client renders a friendly lock card, not an error.
    // Own query, not part of the select above: pre-122 it degrades to
    // all-visible instead of failing the route.
    const privacy = await fetchVitalsPrivacy(supabase, profileId);
    if (!isOwner && privacy.hidden) {
      return NextResponse.json({
        hidden: true,
        vitals: [],
        trainingPosts: [],
        athleteBirthday: null,
        currentVitals: null,
        profile: {
          firstName: profile.first_name ?? null,
          avatarUrl: profile.avatar_url ?? null,
        },
      });
    }
    const bodyHidden = aspectHidden(privacy, 'body', isOwner);

    // Vitals entries (immutable time-series, newest first). Bounded: without a
    // limit PostgREST silently caps at 1000 and would drop the OLDEST entries
    // once an athlete crossed it (a daily logger, inside a year), corrupting
    // every chart's baseline. 2000 newest covers years of real logging; the
    // dashboard derivations already operate on a bounded set. Full history
    // pagination is tracked in the hardening backlog.
    const { data: vitals, error: vitalsError } = await supabase
      .from('athlete_vitals')
      .select('*')
      .eq('profile_id', profileId)
      .order('recorded_at', { ascending: false })
      .limit(2000);

    if (vitalsError) {
      console.error('Error fetching vitals:', vitalsError);
      return NextResponse.json({ error: 'Failed to fetch vitals' }, { status: 500 });
    }

    // Fetch training posts for this profile (post_category = 'training',
    // migration 077 — 'training' is a category, not a sport_key, since then).
    // Non-owners (even permitted viewers of a public profile) must NOT see
    // the athlete's PRIVATE training posts — filter to public for them.
    let trainingQuery = supabase
      .from('posts')
      .select(`
        id,
        caption,
        sport_key,
        post_category,
        stats_data,
        visibility,
        created_at,
        likes_count,
        comments_count,
        saves_count,
        profile:profile_id (
          id,
          first_name,
          middle_name,
          last_name,
          full_name,
          avatar_url,
          handle
        ),
        media:post_media (
          id,
          media_url,
          media_type,
          display_order
        ),
        likes:post_likes (
          profile_id
        )
      `)
      .eq('profile_id', profileId)
      .eq('post_category', 'training')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!isOwner) {
      trainingQuery = trainingQuery.eq('visibility', 'public');
    }

    const { data: trainingPostsRaw, error: postsError } = await trainingQuery;

    if (postsError) {
      console.error('Error fetching training posts:', postsError);
      // Non-fatal: return vitals even if posts fail
    }

    return NextResponse.json({
      // Aspect filter: body rows drop when body is private, the rest when
      // records is private. Owners always get everything.
      vitals: filterVitalsRows(vitals || [], privacy, isOwner),
      // Training posts are ordinary posts — their media is post media, proxied
      // under each post's id (governed by the post rule).
      trainingPosts: (trainingPostsRaw || []).map((p) => {
        const post = p as { id: string; media?: Array<{ media_url: string }> };
        return {
          ...post,
          media: (post.media || []).map((m) => ({
            ...m,
            media_url: toProxyUrl(m.media_url, { type: 'post', id: post.id }) ?? m.media_url,
          })),
        };
      }),
      // dob is what Edit Profile saves; birthday is a legacy column kept as
      // fallback (previously this read birthday alone — usually null, which
      // hid every age-at-date annotation).
      athleteBirthday: profile.dob || profile.birthday || null,
      currentVitals: {
        // Height/weight follow the body aspect; age/DOB exposure is
        // unchanged by design (dob was already owner-gated client-side).
        heightCm: bodyHidden ? null : profile.height_cm ?? null,
        weightKg: bodyHidden ? null : profile.weight_kg ?? null,
        weightDisplay: bodyHidden ? null : profile.weight_display ?? null,
        weightUnit: bodyHidden ? null : profile.weight_unit ?? null,
        dob: profile.dob ?? null,
      },
      // The dashboard hero's greeting line — display data the viewer can
      // already see on the profile page itself, nothing new is exposed.
      profile: {
        firstName: profile.first_name ?? null,
        avatarUrl: profile.avatar_url ?? null,
      },
      // Owner-only: seeds the settings modal's privacy toggles.
      ...(isOwner ? { vitalsPrivacy: privacy } : {}),
    });
  } catch (error) {
    console.error('GET /api/vitals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/vitals
 * Add a new vital entry. Entries are immutable — this always creates, never updates.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    const body = await request.json();
    const {
      metric_key,
      metric_category,
      metric_label,
      value,
      value_display,
      unit,
      notes,
      recorded_at,
      linked_post_id,
    } = body;

    if (!metric_key || !metric_category || !metric_label || !unit) {
      return NextResponse.json(
        { error: 'metric_key, metric_category, metric_label, and unit are required' },
        { status: 400 }
      );
    }

    if (value === null || value === undefined) {
      return NextResponse.json({ error: 'value is required' }, { status: 400 });
    }

    const numericValue = Number(value);
    if (isNaN(numericValue) || !isFinite(numericValue)) {
      return NextResponse.json({ error: 'value must be a valid number' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('athlete_vitals')
      .insert({
        profile_id: user.id,
        metric_key,
        metric_category,
        metric_label,
        value: numericValue,
        value_display: value_display || null,
        unit,
        notes: notes || null,
        recorded_at: recorded_at || new Date().toISOString().split('T')[0],
        // 'edge_vitals' = PRs recorded from a workout session (VitalsTab
        // renders non-manual sources as a provenance label)
        source: ['manual', 'edge_vitals'].includes(body.source) ? body.source : 'manual',
        linked_post_id: linked_post_id || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting vital:', error);
      return NextResponse.json({ error: 'Failed to save vital entry' }, { status: 500 });
    }

    return NextResponse.json({ vital: data }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/vitals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
