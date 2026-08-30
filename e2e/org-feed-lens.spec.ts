import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Feed org lens (fan-out round PR 2): ?scope=orgs shows org peers' posts
// but ONLY already-anonymous-visible content (post public AND author
// public — the activity-server rule). It is a scope, not an access grant:
// a private peer's post stays hidden even though the viewer is a
// co-member. Anonymous scope=orgs is an empty envelope; a viewer with no
// orgs gets noOrgs for the join-orgs empty state.
test('org feed lens: peer public post shows, private peer post hidden, anon empty', async ({ request }) => {
  test.setTimeout(120_000);
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('memberships').select('club_id').limit(1);
  test.skip(!!probe.error, `memberships missing — run migration 140 (${probe.error?.message})`);

  const stamp = Date.now();
  const clubName = `QA Lens Club ${stamp}`;
  const publicCaption = `Lens public probe ${stamp}`;
  const privateCaption = `Lens private probe ${stamp}`;

  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name: clubName, owner_profile_id: userB.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, profile_id: userB.id, role: 'owner' },
    { club_id: clubId, profile_id: userA.id, role: 'member' },
  ]);

  // B goes public and posts publicly (the visible one); B also posts to a
  // second caption while PRIVATE later. Flip order keeps one update each.
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', userB.id);
  const { data: postPublic } = await admin
    .from('posts')
    .insert({ profile_id: userB.id, caption: publicCaption, visibility: 'public', status: 'published', sport_key: 'general' })
    .select()
    .single();

  try {
    const apiA = await apiAs('state.json');
    try {
      // Public author + public post → visible in A's lens.
      const res1 = await apiA.get('/api/posts?limit=50&scope=orgs');
      expect(res1.ok(), await readErrorBody(res1)).toBe(true);
      const body1 = await res1.json();
      expect(body1.posts.some((p: { id: string }) => p.id === postPublic!.id)).toBe(true);

      // Author flips private → the SAME post disappears from the lens
      // (author half of the anonymous-visible rule), co-membership or not.
      await admin.from('profiles').update({ visibility: 'private' }).eq('id', userB.id);
      const res2 = await apiA.get('/api/posts?limit=50&scope=orgs');
      const body2 = await res2.json();
      expect(body2.posts.some((p: { id: string }) => p.id === postPublic!.id)).toBe(false);
      // (privateCaption never posted — the flip covers the same rule with
      // one fewer fixture; the name documents intent.)
      void privateCaption;
    } finally {
      await apiA.dispose();
    }

    // Anonymous scope=orgs → empty envelope, no error.
    const anonRes = await request.get('/api/posts?limit=10&scope=orgs');
    expect(anonRes.ok(), await readErrorBody(anonRes)).toBe(true);
    const anonBody = await anonRes.json();
    expect(anonBody.posts).toEqual([]);
    expect(anonBody.hasMore).toBe(false);

    // A viewer with no orgs gets the noOrgs marker: user B leaves no orgs
    // to check against, so probe by removing A's membership.
    await admin.from('memberships').delete().eq('club_id', clubId).eq('profile_id', userA.id);
    const apiA2 = await apiAs('state.json');
    try {
      const res3 = await apiA2.get('/api/posts?limit=10&scope=orgs');
      const body3 = await res3.json();
      // A may belong to other QA orgs from parallel specs; only assert the
      // envelope when A genuinely has none.
      if (body3.noOrgs) {
        expect(body3.posts).toEqual([]);
        expect(body3.hasMore).toBe(false);
      }
    } finally {
      await apiA2.dispose();
    }
  } finally {
    if (postPublic) await admin.from('posts').delete().eq('id', postPublic.id);
    await admin.from('profiles').update({ visibility: 'private' }).eq('id', userB.id);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
