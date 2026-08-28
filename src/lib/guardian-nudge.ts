// 48h approval nudge (Family Console Wave 2, PR 3) — the SLA half of Tom's
// locked decision: "nudge, never auto-publish". Pending posts/comments older
// than the threshold re-bell the guardians ONCE (approval_nudged_at stamp,
// mig 129), aggregated to one notification per child per run. The queue's
// aging badge derives from the same AGING_BADGE_MS constant, so the badge
// and the bell can never disagree. This module writes NO status — nothing
// here can publish a minor's content.

import type { SupabaseClient } from '@supabase/supabase-js';
import { AGING_BADGE_MS } from './guardian-queue';

export interface NudgeBatch {
  profileId: string;
  postIds: string[];
  commentIds: string[];
}

/** Group overdue pending rows per child — pure, node-testable. */
export function buildNudgeBatches(
  postRows: Array<{ id: string; profile_id: string }>,
  commentRows: Array<{ id: string; profile_id: string }>
): NudgeBatch[] {
  const byChild = new Map<string, NudgeBatch>();
  const batchFor = (profileId: string): NudgeBatch => {
    let b = byChild.get(profileId);
    if (!b) {
      b = { profileId, postIds: [], commentIds: [] };
      byChild.set(profileId, b);
    }
    return b;
  };
  for (const row of postRows) batchFor(row.profile_id).postIds.push(row.id);
  for (const row of commentRows) batchFor(row.profile_id).commentIds.push(row.id);
  return [...byChild.values()];
}

/** One line per child, singular/plural aware — pure for the copy test. */
export function nudgeTitle(childName: string, postCount: number, commentCount: number): string {
  const total = postCount + commentCount;
  if (total === 1) {
    const noun = postCount === 1 ? 'post' : 'comment';
    return `${childName}'s ${noun} has been waiting 2 days for your review`;
  }
  return `${total} items from ${childName} are still waiting for your review`;
}

/**
 * Cron phase (daily #6): re-bell guardians on pending items older than 48h.
 * The stamp is written after the send attempt, so each item nudges at most
 * once ever; per-child failures tally without blocking the rest.
 */
export async function runPendingNudge(
  admin: SupabaseClient
): Promise<{ ok: boolean; nudged: number; failed: number }> {
  const cutoff = new Date(Date.now() - AGING_BADGE_MS).toISOString();
  const overdue = (table: 'posts' | 'post_comments') =>
    admin
      .from(table)
      .select('id, profile_id')
      .eq('status', 'pending_approval')
      .is('approval_nudged_at', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(50); // bounded per run; the daily cadence drains any backlog

  const [postsQ, commentsQ] = await Promise.all([overdue('posts'), overdue('post_comments')]);
  if (postsQ.error || commentsQ.error) {
    console.error('[pending-nudge] overdue lookup failed:', postsQ.error ?? commentsQ.error);
    return { ok: false, nudged: 0, failed: 0 };
  }

  const batches = buildNudgeBatches(postsQ.data ?? [], commentsQ.data ?? []);
  if (batches.length === 0) return { ok: true, nudged: 0, failed: 0 };

  const { notifyGuardians, profileFirstName } = await import('./guardian-notify');
  const stamp = new Date().toISOString();
  let nudged = 0;
  let failed = 0;
  for (const batch of batches) {
    try {
      const childName = await profileFirstName(admin, batch.profileId);
      const itemCount = batch.postIds.length + batch.commentIds.length;
      await notifyGuardians(admin, batch.profileId, {
        type: 'post_pending_approval',
        title: nudgeTitle(childName, batch.postIds.length, batch.commentIds.length),
        actionUrl: '/app/guardian',
        metadata: { nudge: true, post_ids: batch.postIds, comment_ids: batch.commentIds },
      });
      // Stamp AFTER the attempt: a crash before this line retries tomorrow;
      // after it, the item never nudges again.
      if (batch.postIds.length > 0) {
        await admin.from('posts').update({ approval_nudged_at: stamp }).in('id', batch.postIds);
      }
      if (batch.commentIds.length > 0) {
        await admin.from('post_comments').update({ approval_nudged_at: stamp }).in('id', batch.commentIds);
      }
      nudged += itemCount;
    } catch (err) {
      failed++;
      console.error(`[pending-nudge] nudge failed for child ${batch.profileId}:`, err);
    }
  }
  return { ok: failed === 0, nudged, failed };
}
