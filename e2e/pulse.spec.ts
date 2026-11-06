import { test, expect, type APIRequestContext } from './helpers/test';
import { readErrorBody } from './helpers/qa-user';
import { openEventSession } from './helpers/sport-events';

/**
 * The pulse (the cost program PR B, Oct 29 2026; migration 292): ONE call,
 * GET /api/me/pulse, answers what three polls used to — the live golf
 * count, the live events count and the unread messages count — for the
 * header's dot and the bell on every page. Parity with the three routes it
 * replaces, then the two movements that matter: a round starting (A's own
 * private round with B on the roster counts for both and not for a
 * stranger) and a message arriving (A's unread rises by one and falls on
 * the read). Private, no-store. Zero UI: the API is the contract.
 */
type Pulse = { liveNow: { golf: number; events: number; broadcasts: number; total: number }; unread: { messages: number } };

async function pulse(api: APIRequestContext): Promise<Pulse> {
  const res = await api.get('/api/me/pulse');
  expect(res.status(), await readErrorBody(res)).toBe(200);
  expect(res.headers()['cache-control'] ?? '').toContain('private');
  return (await res.json()) as Pulse;
}

// The three polls the pulse replaced, plus the broadcasts count (300, the Videos program Phase 4a) it mirrors.
async function theThree(api: APIRequestContext): Promise<{ golf: number; events: number; broadcasts: number; unread: number }> {
  const [g, e, b, u] = await Promise.all([api.get('/api/golf/live-now/count'), api.get('/api/sport-events/live-now?count=1'), api.get('/api/videos/live-now?count=1'), api.get('/api/messages/unread-count')]);
  expect(g.ok() && e.ok() && b.ok() && u.ok()).toBe(true);
  return { golf: ((await g.json()) as { count: number }).count, events: ((await e.json()) as { count: number }).count, broadcasts: ((await b.json()) as { count: number }).count, unread: ((await u.json()) as { count: number }).count };
}

test('one pulse equals the three polls it replaces; a round and a message move it @mobile', async () => {
  const s = await openEventSession();
  let groupPostId: string | null = null;
  try {
    const a0 = await pulse(s.apiA);
    const three = await theThree(s.apiA);
    expect(a0.liveNow).toEqual({ golf: three.golf, events: three.events, broadcasts: three.broadcasts, total: three.golf + three.events + three.broadcasts });
    expect(a0.unread.messages).toBe(three.unread);
    const b0 = await pulse(s.apiB);
    const c0 = s.apiC ? await pulse(s.apiC) : null;

    // A starts a PRIVATE round today with B on the roster.
    const created = await s.apiA.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Pulse ${s.stamp}`,
        date: new Date().toISOString().split('T')[0],
        visibility: 'private',
        participant_ids: [s.userB.id],
        golf_data: { course_name: `QA Pulse Course ${s.stamp}`, round_type: 'outdoor', holes_played: 9 },
      },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    groupPostId = ((await created.json()) as { group_post: { id: string } }).group_post.id;

    const a1 = await pulse(s.apiA);
    expect(a1.liveNow.golf).toBe(a0.liveNow.golf + 1);
    expect(a1.liveNow.total).toBe(a1.liveNow.golf + a1.liveNow.events + a1.liveNow.broadcasts);
    expect((await pulse(s.apiB)).liveNow.golf).toBe(b0.liveNow.golf + 1); // on the roster
    if (s.apiC && c0) expect((await pulse(s.apiC)).liveNow.golf).toBe(c0.liveNow.golf); // a stranger: private
    // Parity holds with the round live.
    const threeLive = await theThree(s.apiA);
    expect(a1.liveNow.golf).toBe(threeLive.golf);

    // B messages A: A's unread rises by one, equal to the old count; A reads it: back.
    const conv = await s.apiB.post('/api/messages', { data: { type: 'direct', participantId: s.userA.id } });
    expect([200, 201], await readErrorBody(conv)).toContain(conv.status());
    const { conversationId } = (await conv.json()) as { conversationId: string };
    const sent = await s.apiB.post(`/api/messages/${conversationId}/messages`, { data: { type: 'text', content: `qa pulse ${s.stamp}` } });
    expect(sent.status(), await readErrorBody(sent)).toBe(201);
    const a2 = await pulse(s.apiA);
    expect(a2.unread.messages).toBe(a0.unread.messages + 1);
    expect(a2.unread.messages).toBe((await theThree(s.apiA)).unread);
    const readRes = await s.apiA.patch(`/api/messages/${conversationId}/read`);
    expect(readRes.ok(), await readErrorBody(readRes)).toBe(true);
    expect((await pulse(s.apiA)).unread.messages).toBe(a0.unread.messages);

    // Signed out: nothing.
    expect((await s.anon.get('/api/me/pulse')).status()).toBe(401);
  } finally {
    if (groupPostId) await s.apiA.delete(`/api/group-posts/${groupPostId}`);
    await s.dispose();
  }
});

/**
 * The change signals (the cost program PR C, Nov 6 2026; migration 301): the
 * database broadcasts, the open tab fetches ONCE per burst. A's tab on /feed
 * hears B start a private round with A on it (a public `live-now` tick AND
 * A's private roster tick, 1.5 s apart at most → one fetch), the dot lights;
 * B's message reaches A's private topic; A's read on ANOTHER device (the API)
 * reaches the tab too — the gap the bell never closed; then the tab sits idle
 * and makes no pulse call at all (the timer is a 10-minute net now).
 */
test('the signals: one fetch per change, the dot and the badge follow, an idle tab is silent @mobile', async ({ page }) => {
  test.setTimeout(240_000);
  const s = await openEventSession();
  let groupPostId: string | null = null;
  let pulseRequests = 0;
  page.on('request', r => { if (r.url().includes('/api/me/pulse')) pulseRequests++; });
  const settle = async (label: string, expected: number) => {
    await expect.poll(() => pulseRequests, { message: `${label}: one pulse fetch`, timeout: 12_000 }).toBe(expected);
    await page.waitForTimeout(4_000); // past the debounce + jitter window: a burst stays ONE fetch
    expect(pulseRequests, `${label}: still one fetch after the burst`).toBe(expected);
  };
  try {
    const a0 = await pulse(s.apiA);
    await page.goto('/feed');
    await page.waitForResponse(r => r.url().includes('/api/me/pulse')); // the mount's fetch
    await page.waitForTimeout(3_000); // the two channels join
    const base = pulseRequests;

    // B starts a private round with A on the roster: a `live-now` tick for
    // everyone AND a `user:{A}` roster tick — one fetch, the dot on.
    const created = await s.apiB.post('/api/group-posts', {
      data: {
        type: 'golf_round',
        title: `QA Pulse signal ${s.stamp}`,
        date: new Date().toISOString().split('T')[0],
        visibility: 'private',
        participant_ids: [s.userA.id],
        golf_data: { course_name: `QA Pulse Course ${s.stamp}`, round_type: 'outdoor', holes_played: 9 },
      },
    });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    groupPostId = ((await created.json()) as { group_post: { id: string } }).group_post.id;
    await settle('a round going live', base + 1);
    // The header's dot is in the DOM at every width (hidden on a phone, where the tab bar's dot shows): the visible one.
    await expect(page.locator('[data-tab-live-dot]:visible, [data-live-dot="on"]:visible').first()).toBeVisible({ timeout: 5_000 });

    // B messages A: A's private topic → one fetch, the number up by one.
    const conv = await s.apiB.post('/api/messages', { data: { type: 'direct', participantId: s.userA.id } });
    expect([200, 201], await readErrorBody(conv)).toContain(conv.status());
    const { conversationId } = (await conv.json()) as { conversationId: string };
    const sent = await s.apiB.post(`/api/messages/${conversationId}/messages`, { data: { type: 'text', content: `qa pulse signal ${s.stamp}` } });
    expect(sent.status(), await readErrorBody(sent)).toBe(201);
    await settle('a message', base + 2);
    expect((await pulse(s.apiA)).unread.messages).toBe(a0.unread.messages + 1);

    // A reads it on ANOTHER device (the API): the tab hears the read too.
    const readRes = await s.apiA.patch(`/api/messages/${conversationId}/read`);
    expect(readRes.ok(), await readErrorBody(readRes)).toBe(true);
    await settle('a read on another device', base + 3);

    // The round ends: the public tick → one fetch; the dot goes if nothing else is live.
    const ended = await s.apiB.delete(`/api/group-posts/${groupPostId}`);
    expect(ended.ok(), await readErrorBody(ended)).toBe(true);
    groupPostId = null;
    await settle('a round ending', base + 4);
    if (a0.liveNow.total === 0) await expect(page.locator('[data-tab-live-dot]:visible, [data-live-dot="on"]:visible')).toHaveCount(0, { timeout: 5_000 });

    // Idle: no poll. 90 s of nothing (the net is 10 minutes).
    await page.waitForTimeout(90_000);
    expect(pulseRequests, 'an idle tab makes no pulse call').toBe(base + 4);
  } finally {
    if (groupPostId) await s.apiB.delete(`/api/group-posts/${groupPostId}`);
    await s.dispose();
  }
});
