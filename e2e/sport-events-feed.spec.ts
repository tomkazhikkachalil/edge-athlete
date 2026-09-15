import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

/**
 * Events program — one post, three states in the feed. A publishes an
 * event: the feed shows the announce card with the event chip (the post
 * has no scores). A goes live: the post stays listed (hide-until-finished
 * is relaxed for event rounds) and the card reads Live now. The API
 * carries `sport_event` on the post in both states.
 */
test('feed: the announce card and the event chip, announced → live', async ({ page }) => {
  const stamp = Date.now();
  const api = await apiAs('state.json');
  let eventId: string | null = null;
  try {
    const created = await api.post('/api/sport-events', { data: { name: `QA Feed Event ${stamp}`, visibility: 'public', join_mode: 'request', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Feed Links', holes: 18 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    eventId = ((await created.json()) as { event: { id: string } }).event.id;

    // The API: the post carries the event.
    const feed = (await (await api.get('/api/posts?limit=20')).json()) as { posts: Array<{ id: string; sport_event?: { id: string; name: string; status: string } | null }> };
    const post = feed.posts.find(p => p.sport_event?.id === eventId);
    expect(post, 'the announce post is listed').toBeTruthy();
    expect(post!.sport_event).toMatchObject({ name: `QA Feed Event ${stamp}`, status: 'open' });

    // The feed: the announce card + the chip.
    await page.goto('/feed');
    const card = page.locator(`[data-event-announce-card="${eventId}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(`QA Feed Event ${stamp}`);
    await expect(card).toContainText('Open to requests');
    await expect(page.locator(`[data-post-event-chip="${eventId}"]`)).toHaveText(`From QA Feed Event ${stamp}`);

    // Live: still listed, reads Live now, the chip lands on the event.
    const live = await api.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    await page.reload();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Live now');
    await page.locator(`[data-post-event-chip="${eventId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}`));
    await expect(page.getByRole('heading', { name: `QA Feed Event ${stamp}` })).toBeVisible({ timeout: 20_000 });
  } finally {
    if (eventId) {
      await api.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      await api.delete(`/api/sport-events/${eventId}`).catch(() => null);
    }
    await api.dispose();
  }
});
