import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { mirrorRoundMedia } from '@/lib/golf/round-mirror';
import { isValidSegment, segmentSchemaFor } from '@/lib/sports/segment-schemas';
import { resolveSportKey } from '@/lib/sports/resolve-sport-key';
import { GROUP_TYPE_TO_SPORT, type GroupPostType } from '@/types/group-posts';

/**
 * POST /api/group-posts/[id]/media
 * Attach an already-uploaded photo/video to a round, optionally tagged to a
 * SEGMENT of it (hole/inning/quarter/set/lap). The file itself is uploaded via
 * /api/upload/post-media first; this records the linkage. User-scoped insert —
 * RLS restricts to the round's participants.
 *
 * Body: { media_url, media_type: 'image'|'video', segment_number?, caption?,
 *         thumbnail_url?, duration_seconds? }
 * `hole_number` is still accepted as a legacy alias so a client mid-deploy
 * keeps working.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: groupPostId } = await params;
    const body = await request.json();
    const {
      media_url,
      media_type,
      segment_number,
      hole_number,
      caption,
      thumbnail_url,
      duration_seconds,
    } = body;

    // `hole_number` is the legacy name for the same thing.
    const rawSegment = segment_number ?? hole_number;

    if (!media_url || typeof media_url !== 'string') {
      return NextResponse.json({ error: 'media_url is required' }, { status: 400 });
    }
    if (media_type !== 'image' && media_type !== 'video') {
      return NextResponse.json({ error: "media_type must be 'image' or 'video'" }, { status: 400 });
    }
    // Which sport this round is decides what a segment even means, so the
    // lookup has to happen before validation. Merged into the status read
    // below rather than adding a round trip.
    const { data: round } = await supabase
      .from('group_posts')
      .select('status, type, post:posts!posts_group_post_id_fkey (sport_key)')
      .eq('id', groupPostId)
      .maybeSingle();

    // group_posts.type is 'golf_round' | 'hockey_game' | …; the post's
    // sport_key is the authoritative source when present.
    const postSportKey = Array.isArray(round?.post)
      ? round?.post[0]?.sport_key
      : (round?.post as { sport_key?: string } | null | undefined)?.sport_key;
    const sportKey =
      resolveSportKey(postSportKey) ??
      // The declared type→sport map, not a suffix-stripping regex: the regex
      // could invent a sport the feed post never carried (basketball_game →
      // 'basketball' while its post says 'general').
      resolveSportKey(GROUP_TYPE_TO_SPORT[round?.type as GroupPostType] ?? null);

    let segmentNumber: number | null = null;
    if (rawSegment !== undefined && rawSegment !== null) {
      if (typeof rawSegment !== 'number' || !isValidSegment(sportKey, rawSegment)) {
        const schema = segmentSchemaFor(sportKey);
        return NextResponse.json(
          {
            error: schema
              ? `${schema.label} must be a whole number${schema.variable ? ` of at least ${schema.min}` : ` between ${schema.min} and ${schema.max}`}`
              : 'segment_number must be a positive whole number',
          },
          { status: 400 }
        );
      }
      segmentNumber = rawSegment;
    }

    const segmentKind = segmentSchemaFor(sportKey)?.kind ?? null;

    // hole_number (the 042 legacy column) is no longer written — migration 076
    // dropped it. The request-body alias above stays: it's DB-independent and
    // protects a stale browser tab mid-deploy.
    const { data, error } = await supabase
      .from('group_post_media')
      .insert({
        group_post_id: groupPostId,
        uploaded_by: user.id,
        media_url,
        media_type,
        segment_number: segmentNumber,
        segment_kind: segmentNumber !== null ? segmentKind : null,
        caption: typeof caption === 'string' && caption.trim() ? caption.trim() : null,
        thumbnail_url: typeof thumbnail_url === 'string' && thumbnail_url ? thumbnail_url : null,
        duration_seconds:
          typeof duration_seconds === 'number' && Number.isFinite(duration_seconds) && duration_seconds > 0
            ? Math.round(duration_seconds)
            : null,
      })
      .select('id, media_url, media_type, segment_number, segment_kind, thumbnail_url, duration_seconds')
      .single();

    if (error) {
      // RLS denial surfaces here for non-participants
      console.error('group media insert failed:', error);
      return NextResponse.json({ error: 'Could not attach media to this round' }, { status: 403 });
    }

    // If the round is ALREADY completed, its feed post has been mirrored once
    // already — mirror again so late-attached media still reaches the feed
    // card. mirrorRoundMedia dedupes on media_url, so this is safe to re-run.
    // Live rounds skip it: the mirror runs when they complete.
    if (round?.status === 'completed') {
      await mirrorRoundMedia(getSupabaseAdmin(), groupPostId);
    }

    return NextResponse.json({ media: data }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/group-posts/[id]/media:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
