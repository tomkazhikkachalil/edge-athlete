// ── Delete a for-fun result — THE one writer (quick fixes, Oct 2026) ────────
//
// Tom amended convention 27 on Oct 2 2026: a result that is not from a
// tournament, a club or a league may be DELETED by its player; official
// results and event rounds can only be hidden (hide-server.ts). The decision
// is the pure `planResultDelete` (delete-rule.ts); this file reads the facts
// and carries the plan out. Every door — the post trash, the round page, the
// live card — comes here, and only when the request says `mode=delete`: a
// bare DELETE keeps its Sep 26 meaning (a result is hidden), so a tab opened
// before the deploy can never destroy something its confirm promised to keep.
//
// Between players the older rule holds: a delete removes YOUR result. In a
// finished shared round your stats row, your dataset row and your scores on
// the card go (the scores too — any later re-mirror of the round would write
// your stats row straight back from them); your partners keep everything.

import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteRoundCascade } from '@/lib/golf/round-delete-server';
import { deletePostCascade } from '@/lib/posts/delete-post-server';
import { deletePerformancesBySource } from '@/lib/performance/write-server';
import { resolveResultOrigin } from './origin-server';
import { DELETE_REFUSALS, planResultDelete } from './delete-rule';

type Admin = SupabaseClient;

export type ResultDeleteOutcome =
  | { status: 'deleted' }
  /** The rule said no — `message` names the way out (hide). */
  | { status: 'refused'; message: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

const TAG = '[results delete]';

const scored = (s: { holes_completed: number | null; total_score: number | null }) => (s.holes_completed ?? 0) > 0 || s.total_score != null;

/** A finished shared round: the requester's rows only. */
async function removeOwnResult(admin: Admin, groupPostId: string, requesterId: string, participantId: string | null, removePostId: string | null): Promise<ResultDeleteOutcome> {
  const { data: mine, error: readError } = await admin.from('golf_rounds').select('id').eq('group_post_id', groupPostId).eq('profile_id', requesterId);
  if (readError) {
    console.error(`${TAG} own rounds read failed:`, readError.message);
    return { status: 'error', message: 'Could not load your round' };
  }
  const roundIds = ((mine ?? []) as { id: string }[]).map(r => r.id);
  if (roundIds.length > 0) {
    const { error } = await admin.from('golf_rounds').delete().eq('group_post_id', groupPostId).eq('profile_id', requesterId);
    if (error) {
      console.error(`${TAG} own rounds delete failed:`, error.message);
      return { status: 'error', message: 'Could not remove the round from your stats' };
    }
    await deletePerformancesBySource(admin, 'golf_rounds', roundIds);
  }
  // The card's scores are what a re-mirror reads: without this the stats row
  // above is written back the next time the round is mirrored.
  if (participantId) {
    const { error } = await admin.from('golf_participant_scores').delete().eq('participant_id', participantId);
    if (error) {
      console.error(`${TAG} own card scores delete failed:`, error.message);
      return { status: 'error', message: 'Could not remove your scores from the card' };
    }
  }
  if (removePostId) {
    const post = await deletePostCascade(admin, removePostId);
    if (!post.ok) return { status: 'error', message: post.error };
  }
  return { status: 'deleted' };
}

/**
 * Delete a round's result for `requesterId` (the round's creator, or someone
 * who played in it). The caller has already established that the SESSION may
 * act for that profile (the owner, or their guardian).
 */
export async function deleteRoundResult(admin: Admin, groupPostId: string, requesterId: string): Promise<ResultDeleteOutcome> {
  const { data: round, error } = await admin.from('group_posts').select('id, creator_id, post_id, sport_event_round_id, status').eq('id', groupPostId).maybeSingle();
  if (error) {
    console.error(`${TAG} round read failed:`, error.message);
    return { status: 'error', message: 'Could not load the round' };
  }
  const r = round as { id: string; creator_id: string; post_id: string | null; sport_event_round_id: string | null; status: string | null } | null;
  if (!r) return { status: 'not_found' };

  const { data: parts, error: partsError } = await admin.from('group_post_participants').select('id, profile_id').eq('group_post_id', groupPostId);
  if (partsError) {
    console.error(`${TAG} participants read failed:`, partsError.message);
    return { status: 'error', message: 'Could not load the round' };
  }
  const participants = (parts ?? []) as { id: string; profile_id: string | null }[];
  const isCreator = r.creator_id === requesterId;
  const myParticipant = participants.find(p => p.profile_id === requesterId) ?? null;
  if (!isCreator && !myParticipant) return { status: 'forbidden' };

  // Official? The resolver fails CLOSED: a read it cannot make answers "yes".
  const origin = await resolveResultOrigin(admin, { kind: 'group_post', id: groupPostId });

  const ids = participants.map(p => p.id);
  const [{ data: scoreRows, error: scoresError }, { data: mirrorRows, error: mirrorsError }] = await Promise.all([
    ids.length > 0
      ? admin.from('golf_participant_scores').select('participant_id, holes_completed, total_score').in('participant_id', ids)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    admin.from('golf_rounds').select('profile_id').eq('group_post_id', groupPostId),
  ]);
  if (scoresError || mirrorsError) {
    console.error(`${TAG} facts read failed:`, scoresError?.message ?? mirrorsError?.message);
    return { status: 'error', message: 'Could not load the round' };
  }
  const others = new Set<string>();
  for (const s of (scoreRows ?? []) as { participant_id: string; holes_completed: number | null; total_score: number | null }[]) {
    const who = participants.find(p => p.id === s.participant_id)?.profile_id;
    if (who && who !== requesterId && scored(s)) others.add(who);
  }
  for (const m of (mirrorRows ?? []) as { profile_id: string }[]) {
    if (m.profile_id !== requesterId) others.add(m.profile_id);
  }

  const plan = planResultDelete({
    official: origin.official,
    eventRound: !!r.sport_event_round_id,
    finished: r.status === 'completed',
    isCreator,
    othersPlayed: others.size,
  });
  switch (plan.action) {
    case 'refuse':
      return { status: 'refused', message: DELETE_REFUSALS[plan.reason] };
    case 'discard_round':
    case 'delete_round': {
      // The whole round, through the one cascade (creator-checked there too).
      const out = await deleteRoundCascade(admin, groupPostId, requesterId);
      if (out.status === 'hidden') return { status: 'error', message: 'Could not delete the round' };
      return out;
    }
    case 'remove_own_result':
      return removeOwnResult(admin, groupPostId, requesterId, myParticipant?.id ?? null, plan.removePost ? r.post_id : null);
  }
}

/** A personal round with no shared card (the pre-Aug-2026 shape): the round, its dataset row, and the owner's posts of it. */
export async function deleteSoloRound(admin: Admin, roundId: string, ownerId: string): Promise<ResultDeleteOutcome> {
  const origin = await resolveResultOrigin(admin, { kind: 'golf_round', id: roundId });
  const plan = planResultDelete({ official: origin.official, eventRound: false, finished: true, isCreator: true, othersPlayed: 0 });
  if (plan.action === 'refuse') return { status: 'refused', message: DELETE_REFUSALS[plan.reason] };

  const { data: posts } = await admin.from('posts').select('id').eq('round_id', roundId).eq('profile_id', ownerId);
  for (const p of (posts ?? []) as { id: string }[]) {
    const out = await deletePostCascade(admin, p.id);
    if (!out.ok) return { status: 'error', message: out.error };
    await deletePerformancesBySource(admin, 'posts', [p.id]);
  }
  const { data: gone, error } = await admin.from('golf_rounds').delete().eq('id', roundId).eq('profile_id', ownerId).select('id');
  if (error) {
    console.error(`${TAG} solo round delete failed:`, error.message);
    return { status: 'error', message: 'Could not delete the round' };
  }
  if (!gone || gone.length === 0) return { status: 'not_found' };
  await deletePerformancesBySource(admin, 'golf_rounds', [roundId]);
  return { status: 'deleted' };
}

/**
 * Delete a post that carries a result but no shared round: a self-entered
 * stat line (its dataset row is keyed by the post), or a post that only
 * references a personal round. An event's post is refused.
 */
export async function deleteResultPost(admin: Admin, postId: string, ownerId: string): Promise<ResultDeleteOutcome> {
  const { data: post, error } = await admin.from('posts').select('id, profile_id, sport_event_round_id, round_id').eq('id', postId).maybeSingle();
  if (error) {
    console.error(`${TAG} post read failed:`, error.message);
    return { status: 'error', message: 'Could not load the post' };
  }
  const p = post as { id: string; profile_id: string; sport_event_round_id: string | null; round_id: string | null } | null;
  if (!p || p.profile_id !== ownerId) return { status: 'not_found' };

  const origin = await resolveResultOrigin(admin, { kind: 'post', id: postId });
  const plan = planResultDelete({ official: origin.official, eventRound: !!p.sport_event_round_id, finished: true, isCreator: true, othersPlayed: 0 });
  if (plan.action === 'refuse') return { status: 'refused', message: DELETE_REFUSALS[plan.reason] };

  if (p.round_id) {
    const solo = await deleteSoloRound(admin, p.round_id, ownerId);
    // not_found: the round was someone else's or already gone — the post still goes below.
    if (solo.status === 'refused' || solo.status === 'error') return solo;
    if (solo.status === 'deleted') return solo;
  }
  const out = await deletePostCascade(admin, postId);
  if (!out.ok) return { status: 'error', message: out.error };
  await deletePerformancesBySource(admin, 'posts', [postId]);
  return { status: 'deleted' };
}
