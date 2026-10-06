import { expect, type APIRequestContext } from '@playwright/test';
import { readErrorBody } from './qa-user';

// ── Drafts round (253, Oct 2026): Finish and Post are two actions ───────────
// A round's feed post is a DRAFT from creation until its owner POSTS it. A
// spec that wants the round on the feed or a profile grid finishes the round
// (PATCH status completed — the record) and then posts it (PATCH /api/posts
// action 'post' — the social post). Two helpers so a spec says which.

/** Post a draft as its owner (or a write_content guardian). */
export async function postDraft(api: APIRequestContext, postId: string): Promise<void> {
  const res = await api.patch('/api/posts', { data: { postId, action: 'post' } });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
}

/** Finish a round (the creator) and post its draft. Returns the post id. */
export async function finishAndPost(api: APIRequestContext, groupPostId: string, postId?: string | null): Promise<string> {
  const end = await api.patch(`/api/group-posts/${groupPostId}`, { data: { status: 'completed' } });
  expect(end.ok(), await readErrorBody(end)).toBe(true);
  let id = postId ?? null;
  if (!id) {
    const res = await api.get(`/api/group-posts/${groupPostId}`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    id = ((await res.json()).group_post?.post_id as string | null) ?? null;
  }
  expect(id, 'the round has a feed post').toBeTruthy();
  await postDraft(api, id!);
  return id!;
}
