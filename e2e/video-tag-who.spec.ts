import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Game film round 2, PR 2 (Nov 13 2026) — who may be tagged, and the roster
// first. On a PERSON's own video only a connection is tagged (a follow,
// either way): a public stranger is refused with the sentence, and the
// picker lists connections and does not search. On a CLUB's video anyone on
// Edge Athlete is tagged — a private player nobody follows included — and
// the picker opens on the club's own roster before a letter is typed. The
// list is the managers' alone.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

interface Candidate { id: string; name: string; group: string }

test('a person tags connections only; the picker lists them and does not search — at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const me = loadQaUser('user.json');
  const friend = loadQaUser('user-b.json');
  const stranger = loadQaUser('user-c.json');
  await resetRateBucket(admin, 'video-write', me.id);
  const api = await apiAs('state.json');
  const strangerApi = await apiAs('state-c.json');
  const ctx = await browser.newContext({ storageState: await mintStorageState(me), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  let videoId: string | null = null;
  const { data: priors } = await admin.from('profiles').select('id, visibility').in('id', [me.id, stranger.id]);
  try {
    // The stranger is PUBLIC — visible, findable — and still not this person's to tag.
    await admin.from('profiles').update({ visibility: 'public' }).in('id', [me.id, stranger.id]);
    await admin.from('follows').delete().eq('follower_id', friend.id).eq('following_id', me.id);
    await seedOwnChannel(admin, { profileId: me.id }, me.id);
    await admin.from('videos').delete().eq('profile_id', me.id).eq('provider_video_id', 'jNQXAC9IVRw');
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Who game ${Date.now()}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: null, side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'highlights', stats_hidden: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const tag = (id: string) => api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 1000, label: 'Two', event_key: 'fg2_made', side: 1, period: 1, people: [{ profile_id: id, role: 'scorer' }] } });

    // 1. A public stranger, and a private non-connection: refused, with the sentence and the way through.
    for (const id of [stranger.id, friend.id]) {
      res = await tag(id);
      expect(res.status()).toBe(403);
      expect((await res.json()).error).toContain('people you follow or who follow you');
    }
    //    A typed name is always allowed.
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 500, label: 'Typed', event_key: 'fg2_made', side: 2, period: 1, people: [{ name: 'QA Visitor', role: 'scorer' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(201);

    // 2. A follow in EITHER direction is a connection: the friend follows me — now they can be tagged, and the list names them.
    const follow = await admin.from('follows').insert({ follower_id: friend.id, following_id: me.id, status: 'accepted' });
    expect(follow.error?.message ?? null).toBeNull();
    res = await api.get(`/api/videos/${videoId}/people`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const body = (await res.json()) as { people: Candidate[]; owner_kind: string };
    expect(body.owner_kind).toBe('profile');
    expect(body.people.map(p => [p.id, p.group])).toEqual([[friend.id, 'connections']]);
    res = await tag(friend.id);
    expect(res.status(), await readErrorBody(res)).toBe(201);
    //    The list is the managers': someone else who can see the video is refused.
    expect((await strangerApi.get(`/api/videos/${videoId}/people`)).status()).toBe(403);

    // 3. On the page: the picker opens on the connection, says the rule, and typing a stranger's name finds nobody to link.
    const page = await ctx.newPage();
    await page.goto(`/videos/${videoId}`);
    await page.locator('[data-highlight-add]').first().click();
    await page.locator('[data-tag-add-person="in_clip"]').click();
    const picker = page.locator('[data-tag-picker="profile"]');
    await expect(picker).toBeVisible({ timeout: 20_000 });
    await expect(picker.locator(`[data-tag-pick="${friend.id}"][data-tag-pick-group="connections"]`)).toBeVisible({ timeout: 20_000 });
    await expect(picker.locator('[data-tag-picker-rule]')).toContainText('people you follow or who follow you');
    await picker.locator('[data-tag-picker-input]').fill('Edge QA Charlie');
    await expect(picker.locator('[data-tag-pick-name]')).toBeVisible();
    await expect(picker.locator(`[data-tag-pick="${stranger.id}"]`)).toHaveCount(0);
    expect(await fitsViewportWidth(page)).toBe(true);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', me.id);
    await admin.from('follows').delete().eq('follower_id', friend.id).eq('following_id', me.id);
    await admin.from('notifications').delete().eq('user_id', friend.id).eq('type', 'tag');
    for (const p of (priors ?? []) as Array<{ id: string; visibility: string }>) await admin.from('profiles').update({ visibility: p.visibility }).eq('id', p.id);
    await api.dispose();
    await strangerApi.dispose();
    await ctx.close();
  }
});

test('a club tags anyone — a private player nobody follows — and the picker opens on its own roster — at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const player = loadQaUser('user-c.json'); // on the club's roster, private
  const outsider = loadQaUser('user-d.json'); // private, no relation at all
  await resetRateBucket(admin, 'video-write', owner.id);
  const stamp = `${Date.now()}`;
  const club = await createQaOrg(admin, 'club', { name: `QA Tag Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'basketball', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const ctx = await browser.newContext({ storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  let videoId: string | null = null;
  const since = new Date().toISOString();
  try {
    const seeded = await admin.from('memberships').insert([
      { org_id: club.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' },
      { org_id: club.id, profile_id: player.id, role: 'member', kind: 'follow', status: 'active' },
      { org_id: club.id, profile_id: player.id, role: 'member', kind: 'roster', status: 'active' },
    ]);
    expect(seeded.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { orgId: club.id }, owner.id);
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Club tag game ${stamp}`, side: 'club', org_id: club.id, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: null, side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'highlights', stats_hidden: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // 1. Anyone on Edge Athlete: a private profile the owner has no relation to is tagged, and told.
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 1000, label: 'Two', event_key: 'fg2_made', side: 2, period: 1, people: [{ profile_id: outsider.id, role: 'scorer' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    await expect.poll(async () => ((await admin.from('notifications').select('id').eq('user_id', outsider.id).eq('type', 'tag').gte('created_at', since)).data ?? []).length, { timeout: 15_000 }).toBe(1);
    //    An account that does not exist is not "anyone".
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 2000, label: 'x', event_key: 'fg2_made', side: 2, period: 1, people: [{ profile_id: '11111111-1111-4111-8111-111111111111', role: 'scorer' }] } });
    expect(res.status()).toBe(403);

    // 2. The list is the club's own roster — the private player, by name — and nobody else.
    res = await api.get(`/api/videos/${videoId}/people`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const body = (await res.json()) as { people: Candidate[]; owner_kind: string };
    expect(body.owner_kind).toBe('org');
    expect(body.people.map(p => [p.id, p.group])).toEqual([[player.id, 'roster']]);

    // 3. On the page: the picker opens on the roster before a letter is typed; one tap tags the player.
    const page = await ctx.newPage();
    await page.goto(`/videos/${videoId}`);
    await page.locator('[data-highlight-add]').first().click();
    await page.locator('[data-tag-add-person="in_clip"]').click();
    const picker = page.locator('[data-tag-picker="org"]');
    await expect(picker).toBeVisible({ timeout: 20_000 });
    const row = picker.locator(`[data-tag-pick="${player.id}"][data-tag-pick-group="roster"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(picker.locator('[data-tag-picker-rule]')).toHaveCount(0);
    expect(await fitsViewportWidth(page)).toBe(true);
    await row.click();
    await expect(page.locator(`[data-tag-person="${player.id}"]`)).toBeVisible();
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('notifications').delete().in('user_id', [outsider.id, player.id]).eq('type', 'tag').gte('created_at', since);
    await api.dispose();
    await ctx.close();
    await deleteQaOrgs(admin, [club.id]);
  }
});
