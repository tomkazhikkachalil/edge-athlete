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
  let tourneyId: string | null = null;
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

    // Phase 2: a two-round tournament — the round-2 card reads "Round 2 of 2" and is NOT live while round 1 is; the chip names the round; the list knows its rounds.
    const t = await api.post('/api/sport-events', { data: { name: `QA Feed Tourney ${stamp}`, visibility: 'public', publish: true, rounds: [{ scheduled_on: '2030-06-01', course_name: 'QA Feed Links', holes: 9, starting_hole: 1 }, { scheduled_on: '2030-06-02', course_name: 'QA Feed Links', holes: 9, starting_hole: 1 }] } });
    expect(t.status(), await readErrorBody(t)).toBe(201);
    const tv = (await t.json()) as { event: { id: string }; rounds: Array<{ id: string }> };
    tourneyId = tv.event.id;
    const r1 = tv.rounds[0].id;
    const started = await api.post(`/api/sport-events/${tourneyId}/rounds/${r1}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(started.ok(), await readErrorBody(started)).toBe(true);
    const feed2 = (await (await api.get('/api/posts?limit=30')).json()) as { posts: Array<{ sport_event?: { id: string; sequence: number; round_status: string; round_count: number } | null }> };
    const cards = feed2.posts.filter(p => p.sport_event?.id === tourneyId).map(p => p.sport_event!).sort((a, b) => a.sequence - b.sequence);
    expect(cards.map(c => [c.sequence, c.round_status, c.round_count])).toEqual([[1, 'live', 2], [2, 'scheduled', 2]]);
    const listed = (await (await api.get('/api/sport-events?scope=live')).json()) as { events: Array<{ id: string; rounds: { count: number; completed: number; live_sequence: number | null } }> };
    expect(listed.events.find(e => e.id === tourneyId)!.rounds).toEqual({ count: 2, completed: 0, live_sequence: 1 });
    await page.goto('/feed');
    const round2 = page.locator(`[data-event-announce-card="${tourneyId}"]`).filter({ has: page.locator('[data-event-announce-round="2"]') });
    await expect(round2).toBeVisible({ timeout: 20_000 });
    await expect(round2).toContainText('Round 2 of 2');
    await expect(round2).not.toContainText('Live now');
    const round1 = page.locator(`[data-event-announce-card="${tourneyId}"]`).filter({ has: page.locator('[data-event-announce-round="1"]') });
    await expect(round1).toContainText('Live now');
    await expect(page.locator(`[data-post-event-chip="${tourneyId}"]`).first()).toContainText(/Round [12]/);
  } finally {
    for (const id of [eventId, tourneyId]) {
      if (!id) continue;
      await api.post(`/api/sport-events/${id}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      await api.delete(`/api/sport-events/${id}`).catch(() => null);
    }
    await api.dispose();
  }
});
