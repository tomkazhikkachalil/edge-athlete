import { test, expect } from './helpers/test';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 3 PR 7 — on the athlete's profile. A club or a creator tags a
// player in a full game and the player does NOTHING: they are told once (not
// per tag), the game appears under "Tagged in" on their Videos tab with the
// link back, how many clips they are in and their line; a stranger does not
// get the line while the game is spoiler-free. The athlete removes a tag of
// themselves — one highlight's, or all — the stat drops, and the tagger's
// next save cannot tag them back in.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

test('tagged by someone else: told once, on the profile with the clips and the line, hidden from a stranger while spoiler-free, removable for good — at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const tagger = loadQaUser('user.json');
  const athlete = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'video-write', tagger.id);
  await resetRateBucket(admin, 'video-write', athlete.id);
  const api = await apiAs('state.json');
  const athleteApi = await apiAs('state-b.json');
  const strangerApi = await apiAs('state-c.json');
  const athleteCtx = await browser.newContext({ storageState: await mintStorageState(athlete), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  let videoId: string | null = null;
  // QA users are minted PRIVATE: the tagger must be able to SEE the athlete to tag them, and a stranger reads public profiles only. Restored in finally.
  const { data: priors } = await admin.from('profiles').select('id, visibility').in('id', [tagger.id, athlete.id]);
  const since = new Date().toISOString();
  try {
    await admin.from('profiles').update({ visibility: 'public' }).in('id', [tagger.id, athlete.id]);
    // Round 2 (Nov 13): on a person's own video only a CONNECTION is tagged — the tagger follows the athlete.
    await admin.from('follows').delete().eq('follower_id', tagger.id).eq('following_id', athlete.id);
    await admin.from('follows').insert({ follower_id: tagger.id, following_id: athlete.id, status: 'accepted' });
    await seedOwnChannel(admin, { profileId: tagger.id }, tagger.id);
    await admin.from('videos').delete().eq('profile_id', tagger.id).eq('provider_video_id', 'jNQXAC9IVRw');
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Tagged-in game ${Date.now()}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const ids: string[] = [];
    for (const tag of [
      { start_ms: 1000, label: 'Three', event_key: 'fg3_made', side: 1, period: 1, people: [{ profile_id: athlete.id, role: 'scorer' }] },
      { start_ms: 4000, label: 'Two', event_key: 'fg2_made', side: 1, period: 2, people: [{ profile_id: athlete.id, role: 'scorer' }] },
      { start_ms: 8000, label: 'Other side', event_key: 'fg2_made', side: 2, period: 2, people: [{ name: 'QA Owl', role: 'scorer' }] },
    ]) {
      res = await api.post(`/api/videos/${videoId}/highlights`, { data: tag });
      expect(res.status(), await readErrorBody(res)).toBe(201);
      ids.push(((await res.json()).highlight as { id: string }).id);
    }

    // 1. Told ONCE for the game — two tags, one notification — with the link back.
    const told = async () => (await admin.from('notifications').select('id, title, action_url').eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since).contains('metadata', { video_id: videoId })).data ?? [];
    await expect.poll(async () => (await told()).length, { timeout: 15_000 }).toBe(1);
    expect((await told())[0]).toMatchObject({ action_url: `/videos/${videoId}` });

    // 2. The athlete's own read: the game, two clips, their line (5 points) — shown to THEM though the game is spoiler-free.
    res = await athleteApi.get(`/api/videos/tagged?profileId=${athlete.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let body = await res.json();
    expect(body.can_remove).toBe(true);
    let mine = (body.games as Array<{ video: { id: string }; game_title: string; clips: number; line: Array<{ label: string; value: string }> | null; stats_hidden: boolean }>).find(g => g.video.id === videoId)!;
    expect(mine).toMatchObject({ game_title: 'QA Hawks vs QA Owls', clips: 2, stats_hidden: false });
    expect(mine.line!.find(c => c.label === 'PTS')!.value).toBe('5');
    //    A stranger sees the game and the clip count on the public profile — not the line (no spoilers), and cannot remove.
    res = await strangerApi.get(`/api/videos/tagged?profileId=${athlete.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    body = await res.json();
    expect(body.can_remove).toBe(false);
    expect((body.games as Array<{ video: { id: string }; clips: number; line: unknown; stats_hidden: boolean }>).find(g => g.video.id === videoId)).toMatchObject({ clips: 2, line: null, stats_hidden: true });
    //    The stranger cannot remove the athlete's tags: acting for someone else is refused.
    expect((await strangerApi.delete(`/api/videos/${videoId}/tags?profileId=${athlete.id}`)).ok()).toBe(false);

    // 3. On the athlete's profile, at phone width: "Tagged in", the card, the line, the link back.
    const page = await athleteCtx.newPage();
    await page.goto('/athlete?tab=videos');
    const card = page.locator(`[data-tagged-game="${videoId}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-tagged-game-title]')).toHaveText('QA Hawks vs QA Owls');
    await expect(card.locator('[data-tagged-game-clips="2"]')).toBeVisible();
    await expect(card.locator('[data-tagged-game-line]')).toContainText('PTS');
    await expect(card.locator('[data-tagged-game-open]')).toHaveAttribute('href', `/videos/${videoId}`);
    expect(await fitsViewportWidth(page)).toBe(true);

    // 3b. The Stats tab (Tom, Nov 12): "From game film" — a third list, labelled apart, the line with the link back, and said NOT to be in the totals.
    await page.goto('/athlete?tab=stats');
    const film = page.locator(`[data-game-film-row="${videoId}"]`);
    await expect(film).toBeVisible({ timeout: 20_000 });
    await expect(film.locator('[data-game-film-link]')).toHaveAttribute('href', `/videos/${videoId}`);
    await expect(film.locator('[data-game-film-line]')).toContainText('PTS');
    await expect(page.locator('[data-game-film-lines]')).toContainText('not counted in the season totals');
    expect(await fitsViewportWidth(page)).toBe(true);

    // 4. One highlight's tag removed through the API: one clip left, three points gone.
    res = await athleteApi.delete(`/api/videos/${videoId}/tags?highlightId=${ids[0]}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).removed).toBe(1);
    res = await athleteApi.get(`/api/videos/tagged?profileId=${athlete.id}`);
    mine = ((await res.json()).games as Array<{ video: { id: string }; game_title: string; clips: number; line: Array<{ label: string; value: string }> | null; stats_hidden: boolean }>).find(g => g.video.id === videoId)!;
    expect(mine.clips).toBe(1);
    expect(mine.line!.find(c => c.label === 'PTS')!.value).toBe('2');

    // 5. On the video page the athlete sees they are tagged and removes the rest; the confirm names what is lost.
    await page.goto(`/videos/${videoId}`);
    await expect(page.locator('[data-video-tagged-me]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-video-untag-me]').click();
    await expect(page.getByText('cannot be put back by the people who made them')).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('[data-video-tagged-me]')).toHaveCount(0, { timeout: 20_000 });
    res = await athleteApi.get(`/api/videos/tagged?profileId=${athlete.id}`);
    expect(((await res.json()).games as Array<{ video: { id: string } }>).some(g => g.video.id === videoId)).toBe(false);
    await page.goto('/athlete?tab=videos');
    await expect(page.locator('[data-profile-videos]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-tagged-game="${videoId}"]`)).toHaveCount(0);

    // 6. For good: the tagger saves the tag again with the athlete on it — they are NOT tagged back in, and not told again.
    res = await api.patch(`/api/videos/${videoId}/highlights/${ids[1]}`, { data: { event_key: 'fg2_made', side: 1, period: 2, people: [{ profile_id: athlete.id, role: 'scorer' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const after = ((await res.json()).highlights as Array<{ id: string; people: unknown[] }>).find(h => h.id === ids[1])!;
    expect(after.people).toHaveLength(0);
    expect((await told()).length).toBe(1);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', tagger.id);
    await admin.from('follows').delete().eq('follower_id', tagger.id).eq('following_id', athlete.id);
    await admin.from('notifications').delete().eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since);
    for (const p of (priors ?? []) as Array<{ id: string; visibility: string }>) await admin.from('profiles').update({ visibility: p.visibility }).eq('id', p.id);
    await api.dispose();
    await athleteApi.dispose();
    await strangerApi.dispose();
    await athleteCtx.close();
  }
});
