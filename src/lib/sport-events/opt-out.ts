/**
 * The results opt-out (Events program, PR 7) — Tom's call: a player who
 * hides an event result hides it EVERYWHERE — the profile, the handicap,
 * the dataset — through the ONE mirror. This module answers "who on this
 * round opted out?" for `mirrorCompletedRound`, which skips them (and
 * removes an existing mirror row on a late opt-out). No golf imports, so
 * round-mirror.ts can import it without a cycle.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** Profile ids that hid their result on the event this round belongs to; empty for a plain shared round. */
export async function hiddenProfileIdsForRound(admin: Admin, groupPostId: string): Promise<Set<string>> {
  try {
    const { data: gp } = await admin.from('group_posts').select('sport_event_round_id').eq('id', groupPostId).maybeSingle();
    const roundId = (gp?.sport_event_round_id as string | null | undefined) ?? null;
    if (!roundId) return new Set();
    const { data: round } = await admin.from('sport_event_rounds').select('sport_event_id').eq('id', roundId).maybeSingle();
    if (!round) return new Set();
    const { data: rows } = await admin.from('sport_event_participants').select('profile_id').eq('sport_event_id', round.sport_event_id).eq('hide_from_profile', true);
    return new Set(((rows ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id));
  } catch (e) {
    console.error('[sport-events opt-out] read failed:', e);
    return new Set();
  }
}

/** Remove a profile's mirror of a round (golf_rounds → golf_holes cascade) and its performance row. */
export async function removeMirrorFor(admin: Admin, groupPostId: string, profileId: string): Promise<void> {
  const { data: rows } = await admin.from('golf_rounds').select('id').eq('group_post_id', groupPostId).eq('profile_id', profileId);
  const ids = ((rows ?? []) as Array<{ id: string }>).map(r => r.id);
  if (ids.length === 0) return;
  const { deletePerformancesBySource } = await import('@/lib/performance/write-server');
  await deletePerformancesBySource(admin, 'golf_rounds', ids);
  const { error } = await admin.from('golf_rounds').delete().in('id', ids);
  if (error) console.error('[sport-events opt-out] mirror delete failed:', error);
}
