import { POST_VISIBILITY } from '@/lib/posts/audience';
import type { SportKey } from '@/lib/sports/SportRegistry';

/**
 * Post an activity to the feed — the ONE client call, shared by the
 * recorder's review (Finish → Done) and the activity page's later share.
 * The server rebuilds the card from the row (share-server.ts); the post is
 * written public and the ACCOUNT's privacy decides who sees it
 * (src/lib/posts/audience.ts).
 */
export type ActivityPostResult =
  | { ok: true; postId: string | null; pendingApproval: boolean }
  | { ok: false; error: string };

export async function postActivity(opts: {
  activityId: string;
  /** The stat-line sport to post it as, or null for the training card. */
  sport: SportKey | null;
  caption: string;
  /** Self, or the athlete a guardian manages — the server's acting gate decides. */
  targetProfileId: string | null;
}): Promise<ActivityPostResult> {
  try {
    const res = await fetch('/api/posts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postType: opts.sport ?? 'general',
        caption: opts.caption.trim(),
        visibility: POST_VISIBILITY,
        stats_data: { type: 'activity', activity_id: opts.activityId },
        ...(opts.targetProfileId ? { targetProfileId: opts.targetProfileId } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: unknown; post?: { id?: string; status?: string }; id?: string; status?: string };
    if (!res.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : 'Please try again.' };
    const post = json.post ?? json;
    return { ok: true, postId: post?.id ?? null, pendingApproval: post?.status === 'pending_approval' };
  } catch {
    return { ok: false, error: 'Check your connection and try again.' };
  }
}
