import { test, expect } from './helpers/test';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Game film round 2, PR 0 (Nov 13 2026) — a private athlete is never named
// to a stranger. The tagger follows a PRIVATE athlete and tags them; someone
// who may not see that profile reads "Player 1" (no id, no handle) in the
// payload AND on the page, while the game's numbers are the same for
// everyone; the tagger reads the real name. Then the two removal faults: the
// athlete takes their name off and the tagger cannot put them back in
// another ROLE, nor into a new clip of the same game.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

interface Person { profile_id: string | null; name: string; handle: string | null; role: string; masked?: boolean }
interface Row { id: string; people: Person[] }

test('a private athlete is "Player 1" to a stranger, named to the tagger, and a removal cannot be worked round — at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const tagger = loadQaUser('user.json');
  const athlete = loadQaUser('user-b.json');
  const stranger = loadQaUser('user-c.json');
  await resetRateBucket(admin, 'video-write', tagger.id);
  await resetRateBucket(admin, 'video-write', athlete.id);
  const api = await apiAs('state.json');
  const athleteApi = await apiAs('state-b.json');
  const strangerApi = await apiAs('state-c.json');
  const strangerCtx = await browser.newContext({ storageState: await mintStorageState(stranger), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  let videoId: string | null = null;
  const { data: priors } = await admin.from('profiles').select('id, visibility, display_name, full_name').in('id', [tagger.id, athlete.id]);
  const athleteName = (() => {
    const p = ((priors ?? []) as Array<{ id: string; display_name: string | null; full_name: string | null }>).find(r => r.id === athlete.id);
    return p?.display_name || p?.full_name || '';
  })();
  const since = new Date().toISOString();
  try {
    expect(athleteName.length).toBeGreaterThan(0);
    // The tagger is public (a stranger can open the video); the athlete stays PRIVATE and is followed by the tagger, who may therefore tag them.
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', tagger.id);
    await admin.from('profiles').update({ visibility: 'private' }).eq('id', athlete.id);
    await admin.from('follows').delete().eq('follower_id', tagger.id).eq('following_id', athlete.id);
    const follow = await admin.from('follows').insert({ follower_id: tagger.id, following_id: athlete.id, status: 'accepted' });
    expect(follow.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { profileId: tagger.id }, tagger.id);
    await admin.from('videos').delete().eq('profile_id', tagger.id).eq('provider_video_id', 'jNQXAC9IVRw');
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Masked game ${Date.now()}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const ids: string[] = [];
    for (const tag of [
      { start_ms: 1000, label: 'Three', event_key: 'fg3_made', side: 1, period: 1, people: [{ profile_id: athlete.id, role: 'scorer' }] },
      // A typed name that LOOKS like the stand-in is somebody else: it must not merge into the masked athlete's line.
      { start_ms: 4000, label: 'Two', event_key: 'fg2_made', side: 1, period: 1, people: [{ name: 'Player 1', role: 'scorer' }] },
    ]) {
      res = await api.post(`/api/videos/${videoId}/highlights`, { data: tag });
      expect(res.status(), await readErrorBody(res)).toBe(201);
      ids.push(((await res.json()).highlight as { id: string }).id);
    }

    // 1. The tagger (a manager) reads the real name and the link.
    res = await api.get(`/api/videos/${videoId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let rows = (await res.json()).highlights as Row[];
    expect(rows.find(h => h.id === ids[0])!.people[0]).toMatchObject({ profile_id: athlete.id, name: athleteName });

    // 2. A stranger's payload: the stand-in, no id, no handle — and neither the name nor the id anywhere in it.
    res = await strangerApi.get(`/api/videos/${videoId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(athlete.id);
    expect(text).not.toContain(athleteName);
    rows = (JSON.parse(text) as { highlights: Row[] }).highlights;
    expect(rows.find(h => h.id === ids[0])!.people[0]).toMatchObject({ profile_id: null, name: 'Player 1', handle: null, masked: true });
    //    The typed "Player 1" is a typed name, not the stand-in.
    expect(rows.find(h => h.id === ids[1])!.people[0].masked).toBeUndefined();
    //    The private profile's own list is not theirs to read.
    expect((await strangerApi.get(`/api/videos/tagged?profileId=${athlete.id}`)).status()).toBe(404);

    // 3. On the page at phone width: "Player 1" in the highlight and TWO lines in the box score (3 and 2), never one merged line of 5.
    const page = await strangerCtx.newPage();
    await page.goto(`/videos/${videoId}`);
    const people = page.locator('[data-highlight-people]').first();
    await expect(people).toBeVisible({ timeout: 20_000 });
    await expect(people).toContainText('Player 1');
    await expect(page.getByText(athleteName, { exact: false })).toHaveCount(0);
    const box = page.locator('[data-game-box]').first();
    await expect(box).toBeVisible({ timeout: 20_000 });
    await expect(box.locator('[data-game-player="m:player 1"]')).toHaveCount(1);
    await expect(box.locator('[data-game-player="n:player 1"]')).toHaveCount(1);
    expect(await fitsViewportWidth(page)).toBe(true);

    // 4. The athlete takes their name off the game. The tagger cannot put them back in another ROLE on the same tag…
    res = await athleteApi.delete(`/api/videos/${videoId}/tags`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).removed).toBe(1);
    res = await api.patch(`/api/videos/${videoId}/highlights/${ids[0]}`, { data: { event_key: 'fg3_made', side: 1, period: 1, people: [{ profile_id: athlete.id, role: 'assist' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    //    …nor into a NEW clip of the game they left.
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 9000, label: 'Again', event_key: 'fg2_made', side: 1, period: 2, people: [{ profile_id: athlete.id, role: 'scorer' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const { data: active } = await admin.from('video_highlight_people').select('id').eq('video_id', videoId).eq('profile_id', athlete.id).eq('status', 'active');
    expect(active ?? []).toHaveLength(0);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', tagger.id);
    await admin.from('follows').delete().eq('follower_id', tagger.id).eq('following_id', athlete.id);
    await admin.from('notifications').delete().eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since);
    for (const p of (priors ?? []) as Array<{ id: string; visibility: string }>) await admin.from('profiles').update({ visibility: p.visibility }).eq('id', p.id);
    await api.dispose();
    await athleteApi.dispose();
    await strangerApi.dispose();
    await strangerCtx.close();
  }
});
