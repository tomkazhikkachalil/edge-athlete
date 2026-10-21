// ── The writer: a posted workout's summary follows its sets (Training fixes PR 5) ──
// Called after an entries PUT or a title PATCH on a COMPLETED session that has
// a post; owner-checked by the routes before it runs. Best-effort: a failure
// is reported, never surfaced — the session itself was saved.

import type { SupabaseClient } from '@supabase/supabase-js';
import { reportRouteError } from '@/lib/observability/report';
import { workoutPostStatsFromSession } from './post-stats';
import type { ServerWorkoutSession } from './serialize';

const SESSION_SELECT = `
  *,
  exercises:workout_exercises (
    *,
    sets:workout_sets (*)
  )
`;

export async function refreshWorkoutPostStats(admin: SupabaseClient, sessionId: string): Promise<void> {
  try {
    const { data, error } = await admin.from('workout_sessions').select(SESSION_SELECT).eq('id', sessionId).single();
    if (error || !data) return;
    const session = data as ServerWorkoutSession & { post_id: string | null; profile_id: string };
    if (!session.post_id || session.status !== 'completed') return;
    const { data: post } = await admin.from('posts').select('id, profile_id, stats_data').eq('id', session.post_id).maybeSingle();
    if (!post || post.profile_id !== session.profile_id) return;
    const next = workoutPostStatsFromSession(session, (post.stats_data as Record<string, unknown> | null) ?? null);
    if (!next) return;
    const { error: writeError } = await admin.from('posts').update({ stats_data: next }).eq('id', post.id).eq('profile_id', session.profile_id);
    if (writeError) reportRouteError('workout post stats refresh failed:', writeError);
  } catch (e) {
    reportRouteError('workout post stats refresh threw:', e);
  }
}
