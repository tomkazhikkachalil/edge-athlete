import { test, expect } from './helpers/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// DM loop: conversation + first message created via API as A (the New Message
// modal's athlete search is public-only, so private users can't find each
// other through the UI), then B reads and replies in the real UI, and A sees
// the reply. Privacy does not block DMs (messaging_permission defaults to
// 'everyone').
test('direct message: A sends via API, B reads and replies in UI, A sees reply', { tag: '@smoke' }, async ({ page }) => {
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();

  const apiA = await apiAs('state.json');
  let conversationId: string;
  try {
    const convRes = await apiA.post('/api/messages', {
      data: { type: 'direct', participantId: userB.id },
    });
    expect(convRes.ok(), await readErrorBody(convRes)).toBe(true);
    conversationId = (await convRes.json()).conversationId;

    const msgRes = await apiA.post(`/api/messages/${conversationId}/messages`, {
      data: { type: 'text', content: `qa-dm-${stamp}` },
    });
    expect(msgRes.ok(), await readErrorBody(msgRes)).toBe(true);
  } finally {
    await apiA.dispose();
  }

  // B reads the message and replies in the UI (1280px viewport = split pane).
  const ctxB = await page.context().browser()!.newContext({
    storageState: 'e2e/.auth/state-b.json',
  });
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto(`/messages?c=${conversationId}`);
    await expect(pageB.getByText(`qa-dm-${stamp}`).first()).toBeVisible({ timeout: 15_000 });
    await pageB.getByPlaceholder('Message…').fill(`qa-reply-${stamp}`);
    // Wait for the send to LAND before leaving the page. The thread only
    // renders a message after the POST answers, and until then the reply's
    // text sits in the textarea — which getByText matches, so
    // asserting on the text alone passed at once and the navigation below
    // aborted the in-flight send (the route reads its body after the write
    // gate and the rate-limit round trips). The textarea clears on success.
    const sent = pageB.waitForResponse(
      (r) => r.url().includes(`/api/messages/${conversationId}/messages`) && r.request().method() === 'POST',
    );
    await pageB.getByRole('button', { name: 'Send message' }).click();
    const sendRes = await sent;
    expect(sendRes.ok(), await readErrorBody(sendRes)).toBe(true);
    await expect(pageB.getByPlaceholder('Message…')).toHaveValue('');
    await expect(pageB.getByText(`qa-reply-${stamp}`).first()).toBeVisible({ timeout: 15_000 });

    // B also received a notification for A's message (title copy is the DB
    // title — new_message has no getNotificationText case; "All" tab only).
    await pageB.goto('/app/notifications');
    await expect(pageB.getByText('Edge QA Alpha sent you a message').first())
      .toBeVisible({ timeout: 15_000 });
  } finally {
    await ctxB.close();
  }

  // A sees B's reply in the UI — poll with reloads rather than trusting a
  // single page load (the thread read is not realtime-ordered with B's write).
  await page.goto(`/messages?c=${conversationId}`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(`qa-reply-${stamp}`).first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});

// Scale round 2 leftovers (Nov 7 2026): the thread's shared posts and shared
// profiles are read in batches (four `.in()` reads for the page), not one per
// message. The payload is unchanged — this pins that the cards still ride
// along, and that a private owner's post stays hidden from a non-follower.
test('a thread with shared posts and profiles: the owner sees the cards, a non-follower of a private owner sees the profile card and no post', async () => {
  test.setTimeout(90_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let postId: string | null = null;
  try {
    const post = await apiA.post('/api/posts', { data: { postType: 'general', caption: `qa-share-${stamp}`, visibility: 'public' } });
    expect(post.ok(), await readErrorBody(post)).toBe(true);
    const created = (await post.json()) as { post?: { id: string }; id?: string };
    postId = created.post?.id ?? created.id ?? null;
    expect(postId).toBeTruthy();

    const convRes = await apiA.post('/api/messages', { data: { type: 'direct', participantId: userB.id } });
    expect(convRes.ok(), await readErrorBody(convRes)).toBe(true);
    const conversationId = (await convRes.json()).conversationId as string;

    for (const data of [
      { type: 'shared_post', shared_post_id: postId },
      { type: 'shared_profile', shared_profile_id: userA.id },
      { type: 'shared_post', shared_post_id: postId }, // the same post twice — one read, two cards
      { type: 'text', content: `qa-after-${stamp}` },
    ]) {
      const sent = await apiA.post(`/api/messages/${conversationId}/messages`, { data });
      expect(sent.ok(), await readErrorBody(sent)).toBe(true);
    }

    // The owner reads their own cards (always viewable); the QA accounts are
    // PRIVATE and B does not follow A, so B gets the shared PROFILE card and a
    // null shared post — the rule the batched lookup must keep.
    type Thread = { messages: Array<{ type: string; shared_post?: { id: string; media: unknown[] } | null; shared_profile?: { id: string } | null }> };
    const own = (await (await apiA.get(`/api/messages/${conversationId}`)).json()) as Thread;
    const ownShares = own.messages.filter(m => m.type === 'shared_post');
    expect(ownShares.length).toBeGreaterThanOrEqual(2);
    for (const m of ownShares) {
      expect(m.shared_post?.id).toBe(postId);
      expect(Array.isArray(m.shared_post?.media)).toBe(true);
    }
    expect(own.messages.filter(m => m.type === 'shared_profile')[0]?.shared_profile?.id).toBe(userA.id);

    const read = await apiB.get(`/api/messages/${conversationId}`);
    expect(read.ok(), await readErrorBody(read)).toBe(true);
    const theirs = (await read.json()) as Thread;
    const theirShares = theirs.messages.filter(m => m.type === 'shared_post');
    expect(theirShares.length).toBeGreaterThanOrEqual(2);
    for (const m of theirShares) expect(m.shared_post, 'a private owner\'s post hides from a non-follower').toBeNull();
    expect(theirs.messages.filter(m => m.type === 'shared_profile')[0]?.shared_profile?.id).toBe(userA.id);
  } finally {
    if (postId) await apiA.delete(`/api/posts/${postId}`).catch(() => undefined);
    await apiA.dispose();
    await apiB.dispose();
  }
});
