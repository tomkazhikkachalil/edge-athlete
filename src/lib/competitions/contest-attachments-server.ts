// ── The ONE writer of posts/group_posts.contest_id (Contest Place E2) ────
// Called by the golf sync after its results upsert. The invariant it keeps:
// the posts and live rounds attached to a contest are EXACTLY the ones its
// current results reference — a member's replaced round detaches, a kept
// (verified) member's round stays. Pre-181 (42703) it warns and returns;
// any other error is logged and swallowed — attachments are additive to
// the sync, never a reason for it to fail.

import type { SupabaseClient } from '@supabase/supabase-js';
import { attachmentTargets } from './contest-attachments';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the authz.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[contest-attachments]';

export async function stampContestAttachments(admin: Admin, contestId: string): Promise<void> {
  try {
    const { data: results, error } = await admin
      .from('contest_results')
      .select('payload')
      .eq('contest_id', contestId)
      .limit(500);
    if (error) {
      console.warn(`${TAG} results read failed:`, error.message);
      return;
    }
    const targets = attachmentTargets((results ?? []).map(r => r.payload as Record<string, unknown> | null));

    // Detach what the results no longer reference, then attach what they do.
    const notIn = (ids: string[]) => `(${ids.join(',')})`;
    const groupDetach = admin.from('group_posts').update({ contest_id: null }).eq('contest_id', contestId);
    const { error: gdErr } = await (targets.groupPostIds.length
      ? groupDetach.not('id', 'in', notIn(targets.groupPostIds))
      : groupDetach);
    if (gdErr) {
      if (gdErr.code === '42703') {
        console.warn(`${TAG} group_posts.contest_id missing — run migration 181`);
        return;
      }
      console.warn(`${TAG} group_posts detach failed:`, gdErr.message);
    }
    if (targets.groupPostIds.length) {
      const { error: gaErr } = await admin
        .from('group_posts')
        .update({ contest_id: contestId })
        .in('id', targets.groupPostIds);
      if (gaErr) console.warn(`${TAG} group_posts attach failed:`, gaErr.message);
    }

    const postDetach = admin.from('posts').update({ contest_id: null }).eq('contest_id', contestId);
    const { error: pdErr } = await (targets.roundIds.length
      ? postDetach.not('round_id', 'in', notIn(targets.roundIds))
      : postDetach);
    if (pdErr) {
      if (pdErr.code === '42703') {
        console.warn(`${TAG} posts.contest_id missing — run migration 181`);
        return;
      }
      console.warn(`${TAG} posts detach failed:`, pdErr.message);
    }
    if (targets.roundIds.length) {
      const { error: paErr } = await admin
        .from('posts')
        .update({ contest_id: contestId })
        .in('round_id', targets.roundIds);
      if (paErr) console.warn(`${TAG} posts attach failed:`, paErr.message);
    }
  } catch (err) {
    console.warn(`${TAG} failed:`, err);
  }
}
