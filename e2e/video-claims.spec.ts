import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, deleteQaUser, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Game film round 2, PR 4 (Nov 13 2026; migration 308) — "this is me". A
// club tags a typed name and a player without an account. An athlete with an
// account ASKS to be linked — nothing changes until a manager of the video
// approves and says which name they are; then the clips and the line are on
// the athlete's profile and they are told once. A manager also links a
// placeholder player to a profile directly. A real athlete's tags are never
// moved, a stranger decides nothing, and a declined request says so.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

interface Target { kind: string; name: string; profile_id: string | null; clips: number }

test('an athlete asks, the manager says who they are, the tags become theirs; a placeholder is linked directly; a decline is said — at 375 px', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const athlete = loadQaUser('user.json');
  const second = loadQaUser('user-c.json');
  const third = loadQaUser('user-d.json');
  for (const u of [owner, athlete, second, third]) await resetRateBucket(admin, 'video-write', u.id);
  await resetRateBucket(admin, 'tag-placeholder', owner.id);
  const stamp = `${Date.now()}`;
  const club = await createQaOrg(admin, 'club', { name: `QA Claim Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'basketball', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const athleteApi = await apiAs('state.json');
  const secondApi = await apiAs('state-c.json');
  const thirdApi = await apiAs('state-d.json');
  const ownerCtx = await browser.newContext({ storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const thirdCtx = await browser.newContext({ storageState: await mintStorageState(third), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const stubIds: string[] = [];
  let videoId: string | null = null;
  const since = new Date().toISOString();
  try {
    const seeded = await admin.from('memberships').insert([{ org_id: club.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' }]);
    expect(seeded.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { orgId: club.id }, owner.id);
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Claim game ${stamp}`, side: 'club', org_id: club.id, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // A placeholder player, and a typed name spelled two ways across two clips.
    res = await api.post(`/api/videos/${videoId}/people`, { data: { name: `Stub ${stamp.slice(-6)}` } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const stub = (await res.json()).person as { id: string; name: string };
    stubIds.push(stub.id);
    for (const tag of [
      { start_ms: 1000, label: 'Three', event_key: 'fg3_made', side: 1, period: 1, people: [{ name: 'QA Ghöst', role: 'scorer' }] },
      { start_ms: 4000, label: 'Two', event_key: 'fg2_made', side: 1, period: 2, people: [{ name: 'qa  ghost', role: 'scorer' }] },
      { start_ms: 8000, label: 'Stub two', event_key: 'fg2_made', side: 2, period: 2, people: [{ profile_id: stub.id, role: 'scorer' }] },
    ]) {
      res = await api.post(`/api/videos/${videoId}/highlights`, { data: tag });
      expect(res.status(), await readErrorBody(res)).toBe(201);
    }

    // 1. The athlete asks. Nothing moves; asking again is the same request; they read only their own.
    res = await athleteApi.post(`/api/videos/${videoId}/claims`, { data: { name: ' QA Ghost ' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const claim = (await res.json()).claim as { id: string; status: string };
    expect(claim.status).toBe('pending');
    res = await athleteApi.post(`/api/videos/${videoId}/claims`, { data: {} });
    expect(((await res.json()).claim as { id: string }).id).toBe(claim.id);
    res = await athleteApi.get(`/api/videos/${videoId}/claims`);
    expect(await res.json()).toMatchObject({ can_manage: false, mine: { id: claim.id, status: 'pending', asked_name: 'QA Ghost' } });
    const { data: before } = await admin.from('video_highlight_people').select('id').eq('video_id', videoId).eq('profile_id', athlete.id);
    expect(before ?? []).toHaveLength(0);
    //    Someone who is not a manager decides nothing.
    expect((await secondApi.patch(`/api/videos/${videoId}/claims/${claim.id}`, { data: { action: 'approve', target: { name: 'QA Ghost' } } })).status()).toBe(403);
    expect((await secondApi.post(`/api/videos/${videoId}/links`, { data: { target: { name: 'QA Ghost' }, profile_id: second.id } })).status()).toBe(403);

    // 2. The manager's read: the request, and what can be linked — the name once (two spellings, two clips) and the placeholder.
    res = await api.get(`/api/videos/${videoId}/claims`);
    const managed = (await res.json()) as { can_manage: boolean; claims: Array<{ id: string; requester: { id: string } }>; targets: Target[] };
    expect(managed.can_manage).toBe(true);
    expect(managed.claims.map(c => c.requester.id)).toEqual([athlete.id]);
    expect(managed.targets).toEqual([
      { kind: 'name', name: 'QA Ghöst', profile_id: null, clips: 2 },
      { kind: 'placeholder', name: stub.name, profile_id: stub.id, clips: 1 },
    ]);

    // 3. On the page the manager says who they are and links them.
    const page = await ownerCtx.newPage();
    await page.goto(`/videos/${videoId}`);
    const panel = page.locator('[data-tag-claims="1"]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const rowOf = panel.locator(`[data-tag-claim-row="${athlete.id}"]`);
    await expect(rowOf).toContainText('says they are “QA Ghost”');
    await expect(rowOf.locator('[data-tag-claim-approve]')).toBeDisabled();
    await rowOf.locator('[data-tag-claim-target]').selectOption('n:QA Ghöst');
    expect(await fitsViewportWidth(page)).toBe(true);
    await rowOf.locator('[data-tag-claim-approve]').click();
    await expect(page.locator('[data-tag-claims-note]')).toHaveText('Linked 2 tags in 1 game.', { timeout: 20_000 });

    // 4. They are the athlete's: two clips, five points on the profile, told once; the request is closed for good.
    res = await athleteApi.get(`/api/videos/tagged?profileId=${athlete.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const mine = ((await res.json()).games as Array<{ video: { id: string }; clips: number; line: Array<{ label: string; value: string }> | null }>).find(g => g.video.id === videoId)!;
    expect(mine.clips).toBe(2);
    expect(mine.line!.find(c => c.label === 'PTS')!.value).toBe('5');
    const told = (await admin.from('notifications').select('id').eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since).contains('metadata', { video_id: videoId })).data ?? [];
    expect(told).toHaveLength(1);
    expect((await api.patch(`/api/videos/${videoId}/claims/${claim.id}`, { data: { action: 'decline' } })).status()).toBe(409);

    // 5. A manager links the placeholder player directly. A real athlete's tags are never a target; nobody is linked TO a placeholder.
    res = await api.post(`/api/videos/${videoId}/links`, { data: { target: { profile_id: athlete.id }, profile_id: second.id } });
    expect(res.status()).toBe(400);
    res = await api.post(`/api/videos/${videoId}/links`, { data: { target: { name: 'QA Ghost' }, profile_id: stub.id } });
    expect(res.status()).toBe(400);
    res = await api.post(`/api/videos/${videoId}/links`, { data: { target: { profile_id: stub.id }, profile_id: second.id } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ linked: 1, videos: 1, kept: 0 });
    const { data: moved } = await admin.from('video_highlight_people').select('profile_id').eq('video_id', videoId).in('profile_id', [stub.id, second.id]);
    expect((moved ?? []).map(r => (r as { profile_id: string }).profile_id)).toEqual([second.id]);

    // 6. A third athlete asks from the page at phone width; the manager declines; it is said, and nothing was linked.
    const viewer = await thirdCtx.newPage();
    await viewer.goto(`/videos/${videoId}`);
    const ask = viewer.locator('[data-tag-claim="none"]');
    await expect(ask).toBeVisible({ timeout: 20_000 });
    await ask.locator('[data-tag-claim-name]').fill('Somebody Else');
    expect(await fitsViewportWidth(viewer)).toBe(true);
    await ask.locator('[data-tag-claim-ask]').click();
    await expect(viewer.locator('[data-tag-claim-pending]')).toBeVisible({ timeout: 20_000 });
    res = await api.get(`/api/videos/${videoId}/claims`);
    const open = ((await res.json()).claims as Array<{ id: string; requester: { id: string } }>).find(c => c.requester.id === third.id)!;
    res = await api.patch(`/api/videos/${videoId}/claims/${open.id}`, { data: { action: 'decline' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'declined', linked: 0 });
    res = await thirdApi.get(`/api/videos/${videoId}/claims`);
    expect((await res.json()).mine).toMatchObject({ status: 'declined' });
    const { data: none } = await admin.from('video_highlight_people').select('id').eq('video_id', videoId).eq('profile_id', third.id);
    expect(none ?? []).toHaveLength(0);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('notifications').delete().in('user_id', [owner.id, athlete.id, second.id, third.id]).eq('type', 'tag').gte('created_at', since);
    for (const c of [api, athleteApi, secondApi, thirdApi]) await c.dispose();
    await ownerCtx.close();
    await thirdCtx.close();
    for (const id of stubIds) await deleteQaUser(id).catch(() => undefined);
    await deleteQaOrgs(admin, [club.id]);
  }
});
