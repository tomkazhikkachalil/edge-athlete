import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

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

/**
 * Phase 3 (PR 11) — a match round in the feed: the announce card names
 * the format ("Match play · Singles · Gross"); once the round completes
 * (B concedes the match) the post leads with the match results card —
 * the winner first, "def.", "conceded" — never the stroke totals. The
 * API carries `match` and `match_results` on the post. Self-skips
 * before 212.
 */
test('feed: a match round — the format on the announce card, the results card names the winner', async ({ page }) => {
  const stamp = Date.now();
  const api = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_matches missing — run migration 212');
  // The masked names below assume both QA users are private (their default);
  // a spec earlier in a long run can leave one public (the Sep 25 prod probe
  // saw "Edge Alpha" for "Edge A."), so this test says so itself.
  const alphaId = loadQaUser('user.json').id;
  await admin.from('profiles').update({ visibility: 'private' }).in('id', [alphaId, userB.id]);
  let eventId: string | null = null;
  try {
    const created = await api.post('/api/sport-events', { data: { name: `QA Feed Match ${stamp}`, visibility: 'public', publish: true, format: 'match_gross', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Feed Links', holes: 9, name: 'Final' } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const view = (await created.json()) as { event: { id: string }; rounds: Array<{ id: string }> };
    eventId = view.event.id;
    const roundId = view.rounds[0].id;

    await page.goto('/feed');
    const card = page.locator(`[data-event-announce-card="${eventId}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-event-announce-format]')).toHaveText('Match play · Singles · Gross');
    await expect(card.locator('[data-event-announce-round-name]')).toHaveText('Final');

    // B accepts, the draw, the start, B concedes the match, the round completes without the override.
    expect((await api.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as { viewer: { participant_id: string }; participants: Array<{ id: string; role: string }> };
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);
    const host = asB.participants.find(p => p.role === 'organizer')!;
    expect((await api.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: { groups: [{ members: [host.id, asB.viewer.participant_id] }] } })).ok()).toBe(true);
    const live = await api.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    const matchId = ((await (await api.get(`/api/sport-events/${eventId}/matches`)).json()) as { matches: Array<{ id: string }> }).matches[0].id;
    const conceded = await apiB.post(`/api/sport-events/${eventId}/matches/${matchId}/concede`, { data: { hole: null, side: 2, version: 0 } });
    expect(conceded.status(), await readErrorBody(conceded)).toBe(200);
    const done = await api.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'completed' } });
    expect(done.ok(), await readErrorBody(done)).toBe(true);

    // The API and the feed: the results card, the winner first.
    const feed = (await (await api.get('/api/posts?limit=20')).json()) as { posts: Array<{ sport_event?: { id: string; match: unknown; match_results?: Array<{ winner: string; loser: string; result: string; kind: string }> | null } | null }> };
    const post = feed.posts.find(p => p.sport_event?.id === eventId);
    expect(post?.sport_event?.match).toEqual({ sides: 'singles', bracket: false });
    expect(post?.sport_event?.match_results).toHaveLength(1);
    // The QA users are private: names are masked ("Edge B.") — the contest rule.
    expect(post!.sport_event!.match_results![0]).toMatchObject({ result: 'conceded', kind: 'decided', loser: 'Edge B.', winner: 'Edge A.' });
    await page.goto('/feed');
    const results = page.locator(`[data-event-match-results="${eventId}"]`);
    await expect(results).toBeVisible({ timeout: 20_000 });
    await expect(results.locator('[data-event-match-line]')).toHaveCount(1);
    await expect(results.locator('[data-event-match-line]')).toContainText('def.');
    await expect(results.locator('[data-event-match-line]')).toContainText('conceded');
    await expect(page.locator(`[data-event-announce-card="${eventId}"]`)).toHaveCount(0);
  } finally {
    if (eventId) await api.delete(`/api/sport-events/${eventId}`).catch(() => null);
    await api.dispose();
    await apiB.dispose();
  }
});
