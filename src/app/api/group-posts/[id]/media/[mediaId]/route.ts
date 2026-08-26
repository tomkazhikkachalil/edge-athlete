import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerClient, getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isValidSegment, segmentSchemaFor } from '@/lib/sports/segment-schemas';
import { resolveSportKey } from '@/lib/sports/resolve-sport-key';
import { GROUP_TYPE_TO_SPORT, type GroupPostType } from '@/types/group-posts';
import type { SportKey } from '@/lib/sports';

/**
 * PATCH  /api/group-posts/[id]/media/[mediaId]  — reassign / highlight / caption
 * DELETE /api/group-posts/[id]/media/[mediaId]  — remove an item
 *
 * Both run on the USER-scoped client so RLS decides who may act:
 *  - UPDATE: `media_update_policy` (migration 062) — uploader or round creator.
 *    That policy did not exist before 062, so every UPDATE was denied and
 *    reassignment was impossible.
 *  - DELETE: `media_delete_policy` (004) — uploader or round creator.
 *
 * Auto-tagging by capture time is a SUGGESTION (see segment-autotag.ts —
 * File.lastModified is not reliably capture time, and a retrospectively
 * entered card carries no positional information at all). This route is what
 * makes that acceptable: the athlete can always correct it.
 */

/** Fields a client may change. group_post_id and uploaded_by are never settable. */
interface MediaPatch {
  segment_number?: number | null;
  segment_kind?: string | null;
  is_highlight?: boolean;
  caption?: string | null;
}

async function resolveSport(
  supabase: ReturnType<typeof getServerClient>,
  groupPostId: string
): Promise<SportKey | null> {
  const { data: round } = await supabase
    .from('group_posts')
    .select('type, post:posts!posts_group_post_id_fkey (sport_key)')
    .eq('id', groupPostId)
    .maybeSingle();

  const postSportKey = Array.isArray(round?.post)
    ? round?.post[0]?.sport_key
    : (round?.post as { sport_key?: string } | null | undefined)?.sport_key;

  return (
    resolveSportKey(postSportKey) ??
    // The declared type→sport map, not a suffix-stripping regex (see the
    // sibling media route).
    resolveSportKey(GROUP_TYPE_TO_SPORT[round?.type as GroupPostType] ?? null)
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: groupPostId, mediaId } = await params;
    if (!isUuid(groupPostId)) {
      return NextResponse.json({ error: 'Invalid group post ID' }, { status: 400 });
    }
    if (!isUuid(mediaId)) {
      return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
    }
    const body = await request.json();
    const patch: MediaPatch = {};

    if ('segment_number' in body || 'hole_number' in body) {
      // NOT `body.segment_number ?? body.hole_number`: `??` treats null as
      // absent, so an explicit `segment_number: null` — which is exactly what
      // "move this back to the whole round" sends — collapsed to undefined and
      // was then rejected as an invalid hole.
      const raw = 'segment_number' in body ? body.segment_number : body.hole_number;

      if (raw === null) {
        // Explicitly moving an item back to event level.
        patch.segment_number = null;
        patch.segment_kind = null;
      } else {
        const sportKey = await resolveSport(supabase, groupPostId);
        if (typeof raw !== 'number' || !isValidSegment(sportKey, raw)) {
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
        const kind = segmentSchemaFor(sportKey)?.kind ?? null;
        patch.segment_number = raw;
        patch.segment_kind = kind;
        // hole_number is no longer written — migration 076 dropped the legacy
        // column; the request-body alias read above stays for stale tabs.
      }
    }

    if (typeof body.is_highlight === 'boolean') patch.is_highlight = body.is_highlight;

    if ('caption' in body) {
      patch.caption =
        typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim() : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('group_post_media')
      .update(patch)
      .eq('id', mediaId)
      .eq('group_post_id', groupPostId)
      .select('id, segment_number, segment_kind, is_highlight, caption')
      .maybeSingle();

    if (error) {
      console.error('group media update failed:', error);
      return NextResponse.json({ error: 'Could not update this media' }, { status: 403 });
    }
    if (!data) {
      // RLS denial and "no such row" are indistinguishable here, and telling
      // the two apart would leak which media ids exist.
      return NextResponse.json({ error: 'Could not update this media' }, { status: 403 });
    }

    // Setting a new highlight clears the others. Best-effort and deliberately
    // NOT a unique index — that would make this two statements racing to a
    // 23505; the hero picker resolves duplicates deterministically anyway.
    if (patch.is_highlight === true) {
      const { error: clearError } = await supabase
        .from('group_post_media')
        .update({ is_highlight: false })
        .eq('group_post_id', groupPostId)
        .neq('id', mediaId)
        .eq('is_highlight', true);
      if (clearError) console.error('clearing previous highlight failed:', clearError);
    }

    // No media URL in the response (metadata-only select), so nothing to proxy.
    return NextResponse.json({ media: data });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/group-posts/[id]/media/[mediaId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const { supabase, user, error: authError } = await getServerAuth(request);
  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: groupPostId, mediaId } = await params;
    if (!isUuid(groupPostId)) {
      return NextResponse.json({ error: 'Invalid group post ID' }, { status: 400 });
    }
    if (!isUuid(mediaId)) {
      return NextResponse.json({ error: 'Invalid media ID' }, { status: 400 });
    }

    // Read the URL BEFORE deleting — it is the key to the mirrored feed row.
    const { data: existing } = await supabase
      .from('group_post_media')
      .select('media_url')
      .eq('id', mediaId)
      .eq('group_post_id', groupPostId)
      .maybeSingle();

    const { error, count } = await supabase
      .from('group_post_media')
      .delete({ count: 'exact' })
      .eq('id', mediaId)
      .eq('group_post_id', groupPostId);

    if (error) {
      console.error('group media delete failed:', error);
      return NextResponse.json({ error: 'Could not remove this media' }, { status: 403 });
    }
    if (!count) {
      return NextResponse.json({ error: 'Could not remove this media' }, { status: 403 });
    }

    // The mirror only ever INSERTs, so without this the feed post keeps a row
    // pointing at media that no longer exists on the round.
    if (existing?.media_url) {
      const admin = getSupabaseAdmin();
      const { data: post } = await admin
        .from('posts')
        .select('id')
        .eq('group_post_id', groupPostId)
        .maybeSingle();
      if (post?.id) {
        const { error: mirrorError } = await admin
          .from('post_media')
          .delete()
          .eq('post_id', post.id)
          .eq('media_url', existing.media_url);
        if (mirrorError) console.error('removing mirrored post_media failed:', mirrorError);
      }
    }

    // The storage object is deliberately left alone — storage-sweep owns
    // orphan cleanup (48h grace), and deleting inline would destroy a file
    // that another post may still reference.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/group-posts/[id]/media/[mediaId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
