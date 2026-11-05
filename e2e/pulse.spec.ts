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
type Pulse = { liveNow: { golf: number; events: number; total: number }; unread: { messages: number } };

async function pulse(api: APIRequestContext): Promise<Pulse> {
  const res = await api.get('/api/me/pulse');
  expect(res.status(), await readErrorBody(res)).toBe(200);
  expect(res.headers()['cache-control'] ?? '').toContain('private');
  return (await res.json()) as Pulse;
}

async function theThree(api: APIRequestContext): Promise<{ golf: number; events: number; unread: number }> {
  const [g, e, u] = await Promise.all([api.get('/api/golf/live-now/count'), api.get('/api/sport-events/live-now?count=1'), api.get('/api/messages/unread-count')]);
  expect(g.ok() && e.ok() && u.ok()).toBe(true);
  return { golf: ((await g.json()) as { count: number }).count, events: ((await e.json()) as { count: number }).count, unread: ((await u.json()) as { count: number }).count };
}

test('one pulse equals the three polls it replaces; a round and a message move it @mobile', async () => {
  const s = await openEventSession();
  let groupPostId: string | null = null;
  try {
    const a0 = await pulse(s.apiA);
    const three = await theThree(s.apiA);
    expect(a0.liveNow).toEqual({ golf: three.golf, events: three.events, total: three.golf + three.events });
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
    expect(a1.liveNow.total).toBe(a1.liveNow.golf + a1.liveNow.events);
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
