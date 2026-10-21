import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Flow changes C3 (269, Oct 19 2026): the feed is a SWITCH. Edit post flips
// it ("Post to feed" off → the post leaves the feed, stays on the profile; the
// account's audience never changes). A workout the owner hid from their
// profile is absent for a visitor and a 404 by id, while the owner still has it.

test('Edit post → Post to feed off: the post leaves the feed and stays on the profile @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const user = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const caption = `Switch me ${Date.now()}`;
  let postId: string | null = null;
  try {
    const made = await api.post('/api/posts', { data: { caption, visibility: 'public', postType: 'general' } });
    expect(made.ok(), await readErrorBody(made)).toBe(true);
    postId = (await made.json()).post.id as string;

    await page.goto('/feed');
    const card = page.locator('[data-testid="post-card"]').filter({ hasText: caption }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Post options' }).click();
    await page.locator('[data-menu-item="edit"]').click();
    const toggle = page.locator('[data-edit-post-audience] [data-feed-toggle]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    // The audience line stays beside it — an edit never changes who sees the post.
    await expect(page.locator('[data-edit-post-audience] [data-account-audience]')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Update Post' }).click();
    await expect.poll(async () => (await admin.from('posts').select('on_feed, visibility, status').eq('id', postId!).single()).data, { timeout: 15_000 })
      .toMatchObject({ on_feed: false, visibility: 'public', status: 'published' });
    await expect(card).toHaveCount(0, { timeout: 20_000 });
    const own = await api.get(`/api/posts?userId=${user.id}&limit=50`);
    expect(((await own.json()).posts as Array<{ id: string }>).map(p => p.id)).toContain(postId);
    const feed = await api.get('/api/posts?limit=50');
    expect(((await feed.json()).posts as Array<{ id: string }>).map(p => p.id)).not.toContain(postId);
    // The switch flips back through the same writer.
    const back = await api.put('/api/posts', { data: { postId, onFeed: true } });
    expect(back.ok(), await readErrorBody(back)).toBe(true);
    expect((await admin.from('posts').select('on_feed').eq('id', postId).single()).data?.on_feed).toBe(true);
  } finally {
    if (postId) await admin.from('posts').delete().eq('id', postId);
    await api.dispose();
  }
});

test('a workout hidden from the profile: absent for a visitor, 404 by id, still the owner\'s @mobile', async () => {
  test.setTimeout(90_000);
  const alpha = loadQaUser('user.json');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const admin = adminClient();
  let id: string | null = null;
  const { data: before } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    const started = await apiA.post('/api/workouts', { data: { mode: 'live' } });
    expect(started.status(), await readErrorBody(started)).toBe(201);
    id = (await started.json()).session.id as string;
    const done = await apiA.patch(`/api/workouts/${id}`, { data: { title: `QA Hidden ${Date.now()}`, finish: { endedAt: new Date().toISOString() } } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);
    // Training fixes PR 4: a finished workout is UNPOSTED until Post or Done — a visitor's 404 — then visible on a public account.
    expect((await apiB.get(`/api/workouts/${id}`)).status()).toBe(404);
    const decided = await apiA.patch(`/api/workouts/${id}`, { data: { decided: true } });
    expect(decided.ok(), await readErrorBody(decided)).toBe(true);
    expect((await apiB.get(`/api/workouts/${id}`)).status()).toBe(200);
    const listed = await apiB.get(`/api/workouts?profileId=${alpha.id}&limit=50`);
    expect(listed.ok(), await readErrorBody(listed)).toBe(true);
    expect(JSON.stringify(await listed.json())).toContain(id);
    // Hidden: gone for the visitor, 404 by id; the owner still reads it.
    const hide = await apiA.patch(`/api/workouts/${id}`, { data: { hidden: true } });
    expect(hide.ok(), await readErrorBody(hide)).toBe(true);
    expect((await apiB.get(`/api/workouts/${id}`)).status()).toBe(404);
    expect(JSON.stringify(await (await apiB.get(`/api/workouts?profileId=${alpha.id}&limit=50`)).json())).not.toContain(id);
    const own = await apiA.get(`/api/workouts/${id}`);
    expect(own.status()).toBe(200);
    expect((await own.json()).session.profile_hidden_at).toBeTruthy();
    // Shown again.
    expect((await apiA.patch(`/api/workouts/${id}`, { data: { hidden: false } })).ok()).toBe(true);
    expect((await apiB.get(`/api/workouts/${id}`)).status()).toBe(200);
  } finally {
    if (id) await apiA.delete(`/api/workouts/${id}`);
    await admin.from('profiles').update({ visibility: before?.visibility ?? 'private' }).eq('id', alpha.id);
    await apiA.dispose();
    await apiB.dispose();
  }
});
