// ── The one server reader of a person's drafts (Drafts round, Oct 2026) ──────
// Rounds the person is an ACTIVE participant of (their own participant rows —
// never the public group_posts listing: the RLS SELECT includes every public
// round) plus their own workout sessions. Runs on the admin client: the
// caller has already decided the session may read this profile's drafts (the
// owner, or a write_content guardian). The recording on the phone is the
// client's to add (IndexedDB — the server never sees it).

import type { SupabaseClient } from '@supabase/supabase-js';
import { isActiveParticipant } from '@/lib/golf/round-status';
import { buildDraftsList, type DraftRoundRow, type DraftWorkoutRow, type DraftsList } from './list';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function readDrafts(admin: Admin, profileId: string): Promise<DraftsList> {
  const [{ data: rows, error: roundsError }, { data: workouts, error: workoutsError }] = await Promise.all([
    admin
      .from('group_post_participants')
      .select(`
        status,
        group_post:group_post_id (
          id, type, status, date, post_id, title, creator_id, sport_event_round_id,
          golf_data:golf_scorecard_data ( course_name ),
          all_participants:group_post_participants ( scores:golf_participant_scores ( updated_at ) ),
          post:post_id ( status )
        )
      `)
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('workout_sessions')
      .select('id, status, title, started_at, last_activity_at')
      .eq('profile_id', profileId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(20),
  ]);
  if (roundsError) throw roundsError;
  if (workoutsError) throw workoutsError;

  const rounds: DraftRoundRow[] = [];
  for (const r of (rows ?? []) as Array<{ status: string | null; group_post: unknown }>) {
    if (!isActiveParticipant(r.status)) continue;
    const gp = one(r.group_post as Record<string, unknown> | Record<string, unknown>[] | null);
    if (!gp || gp.type !== 'golf_round') continue;
    const golfData = one(gp.golf_data as { course_name: string | null } | { course_name: string | null }[] | null);
    const post = one(gp.post as { status: string | null } | { status: string | null }[] | null);
    let lastScoreAt: string | null = null;
    for (const ap of (gp.all_participants ?? []) as Array<{ scores: { updated_at?: string | null } | { updated_at?: string | null }[] | null }>) {
      const s = one(ap.scores);
      if (s?.updated_at && (!lastScoreAt || s.updated_at > lastScoreAt)) lastScoreAt = s.updated_at;
    }
    rounds.push({
      id: gp.id as string,
      status: (gp.status as string | null) ?? null,
      date: (gp.date as string | null) ?? null,
      post_id: (gp.post_id as string | null) ?? null,
      course_name: golfData?.course_name ?? null,
      title: (gp.title as string | null) ?? null,
      isCreator: gp.creator_id === profileId,
      lastScoreAt,
      postIsDraft: post?.status === 'draft',
      sportEventRoundId: (gp.sport_event_round_id as string | null) ?? null,
    });
  }

  return buildDraftsList({ rounds, workouts: (workouts ?? []) as DraftWorkoutRow[] });
}
