import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { aspectHidden } from '@/lib/vitals-privacy';
import { fetchVitalsPrivacy } from '@/lib/vitals-privacy-server';
import { toProxyUrl } from '@/lib/media/proxy-url';

const SESSION_SELECT = `
  *,
  exercises:workout_exercises (
    *,
    sets:workout_sets (*)
  )
`;

interface NestedSession {
  exercises?: Array<{ position: number; sets?: Array<{ set_number: number }> }>;
}

function sortNested(session: NestedSession): void {
  session.exercises?.sort((a, b) => a.position - b.position);
  for (const exercise of session.exercises ?? []) {
    exercise.sets?.sort((a, b) => a.set_number - b.set_number);
  }
}

/**
 * GET /api/workouts/[id] — one session with nested exercises/sets.
 * Owner sees any status; others (public profile or accepted follower)
 * see completed sessions only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id } = await params;

    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      currentUserId = null;
    }

    const { data: session, error } = await supabase
      .from('workout_sessions')
      .select(SESSION_SELECT)
      .eq('id', id)
      .single();

    if (error || !session) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
    }

    const isOwner = currentUserId === session.profile_id;
    if (!isOwner) {
      if (session.status !== 'completed') {
        return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('visibility')
        .eq('id', session.profile_id)
        .single();
      // Vitals privacy (migration 122): closes the lazy-details path used by
      // WorkoutPostCard — the card already degrades to "unavailable".
      if (aspectHidden(await fetchVitalsPrivacy(supabase, session.profile_id), 'workouts', false)) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
      if (profile?.visibility !== 'public') {
        if (!currentUserId) {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
        const { data: followRecord } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', currentUserId)
          .eq('following_id', session.profile_id)
          .eq('status', 'accepted')
          .maybeSingle();
        if (!followRecord) {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
      }
    }

    sortNested(session as NestedSession);
    // Proxy workout-set media (governed by the owner profile + workouts aspect).
    const s = session as { profile_id: string; exercises?: Array<{ sets?: Array<{ media?: Array<{ url?: string }> }> }> };
    for (const exercise of s.exercises ?? []) {
      for (const set of exercise.sets ?? []) {
        if (Array.isArray(set.media)) {
          set.media = set.media.map(m => ({
            ...m,
            url: (m?.url ? toProxyUrl(m.url, { type: 'workout', id: s.profile_id }) : m?.url) ?? m?.url,
          }));
        }
      }
    }
    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/workouts/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/workouts/[id] — owner only.
 * Body: { title?, notes?, postId?, finish?: { endedAt } }
 * finish completes a live session (endedAt clamped to started_at..now+5min).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    const { data: session, error: fetchError } = await supabase
      .from('workout_sessions')
      .select('profile_id, status, started_at')
      .eq('id', id)
      .single();

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
    }
    if (session.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) {
      updates.title =
        typeof body.title === 'string' && body.title.trim().length > 0
          ? body.title.trim().slice(0, 120)
          : null;
    }
    if (body.notes !== undefined) {
      updates.notes =
        typeof body.notes === 'string' && body.notes.trim().length > 0
          ? body.notes.trim().slice(0, 1000)
          : null;
    }
    if (body.postId !== undefined && body.postId !== null) {
      // Link only a post the user actually owns
      const { data: post } = await supabase
        .from('posts')
        .select('id, profile_id')
        .eq('id', body.postId)
        .single();
      if (!post || post.profile_id !== user.id) {
        return NextResponse.json({ error: 'Invalid post' }, { status: 400 });
      }
      updates.post_id = body.postId;
    }
    if (body.finish) {
      // Re-finishing a completed session would recompute duration_seconds
      // from now − started_at and corrupt the stored duration (review-mode
      // edits PATCH title only; nothing legitimate re-sends finish).
      if (session.status === 'completed') {
        return NextResponse.json({ error: 'Workout is already finished' }, { status: 409 });
      }
      const startedMs = Date.parse(session.started_at);
      const requestedMs = Date.parse(body.finish.endedAt ?? '');
      const nowMs = Date.now();
      const endedMs = Math.min(
        Math.max(Number.isNaN(requestedMs) ? nowMs : requestedMs, startedMs),
        nowMs + 5 * 60 * 1000
      );
      updates.status = 'completed';
      updates.ended_at = new Date(endedMs).toISOString();
      updates.duration_seconds = Math.floor((endedMs - startedMs) / 1000);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('workout_sessions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating workout:', updateError);
      return NextResponse.json({ error: 'Failed to update workout' }, { status: 500 });
    }

    return NextResponse.json({ session: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PATCH /api/workouts/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update workout' }, { status: 500 });
  }
}

/**
 * DELETE /api/workouts/[id] — owner only. Children cascade; a linked share
 * post survives (its chip data is denormalized in stats_data).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const { id } = await params;

    const { data: session, error: fetchError } = await supabase
      .from('workout_sessions')
      .select('profile_id')
      .eq('id', id)
      .single();

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 });
    }
    if (session.profile_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from('workout_sessions')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting workout:', deleteError);
      return NextResponse.json({ error: 'Failed to delete workout' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('DELETE /api/workouts/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete workout' }, { status: 500 });
  }
}
