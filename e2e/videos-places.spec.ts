import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { liveWire } from './helpers/activities';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Videos program, Phase 1b (297): a video's place can be a golf round, an
// activity or a workout. Attaching needs the PLACE's manager; a place's
// list answers to the place's own view rule, then the owner's. The QA user
// (A) owns each place; B is a stranger; the API and the three surfaces
// (the round card's Media tab, the activity screen, the workout review) say
// the same thing. A different YouTube id per place: one row per owner.
const ROUND_YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const ACTIVITY_YT = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const WORKOUT_YT = 'https://www.youtube.com/watch?v=9bZkp7q19f0';
// Only the connected channel (Nov 11 2026): the links save because the owner's connection names those videos' channel.
withOwnChannel(['jNQXAC9IVRw', 'aqz-KE-bpKQ', '9bZkp7q19f0']);

test('videos on a round, an activity and a workout: the place\'s manager attaches; the place\'s rule gates the list; the surfaces show them', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'video-write', alpha.id);
  await resetRateBucket(admin, 'video-write', bravo.id);
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const stamp = Date.now();
  let groupPostId: string | null = null;
  let activityId: string | null = null;
  let workoutId: string | null = null;
  const videoIds: string[] = [];
  // QA users are minted PRIVATE — a place's list applies the OWNER's rule row by row, so a stranger sees A's recording only on a public profile. Restored in finally.
  const { data: alphaProfile } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  const priorVisibility = alphaProfile!.visibility as string;
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
  const unseed = await seedOwnChannel(admin, { profileId: alpha.id }, alpha.id);
  try {
    // ── A public round A created (A is its creator; B is nobody there).
    let res = await apiA.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Video Round ${stamp}`, date: new Date().toISOString().split('T')[0], visibility: 'public', participant_ids: [], golf_data: { course_name: `QA Video Course ${stamp}`, round_type: 'outdoor', holes_played: 9 } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    groupPostId = (await res.json()).group_post.id as string;

    // One place at a time: two places in one body is a 400.
    res = await apiA.post('/api/videos', { data: { url: ROUND_YT, group_post_id: groupPostId, activity_id: groupPostId } });
    expect(res.status()).toBe(400);
    // A links the round's recording; B may not (a stranger to the round), though B may SEE the public round's list.
    res = await apiB.post('/api/videos', { data: { url: ROUND_YT, title: 'nope', group_post_id: groupPostId } });
    expect(res.status(), await readErrorBody(res)).toBe(403);
    res = await apiA.post('/api/videos', { data: { url: ROUND_YT, title: `QA Round film ${stamp}`, group_post_id: groupPostId } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const roundVideo = (await res.json()).video as { id: string; place: { kind: string; id: string; name: string } | null };
    videoIds.push(roundVideo.id);
    expect(roundVideo.place).toMatchObject({ kind: 'round', id: groupPostId });
    expect(roundVideo.place!.name).toContain(`QA Video Course ${stamp}`);
    res = await apiB.get(`/api/videos?groupPostId=${groupPostId}`);
    expect(res.status()).toBe(200);
    expect((await res.json()) as { videos: unknown[]; can_add: boolean }).toMatchObject({ can_add: false });
    expect(((await (await apiB.get(`/api/videos?groupPostId=${groupPostId}`)).json()).videos as Array<{ id: string }>).map(v => v.id)).toContain(roundVideo.id);
    // The same video again on A's profile (another place) is the 409 that names the row.
    res = await apiA.post('/api/videos', { data: { url: ROUND_YT } });
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { existing_id?: string }).existing_id).toBe(roundVideo.id);

    // ── An activity of A's.
    res = await apiA.post('/api/activities', { data: { activity: liveWire({ t0: Date.UTC(2026, 7, 2, 9, 0, 0) + Math.floor(Math.random() * 1e6) * 1000, n: 300, stepM: 3, hr: 140, name: `QA Video run ${stamp}`, type: 'run' }) } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    activityId = (await res.json()).id as string;
    res = await apiB.post('/api/videos', { data: { url: ACTIVITY_YT, activity_id: activityId } });
    expect([403, 404]).toContain(res.status());
    res = await apiA.post('/api/videos', { data: { url: ACTIVITY_YT, title: `QA Run film ${stamp}`, activity_id: activityId } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const activityVideo = (await res.json()).video as { id: string; place: { kind: string } | null };
    videoIds.push(activityVideo.id);
    expect(activityVideo.place).toMatchObject({ kind: 'activity' });
    // Only me: a stranger's list is the 404; the owner's still answers.
    res = await apiA.patch(`/api/activities/${activityId}`, { data: { onlyMe: true } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await apiB.get(`/api/videos?activityId=${activityId}`)).status()).toBe(404);
    expect((await apiA.get(`/api/videos?activityId=${activityId}`)).status()).toBe(200);

    // ── A manual workout of A's: undecided → a stranger's list is the 404; the owner's answers.
    res = await apiA.post('/api/workouts', { data: { mode: 'manual', startedAt: new Date().toISOString(), durationSeconds: 1200, title: `QA Video workout ${stamp}`, exercises: [{ name: 'Squat', exerciseKey: 'squat', category: 'strength', notes: null, sets: [{ setNumber: 1, reps: 5, weight: 60, weightUnit: 'kg', durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [] }] }] } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    workoutId = (await res.json()).session.id as string;
    res = await apiB.post('/api/videos', { data: { url: WORKOUT_YT, workout_session_id: workoutId } });
    expect([403, 404]).toContain(res.status());
    res = await apiA.post('/api/videos', { data: { url: WORKOUT_YT, title: `QA Session film ${stamp}`, workout_session_id: workoutId } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const workoutVideo = (await res.json()).video as { id: string; place: { kind: string } | null };
    videoIds.push(workoutVideo.id);
    expect(workoutVideo.place).toMatchObject({ kind: 'workout' });
    expect((await apiB.get(`/api/videos?workoutSessionId=${workoutId}`)).status()).toBe(404);
    expect((await apiA.get(`/api/videos?workoutSessionId=${workoutId}`)).status()).toBe(200);

    // ── The surfaces (A's page context).
    // The round finished: the live page then shows the full card with its tabs (an in-progress round shows score entry instead).
    res = await apiA.patch(`/api/group-posts/${groupPostId}`, { data: { status: 'completed' } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    await page.goto(`/live/${groupPostId}`);
    const open = page.getByRole('button', { name: 'View Full Scorecard' });
    await open.waitFor({ state: 'visible', timeout: 20_000 });
    await open.click();
    await page.getByRole('tab', { name: /^Media/ }).click({ timeout: 20_000 });
    const roundStrip = page.locator('[data-round-videos]');
    await expect(roundStrip.locator(`[data-video-card="${roundVideo.id}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(roundStrip.locator('[data-video-add]')).toHaveAttribute('href', `/videos/new?groupPostId=${groupPostId}`);

    await page.goto(`/activities/${activityId}`);
    await expect(page.locator(`[data-activity-videos] [data-video-card="${activityVideo.id}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-activity-photo-controls] [data-video-add]')).toHaveAttribute('href', `/videos/new?activityId=${activityId}&profileId=${alpha.id}`);

    await page.goto(`/app/workout/${workoutId}`);
    await expect(page.locator('[data-video-add]').first()).toHaveAttribute('href', `/videos/new?workoutSessionId=${workoutId}`, { timeout: 20_000 });

    // The video page names the place and links to it.
    await page.goto(`/videos/${roundVideo.id}`);
    await expect(page.locator(`[data-video-place="${groupPostId}"]`)).toHaveAttribute('href', `/live/${groupPostId}`, { timeout: 20_000 });
  } finally {
    for (const id of videoIds) await apiA.delete(`/api/videos/${id}`).catch(() => undefined);
    if (workoutId) await apiA.delete(`/api/workouts/${workoutId}`).catch(() => undefined);
    if (activityId) await apiA.delete(`/api/activities/${activityId}`).catch(() => undefined);
    if (groupPostId) await admin.from('group_posts').delete().eq('id', groupPostId);
    await admin.from('profiles').update({ visibility: priorVisibility }).eq('id', alpha.id);
    await unseed();
    await apiA.dispose();
    await apiB.dispose();
  }
});
