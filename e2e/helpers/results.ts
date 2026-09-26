import { adminClient } from './qa-user';

// ── Results-kept round (241): tearing down a spec's RESULTS ─────────────────
// The app never deletes a result any more — "delete" hides it from the
// profile and the record stays (Tom's rule). A spec's own test data still has
// to go, so teardown purges it with the service role: the post and its
// dataset row, or the round, its holes (cascade) and its dataset row. Never
// throws (best-effort teardown).

export async function purgePost(postId: string | null | undefined): Promise<void> {
  if (!postId) return;
  try {
    const admin = adminClient();
    await admin.from('athlete_performances').delete().eq('natural_key', `post:${postId}`);
    await admin.from('posts').delete().eq('id', postId);
  } catch {
    // best-effort
  }
}

export async function purgeGolfRound(roundId: string | null | undefined): Promise<void> {
  if (!roundId) return;
  try {
    const admin = adminClient();
    await admin.from('athlete_performances').delete().eq('natural_key', `golf_round:${roundId}`);
    await admin.from('golf_rounds').delete().eq('id', roundId);
  } catch {
    // best-effort
  }
}
