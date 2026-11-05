import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { cleanup } from './helpers/cleanup';

// Videos program (296): a full game is a YouTube LINK. The QA user links one
// to their own profile through the API, sees it on the profile's Videos tab,
// opens the video page, adds a highlight by typing its time, taps it — and
// the player's frame carries `start=` in whole seconds (the seek is the
// remount, no IFrame API). Then the link is deleted (its markers with it).
// The video: YouTube's own first upload — public, embeddable, never going away.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

test('link a full game → profile Videos tab → the video page → a highlight seeks the player → delete', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const me = loadQaUser('user.json');
  await resetRateBucket(admin, 'video-write', me.id);
  const api = await apiAs('state.json');
  const title = `QA Full game ${Date.now()}`;
  let videoId: string | null = null;
  try {
    // 1. The link, through the one writer.
    let res = await api.post('/api/videos', { data: { url: YT, title } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const created = (await res.json()).video as { id: string; provider_video_id: string; highlight_count: number; owner: { kind: string; id: string } };
    videoId = created.id;
    expect(created.provider_video_id).toBe('jNQXAC9IVRw');
    expect(created.highlight_count).toBe(0);
    expect(created.owner).toMatchObject({ kind: 'profile', id: me.id });

    // The same link again on the same owner is a 409, never a second row.
    res = await api.post('/api/videos', { data: { url: `https://youtu.be/jNQXAC9IVRw?t=10`, title: 'again' } });
    expect(res.status()).toBe(409);

    // 2. The profile's Videos tab (the owner's own page) shows the card with its count.
    await page.goto('/athlete?tab=videos');
    const card = page.locator(`[data-video-card="${videoId}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(title);
    await expect(card.locator('[data-video-card-count="0"]')).toBeVisible();
    await expect(page.locator('[data-video-add]')).toBeVisible();

    // 3. The video page: the poster first (no frame yet), the owner line, zero highlights.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/videos/${videoId}`), { timeout: 20_000 });
    const player = page.locator('[data-video-player="jNQXAC9IVRw"]');
    await expect(player).toBeVisible({ timeout: 20_000 });
    await expect(player.locator('iframe')).toHaveCount(0);
    await expect(player.locator('[data-video-poster]')).toBeVisible();
    await expect(page.locator('[data-video-highlights="0"]')).toBeVisible();
    await expect(page.locator('[data-video-manage]')).toBeVisible();

    // 4. A highlight, typed: 1:30 → start_ms 90000; the heading counts it.
    await page.locator('[data-highlight-add]').click();
    const form = page.locator('[data-highlight-form]');
    await form.locator('[data-highlight-time]').fill('1:30');
    await form.locator('[data-highlight-label]').fill('QA moment');
    await form.locator('[data-highlight-save]').click();
    const row = page.locator('[data-video-highlight]');
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('[data-video-highlights="1"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /1 highlight/ })).toBeVisible();

    // 5. Tap it: the frame mounts at start=90 with autoplay, on the privacy-enhanced host.
    await row.locator('[data-highlight-play]').click();
    const frame = player.locator('iframe');
    await expect(frame).toHaveCount(1, { timeout: 10_000 });
    await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/jNQXAC9IVRw\?rel=0&start=90&autoplay=1/);
    await expect(player).toHaveAttribute('data-video-start', '90');

    // The API agrees: the list carries the count; the detail carries the marker.
    res = await api.get(`/api/videos?profileId=${me.id}`);
    expect(res.status()).toBe(200);
    const list = (await res.json()).videos as Array<{ id: string; highlight_count: number }>;
    expect(list.find(v => v.id === videoId)?.highlight_count).toBe(1);
    res = await api.get(`/api/videos/${videoId}`);
    const detail = (await res.json()) as { highlights: Array<{ start_ms: number; label: string }>; can_manage: boolean };
    expect(detail.can_manage).toBe(true);
    expect(detail.highlights).toEqual([expect.objectContaining({ start_ms: 90_000, label: 'QA moment' })]);

    // A bad range is refused by the rule (and would be by the DB).
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 5000, end_ms: 4000, label: 'nope' } });
    expect(res.status()).toBe(400);

    // 6. Delete from the page: the confirm names what is lost; the page leaves for the owner's profile.
    await page.locator('[data-video-delete]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/\/athlete\//, { timeout: 20_000 });
    res = await api.get(`/api/videos/${videoId}`);
    expect(res.status()).toBe(404);
    videoId = null;
  } finally {
    await cleanup('videos', [
      async () => {
        if (videoId) await api.delete(`/api/videos/${videoId}`);
      },
      () => api.dispose(),
    ]);
  }
});
