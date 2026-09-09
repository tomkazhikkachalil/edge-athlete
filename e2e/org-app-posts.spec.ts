import { test, expect } from '@playwright/test';
import path from 'node:path';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cleanRoundPost, seedRoundPost } from './helpers/member-photos';

// Org Pages R5: the members' posts wall reads /api/posts?org=<side>:<id>
// — the org-lens rule (post public AND author public, published) applied
// to ONE org's people, media-only with withMedia=1. A public member's
// media post appears as a tile that opens the detail modal; a text-only
// post and a private member's post do not; a private org answers members
// only; a malformed org= is a 400.

test('org posts wall: public media post → tile → detail; text-only + private author excluded; private org members-only; bad org 400', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json'); // stays PRIVATE
  const alpha = loadQaUser('user.json'); // the member, made public
  const stamp = `${Date.now()}`;
  const { data: alphaProfile } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  const priorVisibility = alphaProfile!.visibility as string;
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);

  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Posts Club ${stamp}`, owner_profile_id: owner.id, primary_sport: 'golf' })
    .select('id')
    .single();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: clubId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);
  const alphaApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  let alphaMedia: Awaited<ReturnType<typeof seedRoundPost>> | null = null;
  let ownerMedia: Awaited<ReturnType<typeof seedRoundPost>> | null = null;
  const textCaption = `Text only ${stamp}`;
  let textPostId: string | null = null;
  try {
    alphaMedia = await seedRoundPost(admin, alpha.id, { stamp, visibility: 'public' });
    ownerMedia = await seedRoundPost(admin, owner.id, { stamp: `${stamp}b`, visibility: 'public' }); // public post, PRIVATE author
    const { data: textPost } = await admin
      .from('posts')
      .insert({ profile_id: alpha.id, caption: textCaption, visibility: 'public', status: 'published', sport_key: 'general' })
      .select('id')
      .single();
    textPostId = textPost!.id as string;

    // The read, anonymous (public org): alpha's media post only.
    let res = await anon.request.get(`/api/posts?org=club:${clubId}&withMedia=1&limit=12&cursor=`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const ids = ((await res.json()) as { posts: Array<{ id: string }> }).posts.map(p => p.id);
    expect(ids).toContain(alphaMedia.postId);
    expect(ids).not.toContain(textPostId); // withMedia=1
    expect(ids).not.toContain(ownerMedia.postId); // private author
    // Without withMedia the text-only post is in scope too.
    res = await anon.request.get(`/api/posts?org=club:${clubId}&limit=12&cursor=`);
    expect(((await res.json()) as { posts: Array<{ id: string }> }).posts.map(p => p.id)).toContain(textPostId);
    // A malformed org= is a 400, not a silent full feed.
    expect((await anon.request.get('/api/posts?org=club:nonsense')).status()).toBe(400);

    // The page (alpha): the wall shows one tile; the tile opens the detail modal.
    await page.goto(`/club/${clubId}`);
    const wall = page.locator('[data-org-bubble="posts"]');
    await expect(wall).toBeVisible({ timeout: 20_000 });
    await expect(wall.locator('[data-org-posts="1"]')).toBeVisible();
    await wall.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
    // Optional visual dump (E2E_DUMP_DIR precedent): the wall on the page.
    if (process.env.E2E_DUMP_DIR) await wall.screenshot({ path: path.join(process.env.E2E_DUMP_DIR, 'org-posts-wall.png') });
    await wall.locator('[data-org-posts] > *').first().click();
    await expect(page.getByText(`QA round ${stamp} (public)`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
    await page.keyboard.press('Escape');

    // A private org: anonymous 403, member 200.
    await admin.from('clubs').update({ visibility: 'private' }).eq('id', clubId);
    expect((await anon.request.get(`/api/posts?org=club:${clubId}&withMedia=1&cursor=`)).status()).toBe(403);
    expect((await alphaApi.get(`/api/posts?org=club:${clubId}&withMedia=1&cursor=`)).status()).toBe(200);
  } finally {
    await anon.close();
    await alphaApi.dispose();
    if (textPostId) await admin.from('posts').delete().eq('id', textPostId);
    await cleanRoundPost(admin, alphaMedia);
    await cleanRoundPost(admin, ownerMedia);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('profiles').update({ visibility: priorVisibility }).eq('id', alpha.id);
  }
});
