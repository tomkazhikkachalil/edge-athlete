import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { cleanup } from './helpers/cleanup';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 3 PR 3: tagging. On a video that is a GAME a manager tags a
// highlight with the sport's event, whose it is, the period, and the people
// in it by role — a linked profile, or a typed name for someone not here
// yet. The sheet refuses what is not the sport's; a profile the tagger
// cannot see is refused; the clip's ends nudge; removing the highlight takes
// its people with it. Every stat later comes from exactly these rows.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

test('tag a play: the event, whose, the period and the people by role — through the API and on the page at 375 px; the sheet and the privacy rule refuse; nudge; remove', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const me = loadQaUser('user.json');
  const stranger = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'video-write', me.id);
  const api = await apiAs('state.json');
  let videoId: string | null = null;
  let unseed: (() => Promise<void>) | null = null;
  try {
    unseed = await seedOwnChannel(admin, { profileId: me.id }, me.id);
    await admin.from('videos').delete().eq('profile_id', me.id).eq('provider_video_id', 'jNQXAC9IVRw');
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Tagged game ${Date.now()}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    const post = (data: Record<string, unknown>) => api.post(`/api/videos/${videoId}/highlights`, { data });

    // 1. Not a game yet: an event is refused with the reason; a plain highlight with someone "in the clip" is fine.
    res = await post({ start_ms: 1000, label: 'Three', event_key: 'fg3_made', side: 1 });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('game details');
    res = await post({ start_ms: 1000, label: 'Warm-up', people: [{ name: 'QA Walk On', role: 'in_clip' }] });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const plainId = ((await res.json()).highlight as { id: string }).id;

    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // 2. The sheet decides: another sport's event, a missing side, a role the event has not, two scorers, a value where none belongs.
    expect((await post({ start_ms: 2000, label: 'x', event_key: 'goal', side: 1 })).status()).toBe(400);
    expect((await post({ start_ms: 2000, label: 'x', event_key: 'fg3_made' })).status()).toBe(400);
    expect((await post({ start_ms: 2000, label: 'x', event_key: 'steal', side: 1, people: [{ name: 'A', role: 'scorer' }] })).status()).toBe(400);
    expect((await post({ start_ms: 2000, label: 'x', event_key: 'fg2_made', side: 1, people: [{ name: 'A', role: 'scorer' }, { name: 'B', role: 'scorer' }] })).status()).toBe(400);
    expect((await post({ start_ms: 2000, label: 'x', event_key: 'steal', side: 1, value: 4 })).status()).toBe(400);
    //    The privacy rule: a profile the tagger cannot see (a private stranger) is refused.
    res = await post({ start_ms: 2000, label: 'x', event_key: 'steal', side: 2, people: [{ profile_id: stranger.id, role: 'player' }] });
    expect(res.status()).toBe(403);

    // 3. A real tag: a three for side 1 in Q2 — the tagger themselves scoring, a typed name assisting.
    res = await post({ start_ms: 22_000, end_ms: 34_000, label: '3-pointer made', event_key: 'fg3_made', side: 1, period: 2, people: [{ profile_id: me.id, role: 'scorer' }, { name: 'QA Passer', role: 'assist' }] });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const body = await res.json();
    const tagged = (body.highlights as Array<{ id: string; event_key: string | null; side: number | null; period: number | null; people: Array<{ profile_id: string | null; name: string; role: string }> }>).find(h => h.event_key === 'fg3_made')!;
    expect(tagged).toMatchObject({ side: 1, period: 2 });
    expect(tagged.people.map(p => [p.role, p.profile_id, p.name === 'QA Passer'])).toEqual([['scorer', me.id, false], ['assist', null, true]]);
    //    The read for the page carries the same.
    res = await api.get(`/api/videos/${videoId}`);
    const read = await res.json();
    expect((read.highlights as Array<{ id: string; people: unknown[] }>).find(h => h.id === tagged.id)!.people).toHaveLength(2);
    expect((read.highlights as Array<{ id: string; people: Array<{ name: string }> }>).find(h => h.id === plainId)!.people[0].name).toBe('QA Walk On');

    // 4. A PATCH that only moves the clip leaves the tag alone; one that sends the tag replaces it whole.
    res = await api.patch(`/api/videos/${videoId}/highlights/${tagged.id}`, { data: { start_ms: 21_000 } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()).highlights as Array<{ id: string; people: unknown[]; event_key: string | null }>).find(h => h.id === tagged.id)).toMatchObject({ event_key: 'fg3_made', people: [{}, {}] });
    res = await api.patch(`/api/videos/${videoId}/highlights/${tagged.id}`, { data: { event_key: 'fg2_made', side: 1, period: 2, people: [{ profile_id: me.id, role: 'scorer' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()).highlights as Array<{ id: string; people: unknown[]; event_key: string | null }>).find(h => h.id === tagged.id)).toMatchObject({ event_key: 'fg2_made', people: [{ role: 'scorer' }] });

    // 5. On the page, at phone width: add a tag with the form — the event, whose, the period, a scorer by typed name; it names itself.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/videos/${videoId}`);
    await expect(page.locator('[data-video-game-title]')).toHaveText('QA Hawks vs QA Owls', { timeout: 20_000 });
    await expect(page.locator(`[data-video-highlight="${tagged.id}"] [data-highlight-event="fg2_made"]`)).toHaveText('2PT');
    //    The timeline: one mark per highlight along the video's length (the stand-in says 90 s), inside the viewport.
    await expect(page.locator('[data-tag-timeline="2"]')).toBeVisible();
    await expect(page.locator(`[data-tag-timeline-mark="${tagged.id}"]`)).toBeVisible();
    await page.locator('[data-highlight-add]').click();
    await page.locator('[data-highlight-time]').fill('0:10');
    await page.locator('[data-highlight-end]').fill('0:14');
    await page.locator('[data-tag-event]').selectOption('steal');
    await page.locator('[data-tag-side="2"]').click();
    await page.locator('[data-tag-period]').selectOption('1');
    await page.locator('[data-tag-add-person="player"]').click();
    await page.locator('[data-tag-picker-input]').fill('QA Thief');
    await page.locator('[data-tag-pick-name]').click();
    await expect(page.locator('[data-tag-role="player"] [data-tag-person="name"]')).toContainText('QA Thief');
    expect(await fitsViewportWidth(page)).toBe(true);
    //    Nudge: the start five seconds on, the end five on.
    await page.locator('[data-highlight-nudge-start="5"]').click();
    await page.locator('[data-highlight-nudge-end="5"]').click();
    await expect(page.locator('[data-highlight-time]')).toHaveValue('0:15');
    await expect(page.locator('[data-highlight-end]')).toHaveValue('0:19');
    await page.locator('[data-highlight-save]').click();
    const row = page.locator('[data-video-highlight]', { hasText: 'Steal — QA Thief' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('[data-highlight-event="steal"]')).toHaveText('STL');
    await expect(row.locator('[data-highlight-people]')).toContainText('QA Owls · QA Thief');
    expect(await fitsViewportWidth(page)).toBe(true);
    res = await api.get(`/api/videos/${videoId}`);
    const steal = ((await res.json()).highlights as Array<{ id: string; event_key: string | null; start_ms: number; end_ms: number | null; side: number; period: number }>).find(h => h.event_key === 'steal')!;
    expect(steal).toMatchObject({ start_ms: 15_000, end_ms: 19_000, side: 2, period: 1 });

    // 6. Edit on the page: the form opens with the tag; changing the event keeps the person (moved to "also in the clip" when the new event has no such role).
    await row.locator('[data-highlight-edit]').click();
    await expect(page.locator('[data-tag-event]')).toHaveValue('steal');
    await page.locator('[data-tag-event]').selectOption('block');
    await expect(page.locator('[data-tag-role="player"] [data-tag-person="name"]')).toContainText('QA Thief');
    await page.locator('[data-highlight-label]').fill('');
    await page.locator('[data-highlight-save]').click();
    await expect(page.locator(`[data-video-highlight="${steal.id}"] [data-highlight-event="block"]`)).toHaveText('BLK', { timeout: 20_000 });

    // 7. Remove the tagged highlight: its people go with it.
    res = await api.delete(`/api/videos/${videoId}/highlights/${tagged.id}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { count } = await admin.from('video_highlight_people').select('id', { count: 'exact', head: true }).eq('highlight_id', tagged.id);
    expect(count).toBe(0);
  } finally {
    await cleanup('video-tagging', [
      async () => { if (videoId) await api.delete(`/api/videos/${videoId}`); },
      async () => { await unseed?.(); },
      () => api.dispose(),
    ]);
  }
});
