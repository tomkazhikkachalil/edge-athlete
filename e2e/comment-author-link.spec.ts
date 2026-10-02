import { test, expect, type Page } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Fix round, part 6 (Oct 2026) — a commenter's picture and name open their
// profile. They were plain text on every width (only @mentions linked), so
// "someone commented on my post" had no way through to that person. Bravo
// comments on alpha's post and alpha replies; alpha then taps bravo's NAME
// and PICTURE on the feed card, their own name on the reply, and bravo's
// name inside the post pop-up. The last case is the pop-up on a PROFILE
// page: a commenter there leads to the same route with another id, and the
// pop-up must not follow. The QA users are private and do not follow each
// other, so every case also holds that a private commenter still has a name.
//
// Every step runs in its OWN page: a page.goto right after a Link's soft
// navigation is hijacked by Next's hard-navigation fallback on WebKit.

interface Seed {
  postId: string;
  caption: string;
  comment: string;
  reply: string;
}

async function seed(): Promise<Seed> {
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'post-create', alpha.id);
  await resetRateBucket(admin, 'comment-create', alpha.id);
  await resetRateBucket(admin, 'comment-create', bravo.id);
  const stamp = Date.now();
  const caption = `Comment author link ${stamp}`;
  const comment = `qa nice round ${stamp}`;
  const reply = `qa thanks ${stamp}`;
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  try {
    let res = await alphaApi.post('/api/posts', { data: { caption, visibility: 'public', postType: 'general' } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const postId = (await res.json()).post.id as string;
    res = await bravoApi.post('/api/comments', { data: { postId, content: comment } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const commentId = (await res.json()).comment.id as string;
    res = await alphaApi.post('/api/comments', { data: { postId, content: reply, parentCommentId: commentId } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    return { postId, caption, comment, reply };
  } finally {
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
}

/** The feed card for the seeded post, with its comments open. */
async function openCardComments(page: Page, s: Seed) {
  await page.goto('/feed');
  const card = page.locator('[data-testid="post-card"]').filter({ hasText: s.caption }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: /View Comments/ }).click();
  await expect(card.getByText(s.comment)).toBeVisible({ timeout: 15_000 });
  return card;
}

async function tapsLeadToProfiles(page: Page, s: Seed) {
  const bravo = loadQaUser('user-b.json');
  const bravoProfile = new RegExp(`/athlete/${bravo.id}$`);

  // The NAME on the feed card.
  let card = await openCardComments(page, s);
  let row = card.locator('[data-depth="0"]').filter({ hasText: s.comment });
  const name = row.locator('[data-comment-author="name"]');
  await expect(name).toHaveText(/Bravo/);
  await name.click();
  await expect(page).toHaveURL(bravoProfile, { timeout: 20_000 });

  // The PICTURE on the feed card.
  const second = await page.context().newPage();
  card = await openCardComments(second, s);
  row = card.locator('[data-depth="0"]').filter({ hasText: s.comment });
  await row.locator('[data-comment-author="avatar"]').click();
  await expect(second).toHaveURL(bravoProfile, { timeout: 20_000 });
  await second.close();

  // Your own name, on a reply, is your own profile page.
  const third = await page.context().newPage();
  card = await openCardComments(third, s);
  const replyRow = card.locator('[data-depth="1"]').filter({ hasText: s.reply });
  await replyRow.locator('[data-comment-author="name"]').click();
  await expect(third).toHaveURL(/\/athlete$/, { timeout: 20_000 });
  await third.close();

  // Inside the post pop-up: the profile shows and no pop-up is left over it.
  const fourth = await page.context().newPage();
  await fourth.goto(`/feed?post=${s.postId}`);
  const popup = fourth.locator('[data-post-detail]');
  await expect(popup).toBeVisible({ timeout: 20_000 });
  await popup.getByRole('button', { name: /View Comments/ }).click();
  await popup.locator('[data-depth="0"]').filter({ hasText: s.comment }).locator('[data-comment-author="name"]').click();
  await expect(fourth).toHaveURL(bravoProfile, { timeout: 20_000 });
  await expect(fourth.locator('[data-post-detail]')).toHaveCount(0);
  await fourth.close();
}

async function cleanup(s: Seed | null) {
  if (s) await adminClient().from('posts').delete().eq('id', s.postId);
}

test("comment author link: a commenter's name and picture open their profile, on the card and in the pop-up", async ({ page }) => {
  test.setTimeout(180_000);
  let s: Seed | null = null;
  try {
    s = await seed();
    await tapsLeadToProfiles(page, s);
  } finally {
    await cleanup(s);
  }
});

test("comment author link: a commenter's name and picture open their profile at phone width @mobile", async ({ page }) => {
  test.setTimeout(180_000);
  let s: Seed | null = null;
  try {
    s = await seed();
    await tapsLeadToProfiles(page, s);
  } finally {
    await cleanup(s);
  }
});

test('comment author link: from the pop-up on a profile page, a commenter leads to THEIR profile and the pop-up is gone', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const charlie = loadQaUser('user-c.json');
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  let s: Seed | null = null;
  // Bravo is the viewer: neither the post's author nor this commenter.
  const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
  try {
    s = await seed();
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    await resetRateBucket(admin, 'comment-create', charlie.id);
    const charlieSays = `qa well played ${Date.now()}`;
    const charlieApi = await apiAs('state-c.json');
    try {
      const res = await charlieApi.post('/api/comments', { data: { postId: s.postId, content: charlieSays } });
      expect(res.status(), await readErrorBody(res)).toBe(201);
    } finally {
      await charlieApi.dispose();
    }

    // /athlete/<alpha> → /athlete/<charlie> is the SAME route with another
    // id: the page that hosts the pop-up must not carry it over.
    const page = await ctxB.newPage();
    await page.goto(`/athlete/${alpha.id}?post=${s.postId}`);
    const popup = page.locator('[data-post-detail]');
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await popup.getByRole('button', { name: /View Comments/ }).click();
    // Charlie's profile is private and bravo does not follow them: the
    // comment still carries its author's name (it drew "Unknown User").
    const name = popup.locator('[data-depth="0"]').filter({ hasText: charlieSays }).locator('[data-comment-author="name"]');
    await expect(name).toHaveText(/Charlie/, { timeout: 15_000 });
    await name.click();
    await expect(page).toHaveURL(new RegExp(`/athlete/${charlie.id}$`), { timeout: 20_000 });
    await expect(page.locator('[data-post-detail]')).toHaveCount(0);
  } finally {
    await ctxB.close().catch(() => null);
    await admin.from('profiles').update({ visibility: prior?.visibility ?? 'private' }).eq('id', alpha.id);
    await cleanup(s);
  }
});
